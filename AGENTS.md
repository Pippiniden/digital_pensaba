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
| `js/net.js` | **Online play** (serverless WebRTC data channel, manual invite / reply codes). Host-authoritative: guest sends `{type,payload}`, host runs `act()` and sends `G` + that act's FX events. Hooks in `act()`: `netAct` / `netTapOn` / `netSync` |
| `js/guide.js` | Rules guide + status help (`FX_HELP`; add a line there for each new FX key) |
| `js/records.js` | Player records (`recordMatch()` called from `win()`; 戦績 panel, reset) and saved parties (編成リスト on the setup screen). localStorage only, never in `G` |
| `js/game-ui.js` | Game screens (mode / setup / battle / result / zukan), `render()`, click handling |
| `js/editor.js`, `js/sim.js`, `js/editor-sim.js` | Editor UI; headless balance sim core; editor's balance dialog |
| `js/unit-ref.js` | **Servant baseline values** (`UNIT_REF`: HP / per-card damage / totals / 4th face / NP / stars / plain-damage ultimate power (`ult.all` AoE, `ult.one` single) per cost). Editor-only data file; the editor prints them in small text next to the inputs (`unitRefText` / `unitRefSumHTML` / `refUpdate` in editor.js). Reference only — never a warning or validation |
| `js/scenario-core.js`, `js/scenario.js`, `css/scenario.css` | **Scenario mode** (sound novel + battles): shared format / validation / storage; player (`SCN`, `#scn`) → `docs/agents/scenario.md` |
| `scenario-editor.html`, `js/scenario-editor.js`, `css/scenario-editor.css` | Scenario editor (exports one JSON) |
| `scenarios/` | `index.js` (`SCENARIO_FILES` list), scenario JSON files, `assets/` (images / audio not embedded in the JSON) |
| `js/sim-worker.js`, `js/balance*.js`, `css/balance.css` | Workers and developer-only balance lab |
| `css/base.css`, `css/buttons.css`, `css/game.css`, `css/editor.css` | Styles. **All button looks live in `buttons.css`** (principles in `docs/ui-design.md`); do not add button colours/shapes elsewhere. New blue panels layer `var(--lattice)` first |
| `img/units/{id}.webp` (+ `{id}_card.webp`) | Character images by id (not data); other assets in `img/classes`, `img/placeholder`, `img/ui`, `img/pwa` |
| `manifest.webmanifest`, `sw.js` | PWA (stale-while-revalidate, cache `pensaba-duel-v2`) |
| `tools/check.js` | Headless check (`node tools/check.js`): CPU-vs-CPU games through `act()` for every ruleset + draft; reports hangs / exceptions / `NaN`. `tools/sim/` = old one-off balance experiments |
| `tools/cpu-audit.js` | CPU decision audit (`node tools/cpu-audit.js`): CPU-vs-CPU games, counts odd decisions (ultimates fully blocked by evade / invul, attack buffs given to a unit that does not attack, unused skills…). `--vs HEAD` (or `--vs copy-of-cpu.js`) plays the working `js/cpu.js` against that version and prints the win rate; `--set "DANGER_K=.7"` overrides cpu.js tuning variables for the run |
| `tools/skill-waste.js` | Skill-waste audit (`node tools/skill-waste.js`): CPU-vs-CPU games, counts skill effects that were pointless when used (`WASTE_NOW`: 1-turn attack buff on a unit that does not attack, conditional effect with no valid target, own guard while an ally has taunt…) and effects that never got to work (`USEFUL`). Add a line to both for a new FX key |
| `tools/ref-check.js` | Baseline check (`node tools/ref-check.js`): builds test servants straight from `UNIT_REF` (cost 1–5 × B3 / B2A2 / B2Q2 / A3 / A2Q2 / Q3, same skills) and prints 3v3 win rates per cost / card mix / party make-up (target 50% ± 3%). `--set "hp.3=[600,700]"` tries other values without editing the file; `--list` prints the test servants; `-e ult` sweeps single-target / AoE ultimate power to find the single-target value that matches the AoE baseline; `--add new.json` measures a hand-made / AI-made servant dropped into the baseline field (current roster not used) |
| `submit.html`, `js/submit.js`, `js/submit-edit.js`, `js/submit-worker.js`, `css/submit.css` | **Servant submission tool** (public, no server): paste AI-written JSON → edit name / numbers / effects / lines in a compact form (`submit-edit.js`: `editFormHTML`, inputs carry `data-i` / `data-p` path / `data-t` type; text input refreshes only the check pane, structural changes rebuild that unit's form; cond / at / vs / sure are kept but not editable) → `validateUnits` against `DEFAULT_UNITS` + `refCompare` + preview (`facesTableHTML` / `skillListHTML`) → win rate via workers (`refMeasure`, 3000 games per field) → save JSON / copy a Discord post / copy a fix request for the AI. Submissions themselves go through Discord. Links `docs/llm/kit.md` |
| `js/ref-units.js` | Shared `UNIT_REF` helpers: test servants (`refUnit` / `refId` / `refEnsure` / `refPool`), `refMeasure(id,kit,n)` (one unit in the baseline field) and `refCompare(u)` (baseline comparison rows). Used by `tools/ref-check.js`, `tools/llm-pack.js`, the submission tool |
| `tools/llm-pack.js`, `docs/llm/` | **AI-made servants**: `node tools/llm-pack.js` regenerates `docs/llm/reference.md` and `docs/llm/kit.md` (the single file users give their AI = prompt body + reference + template + sheet) (baselines from `UNIT_REF`, every `FX` key with `FX_HELP`, value meaning, required fields, allowed places, and usage examples from the current non-canon roster; rerun after changing `FX` / `UNIT_REF`). `prompt.md` (instructions), `template.json` (valid cost-3 example), `sheet.md` (character sheet to fill) are hand-written. `--check new.json` validates AI output (normalize + `validateUnits` + baseline comparison). Add a `VAL` line in llm-pack.js for a new FX key with a value |
| `js/rank-summary.js`, `tools/rank-summary.js` | Strength summary (`rankSummary()`, shared): the balance lab's 要約を保存 button and `node tools/rank-summary.js <csv> -o summary.md` (from a saved CSV) both turn the per-character records (hundreds of MB as CSV) into a ~20KB Markdown an LLM can read: per-character win rate with 95% range and difference from the same-cost average, cost win rates, outliers, best / worst ally pairs and matchups (with a ±noise column, ★ = beyond noise; characters sharing a name get their cost added). No slot table: the lab orders teams by HP (`byHp`), so slot says nothing about placement. `--only id,id` limits pairs / matchups to those characters; `--min`, `--top`, `-r` |
| `presets/original/` | Not loaded by the game; frozen canon data copy |
| `docs/` | `agents/` detail docs, `llm/` AI character-making kit, `ui-design.md`, `*-sample.html` stand-alone tuning samples (not loaded by the game) |

## 3. Script load order

```
Game   (index.html) : rules → units → masters → common → engine → cpu → cutin → fx → guide → records → net → game-ui   (+ css/cutin.css)
Editor (editor.html): rules → units → masters → common → unit-ref → cutin → editor → sim → editor-sim   (+ css/cutin.css)
Worker (sim-worker.js / balance-worker.js, importScripts): rules → units → masters → common → engine → cpu → sim
Balance page (balance.html): rules → units → masters → common → rank-summary → balance
Submit (submit.html): rules → units → masters → common → unit-ref → ref-units → submit-edit → submit;  submit-worker.js: rules → units → masters → common → unit-ref → ref-units → engine → cpu → sim
Scenario: game adds (after game-ui / tapfx) scenarios/index.js → scenario-core → scenario; scenario-editor.html: rules → units → masters → common → cpu → scenario-core → scenario-editor
```
- `engine.js` calls `reloadUnits()` at load, so `common.js` and `units.js` must come first. `render()` / `fxBusy()` are resolved at run time.
- A new `.js` file goes after everything it depends on.

## 4. Core concepts (details → `docs/agents/data-model.md`, `docs/agents/rules-spec.md`)

- **Character**: `{id, name, cls, traits?, cost, hp, fit?, link?, lines, condLines?, faces[6], skills[3], ult}`. `normalizeUnit()` **drops unknown fields** — adding a field means touching `normalizeUnit`, `unitsToJS`, editor `newUnit`/`renderForm`, `validateUnits`, `units.js`.
- **Effect** `Eff = {k, t, v, turns?, times?, chance?, ...}`: `k` is a key of `FX`, `t` a key of `TARGETS` (allowed set by `TGT_BY_CTX`).
- **Runtime unit** `makeUnit()`; look up the definition with `D(id)`, a unit with `U(uid)`. Read max HP via `maxHp(u)`, never `D(u.def).hp`.
- **Rules** (`G.rule`, via `ruleset()`): `team` (3v3, cost 10), `simple` (1v1), `master` (simple + master), `mteam` (team + master, cost 13). No class matchups.
- **Phases** (`G.phase`): `mode → setup (or draft) → actRoll → [master] → skill → action → target → end → (swap) …→ over`; `guard` is a defender-side interlude in master rules.
- **Arcade** (`G.arcade`, config `ARCADE` in rules.js): 5 battles vs CPU in `team`/`mteam`. Player sets up once → phase `stage` (stage intro, `arcadeStageHTML`) → `arcadeGo` → battle → `arcadeNext` (re-creates `G`, keeps `G.arcade`) … → total result (`arcadeTotalHTML`). `G.mode` stays `'cpu'`. The `stage` screen is deliberately not auto-advanced. After a loss, `arcadeContinue` replays the same stage against the same enemy (`G.arcade.continues`, shown in the total result). The `endless` difficulty (`ARCADE.diffs[].endless`) has no stage limit and no continue; use `arcadeStages()` / `arcadeLevel()` / `arcadeEndless()` instead of `ARCADE.stages` / `levels[i]`. Enemies avoid servants / masters already met (`G.arcade.seen`) and, on the first lap only, the player's own (`arcadeAvoid`, `setupCpu{avoid}` returns `false` when that would worsen the cost match); then `seen` is cleared and `G.arcade.lap` goes up.
- **Draft** (ドラフト, `G.draft`, config `DRAFT` in rules.js): vs CPU in any ruleset; replaces the setup screen. `chooseMode{mode:'draft',level}` → phase `draft` (`draftStart` deals a random pool; sides take turns in snake order `G.draft.order`, master first in master rules, normal cost cap, a side with no legal pick is skipped) → `draftPick` … → `done` (player may reorder with `draftLead`) → `draftGo` → battle. `G.mode` stays `'cpu'`; `G.draft` is kept through the battle so `rematch` re-drafts. CPU picks in `cpuDraft` (cpu.js); screen `draftHTML` (game-ui.js), `.draft` / `.d*` (game.css).
- **Watch** (観戦, `G.mode==='watch'`, `cpu:[true,true]`, names CPU 1 / CPU 2): CPU vs CPU in any ruleset. `chooseMode{mode:'watch',level,level2}` → normal setup screen (the player picks both parties, おまかせ available) → battle. Per-CPU strength is `G.levels[pid]`; `scheduleCpu` copies it into `G.level` before each `cpuDecide()`. Not recorded (`recordMatch`).
- **Online** (`NET` in net.js, outside `G`; `G.mode` stays `'pvp'`, names ホスト / ゲスト): host = player 0, guest = player 1 (guest's screen is flipped via `netMe()`). Only the host runs the engine; the guest's `act()` is forwarded (`netAct`) and its `G` is replaced by each snapshot (`netApply`, which replays the FX events through `fxEmit`). The guest uses the host's character data for the session (`setNetData`). In game-ui.js use `otherActing()` (CPU's turn **or** the remote player's turn), not `cpuActing()`, for anything that locks input. No records while online. **Reconnect**: a drop during a match does not end it — both sides enter `NET.hold` (`netHold`; `netOn()` stays true, `netWaiting()` locks all input, `netAct` swallows everything but `restart`) and the reconnect window (`netHoldHTML`, drawn by `netNoticeHTML`) repeats the invite / reply exchange; on open the host sends `hello` + a full `netSync([])`. A guest that reloaded simply joins again as a guest; a host that reloaded comes back in hold from `saveMatch` (host only, flag `net`) via `netResumeHost`. Only an explicit leave (`restart` → `bye` without `re`) ends the match for the other side; `netDrop(msg,true)` forces an end.
- **Scenario** (`G.scn`, details → `docs/agents/scenario.md`): a story JSON (`format:'pensaba-scenario'`) with top / bottom dialogue windows, choices, flags, BGM and battles. Shown in the menu only when `scnAvail()` (a JSON listed in `scenarios/index.js`, or one imported into IndexedDB). Story state lives in `SCN` (scenario.js, outside `G`; `#scn` is not rebuilt by `render()`); a battle starts with `act('scnBattle',spec)` → `scnBegin` (rule / CPU level / enemy / locked members / selectable pool come from the scenario) and returns via `scnAfter`. Scenario-only characters are swapped in by `setScnData`.
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
| **New effect kind** | ① `FX` + `FX_GROUPS` (rules.js) ② apply in `engine.js` (`applyOne` / `mods()` readers) ③ `fxText` (common.js) ④ `FX_HELP` (guide.js) ⑤ `cpuSkillScore` (cpu.js) ⑥ `checkEffs` if needed ⑦ `VAL` in tools/llm-pack.js, then `node tools/llm-pack.js` |
| New effect target | `TARGETS`, `TGT_BY_CTX` → `resolveTargets` |
| New line scene | `LINE_KEYS` → `say(u,'key')` in engine.js |
| Turn flow / phases | `ACTIONS`, `beginTurn`/`endPhase`/`toTargetPhase`; UI `promptHTML`/`stageHTML`/`ctlHTML`; update `cpuDecide` |
| New ACTION | `ACTIONS` + `data-a` button; `cpuDecide`; add to `NET_BAN` (net.js) if the online guest must not send it; allow-list in `act()` if usable after game over; `FREE_ACTIONS` if pressable on CPU's turn |
| Damage / crit / chains | `resolveCommand`, `resolveUlt`, `resolveDamage`, `dmgMods` |
| CPU strength | `js/cpu.js` (`CPU_LEVELS`). Judge a change with `node tools/cpu-audit.js` (odd-decision counts before / after) and `--vs HEAD` (win rate) |
| Draft pool size / flow | `DRAFT` (rules.js); `draftStart` / `draftCan` / `draftSkip` + `draftPick` / `draftLead` / `draftGo` (engine.js); `cpuDraft` (cpu.js); `draftHTML` (game-ui.js) |
| Arcade stages / difficulty | `ARCADE` (rules.js); flow `arcadeStage`/`arcadeRec`/`arcadeNext`/`arcadeContinue` (engine.js); screens `arcadeStageHTML`/`arcadeTotalHTML` (game-ui.js), `.arc*`/`.astage` (game.css) |
| Screens / layout | `game-ui.js` + `game.css` |
| Online play (connection, sync, lobby screen) | `js/net.js` (`netPanelHTML` / `netUi` lobby, `netPack` / `netUnpack` codes, `netRecv` host-side validation); bump `NET_VER` when the message format or `G`'s shape changes incompatibly |
| Records / saved parties / move hints | `js/records.js` (`recordMatch`, `recordsBodyHTML`, `partyModalHTML`; load goes through `act('setupLoad')`); hints = `hintHTML` / `hintText` in game-ui.js (asks `cpuDecide()` at level `hard`; setting `pencilduel.hint`) |
| Scenario command / playback / editor | `SCN_CMDS` + `scnNormCmd` + `validateScenario` (scenario-core.js) → `scnRun` (scenario.js) → `cmdFields` (scenario-editor.js); battle hand-off `scnBegin` / `scnRandom` (engine.js) |
| Cut-in look | `cutin.css` + `cutin.js` (try in `docs/cutin-np-sample.html` first) |
| Servant baseline values shown in the editor | `UNIT_REF` in `js/unit-ref.js` (numbers only); then `node tools/ref-check.js` to see whether the costs still balance |
| Editor form / validation | `editor.js` (`renderForm`/`effRow`), `validateUnits`/`checkEffs` in `common.js` |
| Balance testing | `simGame` in `sim.js`; dialog `editor-sim.js`; lab `balance.html` (needs http, not `file://`) |

## 7. Verification

No automated tests; verify in a browser. Game: play one full match (vs CPU and 2-player), exercising what you changed. Online: open two tabs, exchange the codes between them and play (the guest tab must stay in sync); also reload one tab mid-match and reconnect through the reconnect window. Editor: edit in `editor.html` → validation panel has no errors → "apply to game" → check the mode screen. Check the console for errors. For rule changes also run the headless check: `node tools/check.js` (options: `-n 500` games per ruleset, `-r team,mteam`, `-l hard`, `--look` for the real look-ahead CPU, `--no-draft`). It loads `rules/units/masters/common/engine/cpu` into a Node `vm` with a no-op `render()`, plays CPU-vs-CPU games through `act()` in every ruleset (normal setup and draft), and exits 1 on a hang, an exception, a missing CPU move or `NaN` / `undefined` in `G.log` / HP / NP.

## 8. Caveats

- "Apply to game" goes through `localStorage` in the same browser; to publish, export `units.js` and replace `js/units.js`.
- UI text, data and logs are Japanese; many strings are hard-coded in `engine.js` `log(...)` calls.
- If applied data fails validation, `loadUnits()` falls back to default data (`broken:true`).
