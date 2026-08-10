/* ===========================================================================
   export.js — 현재 상태를 수식이 살아 있는 .xlsx 로 내보낸다.

   값만 덤프하지 않고 원본 워크북처럼 셀 주소를 설계해서 수식을 쓴다.
   받은 엑셀에서 파란 칸을 고치면 그 안에서 재계산된다.
   시트: 개요 / 거래조건 / Hedge손익 / 참고
   =========================================================================== */

const SH_TERMS = '거래조건';
const SH_HEDGE = 'Hedge손익';

/* 열 번호 → 이름 (xlsx.js 의 colName 재사용) */
const C_ = n => colName(n);

function buildWorkbook(state) {
  const m = computeModel(state);
  const wb = new Workbook();

  buildOverview(wb, m);
  const T = buildTerms(wb, state, m);
  buildHedge(wb, state, m, T);
  buildRef(wb);

  return wb;
}

/* ------------------------------- ① 개요 ---------------------------------- */
function buildOverview(wb, m) {
  const c = m.terms;
  /* C열은 설명이 길어 넉넉히 (요청: 70) */
  const sh = wb.sheet('개요', [24, 70]);
  let r = 2;
  const head = t => { sh.set(`B${r}`, { v: t, s: S.section }); sh.set(`C${r}`, { v: '', s: S.section }); r += 1; };
  const kv = (k, v) => { sh.row(`B${r}`, [{ v: k, s: S.bold }, { v, s: S.wrap }]); r += 1; };

  sh.set(`B${r}`, { v: '니켈 Simulation 모델 — 익스포저 대응 수단: 무대응, Forward 매도, Future 매도, 저가법 평가', s: S.title }); r += 2;
  sh.set(`B${r}`, { v: `타임라인: W0 매입가 확정 → 구매·운송 ${c.transportEnd}주 → 생산 → 출고준비 → 출고월 W${c.shipStart}~W${c.shipEnd} 정산`, s: S.muted }); r += 2;

  head('Player');
  kv('A Company', '황산니켈 생산업체. 니켈 100톤을 구매·가공하여 황산니켈로 판매 (니켈 함량 100톤 기준으로 단순화)');
  kv('Cathode', '양극재 생산업체(고객). 황산니켈을 ‘인도 시점 니켈 시장가 + 가공마진’ 조건으로 구매');
  kv('IB (브로커)', '선물: A의 주문을 LME에 중개, 변동증거금 관리. 선도: A와 1:1 고정가 계약 후 자기 리스크를 LME에 되헤지');
  kv('LME 정산소', '선물 포지션을 매일 시가평가하여 이익/손실 현금 정산 (본 모델은 주 단위로 단순화)');
  r += 1;

  head('핵심 프레임');
  kv('마진 분해', '마진 = 가공마진(상수, A Company 제조 이익) + 가격변동마진(변수). 헤지는 가격변동마진에 대한 의사결정.');
  kv('증거금', '증거금 잔고는 개시증거금으로 고정. 주간 손실 = 당주 납부(−), 주간 이익 = 당주 환급(+). 따라서 누적 선물 손익 = 누적 순현금흐름.');
  kv('헤지 전략(가정)', `Rolling을 통한 운영 우선, 잔여 익스포저만 Hedge. 따라서 Hedge 진입시점은 Rolling이 끝나는 W${c.decisionWeek}`);
  r += 1;

  head('익스포저 대응 수단: 무대응, Forward 매도, Future 매도, 저가법 평가');
  const matrix = [
    ['속성', '무대응', 'Forward 매도', 'Future 매도', '저가법 평가'],
    ['성격', '익스포저 방치', 'OTC(Over-the-Counter, 장외) 1:1 파생', '거래소 표준 파생', '회계 인식 (헤지 아님)'],
    ['적용 대상', '전부', '판매 확정 + QP 매칭 가능', '판매 확정 (QP 불일치 감수)', '판매 미확정 재고'],
    ['가격 확정', '없음', '계약 시 고정가', '진입가 고정', '없음'],
    ['정산 시점', '출고월', '만기 일괄 (출고월)', '매일 MTM(Mark-to-Market, 시가평가) → 출고월 청산', '결산 시점'],
    ['증거금', '없음', '없음', '변동증거금 = 마진콜', '없음'],
    ['상쇄 정확도', '–', '완전 (QP 매칭)', '부분 — 평균 vs 단일시점', '–'],
    ['숨은 비용', '–', '브로커 스프레드 (고정가에 내재)', '–', '–'],
    ['명시 비용', '–', '브로커 수수료', '브로커 수수료 + 개시증거금', '–'],
    ['우발 risk', '–', '거래상대방 신용리스크 — 브로커 부도 시 계약 이행 불가',
     '유동성 리스크 — 신용은 정산소가 흡수 · 마진콜은 자기 부담', '–'],
    ['가격변동손익', '흡수', '제거', '일정기간 제거 · 미스매치 잔존', '손실만 조기 인식']
  ];
  /* B(항목), C(설명 — 요청대로 70), 이후는 4속성 매트릭스가 쓰는 열 */
  sh.widths = [24, 70, 32, 34, 26];
  matrix.forEach((row, i) => {
    sh.row(`B${r}`, row.map(v => ({ v, s: i === 0 ? S.header : S.wrap })));
    r += 1;
  });
  r += 1;
  /* 웹 화면에는 페이지 하단에 같은 문구가 늘 떠 있지만 워크북은 혼자 돌아다니므로 남긴다 */
  sh.set(`B${r}`, { v: '주의: 모든 숫자는 Simulation용 가상 값이다.', s: S.muted });
}

