/* ===========================================================================
   app.js — 상태 보관, 렌더 루프, 입력 바인딩
   =========================================================================== */

/* 현황판이 물량 · 가격 · Hedge 세 블록으로 갈리면서 book 행 구조가 바뀌었다 —
   저장 키를 올려 옛 저장값(조치 원장 시절)은 통째로 버린다 */
const STORAGE_KEY = 'nickel-hedge-model-v3';
const THEME_KEY = 'nickel-hedge-theme';

let state = loadState();
let activeTab = TABS[0].id;

function loadState() {
  const base = defaultState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return saved ? migrate(deepMerge(base, saved)) : base;
  } catch (_) {
    return base;
  }
}

/* 저장된 값이 예전 선택지를 들고 있을 수 있다 — 지금 고를 수 있는 값으로 맞춘다.
   '저가법 평가'는 Hedge 대책에서 빠지고 판매 미확정 재고에 자동 적용되는 회계 처리가 됐다. */
function migrate(s) {
  s.book.forEach(r => {
    if (!HEDGE_ORDER.includes(r.hedge)) r.hedge = 'none';
    if (!ROW_KINDS[r.kind]) r.kind = 'contract';
    if (!PRICE_CONDS[r.cond]) r.cond = '평균';
    /* 단계별 입력으로 바뀌기 전 저장값 — 마지막 단계에 몰아넣는다 */
    if (!Array.isArray(r.addAt))   r.addAt   = [0, 0, Number(r.addQty)   || 0];
    if (!Array.isArray(r.hedgeAt)) r.hedgeAt = [0, 0, Number(r.hedgeQty) || 0];
    delete r.addQty; delete r.hedgeQty;
  });
  return s;
}

/* 저장된 값이 구조적으로 어긋나도 기본값이 살아남도록 병합 */
function deepMerge(base, saved) {
  if (Array.isArray(base)) return Array.isArray(saved) ? saved : base;
  if (base && typeof base === 'object') {
    const out = { ...base };
    Object.keys(base).forEach(k => {
      if (saved && k in saved) out[k] = deepMerge(base[k], saved[k]);
    });
    return out;
  }
  return saved === undefined ? base : saved;
}

const saveState = () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* 저장 실패는 무시 */ }
};

function setByPath(path, value) {
  const keys = path.split('.');
  let obj = state;
  for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
  obj[keys[keys.length - 1]] = value;
}

/* --------------------------------- 렌더 ---------------------------------- */
function renderTabs() {
  document.getElementById('tabs').innerHTML = TABS.map(t =>
    `<button class="tab" role="tab" type="button" data-tab="${t.id}" aria-selected="${t.id === activeTab}">${t.label}</button>`
  ).join('');
}

function render() {
  const tab = TABS.find(t => t.id === activeTab) || TABS[0];
  const view = document.getElementById('view');
  view.innerHTML = tab.render(state);
  initCharts(view);
  syncSecNav();
  document.querySelectorAll('.tab').forEach(b =>
    b.setAttribute('aria-selected', String(b.dataset.tab === activeTab)));
}

/* 좌측 목차 — 지금 보고 있는 카드를 짚어 준다.
   화면은 입력 한 번마다 통째로 다시 그려지므로 상태를 들고 있지 않고 매번 다시 계산한다. */
const SEC_OFFSET = 140;                 // sticky 헤더(topbar + tabs) 아래 첫 픽셀
function syncSecNav() {
  const links = document.querySelectorAll('[data-sec-link]');
  if (!links.length) return;
  let current = links[0].dataset.secLink;
  links.forEach(a => {
    const card = document.getElementById(a.dataset.secLink);
    if (card && card.getBoundingClientRect().top <= SEC_OFFSET) current = a.dataset.secLink;
  });
  links.forEach(a => a.classList.toggle('on', a.dataset.secLink === current));
}

let secNavQueued = false;
addEventListener('scroll', () => {
  if (secNavQueued) return;
  secNavQueued = true;
  requestAnimationFrame(() => { secNavQueued = false; syncSecNav(); });
}, { passive: true });

