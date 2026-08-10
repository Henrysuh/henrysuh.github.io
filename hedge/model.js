/* ===========================================================================
   model.js — 니켈 헤지 Simulation 모델의 계산 엔진
   nickel_hedge_cases_v10.xlsx 를 4개 탭(개요 / 거래조건 / Hedge 손익 / 참고)으로
   단순화한 구조. 상태(state)를 받아 파생값을 계산할 뿐 DOM은 건드리지 않는다.

   타임라인
     W0                       매입가 확정 — 가격 익스포저 시작
     W0 ~ W2   구매·운송      ┐
     W2 ~ W6   생산           ├ 미헤지 노출 구간
     W6 ~ W8   출고준비       ┘
       W6                     Rolling 종료 → 잔여 Exposure 확정 → Hedge 진입
     W9 ~ W12  출고월         판매가 = 출고월 4주 평균 — 익스포저 종료 · 정산
   =========================================================================== */

const MAX_WEEK = 20;                      // 시나리오 가격표가 보유한 마지막 주차
const WEEKS = MAX_WEEK + 1;

const SCENARIOS = ['Contango', 'Backwardation', 'Fluctuation'];

/* 행 종류 — 물량 정책의 출발점.
     contract = 이미 판매 계약이 걸린 구매 물량 (판매 계획)
     stock    = 전월에서 넘어온 재고. 추가로 판 만큼만 판매 확정되고 나머지는 재고로 남는다
   가격 정책(고객 전가 / 출고월 평균)은 이 축과 무관하게 판매 확정 물량을 가른다. */
const ROW_KINDS = { contract: '판매 계약', stock: '이월 재고' };
/* 표에서는 폭을 아끼려고 짧게 쓴다 — 계산·엑셀 비교에는 위 정식 이름을 쓴다 */
const ROW_KIND_SHORT = { contract: '계약', stock: '재고' };

/* H1 — 가격 조건. 물량을 쪼개 열로 늘리지 않고 행마다 하나를 고른다.
   한 계약이 두 조건으로 갈리면 행을 나눈다 (조건이 늘어도 열은 그대로다).
     전가 → 매입가를 그대로 판매가에 얹으므로 익스포저 0
     평균 → 출고월 평균으로 확정, 헤지 대상 */
const PRICE_CONDS = { '전가': '고객 전가', '평균': '출고월 평균' };

/* 잔여 익스포저 대응 4종. 저가법은 헤지 수단이 아니라 회계 인식 방법이지만,
   '잔여 익스포저를 어떻게 다룰 것인가'라는 같은 질문에 대한 네 번째 답이라 함께 세운다. */
const HEDGE_KINDS = {
  none:    { label: '무대응',       short: '무대응',  nature: '방치' },
  /* 계약 후 협상으로 판가조건을 매입가 연동으로 바꾸는 것 — 파생이 아닌 운영 해법이다.
     넘긴 물량은 W0~W6 변동까지 고객이 지므로 ⓐ 까지 0이 된다. */
  pass:    { label: '고객 전가',    short: '전가',    nature: '운영 — 가격 조건 협상' },
  forward: { label: 'Forward 매도', short: 'Forward', nature: 'OTC 파생' },
  future:  { label: 'Future 매도',  short: 'Future',  nature: '거래소 파생' },
  lcm:     { label: '저가법 평가',   short: '저가법',  nature: '회계 인식' }
};
/* 실제로 고를 수 있는 대책은 넷이다.
   저가법은 '헤지 수단'이 아니라 판매 미확정 재고에 자동으로 걸리는 회계 처리라
   Hedge 결과가 아니라 손익에서 다룬다 (개요 탭 매트릭스에는 비교 대상으로 남겨 둔다). */
const HEDGE_ORDER = ['none', 'pass', 'forward', 'future'];

const BUY_PRICE_MODES = {
  spot: '구매 시점 단일가 (W0)',
  avg:  '리드타임 평균 (W0~W8)'
};

