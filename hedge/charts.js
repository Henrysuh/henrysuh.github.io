/* ===========================================================================
   charts.js — 의존성 없는 인라인 SVG 차트 (라인 / 그룹 막대)
   문자열 HTML을 만들고, 렌더 후 initCharts()가 hover 레이어를 붙인다.
   =========================================================================== */

const ChartData = {};                 // id -> { kind, ... }
const VIEW_W = 920;

const fmtUSD  = v => (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US');
const fmtUnit = v => '$' + Math.round(v).toLocaleString('en-US') + '/t';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* 축 눈금을 사람이 읽기 좋은 간격으로 */
function niceScale(min, max, count) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].find(m => m * mag >= raw) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi, ticks };
}

function legendHTML(series) {
  if (series.length < 2) return '';
  return `<div class="chart-legend">${series.map(s =>
    `<span style="color:${s.color}"><i class="${s.dashed ? 'dash' : ''}" style="background:${s.dashed ? '' : s.color}"></i>` +
    `<span style="color:var(--text-secondary)">${esc(s.name)}</span></span>`).join('')}</div>`;
}

/* ------------------------------ line chart ------------------------------ */
function lineChart(cfg) {
  const { id, xLabels, series } = cfg;
  const fmt = cfg.fmt || fmtUSD;
  const H = cfg.height || 240;
  const W = cfg.width || VIEW_W;
  const m = { top: 14, right: series.length <= 4 ? 78 : 18, bottom: 26, left: 66 };
  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;

  const all = series.flatMap(s => s.values).concat((cfg.hLines || []).map(h => h.value));
  const { lo, hi, ticks } = niceScale(Math.min(...all), Math.max(...all), 5);
  const X = i => m.left + (xLabels.length === 1 ? plotW / 2 : (plotW * i) / (xLabels.length - 1));
  const Y = v => m.top + plotH - ((v - lo) / (hi - lo)) * plotH;

  let svg = '';
  ticks.forEach(t => {
    svg += `<line class="gridline" x1="${m.left}" y1="${Y(t).toFixed(1)}" x2="${m.left + plotW}" y2="${Y(t).toFixed(1)}"/>`;
    svg += `<text class="tick num" x="${m.left - 8}" y="${(Y(t) + 3.5).toFixed(1)}" text-anchor="end">${esc(fmt(t))}</text>`;
  });
  svg += `<line class="baseline" x1="${m.left}" y1="${m.top + plotH}" x2="${m.left + plotW}" y2="${m.top + plotH}"/>`;

  const every = Math.ceil(xLabels.length / 12);
  xLabels.forEach((lab, i) => {
    if (i % every !== 0 && i !== xLabels.length - 1) return;
    svg += `<text class="tick" x="${X(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(lab)}</text>`;
  });

  (cfg.hLines || []).forEach(h => {
    /* 라벨이 곡선 위에 겹쳐도 읽히도록 배경색 테두리를 두른다 (paint-order: stroke) */
    svg += `<line x1="${m.left}" y1="${Y(h.value).toFixed(1)}" x2="${m.left + plotW}" y2="${Y(h.value).toFixed(1)}" ` +
           `stroke="${h.color}" stroke-width="2" stroke-dasharray="6 4" opacity=".85"/>` +
           `<text class="serie-label halo" x="${m.left + 6}" y="${(Y(h.value) - 6).toFixed(1)}" fill="${h.color}">${esc(h.label)}</text>`;
  });

  svg += `<line id="${id}-cross" class="crosshair" x1="0" y1="${m.top}" x2="0" y2="${m.top + plotH}" opacity="0"/>`;

  series.forEach(s => {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    svg += `<path class="serie-line" d="${d}" stroke="${s.color}"${s.dashed ? ' stroke-dasharray="6 4"' : ''}/>`;
  });
  if (series.length <= 4) {
    // 끝점 직접 라벨 — 겹치면 세로로 밀어 낸다
    const last = s => s.values[s.values.length - 1];
    const labels = series.map(s => ({ name: s.name, color: s.color, y: Y(last(s)) }))
                         .sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) {
      if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
    }
    const overflow = labels.length && labels[labels.length - 1].y - (m.top + plotH);
    if (overflow > 0) labels.forEach(l => { l.y -= overflow; });
    labels.forEach(l => {
      svg += `<text class="serie-label" x="${(X(xLabels.length - 1) + 8).toFixed(1)}" y="${(l.y + 4).toFixed(1)}" fill="${l.color}">${esc(l.name)}</text>`;
    });
  }
  series.forEach((s, si) => {
    svg += `<circle id="${id}-dot-${si}" r="4.5" fill="${s.color}" stroke="var(--surface-1)" stroke-width="2" opacity="0"/>`;
  });
  svg += `<rect id="${id}-hit" x="${m.left}" y="${m.top}" width="${plotW}" height="${plotH}" fill="transparent"/>`;

  ChartData[id] = { kind: 'line', xLabels, series, fmt, m, plotW, plotH, X, Y, W };
  return `<div class="chart-wrap" data-chart="${id}">${legendHTML(series)}` +
         `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(cfg.aria || '차트')}">${svg}</svg>` +
         `<div class="tooltip" id="${id}-tip"></div></div>`;
}

/* --------------------------- grouped bar chart -------------------------- */
function barPath(x, y, w, yb, r) {
  const up = y <= yb;
  const rr = Math.min(r, w / 2, Math.abs(yb - y));
  return up
    ? `M${x},${yb} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${yb} Z`
    : `M${x},${yb} L${x},${y - rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y - rr} L${x + w},${yb} Z`;
}

