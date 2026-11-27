# Nicque — visual programming environment

Nicque is a node-graph editor that runs in your browser. Wire sensors, nuclei and behaviors together,
press Run, and watch the signals travel. It also comes with **Gosling**, a built-in copilot that works
offline. Everything happens on your device: there's no backend, no account, and no network traffic unless
you choose to connect an OpenAI-compatible language model.

It's built with React 19, Vite 7, TypeScript (strict), Tailwind CSS 4 and Zustand, and
`vite-plugin-singlefile` packs the whole thing into **one self-contained `index.html`**.

![Nicque](https://img.shields.io/badge/build-single--file%20HTML-informational) ![license](https://img.shields.io/badge/license-MIT-blue)

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

A few other scripts you might want:

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the Vite dev server with hot reloading |
| `npm run build` | Builds for production → `dist/index.html` (one file, ~580 KB) |
| `npm run preview` | Serves the production build locally |
| `npm run typecheck` | Runs `tsc --noEmit` |
| `npm test` | Runs the Vitest suite (54 tests) |
| `npm run test:watch` | Runs Vitest in watch mode |

You'll need **Node 20.19 or newer** (that's the minimum Vite 7 supports).

---

## Chinese typography (strict)

Chinese text is drawn with **just two typefaces**, and both are bundled into the build. Nothing is fetched
from the network and no system fonts are used.

| Interface language | `<html lang>` | Typeface |
| --- | --- | --- |
| 简体中文 | `zh-Hans` | **Noto Sans SC** |
| 繁體中文 | `zh-Hant` | **Noto Sans TC** |

* `src/ui/typography.css` is the one place every font stack is defined: the UI, the monospaced readouts, and every node face and node setting.
  No PingFang, YaHei, JhengHei, Heiti, Source Han or “Noto Sans CJK” names appear anywhere, and `src/ui/typography.test.ts` makes sure it stays that way.