/* ----------------------------- ② 거래조건 -------------------------------- */
function buildTerms(wb, state, m) {
  const t = state.terms;
  /* B 항목 · C 값 · D 설명 · E 구간 (기본) · F 가격 · G 내용 */
  const sh = wb.sheet(SH_TERMS, [30, 16, 60, null, 30, 45]);
  const T = {};
  let r = 2;

  sh.set(`B${r}`, { v: '거래조건 — 구매 · 운송 · 생산 · 출고준비 · 출고월', s: S.title }); r += 2;

  sh.set(`B${r}`, { v: '입력 (파란 칸 = 수정 가능)', s: S.section });
  sh.set(`C${r}`, { v: '', s: S.section }); sh.set(`D${r}`, { v: '', s: S.section }); r += 1;

  const input = (label, value, style, hint) => {
    sh.row(`B${r}`, [{ v: label }, { v: value, s: style }, hint ? { v: hint, s: S.muted } : null]);
    return `$C$${r++}`;
  };
  T.qty        = input('물량 (톤/월)', t.qty, S.inputNum);
  T.transport  = input('구매 ~ 운송 (주)', t.transportWeeks, S.inputNum);
  T.mfg        = input('생산 (주)', t.mfgWeeks, S.inputNum);
  T.prep       = input('출고준비 (주)', t.shipPrepWeeks, S.inputNum);
  T.ship       = input('출고 (주) — 판매 QP 길이', t.shipWeeks, S.inputNum);
  T.procMargin = input('가공마진 ($/t)', t.procMargin, S.inputNum);
  T.buyMode    = input('매입가 확정 방식', t.buyPriceMode === 'avg' ? '평균' : '단일', S.inputText,
                       '단일 = W0 단일가 (판매자 우위) / 평균 = 리드타임 평균 (구매자 우위)');
  T.invPrev    = input('재고 단가 — 전월 이월 ($/t)', state.inventory.prevUnit, S.inputNum);
  T.invAdd     = input('금월 재고 편입 물량 (톤)', state.inventory.addQty, S.inputNum,
                       '편입분은 매입가와 가중평균되어 재고 단가를 갱신한다');
  r += 1;

  sh.set(`B${r}`, { v: '파생 (수식)', s: S.section });
  sh.set(`C${r}`, { v: '', s: S.section }); sh.set(`D${r}`, { v: '', s: S.section }); r += 1;

  const calc = (label, formula, hint) => {
    sh.row(`B${r}`, [{ v: label }, { f: formula, s: S.num }, hint ? { v: hint, s: S.muted } : null]);
    return `$C$${r++}`;
  };
  T.lead      = calc('리드타임 (주)', `${T.transport}+${T.mfg}+${T.prep}`, '구매·운송 + 생산 + 출고준비');
  T.shipStart = calc('출고월 시작 (주)', `${T.lead}+1`);
  T.shipEnd   = calc('출고월 종료 (주)', `${T.lead}+${T.ship}`, '판매가 확정 · 정산');
  T.decision  = calc('Hedge 진입 (주)', `${T.transport}+${T.mfg}`, 'Rolling 종료 시점');
  T.stage1    = calc('Rolling 1단계 (주)', `${T.transport}`);
  T.stage2    = calc('Rolling 2단계 (주)', `${T.transport}+ROUND(${T.mfg}/2,0)`);
  T.stage3    = calc('Rolling 3단계 (주)', `${T.transport}+${T.mfg}`);
  T.expWeeks  = calc('익스포저 기간 (주)', `${T.shipEnd}`, 'W0 매입가 확정 ~ 출고월 정산');
  T.hedgeWks  = calc('헤지 기간 (주)', `${T.shipEnd}-${T.decision}`);
  r += 1;

  sh.set(`B${r}`, { v: '사업 기간: 구매 ~ 출고', s: S.section });
  ['C', 'D', 'E', 'F', 'G'].forEach(c => sh.set(`${c}${r}`, { v: '', s: S.section })); r += 1;
  sh.row(`B${r}`, ['단계', '물량 (톤)', '기간 (주)', '구간', '가격', '내용']
    .map(v => ({ v, s: S.header }))); r += 1;

  /* 매입가 표기는 '매입가 확정 방식' 선택을 따라간다 — 엑셀 안에서도 살아 있게 수식으로 */
  const buyPriceText =
    `IF(${T.buyMode}="평균","시장가 — 리드타임 평균 (W0~W"&${T.lead}&")","시장가 — 구매 시점 단일가 (W0)")`;
  const steps = [
    ['구매 · 운송', T.qty, T.transport, `"W0 ~ W"&${T.transport}`,
     { f: buyPriceText }, '선택한 방식으로 매입가 확정 — 가격 익스포저 시작. 도착은 운송 기간 경과 후'],
    ['생산 — 황산니켈 생산', T.qty, T.mfg, `"W"&${T.transport}&" ~ W"&${T.decision}`,
     { v: '가공마진 (상수)' }, '시장가와 무관한 A Company 제조 이익'],
    ['출고준비', T.qty, T.prep, `"W"&${T.decision}&" ~ W"&${T.lead}`,
     { v: '—' }, '검사 · 포장 · 선적 서류. 가격 확정 없음'],
    ['출고 (출고월)', T.qty, T.ship, `"W"&${T.shipStart}&" ~ W"&${T.shipEnd}`,
     { v: '출고월 평균 시장가 + 가공마진' }, 'FOB — 출고월 평균으로 매출가 확정 → 익스포저 종료 · 정산']
  ];
  steps.forEach(([name, q, w, span, price, note]) => {
    sh.row(`B${r}`, [
      { v: name, s: S.bold }, { f: q, s: S.num }, { f: w, s: S.num },
      { f: span }, price, { v: note, s: S.wrap }
    ]);
    r += 1;
  });
  r += 1;
  sh.set(`B${r}`, {
    v: `헤지는 W${m.terms.decisionWeek}에 진입하므로 W0~W${m.terms.decisionWeek} 구간의 가격 변동은 막지 못한 채 확정된다 — 의사결정 지연의 비용.`,
    s: S.muted
  });

  return T;
}

