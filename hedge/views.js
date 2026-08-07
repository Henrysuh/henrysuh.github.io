/* ===========================================================================
   views.js — 탭별 화면 렌더러. 상태를 받아 HTML 문자열을 만든다.
   탭: 개요 / 거래조건 / Hedge 손익 / 참고
   =========================================================================== */

const n0 = v => Math.round(v).toLocaleString('en-US');
const n1 = v => (Math.round(v * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
const n2 = v => (Math.round(v * 100) / 100).toLocaleString('en-US',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = v => (v < 0 ? '−$' : '$') + n0(Math.abs(v));
const unit = v => (v < 0 ? '−$' : '$') + n2(Math.abs(v)) + '/t';
/* 딱 떨어지는 값의 .00 은 지우고, −2.50 처럼 뜻이 있는 소수만 남긴다 */
const unitTrim = v => (v < 0 ? '−$' : '$') +
  (Number.isInteger(Math.round(v * 100) / 100) ? n0(Math.abs(v)) : n2(Math.abs(v))) + '/t';
const cls = v => (v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted');
const signed = v => `<span class="${cls(v)}">${usd(v)}</span>`;
const dash = (v, f) => (v === 0 ? '<span class="muted">–</span>' : f(v));

/* 숫자 입력을 type="number" 가 아니라 text + inputmode 로 낸다.
   number 입력은 selectionStart/setSelectionRange 를 노출하지 않아서,
   입력할 때마다 재렌더되는 이 구조에서는 캐럿을 복원할 방법이 없다
   (그 결과 캐럿이 맨 앞으로 튀어 12를 치면 21이 된다).
   파싱은 app.js 가 data-num 을 보고 직접 하고, 위/아래 화살표 증감도 거기서 처리한다. */
const inp = (path, value, klass = 'cell', step = 'any') =>
  `<input type="text" inputmode="decimal" autocomplete="off" class="${klass}" ` +
  `data-bind="${path}" data-num data-step="${step}" value="${value}">`;
const txt = (path, value) => `<input type="text" data-bind="${path}" value="${esc(value)}">`;
const sel = (path, value, options) =>
  `<select data-bind="${path}">${options.map(o => {
    const [v, label] = Array.isArray(o) ? o : [o, o];
    return `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('')}</select>`;

const field = (label, control, hint = '') =>
  `<div class="field"><label>${label}</label>${control}` +
  (hint ? `<div class="field-hint">${esc(hint)}</div>` : '') + `</div>`;
const stat = (label, value, hint = '', klass = '') =>
  `<div class="stat"><div class="stat-label">${esc(label)}</div>` +
  `<div class="stat-value ${klass}">${value}</div>` +
  (hint ? `<div class="stat-hint">${esc(hint)}</div>` : '') + `</div>`;
const dl = rows => `<dl class="kv">${rows.map(([k, v]) =>
  `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
/* 키·값에 색이나 강조가 들어가야 할 때 — 이스케이프하지 않으므로 리터럴에만 쓴다 */
const dlRaw = rows => `<dl class="kv">${rows.map(([k, v]) =>
  `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
const badge = (text, kind = '') => `<span class="badge ${kind}">${esc(text)}</span>`;
/* 약어 + 원어 두 줄짜리 셀 */
const abbrCell = (short, full) =>
  `${esc(short)}<span class="cell-sub">${esc(full)}</span>`;

/* 표 앞에 붙는 리드 문장 — 적은 그대로 실린다. 입력칸 자체가 결과물이라
   따로 미리보기를 두지 않는다 (파란 칸 = 고칠 수 있는 것, 이 앱의 규칙). */
const leadBlock = (path, value, hint) => `
  <div class="lead-block">
    <label class="lead-label" for="lead-${esc(path)}">Lead message</label>
    <input type="text" class="lead-input" id="lead-${esc(path)}"
      data-bind="${path}" value="${esc(value)}" placeholder="이 표에서 먼저 읽어야 할 한 줄">
    <span class="lead-hint">${esc(hint)}</span>
  </div>`;

/* 세로로 긴 탭의 좌측 목차 — 카드마다 붙은 id 로 건너뛴다 */
const sectionNav = items => `
  <nav class="sec-nav" aria-label="이 탭의 목차">
    ${items.map(([id, label]) =>
      `<a class="sec-link" href="#${id}" data-sec-link="${id}">${esc(label)}</a>`).join('')}
  </nav>`;

/* ================================ 개요 =================================== */
function renderOverview(state) {
  const m = computeModel(state);
  const c = m.terms;

  const cast = [
    ['A Company', '황산니켈 생산업체. 니켈 100톤을 구매·가공하여 황산니켈로 판매 (니켈 함량 100톤 기준으로 단순화)'],
    ['Cathode', '양극재 생산업체(고객). 황산니켈을 ‘인도 시점 니켈 시장가 + 가공마진’ 조건으로 구매'],
    ['IB (브로커)', '선물: A의 주문을 LME에 중개, 변동증거금 관리. 선도: A와 1:1 고정가 계약 후 자기 리스크를 LME에 되헤지'],
    ['LME 정산소', '선물 포지션을 매일 시가평가하여 이익/손실 현금 정산 (본 모델은 주 단위로 단순화)']
  ];
  const frame = [
    ['마진 분해', '마진 = 가공마진(상수, A Company 제조 이익) + 가격변동마진(변수). 헤지는 가격변동마진에 대한 의사결정.'],
    ['증거금', '증거금 잔고는 개시증거금으로 고정. 주간 손실 = 당주 납부(−), 주간 이익 = 당주 환급(+). 따라서 누적 선물 손익 = 누적 순현금흐름.'],
    ['헤지 전략(가정)', 'Rolling을 통한 운영 우선, 잔여 익스포저만 Hedge. 따라서 Hedge 진입시점은 Rolling이 끝나는 W' + c.decisionWeek ]
  ];
  const tabs = [
    ['거래조건', '물량·기간·가공마진 입력 → 구매·운송 / 생산 / 출고준비 / 출고월 타임라인이 자동으로 재구성된다'],
    ['Hedge 손익', '시황 → Exposure 현황판 → 조치 내용 → Hedge 결과 → 손익, 그리고 what-if 두 개(대응 일원화 · 증거금 Cash Flow). 엑셀의 Exposure·손익계산서·케이스 4시트를 하나로 합쳤다'],
    ['참고', '단위 환산(니켈 금속 ↔ 황산니켈), 니켈 원료 수송 기간, 용어집']
  ];

  const seg = (label, span, klass) =>
    `<div class="tl-seg ${klass}"><b>${esc(label)}</b><span>${esc(span)}</span></div>`;

  return `
    <div class="card hero">
      <h2>니켈 Simulation 모델</h2>
      <p class="card-sub">
        매입가 확정(W0)부터 출고월 정산(W${c.shipEnd})까지의 가격 익스포저를,
        <b>무대응 · Forward · Future · 저가법 평가</b> 네 가지 대응으로 갈라 본다.
        파란색 입력 칸을 바꾸면 전체가 즉시 재계산된다.
      </p>
      <div class="timeline-bar">
        ${seg('구매 · 운송', `W0 ~ W${c.transportEnd}`, 'tl-a')}
        ${seg('생산', `W${c.transportEnd} ~ W${c.mfgEnd}`, 'tl-b')}
        ${seg('출고준비', `W${c.mfgEnd} ~ W${c.leadWeeks}`, 'tl-c')}
        ${seg('출고월 · 정산', `W${c.shipStart} ~ W${c.shipEnd}`, 'tl-d')}
      </div>
    </div>

    <div class="grid-2">
      <div class="card"><h2>Player</h2>${dl(cast)}</div>
      <div class="card"><h2>핵심 프레임</h2>${dl(frame)}</div>
    </div>

    <div class="card">
      <h2>익스포저 대응 수단: 무대응, Forward 매도, Future 매도, 저가법 평가</h2>
      <p class="card-sub">
        이 모델의 선택 옵션. 저가법은 Hedge 대응이 아닌 회계 인식 방법이지만,
        손익 영향 효과가 있으므로 동등 비교
      </p>
      <div class="table-scroll"><table class="matrix">
        <thead><tr>
          <th>속성</th><th>무대응</th><th>Forward 매도</th><th>Future 매도</th><th>저가법 평가</th>
        </tr></thead>
        <tbody>
          <tr><td class="name">성격</td><td>익스포저 방치</td><td>${abbrCell('OTC 1:1 파생', 'Over-the-Counter · 장외')}</td><td>거래소 표준 파생</td><td class="accent">회계 인식 (헤지 아님)</td></tr>
          <tr><td class="name">적용 대상</td><td>전부</td><td>판매 확정 + QP 매칭 가능</td><td>판매 확정 (QP 불일치 감수)</td><td>판매 미확정 재고</td></tr>
          <tr><td class="name">가격 확정</td><td>없음</td><td>계약 시 고정가</td><td>진입가 고정</td><td>없음</td></tr>
          <tr><td class="name">정산 시점</td><td>출고월</td><td>만기 일괄 (출고월)</td><td>${abbrCell('매일 MTM → 출고월 청산', 'Mark-to-Market · 시가평가')}</td><td>결산 시점</td></tr>
          <tr><td class="name">증거금</td><td>없음</td><td>없음</td><td class="warn-cell">변동증거금 = 마진콜</td><td>없음</td></tr>
          <tr><td class="name">상쇄 정확도</td><td>–</td><td class="pos">완전 (QP 매칭)</td><td class="neg">부분 — 평균 vs 단일시점</td><td>–</td></tr>
          <tr><td class="name">숨은 비용</td><td>–</td><td class="neg">브로커 스프레드 (고정가에 내재)</td><td>–</td><td>–</td></tr>
          <tr><td class="name">명시 비용</td><td>–</td><td>브로커 수수료</td><td>브로커 수수료 + 개시증거금</td><td>–</td></tr>
          <tr><td class="name">우발 risk</td><td>–</td><td>${abbrCell('거래상대방 신용리스크', '브로커 부도 시 계약 이행 불가')}</td><td>${abbrCell('유동성 리스크', '신용은 정산소가 흡수 · 마진콜은 자기 부담')}</td><td>–</td></tr>
          <tr><td class="name">가격변동손익</td><td>흡수</td><td>제거</td><td>일정기간 제거 · 미스매치 잔존</td><td class="accent">손실만 조기 인식</td></tr>
        </tbody>
      </table></div>
    </div>

    <div class="card"><h2>탭 구성</h2>${dl(tabs)}</div>

    <div class="card">
      <h2>범례</h2>
      ${dlRaw([
        ['<span class="lg-input">파란색 입력칸</span>', '입력값 — 자유롭게 수정하면 전체가 재계산된다'],
        ['일반 숫자', '수식 결과 (직접 수정하지 않음)'],
        ['<span class="pos">초록</span> / <span class="neg">빨강</span>',
         '<span class="pos">이익</span> / <span class="neg">손실</span>']
      ])}
    </div>`;
}

/* =============================== 거래조건 ================================ */
function renderTerms(state) {
  const t = state.terms;
  const m = computeModel(state);
  const c = m.terms;

  return `
    <div class="grid-2">
      <div class="card">
        <h2>입력</h2>
        <p class="card-sub">기간을 바꾸면 타임라인 · Rolling 단계 · 헤지 진입 시점이 모두 따라 움직인다.</p>
        ${field('물량 (톤/월)', inp('terms.qty', t.qty, '', '1'))}
        ${field('구매 ~ 운송 (주)', inp('terms.transportWeeks', t.transportWeeks, '', '1'))}
        ${field('생산 (주)', inp('terms.mfgWeeks', t.mfgWeeks, '', '1'))}
        ${field('출고준비 (주)', inp('terms.shipPrepWeeks', t.shipPrepWeeks, '', '1'))}
        ${field('출고 (주) — 판매 QP 길이', inp('terms.shipWeeks', t.shipWeeks, '', '1'))}
        ${field('가공마진 ($/t)', inp('terms.procMargin', t.procMargin, '', '10'))}
        ${field('매입가 확정 방식',
          sel('terms.buyPriceMode', t.buyPriceMode, Object.entries(BUY_PRICE_MODES)),
          '단일 시점은 판매자 우위, 평균은 구매자 우위')}
        ${field('재고 단가 — 전월 이월 ($/t)',
          inp('inventory.prevUnit', state.inventory.prevUnit, '', '100'))}
        ${field('금월 재고 편입 물량 (톤)',
          inp('inventory.addQty', state.inventory.addQty, '', '5'),
          '편입분은 매입가와 가중평균되어 재고 단가를 갱신한다')}
        <div class="note">
          <b>재고 단가 (이동평균)</b> — ${unit(m.invUnit)}
          <span class="muted">= (기초 ${n0(m.invBaseQty)}t × ${unit(state.inventory.prevUnit)}
          + 편입 ${n0(state.inventory.addQty)}t × ${unit(m.buyPrice)}) ÷ 합계</span>.
          저가법 평가의 기준 원가가 된다.
        </div>
      </div>
      <div class="card">
        <h2>익스포저 요약</h2>
        <p class="card-sub">매입가 확정(W0) ~ 출고월 정산(W${c.shipEnd}) 사이의 가격변동마진에 노출된다.</p>
        <div class="stat-row">
          ${stat('익스포저 물량', n0(c.qty) + ' t')}
          ${stat('익스포저 기간', c.exposureWeeks + ' 주', `리드타임 ${c.leadWeeks}주 + 출고월 ${t.shipWeeks}주`)}
        </div>
        <div class="stat-row">
          ${stat('매입가', unit(m.buyPrice), m.buyLabel)}
          ${stat('출고월 평균가', unit(m.benchSale), `W${c.shipStart} ~ W${c.shipEnd}`)}
        </div>
        <div class="stat-row">
          ${stat('Hedge 진입', 'W' + c.decisionWeek, `Rolling 종료 시점 · 시장가 ${unit(m.decisionPrice)}`)}
          ${stat('미헤지 구간', `W0 ~ W${c.decisionWeek}`,
            `이 구간 변동 ${unit(m.decisionPrice - m.buyPrice)} 은 막지 못한다`,
            cls(m.decisionPrice - m.buyPrice))}
        </div>
        <div class="note">
          <b>Hedge Policy</b> — 운영 해법(Rolling)으로 익스포저를 먼저 줄이고,
          남은 잔여분만 W${c.decisionWeek}에 헤지한다. 그 대가로 W0~W${c.decisionWeek} 구간은 노출된 채 확정된다.
          이것이 ‘의사결정 지연의 비용’이다.
        </div>
      </div>
    </div>

    <div class="card">
      <h2>사업 기간: 구매 ~ 출고</h2>
      <div class="table-scroll"><table>
        <thead><tr>
          <th>단계</th><th class="num">물량 (톤)</th><th class="num">기간 (주)</th>
          <th>구간</th><th>가격</th><th>내용</th>
        </tr></thead>
        <tbody>${c.steps.map(s => `<tr>
          <td class="name">${esc(s.name)}</td>
          <td class="num">${n0(s.qty)}</td>
          <td class="num">${s.weeks}</td>
          <td class="num">${esc(s.span)}</td>
          <td>${esc(s.price)}${s.priceAlt
            ? `<span class="cell-sub">${esc(s.priceAlt)}</span>` : ''}</td>
          <td class="wide">${esc(s.rule)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>

    <div class="card">
      <h2>타임라인</h2>
      <div class="table-scroll"><table class="timeline-table">
        <thead><tr><th class="tl-week">주차</th><th>Work flow</th></tr></thead>
        <tbody>${c.timeline.map(r => `<tr class="${r.mark ? 'tl-row-' + r.mark : ''}">
          <td class="name num tl-week">${esc(r.week)}</td><td>${esc(r.event)}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="note">
        <b>출고 가격 옵션</b> —
        <b>고객 전가</b>: 매입가를 그대로 판매가에 반영, 익스포저 0.
        <b>출고월 평균</b>: 판매가를 출고월 ${t.shipWeeks}주 평균으로 확정, 매입 시점과의 시차만큼 노출.
      </div>
    </div>`;
}

/* ============================ Hedge 손익 =============================== */
function renderHedge(state) {
  const m = computeModel(state);
  const c = m.terms;
  const hp = state.hedgeParams;
  const names = state.book.map(r => r.name);
  const hedgeOpts = HEDGE_ORDER.map(k => [k, HEDGE_KINDS[k].label]);
  const condOpts = PRICE_CONDITIONS.map(v => [v, COND_LABEL[v]]);
  const convertOpts = CONVERT_TARGETS.map(v => [v, COND_LABEL[v]]);

  /* ---------- ① 시황 ---------- */
  const weekCols = m.px.map((_, i) => i);
  const priceTable = `
    <div class="table-scroll"><table class="dense">
      <thead><tr><th>시나리오＼주차</th>${weekCols.map(i =>
        `<th class="num ${i === 0 ? 'col-mark' : ''}${i === c.decisionWeek ? ' col-decide' : ''}${
          i >= c.shipStart && i <= c.shipEnd ? ' col-ship' : ''}">W${i}</th>`).join('')}</tr></thead>
      <tbody>
        ${SCENARIOS.map(sc => `<tr class="${sc === state.market.scenario ? 'row-active' : ''}">
          <td class="name">${esc(sc)}</td>
          ${weekCols.map(i => `<td class="num">${inp(`market.prices.${sc}.${i}`,
            state.market.prices[sc][i], 'cell mini', '100')}</td>`).join('')}
        </tr>`).join('')}
        <tr class="row-total">
          <td class="name">적용 가격</td>
          ${weekCols.map(i => `<td class="num">${n0(m.px[i])}</td>`).join('')}
        </tr>
      </tbody>
    </table></div>`;

  const priceChart = lineChart({
    id: 'ch-price', height: 250,
    xLabels: weekCols.map(i => 'W' + i),
    fmt: fmtUnit,
    series: SCENARIOS.map((sc, i) => ({
      name: sc, color: ['var(--c1)', 'var(--c2)', 'var(--c3)'][i],
      values: state.market.prices[sc].slice(0, m.px.length),
      dashed: sc !== state.market.scenario
    })),
    aria: '시나리오별 니켈 가격 경로'
  });

  /* ---------- ② Exposure 현황판 ---------- */
  const boardRows = m.rows.map((r, i) => {
    const h = m.hedged[i];
    return `<tr>
      <td class="name">${esc(r.name)}</td>
      <td class="num">${inp(`book.${i}.qty`, r.qty, 'cell', '5')}</td>
      <td>${sel(`book.${i}.cond`, r.cond, condOpts)}</td>
      <td class="num">${inp(`book.${i}.qpShift`, r.qpShift, 'cell mini', '1')}</td>
      <td class="num">${esc(r.qpRange)}</td>
      <td class="num">${n0(r.saleQPAvg)}</td>
      <td class="num sep">${n0(r.basisQty)}</td>
      ${r.stages.map(s => `
        <td class="num sub">${s.proposed ? n0(s.proposed) : '<span class="muted">–</span>'}</td>
        <td class="num">${n0(s.result)}</td>`).join('')}
      <td class="num sep strong">${n0(r.hedgeQty)}</td>
      <td class="num">${r.stockQty ? n0(r.stockQty) : '<span class="muted">–</span>'}</td>
      <td class="hedge-cell">${sel(`book.${i}.hedge`, r.hedge, hedgeOpts)}
        ${h.warn ? `<div class="warn-inline">⚠ ${esc(h.warn)}</div>` : ''}</td>
    </tr>`;
  }).join('');

  const boardTable = `
    <div class="table-scroll"><table>
      <thead>
        <tr>
          <th rowspan="2">구분</th><th rowspan="2" class="num">물량<br>(톤)</th>
          <th rowspan="2">초기 판가조건</th><th rowspan="2" class="num">QP 이동<br>(−4~+4)</th>
          <th rowspan="2" class="num">판매 QP</th><th rowspan="2" class="num">판매 QP<br>평균</th>
          <th rowspan="2" class="num sep">Basis<br>Exposure</th>
          ${c.stageWeeks.map(w => `<th colspan="2" class="num grp">W${w} 조치</th>`).join('')}
          <th rowspan="2" class="num sep">Hedge 대상<br>(톤)</th>
          <th rowspan="2" class="num">재고<br>(톤)</th>
          <th rowspan="2">Hedge</th>
        </tr>
        <tr>${c.stageWeeks.map(() => `<th class="num sub">제안</th><th class="num">결과</th>`).join('')}</tr>
      </thead>
      <tbody>${boardRows}</tbody>
      <tfoot><tr class="row-total">
        <td class="name">합계</td>
        <td class="num">${n0(sum(m.rows.map(r => r.qty)))}</td>
        <td colspan="4"></td>
        <td class="num sep">${n0(m.ledger.basis)}</td>
        ${m.ledger.stages.map(s => `<td class="num sub">${s.proposed ? n0(s.proposed) : '–'}</td>
          <td class="num">${n0(s.result)}</td>`).join('')}
        <td class="num sep strong">${n0(m.ledger.hedgeTargetQty)}</td>
        <td class="num">${n0(m.ledger.stockQty)}</td>
        <td></td>
      </tr></tfoot>
    </table></div>
    ${!m.ledger.qpShiftOk ? '<div class="alert">QP 이동이 ±4주를 넘었습니다.</div>' : ''}
    ${!m.ledger.noNegative ? '<div class="alert">조치 물량이 해당 계약의 초기 물량을 넘었습니다.</div>' : ''}`;

  /* ---------- ③ 조치 내용 ---------- */
  const stageOpts = c.stageWeeks.map((w, i) => [String(i + 1), `${i + 1}단계 (W${w})`]);
  const actionRows = state.actions.map((a, i) => `<tr>
      <td>${sel(`actions.${i}.stage`, String(a.stage), stageOpts)}</td>
      <td>${sel(`actions.${i}.status`, a.status, ['제안', '확정'])}</td>
      <td>${sel(`actions.${i}.target`, a.target, names)}</td>
      <td class="num">${inp(`actions.${i}.qty`, a.qty, 'cell', '5')}</td>
      <td>${sel(`actions.${i}.toCond`, a.toCond || '전가', convertOpts)}</td>
      <td class="wide">${txt(`actions.${i}.note`, a.note)}</td>
      <td><button class="btn btn-sm btn-ghost" type="button" data-act="del-action" data-i="${i}">삭제</button></td>
    </tr>`).join('');

  /* ---------- ④ Hedge 결과 — ⓐ~ⓕ 는 $/t, 물량을 곱해 금액이 된다 ---------- */
  const u = v => (v === 0 ? '<span class="muted">–</span>'
                          : `<span class="${cls(v)}">${(v < 0 ? '−' : '') + n2(Math.abs(v))}</span>`);
  const legTable = `
    <div class="table-scroll"><table>
      <thead><tr>
        <th>구분</th><th>판가조건</th><th>Hedge</th>
        <th class="num">ⓐ 미헤지 구간<br>W0~W${c.decisionWeek}</th>
        <th class="num">ⓑ 헤지 구간 노출<br>W${c.decisionWeek}~W${c.shipEnd}</th>
        <th class="num">ⓒ QP 미스매치<br>출고월평균 − W${c.shipEnd}</th>
        <th class="num">ⓓ Forward spread</th>
        <th class="num">ⓕ 브로커 수수료</th>
        <th class="num sep">소계<br>($/t)</th>
        <th class="num">× Hedge 대상<br>(톤)</th>
        <th class="num sep">= Hedge 손익</th>
        <th class="num">무대응 손익</th>
        <th class="num">Hedge − 무대응</th>
      </tr></thead>
      <tbody>${m.hedged.map(h => `<tr>
        <td class="name">${esc(h.name)}</td>
        <td class="muted">${esc(h.condLabel)}</td>
        <td>${badge(HEDGE_KINDS[h.hedge].short, 'hk-' + h.hedge)}</td>
        <td class="num">${u(h.unit.unhedged)}</td>
        <td class="num">${u(h.unit.open)}</td>
        <td class="num">${u(h.unit.mismatch)}</td>
        <td class="num">${u(h.unit.carry)}</td>
        <td class="num">${u(h.unit.fee)}</td>
        <td class="num sep strong">${u(h.subtotalUnit)}</td>
        <td class="num">${n0(h.hedgeQty)}</td>
        <td class="num sep strong">${signed(h.total)}</td>
        <td class="num">${signed(h.noHedge)}</td>
        <td class="num">${signed(h.diff)}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr class="row-total">
        <td class="name">합계</td>
        <!-- 판가조건 ~ 소계: 단가 열이라 합산하지 않는다 (8칸) -->
        <td colspan="8" class="muted">단가는 행마다 다르므로 합산하지 않는다</td>
        <td class="num">${n0(m.hedgedTotals.hedgeQty)}</td>
        <td class="num sep strong">${signed(m.hedgedTotals.total)}</td>
        <td class="num">${signed(m.hedgedTotals.noHedge)}</td>
        <td class="num">${signed(m.hedgedTotals.diff)}</td>
      </tr></tfoot>
    </table></div>
    <div class="stat-row">
      ${stat('Hedge Operation 비용', usd(m.hedgedTotals.opCost),
        `ⓓ + ⓕ — 헤지를 실행하는 데 든 값 (⑤ 손익에 같은 값으로 내려간다)`,
        cls(m.hedgedTotals.opCost))}
      ${stat('마진변동손익', usd(m.hedgedTotals.total - m.hedgedTotals.opCost),
        'ⓐ + ⓑ + ⓒ — 가격이 움직여서 생긴 값',
        cls(m.hedgedTotals.total - m.hedgedTotals.opCost))}
      ${stat('Hedge 손익 합계', usd(m.hedgedTotals.total), '두 항의 합', cls(m.hedgedTotals.total))}
      ${stat('Hedge − 무대응', usd(m.hedgedTotals.diff),
        '헤지해서 무대응보다 나아진 만큼', cls(m.hedgedTotals.diff))}
    </div>
    <div class="note">
      <b>ⓓ Forward spread란</b> — Forward를 고른 대가로 A Company가 실제로 <b>깎이는</b> 금액이다.
      <code>이론 선도가격 = 진입 시점 현물 + 금융이자 + 창고·보험료 − 적기공급 프리미엄</code>,
      여기서 브로커 스프레드를 뺀 값이 A가 받는 고정가다.
      이 중 <b>금융이자 + 창고·보험료</b>는 A가 물건을 W${c.decisionWeek}~W${c.shipEnd} 들고 있으면서
      어차피 부담하는 보유비용이고, 선도가는 딱 그만큼을 얹어 <i>보상</i>해 주는 것이라 순효과가 0이다.
      게다가 이 비용은 네 수단 모두에 똑같이 발생하므로 수단을 가르지 못한다.
      따라서 ⓓ에는 실제로 A가 넘겨주는 두 가지만 남긴다 —
      <code>ⓓ = −(적기공급 프리미엄 ${unit(hp.convenienceYield)} + 브로커 스프레드 ${unit(hp.ibSpread)}) = ${unit(m.carryPerTon)}</code>.
      <b>항상 0 이하</b>이며, 백워데이션(적기공급 프리미엄 &gt; 0)에서 크게 벌어진다.
    </div>`;

  /* ---------- ⑤ 손익 ---------- */
  const plLine = (label, key, klass = '') => `<tr class="${klass}">
    <td class="name">${esc(label)}</td>
    ${m.pnl.map(r => `<td class="num">${dash(r[key], signed)}</td>`).join('')}
    <td class="num sep strong">${signed(m.pnlTotal[key])}</td></tr>`;

  /* 메모 — 단위가 $/t 라 손익표(=$)와 섞지 않고 따로 뺀다. 읽기 전용. */
  const memoLine = (label, key, fmt, klass = '') => `<tr class="${klass}">
    <td class="name">${esc(label)}</td>
    ${m.pnl.map(r => `<td class="num">${r[key] == null
      ? '<span class="muted">–</span>' : fmt(r[key])}</td>`).join('')}
    <td class="num sep strong">${m.pnlTotal[key] == null
      ? '<span class="muted">–</span>' : fmt(m.pnlTotal[key])}</td></tr>`;
  const memoTable = `
    <details class="fold"><summary>메모 — 실현 판매단가 ($/t, 읽기 전용)</summary>
      <div class="table-scroll"><table class="memo">
        <thead><tr><th>항목</th>${m.pnl.map(r =>
          `<th class="num">${esc(r.name)}</th>`).join('')}
          <th class="num sep">가중평균</th></tr></thead>
        <tbody>
          ${memoLine('Hedge 대상 물량 (톤)', 'hedgeQty', v => n0(v), 'row-dim')}
          ${memoLine('기준 판매단가 — 출고월 평균', 'refUnit', v => unitTrim(v))}
          ${memoLine('헤지가 바꾼 단가', 'hedgeUnit', v => `<span class="${cls(v)}">${unitTrim(v)}</span>`)}
          ${memoLine('실현 판매단가 (헤지 後)', 'realizedUnit', v => unitTrim(v), 'row-key')}
        </tbody>
      </table></div>
      <p class="chart-foot">
        가격이 걸려 있던 <b>Hedge 대상 물량</b>에 대해서만 뜻이 있다 (전가·재고 물량은 제외).
        <code>실현 단가 = 출고월 평균 + (Hedge − 무대응) ÷ Hedge 대상</code> 이므로 위 손익표와 정확히 맞물린다.
        Forward의 경우 브로커가 실제 지급하는 고정가는 ${unit(m.fwdFixed)} 이지만,
        여기서는 ④와 같은 기준으로 보유비용 보상분을 상계한 뒤의 값을 쓴다.
      </p>
    </details>`;

  /* ---------- ⑥ Exposure 대응 일원화 시 ---------- */
  const cmpChart = barChart({
    id: 'ch-compare', height: 260, labelAtZero: true,
    groups: m.compare.map(x => x.label),
    series: [{ name: `Hedge 대상 ${n0(m.benchQty)}톤 손익`, color: 'var(--c1)',
               values: m.compare.map(x => x.total) }],
    aria: '대응 수단별 손익 비교'
  });

  /* ---------- ⑦ 증거금 Cash Flow ---------- */
  const limitInScale = m.future.breached || m.future.maxNeed >= hp.cashLimit * 0.4;
  const mtmChart = lineChart({
    id: 'ch-mtm', height: 230,
    xLabels: m.future.rows.map(r => 'W' + r.week),
    series: [
      { name: '누적 선물 손익 (= 누적 순현금흐름)', color: 'var(--c1)',
        values: m.future.rows.map(r => r.cum) }
    ],
    hLines: limitInScale
      ? [{ value: -hp.cashLimit, label: `현금 한도 ${usd(hp.cashLimit)}`, color: 'var(--c6)' }]
      : [],
    aria: 'Future 누적 현금흐름'
  });

  const secs = [
    ['sec-market',  '① 시황'],
    ['sec-board',   '② Exposure 현황판'],
    ['sec-action',  '③ 조치 내용'],
    ['sec-result',  '④ Hedge 결과'],
    ['sec-pnl',     '⑤ 손익'],
    ['sec-compare', '⑥ 대응 일원화'],
    ['sec-margin',  '⑦ 증거금 Cash Flow']
  ];

  return `
  <div class="sec-layout">
    ${sectionNav(secs)}
    <div class="sec-body">
    <div class="card" id="sec-market">
      <div class="card-head">
        <div>
          <h2>① 시황</h2>
          <p class="card-sub">
            시나리오를 고르면 적용 가격이 바뀌고 손익이 재계산 됩니다.
            나머지 기준값(매입가 방식 · 재고 단가)은 거래조건 탭에서 정한다.
          </p>
        </div>
        <button class="btn btn-primary" type="button" data-act="export-xlsx"
          title="개요 · 거래조건 · Hedge손익 · 참고 4개 시트를 수식까지 담아 내려받습니다">
          엑셀 다운로드
        </button>
      </div>
      <div class="inline-fields">
        ${field('적용 시나리오', sel('market.scenario', state.market.scenario, SCENARIOS))}
      </div>
      <div class="stat-row">
        ${stat('매입가', unit(m.buyPrice), m.buyLabel)}
        ${stat(`Hedge 진입가 (W${c.decisionWeek})`, unit(m.decisionPrice))}
        ${stat(`출고월 평균 (W${c.shipStart}~W${c.shipEnd})`, unit(m.benchSale))}
        ${stat(`정산일 단일가 (W${c.shipEnd})`, unit(m.settlePrice))}
        ${stat('재고 단가', unit(m.invUnit), `기초 ${n0(m.invBaseQty)}t + 신규 ${n0(state.inventory.addQty)}t`)}
      </div>
      ${priceChart}
      <details class="fold"><summary>시나리오 가격표 편집 (파란 칸)</summary>
        <div class="toolbar">
          <button class="btn btn-sm btn-input" type="button" data-act="dl-prices">↓ 가격표 양식 내려받기 (CSV)</button>
          <label class="btn btn-sm btn-input file-btn">↑ 가격표 올리기
            <input type="file" accept=".csv,text/csv" data-act="ul-prices" hidden>
          </label>
          <span class="toolbar-hint">
            내려받은 CSV를 PC에서 수정하여 업로드하면 반영됩니다. 열 = 주차, 행 = 시나리오.
          </span>
        </div>
        ${priceTable}
      </details>
    </div>

    <div class="card" id="sec-board">
      <h2>② Exposure 현황판</h2>
      <p class="card-sub">
        각 계약은 <b>초기 가격 조건</b>으로 시작하고, W${c.stageWeeks.join(' · W')} 조치가 그 물량 일부를
        다른 가격 조건으로 옮긴다. <b>제안</b>은 <b>확정</b>하여야 반영된다.
      </p>
      ${boardTable}
      <div class="stat-row">
        ${stat('Basis 합계', n0(m.ledger.basis) + ' t', '초기 가격 조건 기준 Exposure')}
        ${stat('운영을 통한 Exposure 제거', n0(m.ledger.removedByOps) + ' t', '고객 전가로 전환된 물량')}
        ${stat('Hedge 대상', n0(m.ledger.hedgeTargetQty) + ' t', `W${c.decisionWeek} 시점 판매 확정 잔여`)}
      </div>
      <div class="note">
        <b>재고는 Hedge 대상이 아니다</b> — 판매가 확정되지 않은 재고는
        Exposure에는 남아 있지만 Hedge하지 않는다. 헤지는 변수를 상수로 막는 것이지,
        0을 상수로 막는 것은 의미가 없다. 재고는 저가법 평가 대상이다.
      </div>
    </div>

    <div class="card" id="sec-action">
      <div class="card-head">
        <div><h2>③ 조치 내용</h2>
        <p class="card-sub">Rolling — 추가 판매와 가격 조건 협상으로 Exposure를 줄인다.</p></div>
        <button class="btn btn-sm" type="button" data-act="add-action">행 추가</button>
      </div>
      <div class="table-scroll"><table>
        <thead><tr><th>단계</th><th>상태</th><th>대상</th><th class="num">물량 (톤)</th>
          <th>전환 후 가격 조건</th><th>조치 · 비고</th><th></th></tr></thead>
        <tbody>${actionRows || '<tr><td colspan="7" class="muted">조치 없음</td></tr>'}</tbody>
      </table></div>
      <div class="note">
        <b>미결 과제</b> — 출고월(W${c.shipStart}~W${c.shipEnd}) 진입 이후 발생하는 물량 변동 요구는
        아직 이 표에서 다루지 않는다. 명목상 3개월 전 확정이지만 실무에서는 자주 발생하는 상황이라
        별도 처리 방안이 필요하다.
      </div>
    </div>

    <div class="card" id="sec-result">
      <h2>④ Hedge 결과</h2>
      <p class="card-sub">
        Hedge 손익 = (ⓐ 미헤지 구간 + ⓑ 헤지 구간 노출 + ⓒ QP 미스매치 + ⓓ Forward spread
        + ⓕ 브로커 수수료) × Hedge 대상 물량. 어느 칸에 숫자가 남는지가 곧 그 수단의 속성이다.
        <b>ⓓ + ⓕ 만 헤지를 실행한 비용</b>이고 ⓐⓑⓒ는 가격이 움직여서 생긴 마진변동손익이다.
        재고 저가법은 헤지가 한 일이 아니므로 여기 넣지 않고 ⑤ 손익에서 계상한다.
      </p>
      ${legTable}
      <div class="grid-2">
        <div class="note">
          <b>ⓒ가 Future에만 남는 이유</b> — 거래소 표준계약은 W${c.shipEnd} 단일가로 정산되는데
          판매는 출고월 ${state.terms.shipWeeks}주 평균이라
          <b>${unit(m.benchSale - m.settlePrice)}</b> 만큼 어긋난다.
          Forward는 QP를 협상해 이 구간을 맞출 수 있어 ⓒ가 0이다.
        </div>
        <div class="note">
          <b>ⓐ는 네 수단이 모두 같다</b> — W0~W${c.decisionWeek} 구간은 Rolling이 끝나기 전이라
          아직 헤지하지 않았다. 수단 선택으로는 줄일 수 없고, <i>의사결정을 앞당겨야</i> 줄어든다.
        </div>
      </div>
      <h3 class="sub-head">Hedge 파라미터</h3>
      <div class="param-grid">
        ${field('연 이자율 (%)', inp('hedgeParams.ratePct', hp.ratePct, '', '0.5'), '보유비용의 금융이자 부분')}
        ${field('창고 · 보험료 ($/t)', inp('hedgeParams.storage', hp.storage, '', '10'),
          '보유비용의 물류 부분')}
        ${field('적기공급 프리미엄 ($/t)', inp('hedgeParams.convenienceYield', hp.convenienceYield, '', '100'),
          '백워데이션에서 > 0 — ⓓ를 키운다')}
        ${field('브로커 스프레드 ($/t)', inp('hedgeParams.ibSpread', hp.ibSpread, '', '10'),
          '고정가에 내재 — 청구서에 안 보임')}
        ${field('브로커 수수료 · Forward ($/t)', inp('hedgeParams.ibFeeForward', hp.ibFeeForward, '', '0.5'),
          '명시 청구 → 원가 계상')}
        ${field('브로커 수수료 · Future ($/t)', inp('hedgeParams.ibFeeFuture', hp.ibFeeFuture, '', '0.5'),
          'round-turn (진입 + 청산)')}
      </div>
      <div class="stat-row">
        ${stat('이론 선도가격', unit(m.fwdTheory),
          `W${c.decisionWeek} 현물 + 이자 ${unit(m.fwdInterest)} + 창고 ${unit(hp.storage)} − 편의수익 ${unit(hp.convenienceYield)}`)}
        ${stat('A가 받는 고정가', unit(m.fwdFixed), `이론가 − 브로커 스프레드 ${unit(hp.ibSpread)}`)}
        ${stat('ⓓ 단가 효과', unit(m.carryPerTon), '−(편의수익 + 스프레드)', cls(m.carryPerTon))}
        ${stat('헤지 기간', `${c.hedgeWeeks} 주`, `≈ ${n1(m.hedgeMonths)} 개월`)}
      </div>
    </div>

    <div class="card" id="sec-pnl">
      <h2>⑤ 손익 (USD)</h2>
      <p class="card-sub">
        ④를 행과 열만 바꿔 회계 형태로 옮긴 것이다. 매출·재료비는 판매 확정된 물량만 계상한다.
      </p>
      ${leadBlock('notes.pnlLead', state.notes.pnlLead,
        '표 위에 실릴 한 줄 — 여기 적은 문장이 엑셀 ⑤ 손익 시트에도 같이 실린다')}
      <div class="table-scroll"><table>
        <thead><tr><th>항목</th>${m.pnl.map(r =>
          `<th class="num">${esc(r.name)}<br><span class="th-sub">${esc(HEDGE_KINDS[r.hedge].short)}</span></th>`).join('')}
          <th class="num sep">합계</th></tr></thead>
        <tbody>
          ${plLine('매출액', 'revenue')}
          ${plLine('재료비', 'material')}
          ${plLine('마진 (매출 + 재료비)', 'margin', 'row-sub')}
          ${plLine('　└ 가공마진 (상수)', 'procMargin', 'row-dim')}
          ${plLine('　└ 가격변동마진 (변수)', 'priceMargin', 'row-dim')}
          ${plLine('재고 평가손실 (저가법)', 'stockLcm')}
          <tr class="row-gap"><td colspan="${m.pnl.length + 2}"></td></tr>
          ${plLine('손익 — 무대응', 'plNoHedge', 'row-key')}
          <tr class="row-gap"><td colspan="${m.pnl.length + 2}"></td></tr>
          ${plLine('Hedge 효과 (가격 상쇄)', 'hedgeEffect')}
          ${plLine('Hedge Operation 비용', 'opCost', 'row-sub')}
          ${plLine('　└ Forward spread (가격에 내재)', 'carryCost', 'row-dim')}
          ${plLine('　└ 브로커 수수료 (명시 청구)', 'ibFee', 'row-dim')}
          ${plLine('손익 — Hedge', 'plHedged', 'row-key')}
          <tr class="row-gap"><td colspan="${m.pnl.length + 2}"></td></tr>
          ${plLine('차이 (Hedge − 무대응)', 'delta', 'row-key')}
        </tbody>
      </table></div>
      ${memoTable}
      <div class="grid-2">
        <div class="note">
          <b>재고 평가손실은 헤지 선택과 무관하다</b> — 판매 미확정 재고 ${n0(m.ledger.stockQty)}톤에
          저가법을 적용한 ${usd(m.hedgedTotals.stockLcm)}는 무대응이든 헤지든 똑같이 발생하므로
          <b>손익 — 무대응</b> 위에 두었다. 그래서 마지막 <b>차이</b> 행에는 헤지가 실제로 만든 값만 남는다.
        </div>
        <div class="note">
          <b>비용과 가격 상쇄를 갈라 놓았다</b> — 브로커가 가져가는 몫은
          <b>가격에 내재된 스프레드 ${usd(-m.pnlTotal.carryCost)}</b> 와
          <b>청구서에 찍히는 수수료 ${usd(-m.pnlTotal.ibFee)}</b> 둘인데, 성격이 같으므로 나란히 세웠다.
          둘의 합 <b>${usd(-m.pnlTotal.opCost)}</b> 은 ④의 <i>Hedge Operation 비용</i>과 같은 값이다.
          남는 <b>Hedge 효과 (가격 상쇄)</b> 는 순수하게 가격 변동을 얼마나 바꿨는지만 담는다.
        </div>
      </div>
      <div class="note">
        통화는 USD 단일 — 환율은 실적 차이 분석의 원인 항목일 뿐 Rule Book의 범위 밖이다.
      </div>
    </div>

    <div class="card" id="sec-compare">
      <h2>⑥ Exposure 대응 일원화 시</h2>
      <p class="card-sub">
        What-if — Hedge 대상 ${n0(m.benchQty)}톤 전부를 한 가지 수단으로 몰았다면.
        재고 저가법은 헤지와 무관하므로 여기서도 빼고 ⑤ 손익에서만 다룬다.
      </p>
      ${cmpChart}
      <div class="table-scroll"><table>
        <thead><tr><th>케이스</th><th>성격</th>
          <th class="num">ⓐ 미헤지</th><th class="num">ⓑ 노출</th><th class="num">ⓒ 미스매치</th>
          <th class="num">ⓓ Forward spread</th><th class="num">ⓕ 수수료</th>
          <th class="num sep">Operation 비용<br>(ⓓ+ⓕ)</th>
          <th class="num">합계</th></tr></thead>
        <tbody>${m.compare.map(x => `<tr class="${x.key === 'current' ? 'row-key' : ''}">
          <td class="name">${badge(x.label, 'hk-' + (x.key === 'current' ? 'cur' : x.key))}</td>
          <td class="muted">${esc(x.nature)}</td>
          <td class="num">${dash(x.legs.unhedged, signed)}</td>
          <td class="num">${dash(x.legs.open, signed)}</td>
          <td class="num">${dash(x.legs.mismatch, signed)}</td>
          <td class="num">${dash(x.legs.carry, signed)}</td>
          <td class="num">${dash(x.legs.fee, signed)}</td>
          <td class="num sep">${dash(x.opCost, signed)}</td>
          <td class="num strong">${signed(x.total)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>

    <div class="card" id="sec-margin">
      <h2>⑦ 증거금 Cash Flow</h2>
      <p class="card-sub">
        What-if — Forward와 Future의 최종 손익 차이는 미스매치뿐이지만, <b>가는 길</b>이 다르다.
        Future는 매주 정산되어 현금이 오간다. W${c.decisionWeek} 진입 ~ W${c.shipEnd} 청산.
      </p>
      <div class="stat-row">
        ${stat('숏 물량', n0(m.future.qty) + ' t', m.future.qty ? `진입 ${unit(m.future.entry)} → 청산 ${unit(m.future.exit)}` : '')}
        ${stat('개시증거금', usd(m.future.initialMargin), `진입가 × 물량 × ${n1(hp.imRatePct)}%`)}
        ${stat('누적 납부 필요액 최대', usd(m.future.maxNeed), `W${m.future.peakWeek} 시점`, m.future.maxNeed > 0 ? 'neg' : '')}
        ${stat('현금 한도 대비', m.future.breached ? '초과 → 강제청산' : '버팀',
          `여유 ${usd(m.future.headroom)}`, m.future.breached ? 'neg' : 'pos')}
      </div>
      ${m.future.breached ? `<div class="alert">
        누적 납부 필요액 ${usd(m.future.maxNeed)} 이 현금 한도 ${usd(hp.cashLimit)} 을 넘었습니다 — 강제청산 구간입니다.
        최종 손익이 흑자여도 <b>버티는 기간의 현금흐름</b>을 못 대면 정점에서 손실이 확정됩니다.
      </div>` : ''}
      ${mtmChart}
      ${!limitInScale && m.future.maxNeed > 0 ? `<p class="chart-foot">
        현금 한도 ${usd(hp.cashLimit)} 는 축 밖이라 표시하지 않았습니다 —
        최대 납부액 ${usd(m.future.maxNeed)} 는 한도의 ${(m.future.maxNeed / hp.cashLimit * 100).toFixed(1)}% 입니다.
      </p>` : ''}
      <details class="fold"><summary>주간 시가평가 상세 (W${c.decisionWeek} ~ W${c.shipEnd})</summary>
        <div class="table-scroll"><table>
          <thead><tr><th>주차</th><th class="num">LME 가격 ($/t)</th>
            <th class="num">주간 선물 손익<br>(− 납부 / + 환급)</th>
            <th class="num">누적 선물 손익<br>(= 누적 순현금흐름)</th>
            <th class="num">누적 납부 필요액</th></tr></thead>
          <tbody>${m.future.rows.map(r => `<tr>
            <td class="name">${esc(r.label)}</td>
            <td class="num">${n0(r.price)}</td>
            <td class="num">${dash(r.weekly, signed)}</td>
            <td class="num">${dash(r.cum, signed)}</td>
            <td class="num ${r.need > hp.cashLimit ? 'neg strong' : ''}">${r.need ? usd(r.need) : '–'}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </details>
      <div class="inline-fields">
        ${field('개시증거금율 (%)', inp('hedgeParams.imRatePct', hp.imRatePct, '', '1'))}
        ${field('가용 현금 한도 ($)', inp('hedgeParams.cashLimit', hp.cashLimit, '', '100000'))}
      </div>
      <div class="note">
        <b>헤지의 진짜 리스크</b> — 최종 손익이 아니라 버티는 기간의 현금흐름이다.
        가격이 급등하면 숏은 매주 납부해야 하고, 그 현금을 못 대면 정점에서 강제청산된다 (2022년 LME 니켈 사태).
        Forward는 이 표가 통째로 비어 있고, 대신 그 유동성 부담을 브로커가 지므로 스프레드에 얹힌다.
      </div>
    </div>
    </div>
  </div>`;
}

/* ================================ 참고 =================================== */
function renderRef() {
  return `
    <div class="card">
      <h2>단위 환산 — 니켈 금속 ↔ 황산니켈</h2>
      <p class="card-sub">${esc(REF_UNIT.headline)}</p>
      <div class="table-scroll"><table>
        <thead><tr><th>구분</th><th>값</th></tr></thead>
        <tbody>${REF_UNIT.rows.map(([k, v]) =>
          `<tr><td class="name">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody>
      </table></div>
      ${REF_UNIT.notes.map(t => `<div class="note">${esc(t)}</div>`).join('')}
    </div>

    <div class="card">
      <h2>니켈 원료 수송 기간</h2>
      <p class="card-sub">거래조건 탭의 ‘구매 ~ 운송’ 기간을 정할 때의 근거 자료.</p>
      <div class="table-scroll"><table>
        <thead><tr><th>출발지</th><th>소요 기간</th><th>비고</th></tr></thead>
        <tbody>${REF_SHIPPING.map(([a, b, c]) =>
          `<tr><td class="name">${esc(a)}</td><td>${esc(b)}</td><td class="wide">${esc(c)}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="note">출처: Fluent Cargo, Indonesia Business Post. 모델 기본값은 2주로 단순화했다.</div>
    </div>

    <div class="card">
      <h2>용어집</h2>
      <p class="card-sub">업계 표준 용어의 Full Name과 정의 — ${GLOSSARY.length}개.</p>
      <div class="table-scroll"><table>
        <thead><tr><th>용어</th><th>Full Name</th><th>정의</th></tr></thead>
        <tbody>${GLOSSARY.map(([a, b, c]) =>
          `<tr><td class="name">${esc(a)}</td><td class="mono">${esc(b)}</td><td class="wide">${esc(c)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>`;
}

/* ================================ 탭 ===================================== */
const TABS = [
  { id: 'overview', label: '개요',          render: renderOverview },
  { id: 'terms',    label: '거래조건',       render: renderTerms },
  { id: 'hedge',    label: 'Hedge 손익',  render: renderHedge },
  { id: 'ref',      label: '참고',          render: renderRef }
];
