/* ===========================================================================
   model.js — 니켈 헤지 Simulation 모델의 계산 엔진
   nickel_hedge_cases_v10.xlsx 를 4개 탭(개요 / 거래조건 / Hedge 손익 / 참고)으로
   단순화한 구조. 상태(state)를 받아 파생값을 계산할 뿐 DOM은 건드리지 않는다.

   타임라인
     W0                       매입가 확정 — 가격 익스포저 시작
     W0 ~ W2   구매·운송      ┐
     W2 ~ W6   생산           ├ 미헤지 노출 구간
     W6 ~ W8   출고준비       ┘
       W2 / W4 / W6           Rolling 조치 3단계
       W6                     Rolling 종료 → 잔여 Exposure 확정 → Hedge 진입
     W9 ~ W12  출고월         판매가 = 출고월 4주 평균 — 익스포저 종료 · 정산
   =========================================================================== */

const MAX_WEEK = 20;                      // 시나리오 가격표가 보유한 마지막 주차
const WEEKS = MAX_WEEK + 1;

const SCENARIOS = ['Contango', 'Backwardation', 'Fluctuation'];

/* 가격 조건 — 내부 값은 그대로 두고 화면·엑셀 표기만 풀어 쓴다.
   재고는 '가격 옵션'이 아니라 판매 미확정 상태다. 재고의 판매가는 출고월 평균 하나뿐이라
   가격을 고를 여지가 없고, 판매가 확정되면 그때 출고월 평균 계약으로 넘어간다. */
const PRICE_CONDITIONS = ['전가', '평균', '재고'];
const COND_LABEL = { '전가': '고객 전가', '평균': '출고월 평균', '재고': '재고 (판매 미확정)' };
/* 익스포저 계수 — 전가는 가격 리스크를 고객에게 넘기므로 0 */
const COND_EXPOSED = { '전가': 0, '평균': 1, '재고': 1 };
/* 헤지 가능 여부 — 판매가 확정되지 않은 재고는 헤지하지 않는다 (0을 상수로 막을 수 없다) */
const COND_HEDGEABLE = { '전가': false, '평균': true, '재고': false };
/* 조치로 전환 가능한 목적지 — 재고로 되돌리는 조치는 없다 */
const CONVERT_TARGETS = ['전가', '평균'];

/* 잔여 익스포저 대응 4종. 저가법은 헤지 수단이 아니라 회계 인식 방법이지만,
   '잔여 익스포저를 어떻게 다룰 것인가'라는 같은 질문에 대한 네 번째 답이라 함께 세운다. */
const HEDGE_KINDS = {
  none:    { label: '무대응',       short: '무대응',  nature: '방치' },
  forward: { label: 'Forward 매도', short: 'Forward', nature: 'OTC 파생' },
  future:  { label: 'Future 매도',  short: 'Future',  nature: '거래소 파생' },
  lcm:     { label: '저가법 평가',   short: '저가법',  nature: '회계 인식' }
};
/* 실제로 고를 수 있는 Hedge 대책은 셋뿐이다.
   저가법은 '헤지 수단'이 아니라 판매 미확정 재고에 자동으로 걸리는 회계 처리라
   Hedge 결과가 아니라 손익에서 다룬다 (개요 탭 매트릭스에는 비교 대상으로 남겨 둔다). */
