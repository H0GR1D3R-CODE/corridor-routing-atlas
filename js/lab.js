'use strict';
/* ==========================================================================
   CORRIDOR · lab.js
   --------------------------------------------------------------------------
   Experiment A  – scaling: same five algorithms on cities of 60 … 8 000 junctions
   Experiment B  – the price of congestion: how A*'s advantage changes with the clock
   Charts are hand-drawn SVG (no libraries) so they inherit the page's theme.
   ========================================================================== */

const SVGNS = 'http://www.w3.org/2000/svg';
function S(tag, attrs, parent, text) {
  const el = document.createElementNS(SVGNS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (text !== undefined) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}

/* -------------------------------------------------------------- line chart */
/* Interactive by default: a crosshair that snaps to the nearest x and lists every
   series there, a legend whose entries toggle their line, an optional log/linear
   switch, keyboard access (focus the plot, then arrow keys), and an optional
   onPick(x) callback when a position is clicked.                                */
function niceTicks(lo, hi, n = 5) {
  const span = (hi - lo) || 1, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

function lineChart(host, cfg) {
  const st = host._chart || (host._chart = { hidden: new Set(), log: !!cfg.yLog });
  host.innerHTML = ''; host.classList.add('chart-live'); delete host.dataset.focus;
  const fmtX = cfg.xFmt || (d => d), fmtY = cfg.yFmt || (d => d), tipY = cfg.yTip || fmtY;
  const redraw = () => lineChart(host, cfg);

  /* one row above the plot: legend keys, then the scale switch */
  const bar = document.createElement('div'); bar.className = 'chart-bar'; host.appendChild(bar);
  for (const s of cfg.series) {
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'chart-key' + (s.area ? ' area' : '') + (s.dash ? ' dash' : '');
    b.setAttribute('aria-pressed', String(!st.hidden.has(s.key)));
    b.title = st.hidden.has(s.key) ? 'Show ' + s.label : 'Hide ' + s.label;
    const sw = document.createElement('i'); sw.style.setProperty('--k', `var(--c-${s.key})`); b.appendChild(sw);
    b.appendChild(document.createTextNode(s.label));
    b.addEventListener('click', () => {
      if (st.hidden.has(s.key)) st.hidden.delete(s.key); else st.hidden.add(s.key);
      if (cfg.series.every(x => st.hidden.has(x.key))) st.hidden.clear();
      redraw();
    });
    b.addEventListener('pointerenter', () => { if (!st.hidden.has(s.key)) host.dataset.focus = s.key; });
    b.addEventListener('pointerleave', () => { delete host.dataset.focus; });
    bar.appendChild(b);
  }
  if (cfg.yLog) {
    const t = document.createElement('button'); t.type = 'button'; t.className = 'chart-scale';
    t.textContent = st.log ? 'Log scale · switch to linear' : 'Linear scale · switch to log';
    t.addEventListener('click', () => { st.log = !st.log; redraw(); });
    bar.appendChild(t);
  }

  const series = cfg.series.filter(s => !st.hidden.has(s.key));
  const W = 760, H = cfg.h || 360, m = { l: 64, r: 128, t: 14, b: 50 };
  const svg = S('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': cfg.title || 'chart' }, host);
  const lx = !!cfg.xLog, ly = !!cfg.yLog && st.log;
  const all = series.flatMap(s => s.pts).filter(p => (!lx || p[0] > 0) && (!ly || p[1] > 0));
  let x0 = cfg.xMin ?? Math.min(...all.map(p => p[0])), x1 = cfg.xMax ?? Math.max(...all.map(p => p[0]));
  let y0 = cfg.yMin ?? (ly ? Math.min(...all.map(p => p[1])) : 0), y1 = cfg.yMax ?? Math.max(...all.map(p => p[1]));
  if (ly) { y0 = 10 ** Math.floor(Math.log10(y0)); y1 = 10 ** Math.ceil(Math.log10(y1)); }
  else if (cfg.yMax === undefined) { const t = niceTicks(0, y1 * 1.04, 5); y1 = t[t.length - 1] + (t[1] - t[0]) * (t[t.length - 1] < y1 ? 1 : 0); }
  if (lx) { x0 = 10 ** Math.floor(Math.log10(x0)); x1 = 10 ** Math.ceil(Math.log10(x1)); }
  const fx = v => lx ? Math.log10(v) : v, fy = v => ly ? Math.log10(v) : v;
  const X = v => m.l + (fx(v) - fx(x0)) / (fx(x1) - fx(x0)) * (W - m.l - m.r);
  const Y = v => H - m.b - (fy(v) - fy(y0)) / (fy(y1) - fy(y0)) * (H - m.t - m.b);

  const decades = (a, b) => Array.from({ length: Math.round(Math.log10(b / a)) + 1 }, (_, i) => a * 10 ** i);
  const yt = ly ? decades(y0, y1) : niceTicks(y0, y1, 5);
  const xt = cfg.xTicks || (lx ? decades(x0, x1) : niceTicks(x0, x1, 6));
  for (const v of yt) {
    S('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: 'grid' }, svg);
    S('text', { x: m.l - 8, y: Y(v) + 3.5, class: 'tick', 'text-anchor': 'end' }, svg, fmtY(v));
  }
  for (const v of xt) {
    S('line', { x1: X(v), x2: X(v), y1: m.t, y2: H - m.b, class: 'grid v' }, svg);
    S('text', { x: X(v), y: H - m.b + 18, class: 'tick', 'text-anchor': 'middle' }, svg, fmtX(v));
  }
  S('line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: 'axis' }, svg);
  S('line', { x1: m.l, x2: m.l, y1: m.t, y2: H - m.b, class: 'axis' }, svg);
  S('text', { x: (m.l + W - m.r) / 2, y: H - 8, class: 'axlabel', 'text-anchor': 'middle' }, svg, cfg.xLabel || '');
  const yl = (cfg.yLabel || '') + (cfg.yLog ? (ly ? ' (log)' : ' (linear)') : '');
  S('text', { x: 14, y: (m.t + H - m.b) / 2, class: 'axlabel', 'text-anchor': 'middle', transform: `rotate(-90 14 ${(m.t + H - m.b) / 2})` }, svg, yl);

  /* marks */
  const ends = [], usable = s => s.pts.filter(p => (!lx || p[0] > 0) && (!ly || p[1] > 0));
  for (const s of series) {
    const pts = usable(s); if (!pts.length) continue;
    const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ');
    if (s.area) { S('path', { d: d + ` L${X(pts[pts.length - 1][0])} ${H - m.b} L${X(pts[0][0])} ${H - m.b} Z`, class: 'area', 'data-k': s.key }, svg); continue; }
    S('path', { d, class: 'line' + (s.dash ? ' dash' : ''), style: `stroke:var(--c-${s.key})`, 'data-k': s.key }, svg);
    for (const p of pts) S('circle', { cx: X(p[0]), cy: Y(p[1]), r: 3, style: `fill:var(--c-${s.key})`, class: 'dot', 'data-k': s.key }, svg);
    const last = pts[pts.length - 1]; ends.push({ y: Y(last[1]), x: X(last[0]), s });
  }
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
  for (const e of ends) {                           // direct labels wear ink; the stroke beside them carries identity
    S('line', { x1: e.x + 7, x2: e.x + 17, y1: e.y, y2: e.y, class: 'endkey', style: `stroke:var(--c-${e.s.key})`, 'data-k': e.s.key }, svg);
    S('text', { x: e.x + 21, y: e.y + 4, class: 'endlabel', 'data-k': e.s.key }, svg, e.s.label);
  }

  /* hover layer: crosshair snaps to the nearest x; one tooltip lists every series there */
  const xs = [...new Set(series.flatMap(s => usable(s).map(p => p[0])))].sort((a, b) => a - b);
  const guide = S('line', { x1: 0, x2: 0, y1: m.t, y2: H - m.b, class: 'guide', visibility: 'hidden' }, svg);
  const marks = S('g', { class: 'marks' }, svg);
  const hit = S('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, class: 'hit' + (cfg.onPick ? ' pick' : ''), tabindex: 0, 'aria-label': (cfg.title || 'chart') + '. Use the arrow keys to read values.' }, svg);
  const tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; host.appendChild(tip);
  let cur = -1;
  function show(i) {
    if (!xs.length) return; cur = Math.max(0, Math.min(xs.length - 1, i));
    const x = xs[cur], px = X(x);
    guide.setAttribute('x1', px); guide.setAttribute('x2', px); guide.setAttribute('visibility', 'visible');
    marks.textContent = ''; tip.textContent = '';
    const head = document.createElement('div'); head.className = 'th'; head.textContent = (cfg.xTip || fmtX)(x); tip.appendChild(head);
    const rows = [];
    for (const s of series) { const p = s.pts.find(q => q[0] === x); if (p && (!ly || p[1] > 0)) rows.push([s, p[1]]); }
    rows.sort((a, b) => b[1] - a[1]);
    for (const [s, v] of rows) {
      if (!s.area) S('circle', { cx: px, cy: Y(v), r: 5.5, class: 'pop', style: `fill:var(--c-${s.key})` }, marks);
      const row = document.createElement('div'); row.className = 'tr';
      const key = document.createElement('i'); key.style.setProperty('--k', `var(--c-${s.key})`); if (s.area) key.className = 'area';
      const val = document.createElement('b'); val.textContent = tipY(v, s);
      const nm = document.createElement('span'); nm.textContent = s.label;
      row.append(key, val, nm); tip.appendChild(row);
    }
    if (cfg.onPick) { const hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = cfg.pickHint || 'click to select'; tip.appendChild(hint); }
    tip.hidden = false;
    const r = svg.getBoundingClientRect(), hr = host.getBoundingClientRect(), left = px / W * r.width + (r.left - hr.left);
    const flip = px > (m.l + W - m.r) / 2;
    tip.style.left = (flip ? left - 14 : left + 14) + 'px'; tip.style.transform = flip ? 'translateX(-100%)' : 'none';
    tip.style.top = (r.top - hr.top + 10) + 'px';
  }
  function hide() { guide.setAttribute('visibility', 'hidden'); marks.textContent = ''; tip.hidden = true; cur = -1; }
  const nearest = e => {
    const r = svg.getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * W;
    let best = 0, bd = Infinity; xs.forEach((x, i) => { const d = Math.abs(X(x) - vx); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  hit.addEventListener('pointermove', e => show(nearest(e)));
  hit.addEventListener('pointerleave', () => { if (document.activeElement !== hit) hide(); });
  hit.addEventListener('focus', () => { if (cur < 0) show(xs.length - 1); });
  hit.addEventListener('blur', hide);
  hit.addEventListener('click', e => { show(nearest(e)); if (cfg.onPick && cur >= 0) cfg.onPick(xs[cur]); });
  hit.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') { show(cur + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { show(cur - 1); e.preventDefault(); }
    else if ((e.key === 'Enter' || e.key === ' ') && cfg.onPick && cur >= 0) { cfg.onPick(xs[cur]); e.preventDefault(); }
    else if (e.key === 'Escape') hit.blur();
  });
  return svg;
}

/* -------------------------------------------------------------- experiments */
const LAB_RINGS = [4, 6, 9, 13, 18, 26, 36, 50];
const tick = () => new Promise(r => setTimeout(r, 0));

async function runScaling(onStep) {
  const rows = []; let disagreements = 0, compared = 0;
  for (let i = 0; i < LAB_RINGS.length; i++) {
    const rings = LAB_RINGS[i];
    onStep && onStep(i / LAB_RINGS.length, `Building city ${i + 1}/${LAB_RINGS.length} (${rings} rings)…`);
    await tick();
    const g = buildCity({ rings, seed: 100 + rings, named: false });
    applyTraffic(g, 18.5, false);
    const pairs = randomPairs(g, 80, 1234 + rings);
    const row = { rings, n: g.n, m: g.m, res: {} };
    /* warm-up so the JIT is not charged to the first algorithm */
    for (let w = 0; w < 6; w++) for (const id of ALGO_ORDER) ALGOS[id].fn(g, pairs[w][0], pairs[w][1], { light: true });
    for (const id of ALGO_ORDER) {
      const use = id === 'bellman' && g.n > 3000 ? pairs.slice(0, 15) : pairs;
      /* best of three passes: the minimum is the least-disturbed measurement of the same work */
      let exp = 0, rel = 0, ms = Infinity;
      for (let pass = 0; pass < 3; pass++) {
        exp = 0; rel = 0;
        const t0 = performance.now();
        for (const [s, t] of use) { const r = ALGOS[id].fn(g, s, t, { light: true }); exp += r.expanded; rel += r.relaxed; }
        ms = Math.min(ms, (performance.now() - t0) / use.length);
      }
      row.res[id] = { ms, expanded: exp / use.length, relaxed: rel / use.length, queries: use.length };
    }
    for (const [s, t] of pairs.slice(0, 15)) {
      const c = ['dijkstra', 'astar', 'bidir', 'bellman'].map(id => ALGOS[id].fn(g, s, t, { light: true }).cost);
      compared++; if (!c.every(x => close(x, c[0]))) disagreements++;
    }
    rows.push(row);
    onStep && onStep((i + 1) / LAB_RINGS.length, `Measured V = ${g.n.toLocaleString()}`);
    await tick();
  }
  return { rows, disagreements, compared };
}

async function runHours(onStep) {
  const g = buildCity(CITY);
  const pairs = randomPairs(g, 70, 4242);
  const rows = [];
  for (let h = 0; h < 24; h++) {
    applyTraffic(g, h, false);
    let d = 0, a = 0, b = 0, ms = { dijkstra: 0, astar: 0, bidir: 0 };
    for (const id of ['dijkstra', 'astar', 'bidir']) {
      const t0 = performance.now(); let sum = 0;
      for (const [s, t] of pairs) sum += ALGOS[id].fn(g, s, t, { light: true }).expanded;
      ms[id] = (performance.now() - t0) / pairs.length;
      if (id === 'dijkstra') d = sum; else if (id === 'astar') a = sum; else b = sum;
    }
    rows.push({ h, astar: a / d, bidir: b / d, peak: peakIntensity(h), hRate: g.hRate });
    if (h % 4 === 3) { onStep && onStep((h + 1) / 24, `Sweeping the clock… ${h + 1}:00`); await tick(); }
  }
  return rows;
}

function fitExponent(rows, id, key) {
  const pts = rows.map(r => [Math.log(r.n), Math.log(Math.max(1e-9, r.res[id][key]))]);
  const n = pts.length, sx = pts.reduce((s, p) => s + p[0], 0), sy = pts.reduce((s, p) => s + p[1], 0);
  const sxx = pts.reduce((s, p) => s + p[0] * p[0], 0), sxy = pts.reduce((s, p) => s + p[0] * p[1], 0);
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}

const fmtN = v => v >= 100 ? Math.round(v).toLocaleString() : v >= 10 ? v.toFixed(1) : v.toFixed(2);
const fmtMs = v => v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v.toFixed(4);
const pow10fmt = v => v >= 1000 ? (v / 1000) + 'k' : v < 1 ? String(+v.toPrecision(2)) : String(v);

const LAB = { scaling: null, hours: null };

function renderLab(refs) {
  const { scaling, hours } = LAB;
  if (scaling) {
    const mk = key => ALGO_ORDER.map(id => ({ key: id, label: ALGOS[id].label, dash: id === 'greedy', pts: scaling.rows.map(r => [r.n, r.res[id][key]]) }));
    lineChart(refs.chartMs, { series: mk('ms'), xLog: true, yLog: true, xLabel: 'junctions V (log scale)', yLabel: 'ms per query', xFmt: pow10fmt, yFmt: pow10fmt, xTip: v => 'V = ' + v.toLocaleString() + ' junctions', yTip: v => fmtMs(v) + ' ms', title: 'Time per query against graph size' });
    lineChart(refs.chartWork, { series: mk('relaxed'), xLog: true, yLog: true, xLabel: 'junctions V (log scale)', yLabel: 'edges examined per query', xFmt: pow10fmt, yFmt: pow10fmt, xTip: v => 'V = ' + v.toLocaleString() + ' junctions', yTip: v => Math.round(v).toLocaleString() + ' edges', title: 'Edge relaxations against graph size' });

    const last = scaling.rows[scaling.rows.length - 1], base = last.res.dijkstra;
    const tb = refs.table; tb.innerHTML = '';
    const head = ['Algorithm', 'ms / query', 'nodes expanded', 'edges examined', 'work vs Dijkstra', 'measured growth', 'theory'];
    const thead = document.createElement('thead'); thead.innerHTML = '<tr>' + head.map(h => `<th>${h}</th>`).join('') + '</tr>'; tb.appendChild(thead);
    const body = document.createElement('tbody');
    for (const id of ALGO_ORDER) {
      const r = last.res[id], k = fitExponent(scaling.rows, id, 'relaxed');
      const tr = document.createElement('tr'); if (id === 'astar') tr.className = 'pick';
      tr.addEventListener('pointerenter', () => { refs.chartMs.dataset.focus = id; refs.chartWork.dataset.focus = id; });
      tr.addEventListener('pointerleave', () => { delete refs.chartMs.dataset.focus; delete refs.chartWork.dataset.focus; });
      tr.innerHTML = `<th scope="row"><i class="sw" style="background:var(--c-${id})"></i>${ALGOS[id].label}</th>
        <td>${fmtMs(r.ms)}</td><td>${fmtN(r.expanded)}</td><td>${fmtN(r.relaxed)}</td>
        <td>${r.relaxed / base.relaxed >= 2 ? (r.relaxed / base.relaxed).toFixed(0) + '×' : (r.relaxed / base.relaxed * 100).toFixed(0) + '%'}</td>
        <td>V<sup>${k.toFixed(2)}</sup></td><td>${ALGOS[id].time}</td>`;
      body.appendChild(tr);
    }
    tb.appendChild(body);
    refs.tableCap.textContent = `Largest city: V = ${last.n.toLocaleString()} junctions, E = ${last.m.toLocaleString()} road segments · averaged over ${last.res.dijkstra.queries} random trips (Bellman–Ford: ${last.res.bellman.queries}) at 18:30.`;
  }
  if (hours) {
    lineChart(refs.chartHours, {
      series: [
        { key: 'peak', label: 'traffic intensity', area: true, pts: hours.map(r => [r.h, r.peak]) },
        { key: 'astar', label: 'A*', pts: hours.map(r => [r.h, r.astar]) },
        { key: 'bidir', label: 'Bidirectional', pts: hours.map(r => [r.h, r.bidir]) },
      ],
      xMin: 0, xMax: 23, yMin: 0, yMax: 1, h: 300, xTicks: [0, 3, 6, 9, 12, 15, 18, 21],
      xFmt: v => String(v).padStart(2, '0') + ':00', yFmt: v => Math.round(v * 100) + '%', xLabel: 'time of day', yLabel: 'nodes expanded ÷ Dijkstra',
      title: 'Search effort relative to Dijkstra through the day', xTip: v => String(v).padStart(2, '0') + ':00 on a weekday',
      yTip: (v, s) => Math.round(v * 100) + '%' + (s.area ? '' : ' of Dijkstra'), pickHint: 'click to set the console clock',
      onPick: h => window.dispatchEvent(new CustomEvent('corridor:hour', { detail: h })),
    });
  }
  /* data-driven prose */
  const facts = [];
  if (scaling) {
    const rows = scaling.rows.filter(r => r.n >= 1000), avg = (id, k) => rows.reduce((s, r) => s + r.res[id][k] / r.res.dijkstra[k], 0) / rows.length;
    const last = scaling.rows[scaling.rows.length - 1];
    LAB.facts = {
      astarExp: avg('astar', 'expanded'), bidirExp: avg('bidir', 'expanded'), astarRel: avg('astar', 'relaxed'), bidirRel: avg('bidir', 'relaxed'),
      bfX: last.res.bellman.relaxed / last.res.dijkstra.relaxed, bfK: fitExponent(scaling.rows, 'bellman', 'relaxed'), dK: fitExponent(scaling.rows, 'dijkstra', 'relaxed'),
      bfMsX: last.res.bellman.ms / last.res.dijkstra.ms, astarMsX: last.res.astar.ms / last.res.dijkstra.ms, bidirMsX: last.res.bidir.ms / last.res.dijkstra.ms,
      n: last.n, ok: scaling.disagreements === 0, cmp: scaling.compared,
    };
    const F = LAB.facts;
    facts.push(`On cities of 1 000+ junctions, <b>A*</b> expanded <b>${(F.astarExp * 100).toFixed(0)}%</b> of the nodes Dijkstra does (${(F.astarRel * 100).toFixed(0)}% of the edge relaxations); <b>bidirectional</b> expanded <b>${(F.bidirExp * 100).toFixed(0)}%</b>.`);
    facts.push(`Work grew as <b>V<sup>${F.dK.toFixed(2)}</sup></b> for Dijkstra but <b>V<sup>${F.bfK.toFixed(2)}</sup></b> for Bellman–Ford, which at V = ${F.n.toLocaleString()} did <b>${F.bfX.toFixed(0)}×</b> more edge work per query.`);
    facts.push(`Wall-clock at V = ${F.n.toLocaleString()}: A* ran in <b>${(F.astarMsX * 100).toFixed(0)}%</b> of Dijkstra's time, bidirectional in <b>${(F.bidirMsX * 100).toFixed(0)}%</b>, Bellman–Ford in <b>${F.bfMsX.toFixed(0)}×</b>.`);
    facts.push(`Correctness cross-check inside the benchmark: ${F.cmp} trips on ${scaling.rows.length} cities, ${F.ok ? '<b>all four optimal algorithms returned identical costs</b>' : '<b>DISAGREEMENTS FOUND</b>'}.`);
  }
  if (hours) {
    const lo = hours.reduce((a, b) => a.astar < b.astar ? a : b), hi = hours.reduce((a, b) => a.astar > b.astar ? a : b);
    LAB.hourFacts = { lo, hi };
    facts.push(`A*'s edge is <b>not constant</b>: it expanded only ${(lo.astar * 100).toFixed(0)}% of Dijkstra's nodes at ${String(lo.h).padStart(2, '0')}:00, but ${(hi.astar * 100).toFixed(0)}% at ${String(hi.h).padStart(2, '0')}:00. When every road is slow, the straight-line heuristic gets weaker.`);
  }
  refs.facts.innerHTML = facts.map(f => `<li>${f}</li>`).join('');
  document.querySelectorAll('[data-fact]').forEach(el => {
    const F = LAB.facts; if (!F) return;
    const k = el.dataset.fact, v = F[k];
    if (v !== undefined) el.textContent = k.endsWith('Exp') || k.endsWith('Rel') ? (v * 100).toFixed(0) + '%' : (k === 'bfX' ? v.toFixed(0) + '×' : v.toFixed(2));
  });
  if (LAB.hourFacts) {
    const lo = LAB.hourFacts.lo, hi = LAB.hourFacts.hi;
    document.querySelectorAll('[data-hour]').forEach(el => {
      el.textContent = el.dataset.hour === 'lo' ? (lo.astar * 100).toFixed(0) + '%' : (hi.astar * 100).toFixed(0) + '%';
    });
  }
}

function labCSV() {
  const rows = [['V', 'E', 'algorithm', 'ms_per_query', 'nodes_expanded', 'edges_examined', 'queries']];
  if (LAB.scaling) for (const r of LAB.scaling.rows) for (const id of ALGO_ORDER) {
    const x = r.res[id]; rows.push([r.n, r.m, id, x.ms.toFixed(5), x.expanded.toFixed(1), x.relaxed.toFixed(1), x.queries]);
  }
  return rows.map(r => r.join(',')).join('\n');
}
