'use strict';
/* ==========================================================================
   CORRIDOR · algorithms.js
   --------------------------------------------------------------------------
   Five shortest-path algorithms on the same CSR graph, all instrumented:
     expanded  – nodes taken out of the frontier ("settled")
     relaxed   – edges examined (the unit of work we race on)
     ms        – wall-clock time of the search itself
   Heavy trace data (visit order, parent per visit) is only copied when the
   caller does not pass { light:true }, so benchmarks measure the algorithm,
   not the bookkeeping.
   ========================================================================== */

function pathFromParent(par, s, t) {
  const out = [];
  for (let v = t; v !== -1; v = par[v]) { out.push(v); if (v === s) break; }
  out.reverse();
  return out[0] === s ? out : null;
}

function pathMetrics(g, path) {
  let min = 0, km = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const e = g.edgeBetween(path[i], path[i + 1]);
    min += g.W[e]; km += g.len[e];
  }
  return { minutes: min, km };
}

function finish(g, name, t0, cost, path, oc, rel, o, extra) {
  const ms = performance.now() - t0;
  const r = { name, found: cost < Infinity, cost, path: cost < Infinity ? path : null, expanded: oc, relaxed: rel, ms };
  if (!o.light) {
    const sc = g.sc;
    r.order = sc.ord.slice(0, oc);
    r.orderParent = sc.ordP.slice(0, oc);
    r.work = sc.wk.slice(0, oc);
    r.side = sc.side.slice(0, oc);
    if (extra) Object.assign(r, extra());
  }
  return r;
}

/* ------------------------------------------------------------- 1. Dijkstra */
/* t = -1 runs to exhaustion (single-source all-targets).  o.W overrides weights. */
function dijkstra(g, s, t, o = {}) {
  const t0 = performance.now();
  const W = o.W || g.W, sc = g.sc, dist = sc.d1, par = sc.p1, done = sc.c1, H = sc.h1;
  const { adjStart, adjTo, adjEdge } = g;
  dist.fill(Infinity); par.fill(-1); done.fill(0); H.n = 0;
  let oc = 0, rel = 0;
  dist[s] = 0; H.push(0, s);
  while (H.n) {
    const u = H.pop();
    if (done[u]) continue;
    done[u] = 1;
    sc.ord[oc] = u; sc.ordP[oc] = par[u]; sc.side[oc] = 0;
    if (u === t) { sc.wk[oc++] = rel; break; }
    const du = dist[u];
    for (let a = adjStart[u], z = adjStart[u + 1]; a < z; a++) {
      const w = W[adjEdge[a]];
      if (w === Infinity) continue;
      rel++;
      const v = adjTo[a], nd = du + w;
      if (nd < dist[v]) { dist[v] = nd; par[v] = u; H.push(nd, v); }
    }
    sc.wk[oc++] = rel;
  }
  const cost = t >= 0 ? dist[t] : 0;
  const path = t >= 0 && cost < Infinity ? pathFromParent(par, s, t) : null;
  return finish(g, 'dijkstra', t0, cost, path, oc, rel, o, () => ({ parent: par.slice(), dist: o.keepDist ? dist.slice() : null }));
}

/* ----------------------------------------------------------------- 2. A*   */
function astar(g, s, t, o = {}) {
  const t0 = performance.now();
  const W = g.W, sc = g.sc, dist = sc.d1, par = sc.p1, done = sc.c1, H = sc.h1;
  const { adjStart, adjTo, adjEdge, x, y } = g;
  const hr = g.hRate, tx = x[t], ty = y[t];
  dist.fill(Infinity); par.fill(-1); done.fill(0); H.n = 0;
  let oc = 0, rel = 0;
  dist[s] = 0; H.push(hr * Math.sqrt((x[s] - tx) ** 2 + (y[s] - ty) ** 2), s);
  while (H.n) {
    const u = H.pop();
    if (done[u]) continue;
    done[u] = 1;
    sc.ord[oc] = u; sc.ordP[oc] = par[u]; sc.side[oc] = 0;
    if (u === t) { sc.wk[oc++] = rel; break; }
    const du = dist[u];
    for (let a = adjStart[u], z = adjStart[u + 1]; a < z; a++) {
      const w = W[adjEdge[a]];
      if (w === Infinity) continue;
      rel++;
      const v = adjTo[a], nd = du + w;
      if (nd < dist[v]) { dist[v] = nd; par[v] = u; { const dx = x[v] - tx, dy = y[v] - ty; H.push(nd + hr * Math.sqrt(dx * dx + dy * dy), v); } }
    }
    sc.wk[oc++] = rel;
  }
  const cost = dist[t];
  return finish(g, 'astar', t0, cost, cost < Infinity ? pathFromParent(par, s, t) : null, oc, rel, o, () => ({ parent: par.slice() }));
}

