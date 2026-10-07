'use strict';
/* ==========================================================================
   CORRIDOR · plate.js
   --------------------------------------------------------------------------
   Canvas renderer.  A "plate" is one printed map: graticule, water, roads
   inked by congestion, the search tree as it spreads, the route as a transit
   ribbon, hospitals and landmarks.  Used full-size for the console and as
   five miniatures for the race.
   ========================================================================== */

const TAU = Math.PI * 2;
const THEMES = {
  day: {
    paper: '#ece4d2', ink: '#1c1a16', ink2: '#4b463b', ink3: '#8c8472',
    red: '#d2401c', teal: '#14566a', brown: '#98591a', water: '#b9cfcc', park: '#cbd3ad',
    ramp: ['#9d9684', '#a99a58', '#c28a1b', '#cf6a1c', '#d2401c', '#8e1c12'],
  },
  night: {
    paper: '#12161a', ink: '#ece4d2', ink2: '#b9b2a2', ink3: '#6c685e',
    red: '#ff6a42', teal: '#5cc0d6', brown: '#e3a65c', water: '#1b3640', park: '#243420',
    ramp: ['#5b584f', '#8a7d49', '#c9972e', '#e0752a', '#ff5a30', '#ff2d6a'],
  },
};
const MONO = '"IBM Plex Mono", Consolas, "Courier New", monospace';
const SERIF = 'Fraunces, Georgia, "Times New Roman", serif';

/* A side-view ambulance pictogram, facing right (dir = 1) or left (dir = -1), centred on (x, y).
   It wears a paper halo so it reads on any road colour, and its roof light alternates red and teal. */