function defaultState() {
  return {
    terms: {
      qty: 100,               // 물량 (톤/월)
      transportWeeks: 2,      // 구매 ~ 운송
      mfgWeeks: 4,            // 생산
      shipPrepWeeks: 2,       // 출고준비
      shipWeeks: 4,           // 출고 (= 출고월, 판매 QP 길이)
      procMargin: 1500,       // 가공마진 ($/t)
      buyPriceMode: 'spot'    // 매입가 확정 방식 — 단일 시점(판매자 우위) / 평균(구매자 우위)
    },
    market: {
      scenario: 'Fluctuation',
      prices: {
        Contango:      [20000, 20100, 20200, 20300, 20400, 20500, 20600, 20700, 20800, 20900, 21000,
                        21100, 21200, 21300, 21400, 21500, 21600, 21700, 21800, 21900, 22000],
        Backwardation: [20000, 20600, 21500, 22800, 24500, 26500, 28500, 30000, 29000, 27500, 26000,
                        24800, 23800, 23000, 22400, 22000, 21700, 21500, 21400, 21300, 21200],
        Fluctuation:   [20000, 20800, 21400, 21000, 20200, 19600, 19400, 20000, 20800, 21200, 20800,
                        20000, 19400, 19200, 19800, 20600, 21000, 20600, 19900, 19500, 20000]
      }
    },
    inventory: {
      prevUnit: 21000,        // 재고 단가 — 전월 이월 ($/t)
      addQty: 0               // 금월 재고 편입 물량 (톤)
    },
    hedgeParams: {
      ratePct: 5,             // 연 이자율 (%)
      storage: 50,            // 창고·보험료 ($/t, 헤지 기간 합계)
      convenienceYield: 0,    // 적기공급 프리미엄 (백워데이션에서 > 0)
      ibSpread: 150,          // 브로커 스프레드 ($/t) — 선도 고정가에 내재 (가격에 숨은 비용)
      ibFeeForward: 3,        // 브로커 수수료 — Forward 체결 ($/t, 명시 청구 → 원가 계상)
      ibFeeFuture: 2.5,       // 브로커 수수료 — Future round-turn ($/t, 진입 + 청산)
      imRatePct: 10,          // 개시증거금율 (%)
      cashLimit: 3000000      // 가용 현금 한도 ($) — 마진콜 대응력
    },
    /* 통합 원장 — 한 행이 물량(E1) → 가격(H1) → Hedge(H2) → 잔여(E2) 순으로 읽힌다.
       qty      총 물량 (계약 물량 / 기초 재고)
       addQty   재고에서 추가로 판매 확정한 물량 (재고 행에서만 쓴다)
       addAt    재고에서 추가 판매한 물량 — Rolling 3단계(W2·W4·W6)별
       cond     H1 계약 시점의 가격 조건 — 전가 / 평균
       hedge    H2 계약 후의 조치 — 무대응 / 고객 전가(협상) / Forward / Future
       hedgeAt  H2 로 처리한 물량 — 단계별. 이른 단계에 처리할수록 ⓐ 미헤지 구간이 짧다 */
    book: [
      { name: '계약 C1', kind: 'contract', qty: 40, addAt: [0, 0, 0], cond: '전가',
        qpShift: 0, hedgeAt: [0, 0, 0],   hedge: 'none' },
      { name: '계약 C2', kind: 'contract', qty: 20, addAt: [0, 0, 0], cond: '평균',
        qpShift: 0, hedgeAt: [0, 0, 0],   hedge: 'none' },
      /* 20톤 중 10톤을 W4에 협상으로 고객 전가 전환 — 남은 10톤은 노출된 채 둔다 */
      { name: '계약 C3', kind: 'contract', qty: 20, addAt: [0, 0, 0], cond: '평균',
        qpShift: 0, hedgeAt: [0, 10, 0],  hedge: 'pass' },
      /* 10톤은 W2에 일찍, 10톤은 W6에 — 같은 수단이라도 ⓐ가 달라지는 것을 보인다 */
      { name: '계약 C4', kind: 'contract', qty: 20, addAt: [0, 0, 0], cond: '평균',
        qpShift: 0, hedgeAt: [10, 0, 10], hedge: 'future' },
      /* 재고는 추가 판매 확정분만 헤지 대상이 된다. 남은 재고는 대책과 무관하게 저가법 평가.
         판 20톤 중 절반만 Forward 로 막아 부분 헤지가 어떻게 갈라지는지 보인다. */
      { name: '재고 S1', kind: 'stock',    qty: 50, addAt: [20, 0, 0], cond: '평균',
        qpShift: 0, hedgeAt: [0, 0, 10],  hedge: 'forward' }
    ],
    /* 화면·엑셀에 그대로 실리는 사용자 문장. 계산에는 쓰이지 않는다. */
    notes: {
      /* ② 현황판 바로 아래에 붙는 한 줄 — 경영층이 이 표에서 먼저 읽어야 할 것 */
      boardLead: '운영으로 먼저 줄이고(H1·H2), 남은 것(E2)만 가격 리스크로 안고 간다.',
      /* ④ 손익표 바로 위에 붙는 한 줄 — 이 표에서 무엇을 읽어야 하는지 먼저 말한다 */
      pnlLead: '헤지는 손익의 크기를 줄이는 것이 아니라, 폭을 좁히는 대가로 Operation 비용을 내는 선택이다.'
    }
  };
}

/* ------------------------------- helpers -------------------------------- */
const sum = a => a.reduce((s, v) => s + v, 0);
/* 단계별 입력을 앞 단계부터 채우며 상한(cap)까지만 인정한다.
   넘겨 적은 값은 잘라내되 원본은 그대로 두고 화면에서 ⚠ 로 알린다. */
const clampStages = (arr, cap) => {
  let left = Math.max(0, cap);
  return [0, 1, 2].map(i => {
    const q = Math.min(Math.max(0, (arr && arr[i]) || 0), left);
    left -= q;
    return q;
  });
};
const avg = a => (a.length ? sum(a) / a.length : 0);
const clampWeek = w => Math.max(0, Math.min(MAX_WEEK, Math.round(w)));
/* 모델 안에서 쓰는 최소 정수 표기 (화면 포맷터는 views.js 에 따로 있다) */
const n0i = v => Math.round(v).toLocaleString('en-US');

