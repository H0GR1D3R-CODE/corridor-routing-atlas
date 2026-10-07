# Corridor

**An emergency-routing atlas for Bengaluru.** Finds the fastest route for an ambulance when every road's travel time depends on the day, the hour, the weather and what is happening in the city.

**Live:** https://h0gr1d3r-code.github.io/corridor-routing-atlas/

Design & Analysis of Algorithms · CIA 3 Innovative Assignment (algorithm-based prototype)
Nebin Stanly · Reg. No. 2443142 · Staff-in-charge: Dr. P. Margaret Savitha

## What it does

- **Routes on a road graph** of 832 junctions and 1,630 road segments, with 62 real places, 15 hospitals and 11 named highways positioned from approximate latitude and longitude. The street mesh between them is generated.
- **Models traffic** as `time = base × (1 + time-of-day + weather + events)`. You set the scene: weekday or weekend, the hour, rain or flood, a cricket match, a festival procession, metro works, an accident, and so on.
- **Answers two questions:** the fastest route from A to B (A\*), and the fastest hospital from an incident (multi-target Dijkstra).
- **Compares five algorithms** on the same trip: Dijkstra, A\*, Bidirectional Dijkstra, Bellman–Ford and Greedy best-first.
- **Proves itself** with ten tests that run live in the browser, and **measures itself** with a benchmark on cities from about 60 to 8,000 junctions.

## The page

| Section | What is there |
|---|---|
| Masthead | A live board: ambulances being routed to hospitals as you watch. Click one to open its dispatch. |
| 01 Problem | Inputs, outputs, constraints, chosen algorithm. |
| 02 Console | The prototype. Pick From and To, set the scene, close roads, replay the search, or open it full screen and step through it. |
| 03 Race | All five algorithms on one trip, timed in road segments examined. |
| 04 Proof | Ten executable tests. |
| 05 Lab | Interactive benchmark charts and fitted growth exponents. |
| 06 Verdict | Why A\*, and where it stops being the best choice. |

## Run it

No build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```bash
python -m http.server 5173
```

Then visit http://localhost:5173.

## Code

| File | Contents |
|---|---|
| `js/graph.js` | Places, city generation, traffic model, binary heap |
| `js/algorithms.js` | The five shortest-path algorithms and hospital dispatch |
| `js/tests.js` | The ten tests |
| `js/lab.js` | Benchmarks and the SVG charts |
| `js/plate.js` | Canvas map renderer |
| `js/race.js`, `js/theatre.js`, `js/hero.js` | The race, the full-screen replay, the live board |
| `js/app.js` | Wires the controls to the engine |

## Honest scope

Places, hospitals, lakes and highway bearings are real; the street mesh is generated. Traffic, weather and event strengths are a model with assumed values, not a live feed. Roads are two-way, with no signals or turn delays.