/* ------------------------------------------------- 3. Bidirectional Dijkstra */
function bidirectional(g, s, t, o = {}) {
  const t0 = performance.now();
  if (s === t) return finish(g, 'bidir', t0, 0, [s], 0, 0, { light: true }, null);
  const W = g.W, sc = g.sc;
  const dF = sc.d1, dB = sc.d2, pF = sc.p1, pB = sc.p2, cF = sc.c1, cB = sc.c2, HF = sc.h1, HB = sc.h2;
  const { adjStart, adjTo, adjEdge } = g;
  dF.fill(Infinity); dB.fill(Infinity); pF.fill(-1); pB.fill(-1); cF.fill(0); cB.fill(0); HF.n = 0; HB.n = 0;
  let oc = 0, rel = 0, mu = Infinity, meet = -1;
  dF[s] = 0; dB[t] = 0; HF.push(0, s); HB.push(0, t);
  while (HF.n && HB.n) {
    const tf = HF.peekKey(), tb = HB.peekKey();
    if (tf + tb >= mu) break;                         // classic stopping rule
    const fwd = tf <= tb;
    const H = fwd ? HF : HB, d = fwd ? dF : dB, od = fwd ? dB : dF, p = fwd ? pF : pB, c = fwd ? cF : cB;
    const u = H.pop();
    if (c[u]) continue;
    c[u] = 1;
    sc.ord[oc] = u; sc.ordP[oc] = p[u]; sc.side[oc] = fwd ? 0 : 1;
    const du = d[u];
    for (let a = adjStart[u], z = adjStart[u + 1]; a < z; a++) {
      const w = W[adjEdge[a]];
      if (w === Infinity) continue;
      rel++;
      const v = adjTo[a], nd = du + w;
      if (nd < d[v]) { d[v] = nd; p[v] = u; H.push(nd, v); }
      if (od[v] < Infinity) { const cand = d[v] + od[v]; if (cand < mu) { mu = cand; meet = v; } }
    }
    sc.wk[oc++] = rel;
  }
  let path = null;
  if (mu < Infinity) {
    path = pathFromParent(pF, s, meet);
    for (let v = pB[meet]; v !== -1; v = pB[v]) { path.push(v); if (v === t) break; }
  }
  return finish(g, 'bidir', t0, mu, path, oc, rel, o, null);
}

/* ------------------------------------------------------- 4. Bellman-Ford   */
function bellmanFord(g, s, t, o = {}) {
  const t0 = performance.now();
  const W = g.W, sc = g.sc, dist = sc.d1, par = sc.p1;
  const { eu, ev, m, n } = g;
  dist.fill(Infinity); par.fill(-1);
  let oc = 0, rel = 0, passes = 0;
  dist[s] = 0; sc.ord[oc] = s; sc.ordP[oc] = -1; sc.side[oc] = 0; sc.wk[oc++] = 0;
  for (let pass = 0; pass < n - 1; pass++) {
    let changed = false; passes++;
    for (let e = 0; e < m; e++) {
      const w = W[e];
      if (w === Infinity) continue;
      rel += 2;
      const u = eu[e], v = ev[e];
      if (dist[u] + w < dist[v]) {
        if (dist[v] === Infinity) { sc.ord[oc] = v; sc.ordP[oc] = u; sc.side[oc] = 0; sc.wk[oc++] = rel; }
        dist[v] = dist[u] + w; par[v] = u; changed = true;
      }
      if (dist[v] + w < dist[u]) {
        if (dist[u] === Infinity) { sc.ord[oc] = u; sc.ordP[oc] = v; sc.side[oc] = 0; sc.wk[oc++] = rel; }
        dist[u] = dist[v] + w; par[u] = v; changed = true;
      }
    }
    if (!changed) break;
  }
  const cost = dist[t];
  return finish(g, 'bellman', t0, cost, cost < Infinity ? pathFromParent(par, s, t) : null, oc, rel, o, () => ({ passes, parent: par.slice() }));
}

