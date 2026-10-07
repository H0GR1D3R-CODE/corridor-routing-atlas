'use strict';
/* ==========================================================================
   CORRIDOR · hero.js
   --------------------------------------------------------------------------
   The live board in the masthead. A wide strip of the city on which a small
   fleet of ambulances is always at work: an incident appears at a random
   junction, one multi-target Dijkstra finds the fastest hospital under the
   current traffic, and an ambulance drives that route. Nothing is scripted;
   every route is solved by the same engine the console uses.
   ========================================================================== */

class HeroBoard {
  constructor(canvas, g) {
    this.g = g; this.cv = canvas; this.units = []; this.started = 0;
    this.mask = new Uint8Array(g.n); g.hospitals.forEach(h => { this.mask[h.node] = 1; });
    /* a strip across the city, centred a little south-east of Majestic where the hospitals cluster */
    this.plate = new Plate(canvas, g, { bare: true, fit: (w, h) => { const s = Math.max(w / 50, h / 22); return { s, ox: w / 2 - 2.5 * s, oy: h / 2 - 1.5 * s }; } });
    this.plate.onResize = () => this.reset();
    this.reset();
  }
  resize() { this.plate.resize(); this.reset(); }
  reset() {
    const want = this.plate.w > 900 ? 6 : this.plate.w > 560 ? 4 : 3;
    /* keep incidents, hospitals and flags out from under the caption */
    const cap = this.cv.parentElement.querySelector('figcaption'), cr = this.cv.getBoundingClientRect(), fr = cap ? cap.getBoundingClientRect() : null;
    this.cap = fr ? [fr.left - cr.left - 4, fr.top - cr.top - 4, fr.right - cr.left + 10, fr.bottom - cr.top + 10] : [0, 0, 0, 0];
    this.units = Array.from({ length: want }, (_, i) => ({ id: i, path: null, wake: i * 650 }));
    this.started = 0;
  }
  setTheme(T) { this.plate.theme = T; this.plate.dirty = true; }
  sx(v) { return this.plate.cam.ox + this.g.x[v] * this.plate.cam.s; }
  sy(v) { return this.plate.cam.oy + this.g.y[v] * this.plate.cam.s; }

