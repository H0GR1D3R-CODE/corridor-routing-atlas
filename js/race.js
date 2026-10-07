'use strict';
/* ==========================================================================
   CORRIDOR · race.js
   --------------------------------------------------------------------------
   Five miniature plates run the SAME query.  The shared clock counts edge
   relaxations (units of real work), not seconds, so the algorithm that does
   less work finishes first, regardless of how the JavaScript engine feels.
   ========================================================================== */

class Race {
  constructor(g, host, hooks) {
    this.g = g; this.host = host; this.hooks = hooks || {};
    this.racers = []; this.clock = 0; this.running = false; this.s = -1; this.t = -1;
    host.innerHTML = '';
    for (const id of ALGO_ORDER) {
      const fig = document.createElement('figure'); fig.className = 'racer'; fig.dataset.algo = id;
      fig.innerHTML = `
        <div class="r-head"><span class="r-name"><i class="sw" style="background:var(--c-${id})"></i>${ALGOS[id].label}</span><span class="r-badge"></span></div>
        <canvas></canvas>
        <div class="r-bar"><b></b></div>
        <dl class="r-stats"><div><dt>work</dt><dd class="w">–</dd></div><div><dt>ETA min</dt><dd class="c">–</dd></div><div><dt>time</dt><dd class="m">–</dd></div></dl>
        <figcaption>${ALGOS[id].blurb}</figcaption>`;
      host.appendChild(fig);
      const plate = new Plate(fig.querySelector('canvas'), g, { mini: true });
      this.racers.push({ id, fig, plate, res: null, bar: fig.querySelector('.r-bar b'), badge: fig.querySelector('.r-badge'), w: fig.querySelector('.w'), c: fig.querySelector('.c'), m: fig.querySelector('.m') });
    }
  }
  setTheme(T) { for (const r of this.racers) { r.plate.theme = T; r.plate.dirty = true; } }
  resize() { for (const r of this.racers) r.plate.resize(); }

  prepare(s, t) {
    this.s = s; this.t = t; this.clock = 0; this.running = false; this.done = false;
    const g = this.g;
    for (const r of this.racers) {
      r.res = ALGOS[r.id].fn(g, s, t, {});
      r.shown = 0; r.finished = false; r.tFin = 0;
      r.plate.marks = [{ node: s, kind: 'A' }, { node: t, kind: 'B' }];
      r.plate.search = { order: r.res.order, orderParent: r.res.orderParent, side: r.res.side, count: 0 };
      r.plate.setRoute(null); r.plate.routeProg = 1; r.plate.amb = -1;
      r.fig.classList.remove('done', 'wrong', 'first');
      r.badge.textContent = 'ready'; r.badge.className = 'r-badge';
      r.bar.style.width = '0%';
      r.w.textContent = '0'; r.c.textContent = '–'; r.m.textContent = '–';
      r.plate.dirty = true;
    }
    const opt = Math.min(...this.racers.filter(r => ALGOS[r.id].optimal).map(r => r.res.cost));
    this.opt = opt;
    /* podium = fewest edge relaxations among everyone who found the optimum */
    this.racers.filter(r => r.res.found && r.res.cost <= opt + 1e-6)
      .sort((a, b) => a.res.relaxed - b.res.relaxed).forEach((r, i) => { r.rank = i + 1; });
    /* the clock runs at a pace where Dijkstra takes ~3.2 s of wall time */
    const dj = this.racers[0].res.relaxed || 1;
    this.rate = dj / 3.2;                     // relaxations per second
    this.hooks.onPrepare && this.hooks.onPrepare(s, t);
  }
  start() { if (this.s < 0) return; this.running = true; this.last = performance.now(); }
  skip() { this.clock = Infinity; this.running = true; this.last = performance.now(); }

  tick(now) {
    /* once a racer has its answer, an ambulance drives it */
    for (const r of this.racers) if (r.finished && r.res && r.res.path) { if (!r.tFin) r.tFin = now; r.plate.amb = ((now - r.tFin) / 5600) % 1; r.plate.dirty = true; }
    if (!this.running) return false;
    const dt = Math.min(0.25, (now - this.last) / 1000); this.last = now;
    this.clock = this.clock === Infinity ? Infinity : this.clock + this.rate * dt;
    let allDone = true;
    for (const r of this.racers) {
      const res = r.res;
      if (r.finished) continue;
      /* reveal every visit whose cumulative work is <= clock */
      const wk = res.work, n = wk.length;
      let c = r.shown; while (c < n && wk[c] <= this.clock) c++;
      if (c !== r.shown) { r.shown = c; r.plate.search.count = c; r.plate.dirty = true; }
      const prog = this.clock === Infinity ? 1 : Math.min(1, this.clock / Math.max(1, res.relaxed));
      r.bar.style.width = (prog * 100).toFixed(1) + '%';
      r.w.textContent = Math.round(Math.min(this.clock, res.relaxed)).toLocaleString();
      if (this.clock >= res.relaxed) {
        r.finished = true; r.shown = n; r.plate.search.count = n;
        r.plate.setRoute(res.path); r.plate.routeProg = 1; r.plate.dirty = true;
        r.w.textContent = Math.round(res.relaxed).toLocaleString();
        const gap = res.found ? res.cost / this.opt - 1 : 0;
        r.c.textContent = res.found ? res.cost.toFixed(1) : '—';
        r.m.textContent = res.ms < 0.05 ? '<0.1 ms' : res.ms.toFixed(2) + ' ms';
        r.fig.classList.add('done');
        if (res.found && gap > 1e-6) { r.fig.classList.add('wrong'); r.badge.textContent = `+${(gap * 100).toFixed(0)}% slower · not optimal`; r.badge.className = 'r-badge bad'; }
        else { r.badge.textContent = ['1st', '2nd', '3rd', '4th', '5th'][r.rank - 1] + ' · optimal'; r.badge.className = 'r-badge ok'; if (r.rank === 1) r.fig.classList.add('first'); }
      } else allDone = false;
    }
    if (allDone && !this.done) { this.done = true; this.running = false; this.hooks.onDone && this.hooks.onDone(this); }
    return true;
  }
  draw(now) { for (const r of this.racers) if (r.plate.dirty || this.running) r.plate.draw(now); }
}