/* --------------------------- ③ Hedge 손익 ------------------------------ */
function buildHedge(wb, state, m, T) {
  const c = m.terms;
  const hp = state.hedgeParams;
  const nBook = state.book.length;

  const widths = [22, 14, 16, 12, 16, 14, 14, 12, 12, 12, 12, 12, 12, 14, 12, 18];
  const sh = wb.sheet(SH_HEDGE, widths);
  let r = 2;

  const section = (title, span = 14) => {
    sh.set(`B${r}`, { v: title, s: S.section });
    for (let i = 1; i < span; i++) sh.set(`${C_(2 + i)}${r}`, { v: '', s: S.section });
    r += 1;
  };

  sh.set(`B${r}`, { v: 'Hedge 손익 — 시황 · 매출/Exposure 현황판 · Hedge 결과 · 손익 · 증거금 Cash Flow', s: S.title });
  r += 2;

  /* ---------- ① 시황 ---------- */
  section('① 시황');
  sh.row(`B${r}`, [{ v: '적용 시나리오' }, { v: state.market.scenario, s: S.inputText },
                   { v: '← Contango / Backwardation / Fluctuation', s: S.muted }]);
  const REF_SCEN = `$C$${r}`; r += 2;

  const P0 = 4;                                   // 가격 첫 열 = D
  const nW = m.px.length;
  sh.set(`B${r}`, { v: '시나리오＼주차', s: S.header });
  for (let i = 0; i < nW; i++) sh.set(`${C_(P0 + i)}${r}`, { v: `W${i}`, s: S.header });
  r += 1;
  const scenRow0 = r;
  SCENARIOS.forEach(scn => {
    sh.set(`B${r}`, { v: scn, s: S.bold });
    for (let i = 0; i < nW; i++) {
      sh.set(`${C_(P0 + i)}${r}`, { v: state.market.prices[scn][i], s: S.inputNum });
    }
    r += 1;
  });
  const scenRow1 = r - 1;
  const APPLY = r;                                 // 적용 가격 행
  sh.set(`B${r}`, { v: '적용 가격', s: S.bold });
  for (let i = 0; i < nW; i++) {
    const col = C_(P0 + i);
    sh.set(`${col}${r}`, {
      f: `INDEX(${col}$${scenRow0}:${col}$${scenRow1},MATCH(${REF_SCEN},$B$${scenRow0}:$B$${scenRow1},0))`,
      s: S.num
    });
  }
  const PX_RANGE = `$D$${APPLY}:$${C_(P0 + nW - 1)}$${APPLY}`;
  /* 주차 → 셀. OFFSET 대신 INDEX 를 쓴다 — 비휘발성이라 재계산이 가볍다. */
  const PX = wk => `INDEX(${PX_RANGE},1,${wk}+1)`;
  const PX_AVG = (from, to) => `AVERAGE(${PX(from)}:${PX(to)})`;
  r += 2;

  const calc = (label, formula, style, hint) => {
    sh.row(`B${r}`, [{ v: label }, { f: formula, s: style }, hint ? { v: hint, s: S.muted } : null]);
    return `$C$${r++}`;
  };
  const input = (label, value, style, hint) => {
    sh.row(`B${r}`, [{ v: label }, { v: value, s: style }, hint ? { v: hint, s: S.muted } : null]);
    return `$C$${r++}`;
  };

  const BUY = calc('매입가 ($/t)',
    `IF(${SH_TERMS}!${T.buyMode}="평균",${PX_AVG(0, `${SH_TERMS}!${T.lead}`)},${PX(0)})`,
    S.num2, '거래조건의 매입가 확정 방식을 따른다');
  const ENTRY = calc('Hedge 진입가 ($/t)', PX(`${SH_TERMS}!${T.decision}`),
    S.num2, 'Rolling 종료 시점 시장가');
  const SALEAVG = calc('출고월 평균가 ($/t)',
    PX_AVG(`${SH_TERMS}!${T.shipStart}`, `${SH_TERMS}!${T.shipEnd}`), S.num2);
  const SETTLE = calc('정산일 단일가 ($/t)', PX(`${SH_TERMS}!${T.shipEnd}`),
    S.num2, 'Future 는 이 한 점으로 정산된다');
  const invBaseRow = r, invUnitRow = r + 1;
  r += 3;

  /* ---------- ②-1 판매 물량 (실무) ----------
     열: B 구분 C 종류 D 총물량 E 계획 | F W2 G W4 H W6 | I 판매확정(E1) J 재고 */
  section('②-1 판매 물량 (실무) — 재고를 언제 얼마나 팔았나', 9);
  sh.row(`B${r}`, ['구분', '종류', '총 물량 (톤)', '계획 (톤)']
    .concat(c.stageWeeks.map(w => `추가 판매 W${w} (톤)`))
    .concat(['판매 확정 (E1, 톤)', '재고 (톤)']).map(v => ({ v, s: S.header })));
  r += 1;

  const SAL0 = r;
  const SAL1 = r + nBook - 1;
  const STOCK_LABEL = ROW_KINDS.stock;
  /* 단계별 입력을 앞 단계부터 상한까지만 인정한다 — 웹의 clampStages 와 같은 규칙.
     cols = 단계 3칸의 열 이름, cap = 상한 셀 */
  const stageClamp = (cols, cap, row) => [
    `MIN($${cols[0]}${row},${cap})`,
    `MIN($${cols[1]}${row},MAX(0,${cap}-$${cols[0]}${row}))`,
    `MIN($${cols[2]}${row},MAX(0,${cap}-$${cols[0]}${row}-$${cols[1]}${row}))`
  ];
  const ADD_COLS = ['F', 'G', 'H'];
  const addStage = row => stageClamp(ADD_COLS, `$D${row}`, row);

  state.book.forEach(row => {
    const add = addStage(r);
    sh.row(`B${r}`, [
      { v: row.name, s: S.bold },
      { v: ROW_KINDS[row.kind] || ROW_KINDS.contract, s: S.inputText },
      { v: row.qty, s: S.inputNum },
      /* 계약 행은 물량 전부가 판매 계획, 재고 행은 추가로 판 만큼만 판매된다 */
      { f: `IF($C${r}="${STOCK_LABEL}",0,$D${r})`, s: S.num },
      ...[0, 1, 2].map(i => ({
        v: row.kind === 'stock' ? ((row.addAt || [])[i] || 0) : 0, s: S.inputNum
      })),
      { f: `$E${r}+IF($C${r}="${STOCK_LABEL}",${add.join('+')},0)`, s: S.num },
      { f: `$D${r}-$I${r}`, s: S.num }
    ]);
    r += 1;
  });
  sh.set(`B${r}`, { v: '합계', s: S.bold });
  ['D', 'E', 'F', 'G', 'H', 'I', 'J'].forEach(col =>
    sh.set(`${col}${r}`, { f: `SUM(${col}${SAL0}:${col}${SAL1})`, s: S.totalNum }));
  const SAL_TOTAL = r;
  r += 2;

  const SOLDQ_COL  = 'I';                      // 판매 물량 표의 E1 열
  const STOCKQ_COL = 'J';                      // 판매 물량 표의 재고 열
  const sal = i => SAL0 + i;                   // 책 i 번째 행의 판매 물량 표 주소

  /* ---------- ②-2 Hedge 조치 (실무) ----------
     열: B 구분 C H1 D 조치대상 E QP이동 F 판매QP G 판매QP평균 | H W2 I W4 J W6 | K 수단 L E2 */
  section('②-2 Hedge 조치 (실무) — 무엇을 언제 얼마나 막았나', 11);
  sh.row(`B${r}`, ['구분', 'Natural Hedge (H1, 톤)', '내용', 'Exposure (E1, 톤)',
    'QP 이동', '판매 QP 구간', '판매 QP 평균']
    .concat(c.stageWeeks.map(w => `Hedge 조치 W${w} (톤)`))
    .concat(['조치 수단', '잔여 Exposure (E2, 톤)']).map(v => ({ v, s: S.header })));
  r += 1;

  const HED0 = r;
  const HED1 = r + nBook - 1;
  const HED_COLS = ['I', 'J', 'K'];
  const hed = i => HED0 + i;                   // 책 i 번째 행의 Hedge 조치 표 주소
  /* 조치 상한은 E1 에서 재고를 뺀 물량 — 판매 미확정 재고에는 헤지를 걸지 않는다.
     수단이 무대응이면 어느 단계도 인정하지 않는다. */
  const hedCap = i => `MAX(0,$E${hed(i)}-$${STOCKQ_COL}${sal(i)})`;
  const hedStage = i => stageClamp(HED_COLS, hedCap(i), hed(i))
    .map(f => `IF($L${hed(i)}="무대응",0,${f})`);
  const HEDGED = i => hedStage(i).join('+');

  state.book.forEach((row, i) => {
    sh.row(`B${r}`, [
      { f: `$B${sal(i)}` },
      /* H1 — 계약 시점에 고객 전가로 넘긴 물량 */
      { f: `IF($D${r}="전가",$${SOLDQ_COL}${sal(i)},0)`, s: S.num },
      { v: row.cond, s: S.inputText },
      /* E1 = 판매 확정 − H1 + 재고 */
      { f: `$${SOLDQ_COL}${sal(i)}-$C${r}+$${STOCKQ_COL}${sal(i)}`, s: S.num },
      { v: row.qpShift, s: S.inputNum },
      /* 전가 물량의 QP 는 매입가가 정해지는 구간 자체다 */
      { f: `IF($D${r}="전가",IF(${SH_TERMS}!${T.buyMode}="평균","W0 ~ W"&${SH_TERMS}!${T.lead},"W0"),` +
           `"W"&(${SH_TERMS}!${T.shipStart}+$F${r})&" ~ W"&(${SH_TERMS}!${T.shipEnd}+$F${r}))` },
      /* 전가는 매입가를 그대로 얹으므로 참조가가 매입가다 */
      { f: `IF($D${r}="전가",${BUY},${PX_AVG(`${SH_TERMS}!${T.shipStart}+$F${r}`, `${SH_TERMS}!${T.shipEnd}+$F${r}`)})`, s: S.num2 },
      ...[0, 1, 2].map(k => ({ v: (row.hedgeAt || [])[k] || 0, s: S.inputNum })),
      { v: HEDGE_KINDS[row.hedge].label, s: S.inputText },
      { f: `$E${r}-(${HEDGED(i)})`, s: S.num }
    ]);
    r += 1;
  });
  sh.set(`B${r}`, { v: '합계', s: S.bold });
  ['C', 'E', 'I', 'J', 'K', 'M'].forEach(col =>
    sh.set(`${col}${r}`, { f: `SUM(${col}${HED0}:${col}${HED1})`, s: S.totalNum }));
  const HED_TOTAL = r;
  r += 2;

  const SALEREF_COL = 'H';                     // Hedge 조치 표의 판매 참조가 열
  /* 출고월 평균 물량 — E1 에서 재고를 뺀 것. what-if 벤치마크로 쓴다 */
  const AVGQ = i => hedCap(i);
  const AVG_TOTAL = `$E$${HED_TOTAL}-$${STOCKQ_COL}$${SAL_TOTAL}`;

  /* ---------- ②-3 요약 (경영층 보고) — 위 두 표를 합친 한 줄기 ---------- */
  section('②-3 매출/Exposure 현황판 요약 (경영층 보고) — 판매 확정(S) → Natural Hedge(H1) → Exposure(E1) → Hedge 조치(H2) → 잔여(E2)', 13);
  sh.row(`B${r}`, ['구분', '종류', '총 물량 (톤)', '계획 (톤)', '추가 (톤)',
    '판매 확정 (S, 톤)', '재고 (톤)', 'Natural Hedge (H1, 톤)', '내용', 'Exposure (E1, 톤)',
    'Hedge 조치 (H2, 톤)', '조치 수단', '잔여 Exposure (E2, 톤)'].map(v => ({ v, s: S.header })));
  r += 1;
  const SUM0 = r;
  state.book.forEach((_, i) => {
    sh.row(`B${r}`, [
      { f: `$B${sal(i)}` }, { f: `$C${sal(i)}` }, { f: `$D${sal(i)}`, s: S.num },
      { f: `$E${sal(i)}`, s: S.num }, { f: `$${SOLDQ_COL}${sal(i)}-$E${sal(i)}`, s: S.num },
      { f: `$${SOLDQ_COL}${sal(i)}`, s: S.num }, { f: `$${STOCKQ_COL}${sal(i)}`, s: S.num },
      { f: `$C${hed(i)}`, s: S.num }, { f: `$D${hed(i)}` }, { f: `$E${hed(i)}`, s: S.num },
      { f: `${HEDGED(i)}`, s: S.num }, { f: `$L${hed(i)}` },
      { f: `$M${hed(i)}`, s: S.num }
    ]);
    r += 1;
  });
  sh.set(`B${r}`, { v: '합계', s: S.bold });
  ['D', 'E', 'F', 'G', 'H', 'I', 'K', 'L', 'N'].forEach(col =>
    sh.set(`${col}${r}`, { f: `SUM(${col}${SUM0}:${col}${SUM0 + nBook - 1})`, s: S.totalNum }));
  r += 1;
  /* 화면에서 현황판 아래에 적은 Lead message 를 같은 자리로 옮긴다 */
  const boardLead = ((state.notes && state.notes.boardLead) || '').trim();
  if (boardLead) { sh.set(`B${r}`, { v: boardLead, s: S.bold }); r += 1; }
  r += 1;

  /* 재고 단가 — 현황판 주소가 확정된 뒤에 채운다 */
  sh.row(`B${invBaseRow}`, [{ v: '기초 재고 물량 (톤)' },
    { f: `SUMIF($C$${SAL0}:$C$${SAL1},"${STOCK_LABEL}",$D$${SAL0}:$D$${SAL1})`, s: S.num },
    { v: '거래조건 시트의 재고 단가 입력과 함께 저가법 기준 원가를 만든다', s: S.muted }]);
  sh.row(`B${invUnitRow}`, [{ v: '재고 단가 — 이동평균 ($/t)' },
    { f: `IF($C$${invBaseRow}+${SH_TERMS}!${T.invAdd}=0,${SH_TERMS}!${T.invPrev},` +
         `($C$${invBaseRow}*${SH_TERMS}!${T.invPrev}+${SH_TERMS}!${T.invAdd}*${BUY})/($C$${invBaseRow}+${SH_TERMS}!${T.invAdd}))`,
      s: S.num2 },
    { v: '(기초 물량 × 전월 단가 + 편입 물량 × 매입가) ÷ 합계', s: S.muted }]);
  const INV_UNIT = `$C$${invUnitRow}`;

  /* ---------- ③ Hedge 결과 ---------- */
  section('③ Hedge 결과 — 파라미터', 4);
  const RATE    = input('연 이자율 (%)', hp.ratePct, S.inputNum);
  const STORAGE = input('창고 · 보험료 ($/t, 기간 합계)', hp.storage, S.inputNum);
  const CY      = input('적기공급 프리미엄 ($/t)', hp.convenienceYield, S.inputNum, '백워데이션에서 > 0');
  const SPREAD  = input('브로커 스프레드 ($/t)', hp.ibSpread, S.inputNum, '고정가에 내재 — 청구서에 안 보임');
  const FEE_F   = input('브로커 수수료 · Forward ($/t)', hp.ibFeeForward, S.inputNum2, '명시 청구 → 원가 계상');
  const FEE_U   = input('브로커 수수료 · Future ($/t)', hp.ibFeeFuture, S.inputNum2, 'round-turn (진입 + 청산)');
  const IM_PCT  = input('개시증거금율 (%)', hp.imRatePct, S.inputNum);
  const CASH    = input('가용 현금 한도 ($)', hp.cashLimit, S.inputNum);
  const MONTHS  = calc('헤지 기간 (개월)', `${SH_TERMS}!${T.hedgeWks}/${SH_TERMS}!${T.ship}`, S.num2);
  const INTEREST = calc('금융이자 ($/t)', `${ENTRY}*${RATE}/100*${MONTHS}/12`, S.num2);
  const THEORY  = calc('이론 선도가격 ($/t)', `${ENTRY}+${INTEREST}+${STORAGE}-${CY}`, S.num2,
    '진입 시점 현물 + 이자 + 창고 − 편의수익');
  const FIXED   = calc('A가 받는 고정가 ($/t)', `${THEORY}-${SPREAD}`, S.num2, '이론가 − 브로커 스프레드');
  /* ⓓ — 이자·창고는 A 가 어차피 부담하는 보유비용이고 선도가가 그만큼 보상해 주므로 순효과 0.
     수단을 가르는 건 편의수익과 스프레드뿐이라 그 둘만 센다 (항상 ≤ 0). */
  const CARRY_UNIT = calc('ⓓ 단가 효과 ($/t)', `-(${CY}+${SPREAD})`, S.num2,
    '−(적기공급 프리미엄 + 브로커 스프레드) — A 가 할인해서 넘기는 값');
  const LCM_UNIT = calc('ⓔ 저가법 단가 ($/t)', `MIN(0,${SETTLE}-${INV_UNIT})`, S.num2,
    'MIN(0, 정산일 가격 − 재고 단가) — 손실만 인식');
  r += 1;

  /* ⓐ~ⓕ 는 $/t. 그 조각의 물량을 곱해야 금액이 된다.
     한 계약이라도 단계마다 진입가가 다르고 미헤지분은 단가 구조가 달라 조각(leg)으로 나눈다.
     ⓐ 는 진입 주차까지의 구간이므로 이른 단계에 걸수록 짧다.
     재고 저가법은 헤지가 한 일이 아니라 ④ 손익에서만 계상한다.
     열: B 구분 C 처리 D 진입주차 E 판매참조가 F~J 단가 K 소계 L 물량 M 손익 N 무대응 O 차이 P Operation */
  sh.row(`B${r}`, ['구분', '처리', '진입 (주차)', '판매 참조가',
    'ⓐ 미헤지 W0~진입 ($/t)', 'ⓑ 헤지 구간 노출 ($/t)', 'ⓒ QP 미스매치 ($/t)',
    'ⓓ Forward spread ($/t)', 'ⓕ 브로커 수수료 ($/t)',
    '소계 ($/t)', '× 물량 (톤)',
    '= Hedge 손익', '무대응 손익', 'Hedge − 무대응',
    'Operation 비용 (ⓓ+ⓕ)'].map(v => ({ v, s: S.header })));
  r += 1;
  const RES0 = r;
  const LEGS_PER_ROW = c.stageWeeks.length + 1;
  const STAGE_REF = [T.stage1, T.stage2, T.stage3];
  /* 행 수가 늘 고정이라 입력을 바꿔도 주소가 흔들리지 않는다 — 안 쓰는 줄은 물량이 0이 된다.
     마지막 줄이 미헤지분이고, 진입이 없으므로 Rolling 종료(W6)를 기준선으로 쓴다. */
  state.book.forEach((_, i) => {
    const hr = hed(i);                         // 대응하는 Hedge 조치 행
    const stages = hedStage(i);
    for (let s = 0; s <= c.stageWeeks.length; s++) {
      const isHedged = s < c.stageWeeks.length;
      const entry = `INDEX(${PX_RANGE},1,$D${r}+1)`;
      sh.row(`B${r}`, [
        { f: `$B${hr}` },
        isHedged ? { f: `IF(${stages[s]}=0,"–",$L${hr})` } : { v: '무대응' },
        { f: `${SH_TERMS}!${isHedged ? STAGE_REF[s] : T.decision}`, s: S.num },
        { f: `$${SALEREF_COL}${hr}`, s: S.num2 },
        /* 고객 전가는 판가조건이 매입가 연동으로 바뀌므로 ⓐ 구간까지 사라진다 */
        { f: `IF($C${r}="고객 전가",0,${entry}-${BUY})`, s: S.signed },
        { f: `IF($C${r}="무대응",$E${r}-${entry},0)`, s: S.signed },
        { f: `IF($C${r}="Future 매도",$E${r}-${SETTLE},0)`, s: S.signed },
        { f: `IF($C${r}="Forward 매도",${CARRY_UNIT},0)`, s: S.signed },
        { f: `IF($C${r}="Forward 매도",-${FEE_F},IF($C${r}="Future 매도",-${FEE_U},0))`, s: S.signed },
        { f: `SUM(F${r}:J${r})`, s: S.signed },
        { f: isHedged ? stages[s] : `${AVGQ(i)}-(${HEDGED(i)})`, s: S.num },
        { f: `K${r}*L${r}`, s: S.signed },
        { f: `($E${r}-${BUY})*L${r}`, s: S.signed },
        { f: `M${r}-N${r}`, s: S.signed },
        { f: `(I${r}+J${r})*L${r}`, s: S.signed }
      ]);
      r += 1;
    }
  });
  const RES1 = r - 1;
  sh.set(`B${r}`, { v: '합계', s: S.bold });
  ['L', 'M', 'N', 'O', 'P'].forEach(col => {
    sh.set(`${col}${r}`, { f: `SUM(${col}${RES0}:${col}${RES1})`,
      s: col === 'L' ? S.totalNum : S.totalSigned });
  });
  const RES_TOTAL = r;
  r += 2;
  sh.set(`B${r}`, { v: 'ⓐ~ⓕ 는 모두 $/t. 소계 × 물량 = Hedge 손익. ⓓ+ⓕ 만 헤지를 실행한 비용이고 ⓐⓑⓒ 는 가격이 움직여서 생긴 마진변동손익이다. 계약마다 단계별 조치 줄 + 미헤지 줄로 나뉘며, 해당 없는 줄은 물량이 0이 된다.', s: S.muted }); r += 1;
  sh.set(`B${r}`, { v: 'ⓓ Forward spread — Forward 를 고른 대가로 A 가 실제로 깎이는 금액. 이론 선도가격 = 진입 시점 현물 + 금융이자 + 창고·보험료 − 적기공급 프리미엄이고 여기서 브로커 스프레드를 뺀 값이 A 가 받는 고정가다. 이 중 금융이자 + 창고·보험료는 A 가 물건을 들고 있으면서 어차피 부담하는 보유비용이고 선도가는 딱 그만큼을 얹어 보상해 주는 것이라 순효과가 0이며, 파생 수단 모두에 똑같이 발생해 수단을 가르지 못한다. 따라서 ⓓ = −(적기공급 프리미엄 + 브로커 스프레드) 로 항상 0 이하다.', s: S.muted }); r += 1;
  sh.set(`B${r}`, { v: `ⓐ는 언제 걸었느냐로 갈린다 — W0~진입은 아직 헤지하지 않은 채 지나간 구간이다. 같은 시점이면 파생 수단끼리 값이 같고 시점을 앞당기면 짧아진다. 수단 선택이 아니라 의사결정 시점의 문제다. 고객 전가만 예외로, 판가조건 자체가 매입가 연동으로 바뀌므로 이 구간까지 사라진다.`, s: S.muted }); r += 2;

  /* ---------- ④ 손익 ---------- */
  section('④ 손익 (USD)', 3 + nBook);
  /* 화면에서 적은 Lead message 를 표 바로 위에 같은 자리로 옮긴다 */
  const lead = (state.notes && state.notes.pnlLead || '').trim();
  if (lead) { sh.set(`B${r}`, { v: lead, s: S.bold }); r += 1; }
  sh.set(`B${r}`, { v: '항목', s: S.header });
  state.book.forEach((row, i) => sh.set(`${C_(3 + i)}${r}`, { v: row.name, s: S.header }));
  sh.set(`${C_(3 + nBook)}${r}`, { v: '합계', s: S.header });
  r += 1;

  const plRow = (label, fn, style = S.signed) => {
    sh.set(`B${r}`, { v: label });
    state.book.forEach((_, i) => sh.set(`${C_(3 + i)}${r}`, { f: fn(i), s: style }));
    const a = C_(3), b = C_(2 + nBook);
    sh.set(`${C_(3 + nBook)}${r}`, { f: `SUM(${a}${r}:${b}${r})`, s: S.totalSigned });
    return r++;
  };
  /* Hedge 결과의 그 계약 조각들 — 단계별 헤지분 + 미헤지분이 붙어 있다 */
  const leg0 = i => RES0 + i * LEGS_PER_ROW;
  const leg1 = i => RES0 + (i + 1) * LEGS_PER_ROW - 1;
  const legSum = (col, i) => `SUM(${col}${leg0(i)}:${col}${leg1(i)})`;
  const legProd = (col, i) => `SUMPRODUCT(${col}${leg0(i)}:${col}${leg1(i)},L${leg0(i)}:L${leg1(i)})`;
  /* 전가 행은 참조가가 매입가라 두 조건을 한 줄로 쓸 수 있다 */
  const soldOf = i => `$${SOLDQ_COL}${sal(i)}`;
  const refOf  = i => `$${SALEREF_COL}${hed(i)}`;

  plRow('매출액', i => `${soldOf(i)}*(${refOf(i)}+${SH_TERMS}!${T.procMargin})`);
  plRow('재료비', i => `-${soldOf(i)}*${BUY}`);
  const rowMargin = plRow('마진 (매출 + 재료비)', i => `${C_(3 + i)}${r - 2}+${C_(3 + i)}${r - 1}`);
  plRow('　└ 가공마진 (상수)', i => `${soldOf(i)}*${SH_TERMS}!${T.procMargin}`);
  plRow('　└ 가격변동마진 (변수)', i => `${AVGQ(i)}*(${refOf(i)}-${BUY})`);
  /* 재고 저가법 — 헤지 선택과 무관하게 발생하므로 무대응·Hedge 양쪽에 똑같이 들어간다 */
  const rowLcm = plRow('재고 평가손실 (저가법)', i => `${LCM_UNIT}*$${STOCKQ_COL}${sal(i)}`);
  const rowNoHedge = plRow('손익 — 무대응',
    i => `${C_(3 + i)}${rowMargin}+${C_(3 + i)}${rowLcm}`);
  /* Hedge 결과 시트 열: O = Hedge − 무대응, P = Operation 비용(ⓓ+ⓕ),
     I×L = 보유비용·스프레드 금액, J×L = 브로커 수수료 금액 */
  const rowEffect = plRow('Hedge 효과 (가격 상쇄)', i => `${legSum('O', i)}-${legSum('P', i)}`);
  const rowOp = plRow('Hedge Operation 비용', i => legSum('P', i));
  plRow('　└ Forward spread (가격에 내재)', i => legProd('I', i));
  plRow('　└ 브로커 수수료 (명시 청구)', i => legProd('J', i));
  const rowHedged = plRow('손익 — Hedge',
    i => `${C_(3 + i)}${rowNoHedge}+${C_(3 + i)}${rowEffect}+${C_(3 + i)}${rowOp}`, S.totalSigned);
  const rowDelta = plRow('차이 (Hedge − 무대응)',
    i => `${C_(3 + i)}${rowHedged}-${C_(3 + i)}${rowNoHedge}`);
  r += 1;

  /* 메모 — 실현 판매단가 ($/ton). 단위가 달라 손익표와 줄을 나눈다. */
  sh.set(`B${r}`, { v: '메모 — 실현 판매단가 ($/ton)', s: S.bold }); r += 1;
  /* 단가 메모는 딱 떨어지면 소수점을 감춘다 (#,##0.##) — 웹 화면과 같은 규칙 */
  const memoRow = (label, fn, style = S.numTrim) => {
    sh.set(`B${r}`, { v: label, s: S.muted });
    state.book.forEach((_, i) => sh.set(`${C_(3 + i)}${r}`, { f: fn(i), s: style }));
    return r++;
  };
  const qtyCol = i => AVGQ(i);
  const rowMemoQty = memoRow('출고월 평균 물량 (톤)', i => qtyCol(i), S.num);
  memoRow('기준 판매단가 — 출고월 평균', i => `IF(${qtyCol(i)}=0,"",${refOf(i)})`);
  const rowMemoHedge = memoRow('헤지가 바꾼 단가',
    i => `IF(${qtyCol(i)}=0,"",${C_(3 + i)}${rowDelta}/${qtyCol(i)})`);
  memoRow('실현 판매단가 (헤지 後)',
    i => `IF(${qtyCol(i)}=0,"",${refOf(i)}+${C_(3 + i)}${rowMemoHedge})`);
  r += 1;
  sh.set(`B${r}`, { v: `가격이 걸려 있던 출고월 평균 물량에 대해서만 뜻이 있다 (전가·재고 물량 제외). 실현 단가 = 출고월 평균 + (Hedge − 무대응) ÷ 출고월 평균 물량 이므로 위 손익표와 정확히 맞물린다. Forward 의 경우 브로커가 실제 지급하는 고정가는 'A가 받는 고정가' 행이지만, 여기서는 ③과 같은 기준으로 보유비용 보상분을 상계한 뒤의 값을 쓴다.`, s: S.muted });
  void rowMemoQty;
  r += 1;
  sh.set(`B${r}`, { v: '매출 · 재료비는 판매 확정된 물량(고객 전가 + 출고월 평균)만 계상한다. 재고 평가손실은 헤지 선택과 무관하게 발생하므로 손익 — 무대응 위에 두고, 차이 행에는 헤지가 실제로 만든 값만 남긴다.', s: S.muted });
  r += 2;

  /* ---------- ⑤ Exposure 대응 일원화 시 ---------- */
  section('⑤ Exposure 대응 일원화 시 (what-if)', 9);
  const BENCH = calc('출고월 평균 물량 (톤)', AVG_TOTAL, S.num,
    '이 물량 전부를 한 가지 수단으로 몰았다면');
  r += 1;
  sh.row(`B${r}`, ['케이스', 'ⓐ 미헤지', 'ⓑ 노출', 'ⓒ 미스매치', 'ⓓ Forward spread',
                   'ⓕ 수수료', 'Operation 비용 (ⓓ+ⓕ)', '합계'].map(v => ({ v, s: S.header })));
  r += 1;
  /* 현재 설정은 ③ 합계행에서 그대로 가져와 나머지 세 케이스의 기준점으로 둔다 */
  const CMP = [
    ['무대응', `(${ENTRY}-${BUY})*${BENCH}`, `(${SALEAVG}-${ENTRY})*${BENCH}`, '0', '0', '0'],
    null,
    /* 운영 해법 — 판가조건을 통째로 매입가 연동으로 돌리면 가격 손익 자체가 사라진다 */
    ['고객 전가', '0', '0', '0', '0', '0'],
    ['Forward 매도', `(${ENTRY}-${BUY})*${BENCH}`, '0', '0', `${CARRY_UNIT}*${BENCH}`, `-${FEE_F}*${BENCH}`],
    ['Future 매도', `(${ENTRY}-${BUY})*${BENCH}`, '0', `(${SALEAVG}-${SETTLE})*${BENCH}`, '0', `-${FEE_U}*${BENCH}`]
  ];
  CMP.forEach(row => {
    if (row === null) {
      /* null 4개 = ⓐ~ⓒ 와 ⓕ 자리를 비워 Operation 비용을 H, 합계를 I 열에 맞춘다 */
      sh.row(`B${r}`, [{ v: 'Hedge (현재 설정)', s: S.bold },
        { v: '②에서 고른 조합', s: S.muted }, null, null, null, null,
        { f: `$P$${RES_TOTAL}`, s: S.signed },
        { f: `$M$${RES_TOTAL}`, s: S.totalSigned }]);
    } else {
      const [name, ...legs] = row;
      sh.row(`B${r}`, [{ v: name, s: S.bold }]
        .concat(legs.map(f => ({ f, s: S.signed })))
        .concat([{ f: `F${r}+G${r}`, s: S.signed }, { f: `SUM(C${r}:G${r})`, s: S.totalSigned }]));
    }
    r += 1;
  });
  r += 1;

  /* ---------- ⑥ 증거금 Cash Flow ----------
     Future 는 단계별로 나눠 들어갈 수 있다. 주간 손익은 '그 주 시작 시점에 이미 열려 있던
     물량'에만 걸리므로, 진입 주차가 그 전인 조각만 SUMIFS 로 골라 곱한다. */
  section('⑥ 증거금 Cash Flow — 주간 시가평가', 8);
  const F_KIND = `$C$${RES0}:$C$${RES1}`;
  const F_WEEK = `$D$${RES0}:$D$${RES1}`;
  const F_QTY  = `$L$${RES0}:$L$${RES1}`;
  const FOPEN = wk => `SUMIFS(${F_QTY},${F_KIND},"Future 매도",${F_WEEK},"<="&${wk})`;
  const FQTY = calc('Future 매도 물량 (톤)',
    `SUMIF(${F_KIND},"Future 매도",${F_QTY})`, S.num);
  calc('개시증거금 ($)',
    `SUMPRODUCT((${F_KIND}="Future 매도")*${F_QTY}*INDEX(${PX_RANGE},1,${F_WEEK}+1))*${IM_PCT}/100`,
    S.num, '조각마다 진입가가 달라 물량 × 진입가를 각각 더한다');
  r += 1;

  sh.row(`B${r}`, ['주차', '주차 번호', 'LME 가격 ($/t)', '보유 물량 (톤)',
    '주간 선물 손익 (− 납부 / + 환급)',
    '누적 선물 손익 (= 누적 순현금흐름)', '누적 납부 필요액'].map(v => ({ v, s: S.header })));
  r += 1;
  const MTM0 = r;
  m.future.rows.forEach((mr, i) => {
    const prev = r - 1;
    sh.row(`B${r}`, [
      { f: `"W"&C${r}${i === m.future.rows.length - 1 ? '&" (청산)"' : ''}` },
      { v: mr.week, s: S.num },
      { f: PX(`C${r}`), s: S.num },
      { f: FOPEN(`C${r}`), s: S.num },
      i === 0 ? { v: 0, s: S.signed } : { f: `(D${prev}-D${r})*E${prev}`, s: S.signed },
      i === 0 ? { v: 0, s: S.signed } : { f: `G${prev}+F${r}`, s: S.signed },
      { f: `MAX(0,-G${r})`, s: S.num }
    ]);
    r += 1;
  });
  const MTM1 = r - 1;
  r += 1;
  const MAXNEED = calc('누적 납부 필요액 최대 ($)', `MAX(H${MTM0}:H${MTM1})`, S.num);
  calc('현금 한도 초과 여부', `IF(${MAXNEED}>${CASH},"초과 → 강제청산","버팀")`, S.base);
  calc('여유 ($)', `${CASH}-${MAXNEED}`, S.signed);
  r += 1;
  sh.set(`B${r}`, { v: '헤지의 진짜 리스크는 최종 손익이 아니라 버티는 기간의 현금흐름이다. Forward 는 이 표가 통째로 비어 있고, 그 유동성 부담을 브로커가 지므로 스프레드에 얹힌다.', s: S.muted });
}

