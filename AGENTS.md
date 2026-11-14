# AGENTS.md — Pensaba Duel (for AI agents)

Read this first. It is a slim map; details live in `docs/agents/` and are read **only when your task touches that area**. The code is the source of truth — if a doc disagrees, fix the doc.

## 1. What this is

- Browser game **PENSABA DUEL**: 1v1 / 3v3 party battle with six-sided pencils as dice (Fate fan-made style, Japanese UI) + the **Pencil Editor** for character data.
- Static HTML + plain JS. **No build, no npm, no framework, no tests, no ES Modules** (files share globals via `<script>` order).
- Run: `python -m http.server 8765` → `http://localhost:8765/index.html` (same config in `.claude/launch.json`).
- No server/DB; persistence = `localStorage` (keys in `docs/agents/data-model.md`). Only external dependency: Google Fonts.

## 2. File map (one line each; details → `docs/agents/files.md`)

| Path | Role |
|---|---|
| `index.html` / `editor.html` / `balance.html` | Page shells (game / editor / developer-only balance lab) |
| `js/rules.js` | Rule definitions: `TERMS`, `RULES`, `RULESETS`, `FX`, `FX_GROUPS`, `TARGETS`, `LINE_KEYS`, classes, image settings |
| `js/units.js` / `js/masters.js` | Default character / master data (same format the editor exports) |
| `js/common.js` | Shared by game + editor: normalize / validate / load / save / export, HTML builders (cards, effect text) |
| `js/engine.js` | Game logic: state `G`, `ACTIONS`, damage / effect resolution, turn flow |
| `js/cpu.js` | CPU brain (`cpuDecide()` returns one move; levels in `CPU_LEVELS`) |
| `js/fx.js`, `js/cutin.js`, `css/cutin.css` | Visual effects queue (`FXQ`), Noble Phantasm cut-in (shared with the editor preview) |
| `js/guide.js` | Rules guide + status help (`FX_HELP`; add a line there for each new FX key) |
| `js/game-ui.js` | Game screens (mode / setup / battle / result / zukan), `render()`, click handling |
| `js/editor.js`, `js/sim.js`, `js/editor-sim.js` | Editor UI; headless balance sim core; editor's balance dialog |
| `js/sim-worker.js`, `js/balance*.js`, `css/balance.css` | Workers and developer-only balance lab |
| `css/base.css`, `css/buttons.css`, `css/game.css`, `css/editor.css` | Styles. **All button looks live in `buttons.css`** (principles in `docs/ui-design.md`); do not add button colours/shapes elsewhere. New blue panels layer `var(--lattice)` first |
| `img/units/{id}.webp` (+ `{id}_card.webp`) | Character images by id (not data); other assets in `img/classes`, `img/placeholder`, `img/ui`, `img/pwa` |
| `manifest.webmanifest`, `sw.js` | PWA (stale-while-revalidate, cache `pensaba-duel-v1`) |
| `presets/original/` | Not loaded by the game; frozen canon data copy |
| `docs/` | `agents/` detail docs, `ui-design.md`, `*-sample.html` stand-alone tuning samples (not loaded by the game) |

## 3. Script load order

```
Game   (index.html) : rules → units → masters → common → engine → cpu → cutin → fx → game-ui   (+ css/cutin.css)
Editor (editor.html): rules → units → masters → common → cutin → editor → sim → editor-sim   (+ css/cutin.css)
Worker (sim-worker.js / balance-worker.js, importScripts): rules → units → masters → common → engine → cpu → sim
Balance page (balance.html): rules → units → masters → common → balance
```
- `engine.js` calls `reloadUnits()` at load, so `common.js` and `units.js` must come first. `render()` / `fxBusy()` are resolved at run time.
- A new `.js` file goes after everything it depends on.

## 4. Core concepts (details → `docs/agents/data-model.md`, `docs/agents/rules-spec.md`)

- **Character**: `{id, name, cls, traits?, cost, hp, fit?, link?, lines, condLines?, faces[6], skills[3], ult}`. `normalizeUnit()` **drops unknown fields** — adding a field means touching `normalizeUnit`, `unitsToJS`, editor `newUnit`/`renderForm`, `validateUnits`, `units.js`.
- **Effect** `Eff = {k, t, v, turns?, times?, chance?, ...}`: `k` is a key of `FX`, `t` a key of `TARGETS` (allowed set by `TGT_BY_CTX`).
- **Runtime unit** `makeUnit()`; look up the definition with `D(id)`, a unit with `U(uid)`. Read max HP via `maxHp(u)`, never `D(u.def).hp`.
- **Rules** (`G.rule`, via `ruleset()`): `team` (3v3, cost 10), `simple` (1v1), `master` (simple + master), `mteam` (team + master, cost 13). No class matchups.
- **Phases** (`G.phase`): `mode → setup → actRoll → [master] → skill → action → target → end → (swap) …→ over`; `guard` is a defender-side interlude in master rules.
- **Terminology**: knocked out = `u.out` / `retreat()` shown as `TERMS.out` (戦闘不能, never 撤退). Ascension = `asc`/`ASC` shown as `TERMS.asc` (再臨) or `TERMS.ascFull` (霊基再臨); never hard-code 覚醒/再臨. Pull UI terms from `TERMS`.