/* 재렌더 후 포커스와 커서 위치를 복원해 타이핑이 끊기지 않게 한다.
   입력칸은 text 타입이라 selectionStart/setSelectionRange 가 그대로 동작한다. */
function rerender() {
  const el = document.activeElement;
  const bind = el && el.dataset ? el.dataset.bind : null;
  let start = null, end = null;
  if (bind) {
    try { start = el.selectionStart; end = el.selectionEnd; } catch (_) { /* 미지원 */ }
  }
  render();
  if (!bind) return;
  const next = document.querySelector(`[data-bind="${CSS.escape(bind)}"]`);
  if (!next) return;
  next.focus();
  if (start != null && next.setSelectionRange) {
    try { next.setSelectionRange(start, end == null ? start : end); } catch (_) { /* 미지원 */ }
  }
}

/* ------------------------------- 이벤트 ---------------------------------- */
document.addEventListener('input', ev => {
  const el = ev.target;
  if (!el.dataset || !el.dataset.bind || el.tagName === 'SELECT') return;  // select는 change에서 처리
  let value;
  if (el.dataset.num !== undefined) {
    if (!/^-?\d*\.?\d*$/.test(el.value)) return;       // 숫자가 아닌 입력은 무시
    if (el.value === '' || el.value === '-' || el.value === '.') return;   // 입력 도중
    value = Number(el.value);
    if (Number.isNaN(value)) return;
  } else {
    value = el.value;
  }
  setByPath(el.dataset.bind, value);
  saveState();
  rerender();
});

/* type="number" 를 버린 대신 위/아래 화살표 증감은 직접 처리한다 */
document.addEventListener('keydown', ev => {
  const el = ev.target;
  if (!el.dataset || el.dataset.num === undefined) return;
  if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
  const step = Number(el.dataset.step) || 1;
  const cur = Number(el.value);
  if (Number.isNaN(cur)) return;
  ev.preventDefault();
  const next = cur + (ev.key === 'ArrowUp' ? step : -step);
  /* 부동소수점 잔여물(0.1 + 0.2)을 step 자릿수로 정리 */
  const decimals = (String(step).split('.')[1] || '').length;
  setByPath(el.dataset.bind, Number(next.toFixed(decimals)));
  saveState();
  rerender();
});

document.addEventListener('change', ev => {
  const el = ev.target;
  if (!el.dataset || !el.dataset.bind || el.tagName !== 'SELECT') return;
  setByPath(el.dataset.bind, el.value);
  saveState();
  rerender();
});

document.addEventListener('click', ev => {
  /* 목차 클릭은 앵커 기본동작에 맡기지 않고 직접 옮긴다 —
     기본동작이 만드는 scroll 이벤트가 언제 오는지에 표시가 끌려다니지 않게 */
  const secLink = ev.target.closest('[data-sec-link]');
  if (secLink) {
    const card = document.getElementById(secLink.dataset.secLink);
    if (!card) return;
    ev.preventDefault();
    card.scrollIntoView();                       // scroll-margin-top 이 헤더만큼 띄워 준다
    history.replaceState(null, '', '#' + secLink.dataset.secLink);
    document.querySelectorAll('[data-sec-link]')
      .forEach(a => a.classList.toggle('on', a === secLink));
    return;
  }

  const tabBtn = ev.target.closest('[data-tab]');
  if (tabBtn) { activeTab = tabBtn.dataset.tab; render(); window.scrollTo({ top: 0 }); return; }

  const actBtn = ev.target.closest('[data-act]');
  if (actBtn) {
    const act = actBtn.dataset.act;
    if (act === 'add-row') {
      const n = state.book.length + 1;
      state.book.push({ name: `계약 C${n}`, kind: 'contract', qty: 0, addAt: [0, 0, 0],
                        cond: '평균', qpShift: 0, hedgeAt: [0, 0, 0], hedge: 'none' });
    } else if (act === 'del-row') {
      state.book.splice(Number(actBtn.dataset.i), 1);
    } else if (act === 'export-xlsx') {
      downloadXlsx();
      return;
    } else if (act === 'dl-prices') {
      downloadPriceCsv();
      return;
    }
    saveState();
    render();
    return;
  }

  if (ev.target.id === 'reset-btn') {
    if (confirm('모든 입력값을 초기 상태로 되돌립니다. 계속할까요?')) {
      state = defaultState();
      saveState();
      render();
    }
    return;
  }

  if (ev.target.id === 'theme-btn') {
    const now = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(now);
    try { localStorage.setItem(THEME_KEY, now); } catch (_) { /* noop */ }
  }
});