/* ----------------------------- 거래조건 ---------------------------------- */
function computeTerms(t) {
  const transportEnd = t.transportWeeks;
  const mfgEnd       = transportEnd + t.mfgWeeks;
  const leadWeeks    = mfgEnd + t.shipPrepWeeks;      // 출고준비 완료 = 리드타임
  const shipStart    = clampWeek(leadWeeks + 1);      // 출고월 첫 주
  const shipEnd      = clampWeek(leadWeeks + t.shipWeeks);
  const decisionWeek = clampWeek(mfgEnd);             // Rolling 종료 · Hedge 진입

  /* Rolling 조치 3단계 — 운송 완료 / 생산 중간 / 생산 완료.
     기간을 바꿔도 항상 증가하도록 보정한다. */
  const raw = [transportEnd, transportEnd + Math.round(t.mfgWeeks / 2), mfgEnd];
  const stageWeeks = [];
  raw.forEach((w, i) => {
    const v = clampWeek(Math.max(w, i === 0 ? 0 : stageWeeks[i - 1] + 1));
    stageWeeks.push(v);
  });

  return {
    qty: t.qty,
    transportEnd, mfgEnd, leadWeeks, shipStart, shipEnd, decisionWeek, stageWeeks,
    hedgeWeeks: Math.max(0, shipEnd - decisionWeek),
    exposureWeeks: shipEnd,
    steps: [
      /* 매입가는 거래조건의 '매입가 확정 방식' 선택을 그대로 따른다 —
         단일 시점(W0)으로 못박아 두면 '평균'을 골랐을 때 표가 틀린 값을 말한다. */
      { name: '구매 · 운송', qty: t.qty, weeks: t.transportWeeks, span: `W0 ~ W${transportEnd}`,
        price: t.buyPriceMode === 'avg'
          ? `시장가 — 리드타임 평균 (W0~W${leadWeeks})`
          : '시장가 — 구매 시점 단일가 (W0)',
        priceAlt: t.buyPriceMode === 'avg'
          ? '다른 선택: 구매 시점 단일가 (W0)'
          : `다른 선택: 리드타임 평균 (W0~W${leadWeeks})`,
        rule: '선택한 방식으로 매입가 확정 — 가격 익스포저 시작. 도착은 운송 기간 경과 후' },
      { name: '생산 — 황산니켈 생산', qty: t.qty, weeks: t.mfgWeeks, span: `W${transportEnd} ~ W${mfgEnd}`,
        price: `$${t.procMargin.toLocaleString('en-US')} /t`,
        rule: '가공마진 = 상수 (시장가 무관, A Company 제조 이익)' },
      { name: '출고준비', qty: t.qty, weeks: t.shipPrepWeeks, span: `W${mfgEnd} ~ W${leadWeeks}`,
        price: '—',
        rule: '검사 · 포장 · 선적 서류. 가격 확정 없음' },
      { name: '출고 (출고월)', qty: t.qty, weeks: t.shipWeeks, span: `W${shipStart} ~ W${shipEnd}`,
        price: '출고월 평균 시장가 + 가공마진',
        rule: 'FOB — 출고월 4주 평균으로 매출가 확정 → 가격 익스포저 종료 · 정산' }
    ],
    timeline: [
      { week: 'W0', event: '니켈 구매 계약 — 매입가 확정', mark: 'start' },
      { week: `W0 ~ W${transportEnd}`, event: '구매 · 운송' },
      { week: `W${transportEnd} ~ W${mfgEnd}`, event: '생산 — 황산니켈 생산' },
      { week: `W${stageWeeks[0]} · W${stageWeeks[1]} · W${stageWeeks[2]}`,
        event: 'Rolling — 추가 판매, 가격 조건 협상', mark: 'roll' },
      { week: `W${decisionWeek}`,
        event: 'Rolling Deadline — Exposure 확정 및 Hedge 실행', mark: 'decide' },
      { week: `W${mfgEnd} ~ W${leadWeeks}`, event: '출고준비' },
      { week: `W${shipStart} ~ W${shipEnd}`, event: '출고월 — 매출가 확정 · 정산', mark: 'end' }
    ]
  };
}

/* --------------------------- 시황 · 매입가 ------------------------------- */
function priceSeries(state) {
  const raw = state.market.prices[state.market.scenario] || [];
  const out = raw.slice(0, WEEKS);
  while (out.length < WEEKS) out.push(out[out.length - 1] || 0);
  return out;
}

