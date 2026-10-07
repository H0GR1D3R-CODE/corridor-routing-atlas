'use strict';
/* ==========================================================================
   CORRIDOR · tests.js
   --------------------------------------------------------------------------
   Ten executable claims about the implementation.  Each test returns
   { pass, detail }.  They run on their OWN copy of the city, so flooding a
   road on the live map can never corrupt a verdict.
   ========================================================================== */

const EPS = 1e-6;
const close = (a, b) => Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));

function handGraph() {
  /*   4 ---- 5
       |      |            0-1-2-3 is the "obvious" road, but 1-2 is jammed (w=5).
       1 ---- 2            The true optimum detours 1-4-5-2.  Node 6 is an island.
       |      |
       0      3                                                                   */
  const xs = [0, 1, 2, 3, 1, 2, 9], ys = [0, 0, 0, 0, 1, 1, 9];
  const E = (u, v, w) => ({ u, v, w });
  const g = finalizeGraph(xs, ys, [E(0, 1, 1), E(1, 2, 5), E(2, 3, 1), E(1, 4, 1), E(4, 5, 1), E(5, 2, 1)]);
  return g;
}

function randomPairs(g, count, seed) {
  const rnd = mulberry32(seed), out = [];
  while (out.length < count) {
    const s = (rnd() * g.n) | 0, t = (rnd() * g.n) | 0;
    if (s !== t) out.push([s, t]);
  }
  return out;
}

