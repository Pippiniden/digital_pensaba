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
| `index.html` | Game page shell. `#app` (render target), `#fx` (effects layer), and the header whose buttons live in `#menu` (collapsed behind `#menubtn` ☰ at ≤860px; open state is `UI.menu` → `body.menuopen`) |
| `editor.html` | Editor page shell. Three columns: `#list` `#form` `#side` |
| `js/rules.js` | **Rule definitions**: terms `TERMS`, numbers `RULES`, effect kinds `FX`, targets `TARGETS`, line kinds `LINE_KEYS`, classes, image settings |
| `js/units.js` | **Default character data** `DEFAULT_UNITS` (same format the editor's "export units.js" produces) |
| `js/common.js` | **Shared by game and editor**: data normalization, validation, load/save/export, HTML/string builders (cards, effect descriptions) |
| `js/engine.js` | **Game logic**: state `G`, `ACTIONS`, damage/effect resolution, turn flow |
| `js/cpu.js` | CPU brain. `cpuDecide()` only returns the next single move |
| `js/fx.js` | Visual effects (speech bubbles, damage numbers, ultimate cut-in, phase banners, pencil-roll animation, attack-card zoom). Plays `FXQ` in order |
| `js/game-ui.js` | Game screen rendering (`render`) and input (click handling) |
| `js/editor.js` | Editor rendering, input, auto-save |
| `css/base.css` | Shared styles (CSS variables, buttons, header) |
| `css/game.css` / `css/editor.css` | Per-screen styles |
| `img/units/` | **Character images by id**: `{id}.webp` (face), `{id}_card.webp` (command card, optional). Names/extension set by `IMG_DIR` / `IMG_EXT` / `IMG_CARD_SUFFIX` in rules.js |
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
  fit?: { face:{x,y,z}, card:{x,y,z} },   // image framing set in the editor (x/y = object-position %, z = zoom %, 100–300). Defaults in FIT_DEF (common.js); omitted from export when default. Applied by unitImg() via fitStyle()
                                         // images are NOT data: img/units/{id}.webp (face) and {id}_card.webp (card, optional)
                                         // card chain: {id}_card → {id} → card.svg / face chain: {id} → face.svg (see imgCandidates)
  lines: { start, attack, extra, damage, skill, np, npDamage, defeat, win },  // each string[] (LINE_KEYS)
  faces: [ {acts:1|2|3, pre:Cmd, post:Cmd} ×6 ],   // pencil faces 1–6. pre = before ascension / post = after
                                                   // acts is IGNORED while RULES.actsTable is set (the default)
  skills:[ {name, eff:Eff[], pick?:'ally'|'enemy'|'any'} ×3 ],   // skill 3 is usable only after ascension
  ult:   { name, c:'R'|'B'|'G', eff:Eff[] } }                    // Noble Phantasm (ultimate)