/* ---------------------- Hedge 손익 (통합 계산) -------------------------- */
function computeModel(state) {
  const t = state.terms;
  const c = computeTerms(t);
  const hp = state.hedgeParams;
  const px = priceSeries(state);
  const at = w => px[clampWeek(w)];

  /* 매입가 — 단일 시점(판매자 우위) vs 리드타임 평균(구매자 우위) */
  const buySpot = at(0);
  const buyAvg  = avg(px.slice(0, c.leadWeeks + 1));
  const buyPrice = t.buyPriceMode === 'avg' ? buyAvg : buySpot;
  const buyLabel = t.buyPriceMode === 'avg' ? `W0~W${c.leadWeeks} 평균` : 'W0 단일가';
  /* 전가 물량의 판매 QP — 매입가가 정해지는 구간이 곧 판매가가 정해지는 구간이다 */
  const buyQPLabel = t.buyPriceMode === 'avg' ? `W0 ~ W${c.leadWeeks}` : 'W0';

  const decisionPrice = at(c.decisionWeek);
  const settlePrice   = at(c.shipEnd);

  /* 재고 단가 — 이동평균 */
  const invBaseQty = sum(state.book.filter(r => r.kind === 'stock').map(r => r.qty));
  const invAdd = state.inventory.addQty;
  const invUnit = (invBaseQty + invAdd === 0)
    ? state.inventory.prevUnit
    : (invBaseQty * state.inventory.prevUnit + invAdd * buyPrice) / (invBaseQty + invAdd);

  /* Forward 고정가 — W6 기준 이론 선도가 − 브로커 스프레드.
     출고월 = 4주 = 1개월로 보아 헤지 기간을 개월로 환산한다. */
  const hedgeMonths = c.hedgeWeeks / Math.max(1, t.shipWeeks);
  const fwdInterest = decisionPrice * (hp.ratePct / 100) * hedgeMonths / 12;
  const fwdTheory   = decisionPrice + fwdInterest + hp.storage - hp.convenienceYield;
  const fwdFixed    = fwdTheory - hp.ibSpread;
  /* ⓓ — Forward 를 고른 대가로 A 가 실제로 '깎이는' 부분만 남긴다.
     고정가 − 현물 = (이자 + 창고) − 편의수익 − 스프레드 인데,
     앞의 (이자 + 창고)는 A 가 물건을 W6~W12 들고 있으면서 어차피 부담하는 보유비용이고
     선도가는 그만큼을 얹어 보상해 주는 것이라 순효과가 0이다 — 게다가 네 수단 모두 동일하다.
     수단을 갈라놓는 건 커브(적기공급 프리미엄)와 브로커 스프레드뿐이므로 그 둘만 센다.
     따라서 ⓓ는 항상 ≤ 0 — A 가 그만큼 할인해서 넘기는 값이다. */
  const carryPerTon = -(hp.convenienceYield + hp.ibSpread);
  const carryGross  = fwdFixed - decisionPrice;      // 참고용 총액 (이자·창고 포함)

  /* ---------------- ① Exposure 현황판 ----------------
     한 행을 S → H1 → E1 → H2 → E2 로 세운다. 조치와 잔여가 번갈아 나온다.
       S  판매 확정  — 계획(계약분) + 추가(재고에서 판 물량). 남은 것이 재고
       H1 가격 Hedge — 고객 전가로 넘긴 물량 (계약 시점의 판가조건)
       E1 Exposure   — S − H1 + 재고. 아직 가격에 걸려 있는 물량
       H2 Hedge 조치 — 계약 후의 조치 (전가 협상 / Forward / Future)
       E2 잔여       — E1 − H2 */
  const rows = state.book.map(row => {
    const isStock = row.kind === 'stock';
    const isPass  = row.cond === '전가';
    const qty = Math.max(0, row.qty);
    /* 계약 행은 물량 전부가 판매 계획, 재고 행은 추가로 판 만큼만 판매된다 */
    const planQty = isStock ? 0 : qty;
    const addRaw  = isStock ? sum((row.addAt || []).map(v => Math.max(0, v || 0))) : 0;
    const addStages = isStock ? clampStages(row.addAt, qty) : [0, 0, 0];
    const addQty  = sum(addStages);
    const soldQty = planQty + addQty;                    // E1 — 판매 확정
    const stockQty = qty - soldQty;                      // 판매 미확정 재고
    const passQty = isPass ? soldQty : 0;                // 고객 전가 — 익스포저 0
    const avgQty  = isPass ? 0 : soldQty;                // 출고월 평균 — 헤지 가능
    const hedgeRaw = row.hedge === 'none'
      ? 0 : sum((row.hedgeAt || []).map(v => Math.max(0, v || 0)));
    const hedgeStages = row.hedge === 'none' ? [0, 0, 0] : clampStages(row.hedgeAt, avgQty);
    const hedgeQty = sum(hedgeStages);                   // H2 — 조치한 물량
    /* 조치는 두 갈래다 — 협상으로 고객에게 넘기거나(운영), 파생으로 막거나(금융) */
    const passShift = row.hedge === 'pass' ? hedgeQty : 0;
    const derivQty  = row.hedge === 'pass' ? 0 : hedgeQty;
    const openQty  = avgQty - hedgeQty;                  // 평균분 중 손대지 않은 물량
    const exp1Qty  = avgQty + stockQty;                  // E1 — H2 를 걸기 전의 Exposure
    const exposureQty = openQty + stockQty;              // E2 — 조치 후 남는 Exposure

    const from = clampWeek(c.shipStart + row.qpShift);
    const to   = clampWeek(c.shipEnd + row.qpShift);
    /* 전가는 매입가를 그대로 판매가에 얹으므로 참조가·QP가 매입가 확정 구간이다.
       재고를 팔아도 판매가는 출고월 평균 하나뿐이라 계약과 같은 QP를 쓴다. */
    const saleQPAvg = isPass ? buyPrice : avg(px.slice(from, to + 1));

    const rawHedgeSum = sum((row.hedgeAt || []).map(v => Math.max(0, v || 0)));
    const warns = [];
    if (addRaw > qty) warns.push('추가 판매가 재고 물량을 넘었다');
    if (hedgeRaw > avgQty) {
      warns.push(isPass ? '이미 전가 조건이라 조치할 물량이 없다'
                        : '조치 물량이 출고월 평균 물량을 넘었다');
    }
    if (row.hedge !== 'none' && hedgeQty === 0) warns.push('수단을 골랐지만 조치 물량이 0이다');
    if (row.hedge === 'none' && rawHedgeSum > 0) warns.push('수단이 무대응이라 조치되지 않는다');
    if (Math.abs(row.qpShift) > 4) warns.push('QP 이동이 ±4주를 넘었다');

    return {
      ...row,
      kindLabel: ROW_KINDS[row.kind] || row.kind,
      condLabel: PRICE_CONDS[row.cond] || row.cond,
      qty, planQty, addQty, addStages, soldQty, stockQty, passQty, avgQty,
      hedgeQty, hedgeStages, passShift, derivQty, openQty, exp1Qty, exposureQty,
      qpRange: isPass ? buyQPLabel : `W${from} ~ W${to}`,
      saleQPAvg,
      warn: warns[0] || '',
      lagAmount: avgQty ? (saleQPAvg - buyPrice) * avgQty : null
    };
  });

  const ledgerKeys = ['qty', 'planQty', 'addQty', 'soldQty', 'stockQty',
                      'passQty', 'avgQty', 'hedgeQty', 'passShift', 'derivQty',
                      'openQty', 'exp1Qty', 'exposureQty'];
  const ledger = ledgerKeys.reduce((o, k) => (o[k] = sum(rows.map(r => r[k])), o), {});
  ledger.ok = !rows.some(r => r.warn);

  /* ---------------- ② Hedge 결과 ----------------
     헤지는 '판매 확정 + 출고월 평균' 물량에만 걸린다. 그중 헤지한 만큼과 남긴 만큼은
     단가 구조가 달라서 한 줄에 섞으면 뜻이 사라진다 — 조각(leg)으로 갈라 계산한다.
     판매 미확정 재고는 여기 오지 않고 저가법 평가(④ 손익)만 받는다. */
  const lcmPerTon = Math.min(0, settlePrice - invUnit);

  /* 조치 시점이 이르면 ⓐ 미헤지 구간(W0~진입)이 짧아진다 — 수단이 아니라 시점의 문제다.
     미헤지 조각은 진입이 없으므로 Rolling 종료(W6)를 기준선으로 삼아 ⓐ/ⓑ 를 가른다. */
  const makeLeg = (row, kind, qty, entryWeek) => {
    const saleRef = row.saleQPAvg;
    const entryPrice = at(entryWeek);
    const unhedgedUnit = entryPrice - buyPrice;
    let unit;
    switch (kind) {
      /* 고객 전가 — 판가조건 자체가 매입가 연동으로 바뀌므로 W0~W6 구간(ⓐ)까지 사라진다.
         파생과 달리 브로커도, 비용도 끼지 않아 모든 칸이 0이다. */
      case 'pass':
        unit = { unhedged: 0, open: 0, mismatch: 0, carry: 0, fee: 0 };
        break;
      case 'forward':
        unit = { unhedged: unhedgedUnit, open: 0, mismatch: 0,
                 carry: carryPerTon, fee: -hp.ibFeeForward };
        break;
      case 'future':
        unit = { unhedged: unhedgedUnit, open: 0, mismatch: saleRef - settlePrice,
                 carry: 0, fee: -hp.ibFeeFuture };
        break;
      default:   // 미헤지 — ⓑ 진입 기준선 이후 구간이 그대로 열려 있다
        unit = { unhedged: unhedgedUnit, open: saleRef - entryPrice, mismatch: 0,
                 carry: 0, fee: 0 };
    }
    const subtotalUnit = unit.unhedged + unit.open + unit.mismatch + unit.carry + unit.fee;
    const legs = ['unhedged', 'open', 'mismatch', 'carry', 'fee']
      .reduce((o, k) => (o[k] = unit[k] * qty, o), {});
    const total = subtotalUnit * qty;
    const noHedge = (saleRef - buyPrice) * qty;     // 가만히 뒀을 때의 같은 물량 손익
    return {
      name: row.name, kind, kindLabel: HEDGE_KINDS[kind].label,
      kindShort: HEDGE_KINDS[kind].short, qty, saleRef, entryWeek, entryPrice,
      unit, subtotalUnit, legs, total, noHedge,
      /* Hedge − 무대응 : 뭘 했더니 가만히 있을 때보다 어떠했나 (미헤지 조각은 0) */
      diff: total - noHedge, opCost: legs.carry + legs.fee
    };
  };

  const hedged = rows.map(row => {
    const parts = [];
    row.hedgeStages.forEach((q, i) => {
      if (q > 0) parts.push(makeLeg(row, row.hedge, q, c.stageWeeks[i]));
    });
    if (row.openQty > 0) parts.push(makeLeg(row, 'none', row.openQty, c.decisionWeek));
    const agg = k => sum(parts.map(p => p[k]));
    const legs = ['unhedged', 'open', 'mismatch', 'carry', 'fee']
      .reduce((o, k) => (o[k] = sum(parts.map(p => p.legs[k])), o), {});
    return {
      name: row.name, kind: row.kind, cond: row.cond, hedge: row.hedge, parts,
      avgQty: row.avgQty, hedgeQty: row.hedgeQty, openQty: row.openQty,
      stockQty: row.stockQty, exposureQty: row.exposureQty,
      saleRef: row.saleQPAvg, lcmUnit: lcmPerTon,
      stockLcm: lcmPerTon * row.stockQty,        // 손익에서 쓰는 재고 평가손실
      noHedge: agg('noHedge'), total: agg('total'), diff: agg('diff'),
      opCost: agg('opCost'), legs, warn: row.warn
    };
  });
  /* ④ 표에 그대로 실리는 조각 목록 — 헤지분 / 미헤지분이 각각 한 줄이 된다 */
  const hedgeLegs = hedged.reduce((a, h) => a.concat(h.parts), []);

  const hedgedTotals = ['avgQty', 'hedgeQty', 'openQty', 'stockQty', 'exposureQty',
                        'noHedge', 'total', 'diff', 'opCost', 'stockLcm']
    .reduce((o, k) => (o[k] = sum(hedged.map(r => r[k])), o), {});
  hedgedTotals.legs = ['unhedged', 'open', 'mismatch', 'carry', 'fee']
    .reduce((o, k) => (o[k] = sum(hedged.map(r => r.legs[k])), o), {});

  /* ---------------- ③ Exposure 대응 일원화 시 (what-if) ----------------
     출고월 평균 물량 전부를 한 수단으로 몰았다면 어떻게 되는가.
     재고 저가법은 헤지와 무관하므로 여기서도 빼고 ④ 손익에서만 다룬다. */
  const benchQty = ledger.avgQty || ledger.exposureQty || t.qty;
  const benchSale = avg(px.slice(c.shipStart, c.shipEnd + 1));

  const cmpCase = (key, label, nature, u) => {
    const legs = {
      unhedged: u.unhedged * benchQty, open: u.open * benchQty,
      mismatch: u.mismatch * benchQty, carry: u.carry * benchQty, fee: u.fee * benchQty
    };
    const subtotalUnit = u.unhedged + u.open + u.mismatch + u.carry + u.fee;
    return { key, label, nature, qty: benchQty, unit: u, subtotalUnit, legs,
             opCost: legs.carry + legs.fee, total: subtotalUnit * benchQty };
  };

  const compare = [
    cmpCase('none', '무대응', '전량 방치', {
      unhedged: decisionPrice - buyPrice, open: benchSale - decisionPrice,
      mismatch: 0, carry: 0, fee: 0
    }),
    /* 현재 ②에서 고른 조합 그대로 — 나머지 세 케이스의 비교 기준점 */
    { key: 'current', label: 'Hedge (현재 설정)', nature: '②에서 고른 조합',
      qty: ledger.avgQty, unit: null,
      subtotalUnit: ledger.avgQty ? hedgedTotals.total / ledger.avgQty : 0,
      legs: hedgedTotals.legs, opCost: hedgedTotals.opCost, total: hedgedTotals.total },
    /* 운영 해법 — 판가조건을 통째로 매입가 연동으로 돌리면 가격 손익 자체가 사라진다 */
    cmpCase('pass', '고객 전가', '전량 가격 조건 협상', {
      unhedged: 0, open: 0, mismatch: 0, carry: 0, fee: 0
    }),
    cmpCase('forward', 'Forward 매도', '전량 OTC 파생', {
      unhedged: decisionPrice - buyPrice, open: 0, mismatch: 0,
      carry: carryPerTon, fee: -hp.ibFeeForward
    }),
    cmpCase('future', 'Future 매도', '전량 거래소 파생', {
      unhedged: decisionPrice - buyPrice, open: 0,
      mismatch: benchSale - settlePrice, carry: 0, fee: -hp.ibFeeFuture
    })
  ];

  /* ---------------- ④ 증거금 Cash Flow — 진입 ~ W12 청산 ----------------
     Future 는 단계별로 나눠 들어갈 수 있다. 주간 손익은 '그 주 시작 시점에
     이미 열려 있던 물량'에만 걸리므로, 진입 주차까지 누적한 물량을 곱한다. */
  const futureLegs = hedgeLegs.filter(l => l.kind === 'future');
  const futureQty = sum(futureLegs.map(l => l.qty));
  const openAt = w => sum(futureLegs.filter(l => l.entryWeek <= w).map(l => l.qty));
  const entryWeeks = futureLegs.map(l => l.entryWeek);
  const startWeek = entryWeeks.length ? Math.min(...entryWeeks) : c.decisionWeek;
  const mtm = [];
  for (let w = startWeek; w <= c.shipEnd; w++) {
    const weekly = w === startWeek ? 0 : (at(w - 1) - at(w)) * openAt(w - 1);
    const prev = mtm.length ? mtm[mtm.length - 1].cum : 0;
    const cum = prev + weekly;
    const added = openAt(w) - openAt(w - 1);
    const tag = w === c.shipEnd ? ' (청산)' : added > 0 ? ` (진입 +${n0i(added)}t)` : '';
    mtm.push({ label: `W${w}${tag}`, week: w, price: at(w), qty: openAt(w),
               weekly, cum, need: Math.max(0, -cum) });
  }
  const maxNeed = mtm.length ? Math.max(...mtm.map(m => m.need)) : 0;
  /* 진입가는 물량 가중평균 — 단계마다 다른 가격에 들어갔기 때문이다 */
  const futureEntry = futureQty
    ? sum(futureLegs.map(l => l.entryPrice * l.qty)) / futureQty : decisionPrice;
  const future = {
    qty: futureQty, entry: futureEntry, exit: settlePrice, startWeek,
    legs: futureLegs.map(l => ({ name: l.name, week: l.entryWeek, qty: l.qty, price: l.entryPrice })),
    initialMargin: sum(futureLegs.map(l => l.entryPrice * l.qty)) * hp.imRatePct / 100,
    rows: mtm, maxNeed,
    breached: maxNeed > hp.cashLimit,
    headroom: hp.cashLimit - maxNeed,
    peakWeek: mtm.length ? mtm.reduce((a, b) => (b.need > a.need ? b : a), mtm[0]).week : startWeek
  };

  /* ---------------- ④ 손익 (P&L) ----------------
     매출·재료비는 판매 확정된 물량(고객 전가 + 출고월 평균)만 계상한다.
     판매 미확정 재고는 매출이 없고 저가법 평가만 Hedge 효과 행에 들어간다. */
  const pnl = rows.map((row, i) => {
    const h = hedged[i];
    /* 전가 행은 참조가가 매입가라 두 조건을 한 줄로 쓸 수 있다 */
    const soldQty = row.soldQty;
    const revenue = soldQty * (row.saleQPAvg + t.procMargin);
    const material = -soldQty * buyPrice;
    const margin = revenue + material;
    /* 재고 저가법 — 헤지 선택과 무관하게 발생하므로 무대응·Hedge 양쪽에 똑같이 들어간다 */
    const stockLcm = h.stockLcm;
    /* 헤지를 '실행하는 데' 든 값은 가격 상쇄 효과와 성격이 다르므로 따로 세운다.
       carryCost(가격에 내재) + ibFee(명시 청구) = ④의 Hedge Operation 비용과 같은 값. */
    const carryCost = h.legs.carry;                 // 보유비용 · 스프레드 (음수)
    const ibFee = h.legs.fee;                       // 브로커 수수료 (음수)
    const opCost = carryCost + ibFee;
    const hedgeGain = h.diff;                       // Hedge − 무대응
    const hedgeEffect = hedgeGain - opCost;         // 순수 가격 상쇄 효과
    const plNoHedge = margin + stockLcm;
    const plHedged = plNoHedge + hedgeGain;

    /* 메모 — '결국 얼마에 판 셈인가'. 가격이 걸려 있던 물량(출고월 평균분)에 대해서만 뜻이 있다.
       손익표와 어긋나지 않도록 Hedge − 무대응을 그 물량으로 나눠 단가로 환산한다. */
    const hedgeUnit = row.avgQty ? hedgeGain / row.avgQty : null;
    const realizedUnit = row.avgQty ? row.saleQPAvg + hedgeUnit : null;

    return {
      name: row.name, kind: row.kind, cond: row.cond, hedge: row.hedge,
      revenue, material, margin,
      procMargin: t.procMargin * soldQty,
      priceMargin: row.avgQty * (row.saleQPAvg - buyPrice),
      stockLcm, hedgeEffect, opCost, carryCost, ibFee,
      plNoHedge, hedgeDelta: hedgeGain, plHedged, delta: plHedged - plNoHedge,
      avgQty: row.avgQty, refUnit: row.avgQty ? row.saleQPAvg : null,
      hedgeUnit, realizedUnit
    };
  });
  const pnlKeys = ['revenue', 'material', 'margin', 'procMargin', 'priceMargin', 'stockLcm',
                   'hedgeEffect', 'opCost', 'carryCost', 'ibFee',
                   'plNoHedge', 'hedgeDelta', 'plHedged', 'delta'];
  const pnlTotal = { name: '합계' };
  pnlKeys.forEach(k => { pnlTotal[k] = sum(pnl.map(r => r[k])); });
  /* 단가 메모의 합계는 물량 가중평균 — 단순 합산하면 뜻이 없다 */
  const memoQty = sum(pnl.map(r => r.avgQty));
  pnlTotal.avgQty = memoQty;
  pnlTotal.refUnit = memoQty ? sum(pnl.map(r => (r.refUnit || 0) * r.avgQty)) / memoQty : null;
  pnlTotal.hedgeUnit = memoQty ? hedgedTotals.diff / memoQty : null;
  pnlTotal.realizedUnit = memoQty ? pnlTotal.refUnit + pnlTotal.hedgeUnit : null;

  return {
    terms: c, px, at,
    buyPrice, buyLabel, buySpot, buyAvg, decisionPrice, settlePrice,
    invBaseQty, invUnit,
    fwdInterest, fwdTheory, fwdFixed, carryPerTon, carryGross, hedgeMonths, lcmPerTon,
    rows, ledger, hedged, hedgeLegs, hedgedTotals, compare, benchQty, benchSale,
    future, pnl, pnlTotal, pnlKeys
  };
}