const TESTS = [
  {
    id: 'T1', title: 'Hand-checked graph',
    claim: 'On a 7-node graph whose answer was worked out on paper (cost 5 via the detour 0-1-4-5-2-3), every optimal algorithm agrees.',
    run() {
      const g = handGraph(), want = 5, res = [];
      for (const id of ['dijkstra', 'astar', 'bidir', 'bellman']) {
        const r = ALGOS[id].fn(g, 0, 3, { light: false });
        res.push([id, r.cost, r.path && r.path.join('-')]);
      }
      const ok = res.every(([, c, p]) => close(c, want) && p === '0-1-4-5-2-3');
      const gr = greedy(g, 0, 3, {});
      return { pass: ok && gr.cost >= want - EPS, detail: res.map(([i, c]) => `${i} ${c}`).join(' · ') + ` · greedy ${gr.cost}` };
    },
  },
  {
    id: 'T2', title: 'Source equals target',
    claim: 'Routing from a junction to itself costs 0 and returns a one-node path, for every algorithm.',
    run() {
      const g = buildCity({ rings: 8, seed: 3, named: false });
      const bad = [];
      for (const id of ALGO_ORDER) {
        const r = ALGOS[id].fn(g, 5, 5, {});
        if (!(r.found && r.cost === 0 && r.path.length === 1)) bad.push(id);
      }
      return { pass: bad.length === 0, detail: bad.length ? 'failed: ' + bad.join(', ') : '5 of 5 algorithms return cost 0, path [5]' };
    },
  },
  {
    id: 'T3', title: 'Unreachable destination',
    claim: 'An island node (hand graph) and a junction sealed in by closures (city graph) are reported as unreachable, never as a fake route.',
    run() {
      const h = handGraph();
      const a = ['dijkstra', 'astar', 'bidir', 'bellman', 'greedy'].map(id => ALGOS[id].fn(h, 0, 6, {}).found);
      const g = buildCity({ rings: 8, seed: 3, named: false });
      const t = 40;
      for (let k = g.adjStart[t]; k < g.adjStart[t + 1]; k++) g.blocked[g.adjEdge[k]] = 1;
      applyTraffic(g, 12, false);
      const b = ['dijkstra', 'astar', 'bidir', 'bellman', 'greedy'].map(id => ALGOS[id].fn(g, 0, t, {}).found);
      return { pass: !a.some(Boolean) && !b.some(Boolean), detail: `island: ${a.filter(Boolean).length}/5 found · sealed junction: ${b.filter(Boolean).length}/5 found (want 0 and 0)` };
    },
  },
  {
    id: 'T4', title: 'Road closure forces a detour',
    claim: 'Flood a road on the optimal route: the new route avoids it, costs no less, and all optimal algorithms still agree.',
    run() {
      const g = buildCity({ rings: 12, seed: 5, named: false });
      applyTraffic(g, 18.5, false);
      let checked = 0, bad = 0, lastDelta = 0;
      for (const [s, t] of randomPairs(g, 25, 11)) {
        const r0 = dijkstra(g, s, t, {});
        if (!r0.found || r0.path.length < 4) continue;
        const mid = r0.path.length >> 1, e = g.edgeBetween(r0.path[mid], r0.path[mid + 1]);
        g.blocked[e] = 1; applyTraffic(g, 18.5, false);
        const rs = ['dijkstra', 'astar', 'bidir', 'bellman'].map(id => ALGOS[id].fn(g, s, t, {}));
        const same = rs.every(r => r.found === rs[0].found && (!r.found || close(r.cost, rs[0].cost)));
        const avoids = !rs[0].found || !rs[0].path.some((v, i) => i + 1 < rs[0].path.length && g.edgeBetween(v, rs[0].path[i + 1]) === e);
        const noBetter = !rs[0].found || rs[0].cost >= r0.cost - EPS;
        if (!(same && avoids && noBetter)) bad++;
        lastDelta = rs[0].found ? rs[0].cost - r0.cost : lastDelta;
        g.blocked[e] = 0; applyTraffic(g, 18.5, false);
        checked++;
      }
      return { pass: checked >= 10 && bad === 0, detail: `${checked} closures tested · ${bad} violations · last detour added ${lastDelta.toFixed(1)} min` };
    },
  },
  {
    id: 'T5', title: 'Cross-validation, 150 random trips',
    claim: 'Dijkstra, A*, Bidirectional Dijkstra and Bellman–Ford return the same optimal cost (±1e-6 min) on 150 random origin-destination pairs at evening peak.',
    run() {
      const g = buildCity({ rings: 12, seed: 21, named: false });
      applyTraffic(g, 18.5, false);
      let bad = 0; const pairs = randomPairs(g, 150, 77);
      for (const [s, t] of pairs) {
        const c = ['dijkstra', 'astar', 'bidir', 'bellman'].map(id => ALGOS[id].fn(g, s, t, { light: true }).cost);
        if (!c.every(x => close(x, c[0]))) bad++;
      }
      return { pass: bad === 0, detail: `${pairs.length} pairs × 4 algorithms = ${pairs.length * 4} searches · ${bad} disagreements` };
    },
  },
  {
    id: 'T6', title: 'The heuristic never lies',
    claim: 'A* is only correct if h is admissible (h ≤ true cost) and consistent (h(u) ≤ w(u,v) + h(v)). Both are checked on every junction and every road, at three times of day.',
    run() {
      const g = buildCity({ rings: 10, seed: 9, named: false });
      let viol = 0, checks = 0;
      for (const hour of [3, 9, 18.5]) {
        applyTraffic(g, hour, false);
        for (const t of [0, g.n >> 1, g.n - 1]) {
          const full = dijkstra(g, t, -1, { keepDist: true }).dist;
          for (let v = 0; v < g.n; v++) {
            const h = g.hRate * Math.hypot(g.x[v] - g.x[t], g.y[v] - g.y[t]);
            if (full[v] < Infinity && h > full[v] + EPS) viol++;
            checks++;
          }
          for (let e = 0; e < g.m; e++) {
            const u = g.eu[e], v = g.ev[e], w = g.W[e];
            const hu = g.hRate * Math.hypot(g.x[u] - g.x[t], g.y[u] - g.y[t]);
            const hv = g.hRate * Math.hypot(g.x[v] - g.x[t], g.y[v] - g.y[t]);
            if (hu > w + hv + EPS || hv > w + hu + EPS) viol++;
            checks++;
          }
        }
      }
      return { pass: viol === 0, detail: `${checks.toLocaleString()} inequalities checked · ${viol} violations` };
    },
  },
  {
    id: 'T7', title: 'Optimal substructure',
    claim: 'Every prefix of an optimal route is itself an optimal route to its endpoint (the property Dijkstra and A* are built on).',
    run() {
      const g = buildCity({ rings: 11, seed: 4, named: false });
      applyTraffic(g, 9, false);
      let bad = 0, n = 0;
      for (const [s, t] of randomPairs(g, 20, 5)) {
        const r = astar(g, s, t, {});
        if (!r.found || r.path.length < 5) continue;
        const full = dijkstra(g, s, -1, { keepDist: true }).dist;
        let acc = 0;
        for (let i = 0; i + 1 < r.path.length; i++) {
          acc += g.W[g.edgeBetween(r.path[i], r.path[i + 1])];
          if (!close(acc, full[r.path[i + 1]])) bad++;
          n++;
        }
      }
      return { pass: bad === 0 && n > 50, detail: `${n} prefixes compared with single-source Dijkstra · ${bad} mismatches` };
    },
  },
  {
    id: 'T8', title: 'Greedy is fast, and sometimes wrong',
    claim: 'Greedy best-first never beats the optimum (it cannot), but it should lose on a noticeable share of trips: the reason A* adds g to h.',
    run() {
      const g = buildCity({ rings: 12, seed: 33, named: false });
      applyTraffic(g, 18.5, false);
      let worse = 0, impossible = 0, sumGap = 0, n = 0;
      for (const [s, t] of randomPairs(g, 150, 8)) {
        const o = astar(g, s, t, { light: true }), r = greedy(g, s, t, { light: true });
        if (!o.found) continue;
        n++;
        if (r.cost < o.cost - EPS) impossible++;
        if (r.cost > o.cost + EPS) { worse++; sumGap += r.cost / o.cost - 1; }
      }
      const avg = worse ? (sumGap / worse * 100).toFixed(0) : 0;
      return { pass: impossible === 0 && worse > 0, detail: `greedy was slower on ${worse} of ${n} trips (avg +${avg}% ETA) · beat the optimum ${impossible} times` };
    },
  },
  {
    id: 'T9', title: 'Hospital dispatch = best of all hospitals',
    claim: 'One multi-target Dijkstra run returns the same fastest hospital as running a separate Dijkstra to each hospital and taking the minimum.',
    run() {
      const g = buildCity(CITY);
      applyTraffic(g, 18.5, false);
      const mask = new Uint8Array(g.n); g.hospitals.forEach(h => mask[h.node] = 1);
      let bad = 0, n = 0;
      for (const [s] of randomPairs(g, 40, 19)) {
        const one = nearestTargets(g, s, mask, 1, { light: true });
        let best = Infinity;
        for (const h of g.hospitals) best = Math.min(best, dijkstra(g, s, h.node, { light: true }).cost);
        if (!close(one.cost, best)) bad++;
        n++;
      }
      return { pass: bad === 0, detail: `${n} incidents · ${g.hospitals.length} hospitals · ${bad} mismatches` };
    },
  },
  {
    id: 'T10', title: 'Monotone world',
    claim: 'The siren can never make a trip slower, and free-flow (3 am) can never be slower than rush hour: weights only move one way, so costs must too.',
    run() {
      const g = buildCity({ rings: 12, seed: 14, named: false });
      let bad = 0, n = 0;
      for (const [s, t] of randomPairs(g, 40, 3)) {
        applyTraffic(g, 3, false);   const night = astar(g, s, t, { light: true }).cost;
        applyTraffic(g, 18.5, true); const sir = astar(g, s, t, { light: true }).cost;
        applyTraffic(g, 18.5, false); const rush = astar(g, s, t, { light: true }).cost;
        if (night > sir + EPS || sir > rush + EPS) bad++;
        n++;
      }
      return { pass: bad === 0, detail: `${n} trips: night ≤ siren ≤ rush held ${n - bad} times` };
    },
  },
];
