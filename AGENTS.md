# AGENTS.md — Pencil Duel: Spec and Structure Guide (for AI agents)

Read this file before touching the code, then use the "I want to… → where to edit" table (§7) to pick your entry point.
It was written from the code (`js/*.js`). If you find a mismatch, the code is the source of truth — fix this file too.

## 1. What this is

- A browser game, **PENCIL DUEL**: a 1v1 party battle played with six-sided pencils as dice (Fate fan-made style, Japanese UI), plus the **Pencil Editor** for editing character data.
- Static HTML + plain JavaScript. **No build, no npm, no framework, no tests.** No ES Modules either: files share globals through `<script>` load order.
- Run: `python -m http.server 8765`, then open `http://localhost:8765/index.html` (same config in `.claude/launch.json`).
- The only external dependency is Web fonts (Google Fonts). There is no server or DB; persistence is the browser's `localStorage`.

## 2. File layout

| Path | Role |
|---|---|
| `index.html` | Game page shell. Only has `#app` (render target) and `#fx` (effects layer) |
| `editor.html` | Editor page shell. Three columns: `#list` `#form` `#side` |
| `js/rules.js` | **Rule definitions**: terms `TERMS`, numbers `RULES`, effect kinds `FX`, targets `TARGETS`, line kinds `LINE_KEYS`, classes, image settings |
| `js/units.js` | **Default character data** `DEFAULT_UNITS` (same format the editor's "export units.js" produces) |
| `js/common.js` | **Shared by game and editor**: data normalization, validation, load/save/export, HTML/string builders (cards, effect descriptions) |
| `js/engine.js` | **Game logic**: state `G`, `ACTIONS`, damage/effect resolution, turn flow |
| `js/cpu.js` | CPU brain. `cpuDecide()` only returns the next single move |
| `js/fx.js` | Visual effects (speech bubbles, damage numbers, ultimate cut-in). Plays `FXQ` in order |
| `js/game-ui.js` | Game screen rendering (`render`) and input (click handling) |
| `js/editor.js` | Editor rendering, input, auto-save |
| `css/base.css` | Shared styles (CSS variables, buttons, header) |
| `css/game.css` / `css/editor.css` | Per-screen styles |
| `img/classes/` | Class icons (webp) / `img/placeholder/` placeholder images (svg) / `img/ui/` magic circle |

## 3. Script load order and dependencies

Order matters: later files use globals from earlier ones.

```
Game   (index.html) : rules → units → common → engine → cpu → fx → game-ui
Editor (editor.html): rules → units → common → editor
```

- `engine.js` calls `reloadUnits()` at load time, so `loadUnits` from `common.js` and `DEFAULT_UNITS` from `units.js` must already exist.
- `engine.js` calls `render()` and `cpu.js` calls `fxBusy()`; both are defined in later files but are resolved at run time, so this is fine.
- When adding a new `.js` file, put its `<script>` after everything it depends on.

## 4. Data model

### 4.1 Character ("servant") definition — `DEFAULT_UNITS[i]` / `UNITS[i]`
```
{ id, name, cls, cost, hp,
  img:   { face, card },                 // empty card → face; if that is also the placeholder → card.svg
  lines: { start, attack, damage, skill, np, npDamage, defeat, win },  // each string[] (LINE_KEYS)
  faces: [ {acts:1|2|3, pre:Cmd, post:Cmd} ×6 ],   // pencil faces 1–6. pre = before ascension / post = after
  skills:[ {name, eff:Eff[], pick?:'ally'|'enemy'|'any'} ×3 ],   // skill 3 is usable only after ascension
  ult:   { name, c:'R'|'B'|'G', eff:Eff[] } }                    // Noble Phantasm (ultimate)
```
- `Cmd`: `{c:'R'|'B'|'G', dmg, np, star}` / `{c:'W', label, eff:Eff[], np, star}` (special action) / `{c:'ASC'}` (ascension face; allowed only in `pre`). R = Buster, B = Arts, G = Quick.
- `Eff`: `{k:effectKind, t:target, v:value, turns?, times?, chance?, color?}`
  - `k` is a key of `FX` in `rules.js`. `t` is a key of `TARGETS`; the allowed targets depend on where the effect lives (`TGT_BY_CTX`: skill / ult / special).
  - `chance` = succeeds on a roll ≤ N (1–5). `color` only applies to `atk`. The `dmg` effect is allowed only in an ultimate.
  - A lasting effect with neither `turns` nor `times` lasts forever (validation warns).
- **`normalizeUnit()` drops unknown fields.** If you add a new field to characters, follow the whole procedure in §7.

### 4.2 Runtime unit — `makeUnit()` (engine.js)
`{uid:'p{pid}u{idx}', pid, idx, def:<character id>, hp, np, asc, out, used:[bool×3], fx:[], face}`
- `fx[]` holds active effects `{k,v,color,turns,times,owner}`. `owner` is the player who applied it; its `turns` drops by 1 at the start of that player's turn.
- Look up the definition with `D(u.def)` and a unit by uid with `U(uid)`.

### 4.3 Rule constants — `RULES` (rules.js)
`costCap:10, partyMax:3, actionsMax:3, gaugeOnHit:10, gaugeMax:300, ultCost:100, chainR:30, chainB:20, chainG:10, dot:20, dotTiming:'current'|'all'`.
The critical threshold is `critThreshold(stars)` (★30+ = guaranteed, 14+ = roll ≤4, 7+ = ≤2, 1+ = ≤1).

### 4.4 Storage (localStorage)
| Key | Contents |
|---|---|
| `pencilduel.units` | Character array applied from the editor via "apply to game". If present, the game prefers it over the default data |
| `pencilduel.editorDraft` | The editor's draft (auto-saved) |
| `pencilduel.logOpen` | Whether the battle log is open |

If the applied data has validation errors, `loadUnits()` falls back to the default data and returns `broken:true`.

## 5. Game flow (`G.phase`)

```
mode → setup (P1 party → P2 party) → [startGame: decide who goes first] → turns repeat → over
turn: actRoll → skill → action → target → end → (endPhase → swap turn → actRoll)
      └ using an ultimate goes skill → target (skips the action phase)
```
| phase | What happens | Main ACTIONS |
|---|---|---|
| `mode` | Mode select (vs CPU / 2-player) | `chooseMode` |
| `setup` | Party building (total cost ≤ 10, up to 3 units) | `setupToggle` `setupRandom` `setupCpu` `setupConfirm` |
| `actRoll` | ② Each unit rolls its max action count; allocate up to 3 in total. Retreated allies grant a bonus to action counts | `rollActs` `alloc` `setAlloc` `confirmAlloc` |
| `skill` | ③ Skills (once each per battle) and ultimate (NP ≥ 100, once per turn). Skills with `pick` wait for target selection (`G.pending`) | `useSkill` `useUlt` `cancelPick` `skillDone` |
| `action` | ④ Roll the pencil for each allocated action to decide commands | `rollAction` `toTarget` |
| `target` | ⑤ Choose the attack target (only `taunt` units if any) | `cardClick` `resolve` |
| `end` | After damage resolution. ⑦ Damage over time, star gain, turn swap | `endTurn` |
| `over` | Game decided. Only `restart` `rematch` `toggleSpeed` `useDefaultData` are accepted | |

Damage resolution (`resolveDamage`) in brief: `resolveCommand` per command in order → three same-color commands trigger a chain (R: damage +30 / B: acting units' NP +20 / G: 10 stars generated) → three actions by the same character trigger a Brave Chain (extra attack). There are no class matchups.

## 6. Design rules (do not break these)

1. **All state lives in `G`, and changes go only through `act(type, payload)` → `ACTIONS[type]`.** `act()` ends by calling `render()`. Humans, the CPU, and (future) online play are meant to share this path, so never mutate `G` directly outside `ACTIONS`.
2. **Always re-validate rules inside `ACTIONS`** (phase, turn, already used, etc.). Merely `disabled`-ing a button in the UI is not enough.
3. **UI-only state belongs in `UI` (game-ui.js)**, not in `G`.
4. **`render()` rebuilds `#app.innerHTML` from scratch every time.** Events are delegated on `document` (`data-a` = game action, `data-ui` = UI action; the editor uses `data-act` / `data-p`). Do not attach listeners directly to elements.
5. **Effects go through `FXQ`** (`fxEmit`/`say`), and `fx.js` plays them on `#fx`. Rule processing does not wait for effects to finish; only the CPU waits via `fxBusy()`.
6. Always wrap user data in `esc()` when embedding it in HTML. `log()` messages are rendered as HTML, so insert names via `nm()`/`dn()`.
7. Pull on-screen terms from `TERMS` (rules.js); do not hard-code them.
8. **The CPU does not know the rules.** Tune strength via `cpuSkillScore` (when to use skills), `cpuBestTarget` (attack target) and `cpuAlloc` (action allocation). When you add a new effect to `FX`, also add a score to the `switch` in `cpuSkillScore` (otherwise it counts as worth 0).

## 7. I want to… → where to edit

| I want to… | File / place |
|---|---|
| Add or tune a character (numbers / skills / lines) | `js/units.js` (or edit in the editor, export, and replace). `id` is half-width alphanumerics, `_`, `-`, unique. Cost ≤ `RULES.costCap` |
| Balance numbers (NP amounts, chains, poison damage, etc.) | `RULES` in `js/rules.js` |
| Change terminology / display names | `TERMS` in `js/rules.js` |
| Add a class | `CLASS_ICONS` in `js/rules.js` (icons in `img/classes/`). Names not in the list also work and get `extra.webp` |
| Add a new line scene | `LINE_KEYS` in `rules.js` → call `say(u,'newKey')` in `engine.js`. The editor and export read `LINE_KEYS` automatically |
| **Add a new effect kind** (e.g. a new status) | ① define it in `FX` in `rules.js` ② apply it in `engine.js` (instant effects in `applyOne`; lasting effects wherever they are read via `mods()`: `resolveCommand` / `resolveUlt` / `blocked`, etc.) ③ display text in `fxText` in `common.js` (the `default` branch uses `FX[k].name`) ④ add a score in `cpuSkillScore` in `cpu.js` ⑤ add validation to `checkEffs` in `common.js` if needed. The editor's choices are generated from `FX` automatically |
| Add a new effect target | `TARGETS` and `TGT_BY_CTX` in `rules.js` → `resolveTargets` in `engine.js` |
| Change turn flow / phases | `ACTIONS` plus `beginTurn` / `endPhase` / `toTargetPhase` in `engine.js`. On the display side: `promptHTML` / `stageHTML` (`stepNo`) / `ctlHTML` in `game-ui.js`. Update `cpuDecide` in `cpu.js` to match |
| Damage calculation / crits / chains | `resolveCommand` (normal), `resolveUlt` (ultimate), `resolveDamage` (chains) in `engine.js`. Keep the CPU's estimate `estDamage` (cpu.js) in sync |
| Add a new ACTION (operation) | Add it to `ACTIONS` in `engine.js` → a button with `data-a="name"` in the UI → `cpuDecide` if the CPU uses it. To accept it after the game is decided, add it to the allow-list inside `act()` in `engine.js`; to let it be pressed during the CPU's turn, add it to `FREE_ACTIONS` in `game-ui.js` (two lists with different purposes) |
| Make the CPU smarter / weaker | `js/cpu.js` (`level` is `'easy'` / `'normal'`; `easy` uses the deterministic pseudo-random `rnd01`) |
| Game screen layout / look | `js/game-ui.js` (HTML generation) + `css/game.css` |
| Effects (bubbles, numbers, cut-in) | `js/fx.js`; wait times in `FX_WAIT`; CSS in `game.css` |
| Command card look / shared assets | `cmdCardHTML` / `cardLayers` in `common.js`; asset paths in `CARD_LAYERS` in `rules.js` |
| Editor form / preview | `js/editor.js` (`renderForm` / `effRow` / `renderSide`) + `css/editor.css` |
| Data validation rules (errors / warnings) | `validateUnits` / `checkEffs` in `common.js` |
| **Add a new field to characters** | `normalizeUnit` in `common.js` (otherwise it is dropped) → `unitsToJS` (export) → `newUnit` and `renderForm` in `editor.js` → `validateUnits` → existing data in `units.js` |
| Colors / fonts / shared components | CSS variables in `css/base.css` |

## 8. Verification

There are no automated tests, so verify manually in a browser.
- Game: open `index.html` and play one full match each in vs-CPU (easy / normal) and 2-player. Depending on your change, also exercise ultimates, ascension, chains, skill target selection, and retreat.
- Editor: edit in `editor.html` → confirm the "validation" panel on the right shows no errors → "apply to game" → confirm it shows up on the game's mode-select screen → "reset to default data".
- Confirm there are no console errors in the browser dev tools. To see how a broken `pencilduel.units` behaves, edit `localStorage` directly.

## 9. Known caveats

- `README.md` is practically empty; documentation is consolidated in this file.
- "Apply to game" goes through `localStorage` in the same browser. To share across devices or publish, export `units.js` and replace `js/units.js`.
- `G.phase==='init'` is only set momentarily by `setupConfirm`; `startGame()` → `beginTurn()` immediately moves to `actRoll` (there is no screen for it).
- Many Japanese strings and log messages are hard-coded in the logic (the `log(...)` calls in `engine.js`). The intent is to centralize terms in `TERMS`, but not everything has been moved there.
- The UI text, character data, and log messages in the game itself remain in Japanese; only this document is in English.