function drawAmbulance(ctx, x, y, w, dir, T, now, glow = true) {
  const h = w * 0.6, u = w / 28;
  ctx.save(); ctx.translate(x, y); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.setLineDash([]);
  if (glow) {                                        // the siren, as two expanding rings
    for (const off of [0, 0.5]) {
      const ph = ((now / 900) + off) % 1;
      ctx.strokeStyle = T.red; ctx.globalAlpha = 0.5 * (1 - ph); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(0, -h * 0.1, w * 0.5 + ph * w * 0.75, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.scale(dir, 1);
  const body = () => {
    ctx.beginPath(); ctx.moveTo(-w / 2, h * 0.26); ctx.lineTo(-w / 2, -h * 0.34); ctx.quadraticCurveTo(-w / 2, -h * 0.42, -w * 0.46, -h * 0.42);
    ctx.lineTo(w * 0.12, -h * 0.42); ctx.lineTo(w * 0.30, -h * 0.07); ctx.lineTo(w * 0.46, -h * 0.02); ctx.quadraticCurveTo(w / 2, 0, w / 2, h * 0.09);
    ctx.lineTo(w / 2, h * 0.26); ctx.closePath();
  };
  body(); ctx.strokeStyle = T.paper; ctx.lineWidth = 5.5 * u; ctx.stroke();
  body(); ctx.fillStyle = T.paper; ctx.fill(); ctx.strokeStyle = T.ink; ctx.lineWidth = 1.7 * u; ctx.stroke();
  ctx.fillStyle = T.red; ctx.fillRect(-w / 2 + 1.3 * u, h * 0.09, w - 2.6 * u, h * 0.09);                    // waist stripe
  ctx.fillStyle = T.ink; ctx.beginPath(); ctx.moveTo(w * 0.15, -h * 0.32); ctx.lineTo(w * 0.275, -h * 0.08); ctx.lineTo(w * 0.15, -h * 0.08); ctx.closePath(); ctx.fill();   // windscreen
  const cx = -w * 0.2, cy = -h * 0.16, a = w * 0.085, t = w * 0.045;                                           // the cross
  ctx.fillStyle = T.red; ctx.fillRect(cx - a, cy - t / 2, a * 2, t); ctx.fillRect(cx - t / 2, cy - a, t, a * 2);
  for (const wx of [-w * 0.28, w * 0.29]) {                                                                   // wheels
    ctx.fillStyle = T.ink; ctx.beginPath(); ctx.arc(wx, h * 0.27, w * 0.105, 0, TAU); ctx.fill();
    ctx.fillStyle = T.paper; ctx.beginPath(); ctx.arc(wx, h * 0.27, w * 0.04, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = Math.floor(now / 170) % 2 ? T.red : T.teal;                                                 // roof light
  ctx.fillRect(-w * 0.1, -h * 0.42 - h * 0.13, w * 0.13, h * 0.12);
  ctx.strokeStyle = T.ink; ctx.lineWidth = 1 * u; ctx.strokeRect(-w * 0.1, -h * 0.42 - h * 0.13, w * 0.13, h * 0.12);
  ctx.restore();
}

class Plate {
  constructor(canvas, g, o = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.g = g;
    this.mini = !!o.mini; this.bare = !!o.bare; this.customFit = o.fit || null; this.theme = THEMES.day; this.ambDir = 1;
    this.search = null;       // { order, orderParent, side, count }
    this.route = null;        // { path, cum, total }
    this.routeProg = 1;       // 0..1 how much of the ribbon is inked
    this.amb = -1;            // 0..1 ambulance position along route (-1: hidden)
    this.marks = [];          // [{ node, kind: 'A'|'B'|'X' }]
    this.ranked = [];         // hospital nodes to ring (hospital mode)
    this.hoverEdge = -1; this.hoverNode = -1;
    this.lv = new Uint8Array(g.m);
    this.dirty = true;
    this.resize();
  }
  resize() {
    const r = this.cv.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(10, r.width); this.h = Math.max(10, r.height);
    this.cv.width = Math.round(this.w * this.dpr); this.cv.height = Math.round(this.h * this.dpr);
    this.fit(); this.dirty = true;
  }
  fit() {
    if (this.customFit) { this.cam = this.customFit(this.w, this.h); this.baseS = this.cam.s; this.fly = null; this.dirty = true; return; }
    const R = this.g.R + 1.3;
    const s = Math.min(this.w, this.h) / 2 / R * (this.mini ? 1 : 0.97);
    this.cam = { s, ox: this.w / 2, oy: this.h / 2 }; this.baseS = s; this.fly = null; this.dirty = true;
  }
  /* Glide the camera so a set of junctions fills the sheet (never tighter than minKm across). */
  frame(nodes, minKm = 9, pad = 1.32) {
    const g = this.g; let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const v of nodes) { x0 = Math.min(x0, g.x[v]); x1 = Math.max(x1, g.x[v]); y0 = Math.min(y0, g.y[v]); y1 = Math.max(y1, g.y[v]); }
    if (x0 === Infinity) return;
    const halfW = Math.max(minKm, (x1 - x0) / 2 * pad + 1.5), halfH = Math.max(minKm, (y1 - y0) / 2 * pad + 1.5);
    let s = Math.min(this.w / 2 / halfW, this.h / 2 / halfH);
    s = Math.min(this.baseS * 10, Math.max(this.baseS, s));
    let cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (s <= this.baseS * 1.04) { s = this.baseS; cx = 0; cy = 0; }        // close to the whole city: just show all of it
    this.fly = { from: { ...this.cam }, to: { s, ox: this.w / 2 - cx * s, oy: this.h / 2 - cy * s }, t0: -1 };
    this.dirty = true;
  }
  world(px, py) { return [(px - this.cam.ox) / this.cam.s, (py - this.cam.oy) / this.cam.s]; }
  zoomAt(px, py, f) {
    const [wx, wy] = this.world(px, py), c = this.cam;
    c.s = Math.min(this.baseS * 10, Math.max(this.baseS * 0.9, c.s * f));
    c.ox = px - wx * c.s; c.oy = py - wy * c.s; this.fly = null; this.dirty = true;
  }
  pan(dx, dy) { this.cam.ox += dx; this.cam.oy += dy; this.fly = null; this.dirty = true; }
  setRoute(path) {
    if (!path) { this.route = null; return; }
    const cum = [0]; const g = this.g;
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(g.x[path[i]] - g.x[path[i - 1]], g.y[path[i]] - g.y[path[i - 1]]));
    this.route = { path, cum, total: cum[cum.length - 1] || 1 };
  }
  posAt(f) {
    const r = this.route, g = this.g; if (!r) return null;
    const d = Math.min(1, Math.max(0, f)) * r.total;
    let i = 1; while (i < r.cum.length - 1 && r.cum[i] < d) i++;
    const a = r.path[i - 1], b = r.path[i] ?? a, seg = (r.cum[i] - r.cum[i - 1]) || 1, t = Math.min(1, Math.max(0, (d - r.cum[i - 1]) / seg));
    return [g.x[a] + (g.x[b] - g.x[a]) * t, g.y[a] + (g.y[b] - g.y[a]) * t];
  }
  pickNode(px, py, maxKm = 2.2) {
    const [wx, wy] = this.world(px, py), r = this.g.nearestNode(wx, wy);
    return r.d <= maxKm ? r.node : -1;
  }

  draw(now = 0) {
    /* if layout resized the canvas (window, zoom, orientation), re-measure before drawing */
    const cw = this.cv.clientWidth, ch = this.cv.clientHeight;
    if (cw > 0 && ch > 0 && (Math.abs(cw - this.w) > 1 || Math.abs(ch - this.h) > 1)) { this.resize(); if (this.onResize) this.onResize(); }
    if (this.fly) {                                   // ease the camera toward its target
      const f = this.fly; if (f.t0 < 0) f.t0 = now;
      const t = Math.min(1, (now - f.t0) / 750), k = 1 - (1 - t) ** 3;
      this.cam.s = f.from.s + (f.to.s - f.from.s) * k; this.cam.ox = f.from.ox + (f.to.ox - f.from.ox) * k; this.cam.oy = f.from.oy + (f.to.oy - f.from.oy) * k;
      if (t >= 1) this.fly = null;
    }
    const { ctx, g, theme: T, cam, mini } = this;
    const X = x => cam.ox + x * cam.s, Y = y => cam.oy + y * cam.s;
    const z = Math.min(2.2, Math.max(0.85, cam.s / this.baseS));
    const fs = Math.max(0.74, Math.min(1, this.w / 720));          // label scale on small screens
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = T.paper; ctx.fillRect(0, 0, this.w, this.h);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    /* graticule: concentric 5 km rings + 8 bearings, like a survey sheet */
    if (!mini) {
      ctx.strokeStyle = T.ink3; ctx.lineWidth = 0.6; ctx.globalAlpha = 0.4; ctx.setLineDash([2, 5]);
      for (let k = 5; k <= g.R + 1; k += 5) { ctx.beginPath(); ctx.arc(cam.ox, cam.oy, k * cam.s, 0, TAU); ctx.stroke(); }
      ctx.setLineDash([]); ctx.globalAlpha = 0.18;
      for (let b = 0; b < 8; b++) {
        const a = b * Math.PI / 4;
        ctx.beginPath(); ctx.moveTo(cam.ox, cam.oy); ctx.lineTo(cam.ox + Math.sin(a) * (g.R + 1) * cam.s, cam.oy - Math.cos(a) * (g.R + 1) * cam.s); ctx.stroke();
      }
      ctx.globalAlpha = 1; ctx.fillStyle = T.ink3; ctx.font = `9px ${MONO}`; ctx.textAlign = 'left';
      if (!this.bare) for (let k = 5; k <= g.R; k += 5) ctx.fillText(k + ' km', cam.ox + 5, cam.oy - k * cam.s - 3);
    }

    /* water & parks */
    for (const w of g.water) {
      ctx.beginPath();
      w.poly.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])));
      ctx.closePath();
      ctx.fillStyle = w.kind === 'park' ? T.park : T.water; ctx.fill();
      ctx.strokeStyle = T.ink3; ctx.lineWidth = 0.7; ctx.stroke();
    }

    /* roads, bucketed by class × congestion so we stroke 18 paths, not 1 000 */
    const wd = mini ? [0.55, 0.9, 1.2] : [1.0 * z, 1.7 * z, 2.3 * z];
    if (mini) {
      ctx.strokeStyle = T.ink3; ctx.globalAlpha = 0.55;
      for (let cls = 0; cls < 3; cls++) {
        ctx.lineWidth = wd[cls]; ctx.beginPath();
        for (let e = 0; e < g.m; e++) if (g.cls[e] === cls && !g.blocked[e]) { ctx.moveTo(X(g.x[g.eu[e]]), Y(g.y[g.eu[e]])); ctx.lineTo(X(g.x[g.ev[e]]), Y(g.y[g.ev[e]])); }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else {
      const lv = this.lv;
      for (let e = 0; e < g.m; e++) { const c = g.cong[e]; lv[e] = c < 1.15 ? 0 : c < 1.6 ? 1 : c < 2.2 ? 2 : c < 3 ? 3 : c < 4.2 ? 4 : 5; }
      for (let cls = 0; cls < 3; cls++) for (let l = 0; l < 6; l++) {
        ctx.beginPath(); let any = false;
        for (let e = 0; e < g.m; e++) if (g.cls[e] === cls && lv[e] === l && !g.blocked[e]) {
          ctx.moveTo(X(g.x[g.eu[e]]), Y(g.y[g.eu[e]])); ctx.lineTo(X(g.x[g.ev[e]]), Y(g.y[g.ev[e]])); any = true;
        }
        if (any) { ctx.strokeStyle = T.ramp[l]; ctx.lineWidth = wd[cls] + (l >= 3 ? 0.5 : 0); ctx.stroke(); }
      }
    }
    /* closures: dashed red with a cross */
    ctx.strokeStyle = T.red; ctx.lineWidth = mini ? 1 : 1.6; ctx.setLineDash([3, 3]);
    ctx.beginPath(); let anyB = false;
    for (let e = 0; e < g.m; e++) if (g.blocked[e]) { ctx.moveTo(X(g.x[g.eu[e]]), Y(g.y[g.eu[e]])); ctx.lineTo(X(g.x[g.ev[e]]), Y(g.y[g.ev[e]])); anyB = true; }
    if (anyB) ctx.stroke(); ctx.setLineDash([]);
    if (!mini) {
      ctx.lineWidth = 1.6; ctx.beginPath();
      for (let e = 0; e < g.m; e++) if (g.blocked[e]) { const cx = X(g.mx[e]), cy = Y(g.my[e]); ctx.moveTo(cx - 3.5, cy - 3.5); ctx.lineTo(cx + 3.5, cy + 3.5); ctx.moveTo(cx - 3.5, cy + 3.5); ctx.lineTo(cx + 3.5, cy - 3.5); }
      ctx.stroke();
    }
    if (this.hoverEdge >= 0 && !mini) {
      const e = this.hoverEdge;
      ctx.strokeStyle = T.ink; ctx.lineWidth = 4 * z; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.moveTo(X(g.x[g.eu[e]]), Y(g.y[g.eu[e]])); ctx.lineTo(X(g.x[g.ev[e]]), Y(g.y[g.ev[e]])); ctx.stroke(); ctx.globalAlpha = 1;
    }

    /* the search tree: ink spreading from the source */
    const sr = this.search;
    if (sr && sr.count > 0) {
      for (let side = 0; side < 2; side++) {
        ctx.strokeStyle = side ? T.brown : T.teal; ctx.lineWidth = (mini ? 1.1 : 1.5) * (mini ? 1 : z); ctx.globalAlpha = 0.8;
        ctx.beginPath(); let any = false;
        for (let i = 0; i < sr.count; i++) {
          if (sr.side[i] !== side) continue;
          const u = sr.order[i], p = sr.orderParent[i];
          if (p >= 0) { ctx.moveTo(X(g.x[p]), Y(g.y[p])); ctx.lineTo(X(g.x[u]), Y(g.y[u])); any = true; }
        }
        if (any) ctx.stroke();
        ctx.fillStyle = side ? T.brown : T.teal; ctx.globalAlpha = 0.9;
        const rr = mini ? 1.3 : 1.9 * Math.sqrt(z);
        ctx.beginPath();
        for (let i = 0; i < sr.count; i++) if (sr.side[i] === side) { const x = X(g.x[sr.order[i]]), y = Y(g.y[sr.order[i]]); ctx.moveTo(x + rr, y); ctx.arc(x, y, rr, 0, TAU); }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      /* wavefront: the freshest visits glow in red */
      ctx.fillStyle = T.red;
      for (let i = Math.max(0, sr.count - 5); i < sr.count; i++) {
        ctx.beginPath(); ctx.arc(X(g.x[sr.order[i]]), Y(g.y[sr.order[i]]), mini ? 2 : 3, 0, TAU); ctx.fill();
      }
    }

    /* route ribbon */
    const rt = this.route;
    if (rt && this.routeProg > 0) {
      const lim = rt.total * Math.min(1, this.routeProg);
      const trace = () => {
        ctx.beginPath(); ctx.moveTo(X(g.x[rt.path[0]]), Y(g.y[rt.path[0]]));
        for (let i = 1; i < rt.path.length; i++) {
          if (rt.cum[i] <= lim) ctx.lineTo(X(g.x[rt.path[i]]), Y(g.y[rt.path[i]]));
          else { const f = (lim - rt.cum[i - 1]) / ((rt.cum[i] - rt.cum[i - 1]) || 1), a = rt.path[i - 1], b = rt.path[i]; ctx.lineTo(X(g.x[a] + (g.x[b] - g.x[a]) * f), Y(g.y[a] + (g.y[b] - g.y[a]) * f)); break; }
        }
      };
      /* ink on a paper casing: the one colour the traffic ramp never uses, so the route always reads */
      trace(); ctx.strokeStyle = T.paper; ctx.lineWidth = (mini ? 5.5 : 10) * (mini ? 1 : Math.sqrt(z)); ctx.stroke();
      trace(); ctx.strokeStyle = T.ink; ctx.lineWidth = (mini ? 2.8 : 5.5) * (mini ? 1 : Math.sqrt(z)); ctx.stroke();
      if (!mini) { trace(); ctx.strokeStyle = T.paper; ctx.lineWidth = 1.3; ctx.setLineDash([1, 8]); ctx.lineDashOffset = -now / 55; ctx.stroke(); ctx.setLineDash([]); }
    }

    /* hospitals, places and their labels.
       Labels are placed greedily by priority and skipped if they would collide with a
       marker, an icon or a label already on the sheet, so the map never overprints itself. */
    if (!mini) {
      const zoom = cam.s / this.baseS, hs = 6 * Math.max(0.85, fs);
      const boxes = [];
      const hit = a => { for (const b of boxes) if (a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]) return true; return false; };
      const focus = new Set(this.marks.map(m => m.node)); if (this.hoverNode >= 0) focus.add(this.hoverNode);
      for (const m of this.marks) { const x = X(g.x[m.node]), y = Y(g.y[m.node]); boxes.push([x - 13, y - 13, x + 13, y + 13]); }

      for (const h of g.hospitals) {
        const x = X(g.x[h.node]), y = Y(g.y[h.node]), ranked = this.ranked.indexOf(h.node);
        if (ranked >= 0) { ctx.strokeStyle = T.red; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, hs + 5 + (ranked === 0 ? Math.sin(now / 260) * 1.5 : 0), 0, TAU); ctx.stroke(); }
        ctx.fillStyle = T.paper; ctx.strokeStyle = T.red; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.rect(x - hs, y - hs, hs * 2, hs * 2); ctx.fill(); ctx.stroke();
        ctx.lineWidth = 2.1; ctx.beginPath(); ctx.moveTo(x - hs / 2, y); ctx.lineTo(x + hs / 2, y); ctx.moveTo(x, y - hs / 2); ctx.lineTo(x, y + hs / 2); ctx.stroke();
        boxes.push([x - hs - 1, y - hs - 1, x + hs + 1, y + hs + 1]);
      }
      for (const L of g.landmarks) {
        const x = X(g.x[L.node]), y = Y(g.y[L.node]), big = L.tier === 1;
        ctx.fillStyle = T.paper; ctx.beginPath(); ctx.arc(x, y, big ? 3.6 : 2.8, 0, TAU); ctx.fill();
        ctx.fillStyle = big ? T.ink : T.ink2; ctx.beginPath(); ctx.arc(x, y, big ? 2.3 : 1.5, 0, TAU); ctx.fill();
      }
      if (this.hoverNode >= 0) { ctx.strokeStyle = T.ink; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(X(g.x[this.hoverNode]), Y(g.y[this.hoverNode]), 9, 0, TAU); ctx.stroke(); }

      const label = (text, x, y, font, px, color, tries, force) => {
        ctx.font = font; const w = ctx.measureText(text).width;
        for (const [dx, dy, al] of tries) {
          const lx = al === 'c' ? x + dx - w / 2 : al === 'r' ? x + dx - w : x + dx, ly = y + dy;
          const box = [lx - 3, ly - px, lx + w + 3, ly + 3];
          if (box[0] < 3 || box[2] > this.w - 3 || box[1] < 3 || box[3] > this.h - 3) continue;
          if (hit(box) && !force) continue;
          boxes.push(box);
          ctx.textAlign = 'left'; ctx.lineWidth = 3.4; ctx.strokeStyle = T.paper; ctx.strokeText(text, lx, ly); ctx.fillStyle = color; ctx.fillText(text, lx, ly);
          return true;
        }
        return false;
      };
      const pPx = 12.5 * fs, sPx = 11 * fs, hPx = 9.5 * fs;
      const around = px => [[0, -8, 'c'], [0, px + 7, 'c'], [9, px / 3, 'l'], [-9, px / 3, 'r'], [0, -17, 'c']];
      const beside = [[hs + 5, 3.2, 'l'], [-hs - 5, 3.2, 'r'], [0, -hs - 5, 'c'], [0, hs + hPx + 3, 'c']];
      const placeFont = `italic 500 ${pPx.toFixed(1)}px ${SERIF}`, smallFont = `italic 400 ${sPx.toFixed(1)}px ${SERIF}`, hospFont = `600 ${hPx.toFixed(1)}px ${MONO}`;
      const all = g.landmarks.concat(g.hospitals);
      /* 1 focus (endpoints, hovered)  2 major places  3 ranked hospitals  4 hospitals  5 minor places when zoomed in */
      for (const L of all) if (focus.has(L.node)) {
        const x = X(g.x[L.node]), y = Y(g.y[L.node]);
        if (L.zone === 'Hospitals') label(L.name.toUpperCase(), x, y, hospFont, hPx, T.red, beside.map(t => [t[0] * 1.6, t[1] * (t[2] === 'c' ? 1.6 : 1), t[2]]), true);
        else label(L.name, x, y, `italic 600 ${pPx.toFixed(1)}px ${SERIF}`, pPx, T.ink, [[0, -15, 'c'], [0, pPx + 14, 'c'], [15, pPx / 3, 'l'], [-15, pPx / 3, 'r']], true);
      }
      for (const L of g.landmarks) if (L.tier === 1 && !focus.has(L.node)) label(L.name, X(g.x[L.node]), Y(g.y[L.node]), placeFont, pPx, T.ink, around(pPx));
      for (const h of g.hospitals) if (!focus.has(h.node) && this.ranked.includes(h.node)) label(h.name.toUpperCase(), X(g.x[h.node]), Y(g.y[h.node]), hospFont, hPx, T.red, beside.map(t => [t[0] + Math.sign(t[0]) * 5, t[1], t[2]]));
      for (const h of g.hospitals) if (!focus.has(h.node) && !this.ranked.includes(h.node)) label(h.name.toUpperCase(), X(g.x[h.node]), Y(g.y[h.node]), hospFont, hPx, T.red, beside);
      if (zoom >= 1.35) for (const L of g.landmarks) if (L.tier !== 1 && !focus.has(L.node)) label(L.name, X(g.x[L.node]), Y(g.y[L.node]), smallFont, sPx, T.ink2, around(sPx));
      ctx.globalAlpha = 0.8;
      for (const w of g.water) if (w.r >= 1.2) label(w.name, X(w.x), Y(w.y), smallFont, sPx, T.ink2, [[0, sPx / 3, 'c']]);
      ctx.globalAlpha = 1;
    }

    /* markers */
    for (const m of this.marks) {
      const x = X(g.x[m.node]), y = Y(g.y[m.node]), r = mini ? 5 : 9;
      if (m.kind === 'B') {
        ctx.fillStyle = T.ink; ctx.beginPath(); ctx.moveTo(x, y - r - 2); ctx.lineTo(x + r + 2, y); ctx.lineTo(x, y + r + 2); ctx.lineTo(x - r - 2, y); ctx.closePath(); ctx.fill();
        ctx.fillStyle = T.paper; ctx.font = `700 ${mini ? 8 : 10}px ${MONO}`; ctx.textAlign = 'center'; ctx.fillText('B', x, y + (mini ? 3 : 3.6));
      } else {
        if (m.kind === 'X') { ctx.strokeStyle = T.red; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.55 - 0.45 * ((now / 900) % 1); ctx.beginPath(); ctx.arc(x, y, r + 4 + ((now / 900) % 1) * 16, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
        ctx.fillStyle = T.paper; ctx.strokeStyle = T.ink; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.fillStyle = T.ink; ctx.font = `700 ${mini ? 8 : 10}px ${MONO}`; ctx.textAlign = 'center'; ctx.fillText(m.kind === 'X' ? '!' : 'A', x, y + (mini ? 3 : 3.6));
      }
    }

    /* the ambulance drives the route, wheels on the line, facing the way it is going */
    if (this.amb >= 0 && rt) {
      const p = this.posAt(this.amb), q = this.posAt(Math.min(1, this.amb + 0.012));
      if (p) {
        if (q && Math.abs(q[0] - p[0]) > 1e-4) this.ambDir = q[0] < p[0] ? -1 : 1;
        const w = mini ? 14 : 28 * Math.min(1.25, Math.max(1, Math.sqrt(z)));
        drawAmbulance(ctx, X(p[0]), Y(p[1]) - w * 0.27 + Math.sin(now / 120) * 0.5, w, this.ambDir, T, now, !mini);
      }
    }

    /* furniture: scale bar + compass */
    if (!mini && !this.bare) {
      const steps = [1, 2, 5, 10, 20];
      let km = 1; for (const k of steps) if (k * cam.s <= 150) km = k;
      const bx = 22, by = this.h - 24, bw = km * cam.s;
      ctx.strokeStyle = T.ink; ctx.fillStyle = T.ink; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(bx, by - 5); ctx.lineTo(bx, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by - 5); ctx.stroke();
      ctx.fillStyle = T.paper; ctx.fillRect(bx + 1, by - 4, bw / 2 - 1, 3); ctx.fillStyle = T.ink; ctx.fillRect(bx + bw / 2, by - 4, bw / 2 - 1, 3);
      ctx.font = `10px ${MONO}`; ctx.textAlign = 'left'; ctx.fillText(km + ' km', bx, by - 10);
      const cx = this.w - 44, cy = 48;
      ctx.strokeStyle = T.ink; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, 20, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 16, 0, TAU); ctx.globalAlpha = .4; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = T.red; ctx.beginPath(); ctx.moveTo(cx, cy - 17); ctx.lineTo(cx + 4.5, cy); ctx.lineTo(cx - 4.5, cy); ctx.closePath(); ctx.fill();
      ctx.fillStyle = T.ink; ctx.beginPath(); ctx.moveTo(cx, cy + 17); ctx.lineTo(cx + 4.5, cy); ctx.lineTo(cx - 4.5, cy); ctx.closePath(); ctx.globalAlpha = .75; ctx.fill(); ctx.globalAlpha = 1;
      ctx.font = `700 10px ${MONO}`; ctx.textAlign = 'center'; ctx.fillText('N', cx, cy - 25);
    }
    this.dirty = false;
  }
}
