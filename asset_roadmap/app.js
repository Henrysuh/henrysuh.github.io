const PERSONAS = [
  {key:'설계자',cls:'D',nick:'아치'},
  {key:'소비자',cls:'G',nick:'샤이니'},
  {key:'노동자',cls:'W',nick:'그라인드'},
];

let ITEMS = [];
let FILTERED = [];
let CATS = [];
let basePersona = null;
let household = null;
let catPersona = {};
let loan = { principal: 0, termYears: 10, rate: 4 };
let currentAssets = 0;
let collapsedCats = new Set();
let comparisonMode = false;
let userCategoryAvgs = {};
let userActualTotal = 0;
let compareAnnualView = false;

const dataLoadPromise = fetch('./data.json').then(r=>r.json()).then(d=>{ d.forEach((item, i) => { item._idx = i; }); ITEMS = d; });

function fmt(n){ return Math.round(n).toLocaleString('ko-KR'); }
function nickOf(key){ return PERSONAS.find(p=>p.key===key).nick; }
function clsOf(key){ return PERSONAS.find(p=>p.key===key).cls; }

// ══ STEP 0: LOGIN/START (LocalStorage 저장/복원) ══

const SAVE_KEY = 'lifegame_state_v1';

function saveState() {
  const sliders = projInitialized ? {
    income: document.getElementById('sl-income').value,
    years: document.getElementById('sl-years').value,
    ret: document.getElementById('sl-return').value,
    retire: document.getElementById('sl-retire').value,
    locked: sliderLocked,
  } : null;
  const state = {
    basePersona, household, catPersona, loan, trophyStack, trophyLocked,
    currentAssets,
    comparisonMode, userCategoryAvgs, userActualTotal, sliders,
    items: ITEMS.map(i => ({ _idx: i._idx, 설계자: i.설계자, 소비자: i.소비자, 노동자: i.노동자 })),
  };
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

function initLoginScreen() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return;
  try {
    const state = JSON.parse(raw);
    if (!state.basePersona || !state.household) return;
    document.getElementById('btn-continue').disabled = false;
    document.getElementById('saved-state-note').textContent =
      `이전 기록: ${nickOf(state.basePersona)} / ${state.basePersona} · ${state.household}`;
  } catch (e) { /* 저장된 데이터가 깨졌으면 이어하기 비활성 유지 */ }
}

function continueSaved() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return;
  const state = JSON.parse(raw);
  dataLoadPromise.then(() => {
    basePersona = state.basePersona;
    household = state.household;
    catPersona = state.catPersona;
    loan = state.loan || { principal: 0, termYears: 10, rate: 4 };
    trophyStack = state.trophyStack || [];
    trophyLocked = state.trophyLocked || false;
    currentAssets = state.currentAssets || 0;
    comparisonMode = state.comparisonMode || false;
    userCategoryAvgs = state.userCategoryAvgs || {};
    userActualTotal = state.userActualTotal || 0;

    (state.items || []).forEach(saved => {
      const item = ITEMS.find(i => i._idx === saved._idx);
      if (item) { item.설계자 = saved.설계자; item.소비자 = saved.소비자; item.노동자 = saved.노동자; }
    });
    FILTERED = filterByHousehold(ITEMS, household);
    CATS = getCategoriesInOrder(FILTERED);

    const badge = nickOf(basePersona) + ' / ' + basePersona;
    ['s2-badge','s3-badge','s4-badge','s4b-badge','s5-badge','s6-badge'].forEach(id => {
      document.getElementById(id).textContent = badge;
    });

    if (state.sliders) {
      projInitialized = true;
      sliderLocked = state.sliders.locked;
      document.getElementById('sl-income').value = state.sliders.income;
      document.getElementById('sl-years').value = state.sliders.years;
      document.getElementById('sl-return').value = state.sliders.ret;
      document.getElementById('sl-retire').value = state.sliders.retire;
    }

    gotoStep(4);
    renderResults();
  });
}

function startFresh() {
  gotoStep(1);
}

function gotoStep(n) {
  document.querySelectorAll('.step').forEach(s=>s.classList.remove('active'));
  document.getElementById('s'+n).classList.add('active');
  window.scrollTo(0,0);
}

function selectBasePersona(key) {
  basePersona = key;
  const badge = nickOf(key) + ' / ' + key;
  ['s2-badge','s3-badge','s4-badge','s4b-badge','s5-badge','s6-badge'].forEach(id => {
    document.getElementById(id).textContent = badge;
  });
  gotoStep(2);
}

function selectHousehold(hh, btn) {
  household = hh;
  document.querySelectorAll('.hh-btn').forEach(b=>b.classList.remove('selected'));
  btn.classList.add('selected');
  document.getElementById('hh-warning').style.display = 'none';
  FILTERED = filterByHousehold(ITEMS, hh);
  CATS = getCategoriesInOrder(FILTERED);
  resetCatPersona();
}

function resetCatPersona() {
  catPersona = {};
  CATS.forEach(c => catPersona[c] = basePersona);
}