/* ------------------------------- ④ 참고 ---------------------------------- */
function buildRef(wb) {
  const sh = wb.sheet('참고', [30, 34, 60]);
  let r = 2;
  const section = t => {
    sh.set(`B${r}`, { v: t, s: S.section });
    sh.set(`C${r}`, { v: '', s: S.section }); sh.set(`D${r}`, { v: '', s: S.section });
    r += 1;
  };

  sh.set(`B${r}`, { v: '참고 자료', s: S.title }); r += 2;

  section('단위 환산 — 니켈 금속 ↔ 황산니켈');
  sh.set(`B${r}`, { v: REF_UNIT.headline, s: S.bold }); r += 1;
  sh.row(`B${r}`, [{ v: '구분', s: S.header }, { v: '값', s: S.header }]); r += 1;
  REF_UNIT.rows.forEach(([k, v]) => { sh.row(`B${r}`, [{ v: k }, { v, s: S.wrap }]); r += 1; });
  REF_UNIT.notes.forEach(t => { sh.set(`B${r}`, { v: t, s: S.wrap }); r += 1; });
  r += 1;

  section('니켈 원료 수송 기간');
  sh.row(`B${r}`, [{ v: '출발지', s: S.header }, { v: '소요 기간', s: S.header }, { v: '비고', s: S.header }]);
  r += 1;
  REF_SHIPPING.forEach(([a, b, cc]) => {
    sh.row(`B${r}`, [{ v: a }, { v: b, s: S.wrap }, { v: cc, s: S.wrap }]); r += 1;
  });
  sh.set(`B${r}`, { v: '출처: Fluent Cargo, Indonesia Business Post. 모델 기본값은 2주로 단순화했다.', s: S.muted });
  r += 2;

  section('용어집');
  sh.row(`B${r}`, [{ v: '용어', s: S.header }, { v: 'Full Name', s: S.header }, { v: '정의', s: S.header }]);
  r += 1;
  GLOSSARY.forEach(([a, b, cc]) => {
    sh.row(`B${r}`, [{ v: a, s: S.bold }, { v: b }, { v: cc, s: S.wrap }]); r += 1;
  });
}

/* ------------------------------ 다운로드 --------------------------------- */
function exportXlsx(state) {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  buildWorkbook(state).download(`nickel_hedge_${stamp}.xlsx`);
}