/* ------------------------------ 참고 자료 -------------------------------- */
const REF_UNIT = {
  headline: '니켈 1톤 → 황산니켈 결정(NiSO₄·6H₂O) 약 4.4~4.5톤',
  rows: [
    ['NiSO₄·6H₂O 분자량', '262.85 g/mol (Ni 58.69 + S 32.06 + O₄ 64.00 + 6H₂O 108.09)'],
    ['Ni 함량', '58.69 / 262.85 = 22.3%'],
    ['이론 산출량', '1 ÷ 0.223 = 4.48톤'],
    ['실수율 97~98% 반영', '약 4.35~4.40톤']
  ],
  notes: [
    '무수물(NiSO₄, 분자량 154.75, Ni 37.9%) 기준이면 2.64톤이지만, 상업 거래되는 배터리급 황산니켈은 거의 전부 육수화물 결정이라 4.4톤대로 보면 된다.',
    '모델과의 연결 — 이 모델은 “니켈 함량 100톤” 기준으로 단순화한다. 실제 물류를 반영하면 환산 계수 4.4가 필요하지만, Ni 함량 톤으로 통일하는 편이 Hedge와 직결되고 Ni이 황산니켈 가격을 좌우한다.'
  ]
};

const REF_SHIPPING = [
  ['수라바야 (동자바)', '약 7일 18시간, 주 2~4회 운항', '인니 최단'],
  ['자카르타', '약 12일', '정기 컨테이너'],
  ['모로왈리 · 웨다베이 (술라웨시 · 북말루쿠)', '통상 10~14일',
   '실제 제련 허브. 2026년 상반기 인니 니켈광 수입의 60.7%가 웨다로 반입될 만큼 가공 집중지'],
  ['필리핀 (팔라완 · 수리가오)', '통상 7~10일', '거리상 최단권']
];