function tryProceedToStep3() {
  if (!household) {
    const w = document.getElementById('hh-warning');
    w.style.display = 'block';
    w.scrollIntoView({behavior:'smooth', block:'nearest'});
    return;
  }
  gotoStep(3);
  renderCategoryTabs();
}

let expandedUid = null;

const CODE_GROUPS = { 1: ['capex'], 2: ['opex'], 3: ['con'], 4: ['capex','opex'], 5: ['capex','con'], 6: ['opex','con'], 7: [], 8: ['opex'] };
const CODE_LABELS = { 1: 'CAPEX', 2: 'OPEX', 3: 'Consumable', 4: 'CAPEX+OPEX', 5: 'CAPEX+소모품', 6: 'OPEX+소모품', 7: '지인찬스', 8: 'Utility' };

// code(1-8)가 정의하는 그룹만 값을 갖도록 맞춘다 — 그룹 밖 필드는 null로, 그룹 안 필드는 null이면 기본값(0/1)으로 채운다.
function normalizeItemGroups(p) {
  const active = CODE_GROUPS[p.code] || [];
  if (active.includes('capex')) {
    if (p.qty == null) p.qty = 1;
    if (p.price == null) p.price = 0;
    if (p.life == null) p.life = 1;
  } else { p.qty = null; p.price = null; p.life = null; }
  if (active.includes('opex')) {
    if (p.freq == null) p.freq = 0;
    if (p.period == null) p.period = 0;
    if (p.unit == null) p.unit = 0;
  } else { p.freq = null; p.period = null; p.unit = null; }
  if (active.includes('con')) {
    if (p.conP == null) p.conP = 0;
    if (p.conL == null) p.conL = 1;
  } else { p.conP = null; p.conL = null; }
}

function varInput(idx, pKey, field, value, unit, min) {
  return `<label class="var-field">${unit}<input type="number" min="${min}" value="${value}"
    onchange="updateItemVar(${idx},'${pKey}','${field}',this.value)"></label>`;
}

function codeSelect(idx, pKey, code) {
  const options = Object.keys(CODE_LABELS).map(c =>
    `<option value="${c}" ${+c === code ? 'selected' : ''}>${c}. ${CODE_LABELS[c]}</option>`
  ).join('');
  return `<select class="code-select" onchange="updateItemCode(${idx},'${pKey}',this.value)">${options}</select>`;
}

function renderItemVarInputs(idx, pKey, vars) {
  if (!vars) return '<div class="uid-item-vars">해당 없음</div>';
  normalizeItemGroups(vars);
  const active = CODE_GROUPS[vars.code] || [];
  const groups = [];
  if (active.includes('capex')) {
    groups.push(`<div class="var-group">
      ${varInput(idx, pKey, 'price', vars.price, '가격(원)', 0)}
      ${varInput(idx, pKey, 'qty', vars.qty, '개수', 0)}
      ${varInput(idx, pKey, 'life', vars.life, '내용연수(년)', 1)}
    </div>`);
  }
  if (active.includes('opex')) {
    const freqLabel = vars.code === 8 ? '월 사용시간' : '사용빈도';
    groups.push(`<div class="var-group">
      ${varInput(idx, pKey, 'freq', vars.freq, freqLabel, 0)}
      ${varInput(idx, pKey, 'period', vars.period, '기간', 0)}
      ${varInput(idx, pKey, 'unit', vars.unit, '단가(원)', 0)}
    </div>`);
  }
  if (active.includes('con')) {
    groups.push(`<div class="var-group">
      ${varInput(idx, pKey, 'conP', vars.conP, '소모품가격(원)', 0)}
      ${varInput(idx, pKey, 'conL', vars.conL, '소모품수명(년)', 1)}
    </div>`);
  }
  const body = groups.length ? groups.join('') : '<div class="uid-item-vars">해당 없음</div>';
  return `<div class="uid-item-code">${codeSelect(idx, pKey, vars.code)}</div>${body}`;
}

function updateItemVar(idx, pKey, field, rawValue) {
  const value = rawValue === '' ? null : +rawValue;
  ITEMS[idx][pKey][field] = value;
  renderCategoryTabs();
}

function updateItemCode(idx, pKey, rawCode) {
  const p = ITEMS[idx][pKey];
  p.code = +rawCode;
  normalizeItemGroups(p);
  renderCategoryTabs();
}