/* ------------------------------------------------ 5. Greedy best-first     */
function greedy(g, s, t, o = {}) {
  const t0 = performance.now();
  const W = g.W, sc = g.sc, par = sc.p1, seen = sc.c1, H = sc.h1;
  const { adjStart, adjTo, adjEdge, x, y } = g;
  const tx = x[t], ty = y[t];
  par.fill(-1); seen.fill(0); H.n = 0;
  let oc = 0, rel = 0;
  seen[s] = 1; H.push(Math.sqrt((x[s] - tx) ** 2 + (y[s] - ty) ** 2), s);
  let reached = false;
  while (H.n) {
    const u = H.pop();
    sc.ord[oc] = u; sc.ordP[oc] = par[u]; sc.side[oc] = 0;
    if (u === t) { sc.wk[oc++] = rel; reached = true; break; }
    for (let a = adjStart[u], z = adjStart[u + 1]; a < z; a++) {
      if (W[adjEdge[a]] === Infinity) continue;
      rel++;
      const v = adjTo[a];
      if (!seen[v]) { seen[v] = 1; par[v] = u; const dx = x[v] - tx, dy = y[v] - ty; H.push(Math.sqrt(dx * dx + dy * dy), v); }
    }
    sc.wk[oc++] = rel;
  }
  let path = null, cost = Infinity;
  if (reached) { path = pathFromParent(par, s, t); cost = pathMetrics(g, path).minutes; }
  return finish(g, 'greedy', t0, cost, path, oc, rel, o, () => ({ parent: par.slice() }));
}

/* ------------------------------ multi-target Dijkstra (nearest hospitals) */
/* Stops once k targets have been settled. One run answers "which hospital?"  */
function nearestTargets(g, s, isTarget, k, o = {}) {
  const t0 = performance.now();
  const W = g.W, sc = g.sc, dist = sc.d1, par = sc.p1, done = sc.c1, H = sc.h1;
  const { adjStart, adjTo, adjEdge } = g;
  dist.fill(Infinity); par.fill(-1); done.fill(0); H.n = 0;
  let oc = 0, rel = 0;
  const hits = [];
  dist[s] = 0; H.push(0, s);
  while (H.n) {
    const u = H.pop();
    if (done[u]) continue;
    done[u] = 1;
    sc.ord[oc] = u; sc.ordP[oc] = par[u]; sc.side[oc] = 0;
    if (isTarget[u]) {
      hits.push({ node: u, cost: dist[u] });
      if (hits.length >= k) { sc.wk[oc++] = rel; break; }
    }
    const du = dist[u];
    for (let a = adjStart[u], z = adjStart[u + 1]; a < z; a++) {
      const w = W[adjEdge[a]];
      if (w === Infinity) continue;
      rel++;
      const v = adjTo[a], nd = du + w;
      if (nd < dist[v]) { dist[v] = nd; par[v] = u; H.push(nd, v); }
    }
    sc.wk[oc++] = rel;
  }
  const r = finish(g, 'nearest', t0, hits.length ? hits[0].cost : Infinity, null, oc, rel, o, () => ({ parent: par.slice() }));
  r.hits = hits;
  r.pathTo = v => pathFromParent(par, s, v);
  if (!o.light) { const pc = par.slice(); r.pathTo = v => pathFromParent(pc, s, v); }
  return r;
}

const ALGOS = {
  dijkstra: { id: 'dijkstra', label: 'Dijkstra', short: 'DIJ', fn: dijkstra, optimal: true,
    time: 'O((V+E) log V)', space: 'O(V+E)', blurb: 'Expands in rings of equal travel time. No sense of direction.' },
  astar: { id: 'astar', label: 'A*', short: 'A*', fn: astar, optimal: true,
    time: 'O((V+E) log V) worst', space: 'O(V+E)', blurb: 'Dijkstra with a compass: f = g + h, h = straight-line time.' },
  bidir: { id: 'bidir', label: 'Bidirectional', short: 'BI', fn: bidirectional, optimal: true,
    time: 'O((V+E) log V)', space: 'O(V+E)', blurb: 'Two Dijkstras, one from each end, until the fronts touch.' },
  bellman: { id: 'bellman', label: 'Bellman–Ford', short: 'BF', fn: bellmanFord, optimal: true,
    time: 'O(V·E)', space: 'O(V+E)', blurb: 'Relaxes every road, over and over, until nothing improves.' },
  greedy: { id: 'greedy', label: 'Greedy best-first', short: 'GBF', fn: greedy, optimal: false,
    time: 'O((V+E) log V)', space: 'O(V+E)', blurb: 'Always walks toward the target. Fast, and sometimes wrong.' },
};
const ALGO_ORDER = ['dijkstra', 'astar', 'bidir', 'bellman', 'greedy'];