```
- `Cmd`: `{c:'R'|'B'|'G', dmg, np, star, eff?:Eff[]}` (optional `eff` is applied to the attacker's side after the attack, e.g. self-cleanse; `normCmd` only keeps it when non-empty) / `{c:'W', label, eff:Eff[], dmg, np, star}` (special action; with `dmg>0` it is also a colorless attack that does not count toward chains — `eff` is applied first) / `{c:'ASC'}` (ascension face; allowed only in `pre`). R = Buster, B = Arts, G = Quick.
- `Eff`: `{k:effectKind, t:target, v:value, turns?, times?, chance?, color?}`
  - `k` is a key of `FX` in `rules.js`. `t` is a key of `TARGETS`; the allowed targets depend on where the effect lives (`TGT_BY_CTX`: skill / ult / special).
  - `chance` = succeeds on a roll ≤ N (1–5). `color` only applies to effects with `FX[k].color` (`atk`, `onAtkStar`, `onAtkNp`). Effects with `FX[k].only` are restricted to that place (`dmg` → ultimate, `copyRoll` → special action).
  - A unit without an ascension face (e.g. Mash) may leave skill 3 empty; validation skips it.
  - A lasting effect with neither `turns` nor `times` lasts forever (validation warns).
- **`normalizeUnit()` drops unknown fields.** If you add a new field to characters, follow the whole procedure in §7.

### 4.2 Runtime unit — `makeUnit()` (engine.js)
`{uid:'p{pid}u{idx}', pid, idx, def:<character id>, hp, np, asc, out, used:[bool×3], fx:[], face}`
- `fx[]` holds active effects `{k,v,color,turns,times,owner}`. `owner` is the player who applied it; its `turns` drops by 1 at the start of that player's turn.
- Look up the definition with `D(u.def)` and a unit by uid with `U(uid)`.

### 4.3 Rule constants — `RULES` (rules.js)
`costCap:10, partyMax:3, actionsMax:3, actsTable:[0,1,1,3,2,2], gaugeOnHit:10, gaugeMax:100, ultCost:100, chainR:30, chainB:20, chainG:10, critDmg:30, critDmgR:60, dot:20, dotTiming:'current'|'all'`.
- `actsTable`: action count per pencil face (index 0–5 = face 1–6), shared by all units. Set to `null` to use each face's own `acts` instead. Always read it through `faceActs(d, i)`.
- Critical: `critLevel(stars)` → level 0–7 from `CRIT_TABLE`, `critChance(level)` → % (Lv1 10 / Lv2 20 / Lv3 35 / Lv4 50 / Lv5 75 / Lv6 90 / Lv7 100; thresholds at 1/6/11/16/21/26/31 stars).
- `RULESETS` (rules.js) holds per-rule settings: `team` (3 units, d100 crit) and `simple` (1 unit, d6 crit via `CRIT_D6_TABLE` / `critNeedD6`, `npWin`, `handicapAsc:2`). The active one is `G.rule`; read it through `ruleset()` (engine.js). Party size comes from `ruleset().partyMax`, not `RULES`.
- `dot` is only the fallback damage for poison/burn effects whose value is 0 (old data).

### 4.4 Storage (localStorage)
| Key | Contents |
|---|---|
| `pencilduel.units` | Character array applied from the editor via "apply to game". If present, the game prefers it over the default data |
| `pencilduel.editorDraft` | The editor's draft (auto-saved) |
| `pencilduel.logOpen` | Whether the battle log is open |
| `pencilduel.auto` | Whether auto-advance is on (`'1'`) |

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
| `actRoll` | ② Each unit rolls its max action count from `actsTable` (0 is possible); +1 per knocked-out (戦闘不能) ally, −1 with fear, capped at 3. Allocate up to 3 in total: clicking an own servant adds one action (its card flies into the center lane), clicking a lane card removes one | `rollActs` `alloc` `setAlloc` `confirmAlloc` |
| `skill` | ③ Skills (once each per battle) and ultimate (NP ≥ 100, once per turn). Skills with `pick` wait for target selection (`G.pending`) | `useSkill` `useUlt` `cancelPick` `skillDone` |
| `action` | ④ Roll the pencil for each allocated action to decide commands. If the face is a `copyRoll` special, `G.copy` waits for the player to click another alive servant (either side); its post-ascension face is rolled and replaces the command | `rollAction` `cardClick` `toTarget` |
| `target` | ⑤ Choose the attack target (only `taunt` units if any). For an ultimate with no `t:'target'` effect (`ultNoTarget`: AoE or support), `toTargetPhase` sets `G.targetAll` so every enemy is already targeted; clicking an enemy or `resolve` fires it | `cardClick` `resolve` |
| `end` | After damage resolution. ⑦ Damage over time, star gain, turn swap | `endTurn` |
| `over` | Game decided. Only `restart` `rematch` `toggleSpeed` `useDefaultData` are accepted | |

Damage resolution (`resolveDamage`) in brief: `resolveCommand` per command in order → three same-color commands trigger a chain (R: damage +30 / B: acting units' NP +20 / G: 10 stars generated) → three actions by the same character trigger a Brave Chain (extra attack). There are no class matchups.

### 5.1 Rule source: 泥ペンサバ "Team Battle" rules

The rules follow the 泥ペンサバ wiki's チームバトルルール (3v3, total cost 10), an arrangement of the official Fate/Grand Order -SUMMON PENCIL SERVANT-, **without class matchups**. When a request says "match the rules", this is the reference.

Per command, `resolveCommand` does, in order:
1. Base damage from the face.
2. Skill modifiers via `dmgMods()`: own `atk` (color-filtered) − `atkDown` + target `defDown` − target `def` (skipped if the attacker has `ignoreDef`). Floors at 0.
3. Buster Chain +30.
4. Critical step (only if the player holds stars; never on extra attacks or ultimates): roll 1d100 ≤ `critChance(critLevel(stars) + critRoll)`. On success: damage + 30 (Buster + 60) + `critPow` total + color buffs again (color buffs count double), and NP gain / star generation ×2.
5. Final damage, unless blocked by `invul` / `evade` (`blocked()`). Overkill (target already knocked out): NP / stars ×2. Overkill and critical **stack** (×4).

Extra attack (Brave Chain): no modifiers, no critical, but evade/invul still apply.
Damage over time (`endPhase`): ignores atk/def, invul, evade and crits; blocked by `debuffImmune`. Poison and burn each don't stack (the highest value applies); `spread` doubles burn.

### 5.2 Simple rule — シンプルルール (`G.rule==='simple'`)

Chosen on the mode screen (`setRule`, plus `toggleHandicap`; both kept by `restart`/`rematch` via `keepRule()`). Same flow as the team rule, with:
- 1 servant per side (picking another replaces it); the normal CPU picks the same (or nearest) cost as the opponent.
- Critical: if the player holds stars, roll 1d6; success when roll − `critRoll` ≤ `critNeedD6(stars)` (1–6★: 2, 7–13: 3, 14–29: 5, 30+: certain). Effects of a success are the same as the team rule.
- NP win: `npWinCheck()` at the end of `beginTurn` — if the turn player's servant has NP ≥ 100 and `canUlt`, its ultimate fires (cut-in), every enemy servant's HP is set to 0 regardless of the ultimate's power (presentation only; ignores guts/invul), and that player wins (`G.winBy='np'`). The ultimate **cannot be used manually** in the skill phase (`ultManual()` is false; UI, auto-advance and CPU respect it).
- Handicap (`G.handicap`, default ON): `applyHandicap()` in `startGame` ascends the lower-cost side when the cost gap ≥ `handicapAsc`. The rule's optional "3+ cost gap → NP / attack bonus" is not implemented.

### 5.3 Effect kinds that need special handling (`FX` in rules.js)

| key | Meaning | Where it is implemented |
|---|---|---|
| `critPow` | Critical damage **+x** (additive, not a multiplier) | `resolveCommand` |
| `critRoll` | "Critical roll −x" = critical level **+x** | `resolveCommand` |
| `poison` / `burn` | DoT of value v at turn end (0 → `RULES.dot`) | `endPhase`, `dotVal` |
| `spread` | Burn damage ×2 | `endPhase` |
| `curse` | **Times only** (`timesOnly`). No NP gain when hit; each hit uses one time; reapplying adds times | `applyOne`, `dealDamage` |
| `fear` | Action count −1 | `ACTIONS.rollActs` |
| `actsUp` | Next action-count roll +x; used up on that roll (give it `times:1`) | `ACTIONS.rollActs` |
| `nullUnder` | "Nullify damage ≤ x": per attack (each command / each ultimate hit), if the final damage is ≤ x it becomes 0. Not applied to DoT | `nullified()` in `resolveCommand` / `resolveUlt` |
| `mentalImmune` / `cleanseMental` | Block / remove debuffs flagged `mental` in `FX` (currently `charm`, `fear`) | `immuneTo()` / `applyOne` |
| `drain` | "HP decrease": DoT of value v at turn end. **Stacks** (all instances add up), permanent is normal (`perm` flag, no duration warning). A debuff, so cleanse / debuffImmune apply | `endPhase` |
| `sealSkill` / `sealUlt` | Can't use skills / ultimate | `canSkill` / `canUlt` (engine), UI buttons, CPU |
| `stun` / `charm` | Can't act, use skills or ultimate | `disabled()` |
| `debuffImmune` / `buffImmune` | Blocks debuffs (incl. DoT) / buffs; consumes one time per block | `immuneTo()` in `applyOne`, `endPhase` |
| `ignoreDef` | Ignore the target's `def` | `dmgMods()` |
| `instantDeath` | HP → 0 and knocked out, **ignores guts** | `applyOne` (`doSkill` then calls `checkWin`) |
| `starLoss` | Target's master loses x stars (min 0) | `applyOne` / `changeStars` |
| `onAtkStar` / `onAtkNp` | "On attack": each damaging command (optionally only of `color`) generates x stars / gains x% NP. Not on extra attacks or ultimates | end of `resolveCommand` |
| `copyRoll` | Special-action only. Roll another servant's pencil and use its post-ascension command (rerolls if it lands on another `copyRoll`). On an extra attack the servant is picked at random. Brave Chain still counts it as the roller's action | `isCopyCmd` / `copyCands` / `doCopy` (engine), `cardClick`, CPU `cpuDecide` |

## 6. Design rules (do not break these)

1. **All state lives in `G`, and changes go only through `act(type, payload)` → `ACTIONS[type]`.** `act()` ends by calling `render()`. Humans, the CPU, and (future) online play are meant to share this path, so never mutate `G` directly outside `ACTIONS`.
2. **Always re-validate rules inside `ACTIONS`** (phase, turn, already used, etc.). Merely `disabled`-ing a button in the UI is not enough.
3. **UI-only state belongs in `UI` (game-ui.js)**, not in `G`.
4. **`render()` rebuilds `#app.innerHTML` from scratch every time.** Events are delegated on `document` (`data-a` = game action, `data-ui` = UI action; the editor uses `data-act` / `data-p`). Do not attach listeners directly to elements.
5. **Effects go through `FXQ`** (`fxEmit`/`say`), and `fx.js` plays them on `#fx`. Rule processing does not wait for effects to finish; only the CPU waits via `fxBusy()`.
   - Event types (`ev.t`): `say` (line bubble), `dmg` (damage number / "無効" text), `cutin` (ultimate), `phase` (banner over `.stage`; `big` for turn start / game end), `banner` (chain banners), `roll` (spinning pencil over a portrait, lands on `f`; shows `n` actions or the `cmd` card), `atk` (command card zooms to the stage center and flies to `tgt`), `pop` (text over a portrait, e.g. ascension), `skill` (panel over `.stage` with the skill name, user, picked target and one line per effect; emitted by `doSkill`). Any event may carry `w` to override the wait before the next one (e.g. `say(u,'attack',{w:250})` overlaps the bubble with the attack card). Helpers in engine.js: `say`, `phaseFx`, `rollFx`.
   - Pencil faces (`u.face`, the die / command badge on a portrait) are cleared for every unit in `endPhase` and at the start of `rollActs`, so a card never lingers into the next turn.
   - Knock-outs are shown late on purpose: `retreat()` (engine name for KO) sets `u.out` at once but only queues the uid in `KO_PEND`; `flushKo()` — called at the end of `resolveDamage`, `doSkill` and `endPhase`, before `checkWin` — emits one `ko` event and the `defeat` lines. Until then `stepHold` keeps the card at HP 0 but not darkened, so later attacks (overkill hits, which emit a `dmg` with `over:true`) still play on it. If you add another place that can KO a unit, call `flushKo()` after it.
   - Roll results are hidden until the roll animation lands: `rollFx(uid,f,{keys})` adds keys to `FXHIDE` (`'f:<uid>'` = the portrait's die badge / alloc control, `'r:<idx>'` = that card in the command lane); `reveal()` in fx.js deletes them and redraws. `rollBadge` / `ctlHTML` / `laneHTML` check `FXHIDE`.
   - Displayed HP lags behind `G` on purpose: a `dmg` event carries `hp0` (before), `hp` and `out` (after). `fxEmit` puts the unit into `FXHOLD` at `hp0`; `fx.js` (`stepHold`) advances it per event and redraws only that card (`redrawSvt`); when the unit has no more queued `dmg` events the hold is removed. Cards read HP / knocked-out state via `shown(u)` in `game-ui.js`. Any new code that changes HP through damage must go through `dealDamage` (or emit the same fields) or the bar will jump.
6. Always wrap user data in `esc()` when embedding it in HTML. `log()` messages are rendered as HTML, so insert names via `nm()`/`dn()`.
7. Pull on-screen terms from `TERMS` (rules.js); do not hard-code them.
8. The allocation lane (`allocLaneHTML` / `animateLane` in game-ui.js) flies newly added cards from the servant's portrait; `laneSeen` remembers which cards were already shown so a re-render does not replay it.
9. **Auto-advance (`UI.auto`, header button) only presses buttons that leave no choice**: `autoMove()` in game-ui.js (roll actions, confirm a forced allocation, finish the skill phase when no skill/ultimate is usable, roll each allocated action, attack the only possible target, end the turn). It runs only on human turns, waits for `fxBusy()`, and goes through `act()`. If you add a phase or a button with no choice, add it there too.
10. **The CPU does not know the rules.** Tune strength via `cpuSkillScore` (when to use skills), `cpuBestTarget` (attack target) and `cpuAlloc` (action allocation). When you add a new effect to `FX`, also add a score to the `switch` in `cpuSkillScore` (otherwise it counts as worth 0).

## 7. I want to… → where to edit

| I want to… | File / place |
|---|---|
| Add or tune a character (numbers / skills / lines) | `js/units.js` (or edit in the editor, export, and replace). `id` is half-width alphanumerics, `_`, `-`, unique. Cost ≤ `RULES.costCap` |
| Add or change a rule variant (party size, crit method, win conditions) | `RULESETS` in `js/rules.js` → `ruleset()` checks in `engine.js` (`resolveCommand` crit, `npWinCheck`, `applyHandicap`, setup ACTIONS) → `critInfo` / `setupHTML` / `modeHTML` in `game-ui.js` |
| Balance numbers (NP amounts, chains, crit bonus, action-count table, etc.) | `RULES` and `CRIT_TABLE` in `js/rules.js` |
| Change terminology / display names | `TERMS` in `js/rules.js` |
| Add a class | `CLASS_ICONS` in `js/rules.js` (icons in `img/classes/`). Names not in the list also work and get `extra.webp` |
| Add a new line scene | `LINE_KEYS` in `rules.js` → call `say(u,'newKey')` in `engine.js`. The editor and export read `LINE_KEYS` automatically |
| **Add a new effect kind** (e.g. a new status) | ① define it in `FX` in `rules.js` ② apply it in `engine.js` (instant effects in `applyOne`; lasting effects wherever they are read via `mods()`: `resolveCommand` / `resolveUlt` / `blocked`, etc.) ③ display text in `fxText` in `common.js` (the `default` branch uses `FX[k].name`) ④ add a score in `cpuSkillScore` in `cpu.js` ⑤ add validation to `checkEffs` in `common.js` if needed. The editor's choices are generated from `FX` automatically |
| Add a new effect target | `TARGETS` and `TGT_BY_CTX` in `rules.js` → `resolveTargets` in `engine.js` |
| Change turn flow / phases | `ACTIONS` plus `beginTurn` / `endPhase` / `toTargetPhase` in `engine.js`. On the display side: `promptHTML` / `stageHTML` (`stepNo`) / `ctlHTML` in `game-ui.js`. Update `cpuDecide` in `cpu.js` to match |
| Damage calculation / crits / chains | `resolveCommand` (normal), `resolveUlt` (ultimate), `resolveDamage` (chains), shared modifiers in `dmgMods` in `engine.js`. The CPU's estimate `estDamage` (cpu.js) reuses `dmgMods` |
| Add a new ACTION (operation) | Add it to `ACTIONS` in `engine.js` → a button with `data-a="name"` in the UI → `cpuDecide` if the CPU uses it. To accept it after the game is decided, add it to the allow-list inside `act()` in `engine.js`; to let it be pressed during the CPU's turn, add it to `FREE_ACTIONS` in `game-ui.js` (two lists with different purposes) |
| Make the CPU smarter / weaker | `js/cpu.js` (`level` is `'easy'` / `'normal'`; `easy` uses the deterministic pseudo-random `rnd01`) |
| Game screen layout / look | `js/game-ui.js` (HTML generation) + `css/game.css`. The battle screen always fits the viewport with no scrolling (`.battle` is `100%` high, field rows `minmax(0,1fr) auto minmax(0,1fr)`, lane height `--lh` scales with `vh`). Each `.svt` is a size container (`container:svt/size`, content in `.svin`); the `@container svt` rules at the end of game.css switch it to a vertical card when narrow (aspect ≤ 1), hide `.sks` when ≤150px high and `.fxs` (replaced by the `.pfx` ▲▼ counts) when ≤200px. Hidden skills are reached through the ⓘ detail modal, which holds the usable skill/ultimate buttons (`.udops`; using one closes the modal); `.canskill` makes ⓘ glow when skills are usable. Setup / mode screens still scroll on small screens |
| Effects (bubbles, numbers, cut-in, phase banners, roll, attack card) | Emit from `engine.js` (`fxEmit` / `say` / `phaseFx` / `rollFx`), play in `fxPlay` in `js/fx.js`; wait times in `FX_WAIT`; CSS in the "演出" section of `game.css` |
| Character select: sort / filter | `UI.roster` + `ROSTER_SORTS` / `rosterList` / `rosterFilterHTML` / `rosterTilesHTML` in `game-ui.js`. Field changes (`data-uif`) only redraw `.roster` (`redrawRoster`) so the search box keeps focus |
| End-of-game timing | `fxNext` in `fx.js`: when the queue empties with `G.phase==='over'`, `UI.endReady` (shows the rematch / result buttons in `promptHTML`) turns on after the VICTORY banner fades, then the result modal opens |
| Auto-advance rules | `autoMove` / `hasSkillChoice` in `js/game-ui.js` |
| Command card look / shared assets | `cmdCardHTML` / `cardLayers` in `common.js`; asset paths in `CARD_LAYERS` in `rules.js` |
| Editor form / preview | `js/editor.js` (`renderForm` / `effRow` / `renderSide`) + `css/editor.css` |
| Data validation rules (errors / warnings) | `validateUnits` / `checkEffs` in `common.js` |
| **Add a new field to characters** | `normalizeUnit` in `common.js` (otherwise it is dropped) → `unitsToJS` (export) → `newUnit` and `renderForm` in `editor.js` → `validateUnits` → existing data in `units.js` |
| Colors / fonts / shared components | CSS variables in `css/base.css` |

## 8. Verification

There are no automated tests in the repo, so verify manually in a browser. For rule changes, also consider a quick headless check: load `rules/units/common/engine/cpu` into a Node `vm` context with a no-op `render()`, call `newGame()`, then loop `act(...cpuDecide())` with `G.cpu=[true,true]` for a few hundred games and look for hangs or `NaN` in `G.log`.
- Game: open `index.html` and play one full match each in vs-CPU (easy / normal) and 2-player. Depending on your change, also exercise ultimates, ascension, chains, skill target selection, and knock-outs.
- Editor: edit in `editor.html` → confirm the "validation" panel on the right shows no errors → "apply to game" → confirm it shows up on the game's mode-select screen → "reset to default data".
- Confirm there are no console errors in the browser dev tools. To see how a broken `pencilduel.units` behaves, edit `localStorage` directly.

## 9. Known caveats

- `README.md` is practically empty; documentation is consolidated in this file.
- "Apply to game" goes through `localStorage` in the same browser. To share across devices or publish, export `units.js` and replace `js/units.js`.
- `G.phase==='init'` is only set momentarily by `setupConfirm`; `startGame()` → `beginTurn()` immediately moves to `actRoll` (there is no screen for it).
- Many Japanese strings and log messages are hard-coded in the logic (the `log(...)` calls in `engine.js`). The intent is to centralize terms in `TERMS`, but not everything has been moved there.
- The UI text, character data, and log messages in the game itself remain in Japanese; only this document is in English.
- Default roster (9 units, all at official-SPS scale: HP 400–1000, damage 10–140): アルトリア C5, エミヤ C4, ヘラクレス C4, クー・フーリン C3, メドゥーサ C3, メディア C3, 呪腕のハサン C2, 佐々木小次郎 C1, マシュ C0. No placeholder samples remain.
- Terminology: knocked out is `u.out` / `retreat()` in code and shown as `TERMS.out` = 戦闘不能 (never 撤退).
- Terminology: "ascension" in code (`asc`, `ASC`, `ascend`) is shown as `TERMS.asc` = 再臨 (short, for badges/tables) or `TERMS.ascFull` = 霊基再臨 (logs, editor explanations, detail views). Never hard-code 覚醒/再臨 in UI strings.