function renderFinancialStatusBox() {
  const monthlyPrincipal = loan.termYears > 0 ? loan.principal / loan.termYears / 12 : 0;
  const monthlyInterest = loan.principal * loan.rate / 100 / 12;

  return `<div class="cat-tab-row fu">
    <div class="cat-tab-hdr-row">
      <div class="cat-tab-name">💰 현재 재무 상태</div>
    </div>

    <div class="fin-status-subsection">
      <div class="fin-status-label">현재 금융자산 — 재무 프로젝션 시작 자산에 반영됩니다</div>
      <label class="var-field">금융자산(백만원)<input type="number" min="0" step="0.1" value="${currentAssets / 1000000}" onchange="updateCurrentAssets(this.value)"></label>
    </div>

    <div class="fin-status-subsection">
      <div class="fin-status-label">대출</div>
      <div class="var-group">
        <label class="var-field">대출 원금(백만원)<input type="number" min="0" step="0.1" value="${loan.principal / 1000000}" onchange="updateLoan('principal',this.value)"></label>
        <label class="var-field">상환기간(년)<input type="number" min="1" value="${loan.termYears}" onchange="updateLoan('termYears',this.value)"></label>
        <label class="var-field">대출금리(%)<input type="number" min="0" step="0.1" value="${loan.rate}" onchange="updateLoan('rate',this.value)"></label>
      </div>
      ${loan.principal > 0 ? `<div class="loan-estimate">초기 월 상환 예상: 원금 ${fmt(monthlyPrincipal)}원 + 이자 ${fmt(monthlyInterest)}원 (재무 프로젝션에 반영, 상환기간 이후 소멸)</div>` : ''}
    </div>
  </div>`;
}

function updateCurrentAssets(rawValue) {
  currentAssets = (+rawValue || 0) * 1000000;
  renderCategoryTabs();
}

function updateLoan(field, rawValue) {
  loan[field] = field === 'principal' ? (+rawValue || 0) * 1000000 : +rawValue;
  renderCategoryTabs();
}

function toggleCatCollapse(cat) {
  if (collapsedCats.has(cat)) collapsedCats.delete(cat); else collapsedCats.add(cat);
  renderCategoryTabs();
}

function toggleAllCatsCollapse() {
  const allCollapsed = CATS.every(c => collapsedCats.has(c));
  if (allCollapsed) collapsedCats.clear();
  else CATS.forEach(c => collapsedCats.add(c));
  renderCategoryTabs();
}

function confirmButtonLabel() {
  const total = grandTotal(FILTERED, catPersona);
  return `총 ${fmt(total)}원/월로 확정하고 결과 보기 →`;
}

function renderCategoryTabs() {
  const allCollapsed = CATS.length > 0 && CATS.every(c => collapsedCats.has(c));
  document.getElementById('btn-collapse-all').textContent = allCollapsed ? '▾ 전체 펼치기' : '✕ 전체 접기';
  document.getElementById('btn-confirm-total-top').textContent = confirmButtonLabel();

  const wrap = document.getElementById('cat-tabs');
  wrap.innerHTML = renderFinancialStatusBox() + CATS.map(cat => {
    const pills = PERSONAS.map(p => {
      const sub = categorySubtotal(FILTERED, cat, p.key);
      const active = catPersona[cat] === p.key;
      return `<button class="persona-pill ${p.cls}${active?' active':''}" onclick="setCatPersona('${cat}','${p.key}')">
        <span class="pill-nick">${p.nick}</span><span class="pill-amt">${fmt(sub)}원/월</span>
      </button>`;
    }).join('');

    const pKey = catPersona[cat];
    const groups = groupItemsByUid(FILTERED.filter(i => i.대분류 === cat), pKey);
    const uidRows = groups.map(g => {
      const uidKey = cat + '::' + g.uid;
      const open = expandedUid === uidKey;
      const total = g.items.reduce((sum, it) => sum + it.cost, 0);
      const itemRows = !open ? '' : g.items.map(it => `<div class="uid-item-row">
          <div class="uid-item-top">
            <span class="uid-item-name">${it.아이템}</span>
            <span class="uid-item-cost">${fmt(it.cost)}원/월</span>
          </div>
          <div class="uid-item-desc">${it.approach ? `<span class="uid-item-approach">${it.approach}</span>` : ''}${it.실행 || '—'}</div>
          ${renderItemVarInputs(it.idx, pKey, it.vars)}
        </div>`).join('');
      return `<div class="uid-block">
        <div class="uid-hdr" onclick="toggleUidDetail('${uidKey}')">
          <span class="uid-hdr-name">${g.소분류}</span>
          <span class="uid-hdr-amt">${fmt(total)}원/월</span>
          <span class="uid-hdr-chev${open ? ' open' : ''}">▾</span>
        </div>
        <div class="uid-body${open ? ' open' : ''}">${itemRows}</div>
      </div>`;
    }).join('');

    const collapsed = collapsedCats.has(cat);
    return `<div class="cat-tab-row fu">
      <div class="cat-tab-hdr-row">
        <div class="cat-tab-name">${cat}</div>
        <button class="cat-collapse-btn" onclick="toggleCatCollapse('${cat}')" title="${collapsed ? '펼치기' : '접기'}">${collapsed ? '▾ 펼치기' : '✕ 접기'}</button>
      </div>
      <div class="cat-tab-pills">${pills}</div>
      ${collapsed ? '' : `<div class="uid-list">${uidRows}</div>`}
    </div>`;
  }).join('') + `<button class="proceed-btn confirm-bottom-btn" onclick="gotoResults()">${confirmButtonLabel()}</button>`;
  saveState();
}