## 5. Design rules (do not break)

1. **All state lives in `G`; change it only through `act(type, payload)` → `ACTIONS[type]`** (humans, CPU, future online share this path). `act()` ends with `render()`.
2. **Re-validate rules inside `ACTIONS`** (phase, turn, used…). A disabled button is not enough.
3. **UI-only state goes in `UI` (game-ui.js)**, not `G`.
4. **`render()` rebuilds `#app` every time.** Use `setHTML` / `replaceHTML` (not `innerHTML`/`replaceWith`) for anything with images; no infinite CSS animations on rebuilt elements unless synced like `syncMagicCircle` / `syncPulses`; no `loading="lazy"`. Events are delegated on `document` (`data-a` game action, `data-ui` UI action; editor `data-act` / `data-p`) — never attach listeners to elements. (→ `engine-notes.md`)
5. **Effects/animation go through `FXQ`** (`fxEmit`/`say`/`phaseFx`/`rollFx`), played by `fx.js`. Displayed HP/NP/buffs lag `G` on purpose: HP changes go through `dealDamage`; after changing NP/`fx` elsewhere call `syncU(u)`; KO paths must call `flushKo()`. (→ `engine-notes.md`)
6. Wrap user data in `esc()` in HTML; `log()` messages are HTML, so insert names via `nm()`/`dn()`.
7. The allocation lane (`allocLaneHTML` / `animateLane`) flies new cards from the portrait; `laneSeen` prevents replay.
8. **Auto-advance (`UI.auto`) only presses no-choice buttons** (`autoMove()` in game-ui.js). A new phase/button with no choice must be added there.
9. **The CPU does not know the rules.** Tune via `cpuSkillScore`, `cpuBestTarget`, `cpuAlloc`. **A new `FX` key also needs a score in the `cpuSkillScore` switch**, else it is worth 0. (→ `engine-notes.md`)

## 6. I want to… → where to edit (full table → `docs/agents/where-to-edit.md`)

| I want to… | Edit |
|---|---|
| Add/tune a character | `js/units.js` or editor export (id: half-width alnum/`_`/`-`, unique; cost ≤ `RULES.costCap`) |
| Balance numbers / terms | `RULES`, `CRIT_TABLE`, `TERMS` in `rules.js` |
| New rule variant | `RULESETS` → `ruleset()` checks in `engine.js` → `critInfo`/`setupHTML`/`modeHTML` |
| **New effect kind** | ① `FX` + `FX_GROUPS` (rules.js) ② apply in `engine.js` (`applyOne` / `mods()` readers) ③ `fxText` (common.js) ④ `FX_HELP` (guide.js) ⑤ `cpuSkillScore` (cpu.js) ⑥ `checkEffs` if needed |
| New effect target | `TARGETS`, `TGT_BY_CTX` → `resolveTargets` |
| New line scene | `LINE_KEYS` → `say(u,'key')` in engine.js |
| Turn flow / phases | `ACTIONS`, `beginTurn`/`endPhase`/`toTargetPhase`; UI `promptHTML`/`stageHTML`/`ctlHTML`; update `cpuDecide` |
| New ACTION | `ACTIONS` + `data-a` button; `cpuDecide`; allow-list in `act()` if usable after game over; `FREE_ACTIONS` if pressable on CPU's turn |
| Damage / crit / chains | `resolveCommand`, `resolveUlt`, `resolveDamage`, `dmgMods` |
| CPU strength | `js/cpu.js` (`CPU_LEVELS`) |
| Screens / layout | `game-ui.js` + `game.css` |
| Cut-in look | `cutin.css` + `cutin.js` (try in `docs/cutin-np-sample.html` first) |
| Editor form / validation | `editor.js` (`renderForm`/`effRow`), `validateUnits`/`checkEffs` in `common.js` |
| Balance testing | `simGame` in `sim.js`; dialog `editor-sim.js`; lab `balance.html` (needs http, not `file://`) |

## 7. Verification

No automated tests; verify in a browser. Game: play one full match (vs CPU and 2-player), exercising what you changed. Editor: edit in `editor.html` → validation panel has no errors → "apply to game" → check the mode screen. Check the console for errors. For rule changes also run a headless check: load `rules/units/common/engine/cpu` into a Node `vm` with a no-op `render()`, `newGame()`, loop `act(...cpuDecide())` with `G.cpu=[true,true]` for a few hundred games, and look for hangs or `NaN` in `G.log`.

## 8. Caveats

- "Apply to game" goes through `localStorage` in the same browser; to publish, export `units.js` and replace `js/units.js`.
- UI text, data and logs are Japanese; many strings are hard-coded in `engine.js` `log(...)` calls.
- If applied data fails validation, `loadUnits()` falls back to default data (`broken:true`).
