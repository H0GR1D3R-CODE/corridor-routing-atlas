'use strict';
/* ==========================================================================
   CORRIDOR · graph.js
   --------------------------------------------------------------------------
   1. MinHeap            – array-backed binary heap (typed arrays)
   2. finalizeGraph      – edge list  ->  CSR adjacency + weight arrays
   3. buildCity          – radial-ring road mesh pinned to real Bengaluru places
   4. applyTraffic       – time-dependent edge weights  w_t(e)
   ========================================================================== */

const ROAD = { LOCAL: 0, RING: 1, ARTERIAL: 2 };
const ROAD_SPEED = [28, 45, 55];          // free-flow km/h
const ROAD_JAM = [1.0, 1.2, 1.3];         // how badly each class jams
const V_MAX = 55;                         // fastest road in the network (km/h)

/* ---- the geography ---------------------------------------------------------
   Every place is given as (km east, km north) of Majestic / KSR station,
   converted from its approximate latitude-longitude. The road mesh between
   them is generated; the places, hospitals, lakes and highway bearings are real. */
const CITY = { rings: 16, seed: 7 };
const ZONES = ['Central', 'North', 'East', 'South-East', 'South', 'West', 'Towns & outskirts'];
const P = (name, e, n, zone, tier = 2) => ({ name, e, n, zone, tier });
const PLACES = [
  P('Majestic', 0, 0, 'Central', 1),
  P('MG Road', 3.8, -0.2, 'Central', 1),
  P('Malleshwaram', -0.8, 2.6, 'Central', 1),
  P('Basavanagudi', 0.2, -3.9, 'Central'),
  P('Frazer Town', 4.4, 2.3, 'Central'),

  P('Yeshwanthpur', -3.5, 5.7, 'North', 1),
  P('Hebbal', 2.7, 6.5, 'North', 1),
  P('Yelahanka', 2.6, 13.7, 'North', 1),
  P('Peenya', -5.6, 5.9, 'North'),
  P('Jalahalli', -2.9, 8.1, 'North'),
  P('Dasarahalli', -6.4, 7.6, 'North'),
  P('RT Nagar', 2.5, 4.6, 'North'),
  P('Vidyaranyapura', -1.6, 11.4, 'North'),
  P('Jakkur', 3.8, 10.9, 'North'),
  P('Thanisandra', 6.6, 8.7, 'North'),
  P('Hennur', 7.4, 6.4, 'North'),

  P('Indiranagar', 7.5, -0.6, 'East', 1),
  P('KR Puram', 13.3, 3.1, 'East', 1),
  P('Marathahalli', 14.0, -2.3, 'East', 1),
  P('Whitefield', 19.3, -0.8, 'East', 1),
  P('Banaswadi', 8.2, 3.7, 'East'),
  P('Ramamurthy Nagar', 11.2, 4.4, 'East'),
  P('HAL', 10.3, -1.2, 'East'),
  P('Brookefield', 16.0, -1.0, 'East'),
  P('Hoodi', 15.5, 1.6, 'East'),
  P('Kadugodi', 20.6, 2.0, 'East'),
  P('Varthur', 19.3, -4.1, 'East'),
  P('Bellandur', 10.9, -6.6, 'East'),

  P('Koramangala', 6.6, -4.2, 'South-East', 1),
  P('Silk Board', 5.9, -6.9, 'South-East', 1),
  P('HSR Layout', 8.2, -7.4, 'South-East', 1),
  P('Electronic City', 9.5, -14.7, 'South-East', 1),
  P('BTM Layout', 3.9, -7.7, 'South-East'),
  P('Bommanahalli', 5.9, -9.3, 'South-East'),
  P('Sarjapur Road', 13.9, -7.6, 'South-East'),
  P('Begur', 5.4, -11.6, 'South-East'),

  P('Jayanagar', 1.2, -5.4, 'South', 1),
  P('Banashankari', -2.7, -5.8, 'South', 1),
  P('JP Nagar', 1.4, -8.0, 'South'),
  P('Uttarahalli', -3.1, -8.9, 'South'),
  P('Konanakunte', -0.3, -10.4, 'South'),
  P('Hulimavu', 3.2, -11.2, 'South'),
  P('Bannerghatta', 0.5, -19.4, 'South'),

  P('Kengeri', -9.2, -7.0, 'West', 1),
  P('Rajajinagar', -2.4, 2.2, 'West'),
  P('Vijayanagar', -3.8, -0.7, 'West'),
  P('Nagarbhavi', -6.7, -1.9, 'West'),
  P('Nayandahalli', -5.1, -3.8, 'West'),
  P('RR Nagar', -5.8, -5.9, 'West'),
  P('Sunkadakatte', -7.3, 1.0, 'West'),

  P('Kempegowda Airport', 14.5, 24.6, 'Towns & outskirts', 1),
  P('Nelamangala', -19.7, 13.7, 'Towns & outskirts', 1),
  P('Hoskote', 24.7, 10.3, 'Towns & outskirts', 1),
  P('Bidadi', -19.7, -19.6, 'Towns & outskirts', 1),
  P('Hesaraghatta', -8.5, 16.8, 'Towns & outskirts'),
  P('Rajanukunte', -1.3, 21.4, 'Towns & outskirts'),
  P('Bagalur', 10.6, 17.0, 'Towns & outskirts'),
  P('Sarjapur', 23.2, -13.0, 'Towns & outskirts'),
  P('Chandapura', 14.6, -20.6, 'Towns & outskirts'),
  P('Jigani', 6.3, -21.9, 'Towns & outskirts'),
  P('Kumbalgodu', -12.5, -11.0, 'Towns & outskirts'),
  P('Tavarekere', -18.6, -1.9, 'Towns & outskirts'),
];
const HOSPITALS = [
  { name: 'Ramaiah Memorial', e: -0.3, n: 5.8 },
  { name: 'ESI Rajajinagar',  e: -2.2, n: 0.5 },
  { name: 'Victoria',         e: 0.3,  n: -1.7 },
  { name: 'Bowring',          e: 3.6,  n: 1.0 },
  { name: 'NIMHANS',          e: 2.7,  n: -3.8 },
  { name: 'Jayadeva',         e: 2.7,  n: -6.2 },
  { name: "St. John's",       e: 4.6,  n: -5.0 },
  { name: 'Manipal',          e: 8.4,  n: -2.2 },
  { name: 'Aster CMI',        e: 2.3,  n: 8.9 },
  { name: 'Sakra World',      e: 12.6, n: -5.2 },
  { name: 'Vydehi',           e: 17.6, n: 0.6 },
  { name: 'Narayana Health',  e: 13.2, n: -18.5 },
  { name: 'Fortis',           e: 2.9,  n: -9.2 },
  { name: 'Sagar',            e: -1.0, n: -7.6 },
  { name: 'BGS Gleneagles',   e: -7.4, n: -8.8 },
].map(h => ({ ...h, zone: 'Hospitals', tier: 1 }));
const WATER = [
  { name: 'Hebbal Lake',       e: 1.5,  n: 7.7,   r: 0.8 },
  { name: 'Sankey Tank',       e: 0.1,  n: 3.6,   r: 0.6 },
  { name: 'Ulsoor Lake',       e: 5.2,  n: 0.7,   r: 0.7 },
  { name: 'Bellandur Lake',    e: 9.6,  n: -3.9,  r: 1.3 },
  { name: 'Varthur Lake',      e: 17.0, n: -4.8,  r: 1.2 },
  { name: 'Hesaraghatta Lake', e: -9.6, n: 19.2,  r: 1.4 },
  { name: 'Lalbagh',           e: 1.5,  n: -3.0,  r: 0.8, kind: 'park' },
  { name: 'Cubbon Park',       e: 2.2,  n: -0.3,  r: 0.8, kind: 'park' },
  { name: 'GKVK',              e: 0.4,  n: 11.2,  r: 1.0, kind: 'park' },
  { name: 'Turahalli Forest',  e: -5.4, n: -11.0, r: 1.1, kind: 'park' },
  { name: 'Bannerghatta Park', e: -1.5, n: -24.0, r: 3.0, kind: 'park' },
];
const HOTSPOTS = [
  { name: 'Silk Board',      e: 5.9,  n: -6.9, r: 2.4, k: 1.7 },
  { name: 'Marathahalli',    e: 14.0, n: -2.3, r: 2.4, k: 1.4 },
  { name: 'Hebbal flyover',  e: 2.7,  n: 6.5,  r: 2.0, k: 1.3 },
  { name: 'Tin Factory',     e: 12.4, n: 2.9,  r: 2.0, k: 1.2 },
  { name: 'Goraguntepalya',  e: -4.6, n: 5.9,  r: 1.8, k: 1.0 },
];
/* ---- what makes a city slow: the conditions a dispatcher (or anyone driving) lives with ---- */
const DAYS = {
  weekday:  { label: 'Weekday',  note: 'two office peaks, 9 am and 6:30 pm' },
  saturday: { label: 'Saturday', note: 'no office rush, a long shopping evening' },
  sunday:   { label: 'Sunday',   note: 'quiet morning, busy evening' },
  holiday:  { label: 'Public holiday', note: 'light all day' },
  bandh:    { label: 'Bandh',    note: 'shutdown: the roads are nearly empty' },
};
const SKIES = {
  clear:      { label: 'Clear',      rain: 0,    note: 'dry roads' },
  rain:       { label: 'Rain',       rain: 0.3,  note: 'everyone slows down' },
  cloudburst: { label: 'Cloudburst', rain: 0.7,  note: 'low-lying roads crawl' },
  flood:      { label: 'Flood',      rain: 1.0,  note: 'underpasses and lake-side roads go under water' },
};
/* spots: [km east, km north, radius km, strength].  close: [km east, km north, how many roads shut] */
const EVENTS = {
  school:   { label: 'School run',            note: 'buses and drop-offs clog the side streets', local: 0.6 },
  techpark: { label: 'Tech-park log-out',     note: 'the eastern tech corridor empties onto the ring road',
              spots: [[10.9, -6.6, 2.2, 1.2], [14.0, -2.3, 2.2, 1.3], [17.6, -0.5, 2.2, 1.1], [16.0, 1.6, 2.0, 1.0], [9.5, -14.7, 2.4, 1.2]] },
  match:    { label: 'Cricket at Chinnaswamy', note: 'a full stadium next to MG Road', spots: [[3.0, 0.2, 2.8, 3.0]] },
  festival: { label: 'Festival procession',   note: 'the old city fills up and three streets are shut',
              spots: [[0.5, -1.6, 2.3, 1.9], [0.2, -3.9, 1.6, 1.2]], close: [[0.3, -0.9, 3]] },
  metro:    { label: 'Metro construction',    note: 'barricades narrow the Outer Ring Road',
              spots: [[8.2, -7.4, 1.6, 1.1], [10.9, -6.6, 1.6, 1.1], [12.9, -4.6, 1.6, 1.1], [14.0, -2.3, 1.6, 1.1], [13.6, 0.6, 1.6, 1.1]] },
  vip:      { label: 'VIP convoy',            note: 'Bellary Road is held for a motorcade to the airport',
              spots: [[2.7, 6.5, 1.5, 1.6], [2.9, 9.5, 1.5, 1.6], [3.5, 12.5, 1.5, 1.6], [5.5, 16.0, 1.6, 1.5], [9.0, 20.0, 1.6, 1.5], [13.0, 23.5, 1.6, 1.5]] },
  accident: { label: 'Accident on Hosur Rd',  note: 'a pile-up shuts the highway south of Bommanahalli',
              spots: [[7.4, -10.4, 2.6, 1.7]], close: [[7.4, -10.4, 2]] },
  apocalypse: { label: 'Apocalypse',          note: 'everyone leaves at once: gridlock everywhere, one road in twelve abandoned', global: 2.6, closeFrac: 0.085 },
};
/* places that go under water first */
const FLOOD_SPOTS = [
  [5.9, -6.9, 1.6], [10.9, -6.0, 1.8], [2.7, 6.5, 1.1], [13.0, 3.0, 1.2], [-0.6, 0.6, 1.0],
  [6.2, -4.6, 1.2], [14.5, -8.0, 1.6], [5.2, 7.6, 1.3], [2.6, 13.7, 1.2], [6.2, -9.6, 1.2],
];
/* radial highways: compass bearing out of the centre */
const HIGHWAYS = [
  { name: 'Bellary Rd', b: 14 },       { name: 'Hennur Rd', b: 40 },        { name: 'Old Madras Rd', b: 72 },
  { name: 'Old Airport Rd', b: 96 },   { name: 'Sarjapur Rd', b: 119 },     { name: 'Hosur Rd', b: 145 },
  { name: 'Bannerghatta Rd', b: 171 }, { name: 'Kanakapura Rd', b: 197 },   { name: 'Mysore Rd', b: 231 },
  { name: 'Magadi Rd', b: 272 },       { name: 'Tumkur Rd', b: 314 },
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ----------------------------------------------------------------- MinHeap */
class MinHeap {
  constructor(cap = 256) {
    this.k = new Float64Array(cap);
    this.v = new Int32Array(cap);
    this.n = 0;
    this.topKey = 0;
  }
  _grow() {
    const k = new Float64Array(this.k.length * 2); k.set(this.k); this.k = k;
    const v = new Int32Array(this.v.length * 2); v.set(this.v); this.v = v;
  }
  push(key, val) {
    if (this.n === this.k.length) this._grow();
    const k = this.k, v = this.v;
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    this.topKey = k[0];
    const n = --this.n;
    if (n > 0) {
      const key = k[n], val = v[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= key) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = key; v[i] = val;
    }
    return top;
  }
  peekKey() { return this.n ? this.k[0] : Infinity; }
}

/* ----------------------------------------------------------- finalizeGraph */
/* edges: [{u, v, len?, cls?, w?}]  -  len defaults to Euclid, w to len/speed */
function finalizeGraph(xs, ys, edges) {
  const n = xs.length, m = edges.length;
  const g = {
    n, m,
    x: Float64Array.from(xs), y: Float64Array.from(ys),
    eu: new Int32Array(m), ev: new Int32Array(m),
    len: new Float64Array(m), cls: new Uint8Array(m),
    base: new Float64Array(m), W: new Float64Array(m),
    cong: new Float64Array(m).fill(1), blocked: new Uint8Array(m),
    mx: new Float64Array(m), my: new Float64Array(m),
    hot: new Float64Array(m), noise: new Float64Array(m).fill(1),
    low: new Float64Array(m), dice: new Float64Array(m).fill(1),
    cT: new Float64Array(m), cW: new Float64Array(m), cE: new Float64Array(m), Wopen: new Float64Array(m),
    adjStart: new Int32Array(n + 1), adjTo: new Int32Array(2 * m), adjEdge: new Int32Array(2 * m),
    nring: new Uint8Array(n), art: new Int8Array(m).fill(-1), artNames: [],
    hRate: 1, R: 0, spacing: 1.8, rings: 0,
    water: [], hotspots: [], landmarks: [], hospitals: [], ringNames: new Map(),
  };
  const deg = new Int32Array(n + 1);
  for (let e = 0; e < m; e++) {
    const E = edges[e];
    g.eu[e] = E.u; g.ev[e] = E.v;
    const dx = g.x[E.u] - g.x[E.v], dy = g.y[E.u] - g.y[E.v];
    g.len[e] = E.len !== undefined ? E.len : Math.hypot(dx, dy);
    g.cls[e] = E.cls || 0;
    if (E.art !== undefined) g.art[e] = E.art;
    g.base[e] = E.w !== undefined ? E.w : g.len[e] / ROAD_SPEED[g.cls[e]] * 60;
    g.mx[e] = (g.x[E.u] + g.x[E.v]) / 2;
    g.my[e] = (g.y[E.u] + g.y[E.v]) / 2;
    deg[E.u]++; deg[E.v]++;
  }
  for (let i = 0; i < n; i++) g.adjStart[i + 1] = g.adjStart[i] + deg[i];
  const cur = g.adjStart.slice(0, n);
  for (let e = 0; e < m; e++) {
    const u = g.eu[e], v = g.ev[e];
    g.adjTo[cur[u]] = v; g.adjEdge[cur[u]++] = e;
    g.adjTo[cur[v]] = u; g.adjEdge[cur[v]++] = e;
  }
  g.W.set(g.base);

  g.sc = {
    d1: new Float64Array(n), d2: new Float64Array(n),
    p1: new Int32Array(n), p2: new Int32Array(n),
    c1: new Uint8Array(n), c2: new Uint8Array(n),
    ord: new Int32Array(2 * n + 2), ordP: new Int32Array(2 * n + 2),
    wk: new Float64Array(2 * n + 2), side: new Uint8Array(2 * n + 2),
    h1: new MinHeap(512), h2: new MinHeap(512),
  };

  g.edgeBetween = function (u, v) {
    for (let a = g.adjStart[u]; a < g.adjStart[u + 1]; a++) if (g.adjTo[a] === v) return g.adjEdge[a];
    return -1;
  };
  /* Adaptive admissible heuristic:  h(v) = hRate * |v - t|
     hRate = the smallest "minutes per km" over all open roads *right now*.
     Every road costs at least hRate per km and is at least as long as the
     straight line, so h never over-estimates and is consistent.            */
  g.refresh = function () {
    let r = Infinity;
    for (let e = 0; e < g.m; e++) {
      if (g.W[e] === Infinity) continue;
      const q = g.W[e] / g.len[e];
      if (q < r) r = q;
    }
    g.hRate = r === Infinity ? 1 : r;
  };
  g.refresh();
  g.nearestNode = function (px, py) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < g.n; i++) {
      const d = (g.x[i] - px) ** 2 + (g.y[i] - py) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return { node: best, d: Math.sqrt(bd) };
  };
  g.nearestEdge = function (px, py) {
    let best = -1, bd = Infinity;
    for (let e = 0; e < g.m; e++) {
      const ax = g.x[g.eu[e]], ay = g.y[g.eu[e]], bx = g.x[g.ev[e]], by = g.y[g.ev[e]];
      const vx = bx - ax, vy = by - ay;
      const L2 = vx * vx + vy * vy || 1e-9;
      let t = ((px - ax) * vx + (py - ay) * vy) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = (ax + t * vx - px) ** 2 + (ay + t * vy - py) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return { edge: best, d: Math.sqrt(bd) };
  };
  g.place = function (v) {
    let best = null, bd = Infinity;
    for (const L of g.landmarks.concat(g.hospitals)) {
      const d = Math.hypot(g.x[L.node] - g.x[v], g.y[L.node] - g.y[v]);
      if (d < bd) { bd = d; best = L; }
    }
    if (!best) return 'junction ' + v;
    return bd < 0.9 ? best.name : 'near ' + best.name;
  };
  /* the named roads a route uses, in order: "Tumkur Rd, Outer Ring Rd, Bellary Rd" */
  g.via = function (path) {
    const out = [];
    for (let i = 0; i + 1 < path.length; i++) {
      const e = g.edgeBetween(path[i], path[i + 1]);
      if (g.cls[e] === ROAD.LOCAL) continue;
      const nm = g.roadName(e);
      if (!out.includes(nm)) out.push(nm);
    }
    return out;
  };
  g.roadName = function (e) {
    if (g.cls[e] === ROAD.ARTERIAL) return g.artNames[g.art[e]] || 'Radial arterial';
    if (g.cls[e] === ROAD.RING) return g.ringNames.get(g.nring[g.eu[e]]) || 'Ring road';
    return 'Local street';
  };
  return g;
}

/* --------------------------------------------------------------- buildCity */
function buildCity(opts = {}) {
  const rings = opts.rings ?? CITY.rings, seed = opts.seed ?? CITY.seed, sp = opts.spacing ?? 1.8;
  const named = opts.named ?? true;
  const dropP = opts.dropP ?? 0.08, diagP = opts.diagP ?? 0.07;
  const rnd = mulberry32(seed);
  const R = rings * sp;
  const TAU = Math.PI * 2;

  /* water bodies: organic blobs */
  const water = named ? WATER.map((w, i) => {
    const x = w.e, y = -w.n;                         // screen y grows southward
    const ph = i * 1.7 + 0.4;
    const rad = a => w.r * (1 + 0.18 * Math.sin(3 * a + ph) + 0.10 * Math.sin(5 * a + 2 * ph));
    const poly = [];
    for (let k = 0; k < 30; k++) { const a = k / 30 * TAU; poly.push([x + rad(a) * Math.cos(a), y + rad(a) * Math.sin(a)]); }
    return { ...w, x, y, rad, poly };
  }) : [];

  /* nodes: concentric rings, count ~ 2*pi*r so spacing stays ~constant */
  const NX = [0], NY = [0], NA = [0], NR = [0];
  const ringNodes = [[0]];
  for (let r = 1; r <= rings; r++) {
    const cnt = Math.max(6, Math.round(TAU * r)), step = TAU / cnt, ph = rnd() * step, list = [];
    for (let i = 0; i < cnt; i++) {
      const a = (ph + i * step + (rnd() - .5) * step * .28) % TAU;
      const rr = r * sp + (rnd() - .5) * sp * .3;
      NX.push(rr * Math.sin(a)); NY.push(-rr * Math.cos(a)); NA.push(a); NR.push(r);
      list.push(NX.length - 1);
    }
    ringNodes.push(list);
  }
  const N0 = NX.length;
  const alive = new Uint8Array(N0).fill(1);
  for (const w of water) {
    for (let i = 0; i < N0; i++) {
      const dx = NX[i] - w.x, dy = NY[i] - w.y;
      if (Math.hypot(dx, dy) < w.rad(Math.atan2(dy, dx)) + 0.3) alive[i] = 0;
    }
  }
  const angDiff = (a, b) => { const d = Math.abs(a - b) % TAU; return d > Math.PI ? TAU - d : d; };
  const nearestInRing = (r, a) => {
    let best = -1, bd = 9;
    for (const v of ringNodes[r]) {
      if (!alive[v]) continue;
      const d = angDiff(NA[v], a);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  };

  /* ring roads: the real city has them at roughly 5, 11 and 20 km; generic cities scale by size */
  const realRings = named && rings >= 12;
  const ringRoads = new Set(realRings
    ? [Math.round(5.4 / sp), Math.round(10.8 / sp), Math.round(19.8 / sp), rings]
    : [Math.max(2, Math.round(rings * .30)), Math.max(3, Math.round(rings * .58)), rings]);
  const E = [], seen = new Map();
  const add = (u, v, cls, art = -1) => {
    if (u === v || u < 0 || v < 0 || !alive[u] || !alive[v]) return;
    const a = Math.min(u, v), b = Math.max(u, v), key = a * 100003 + b;
    if (seen.has(key)) { const ed = E[seen.get(key)]; if (cls > ed.cls) { ed.cls = cls; ed.art = art; } return; }
    seen.set(key, E.length); E.push({ u: a, v: b, cls, art });
  };
  for (let r = 1; r <= rings; r++) {
    const list = ringNodes[r], rc = ringRoads.has(r) ? ROAD.RING : ROAD.LOCAL;
    for (let i = 0; i < list.length; i++) add(list[i], list[(i + 1) % list.length], rc);
    for (const u of list) { if (!alive[u]) continue; add(u, r === 1 ? 0 : nearestInRing(r - 1, NA[u]), ROAD.LOCAL); }
    if (r >= 2) for (const w of ringNodes[r - 1]) { if (alive[w]) add(w, nearestInRing(r, NA[w]), ROAD.LOCAL); }
  }
  for (let r = 1; r < rings; r++) {
    const step = TAU / ringNodes[r].length;
    for (const u of ringNodes[r]) if (alive[u] && rnd() < diagP) add(u, nearestInRing(r + 1, NA[u] + (rnd() - .5) * step * 3), ROAD.LOCAL);
  }
  /* radial arterials: the real highways for Bengaluru, nine random spokes otherwise */
  const K = 9, jitter = Array.from({ length: K }, () => (rnd() - .5) * .35);
  const spokes = named ? HIGHWAYS.map(h => h.b * Math.PI / 180) : jitter.map((j, k) => (k * TAU / K + j + TAU) % TAU);
  spokes.forEach((ang, k) => {
    let prev = 0;
    for (let r = 1; r <= rings; r++) {
      const v = nearestInRing(r, ang);
      if (v < 0) continue;
      add(prev, v, ROAD.ARTERIAL, k); prev = v;
    }
  });
  const kept = E.filter(e => e.cls !== ROAD.LOCAL || rnd() >= dropP);

  /* keep only the largest connected component */
  const par = Int32Array.from({ length: N0 }, (_, i) => i);
  const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (const e of kept) par[find(e.u)] = find(e.v);
  const size = new Map();
  for (let i = 0; i < N0; i++) if (alive[i]) { const r = find(i); size.set(r, (size.get(r) || 0) + 1); }
  let root = -1, bs = -1;
  for (const [r, s] of size) if (s > bs) { bs = s; root = r; }
  const newId = new Int32Array(N0).fill(-1);
  const xs = [], ys = [], rg = [];
  for (let i = 0; i < N0; i++) if (alive[i] && find(i) === root) { newId[i] = xs.length; xs.push(NX[i]); ys.push(NY[i]); rg.push(NR[i]); }
  /* Pin every real place to its own junction, then slide that junction onto the
     place's true position, so distances between places match the real city.   */
  let places = [], hospitals = [];
  if (named) {
    const used = new Set();
    const pin = L => {
      let best = -1, bd = Infinity;
      for (let i = 0; i < xs.length; i++) {
        if (used.has(i)) continue;
        const d = (xs[i] - L.e) ** 2 + (ys[i] + L.n) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      used.add(best);
      if (bd < 1.7 * 1.7) { xs[best] = L.e; ys[best] = -L.n; }
      return { ...L, node: best };
    };
    const major = PLACES.filter(p => p.tier === 1).map(pin);
    hospitals = HOSPITALS.map(pin);
    const minor = PLACES.filter(p => p.tier !== 1).map(pin);
    const byName = new Map(major.concat(minor).map(p => [p.name, p]));
    places = PLACES.map(p => byName.get(p.name));
  }
  const edges = [];
  for (const e of kept) {
    const u = newId[e.u], v = newId[e.v];
    if (u < 0 || v < 0) continue;
    const eu = Math.hypot(xs[u] - xs[v], ys[u] - ys[v]);
    let art = e.art;
    if (named && e.cls === ROAD.ARTERIAL) {          // a highway segment is named by where it actually points
      const bearing = (Math.atan2((xs[u] + xs[v]) / 2, -(ys[u] + ys[v]) / 2) + TAU) % TAU;
      let bd = 9;
      HIGHWAYS.forEach((h, k) => { const d = angDiff(bearing, h.b * Math.PI / 180); if (d < bd) { bd = d; art = k; } });
    }
    edges.push({ u, v, cls: e.cls, art, len: eu * (1 + rnd() * 0.10) });
  }
  const g = finalizeGraph(xs, ys, edges);
  g.R = R; g.spacing = sp; g.rings = rings; g.seed = seed; g.zoneR = named ? 11 : R * .5;
  for (let i = 0; i < g.n; i++) g.nring[i] = rg[i];
  const rr = [...ringRoads].sort((a, b) => a - b);
  const nm = realRings ? ['Inner Ring Rd', 'Outer Ring Rd', 'Peripheral Ring Rd', 'Satellite Town Ring Rd']
    : ['Inner ring road', 'Middle ring road', 'Outer ring road'];
  rr.forEach((r, i) => g.ringNames.set(r, nm[i] || 'Ring road'));
  for (let e = 0; e < g.m; e++) g.noise[e] = 0.6 + rnd() * 0.8;
  for (let e = 0; e < g.m; e++) g.dice[e] = rnd();          // a fixed roll per road, for repeatable closures
  g.water = water;

  if (named) {
    g.landmarks = places; g.hospitals = hospitals;
    g.artNames = HIGHWAYS.map(h => h.name);
    g.hotspots = HOTSPOTS.map(h => ({ ...h, x: h.e, y: -h.n }));
    for (let e = 0; e < g.m; e++) {
      let s = 0;
      for (const h of g.hotspots) s += h.k * Math.exp(-((Math.hypot(g.mx[e] - h.x, g.my[e] - h.y) / h.r) ** 2));
      g.hot[e] = s;
      /* flood-proneness 0..1: close to a lake shore or a known waterlogging spot */
      let low = 0;
      for (const w of g.water) if (w.kind !== 'park') low = Math.max(low, Math.exp(-((Math.max(0, Math.hypot(g.mx[e] - w.x, g.my[e] - w.y) - w.r) / 1.1) ** 2)));
      for (const f of FLOOD_SPOTS) low = Math.max(low, Math.exp(-((Math.hypot(g.mx[e] - f[0], g.my[e] + f[1]) / f[2]) ** 2)));
      g.low[e] = low;
    }
  }
  g.d0 = new Float64Array(g.m);
  for (let e = 0; e < g.m; e++) g.d0[e] = Math.hypot(g.mx[e], g.my[e]);
  applyTraffic(g, 18.5, false);
  return g;
}

/* ------------------------------------------------------------ applyTraffic */
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const gauss = (h, mu, s) => { let d = Math.abs(h - mu); d = Math.min(d, 24 - d); return Math.exp(-(d * d) / (2 * s * s)); };

/* city-wide demand curve 0..1 for each kind of day */
function peakIntensity(h, day) {
  const light = smooth(5, 9, h) * (1 - smooth(21, 24, h));
  switch (day) {
    case 'saturday': return Math.min(1, Math.max(0.5 * gauss(h, 12.5, 2.4), 0.72 * gauss(h, 19.2, 2.2)) + light * 0.2);
    case 'sunday':   return Math.min(1, Math.max(0.3 * gauss(h, 12, 2.6), 0.6 * gauss(h, 19.5, 2.0)) + light * 0.12);
    case 'holiday':  return Math.min(1, 0.32 * gauss(h, 18.5, 3) + light * 0.1);
    case 'bandh':    return light * 0.05;
  }
  const rush = Math.max(0.88 * gauss(h, 9.2, 1.3), gauss(h, 18.4, 1.7));   // weekday: evening is the worse peak
  return Math.min(1, rush * 0.82 + light * 0.22);
}

/*  w(e) = base(e) * (1 + k * (T + S + E))
      T  time of day   peak(day, hour) * [zone * road class * noise + chronic hotspots]
      S  sky           rain intensity, worst on flood-prone roads and at peak hours
      E  events        a match, a procession, metro works, an accident ...
      k  1 normally, 0.45 when the siren clears a lane (the "green corridor")
    Conditions can also close roads (blocked = 2); roads the user closed are blocked = 1.
    Every term is >= 0, so w(e) >= base(e): the A* heuristic stays admissible in any scenario. */
function applyTraffic(g, hour, siren, cond) {
  cond = cond || {};
  const p = peakIntensity(hour, cond.day), k = siren ? 0.45 : 1;
  const rain = (SKIES[cond.sky] || SKIES.clear).rain;
  const evs = (cond.events || []).map(id => EVENTS[id]).filter(Boolean);
  const spots = [], shut = []; let local = 0, glob = 0, frac = 0;
  for (const E of evs) {
    if (E.spots) spots.push(...E.spots);
    if (E.close) shut.push(...E.close);
    local += E.local || 0; glob += E.global || 0; frac = Math.max(frac, E.closeFrac || 0);
  }
  /* closures caused by the conditions themselves */
  for (let e = 0; e < g.m; e++) if (g.blocked[e] === 2) g.blocked[e] = 0;
  if (rain >= 1) for (let e = 0; e < g.m; e++) if (!g.blocked[e] && g.low[e] * (0.7 + 0.6 * g.dice[e]) > 0.72) g.blocked[e] = 2;
  if (frac) for (let e = 0; e < g.m; e++) if (!g.blocked[e] && g.dice[e] < frac) g.blocked[e] = 2;
  for (const [x, n, count] of shut) {
    const near = [];
    for (let e = 0; e < g.m; e++) near.push([Math.hypot(g.mx[e] - x, g.my[e] + n), e]);
    near.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < count && i < near.length; i++) if (!g.blocked[near[i][1]]) g.blocked[near[i][1]] = 2;
  }
  for (let e = 0; e < g.m; e++) {
    const zone = 0.55 + Math.exp(-((g.d0[e] / g.zoneR) ** 2));
    const T = (glob ? Math.max(p, 0.85) : p) * (zone * ROAD_JAM[g.cls[e]] * g.noise[e] * 1.15 + g.hot[e]);
    const S = rain ? rain * (0.3 + 0.9 * g.low[e]) * (0.55 + 0.9 * p) : 0;
    let E = glob;
    for (const sp of spots) E += sp[3] * Math.exp(-((Math.hypot(g.mx[e] - sp[0], g.my[e] + sp[1]) / sp[2]) ** 2));
    if (local && g.cls[e] === ROAD.LOCAL && g.d0[e] < 14) E += local;
    g.cT[e] = T; g.cW[e] = S; g.cE[e] = E;
    const c = 1 + T + S + E;
    g.cong[e] = c;
    g.Wopen[e] = g.base[e] * (1 + (c - 1) * k);
    g.W[e] = g.blocked[e] ? Infinity : g.Wopen[e];
  }
  g.refresh();
}