function toggleUidDetail(uidKey) {
  expandedUid = (expandedUid === uidKey) ? null : uidKey;
  renderCategoryTabs();
}

function setCatPersona(cat, key) {
  catPersona[cat] = key;
  renderCategoryTabs();
}

function gotoResults() {
  gotoStep(4);
  renderResults();
}

function renderResults() {
  const total = grandTotal(FILTERED, catPersona);
  document.getElementById('result-hero').innerHTML = `
    <div class="result-persona-label">${nickOf(basePersona)} 기준 (대분류별 조정 반영)</div>
    <div class="result-total">${fmt(total)}<span>원/월</span></div>
    <div class="result-monthly-note">${household} · ${CATS.length}개 대분류</div>`;

  const accordion = CATS.map((cat, ci) => {
    const pKey = catPersona[cat];
    const catTotal = categorySubtotal(FILTERED, cat, pKey);
    const subs = groupByUid(FILTERED.filter(i => i.대분류 === cat), pKey);
    const rows = subs.map(s => `<div class="subcat-row">
        <span class="subcat-name">${s.소분류}</span>
        <span class="subcat-amt">${fmt(s.total)}원</span>
      </div>`).join('');
    return `<div class="cat-block">
      <div class="cat-hdr" id="ch${ci}" onclick="toggleCatHdr(${ci})">
        <span class="cat-hdr-name">${cat}</span>
        <span class="cat-persona-badge ${clsOf(pKey)}">${nickOf(pKey)}</span>
        <span class="cat-hdr-count">${fmt(catTotal)}원</span>
        <span class="cat-hdr-chev">▾</span>
      </div>
      <div class="cat-body" id="cb${ci}">${rows}</div>
    </div>`;
  }).join('');
  document.getElementById('result-actions').innerHTML = accordion;
}

function toggleCatHdr(ci) {
  document.getElementById('ch'+ci).classList.toggle('open');
  document.getElementById('cb'+ci).classList.toggle('open');
}

function startCharacterPath() {
  comparisonMode = false;
  gotoStep(5);
  renderAnalysis();
}

function startComparePath() {
  userCategoryAvgs = {};
  userActualTotal = 0;
  compareAnnualView = false;
  document.getElementById('compare-table').innerHTML = '';
  document.getElementById('btn-goto-analysis-compare').disabled = true;
  document.getElementById('btn-download-compare').disabled = true;
  document.getElementById('btn-compare-annual').textContent = '월간 보기';
  gotoStep('4b');
}

// ══ STEP 4.1: BANK SALAD UPLOAD/COMPARE ══

function downloadTemplate() {
  const header = '대분류,월평균(원)\n';
  const rows = CATS.map(c => `${c},`).join('\n');
  downloadCSV('뱅크샐러드_실적_템플릿.csv', header + rows);
}

function downloadCSV(filename, content) {
  const csv = '﻿' + content;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result.replace(/^﻿/, '');
    const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
    const map = {};
    lines.slice(1).forEach(line => {
      const [cat, val] = line.split(',');
      if (cat && CATS.includes(cat.trim())) {
        map[cat.trim()] = +val || 0;
      }
    });
    userCategoryAvgs = map;
    userActualTotal = Object.values(map).reduce((s, v) => s + v, 0);
    document.getElementById('btn-goto-analysis-compare').disabled = false;
    document.getElementById('btn-download-compare').disabled = false;
    renderCompareTable();
    saveState();
  };
  reader.readAsText(file, 'UTF-8');
}

function toggleCompareAnnual() {
  compareAnnualView = !compareAnnualView;
  document.getElementById('btn-compare-annual').textContent = compareAnnualView ? '연간 보기' : '월간 보기';
  renderCompareTable();
}

function renderCompareTable() {
  const mult = compareAnnualView ? 12 : 1;
  const rows = CATS.map(cat => {
    const plan = categorySubtotal(FILTERED, cat, catPersona[cat]) * mult;
    const actual = (userCategoryAvgs[cat] || 0) * mult;
    const diff = actual - plan;
    return `<div class="compare-row">
      <span class="compare-cat">${cat}</span>
      <span class="compare-plan">${fmt(plan)}원</span>
      <span class="compare-actual">${fmt(actual)}원</span>
      <span class="compare-diff ${diff > 0 ? 'over' : 'under'}">${diff > 0 ? '+' : ''}${fmt(diff)}원</span>
    </div>`;
  }).join('');
  const planTotal = grandTotal(FILTERED, catPersona) * mult;
  const actualTotal = userActualTotal * mult;
  const totalDiff = actualTotal - planTotal;
  document.getElementById('compare-table').innerHTML = `
    <div class="compare-row compare-hdr">
      <span class="compare-cat">대분류</span><span class="compare-plan">계획</span><span class="compare-actual">실적</span><span class="compare-diff">차이</span>
    </div>
    ${rows}
    <div class="compare-row compare-total">
      <span class="compare-cat">합계 (${compareAnnualView ? '연간' : '월간'})</span>
      <span class="compare-plan">${fmt(planTotal)}원</span>
      <span class="compare-actual">${fmt(actualTotal)}원</span>
      <span class="compare-diff ${totalDiff > 0 ? 'over' : 'under'}">${totalDiff > 0 ? '+' : ''}${fmt(totalDiff)}원</span>
    </div>`;
}

