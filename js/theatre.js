'use strict';
/* ==========================================================================
   CORRIDOR · theatre.js
   --------------------------------------------------------------------------
   The "big picture": one search on a full-screen plate, with transport
   controls. Play, pause, scrub to any step, change speed, switch algorithm
   and replay. A small live curve plots edges examined against junctions
   visited, so you can watch the cost of the answer accumulate.
   ========================================================================== */

class Theatre {
  constructor(g, root) {
    this.g = g; this.root = root; this.isOpen = false;
    this.plate = null; this.results = {}; this.idx = 0; this.n = 0; this.playing = false; this.done = false; this.speed = 1;
    const q = s => root.querySelector(s);
    this.el = {
      title: q('#thTitle'), sub: q('#thSub'), algo: q('#thAlgo'), blurb: q('#thBlurb'), canvas: q('#thCanvas'),
      play: q('#thPlay'), replay: q('#thReplay'), scrub: q('#thScrub'), speed: q('#thSpeed'), close: q('#thClose'),
      visited: q('#thVisited'), work: q('#thWork'), share: q('#thShare'), eta: q('#thEta'), verdict: q('#thVerdict'),
      curve: q('#thCurve'), step: q('#thStep'),
    };
    const el = this.el;
    el.close.addEventListener('click', () => this.close());
    el.replay.addEventListener('click', () => this.replay());
    el.play.addEventListener('click', () => { if (this.done) this.replay(); else this.setPlaying(!this.playing); });
    el.scrub.addEventListener('input', () => this.seek(+el.scrub.value / 1000 * this.n));
    el.speed.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      this.speed = +b.dataset.speed;
      el.speed.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    });
    el.algo.addEventListener('click', e => { const b = e.target.closest('button[data-algo]'); if (b && !b.disabled) this.show(b.dataset.algo); });
    document.addEventListener('keydown', e => {
      if (!this.isOpen) return;
      if (e.key === 'Escape') { this.close(); e.preventDefault(); }
      else if (e.target.matches('input, button')) return;
      else if (e.key === ' ') { el.play.click(); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { this.seek(Math.floor(this.idx) + 1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { this.seek(Math.floor(this.idx) - 1); e.preventDefault(); }
    });
    window.addEventListener('resize', () => { if (this.isOpen && this.plate) { this.plate.resize(); this.reframe(); } });
  }

  /* o: { A, B, algo, results?, fixed?: { label, blurb, res, path }, marks, ranked, title, sub, theme, opt } */
  open(o) {
    this.o = o; this.results = Object.assign({}, o.results || {});
    this.root.hidden = false; this.isOpen = true; document.body.classList.add('no-scroll');
    if (!this.plate) { this.plate = new Plate(this.el.canvas, this.g); this.plate.onResize = () => this.reframe(); }
    this.plate.theme = o.theme; this.plate.resize();
    this.el.title.textContent = o.title; this.el.sub.textContent = o.sub || '';
    this.el.algo.textContent = '';
    const ids = o.fixed ? ['fixed'] : ALGO_ORDER;
    for (const id of ids) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.algo = id;
      b.textContent = id === 'fixed' ? o.fixed.label : ALGOS[id].label; b.disabled = !!o.fixed;
      this.el.algo.appendChild(b);
    }
    this.show(o.fixed ? 'fixed' : o.algo);
    this.el.close.focus({ preventScroll: true });
  }
  close() {
    this.isOpen = false; this.root.hidden = true; document.body.classList.remove('no-scroll');
    if (this.o && this.o.onClose) this.o.onClose();
  }

  show(id) {
    const { g, o, el, plate } = this;
    let res, path, label, blurb;
    if (id === 'fixed') ({ res, path, label, blurb } = o.fixed);
    else {
      res = this.results[id] || (this.results[id] = ALGOS[id].fn(g, o.A, o.B, {}));
      path = res.path; label = ALGOS[id].label; blurb = ALGOS[id].blurb;
    }
    this.id = id; this.res = res; this.path = path; this.n = res.order.length; this.label = label;
    el.algo.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.algo === id)));
    el.blurb.textContent = blurb;
    plate.marks = o.marks || []; plate.ranked = o.ranked || [];
    plate.search = { order: res.order, orderParent: res.orderParent, side: res.side, count: 0 };
    this.reframe();
    this.drawCurve();
    this.replay();
  }
  reframe() {
    const nodes = (this.path || []).concat((this.o.marks || []).map(m => m.node), this.o.ranked || []);
    this.plate.fit(); this.plate.frame(nodes, 13, 1.8);
  }

  replay() {
    this.idx = 0; this.done = false; this.last = 0;
    this.plate.setRoute(null); this.plate.amb = -1; this.plate.routeProg = 0; this.plate.search.count = 0;
    this.setPlaying(true); this.sync();
  }
  setPlaying(v) { this.playing = v; this.el.play.textContent = this.done ? 'Replay' : v ? 'Pause' : 'Play'; }
  seek(i) {
    this.idx = Math.max(0, Math.min(this.n, i));
    if (this.idx >= this.n) this.finish(performance.now());
    else { this.done = false; this.plate.setRoute(null); this.plate.amb = -1; this.plate.routeProg = 0; }
    this.setPlaying(false); this.plate.search.count = Math.floor(this.idx); this.sync();
  }
  finish(now) {
    this.done = true; this.tDone = now; this.idx = this.n;
    this.plate.setRoute(this.path || null); this.plate.routeProg = 0;
    this.setPlaying(false);
  }

  /* edges examined (y) against junctions visited (x); the cursor rides along it */
  drawCurve() {
    const svg = this.el.curve, res = this.res, n = this.n, W = 260, H = 110, m = { l: 6, r: 6, t: 8, b: 8 };
    const total = Math.max(1, res.relaxed), step = Math.max(1, Math.floor(n / 140));
    let d = `M${m.l} ${H - m.b}`;
    for (let i = 0; i < n; i += step) d += ` L${(m.l + (i + 1) / n * (W - m.l - m.r)).toFixed(1)} ${(H - m.b - res.work[i] / total * (H - m.t - m.b)).toFixed(1)}`;
    d += ` L${W - m.r} ${(H - m.b - (n ? res.work[n - 1] : 0) / total * (H - m.t - m.b)).toFixed(1)} L${W - m.r} ${m.t}`;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.innerHTML = `<line class="ax" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/><line class="ax" x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${H - m.b}"/>` +
      `<path class="trace" d="${d}"/><line class="cursor" id="thCurL" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}"/><circle class="cursor-dot" id="thCurD" r="4.5" cx="0" cy="0"/>`;
    this.curveGeom = { W, H, m, total };
  }

  sync() {
    const { g, el, res } = this, c = Math.floor(this.idx), n = this.n;
    const work = this.done ? res.relaxed : c ? res.work[c - 1] : 0;
    el.visited.textContent = `${c.toLocaleString()} of ${g.n.toLocaleString()}`;
    el.work.textContent = Math.round(work).toLocaleString();
    el.share.textContent = (c / g.n * 100).toFixed(0) + '%';
    el.step.textContent = this.done ? 'finished' : `step ${c.toLocaleString()} / ${n.toLocaleString()}`;
    if (document.activeElement !== el.scrub) el.scrub.value = n ? Math.round(this.idx / n * 1000) : 0;
    const cg = this.curveGeom;
    if (cg) {
      const x = cg.m.l + (n ? this.idx / n : 0) * (cg.W - cg.m.l - cg.m.r), y = cg.H - cg.m.b - work / cg.total * (cg.H - cg.m.t - cg.m.b);
      const L = el.curve.querySelector('#thCurL'), D = el.curve.querySelector('#thCurD');
      if (L) { L.setAttribute('x1', x); L.setAttribute('x2', x); } if (D) { D.setAttribute('cx', x); D.setAttribute('cy', y); }
    }
    if (!this.done) { el.eta.textContent = 'searching…'; el.verdict.textContent = ''; return; }
    if (!res.found && !this.path) { el.eta.textContent = 'no route'; el.verdict.textContent = 'The destination cannot be reached with the roads that are open.'; return; }
    const cost = this.id === 'fixed' ? res.cost : res.cost, opt = this.o.opt;
    el.eta.textContent = cost.toFixed(1) + ' min';
    const gap = opt ? cost / opt - 1 : 0;
    el.verdict.textContent = gap > 1e-6
      ? `${this.label} stopped at a route ${(gap * 100).toFixed(0)}% slower than the best one. Fast to compute, wrong to drive.`
      : `${this.label} found the fastest route after examining ${Math.round(res.relaxed).toLocaleString()} road segments and visiting ${(n / g.n * 100).toFixed(0)}% of the city.`;
  }

  tick(now) {
    if (!this.isOpen || !this.plate) return;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0; this.last = now;
    if (this.playing && !this.done) {
      this.idx = Math.min(this.n, this.idx + Math.max(16, this.n / 7) * this.speed * dt);
      if (this.idx >= this.n) this.finish(now);
    }
    const c = Math.floor(this.idx);
    if (c !== this.plate.search.count || this.done !== this.shownDone) { this.plate.search.count = c; this.shownDone = this.done; this.sync(); }
    if (this.done) {
      const e = now - this.tDone;
      this.plate.routeProg = Math.min(1, e / 900);
      if (e > 900 && this.path) this.plate.amb = ((e - 900) / 6500) % 1;
    }
    this.plate.draw(now);
  }
}