function barChart(cfg) {
  const { id, groups, series } = cfg;
  const fmt = cfg.fmt || fmtUSD;
  const H = cfg.height || 250;
  const m = { top: 14, right: 18, bottom: 30, left: 74 };
  const plotW = VIEW_W - m.left - m.right;
  const plotH = H - m.top - m.bottom;

  const all = series.flatMap(s => s.values).concat([0]);
  const { lo, hi, ticks } = niceScale(Math.min(...all), Math.max(...all), 5);
  const Y = v => m.top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const gw = plotW / groups.length;
  const bw = Math.min(40, (gw - 26) / series.length);

  let svg = '';
  ticks.forEach(t => {
    svg += `<line class="gridline" x1="${m.left}" y1="${Y(t).toFixed(1)}" x2="${m.left + plotW}" y2="${Y(t).toFixed(1)}"/>`;
    svg += `<text class="tick num" x="${m.left - 8}" y="${(Y(t) + 3.5).toFixed(1)}" text-anchor="end">${esc(fmt(t))}</text>`;
  });
  const zeroY = Y(0);
  svg += `<line class="baseline" x1="${m.left}" y1="${zeroY.toFixed(1)}" x2="${m.left + plotW}" y2="${zeroY.toFixed(1)}"/>`;

  groups.forEach((g, gi) => {
    const cx = m.left + gw * gi + gw / 2;
    const start = cx - (bw * series.length + 2 * (series.length - 1)) / 2;
    series.forEach((s, si) => {
      const x = start + si * (bw + 2);          // 2px surface gap between bars
      svg += `<path d="${barPath(x, Y(s.values[gi]), bw, zeroY, 4)}" fill="${s.color}" ` +
             `data-g="${gi}" data-s="${si}" class="bar"/>`;
    });
    /* labelAtZero: 라벨을 0선 옆에 둔다 — 막대가 아래로 뻗으면 위쪽, 위로 뻗으면 아래쪽.
       막대 길이와 무관하게 이름이 항상 0선 근처에 모여 읽기 쉽다. */
    let ly = H - 9;
    if (cfg.labelAtZero) {
      const anyPositive = series.some(s => s.values[gi] > 0);
      ly = anyPositive ? zeroY + 15 : zeroY - 7;
    }
    svg += `<text class="tick group-label${cfg.labelAtZero ? ' halo' : ''}" ` +
           `x="${cx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle">${esc(g)}</text>`;
  });

  ChartData[id] = { kind: 'bar', groups, series, fmt };
  return `<div class="chart-wrap" data-chart="${id}">${legendHTML(series)}` +
         `<svg class="chart" viewBox="0 0 ${VIEW_W} ${H}" role="img" aria-label="${esc(cfg.aria || '차트')}">${svg}</svg>` +
         `<div class="tooltip" id="${id}-tip"></div></div>`;
}

/* ------------------------------ hover layer ----------------------------- */
function initCharts(root) {
  root.querySelectorAll('.chart-wrap').forEach(wrap => {
    const id = wrap.dataset.chart;
    const cd = ChartData[id];
    if (!cd) return;
    const svg = wrap.querySelector('svg');
    const tip = wrap.querySelector('.tooltip');
    const vw = cd.W || VIEW_W;
    const toSvgX = ev => {
      const r = svg.getBoundingClientRect();
      return (ev.clientX - r.left) * (vw / r.width);
    };

    if (cd.kind === 'line') {
      const cross = svg.querySelector(`#${id}-cross`);
      const dots = cd.series.map((_, si) => svg.querySelector(`#${id}-dot-${si}`));
      const hit = svg.querySelector(`#${id}-hit`);
      const show = ev => {
        const sx = toSvgX(ev);
        const n = cd.xLabels.length;
        const step = cd.plotW / Math.max(1, n - 1);
        const i = Math.max(0, Math.min(n - 1, Math.round((sx - cd.m.left) / step)));
        const px = cd.X(i);
        cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('opacity', '1');
        cd.series.forEach((s, si) => {
          dots[si].setAttribute('cx', px);
          dots[si].setAttribute('cy', cd.Y(s.values[i]));
          dots[si].setAttribute('opacity', '1');
        });
        tip.innerHTML = `<div class="tt-title">${esc(cd.xLabels[i])}</div>` + cd.series.map(s =>
          `<div class="tt-row"><i style="background:${s.color}"></i>${esc(s.name)}<b>${esc(cd.fmt(s.values[i]))}</b></div>`).join('');
        const r = svg.getBoundingClientRect();
        const scale = r.width / vw;
        tip.style.left = px * scale + 'px';
        tip.style.top = (cd.m.top + 6) * scale + wrap.querySelector('svg').offsetTop + 'px';
        tip.classList.add('on');
      };
      hit.addEventListener('pointermove', show);
      hit.addEventListener('pointerdown', show);
      wrap.addEventListener('pointerleave', () => {
        cross.setAttribute('opacity', '0');
        dots.forEach(d => d.setAttribute('opacity', '0'));
        tip.classList.remove('on');
      });
    } else {
      svg.querySelectorAll('.bar').forEach(bar => {
        bar.addEventListener('pointerenter', ev => {
          const gi = +bar.dataset.g;
          tip.innerHTML = `<div class="tt-title">${esc(cd.groups[gi])}</div>` + cd.series.map(s =>
            `<div class="tt-row"><i style="background:${s.color}"></i>${esc(s.name)}<b>${esc(cd.fmt(s.values[gi]))}</b></div>`).join('');
          const wr = wrap.getBoundingClientRect();
          const br = bar.getBoundingClientRect();
          tip.style.left = (br.left + br.width / 2 - wr.left) + 'px';
          tip.style.top = (Math.min(br.top, br.bottom) - wr.top) + 'px';
          tip.classList.add('on');
        });
      });
      wrap.addEventListener('pointerleave', () => tip.classList.remove('on'));
    }
  });
}