const HEDGE_ORDER = ['none', 'forward', 'future'];

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
    /* Basis 원장 + Rolling + Hedge 선택이 한 행에 모인 통합 원장 */
    book: [
      { name: '계약 C1', qty: 40, cond: '전가', qpShift: 0, hedge: 'none',    actual: 0 },
      { name: '계약 C2', qty: 40, cond: '평균', qpShift: 0, hedge: 'none',    actual: 0 },
      { name: '계약 C3', qty: 20, cond: '평균', qpShift: 0, hedge: 'forward', actual: 0 },
      { name: '계약 C4', qty: 20, cond: '평균', qpShift: 0, hedge: 'future',  actual: 0 },
      /* 재고는 판매 확정분만 헤지 대상이 된다. 남은 재고는 대책과 무관하게 저가법 평가. */
      { name: '재고 S1', qty: 50, cond: '재고', qpShift: 0, hedge: 'none',    actual: 0 }
    ],
    /* 화면·엑셀에 그대로 실리는 사용자 문장. 계산에는 쓰이지 않는다. */
    notes: {
      /* ⑤ 손익표 바로 위에 붙는 한 줄 — 이 표에서 무엇을 읽어야 하는지 먼저 말한다 */
      pnlLead: '헤지는 손익의 크기를 줄이는 것이 아니라, 폭을 좁히는 대가로 Operation 비용을 내는 선택이다.'
    },
    /* 조치 = 초기 가격 조건에 묶인 물량 일부를 다른 가격 조건으로 옮기는 것 */
    actions: [
      { stage: 1, status: '확정', target: '재고 S1', qty: 20, toCond: '평균',
        note: '추가 판매 — 20톤 고객 확정 (재고 → 출고월 평균 계약)' },
      { stage: 2, status: '확정', target: '계약 C3', qty: 10, toCond: '전가',
        note: '가격 조건 협상 — 20톤 중 10톤을 고객 전가로 전환' }
    ]
  };
}