* Elements with their own `lang` (the language picker, the Set Language node) get the matching face whatever the UI language is.
* The faces are variable-weight (400–700) subsets of Noto Sans SC/TC (SIL OFL 1.1). They cover every character the app uses, plus GB2312 (SC) / Big5 level 1 (TC)
  so text you type yourself is covered too. To regenerate them, run `python3 scripts/fonts/build-noto-subsets.py` (you'll need `pip install fonttools brotli`).
* The operating system draws native `title` bubbles in its own font, so `TitleTips` swaps them for an in-page tooltip that uses the app's font stack.

## Deploying to GitHub Pages

The repo includes `.github/workflows/deploy.yml`. Push to `main` and the workflow type-checks, tests and
builds the project, then publishes `dist/` to Pages.

### One-time setup

1. **Create the repo.** Name it `bionic-visual-programming-environment`, or anything you like, since
   nothing in the build depends on the name:

   ```bash
   git remote add origin https://github.com/USERNAME/bionic-visual-programming-environment.git
   git push -u origin main
   ```

2. **Turn Pages on.** Go to the repo's **Settings → Pages → Build and deployment → Source: GitHub Actions**.

   > This is the one step you have to do by hand. Until it's done, the deploy job fails with
   > `Get Pages site failed … Not Found`.

3. **Let it run.** The push in step 1 already started a run, and you can follow it under the **Actions** tab.
   When it finishes, your site is live at:

   ```
   https://USERNAME.github.io/bionic-visual-programming-environment/
   ```

4. *(Optional)* Replace `USERNAME` in the `homepage` and `repository` fields of `package.json`
   with your real GitHub username. It's only metadata, so the deployed site works fine without it.

### Why you can't just host the root `index.html`

The `index.html` in the repo root isn't the app. It's a tiny Vite entry point (484 bytes):

```html
<script type="module" src="/src/main.tsx"></script>
```

It needs a build step to handle TypeScript, JSX, the Tailwind pipeline and bare imports. If a static host
serves it as it is, `/src/main.tsx` comes back 404 and you get a blank page.

You could commit a prebuilt `dist/index.html` to the repo root and choose **Deploy from a branch →
main → / (root)** in Pages instead. That works too, but then you're committing a 580 KB generated
file and rebuilding it by hand after every change. That's why this repo uses the Actions workflow, which
rebuilds for you.

Either way, the built output has no dependencies at all: no CDN, no external font, no
fetch. We checked by loading the built page and logging every off-origin request, and there weren't any.

### Hosting somewhere else

`dist/index.html` is a single static file. Drop it on Netlify, Cloudflare Pages or S3, or just open
it by double-clicking. It doesn't need a server.

---

## Architecture

```
src/
├── core/           Pure logic. No browser objects, so it's easy to test in Node
│   ├── types.ts       Data model: Graph, NodeInst, Edge, Signal, Project, ModuleDef
│   ├── engine.ts      The deterministic, event-driven runtime with a simulation clock
│   ├── graph.ts       Immutable graph operations, connection validation, compounds
│   ├── registry.ts    Module registry and lookup
│   ├── packages.ts    Inference and feature packages hosted by nuclei
│   ├── project.ts     Saving, sanitising and share-link encoding
│   ├── library.ts     Example programs and built-in compound systems
│   ├── equation.ts    Safe expression parser, equation data and plot sampler
│   ├── calcexpr.ts    Calculus Engine: expression trees, exact derivatives, antiderivatives, simplifier and printer
│   ├── calculus.ts    Calculus Engine: integrals, limits, series, curve analysis and the `analyze` entry point
│   ├── util.ts        Coercion, RNG, image statistics
│   ├── timekeeping.ts Duration formatting, time-of-day parsing and time-zone maths for the Timekeeping modules
│   ├── decimal.ts     Arbitrary-precision decimals: parsing, formatting, rounding, exact signal values
│   ├── decmath.ts     Exact + − × ÷ mod pow √ exp ln sin cos tanh on those decimals (BigInt)
│   ├── basedata.ts    Base Data: integer/decimal/string/character/boolean/list conversion and formatting
│   ├── quantities.ts  Quantities: the SI prefixes, the unit table, <amount><unit> parsing and conversion
│   ├── core.test.ts   54 tests
│   └── modules/       The module catalogue
│       ├── sensors.ts   Vision, hearing, touch, motion, keys…
│       ├── nuclei.ts    Sense, knowledge, imagination, attention, fear, memory…
│       ├── nodes.ts     Constant, random, pulse, adder, subtractor, multiplier, divisor, math, delay…
│       ├── behavior.ts  Text, image, projector, meter, audio, haptic, notify…
│       ├── timekeeping.ts  Timekeeping section: Timer, Alarm, Stopwatch, World Clock
│       ├── basedata.ts     Base Data section: Integer, Decimal, String, Character, Boolean, Array / List
│       ├── quantities.ts   Quantities section: one module per kind of quantity (Time, Length, Pressure…)
│       └── engines.ts      Engines section: the Calculus Engine (any number of expressions and parameters, one setting pin each)
├── runtime/        Browser-side runtime: sensors (camera, mic and so on), session, outputs
├── state/          Zustand store, undo/redo, localStorage persistence
├── ui/             Canvas, node views, inspector, library, dialogs, chrome
├── utils/          Small helpers
├── App.tsx         Layout, keyboard shortcuts, autosave
└── main.tsx        Entry point
```

### How execution works

Time is an explicit **simulation clock** that moves forward with `step(dt)`. Nothing depends on
`requestAnimationFrame`, so the engine is deterministic and easy to reproduce in tests.

- A module only runs when a signal arrives, a wake-up it scheduled comes due, a sensor injects
  data, a command is sent, or once at the start. **There's no polling.**
- Modules run in topological order, at most once per tick.
- A feedback loop is only allowed if it goes through a module marked `delaying` (state, delay, timing). Those
  back-edges deliver on the next tick. If a cycle has no delaying module, it's reported as an
  unbounded cycle instead of quietly spinning.
- A required input with no signal keeps a module idle, while optional inputs never block it.

### Equations and graphs

The **Equation** node (in the Node category) stores one or more formulas as data. Wire its **Equation**
output into a **Meter** and the Meter draws the graph of y against x, with dimmed gray axes through
x = 0 and y = 0. Click the expand icon on the Meter for a full-size view with ticks and a legend.

- Write one equation per line (or separate them with `;`). A leading `y =` is optional, and several lines draw several curves.
- Functions: everything the Math node offers (`abs sqrt square sin cos tanh exp log floor round ceil min max pow mod`)
  plus `tan asin acos atan atan2 sinh cosh ln log10 log2 cbrt sign trunc fract hypot clamp step saw tri sqr`.
- Constants are `pi e tau phi`, operators are `+ - * / ^ %`, and implicit products like `2x` and `3sin(x)` work too.
- `t` is simulation time in seconds, so `sin(x - 2t)` animates.
- The optional **X** input and the **y(x)** output evaluate the first equation at a point, so an Equation can also act like a Math-style node.
- A small hand-written evaluator does the parsing, with no `eval` and no `Function`. Errors name the problem.

### Exact decimals

Numbers keep every digit you give them. Nothing in the data flow rounds to a fixed number of places. That only
happens in the **Number Formatter**, and only when you ask for it.

* **Decimal** carries any number of digits on its *Decimal* pin as well as on *Text*. `3` + `0.14159265` through an **Adder** is `3.14159265`, and `0.1 + 0.2` is `0.3`.
* **Adder, Subtractor, Multiplier, Combine, Counter, Compare, Threshold, Plastic Nerve, Inverter** and the exact functions of **Math** (`abs square floor round ceil min max mod`, and `pow` with a whole exponent) are exact, so every digit of the answer is kept.
* **Divisor** and the endless functions of **Math** (`sqrt sin cos tanh exp log`, `pow` with a fractional exponent) are worked out to a **Precision** setting (50 significant digits by default, up to 1000) and rounded once, correctly, at the last digit. A quotient that ends (`1 ÷ 8`) is exact and never padded.
* The settings of the arithmetic nodes (Offset, Factor, Divisor, Threshold, Step…) take any number of digits too, and so do values arriving on their setting pins.
* **Projector, Text, the inspector and the pin tooltips** show every digit. A Projector only rounds if you pick *Integer*, *2 decimals* or *Percent*.
* On a wire, a number is a plain JS number whenever a double can hold it exactly (`0.5`, `42`, `0.3`), so every other module keeps working. When it needs more digits, it's an exact decimal (`src/core/decimal.ts`). The arithmetic lives in `src/core/decmath.ts` (BigInt, no dependencies).
* The Quantities section and the Unit Converter still tidy results to 12 significant digits, because their unit factors (°F, degrees of arc, light-years) aren't finite decimals. Modules that sample in floating point (Wave, Smooth, Envelope, Random, the Equation plotter) send out their double unrounded.

### Honest labelling

The `packages.ts` catalogue says what each technique really is. The dominant-color and
sentiment packages are palette matching and lexicon counting, and the source says so instead of
calling everything an AI model. Object recognition is the one genuinely neural option, and it's
marked `unavailable` because no model is bundled.

---

## Data and privacy

Everything stays on your device. Programs autosave to `localStorage` (with an in-memory fallback for private
browsing, where storage throws), and sharing means a URL-encoded snapshot, not an upload.
Sensors (camera, microphone, motion, touch) need your explicit permission in the browser, and they're only
active when a sensor module is on the workspace and the simulation is running.

The source tree has no `fetch`, XHR or `eval`, which makes it easy to audit: there are no network calls anywhere
in `src/`.

---

## License

[MIT](LICENSE) © 2026 maxander08