/* 버튼에 현재 적용 중인 모드를 그대로 적는다 */
function applyTheme(mode) {
  document.documentElement.setAttribute('data-theme', mode);
  const btn = document.getElementById('theme-btn');
  if (!btn) return;
  const dark = mode === 'dark';
  btn.textContent = dark ? '🌙 다크 모드' : '☀️ 라이트 모드';
  btn.setAttribute('aria-label', `현재 ${dark ? '다크' : '라이트'} 모드 — 누르면 전환`);
  btn.title = `현재 ${dark ? '다크' : '라이트'} 모드 · 누르면 ${dark ? '라이트' : '다크'}로 전환`;
}

function downloadXlsx() {
  try {
    exportXlsx(state);
  } catch (err) {
    console.error(err);
    alert('엑셀 생성에 실패했습니다: ' + err.message);
  }
}

/* ------------------------ 시나리오 가격표 CSV 왕복 ------------------------
   내려받은 CSV를 엑셀에서 고쳐 그대로 올리면 반영된다.
   행 = 시나리오, 열 = 주차. 첫 열은 시나리오 이름, 첫 행은 W0..Wn 머리글.
   BOM을 붙여야 엑셀이 UTF-8 한글을 깨뜨리지 않는다. */
function priceCsv() {
  const weeks = state.market.prices[SCENARIOS[0]].length;
  const head = ['시나리오'].concat(Array.from({ length: weeks }, (_, i) => 'W' + i));
  const rows = SCENARIOS.map(s => [s].concat(state.market.prices[s].map(v => String(v))));
  return '﻿' + [head].concat(rows).map(r => r.join(',')).join('\r\n') + '\r\n';
}

function downloadPriceCsv() {
  const blob = new Blob([priceCsv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nickel_price_table.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parsePriceCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) throw new Error('내용이 비어 있습니다.');
  const weeks = state.market.prices[SCENARIOS[0]].length;
  const parsed = {};
  const seen = [];

  lines.slice(1).forEach((line, li) => {
    const cells = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
    const name = cells[0];
    if (!SCENARIOS.includes(name)) {
      throw new Error(`${li + 2}행의 시나리오 이름 "${name}" 을 알 수 없습니다. ` +
                      `(${SCENARIOS.join(' / ')} 중 하나여야 합니다)`);
    }
    const nums = cells.slice(1, weeks + 1).map(v => Number(v.replace(/,/g, '')));
    if (nums.length !== weeks || nums.some(v => !Number.isFinite(v))) {
      throw new Error(`${name} 행의 값이 ${weeks}개의 숫자가 아닙니다 (읽은 개수 ${nums.length}).`);
    }
    parsed[name] = nums;
    seen.push(name);
  });

  const missing = SCENARIOS.filter(s => !seen.includes(s));
  if (missing.length) throw new Error(`빠진 시나리오: ${missing.join(', ')}`);
  return parsed;
}

document.addEventListener('change', ev => {
  const el = ev.target;
  if (!el.dataset || el.dataset.act !== 'ul-prices') return;
  const file = el.files && el.files[0];
  el.value = '';                                  // 같은 파일 다시 올려도 change 가 뜨도록
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state.market.prices = parsePriceCsv(String(reader.result));
      saveState();
      render();
    } catch (err) {
      alert('가격표를 읽지 못했습니다.\n\n' + err.message);
    }
  };
  reader.onerror = () => alert('파일을 읽지 못했습니다.');
  reader.readAsText(file, 'utf-8');
});

/* -------------------------------- 부팅 ----------------------------------- */
(function boot() {
  let theme = null;
  try { theme = localStorage.getItem(THEME_KEY); } catch (_) { /* noop */ }
  if (!theme) theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(theme);

  renderTabs();
  render();
})();