  /* a new incident for unit u: pick a junction on the sheet, solve it, keep the route if it stays in view */
  spawn(u, now) {
    const g = this.g, W = this.plate.w, H = this.plate.h;
    u.path = null; u.wake = now + 500;
    for (let tries = 0; tries < 40; tries++) {
      const v = (Math.random() * g.n) | 0, x = this.sx(v), y = this.sy(v);
      if (this.mask[v] || x < 46 || x > W - 46 || y < 30 || y > H - 24 || this.under(x, y)) continue;
      if (this.units.some(o => o !== u && o.path && Math.hypot(this.sx(o.path[0]) - x, this.sy(o.path[0]) - y) < 110)) continue;
      const r = nearestTargets(g, v, this.mask, 1, { light: true });
      if (!r.hits.length) continue;
      const path = r.pathTo(r.hits[0].node);
      if (!path || path.length < 4) continue;
      if (this.under(this.sx(path[path.length - 1]), this.sy(path[path.length - 1]))) continue;
      if (tries < 30 && path.some(n => this.sx(n) < 10 || this.sx(n) > W - 10 || this.sy(n) < 10 || this.sy(n) > H - 10)) continue;
      const cum = [0];
      for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(g.x[path[i]] - g.x[path[i - 1]], g.y[path[i]] - g.y[path[i - 1]]));
      const hosp = g.hospitals.find(h => h.node === path[path.length - 1]);
      Object.assign(u, { path, cum, total: cum[cum.length - 1] || 1, eta: r.hits[0].cost, hosp: hosp ? hosp.name : '', t0: now, dir: 1, done: 0,
        dur: Math.min(14000, Math.max(5200, cum[cum.length - 1] * 850)) });
      return;
    }
  }
  under(x, y) { const c = this.cap; return x > c[0] && x < c[2] && y > c[1] && y < c[3]; }
  pos(u, f) {
    const g = this.g, c = this.plate.cam, d = Math.min(1, Math.max(0, f)) * u.total;
    let i = 1; while (i < u.cum.length - 1 && u.cum[i] < d) i++;
    const a = u.path[i - 1], b = u.path[i], t = Math.min(1, Math.max(0, (d - u.cum[i - 1]) / ((u.cum[i] - u.cum[i - 1]) || 1)));
    return [c.ox + (g.x[a] + (g.x[b] - g.x[a]) * t) * c.s, c.oy + (g.y[a] + (g.y[b] - g.y[a]) * t) * c.s, i];
  }
  /* the junction where the nearest ambulance's incident is, for "open this dispatch in the console" */
  pick(px, py) {
    let best = null, bd = Infinity;
    for (const u of this.units) {
      if (!u.path) continue;
      const p = u.at || [this.sx(u.path[0]), this.sy(u.path[0])], d = Math.hypot(p[0] - px, p[1] - py);
      if (d < bd) { bd = d; best = u; }
    }
    return best ? best.path[0] : -1;
  }

  draw(now) {
    const { plate, g } = this, T = plate.theme, ctx = plate.ctx;
    if (!this.started) { this.started = now; for (const u of this.units) u.wake += now; }   // stagger the first call-outs
    plate.draw(now);
    const tags = [];
    for (const u of this.units) {
      if (!u.path) { if (now >= u.wake) this.spawn(u, now); continue; }
      const e = now - u.t0, f = Math.min(1, e / u.dur);
      if (f >= 1 && !u.done) u.done = now;
      if (u.done && now - u.done > 1100) { this.spawn(u, now); continue; }
      const alpha = Math.min(1, e / 450) * (u.done ? Math.max(0, 1 - (now - u.done) / 1100) : 1);
      const [x, y, seg] = this.pos(u, f), nx = this.pos(u, Math.min(1, f + 0.015))[0];
      if (Math.abs(nx - x) > 0.05) u.dir = nx < x ? -1 : 1;
      u.at = [x, y];
      ctx.save(); ctx.globalAlpha = alpha; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      /* the road still ahead: ink on a paper casing */
      const ahead = () => { ctx.beginPath(); ctx.moveTo(x, y); for (let i = seg; i < u.path.length; i++) ctx.lineTo(this.sx(u.path[i]), this.sy(u.path[i])); };
      ahead(); ctx.strokeStyle = T.paper; ctx.lineWidth = 7; ctx.stroke();
      ahead(); ctx.strokeStyle = T.ink; ctx.lineWidth = 3; ctx.stroke();
      /* the road already driven: a dotted trail */
      ctx.beginPath(); ctx.moveTo(this.sx(u.path[0]), this.sy(u.path[0])); for (let i = 1; i < seg; i++) ctx.lineTo(this.sx(u.path[i]), this.sy(u.path[i])); ctx.lineTo(x, y);
      ctx.strokeStyle = T.ink2; ctx.lineWidth = 1.6; ctx.setLineDash([1, 5]); ctx.stroke(); ctx.setLineDash([]);
      /* the incident */
      const ix = this.sx(u.path[0]), iy = this.sy(u.path[0]), ph = (now / 1100 + u.id * 0.17) % 1;
      ctx.strokeStyle = T.red; ctx.lineWidth = 1.5; ctx.globalAlpha = alpha * (0.7 - 0.7 * ph); ctx.beginPath(); ctx.arc(ix, iy, 5 + ph * 15, 0, TAU); ctx.stroke();
      ctx.globalAlpha = alpha; ctx.fillStyle = T.paper; ctx.strokeStyle = T.ink; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(ix, iy, 5, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = T.red; ctx.beginPath(); ctx.arc(ix, iy, 2, 0, TAU); ctx.fill();
      /* the hospital it is heading for */
      const hx = this.sx(u.path[u.path.length - 1]), hy = this.sy(u.path[u.path.length - 1]);
      ctx.strokeStyle = T.red; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(hx, hy, 12 + Math.sin(now / 240 + u.id) * 1.4, 0, TAU); ctx.stroke();
      const w = plate.w > 700 ? 30 : 24;
      drawAmbulance(ctx, x, y - w * 0.27 + Math.sin(now / 120 + u.id) * 0.5, w, u.dir, T, now, !u.done);
      ctx.restore();
      if (!u.done) tags.push({ x, y: y - w * 0.27 - w * 0.62, text: `${u.hosp.toUpperCase()}  ${Math.max(1, Math.round(u.eta * (1 - f)))} MIN`, alpha });
    }
    /* a small flag above each ambulance: where it is going and how long is left */
    ctx.font = `600 9.5px ${MONO}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const boxes = [this.cap];
    for (const t of tags) {
      const tw = ctx.measureText(t.text).width + 12; let bx = Math.max(6, Math.min(plate.w - tw - 6, t.x - tw / 2)); const by = Math.max(22, t.y - 16);
      const box = [bx, by, bx + tw, by + 16];
      if (boxes.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      boxes.push(box);
      ctx.globalAlpha = t.alpha; ctx.fillStyle = T.ink; ctx.fillRect(bx, by, tw, 16);
      ctx.fillStyle = T.paper; ctx.fillText(t.text, bx + 6, by + 11.5);
    }
    ctx.globalAlpha = 1;
  }
}