const GLOSSARY = [
  ['QP', 'Quotational Period', '가격 결정 기간. 계약 가격을 특정 기간의 시장가 평균으로 확정하는 구간. 본 모델: 판매 QP = 출고월 4주 (W9~W12), ±4주 이동 가능'],
  ['Exposure', 'Price Exposure', '가격 변동에 손익이 노출된 물량·기간. 본 모델의 3계층: 없음(전가) / 시차(평균) / 완전(재고)'],
  ['Basis', 'Basis Exposure', '운영 조치를 하기 전의 초기 익스포저 총량. Rolling 축소 프로세스의 출발점'],
  ['Netting', 'Netting', '매입·매출 포지션을 상계하여 순노출만 남기는 것. 헤지에 앞서는 1차 리스크 축소 수단'],
  ['전가', 'Price Pass-through', '매입가를 그대로 판매가에 반영해 가격 리스크를 고객에게 이전하는 가격 조건. 익스포저 = 0'],
  ['Natural Hedge', 'Natural Hedge', '파생상품을 쓰지 않고 사업·계약 구조 자체로 노출을 상쇄하는 것. 본 모델에서는 매입가 연동(고객 전가)이 여기 해당하며 현황판의 H1이다. 계약 체결 후 협상으로 조건을 바꾸면 사후 Natural Hedge로 H2에 잡힌다. 브로커도 비용도 끼지 않고 매입 시점부터의 변동까지 함께 넘어가므로 ⓐ 미헤지 구간도 남지 않는다'],
  ['Hedge', 'Hedge', '가격 리스크를 파생상품 등 반대 포지션으로 상쇄하는 행위. 운영적 해법 이후의 잔여 익스포저에만 적용이 원칙'],
  ['Futures', 'Futures Contract', '거래소 표준화 선물. 매일 시가평가·변동증거금 정산. 청산소가 중앙 상대방이라 신용리스크는 없으나 유동성 리스크(마진콜)를 부담. 회원 자격·자본·인프라 요건 때문에 일반 기업은 IB를 통한 간접 거래를 선호'],
  ['Forward', 'Forward Contract', '장외(OTC) 1:1 선도 계약. 만기 일괄 정산, 품질·수량·만기 자유 설계. 상대방 신용리스크를 부담. IB는 반대 방향 LME 선물로 되헤지하지만, Forward는 만기 일괄·LME 선물은 매일 정산이라는 시차 때문에 마진콜을 자기 자본으로 부담한다. 이 유동성 갭이 스프레드의 핵심 원가'],
  ['Contango', 'Contango', '선도가격 > 현물가격인 커브 상태 (보유비용 반영, 정상 시장). 본 시뮬레이션에서는 완만한 상승 경로'],
  ['Backwardation', 'Backwardation', '선도가격 < 현물가격인 커브 상태 (현물 품귀). 본 시뮬레이션에서는 급등 후 완화 경로'],
  ['Fluctuation', 'Fluctuation', '뚜렷한 추세 없이 등락을 반복하는 시황. 본 시뮬레이션 경로 중 하나'],
  ['적기공급 프리미엄', 'Convenience Yield', '실물을 지금 당장 보유하는 것의 가치. 백워데이션(커브 역전)의 원인. 편의수익이라고도 함'],
  ['보유비용', 'Cost of Carry', '현물 보유에 드는 금융이자 + 창고·보험료. 이론 선도가격 = 현물 + 보유비용 − 적기공급 프리미엄'],
  ['Forward spread', 'Forward Spread', 'Forward를 고른 대가로 A가 실제로 깎이는 단가 = −(적기공급 프리미엄 + 브로커 스프레드). 보유비용(이자·창고)은 선도가가 그만큼 보상해 순효과가 0이라 빼고 센다. 손익표의 ⓓ 항목'],
  ['개시증거금', 'Initial Margin (IM)', '선물 포지션 개설 시 청산소에 예치하는 담보. 본 모델에서는 잔고를 이 금액으로 고정'],
  ['변동증거금', 'Variation Margin (VM)', '일일 시가평가 손익만큼 매일 납부(손실)/환급(이익)되는 현금. 마진콜의 실체'],
  ['마진콜', 'Margin Call', '증거금 부족분에 대한 납부 요구. 기한 내 미납 시 브로커가 강제청산'],
  ['시가평가', 'Mark-to-Market (MTM)', '포지션을 매일 그날의 시장가로 재평가하여 손익을 확정하는 절차'],
  ['숏 / 롱', 'Short / Long Position', '매도 포지션(가격 하락 시 이익) / 매수 포지션(가격 상승 시 이익)'],
  ['숏 스퀴즈', 'Short Squeeze', '숏 강제청산 매수가 가격을 밀어올려 다른 숏의 손실·마진콜을 재확대시키는 악순환 (2022년 LME 니켈 사태)'],
  ['Back-to-back', 'Back-to-back Hedge', '실물 계약과 동일 물량·조건의 반대 파생 포지션을 즉시 체결하는 헤지. IB가 선도 리스크를 중립화하는 방식'],
  ['FOB', 'Free On Board', '본선 인도 조건. 선적 시점에 위험과 비용이 매수인에게 이전. 본 모델에서는 매출가 확정 시점'],
  ['Stub', 'Stub Exposure', '사업 개시·종료(또는 급격한 증감산) 시점에 rolling 상쇄 상대가 없어 구조적으로 남는 잔여 익스포저'],
  ['Rolling', 'Rolling', '월별 계약 반복으로 시차 익스포저를 상쇄하고, 외부 변수 발생 시 조치 원장에 행을 추가하며 갱신하는 운영 방식'],
  ['스프레드', 'Dealer Spread', 'IB가 시장 커브 가격에 얹는 자기 몫 (신용·실행·자본 비용 + 이윤). 선도 헤지에서 유일하게 협상 가능한 비용'],
  ['LME', 'London Metal Exchange', '런던금속거래소. 니켈 등 비철금속 선물의 글로벌 기준 시장. 인도 가능 품목은 Class 1 정련 니켈'],
  ['저가법', 'Lower of Cost or Market (LCM)', '재고를 원가와 시가 중 낮은 값으로 평가하는 보수주의 원칙 — 평가손실만 인식하고 평가이익은 인식하지 않는다. 본 모델: MIN(0, 출고월말 가격 − 재고 단가)'],
  ['이동평균법', 'Moving Average Cost', '신규 매입이 있을 때마다 기존 재고와 가중평균하여 재고 단가를 갱신하는 원가 계산법'],
  ['Standstill', 'Standstill Agreement', '채권단이 마진콜 등 지급 요구를 일시 유예해 주는 합의. 칭산그룹이 강제청산을 피한 수단']
];