function downloadComparisonResult() {
  const planTotal = grandTotal(FILTERED, catPersona);
  const header = '대분류,계획(월),실적(월평균),차이\n';
  const rows = CATS.map(cat => {
    const plan = categorySubtotal(FILTERED, cat, catPersona[cat]);
    const actual = userCategoryAvgs[cat] || 0;
    return `${cat},${Math.round(plan)},${Math.round(actual)},${Math.round(actual - plan)}`;
  }).join('\n');
  const totalRow = `합계,${Math.round(planTotal)},${Math.round(userActualTotal)},${Math.round(userActualTotal - planTotal)}`;
  downloadCSV('계획_실적_비교.csv', header + rows + '\n' + totalRow);
}

function proceedFromCompare() {
  comparisonMode = true;
  gotoStep(5);
  renderAnalysis();
}

// ══ STEP 5: ANALYSIS ══

function computePersonaMix() {
  const itemCounts = { 설계자: 0, 소비자: 0, 노동자: 0 };
  const costSums = { 설계자: 0, 소비자: 0, 노동자: 0 };
  CATS.forEach(cat => {
    const pKey = catPersona[cat];
    itemCounts[pKey] += FILTERED.filter(i => i.대분류 === cat).length;
    costSums[pKey] += categorySubtotal(FILTERED, cat, pKey);
  });
  return { itemCounts, costSums };
}

function computeReferenceTotals() {
  const totals = {};
  PERSONAS.forEach(p => {
    const map = {};
    CATS.forEach(cat => { map[cat] = p.key; });
    totals[p.key] = grandTotal(FILTERED, map);
  });
  return totals;
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
}

