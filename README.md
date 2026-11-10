# Neural Studio — bionic visual programming environment

A node-graph editor for sketching **bionic programs** in the browser: wire sensors, nuclei and
behaviours into a live simulation, then watch signals propagate. Runs entirely client-side — no
backend, no accounts, no network calls.

Built with React 19, Vite 7, TypeScript (strict), Tailwind CSS 4 and Zustand, and compiled by
`vite-plugin-singlefile` into **one self-contained `index.html`**.

![Neural Studio](https://img.shields.io/badge/build-single--file%20HTML-informational) ![tests](https://img.shields.io/badge/tests-54%20passing-brightgreen) ![license](https://img.shields.io/badge/license-MIT-blue)

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Production build → `dist/index.html` (one file, ~580 KB) |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest suite (54 tests) |
| `npm run test:watch` | Vitest in watch mode |

Requires **Node ≥ 20.19** (Vite 7's minimum).

---

## Deploying to GitHub Pages

The repo ships with `.github/workflows/deploy.yml`. Push to `main` and the workflow
type-checks, tests, builds, and publishes `dist/` to Pages.

### One-time setup

1. **Create the repo** (name it `bionic-visual-programming-environment`, or anything you like —
   nothing in the build depends on the name):

   ```bash
   git remote add origin https://github.com/USERNAME/bionic-visual-programming-environment.git
   git push -u origin main
   ```

2. **Turn Pages on** — repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.

   > This is the one step that must be done by hand. Until it's set, the deploy job fails with
   > `Get Pages site failed … Not Found`.

3. **Run it** — the push in step 1 already triggered a run. Watch it under the **Actions** tab.
   Afterwards your site is live at:

   ```
   https://USERNAME.github.io/bionic-visual-programming-environment/
   ```

4. *(Optional)* Replace `USERNAME` in the `homepage` and `repository` fields of `package.json`
   with your real GitHub username. These are metadata only — the deployed site works without it.

### Why hosting "just the index.html" doesn't work

The `index.html` in the repo root is **not** the app — it is a 484-byte Vite entry point:

```html
<script type="module" src="/src/main.tsx"></script>
```

It expects a build step to resolve TypeScript, JSX, the Tailwind pipeline and bare imports. Served
as-is by a static host, it 404s on `/src/main.tsx` and renders a blank page.

You could commit a prebuilt `dist/index.html` to the repo root and pick **Deploy from a branch →
main → / (root)** in Pages instead. That works too, but it means committing a 580 KB generated
file and rebuilding by hand on every change — so this repo uses the Actions workflow, which
rebuilds automatically.

Either way, once built the output is genuinely dependency-free: no CDN, no external font, no
fetch. Verified by loading the built page with all off-origin requests logged — there were none.

### Hosting somewhere else

`dist/index.html` is a single static file. Drop it on Netlify, Cloudflare Pages, S3, or even open
it by double-clicking. It has no server requirements.

---

## Architecture

```
src/
├── core/           Pure logic — no browser objects, fully testable in Node
│   ├── types.ts       Data model: Graph, NodeInst, Edge, Signal, Project, ModuleDef
│   ├── engine.ts      Deterministic, event-driven runtime with a simulation clock
│   ├── graph.ts       Immutable graph ops, connection validation, compounds
│   ├── registry.ts    Module registry and lookup
│   ├── packages.ts    Inference/feature packages hosted by nuclei
│   ├── project.ts     Serialisation, sanitising, share-link encoding
│   ├── library.ts     Example programs and built-in compound systems
│   ├── equation.ts    Safe expression parser, equation data and plot sampler
│   ├── util.ts        Coercion, RNG, image statistics
│   ├── core.test.ts   54 tests
│   └── modules/       The module catalogue
│       ├── sensors.ts   Vision, hearing, touch, motion, keys…
│       ├── nuclei.ts    Sense, knowledge, imagination, attention, fear, memory…
│       ├── nodes.ts     Constant, random, pulse, adder, subtractor, multiplier, divisor, math, delay…
│       ├── behavior.ts  Text, image, projector, meter, audio, haptic, notify…
│       ├── clock.ts     World Clock (Timekeeping section)
│       └── timekeeping.ts  Timer, Alarm and Stopwatch (Timekeeping section)
├── runtime/        Browser-side runtime: sensors (camera/mic/etc.), session, outputs
├── state/          Zustand store, undo/redo, localStorage persistence
├── ui/             Canvas, node views, inspector, library, dialogs, chrome
├── utils/          Small helpers
├── App.tsx         Layout, keyboard shortcuts, autosave
└── main.tsx        Entry point
```

### Timekeeping modules

The library's **Timekeeping** section holds everything about time. Every setting is also a pin.

| Module | What it does | Inputs (rising edge) | Outputs | Settings |
| --- | --- | --- | --- | --- |
| **World Clock** | Local time of any of ~6,100 cities | — | Time, Date, UTC offset, Hour, Minute, Seconds, Milliseconds | City, Format, Show seconds, Show milliseconds |
| **Timer** | Counts down from a duration | Start, Pause, Reset | Time, Done, Progress, Remaining, Running | Hours, Minutes, Seconds, Start automatically, Repeat, Show milliseconds |
| **Alarm** | Rings at a time of day in a city's (or this device's) time zone | Snooze, Dismiss | Ringing, Time left, Next ring, Seconds left, Rings | Hour, Minute, Days, City, Armed, Only once, Ring duration, Snooze |
| **Stopwatch** | Counts up, records laps, can stop at a limit | Start, Stop, Lap, Reset | Time, Elapsed, Running, Laps, Last lap | Start automatically, Show milliseconds, Stop at |

Timer and Stopwatch use *simulation* time (pause, Stop and Speed apply to them); Alarm and World Clock read the real clock.

### Execution model

Time is an explicit **simulation clock** advanced by `step(dt)` — nothing depends on
`requestAnimationFrame`, which makes the engine deterministic and reproducible in tests.

- A module runs only when a signal arrives, a wake-up it scheduled comes due, a sensor injects
  data, a command is sent, or once on start. **No polling.**
- Modules run in topological order, at most once per tick.
- Feedback loops are legal only through modules marked `delaying` (state, delay, timing); those
  back-edges deliver on the next tick. A cycle with no delaying module is reported as an
  unbounded cycle instead of silently spinning.
- Required inputs without a signal keep a module idle; optional inputs never block.

### Equations and graphs

The **Equation** node (Node category) stores one or more formulas as data. Wire its **Equation**
output into a **Meter** and the Meter draws the graph of y against x, with dimmed gray axes through
x = 0 and y = 0. Click the expand icon on the Meter for a full-size view with ticks and a legend.

- One equation per line (or separated by `;`); a leading `y =` is optional. Several lines draw several curves.
- Functions: everything the Math node offers (`abs sqrt square sin cos tanh exp log floor round ceil min max pow mod`)
  plus `tan asin acos atan atan2 sinh cosh ln log10 log2 cbrt sign trunc fract hypot clamp step saw tri sqr`.
- Constants `pi e tau phi`; operators `+ - * / ^ %`; implicit products such as `2x` and `3sin(x)`.
- `t` is simulation time in seconds, so `sin(x - 2t)` animates.
- The optional **X** input and the **y(x)** output evaluate the first equation at a point, so an Equation also works as a Math-style node.
- Parsing is done by a small hand-written evaluator — no `eval`, no `Function`. Errors name the problem.

### Honest labelling

The `packages.ts` catalogue states what each technique actually is. The dominant-colour and
sentiment packages are palette matching and lexicon counting — and the source says so, rather than
calling everything an AI model. Object recognition is the one genuinely neural option, and it is
marked `unavailable` because no model is bundled.

---

## Data & privacy

Everything is local. Programs autosave to `localStorage` (with an in-memory fallback for private
browsing, where storage throws), and sharing is a URL-encoded snapshot rather than an upload.
Sensors — camera, microphone, motion, touch — require explicit browser permission and are only
active when a sensor module is placed and the simulation is running.

The single `fetch`/XHR/eval-free source tree is easy to audit: there are no network calls anywhere
in `src/`.

---

## License

[MIT](LICENSE) © 2026 maxander08