/* ------------------------------- helpers -------------------------------- */
const sum = a => a.reduce((s, v) => s + v, 0);
const avg = a => (a.length ? sum(a) / a.length : 0);
const clampWeek = w => Math.max(0, Math.min(MAX_WEEK, Math.round(w)));

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

  const decisionPrice = at(c.decisionWeek);
  const settlePrice   = at(c.shipEnd);

  /* 재고 단가 — 이동평균 */
  const invBaseQty = sum(state.book.filter(r => r.cond === '재고').map(r => r.qty));
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
     각 행은 '초기 가격 조건'으로 시작하고, 확정된 조치가 그 물량 일부를
     다른 가격 조건으로 옮긴다. 그래서 한 행이 여러 조건의 조각(segment)으로 나뉜다.
       고객 전가   → 익스포저 0            (가격 리스크를 고객이 진다)
       출고월 평균 → 익스포저 유지 · 헤지 가능
       재고        → 익스포저 유지 · 헤지 불가 (판매 미확정 → 저가법 평가 대상) */
  const segmentsAt = (row, stage) => {
    const settled = state.actions.filter(a =>
      a.target === row.name && Number(a.stage) <= stage && a.status === '확정');
    const moved = sum(settled.map(a => a.qty));
    const segs = [{ cond: row.cond, qty: row.qty - moved }];
    settled.forEach(a => segs.push({ cond: a.toCond || '전가', qty: a.qty }));
    return segs;
  };
  const exposedOf   = segs => sum(segs.map(s => s.qty * (COND_EXPOSED[s.cond] || 0)));
  const hedgeableOf = segs => sum(segs.map(s => (COND_HEDGEABLE[s.cond] ? s.qty : 0)));

  const rows = state.book.map(row => {
    const from = clampWeek(c.shipStart + row.qpShift);
    const to   = clampWeek(c.shipEnd + row.qpShift);
    /* 재고의 판매가도 출고월 평균 하나뿐이다 — 판매 확정 시 그대로 이어진다 */
    const saleQPAvg = row.cond === '전가' ? buyPrice : avg(px.slice(from, to + 1));
    const basisQty = row.qty * (COND_EXPOSED[row.cond] || 0);

    const stages = c.stageWeeks.map((week, i) => {
      const stage = i + 1;
      const proposed = sum(state.actions
        .filter(a => a.target === row.name && Number(a.stage) === stage).map(a => a.qty));
      const segs = segmentsAt(row, stage);
      return { stage, week, proposed, segments: segs,
               result: exposedOf(segs), hedgeable: hedgeableOf(segs),
               overshoot: segs[0].qty < 0 };
    });
    const finalSegs = stages.length
      ? stages[stages.length - 1].segments
      : [{ cond: row.cond, qty: row.qty }];
    const qtyOf = cond => sum(finalSegs.filter(s => s.cond === cond).map(s => s.qty));
    const passQty  = qtyOf('전가');   // 고객 전가 — 판매되었고 익스포저 0
    const hedgeQty = qtyOf('평균');   // 출고월 평균 — 판매 확정, 헤지 대상
    const stockQty = qtyOf('재고');   // 판매 미확정 — 저가법 평가만
    const exposedQty = hedgeQty + stockQty;

    return {
      ...row,
      condLabel: COND_LABEL[row.cond] || row.cond,
      qpRange: `W${from} ~ W${to}`,
      saleQPAvg, basisQty, stages, finalSegs,
      passQty, hedgeQty, stockQty, exposedQty,
      qtyLeft: exposedQty,
      lagAmount: row.cond === '전가' ? null : (saleQPAvg - buyPrice) * row.qty
    };
  });

  const ledger = {
    basis: sum(rows.map(r => r.basisQty)),
    stages: c.stageWeeks.map((week, i) => ({
      week,
      proposed: sum(rows.map(r => r.stages[i].proposed)),
      result: sum(rows.map(r => r.stages[i].result))
    })),
    residual: sum(rows.map(r => r.exposedQty)),
    hedgeTargetQty: sum(rows.map(r => r.hedgeQty)),
    stockQty: sum(rows.map(r => r.stockQty)),
    qpShiftOk: !rows.some(r => Math.abs(r.qpShift) > 4),
    noNegative: !rows.some(r => r.stages.some(s => s.overshoot))
  };
  ledger.removedByOps = ledger.basis - ledger.residual;

  /* ---------------- ② 잔여 Exposure — 4속성 대응 ---------------- */
  const lcmPerTon = Math.min(0, settlePrice - invUnit);
  const hedged = rows.map(row => {
    /* 헤지 대책은 '판매 확정 + 출고월 평균' 물량에만 적용된다.
       판매 미확정으로 남은 재고 물량은 저가법 평가만 받는다. */
    const q = row.hedgeQty;
    const sq = row.stockQty;
    const saleRef = row.saleQPAvg;

    /* 무대응 예상 손익 — 헤지 대상 물량 기준. 재고는 매출이 없어 0 (미실현 방치). */
    const noHedge = (saleRef - buyPrice) * q;

    /* ⓐ~ⓓ · ⓕ 는 전부 $/t — Hedge 대상 물량을 곱해야 금액이 된다.
       ⓔ 만 재고 물량에 걸리므로 곱할 물량(lcmQty)을 따로 들고 다닌다. */
    const unhedgedUnit = decisionPrice - buyPrice;   // ⓐ W0~W6 미헤지 구간
    const openUnit     = saleRef - decisionPrice;    // ⓑ W6~W12 노출 (무대응만)
    const mismatchUnit = saleRef - settlePrice;      // ⓒ QP 미스매치 (Future)

    let unit, derivative, feePerTon = 0, warn = '';
    switch (row.hedge) {
      case 'forward':
        feePerTon = hp.ibFeeForward;
        unit = { unhedged: unhedgedUnit, open: 0, mismatch: 0, carry: carryPerTon, fee: -feePerTon };
        derivative = (fwdFixed - saleRef) * q;
        break;
      case 'future':
        feePerTon = hp.ibFeeFuture;
        unit = { unhedged: unhedgedUnit, open: 0, mismatch: mismatchUnit, carry: 0, fee: -feePerTon };
        derivative = (decisionPrice - settlePrice) * q;
        break;
      default:
        unit = { unhedged: unhedgedUnit, open: openUnit, mismatch: 0, carry: 0, fee: 0 };
        derivative = 0;
    }
    const subtotalUnit = unit.unhedged + unit.open + unit.mismatch + unit.carry + unit.fee;
    /* 저가법 평가는 헤지가 한 일이 아니다 — Hedge 손익에서 빼고 손익(⑤)에서만 계상한다.
       여기 넣으면 아무것도 안 한 재고 행의 '차이'에 평가손실이 얹혀 버린다. */
    const total = subtotalUnit * q;
    const legs = {
      unhedged: unit.unhedged * q, open: unit.open * q, mismatch: unit.mismatch * q,
      carry: unit.carry * q, fee: unit.fee * q
    };
    /* Hedge Operation 비용 — 헤지를 '실행하는 데' 든 값. 나머지는 마진변동손익이다. */
    const opCost = legs.carry + legs.fee;
    const stockLcm = lcmPerTon * sq;      // 손익에서 쓰는 재고 평가손실

    if (q === 0 && sq === 0 && row.hedge !== 'none') {
      warn = '익스포저가 0이라 헤지할 대상이 없다';
    } else if (q === 0 && sq > 0 && row.hedge !== 'none') {
      warn = '판매 미확정 재고뿐 — 헤지하면 반대 방향 투기 포지션이 된다';
    }

    return {
      name: row.name, cond: row.cond, condLabel: row.condLabel, hedge: row.hedge,
      qtyLeft: row.exposedQty, hedgeQty: q, stockQty: sq,
      saleRef, unit, subtotalUnit, lcmUnit: lcmPerTon, stockLcm,
      noHedge, derivative, total, opCost,
      /* Hedge − 무대응 : 뭘 했더니 가만히 있을 때보다 어떠했나 */
      diff: total - noHedge,
      legs, feePerTon, ibFee: legs.fee, warn,
      actual: row.actual, actualDiff: row.actual - total
    };
  });

  const hedgedTotals = ['qtyLeft', 'hedgeQty', 'stockQty', 'noHedge', 'derivative',
                        'total', 'diff', 'opCost', 'stockLcm', 'ibFee', 'actual', 'actualDiff']
    .reduce((o, k) => (o[k] = sum(hedged.map(r => r[k])), o), {});
  hedgedTotals.legs = ['unhedged', 'open', 'mismatch', 'carry', 'fee']
    .reduce((o, k) => (o[k] = sum(hedged.map(r => r.legs[k])), o), {});

  /* ---------------- ③ Exposure 대응 일원화 시 (what-if) ----------------
     Hedge 대상 전량을 한 수단으로 몰았다면 어떻게 되는가.
     재고 저가법은 헤지와 무관하므로 여기서도 빼고 ⑤ 손익에서만 다룬다. */
  const benchQty = ledger.hedgeTargetQty || ledger.residual || t.qty;
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
      qty: ledger.hedgeTargetQty, unit: null,
      subtotalUnit: ledger.hedgeTargetQty ? hedgedTotals.total / ledger.hedgeTargetQty : 0,
      legs: hedgedTotals.legs, opCost: hedgedTotals.opCost, total: hedgedTotals.total },
    cmpCase('forward', 'Forward 매도', '전량 OTC 파생', {
      unhedged: decisionPrice - buyPrice, open: 0, mismatch: 0,
      carry: carryPerTon, fee: -hp.ibFeeForward
    }),
    cmpCase('future', 'Future 매도', '전량 거래소 파생', {
      unhedged: decisionPrice - buyPrice, open: 0,
      mismatch: benchSale - settlePrice, carry: 0, fee: -hp.ibFeeFuture
    })
  ];

  /* ---------------- ④ 증거금 Cash Flow — W6 진입 ~ W12 청산 ---------------- */
  const futureQty = sum(hedged.filter(r => r.hedge === 'future').map(r => r.hedgeQty));
  const mtmQty = futureQty || benchQty;
  const mtm = [];
  for (let w = c.decisionWeek; w <= c.shipEnd; w++) {
    const weekly = w === c.decisionWeek ? 0 : (at(w - 1) - at(w)) * mtmQty;
    const prev = mtm.length ? mtm[mtm.length - 1].cum : 0;
    const cum = prev + weekly;
    mtm.push({
      label: w === c.decisionWeek ? `W${w} (진입)` : w === c.shipEnd ? `W${w} (청산)` : `W${w}`,
      week: w, price: at(w), weekly, cum, need: Math.max(0, -cum)
    });
  }
  const maxNeed = mtm.length ? Math.max(...mtm.map(m => m.need)) : 0;
  const future = {
    qty: mtmQty, entry: decisionPrice, exit: settlePrice,
    initialMargin: decisionPrice * mtmQty * hp.imRatePct / 100,
    rows: mtm, maxNeed,
    breached: maxNeed > hp.cashLimit,
    headroom: hp.cashLimit - maxNeed,
    peakWeek: mtm.length ? mtm.reduce((a, b) => (b.need > a.need ? b : a), mtm[0]).week : c.decisionWeek
  };

  /* ---------------- ⑤ 손익 (P&L) ----------------
     매출·재료비는 판매 확정된 물량(고객 전가 + 출고월 평균)만 계상한다.
     판매 미확정 재고는 매출이 없고 저가법 평가만 Hedge 효과 행에 들어간다. */
  const pnl = rows.map((row, i) => {
    const h = hedged[i];
    const soldQty = row.passQty + row.hedgeQty;
    const revenue = row.passQty * (buyPrice + t.procMargin)
                  + row.hedgeQty * (row.saleQPAvg + t.procMargin);
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

    /* 메모 — '결국 얼마에 판 셈인가'. 가격이 걸려 있던 물량(Hedge 대상)에 대해서만 뜻이 있다.
       손익표와 어긋나지 않도록 Hedge − 무대응을 그 물량으로 나눠 단가로 환산한다. */
    const hedgeUnit = row.hedgeQty ? hedgeGain / row.hedgeQty : null;
    const realizedUnit = row.hedgeQty ? row.saleQPAvg + hedgeUnit : null;

    return {
      name: row.name, cond: row.cond, hedge: row.hedge,
      revenue, material, margin,
      procMargin: t.procMargin * soldQty,
      priceMargin: row.hedgeQty * (row.saleQPAvg - buyPrice),
      stockLcm, hedgeEffect, opCost, carryCost, ibFee,
      plNoHedge, hedgeDelta: hedgeGain, plHedged, delta: plHedged - plNoHedge,
      hedgeQty: row.hedgeQty, refUnit: row.hedgeQty ? row.saleQPAvg : null,
      hedgeUnit, realizedUnit
    };
  });
  const pnlKeys = ['revenue', 'material', 'margin', 'procMargin', 'priceMargin', 'stockLcm',
                   'hedgeEffect', 'opCost', 'carryCost', 'ibFee',
                   'plNoHedge', 'hedgeDelta', 'plHedged', 'delta'];
  const pnlTotal = { name: '합계' };
  pnlKeys.forEach(k => { pnlTotal[k] = sum(pnl.map(r => r[k])); });
  /* 단가 메모의 합계는 물량 가중평균 — 단순 합산하면 뜻이 없다 */
  const memoQty = sum(pnl.map(r => r.hedgeQty));
  pnlTotal.hedgeQty = memoQty;
  pnlTotal.refUnit = memoQty ? sum(pnl.map(r => (r.refUnit || 0) * r.hedgeQty)) / memoQty : null;
  pnlTotal.hedgeUnit = memoQty ? hedgedTotals.diff / memoQty : null;
  pnlTotal.realizedUnit = memoQty ? pnlTotal.refUnit + pnlTotal.hedgeUnit : null;

  return {
    terms: c, px, at,
    buyPrice, buyLabel, buySpot, buyAvg, decisionPrice, settlePrice,
    invBaseQty, invUnit,
    fwdInterest, fwdTheory, fwdFixed, carryPerTon, carryGross, hedgeMonths, lcmPerTon,
    rows, ledger, hedged, hedgedTotals, compare, benchQty, benchSale,
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
