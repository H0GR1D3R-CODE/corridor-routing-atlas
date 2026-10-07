'use strict';
/* ==========================================================================
   CORRIDOR · app.js  –  wires the engine to the page
   ========================================================================== */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const tick = () => new Promise(r => setTimeout(r, 0));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const pad2 = n => String(n).padStart(2, '0');
  const fmtHour = h => { const m = Math.round(h * 60) % 1440; return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); };
  const num = v => Math.round(v).toLocaleString();

  /* ------------------------------------------------------------- the city */
  const g = buildCity(CITY);
  const mask = new Uint8Array(g.n); g.hospitals.forEach(h => mask[h.node] = 1);
  const lm = name => g.landmarks.find(l => l.name === name).node;
  window.CORRIDOR = { g };        // handy for the viva: open DevTools and poke at it

  $$('[data-g]').forEach(el => {
    const k = el.dataset.g;
    el.textContent = { n: num(g.n), m: num(g.m), h: g.hospitals.length, w: g.water.length, r: g.R.toFixed(0), p: g.landmarks.length }[k];
  });

  /* ---------------------------------------------------------------- state */
  const st = { frame: null, cond: { day: 'weekday', sky: 'clear', events: [] }, hour: 18.5, siren: false, mode: 'hospital', algo: 'astar', tool: 'route', A: -1, B: -1, next: 'A', ticket: 0, res: null, anim: null, theme: 'day' };
  const plate = new Plate($('#plate'), g);
  plate.onResize = () => { if (st.res && st.frame) plate.frame(st.frame); };
  const tip = $('#tip');
  const vis = { plate: false, race: false, board: false };

  /* ---------------------------------------------------------------- hours */
  function curveSVG() {
    const svg = $('#hourCurve'); let d = '';
    for (let i = 0; i <= 96; i++) { const h = i / 4; d += (i ? 'L' : 'M') + (h / 24 * 240).toFixed(1) + ' ' + (44 - peakIntensity(h, st.cond.day) * 38).toFixed(1); }
    svg.innerHTML = `<path class="fill" d="${d} L240 44 L0 44Z"/><path class="stroke" d="${d}"/><line class="now" id="hourNow" x1="0" x2="0" y1="0" y2="44"/>`;
  }
  function phase(h) {
    const p = peakIntensity(h, st.cond.day);
    return p < 0.08 ? 'empty roads' : p < 0.4 ? 'light traffic' : p < 0.8 ? 'heavy traffic' : 'peak traffic';
  }
  function closedCount() { let n = 0; for (let e = 0; e < g.m; e++) if (g.blocked[e]) n++; return n; }
  function sceneText() {
    const c = st.cond, ev = c.events.map(id => EVENTS[id].label), n = closedCount();
    return [DAYS[c.day].label + ' ' + fmtHour(st.hour), c.sky === 'clear' ? 'clear sky' : SKIES[c.sky].label.toLowerCase()].concat(ev, n ? [n + ' roads closed'] : [], st.siren ? ['siren on'] : []).join(' · ');
  }
  /* Recompute every road's travel time for the current scene, then explain the result. */
  function applyWorld() {
    applyTraffic(g, st.hour, st.siren, st.cond);
    $('#hourLabel').textContent = fmtHour(st.hour);
    $('#hourPhase').textContent = phase(st.hour);
    let mT = 0, mW = 0, mE = 0;
    for (let e = 0; e < g.m; e++) { mT += g.cT[e]; mW += g.cW[e]; mE += g.cE[e]; }
    mT /= g.m; mW /= g.m; mE /= g.m;
    const total = 1 + mT + mW + mE, c = st.cond;
    $('#hourAvg').textContent = '×' + total.toFixed(2);
    $('#whyTen').textContent = (10 * total).toFixed(0);
    const rows = [
      ['time', 'Time of day', mT, DAYS[c.day].label + ', ' + phase(st.hour)],
      ['sky', 'Weather', mW, SKIES[c.sky].note],
      ['event', 'Events', mE, c.events.length ? c.events.map(id => EVENTS[id].label).join(', ') : 'nothing unusual'],
    ];
    const scale = Math.max(1.6, mT + mW + mE), ul = $('#whyBars'); ul.textContent = '';
    for (const [key, name, v, detail] of rows) {
      const li = document.createElement('li'); li.className = 'w-' + key + (v < 0.005 ? ' zero' : '');
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = name;
      const bar = document.createElement('span'); bar.className = 'bar'; const fill = document.createElement('i'); fill.style.width = Math.min(100, v / scale * 100).toFixed(1) + '%'; bar.appendChild(fill);
      const val = document.createElement('b'); val.textContent = v < 0.005 ? '–' : '+' + v.toFixed(2);
      const dt = document.createElement('small'); dt.textContent = detail;
      li.append(nm, bar, val, dt); ul.appendChild(li);
    }
    const n = closedCount();
    $('#closedN').textContent = n; $('#closedN2').textContent = n;
    syncChips(); plate.dirty = true;
  }

  /* ---------------------------------------------------------------- solve */
  function clearResult() {
    st.res = null; st.anim = null; st.frame = null;
    plate.search = null; plate.setRoute(null); plate.amb = -1; plate.ranked = [];
    plate.marks = []; if (st.A >= 0) plate.marks.push({ node: st.A, kind: st.mode === 'hospital' ? 'X' : 'A' });
    if (st.mode === 'p2p' && st.B >= 0) plate.marks.push({ node: st.B, kind: 'B' });
    $('#split').hidden = true;
    for (const id of ['eta', 'tVia', 'tDist', 'tSpeed', 'tExp', 'tRel', 'tMs', 'tCmp']) $('#' + id).textContent = '–';
    $('#etaSub').textContent = st.mode === 'hospital' ? 'Click the map to report an incident.' : (st.A < 0 ? 'Click the map to place the origin A.' : 'Now click the destination B.');
    $('#tFrom').textContent = st.A >= 0 ? g.place(st.A) : '–'; $('#tTo').textContent = '–';
    $('#rank').innerHTML = ''; $('#verdict').textContent = '';
    syncTrip(); plate.dirty = true;
  }

  function solve(animate = true) {
    if (st.A < 0 || (st.mode === 'p2p' && st.B < 0)) { clearResult(); return; }
    if (st.mode === 'p2p' && st.A === st.B) { clearResult(); $('#etaSub').textContent = 'Origin and destination are the same place. Pick a different B.'; return; }
    let res, path, rank = null, cmp = '';
    if (st.mode === 'hospital') {
      res = nearestTargets(g, st.A, mask, 1, {});
      if (!res.hits.length) { clearResult(); $('#etaSub').textContent = 'No hospital reachable: the incident is cut off by closures.'; return; }
      st.B = res.hits[0].node; path = res.pathTo(st.B);
      const all = nearestTargets(g, st.A, mask, g.hospitals.length, {}).hits;   // ETA to every hospital, one run
      rank = all;
      let sumA = 0; for (const h of g.hospitals) sumA += astar(g, st.A, h.node, { light: true }).relaxed;
      cmp = `${num(res.relaxed)} vs ${num(sumA)}`;
    } else {
      res = ALGOS[st.algo].fn(g, st.A, st.B, {});
      path = res.path;
    }
    if (!path) { clearResult(); $('#etaSub').textContent = 'Destination unreachable with current closures.'; return; }
    const M = pathMetrics(g, path);
    const openCost = closedCount() ? dijkstra(g, st.A, st.B, { light: true, W: g.Wopen }).cost : M.minutes;   // same trip if nothing were closed
    const base = st.mode === 'p2p' ? dijkstra(g, st.A, st.B, { light: true }) : null;
    st.res = res; st.ticket++;

    plate.marks = st.mode === 'hospital' ? [{ node: st.A, kind: 'X' }] : [{ node: st.A, kind: 'A' }, { node: st.B, kind: 'B' }];
    plate.ranked = rank ? rank.slice(0, 3).map(h => h.node) : [];
    plate.search = { order: res.order, orderParent: res.orderParent, side: res.side, count: 0 };
    plate.setRoute(path); plate.routeProg = 0; plate.amb = -1;
    st.frame = path.concat(plate.ranked);
    if (animate) plate.frame(st.frame);                        // glide to frame the new trip
    st.anim = { t0: performance.now() - (animate ? 0 : 1e6), n: res.order.length, ambDur: Math.min(9000, Math.max(3600, M.minutes * 150)) };

    /* ---- ticket ---- */
    $('#tNo').textContent = '№ ' + String(st.ticket).padStart(4, '0');
    tween($('#eta'), M.minutes, animate ? 700 : 0, v => v.toFixed(1));
    $('#etaSub').textContent = sceneText();
    $('#tFrom').textContent = g.place(st.A);
    $('#tTo').textContent = st.mode === 'hospital' ? (g.hospitals.find(h => h.node === st.B) || {}).name || g.place(st.B) : g.place(st.B);
    const via = g.via(path);
    $('#tVia').textContent = via.length ? via.slice(0, 4).join(' › ') + (via.length > 4 ? ' …' : '') : 'local streets only';
    $('#tDist').textContent = M.km.toFixed(1) + ' km';
    $('#tSpeed').textContent = (M.km / M.minutes * 60).toFixed(1) + ' km/h';
    $('#tAlgo').textContent = st.mode === 'hospital' ? 'Multi-target Dijkstra' : ALGOS[st.algo].label;
    $('#tExp').textContent = `${num(res.expanded)} of ${num(g.n)}  (${(res.expanded / g.n * 100).toFixed(0)}%)`;
    $('#tRel').textContent = num(res.relaxed);
    $('#tMs').textContent = res.ms < 0.05 ? 'under 0.1 ms' : res.ms.toFixed(2) + ' ms';
    renderSplit(path, M.minutes, openCost);
    $('#tCmpLabel').textContent = st.mode === 'hospital' ? '1 run vs A* per hospital' : 'Work vs Dijkstra';
    $('#tCmp').textContent = st.mode === 'hospital' ? cmp : `${num(res.relaxed)} vs ${num(base.relaxed)}`;

    /* ---- rank list ---- */
    const rk = $('#rank');
    if (rank) {
      const crow = g.hospitals.map(h => ({ h, d: Math.hypot(g.x[h.node] - g.x[st.A], g.y[h.node] - g.y[st.A]) })).sort((a, b) => a.d - b.d)[0];
      const eta = n => (rank.find(r => r.node === n) || {}).cost;
      rk.innerHTML = '<h4>Ranked by travel time</h4><ol>' + rank.slice(0, 4).map((r, i) => {
        const h = g.hospitals.find(h => h.node === r.node);
        const d = Math.hypot(g.x[r.node] - g.x[st.A], g.y[r.node] - g.y[st.A]);
        return `<li class="${i === 0 ? 'top' : ''}"><span>${h.name}</span><i></i><b>${r.cost.toFixed(1)} min</b><small>${d.toFixed(1)} km straight</small></li>`;
      }).join('') + '</ol>';
      const fastest = g.hospitals.find(h => h.node === rank[0].node);
      $('#verdict').innerHTML = crow.h.node === rank[0].node
        ? `The closest hospital on the map is also the fastest to reach right now.`
        : `<b>${crow.h.name}</b> is closest as the crow flies (${crow.d.toFixed(1)} km) but would take <b>${eta(crow.h.node) === undefined ? '—' : eta(crow.h.node).toFixed(1)} min</b>. <b>${fastest.name}</b> wins by <b>${(eta(crow.h.node) - rank[0].cost).toFixed(1)} min</b>: distance is the wrong question.`;
    } else {
      rk.innerHTML = '';
      const gap = res.cost / base.cost - 1;
      const exp = res.expanded / base.expanded;
      let v;
      if (!ALGOS[st.algo].optimal) v = gap > 1e-6 ? `Greedy reached B, but its route is <b>${(gap * 100).toFixed(0)}% slower</b> than the optimum. It only ever looks at distance-to-go, so it walks straight into the jam.` : 'Greedy happened to find the optimal route here. On other trips it will not.';
      else if (st.algo === 'dijkstra') v = `Baseline. It explored ${(res.expanded / g.n * 100).toFixed(0)}% of the city in every direction because it cannot tell which way B lies.`;
      else if (st.algo === 'bellman') v = `Optimal, but it re-examined every road <b>${res.passes}</b> times: ${num(res.relaxed)} edge checks, ${(res.relaxed / base.relaxed).toFixed(0)}× Dijkstra's work.`;
      else v = `Same ETA as Dijkstra to the last decimal, with <b>${(exp * 100).toFixed(0)}%</b> of its node expansions (${num(res.expanded)} vs ${num(base.expanded)}).`;
      $('#verdict').innerHTML = v;
    }
    syncTrip(); plate.dirty = true;
  }

  /* "Where the minutes go": the ETA of this route split into what causes it. Because
     w(e) = base * (1 + k(T + S + E)), the four parts add up to the ETA exactly.        */
  function renderSplit(path, eta, openCost) {
    const k = st.siren ? 0.45 : 1; let f = 0, T = 0, S = 0, E = 0;
    for (let i = 0; i + 1 < path.length; i++) {
      const e = g.edgeBetween(path[i], path[i + 1]);
      f += g.base[e]; T += g.base[e] * g.cT[e] * k; S += g.base[e] * g.cW[e] * k; E += g.base[e] * g.cE[e] * k;
    }
    const parts = [['road', 'Open road', f, 'this route with nobody else on it'], ['time', 'Time of day', T, DAYS[st.cond.day].label + ' at ' + fmtHour(st.hour)],
      ['sky', 'Weather', S, SKIES[st.cond.sky].label], ['event', 'Events', E, st.cond.events.map(id => EVENTS[id].label).join(', ') || 'none']];
    const bar = $('#splitBar'), key = $('#splitKey'); bar.textContent = ''; key.textContent = '';
    for (const [id, name, v, detail] of parts) {
      const li = document.createElement('li'); li.className = 's-' + id + (v < 0.05 ? ' zero' : '');
      const sw = document.createElement('i'), nm = document.createElement('span'), val = document.createElement('b');
      nm.textContent = name; val.textContent = v < 0.05 ? '–' : (id === 'road' ? '' : '+') + v.toFixed(1) + ' min';
      li.title = detail; li.append(sw, nm, val); key.appendChild(li);
      if (v < 0.05) continue;
      const seg = document.createElement('i'); seg.className = 's-' + id; seg.style.flex = v.toFixed(2) + ' 1 0'; seg.tabIndex = 0;
      seg.title = `${name}: ${v.toFixed(1)} min (${(v / eta * 100).toFixed(0)}% of the trip) · ${detail}`;
      const on = () => { key.querySelectorAll('li').forEach(x => x.classList.toggle('on', x === li)); bar.querySelectorAll('i').forEach(x => x.classList.toggle('dim', x !== seg)); };
      const off = () => { key.querySelectorAll('li').forEach(x => x.classList.remove('on')); bar.querySelectorAll('i').forEach(x => x.classList.remove('dim')); };
      seg.addEventListener('pointerenter', on); seg.addEventListener('pointerleave', off); seg.addEventListener('focus', on); seg.addEventListener('blur', off);
      li.addEventListener('pointerenter', on); li.addEventListener('pointerleave', off);
      bar.appendChild(seg);
    }
    const detour = eta - openCost, n = closedCount();
    $('#splitNote').textContent = detour > 0.05 ? `Closed roads force a detour worth +${detour.toFixed(1)} min on top of that.` : n ? 'None of the closed roads is in the way of this trip.' : (st.siren ? 'The siren has already cut every delay by 55%.' : '');
    $('#split').hidden = false;
  }

  function tween(el, to, dur, fmt) {
    if (!dur) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    (function step(now) {
      const p = Math.min(1, (now - t0) / dur), e = 1 - (1 - p) ** 3;
      el.textContent = fmt(to * e);
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }

  function stepAnim(now) {
    const a = st.anim; if (!a || !plate.search) return;
    const e = now - a.t0, SD = 1500, RD = 900;
    const p = Math.min(1, e / SD);
    plate.search.count = Math.floor(a.n * (1 - (1 - p) ** 2));
    if (e > SD) plate.routeProg = Math.min(1, (e - SD) / RD);
    if (e > SD + RD) plate.amb = ((e - SD - RD) / a.ambDur) % 1;
  }

  /* ------------------------------------------------------------- controls */
  function seg(rootSel, attr, onPick) {
    const root = $(rootSel);
    root.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b || b.disabled) return;
      $$('button', root).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      onPick(b.dataset[attr]);
    });
  }
  function setSeg(rootSel, attr, val) { $$(rootSel + ' button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === val))); }

  function syncMode() {
    $('#algoSeg').classList.toggle('muted', st.mode === 'hospital');
    $$('#algoSeg button').forEach(b => b.disabled = st.mode === 'hospital');
    $('#algoNote').textContent = st.mode === 'hospital' ? 'Hospital dispatch always uses multi-target Dijkstra (see §06).' : ALGOS[st.algo].blurb;
  }
  seg('#algoSeg', 'algo', v => { st.algo = v; syncMode(); solve(); });
  seg('#toolSeg', 'tool', v => { st.tool = v; $('#plate').dataset.tool = v; });
  $('#siren').addEventListener('change', e => { st.siren = e.target.checked; applyWorld(); solve(false); });
  $('#hour').addEventListener('input', e => { st.hour = +e.target.value; applyWorld(); solve(false); });
  $('#clearBlocks').addEventListener('click', () => { for (let e = 0; e < g.m; e++) if (g.blocked[e] === 1) g.blocked[e] = 0; applyWorld(); solve(false); });
  $('#zoomIn').addEventListener('click', () => plate.zoomAt(plate.w / 2, plate.h / 2, 1.5));
  $('#zoomOut').addEventListener('click', () => plate.zoomAt(plate.w / 2, plate.h / 2, 1 / 1.5));
  $('#resetView').addEventListener('click', () => plate.fit());

  /* ---------------------------------------------------- the scene: day, sky, events */
  const SCENES = [
    ['Office rush',        { hour: 9.25, day: 'weekday',  sky: 'clear',      events: ['school'] }],
    ['Rainy evening rush', { hour: 18.5, day: 'weekday',  sky: 'rain',       events: ['techpark'] }],
    ['Lazy Sunday',        { hour: 11,   day: 'sunday',   sky: 'clear',      events: [] }],
    ['Dead of night',      { hour: 2.5,  day: 'weekday',  sky: 'clear',      events: [] }],
    ['Monsoon flood',      { hour: 19,   day: 'weekday',  sky: 'flood',      events: [] }],
    ['Festival day',       { hour: 18,   day: 'holiday',  sky: 'clear',      events: ['festival'] }],
    ['Bandh',              { hour: 12,   day: 'bandh',    sky: 'clear',      events: [] }],
    ['Apocalypse',         { hour: 18.5, day: 'weekday',  sky: 'cloudburst', events: ['apocalypse'] }],
  ];
  function chip(parent, label, data, title) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.setAttribute('aria-pressed', 'false');
    Object.assign(b.dataset, data); if (title) b.title = title; parent.appendChild(b); return b;
  }
  SCENES.forEach(([label], i) => chip($('#scenes'), label, { scene: i }));
  for (const id in DAYS) chip($('#dayChips'), DAYS[id].label, { day: id }, DAYS[id].note);
  for (const id in SKIES) chip($('#skyChips'), SKIES[id].label, { sky: id }, SKIES[id].note);
  for (const id in EVENTS) chip($('#evChips'), EVENTS[id].label, { ev: id }, EVENTS[id].note).classList.toggle('danger', id === 'apocalypse');
  function syncChips() {
    const c = st.cond, same = (a, b) => a.length === b.length && a.every(x => b.includes(x));
    $$('#dayChips button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.day === c.day)));
    $$('#skyChips button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sky === c.sky)));
    $$('#evChips button').forEach(b => b.setAttribute('aria-pressed', String(c.events.includes(b.dataset.ev))));
    $$('#scenes button').forEach(b => { const sc = SCENES[+b.dataset.scene][1]; b.setAttribute('aria-pressed', String(sc.day === c.day && sc.sky === c.sky && Math.abs(sc.hour - st.hour) < 0.01 && same(sc.events, c.events))); });
    $('#dayNote').textContent = DAYS[c.day].note; $('#skyNote').textContent = SKIES[c.sky].note;
    $('#evNote').textContent = c.events.length ? EVENTS[c.events[c.events.length - 1]].note : 'tap any that apply';
  }
  function sceneChanged() { curveSVG(); applyWorld(); unpressCases(); solve(); }
  $('#dayChips').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; st.cond.day = b.dataset.day; sceneChanged(); });
  $('#skyChips').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; st.cond.sky = b.dataset.sky; sceneChanged(); });
  $('#evChips').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; const id = b.dataset.ev, i = st.cond.events.indexOf(id);
    if (i >= 0) st.cond.events.splice(i, 1); else st.cond.events.push(id);
    sceneChanged();
  });
  $('#scenes').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; const sc = SCENES[+b.dataset.scene][1];
    st.hour = sc.hour; $('#hour').value = sc.hour; st.cond = { day: sc.day, sky: sc.sky, events: sc.events.slice() };
    sceneChanged();
  });
  /* the lab's hour-by-hour chart can drive the console clock */
  window.addEventListener('corridor:hour', e => {
    st.hour = e.detail; $('#hour').value = st.hour; st.cond.day = 'weekday'; curveSVG(); applyWorld(); solve(false);
    $('#labMsg').textContent = `Console clock set to ${fmtHour(st.hour)} on a weekday. Scroll up to see the route change.`;
    $('#labProg').classList.add('on'); clearTimeout(window.__labT); window.__labT = setTimeout(() => $('#labProg').classList.remove('on'), 3200);
  });

  /* ------------------------------------------------------- place pickers */
  const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function whereIs(v) {                      // "7 km E" as seen from Majestic
    const d = Math.hypot(g.x[v], g.y[v]); if (d < 0.5) return 'city centre';
    const b = (Math.atan2(g.x[v], -g.y[v]) * 180 / Math.PI + 360) % 360;
    return d.toFixed(0) + ' km ' + COMPASS[Math.round(b / 45) % 8];
  }
  function placeItems(which) {
    const cur = which === 'A' ? st.A : (st.mode === 'hospital' ? -2 : st.B), out = [];
    const hosp = g.hospitals.map(h => ({ id: h.node, label: h.name, sub: 'hospital · ' + whereIs(h.node), group: 'Hospitals', cur: h.node === cur }));
    if (which === 'B') { out.push({ id: 'auto', label: 'Nearest hospital', sub: 'auto-dispatch', group: 'Dispatch', cur: st.mode === 'hospital' }); out.push(...hosp); }
    for (const z of ZONES) for (const L of g.landmarks) if (L.zone === z) out.push({ id: L.node, label: L.name, sub: whereIs(L.node), group: z, cur: L.node === cur });
    if (which === 'A') out.push(...hosp);
    return out;
  }
  function makePicker(root, which, onPick) {
    const btn = $('.pick-btn', root), val = $('.pick-val', root), pop = $('.pick-pop', root), inp = $('input', pop), list = $('ul', pop);
    let open = false, flat = [], act = 0;
    const esc = t => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    function render(keepAct) {
      const q = inp.value.trim().toLowerCase();
      flat = placeItems(which);
      if (q) {                               // searching: one flat list, names that start with the query first
        const rank = it => { const l = it.label.toLowerCase(); return l.startsWith(q) ? 0 : l.split(/[\s.']+/).some(w => w.startsWith(q)) ? 1 : l.includes(q) ? 2 : it.group.toLowerCase().startsWith(q) ? 3 : 9; };
        flat = flat.map(it => ({ it, r: rank(it) })).filter(o => o.r < 9).sort((a, b) => a.r - b.r)
          .map(o => ({ ...o.it, sub: o.it.group === 'Hospitals' || o.it.group === 'Dispatch' ? o.it.sub : o.it.group + ' · ' + o.it.sub, group: 'Matches' }));
      }
      if (!keepAct) act = q ? 0 : Math.max(0, flat.findIndex(i => i.cur));
      act = Math.min(act, Math.max(0, flat.length - 1));
      let html = '', grp = null;
      flat.forEach((it, i) => {
        if (it.group !== grp) { grp = it.group; html += `<li class="grp" role="presentation">${esc(grp)}</li>`; }
        html += `<li role="option" data-i="${i}" aria-selected="${i === act}" class="${i === act ? 'act' : ''}${it.cur ? ' cur' : ''}"><span>${esc(it.label)}</span><small>${esc(it.sub)}</small></li>`;
      });
      list.innerHTML = html || '<li class="none">No place matches that.</li>';
      const a = list.querySelector('.act');
      if (a) {                               // keep the active row in view without scrolling the page
        const top = a.offsetTop - 34, bot = a.offsetTop + a.offsetHeight;
        if (top < list.scrollTop) list.scrollTop = top; else if (bot > list.scrollTop + list.clientHeight) list.scrollTop = bot - list.clientHeight;
      }
    }
    function show(v) {
      open = v; pop.hidden = !v; btn.setAttribute('aria-expanded', String(v));
      if (v) { inp.value = ''; render(); inp.focus({ preventScroll: true }); }
    }
    function choose(it) { if (!it) return; show(false); btn.focus({ preventScroll: true }); onPick(it); }
    btn.addEventListener('click', () => show(!open));
    inp.addEventListener('input', () => render());
    inp.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { act = Math.min(flat.length - 1, act + 1); render(true); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { act = Math.max(0, act - 1); render(true); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(flat[act]); }
      else if (e.key === 'Escape') { show(false); btn.focus({ preventScroll: true }); }
    });
    list.addEventListener('click', e => { const li = e.target.closest('li[data-i]'); if (li) choose(flat[+li.dataset.i]); });
    list.addEventListener('pointermove', e => {
      const li = e.target.closest('li[data-i]'); if (!li || +li.dataset.i === act) return;
      const old = list.querySelector('.act'); if (old) old.classList.remove('act');
      act = +li.dataset.i; li.classList.add('act');
    });
    document.addEventListener('pointerdown', e => { if (open && !root.contains(e.target)) show(false); });
    return { set: t => { val.textContent = t; } };
  }
  const unpressCases = () => $$('#cases button[data-case]').forEach(b => b.setAttribute('aria-pressed', 'false'));
  const pickA = makePicker($('#pickA'), 'A', it => { st.A = it.id; if (st.mode === 'p2p') st.next = st.B < 0 ? 'B' : 'A'; unpressCases(); solve(); });
  const pickB = makePicker($('#pickB'), 'B', it => {
    if (it.id === 'auto') { st.mode = 'hospital'; st.B = -1; } else { st.mode = 'p2p'; st.B = it.id; st.next = 'A'; }
    setSeg('#modeSeg', 'mode', st.mode); syncMode(); unpressCases(); solve();
  });
  $('#swap').addEventListener('click', () => { if (st.mode !== 'p2p' || st.A < 0 || st.B < 0) return; [st.A, st.B] = [st.B, st.A]; unpressCases(); solve(); });
  function syncTrip() {
    const hosp = st.mode === 'hospital';
    $('#pickALbl').textContent = hosp ? 'Incident at' : 'From';
    $('#pickA .mk').textContent = hosp ? '!' : 'A';
    pickA.set(st.A >= 0 ? g.place(st.A) : 'Choose a place');
    const won = hosp && st.res && st.B >= 0 ? g.hospitals.find(h => h.node === st.B) : null;
    pickB.set(hosp ? 'Nearest hospital' + (won ? ': ' + won.name : '') : (st.B >= 0 ? g.place(st.B) : 'Choose a place'));
    $('#swap').disabled = hosp || st.A < 0 || st.B < 0;
  }

  /* closures */
  function toggleBlock(px, py) {
    const [wx, wy] = plate.world(px, py), r = g.nearestEdge(wx, wy);
    if (r.edge < 0 || r.d > Math.max(0.6, 14 / plate.cam.s)) return;
    if (g.blocked[r.edge] === 2) return;               // shut by the scene itself (flood, accident): change the scene to reopen it
    g.blocked[r.edge] = g.blocked[r.edge] ? 0 : 1; applyWorld(); solve(false);
  }

  /* pointer handling: click, drag-to-pan, ctrl+wheel zoom, hover read-out */
  const cv = $('#plate'); let drag = null;
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, moved: false, b: e.button, shift: e.shiftKey }; });
  cv.addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (drag.moved || Math.hypot(dx, dy) > 5) { drag.moved = true; plate.pan(e.movementX, e.movementY); cv.classList.add('grab'); hideTip(); return; }
    }
    hover(px, py);
  });
  cv.addEventListener('pointerup', e => {
    cv.classList.remove('grab'); if (!drag) return;
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    if (!drag.moved && drag.b === 0) click(px, py, drag.shift);
    drag = null;
  });
  cv.addEventListener('pointerleave', () => { hideTip(); plate.hoverEdge = -1; plate.hoverNode = -1; plate.dirty = true; });
  cv.addEventListener('contextmenu', e => { e.preventDefault(); const r = cv.getBoundingClientRect(); toggleBlock(e.clientX - r.left, e.clientY - r.top); });
  cv.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault(); const r = cv.getBoundingClientRect();
    plate.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0022));
  }, { passive: false });

  function click(px, py, shift) {
    if (st.tool === 'block' || shift) return toggleBlock(px, py);
    const v = plate.pickNode(px, py); if (v < 0) return;
    unpressCases();
    if (st.mode === 'hospital') { st.A = v; solve(); return; }
    if (st.next === 'A') { st.A = v; st.next = 'B'; if (st.B === v) st.B = -1; }
    else { st.B = v; st.next = 'A'; }
    solve();
  }
  const pois = g.landmarks.concat(g.hospitals);
  function showTip(px, py) {
    tip.hidden = false;
    const wrap = $('#plateWrap').getBoundingClientRect(), cr = cv.getBoundingClientRect();
    tip.style.left = Math.max(4, Math.min(wrap.width - 200, px + cr.left - wrap.left + 14)) + 'px';
    tip.style.top = Math.max(4, py + cr.top - wrap.top - 58) + 'px';
  }
  function hover(px, py) {
    /* a named place under the pointer wins over the road beneath it */
    let poi = null, pd = 11;
    for (const L of pois) {
      const d = Math.hypot(plate.cam.ox + g.x[L.node] * plate.cam.s - px, plate.cam.oy + g.y[L.node] * plate.cam.s - py);
      if (d < pd) { pd = d; poi = L; }
    }
    if (poi) {
      plate.hoverNode = poi.node; plate.hoverEdge = -1; plate.dirty = true;
      const w = whereIs(poi.node), does = st.tool === 'block' ? 'switch to “Place point” to route from here' : st.mode === 'hospital' ? 'click to report an incident here' : 'click to set as ' + st.next;
      tip.innerHTML = `<b>${poi.name}</b><span>${poi.zone === 'Hospitals' ? 'Hospital' : poi.zone} · ${w === 'city centre' ? w : w + ' of Majestic'}</span><span>${does}</span>`;
      showTip(px, py); return;
    }
    plate.hoverNode = -1;
    const [wx, wy] = plate.world(px, py), r = g.nearestEdge(wx, wy), maxD = Math.max(0.5, 10 / plate.cam.s);
    if (r.d > maxD) { plate.hoverEdge = -1; hideTip(); plate.dirty = true; return; }
    const e = r.edge; plate.hoverEdge = e; plate.dirty = true;
    const now = g.W[e], free = g.base[e];
    tip.innerHTML = `<b>${g.roadName(e)}</b><span>${g.len[e].toFixed(2)} km · ${g.blocked[e] === 2 ? 'CLOSED by the scene' : g.blocked[e] ? 'CLOSED by you' : now.toFixed(1) + ' min now'}</span><span>free flow ${free.toFixed(1)} min · ×${g.cong[e].toFixed(2)}</span>`;
    showTip(px, py);
  }
  function hideTip() { tip.hidden = true; }

  /* ------------------------------------------------------------ case files */
  const CASES = {
    rush:  () => ({ hour: 18.5, mode: 'hospital', A: lm('Yeshwanthpur'), cond: { day: 'weekday', sky: 'clear', events: [] } }),
    silk:  () => ({ hour: 18.5, mode: 'hospital', A: lm('Silk Board'), cond: { day: 'weekday', sky: 'rain', events: [] } }),
    flood: () => ({ hour: 19, mode: 'p2p', algo: 'astar', A: lm('Electronic City'), B: lm('Hebbal'), cond: { day: 'weekday', sky: 'flood', events: [] } }),
    night: () => ({ hour: 3, mode: 'p2p', algo: 'astar', A: lm('Kempegowda Airport'), B: lm('Electronic City'), cond: { day: 'weekday', sky: 'clear', events: [] } }),
    siren: () => ({ hour: 9.2, mode: 'p2p', algo: 'astar', A: lm('Marathahalli'), B: lm('Majestic'), siren: true, cond: { day: 'weekday', sky: 'clear', events: [] } }),
    match: () => ({ hour: 19.5, mode: 'p2p', algo: 'astar', A: lm('MG Road'), B: lm('Whitefield'), cond: { day: 'saturday', sky: 'clear', events: ['match'] } }),
  };
  function openCase(name) {
    const c = CASES[name](); g.blocked.fill(0);
    st.hour = c.hour; st.mode = c.mode; st.algo = c.algo || st.algo; st.siren = !!c.siren; st.cond = { day: c.cond.day, sky: c.cond.sky, events: c.cond.events.slice() }; st.A = c.A; st.B = c.B ?? -1; st.next = 'A';
    $('#hour').value = st.hour; $('#siren').checked = st.siren;
    setSeg('#modeSeg', 'mode', st.mode); setSeg('#algoSeg', 'algo', st.algo); syncMode();
    curveSVG(); applyWorld(); solve();
    $$('#cases button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.case === name)));
  }
  $('#cases').addEventListener('click', e => { const b = e.target.closest('button[data-case]'); if (b) openCase(b.dataset.case); });

  /* ----------------------------------------------------------------- race */
  const race = new Race(g, $('#raceGrid'), {
    onPrepare: (s, t) => { $('#raceQuery').textContent = `${g.place(s)} → ${g.place(t)}  ·  ${sceneText()}`; $('#raceNote').textContent = ''; },
    onDone: () => { $('#raceNote').textContent = 'All five finished. Same ETA from the four optimal algorithms; compare the work.'; },
  });
  let raceStarted = false;
  function farPair() {
    const r = mulberry32((Math.random() * 1e9) | 0);
    for (let i = 0; i < 400; i++) {
      const s = (r() * g.n) | 0, t = (r() * g.n) | 0;
      if (Math.hypot(g.x[s] - g.x[t], g.y[s] - g.y[t]) > g.R * 1.1) return [s, t];
    }
    return [lm('Kempegowda Airport'), lm('Electronic City')];
  }
  function raceGo(pair) { const [s, t] = pair; race.prepare(s, t); race.start(); raceStarted = true; $('#raceNote').textContent = 'Clock = edge relaxations. Bellman–Ford will take a while: skip to the end when you have seen enough.'; }
  $('#raceRun').addEventListener('click', () => raceGo([lm('Kempegowda Airport'), lm('Electronic City')]));
  $('#raceNew').addEventListener('click', () => raceGo(farPair()));
  $('#raceConsole').addEventListener('click', () => { if (st.A >= 0 && st.B >= 0) raceGo([st.A, st.B]); else $('#raceNote').textContent = 'Place A and B on the console map first (point-to-point mode).'; });
  $('#raceSkip').addEventListener('click', () => { if (race.s >= 0) race.skip(); });

  /* ------------------------------------------------------------ live board */
  const board = new HeroBoard($('#boardCv'), g);
  $('#board').addEventListener('click', e => {
    const r = $('#boardCv').getBoundingClientRect(), v = board.pick(e.clientX - r.left, e.clientY - r.top);
    if (v < 0) return;
    st.mode = 'hospital'; st.A = v; st.B = -1; syncMode(); unpressCases();
    $('#console').scrollIntoView({ behavior: 'smooth' }); solve();
  });

  /* ------------------------------------------------------ replay + big picture */
  const theatre = new Theatre(g, $('#theatre'));
  const openTheatre = o => theatre.open(Object.assign({ theme: THEMES[st.theme], sub: sceneText() }, o));
  $('#replay').addEventListener('click', () => { if (st.A >= 0) solve(); });
  $('#expand').addEventListener('click', () => {
    if (!st.res || !plate.route) { $('#etaSub').textContent = 'Choose a trip first, then open the big picture.'; return; }
    if (st.mode === 'hospital') {
      const h = g.hospitals.find(x => x.node === st.B);
      openTheatre({ A: st.A, B: st.B, title: `${g.place(st.A)} → nearest hospital: ${h.name}`, marks: [{ node: st.A, kind: 'X' }], ranked: plate.ranked, opt: st.res.cost,
        fixed: { label: 'Multi-target Dijkstra', res: st.res, path: plate.route.path,
          blurb: 'One Dijkstra from the incident. It stops the moment the first hospital is settled, and the first one settled is by definition the fastest to reach.' } });
    } else {
      openTheatre({ A: st.A, B: st.B, algo: st.algo, results: { [st.algo]: st.res }, title: `${g.place(st.A)} → ${g.place(st.B)}`,
        marks: [{ node: st.A, kind: 'A' }, { node: st.B, kind: 'B' }], opt: dijkstra(g, st.A, st.B, { light: true }).cost });
    }
  });
  $('#raceGrid').addEventListener('click', e => {
    const fig = e.target.closest('.racer'); if (!fig || race.s < 0) return;
    const results = {}; race.racers.forEach(r => { results[r.id] = r.res; });
    openTheatre({ A: race.s, B: race.t, algo: fig.dataset.algo, results, title: `${g.place(race.s)} → ${g.place(race.t)}`,
      marks: [{ node: race.s, kind: 'A' }, { node: race.t, kind: 'B' }], opt: race.opt });
  });

  /* ---------------------------------------------------------------- tests */
  let testsRan = false, testsBusy = false;
  async function runTests() {
    if (testsBusy) return; testsBusy = true; testsRan = true;
    const ul = $('#ledger'); ul.innerHTML = ''; $('#stamp').classList.remove('on'); $('#testSummary').textContent = 'Running…';
    const rows = TESTS.map(t => {
      const li = document.createElement('li'); li.className = 'pending';
      li.innerHTML = `<span class="id">${t.id}</span><div class="body"><h4>${t.title}</h4><p>${t.claim}</p><code class="detail">waiting</code></div><span class="mark" aria-hidden="true"></span><span class="ms"></span>`;
      ul.appendChild(li); return li;
    });
    let pass = 0, t0all = performance.now();
    for (let i = 0; i < TESTS.length; i++) {
      rows[i].className = 'running'; rows[i].querySelector('.detail').textContent = 'running…';
      await tick(); await sleep(90);
      const t0 = performance.now(); let r;
      try { r = TESTS[i].run(); } catch (err) { r = { pass: false, detail: 'exception: ' + err.message }; }
      const ms = performance.now() - t0;
      rows[i].className = r.pass ? 'pass' : 'fail'; if (r.pass) pass++;
      rows[i].querySelector('.detail').textContent = r.detail;
      rows[i].querySelector('.mark').textContent = r.pass ? 'PASS' : 'FAIL';
      rows[i].querySelector('.ms').textContent = ms.toFixed(0) + ' ms';
    }
    $('#testSummary').textContent = `${pass} / ${TESTS.length} passed in ${((performance.now() - t0all) / 1000).toFixed(1)} s`;
    const stamp = $('#stamp'); stamp.textContent = pass === TESTS.length ? `VERIFIED ${pass}/${TESTS.length}` : `${TESTS.length - pass} FAILING`;
    stamp.classList.toggle('bad', pass !== TESTS.length); stamp.classList.add('on');
    window.CORRIDOR.testsPassed = pass; testsBusy = false;
  }
  $('#testsRun').addEventListener('click', runTests);

  /* ------------------------------------------------------------------ lab */
  let labBusy = false, labRan = false;
  const labRefs = { chartMs: $('#chartMs'), chartWork: $('#chartWork'), chartHours: $('#chartHours'), table: $('#labTable'), tableCap: $('#labCap'), facts: $('#labFacts') };
  async function runLab() {
    if (labBusy) return; labBusy = true; labRan = true;
    const bar = $('#labBar b'), msg = $('#labMsg'), btn = $('#labRun'); btn.disabled = true; $('#labProg').classList.add('on');
    LAB.scaling = await runScaling((p, m) => { bar.style.width = (p * 78) + '%'; msg.textContent = m; });
    msg.textContent = 'Sweeping the clock…'; await tick();
    LAB.hours = await runHours((p, m) => { bar.style.width = (78 + p * 22) + '%'; msg.textContent = m; });
    renderLab(labRefs);
    bar.style.width = '100%'; msg.textContent = 'Done.'; setTimeout(() => $('#labProg').classList.remove('on'), 900);
    btn.disabled = false; labBusy = false; window.CORRIDOR.lab = LAB;
  }
  $('#labRun').addEventListener('click', runLab);
  $('#labCSV').addEventListener('click', async () => {
    const csv = labCSV(); if (!LAB.scaling) { $('#labMsg').textContent = 'Run the experiment first.'; return; }
    try { await navigator.clipboard.writeText(csv); $('#labMsg').textContent = 'CSV copied to clipboard.'; } catch { const w = window.open('', '_blank'); if (w) { w.document.write('<pre>' + csv + '</pre>'); } }
    $('#labProg').classList.add('on'); setTimeout(() => $('#labProg').classList.remove('on'), 2200);
  });

  /* ---------------------------------------------------------------- theme */
  function setTheme(t) {
    st.theme = t; document.documentElement.dataset.theme = t;
    plate.theme = THEMES[t]; plate.dirty = true; race.setTheme(THEMES[t]); board.setTheme(THEMES[t]);
    $('#themeBtn').textContent = t === 'day' ? 'Night chart' : 'Day chart';
  }
  $('#themeBtn').addEventListener('click', () => setTheme(st.theme === 'day' ? 'night' : 'day'));

  /* ------------------------------------------------------- visibility / loop */
  const io = new IntersectionObserver(es => {
    for (const e of es) {
      if (e.target.id === 'plateWrap') vis.plate = e.isIntersecting;
      if (e.target.id === 'board') vis.board = e.isIntersecting;
      if (e.target.id === 'raceGrid') { vis.race = e.isIntersecting; if (e.isIntersecting && !raceStarted) raceGo([lm('Kempegowda Airport'), lm('Electronic City')]); }
      if (e.target.id === 'testSummary' && e.isIntersecting && !testsRan) runTests();
      if (e.target.id === 'chartMs' && e.isIntersecting && !labRan) runLab();
    }
  }, { threshold: 0.25 });
  ['board', 'plateWrap', 'raceGrid', 'testSummary', 'chartMs'].forEach(id => io.observe($('#' + id)));

  /* scroll-spy: the section whose top has passed 35% of the viewport; none while in the masthead */
  const secs = $$('main > section'), tocLinks = $$('.toc a[href^="#"]:not(.toc-brand)');
  let spyQueued = false;
  function spy() {
    spyQueued = false; let cur = '';
    for (const sec of secs) if (sec.getBoundingClientRect().top <= innerHeight * 0.35) cur = sec.id;
    tocLinks.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + cur));
    $('.toc').classList.toggle('stuck', $('.toc').getBoundingClientRect().top <= 0.5);
  }
  addEventListener('scroll', () => { if (!spyQueued) { spyQueued = true; requestAnimationFrame(spy); } }, { passive: true });

  /* fit the wordmark to the full measure, whatever font actually loaded */
  let fitRoom = -1;
  function fitTitle(force) {
    const h1 = $('h1'), w = $('#wordmark'); if (!h1 || !w) return;
    const room = h1.clientWidth; if (!room || (room === fitRoom && force !== true)) return;
    fitRoom = room;
    h1.style.fontSize = '200px';
    const natural = w.getBoundingClientRect().width;
    h1.style.fontSize = natural > 0 ? (200 * room / natural * 0.995).toFixed(2) + 'px' : '';
  }
  fitTitle(true);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitTitle(true));
  if ('ResizeObserver' in window) new ResizeObserver(() => fitTitle()).observe($('.mast'));

  function frame(now) {
    requestAnimationFrame(frame);
    if (theatre.isOpen) { theatre.tick(now); return; }
    if (vis.board) board.draw(now);
    if (vis.plate) { stepAnim(now); plate.draw(now); }
    if (vis.race) { race.tick(now); race.draw(now); }
  }
  requestAnimationFrame(frame);

  let rz; window.addEventListener('resize', () => { clearTimeout(rz); fitTitle(); rz = setTimeout(() => { fitTitle(); plate.resize(); race.resize(); board.resize(); if (st.res && st.frame) plate.frame(st.frame); }, 120); });

  /* ----------------------------------------------------------------- boot */
  curveSVG(); syncMode(); setTheme('day'); spy();
  $('#plate').dataset.tool = 'route';
  openCase('rush');
})();