function buildPieSVG(slices, size) {
  size = size || 160;
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  let angle = 0;
  const r = size / 2 - 4, cx = size / 2, cy = size / 2;
  const paths = slices.map(sl => {
    const frac = sl.value / total;
    const startAngle = angle;
    const endAngle = frac >= 1 ? angle + 359.99 : angle + frac * 360;
    angle = endAngle;
    return { path: describeArc(cx, cy, r, startAngle, endAngle), color: sl.color, label: sl.label, pct: (frac * 100).toFixed(1) };
  });
  const svg = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    ${paths.map(p => `<path d="${p.path}" fill="${p.color}" stroke="var(--bg)" stroke-width="1.5"/>`).join('')}
  </svg>`;
  return { svg, paths };
}

function buildPieLegend(paths) {
  return `<div class="pie-legend">${paths.map(p =>
    `<div class="pie-legend-row"><span class="pie-legend-swatch" style="background:${p.color}"></span>${p.label} ${p.pct}%</div>`
  ).join('')}</div>`;
}

function buildBarChartHTML(entries) {
  const max = Math.max(...entries.map(e => e.value), 1);
  return entries.map(e => `
    <div class="bar-row${e.isUser ? ' is-user' : ''}">
      <div class="bar-row-label">${e.isUser ? '👤 나' : e.label}</div>
      <div class="bar-track"><div class="bar-fill ${e.cls}" style="width:${(e.value / max * 100).toFixed(1)}%"></div></div>
      <div class="bar-row-amt">${fmt(e.value)}원</div>
    </div>`).join('');
}

function renderAnalysis() {
  const backBtn = document.getElementById('s5-back-btn');
  const wrap = document.getElementById('analysis-content');
  if (!comparisonMode) {
    backBtn.onclick = () => gotoStep(4);
    backBtn.textContent = '← 결과';
    const { itemCounts, costSums } = computePersonaMix();
    const itemPie = buildPieSVG(PERSONAS.map(p => ({ label: p.nick, value: itemCounts[p.key], color: `var(--c${p.cls})` })));
    const costPie = buildPieSVG(PERSONAS.map(p => ({ label: p.nick, value: costSums[p.key], color: `var(--c${p.cls})` })));
    wrap.innerHTML = `
      <div class="analysis-title">${nickOf(basePersona)} 기준 지출 구조 분석</div>
      <div class="pie-grid">
        <div class="pie-block">
          <div class="pie-block-title">아이템 기준</div>
          ${itemPie.svg}
          ${buildPieLegend(itemPie.paths)}
        </div>
        <div class="pie-block">
          <div class="pie-block-title">금액 기준</div>
          ${costPie.svg}
          ${buildPieLegend(costPie.paths)}
        </div>
      </div>`;
  } else {
    backBtn.onclick = () => gotoStep('4b');
    backBtn.textContent = '← 실적 업로드';
    const refs = computeReferenceTotals();
    const entries = PERSONAS.map(p => ({ label: p.nick, value: refs[p.key], cls: p.cls, isUser: false }))
      .concat([{ label: '나', value: userActualTotal, cls: 'U', isUser: true }])
      .sort((a, b) => a.value - b.value);
    wrap.innerHTML = `
      <div class="analysis-title">당신의 실제 지출 위치</div>
      <div class="bar-chart">${buildBarChartHTML(entries)}</div>`;
  }
}

// ══ STEP 6: FINANCIAL PROJECTION ══

const TROPHY_META = {
  '세컨카':       {label:'세컨 카',       icon:'🚗', priceText:'5,000만원',    opexText:'10만원/월'},
  '농막':         {label:'농막',          icon:'🛖', priceText:'1억원',        opexText:'10만원/월'},
  '세컨하우스':   {label:'세컨하우스',    icon:'🏡', priceText:'2.5억원',      opexText:'20만원/월'},
  '창작공간':     {label:'창작공간',      icon:'🎨', priceText:'2.5억원',      opexText:'20만원/월'},
  '산섬':         {label:'산/섬',         icon:'🏝️', priceText:'5억원',        opexText:'50만원/월'},
  '풀빌라회원권': {label:'풀빌라 회원권', icon:'🏖️', priceText:'1억원',        opexText:'100만원/월'},
  '골프회원권':   {label:'골프 회원권',   icon:'⛳', priceText:'5,000만원',    opexText:'100만원/월'},
  '포르쉐':       {label:'포르쉐',        icon:'🏎️', priceText:'1.5억원',      opexText:'50만원/월'},
  '크루즈3개월':  {label:'크루즈 3개월',  icon:'🛳️', priceText:'1억600만원',   opexText:'0 (일괄)'},
  '해외여행1년':  {label:'1년 해외여행', icon:'✈️', priceText:'1억원',        opexText:'0'},
};

function fmtMillion(n) {
  return (n / 1000000).toFixed(1) + '백만원';
}

let trophyStack = [];
let projInitialized = false;
let sliderLocked = false;
let trophyLocked = false;
let lastSim = [];
let lastProjParams = null;

const SLIDER_IDS = ['sl-income', 'sl-years', 'sl-return', 'sl-retire'];
const SLIDER_DEFAULTS = { 'sl-income': 5000000, 'sl-years': 20, 'sl-return': 5, 'sl-retire': 20 };
const TROPHY_SECTION_NOTE = {
  locked: '트로피 — 지출 재생산(Financial Independence) 이후 버킷 리스트를 선택하세요. 선택 시, 지출 재생산이 순연될 수 있습니다.',
  unlocked: '소득 전망을 먼저 고정해야 트로피를 선택할 수 있어요',
};

function resetSliderValues() {
  SLIDER_IDS.forEach(id => { document.getElementById(id).value = SLIDER_DEFAULTS[id]; });
}

function gotoProjection() {
  gotoStep(6);
  document.getElementById('s6-badge').textContent = nickOf(basePersona) + ' / ' + basePersona;
  if (!projInitialized) {
    resetSliderValues();
    projInitialized = true;
  }
  updateSliderLockUI();
  const trophyLockBtn = document.getElementById('btn-trophy-lock');
  trophyLockBtn.textContent = trophyLocked ? '🔒 고정됨 ✓' : '🔓 트로피 고정';
  trophyLockBtn.classList.toggle('locked', trophyLocked);
  renderProjection();
}

function onProjInput() {
  renderProjection();
}

function updateSliderLockUI() {
  SLIDER_IDS.forEach(id => { document.getElementById(id).disabled = sliderLocked; });
  const btn = document.getElementById('btn-lock');
  btn.textContent = sliderLocked ? '고정됨 ✓' : '소득 전망 고정';
  btn.classList.toggle('locked', sliderLocked);
  document.getElementById('trophy-section-note').textContent = sliderLocked
    ? TROPHY_SECTION_NOTE.locked
    : TROPHY_SECTION_NOTE.unlocked;
}

function lockSliders() {
  sliderLocked = true;
  updateSliderLockUI();
  renderProjection();
}

function resetSlidersState() {
  sliderLocked = false;
  resetSliderValues();
  updateSliderLockUI();
}

function resetSliders() {
  resetSlidersState();
  renderProjection();
}

function resetAll() {
  resetSlidersState();
  trophyStack = [];
  trophyLocked = false;
  renderProjection();
}

function toggleTrophyLock() {
  trophyLocked = !trophyLocked;
  const btn = document.getElementById('btn-trophy-lock');
  btn.textContent = trophyLocked ? '🔒 고정됨 ✓' : '🔓 트로피 고정';
  btn.classList.toggle('locked', trophyLocked);
  renderProjection();
}

function renderProjection() {
  const income = +document.getElementById('sl-income').value;
  const years = +document.getElementById('sl-years').value;
  const ret = +document.getElementById('sl-return').value;
  const retire = +document.getElementById('sl-retire').value;

  document.getElementById('v-income').textContent = fmt(income) + '원/월';
  document.getElementById('v-years').textContent = years + '년';
  document.getElementById('v-return').textContent = ret + '%';
  document.getElementById('v-retire').textContent = retire + '년차';

  const baseMonthlyCost = comparisonMode ? userActualTotal : grandTotal(FILTERED, catPersona);
  document.getElementById('proj-mode-label').textContent = comparisonMode
    ? '👤 사용자 프로젝션 — 실제 지출 평균(뱅크샐러드) 기준'
    : `🧭 캐릭터 프로젝션 — ${nickOf(basePersona)} 계획 기준`;
  document.getElementById('proj-target-note').innerHTML =
    `지출 재생산(FI) 기준 — 월 지출 <strong>${fmtMillion(baseMonthlyCost)}</strong> 초과 시 달성`;
  const projParams = { monthlyIncome: income, years, annualReturn: ret, retireYear: retire, baseMonthlyCost, trophyDefs: TROPHIES, loan: loan.principal > 0 ? loan : null, initialAssets: currentAssets };
  lastProjParams = projParams;
  const sim = simulateProjection({ ...projParams, trophyStack });
  lastSim = sim;

  const fiYear = firstFiYear(sim, baseMonthlyCost);
  document.getElementById('proj-chart').innerHTML = buildChartSVG(sim, retire, years, trophyStack, fiYear);
  renderChartLegend(fiYear, years, trophyStack);

  renderTrophyGrid(projParams, years);
  renderTrophyStack();
  saveState();
}

function downloadProjectionResult() {
  if (!lastSim.length) return;
  const modeLabel = comparisonMode ? '사용자 프로젝션(실적 기준)' : `캐릭터 프로젝션(${nickOf(basePersona)} 계획 기준)`;
  const meta = `${modeLabel}\n월소득,${lastProjParams.monthlyIncome}\n월지출(기준),${Math.round(lastProjParams.baseMonthlyCost)}\n연평균수익률(%),${lastProjParams.annualReturn}\n근로소득중단시점(년),${lastProjParams.retireYear}\n현재금융자산(원),${Math.round(lastProjParams.initialAssets || 0)}\n\n`;
  const header = '연차,자산(원),상태,월간투자수익(원),대출잔액(원),트로피구매,트로피OPEX(월)\n';
  const rows = lastSim.map(p =>
    `${p.year},${Math.round(p.assets)},${p.retired ? '은퇴' : '근로'},${Math.round(p.investmentIncome)},${Math.round(p.loanBalance || 0)},${p.trophyPurchased || ''},${Math.round(p.trophyOpex || 0)}`
  ).join('\n');
  downloadCSV('재무프로젝션_결과.csv', meta + header + rows);
}

function suggestedYear(key, projParams, years) {
  for (let y = 1; y <= years; y++) {
    if (canAddTrophy(projParams, trophyStack, key, y)) return y;
  }
  return null;
}

function isTrophyOwned(key) {
  return trophyStack.some(t => t.trophy === key);
}

function renderTrophyGrid(projParams, years) {
  const wrap = document.getElementById('trophy-grid');
  wrap.innerHTML = Object.keys(TROPHIES).map(key => {
    const meta = TROPHY_META[key];
    const owned = isTrophyOwned(key);
    const suggested = suggestedYear(key, projParams, years);
    const unreachable = suggested === null;
    const disabled = owned || !sliderLocked || unreachable || trophyLocked;
    const addRow = unreachable && !owned
      ? `<div class="trophy-add-row"><span class="trophy-unreachable">이 기간 내 달성 불가</span></div>`
      : `<div class="trophy-add-row">
          <input type="number" id="ty-${key}" min="1" max="${years}" value="${owned ? (trophyStack.find(t => t.trophy === key).year) : suggested}" ${disabled ? 'disabled' : ''} oninput="refreshTrophyButton('${key}')">
          <span>년차</span>
          <button class="trophy-add-btn" id="tb-${key}" ${disabled ? 'disabled' : ''} onclick="addTrophy('${key}')">${owned ? '보유중' : '추가'}</button>
        </div>`;
    return `<div class="trophy-card${owned ? ' owned' : ''}">
      ${owned ? `<div class="trophy-owned-badge">${meta.icon}</div>` : ''}
      <div class="trophy-name"><span class="trophy-icon">${meta.icon}</span>${meta.label}</div>
      <div class="trophy-meta">${meta.priceText} · OPEX ${meta.opexText}</div>
      ${addRow}
    </div>`;
  }).join('');
  Object.keys(TROPHIES).forEach(key => refreshTrophyButton(key));
}

function refreshTrophyButton(key) {
  const input = document.getElementById('ty-' + key);
  const btn = document.getElementById('tb-' + key);
  if (!input || !btn) return;
  if (!sliderLocked || isTrophyOwned(key) || trophyLocked) { btn.disabled = true; return; }
  const year = +input.value;
  const years = +document.getElementById('sl-years').value;
  const ok = year >= 1 && year <= years && canAddTrophy(lastProjParams, trophyStack, key, year);
  btn.disabled = !ok;
}

function addTrophy(key) {
  const input = document.getElementById('ty-' + key);
  const year = +input.value;
  trophyStack.push({ trophy: key, year });
  renderProjection();
}

function popTrophy() {
  trophyStack.pop();
  renderProjection();
}

function clearTrophies() {
  trophyStack = [];
  trophyLocked = false;
  renderProjection();
}

function renderTrophyStack() {
  const wrap = document.getElementById('trophy-stack-list');
  if (trophyStack.length === 0) {
    wrap.innerHTML = '<div class="trophy-stack-empty">아직 선택한 트로피가 없습니다</div>';
    return;
  }
  wrap.innerHTML = trophyStack.map((t, i) => {
    const isLast = i === trophyStack.length - 1;
    const meta = TROPHY_META[t.trophy];
    return `<div class="trophy-stack-item">
      <span>${t.year}년차 · ${meta.label}</span>
      ${isLast && !trophyLocked ? `<button class="trophy-cancel-btn" onclick="popTrophy()">취소</button>` : ''}
    </div>`;
  }).join('');
}

function formatCompact(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 100000000) return sign + (abs / 100000000).toFixed(1) + '억원';
  if (abs >= 10000) return sign + Math.round(abs / 10000) + '만원';
  return sign + fmt(abs) + '원';
}

function buildChartSVG(sim, retireYear, years, stack, fiYear) {
  const W = 640, H = 260, padL = 64, padR = 16, padT = 26, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const values = sim.map(p => p.assets);
  const minV = Math.min(0, ...values);
  const maxV = Math.max(0, ...values);
  const range = (maxV - minV) || 1;
  const xOf = (year) => padL + (year - 1) / Math.max(years - 1, 1) * plotW;
  const yOf = (v) => padT + (1 - (v - minV) / range) * plotH;

  const path = sim.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.year).toFixed(1)},${yOf(p.assets).toFixed(1)}`).join(' ');
  const zeroY = yOf(0).toFixed(1);
  const retireX = xOf(retireYear).toFixed(1);

  const tickCount = 4;
  let yAxis = '';
  for (let i = 0; i <= tickCount; i++) {
    const v = minV + (maxV - minV) * i / tickCount;
    const y = yOf(v).toFixed(1);
    yAxis += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" style="stroke:var(--border)" stroke-width="1" stroke-dasharray="2,2"/>
      <text x="${padL - 8}" y="${y}" font-size="13" text-anchor="end" dominant-baseline="middle" style="fill:#c9dced">${formatCompact(v)}</text>`;
  }

  let markers = retireYear <= years
    ? `<line x1="${retireX}" y1="${padT}" x2="${retireX}" y2="${H - padB}" style="stroke:#c9dced" stroke-width="1" stroke-dasharray="4,3"/>`
    : '';

  if (fiYear) {
    const fx = xOf(fiYear).toFixed(1);
    markers += `<line x1="${fx}" y1="${padT}" x2="${fx}" y2="${H - padB}" style="stroke:#ffc247" stroke-width="1.5"/>
      <text x="${fx}" y="${padT - 8}" font-size="16" text-anchor="middle">🌱</text>`;
  }

  markers += stack.map(t => {
    const tx = xOf(t.year).toFixed(1);
    const meta = TROPHY_META[t.trophy];
    return `<line x1="${tx}" y1="${padT}" x2="${tx}" y2="${H - padB}" style="stroke:#6fe6c2" stroke-width="1" stroke-dasharray="2,2"/>
      <text x="${tx}" y="${padT - 8}" font-size="16" text-anchor="middle">${meta.icon}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    ${yAxis}
    <line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" style="stroke:#c9dced" stroke-width="1"/>
    <path d="${path}" fill="none" style="stroke:#6fe6c2" stroke-width="2"/>
    ${markers}
    <text x="${padL}" y="${H - 8}" font-size="13" style="fill:#c9dced">1년</text>
    <text x="${W - padR}" y="${H - 8}" font-size="13" style="fill:#c9dced" text-anchor="end">${years}년</text>
  </svg>`;
}

function renderChartLegend(fiYear, years, stack) {
  const el = document.getElementById('chart-legend');
  let rows = fiYear
    ? `<div class="legend-item"><span>🌱</span><span>지출 재생산(FI)<br>${fiYear}년차</span></div>`
    : `<div class="legend-item empty"><span>🌱</span><span>${years}년 내 지출 재생산(FI) 미달성</span></div>`;
  if (stack.length === 0) {
    rows += `<div class="legend-item empty"><span>🏆</span><span>선택한 트로피 없음</span></div>`;
  } else {
    rows += stack.map(t => {
      const meta = TROPHY_META[t.trophy];
      return `<div class="legend-item"><span>${meta.icon}</span><span>${meta.label}<br>${t.year}년차</span></div>`;
    }).join('');
  }
  el.innerHTML = rows;
}

initLoginScreen();
