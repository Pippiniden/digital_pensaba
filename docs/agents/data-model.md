# データモデル詳細

キャラ定義・実行時ユニット・ルール定数・localStorage。コードが正。

### 4.1 Character ("servant") definition — `DEFAULT_UNITS[i]` / `UNITS[i]`
```
{ id, name, cls, traits?:string[], cost, hp,   // traits = 属性 (multiple, deduped by normTraits; used by atkTrait/defTrait). Omitted from export when empty. Read at runtime via traitsOf(u)
  fit?: { face:{x,y,z}, card:{x,y,z}, np:{x,y,z}, cut:{x,y,z} },   // image framing set in the editor (x/y = object-position %, z = zoom %, 100–300). Defaults in FIT_DEF (common.js); omitted from export when default. Applied by unitImg() via fitStyle()
                                         // np = the close-up face inside the cut-in band (background-position x/y %, z = image width %, 60–300 via fitRange); used by cutinStageHTML, not fitStyle
                                         // cut = the cut-in's standing art on the right: x = shift right (% of stage width, ±30), y = shift down (% of stage height, ±30), z = size % (60–160). For art whose head hits the top
                                         // images are NOT data: img/units/{id}.webp (face) and {id}_card.webp (card, optional)
                                         // card chain: {id}_card → {id} → card.webp / face chain: {id} → face.webp (see imgCandidates)
  link?: string,   // character-setting page (http/https only, normLink). Shown as a button at the bottom of unitDetailHTML; opens in a new tab after a confirm modal (UI.linkAsk; "今後は確認しない" / header button toggles localStorage `pencilduel.linkConfirm`='0')
  lines: { start, attack, extra, damage, skill, np, npDamage, defeat, win },  // each string[] (LINE_KEYS)
  faces: [ {acts:1|2|3, pre:Cmd, post:Cmd} ×6 ],   // pencil faces 1–6. pre = before ascension / post = after
                                                   // acts is IGNORED while RULES.actsTable is set (the default)
  skills:[ {name, eff:Eff[], pick?:'ally'|'other'|'enemy'|'any', line?:string[]} ×3 ],   // other = an ally other than the user (skillPickOk / skillCands; skillUsable is false when nobody can be picked)
    // skill 3 is usable only after ascension. line = skill-specific speech, replaces lines.skill
  ult:   { name, ruby?, br?:number, c:'R'|'B'|'G', eff:Eff[], pick?:'ally'|'other'|'enemy'|'any' } }   // br = cut-in line break: unset = auto, 0 = one line, n = break after n characters (editor: 改行位置 chips under the ult; validateUnits warns when n ≥ name length)   // Noble Phantasm (ultimate). pick = same as a skill's: needed for `t:'picked'` effects (単体の味方への補助宝具など). The ult button then waits for a target click (`G.pending={uid,ult:true}`, `startUlt(u,picked)` → `G.ultPick` → `resolveUlt`); `canUlt` is false when no candidate exists. Extra target `ally_other` (味方全体・自分以外) works in skill / ult / special
```
- `wip?: true` (servants and masters; 制作中): set by the editor's 制作中 checkbox (`wipIn` in editor.js). `unitsToJS` / `mastersToJS` (common.js) skip entries with `wip`, so "js書き出し" leaves them out; "apply to game", the JSON exports and the draft still include them. Kept by `normalizeUnit` / `normalizeMaster`.
- `condLines?: [{key:LINE_KEYS key, who:'other'|'self'|'ally'|'enemy' (LINE_WHO), cond:Cond, lines:string[]}]` (条件つきセリフ; `normCondLine` in common.js, exported by `unitsToJS`, edited in the editor's 「条件つきセリフ」 section via `condIn`). `say(u,key,{other})` → `condLineFor(u,key,other)` (engine.js) uses the first entry whose `key` matches and whose condition holds (`other` = the scene's counterpart: attack target / attacker / skill target / enemy front unit at start; `ally` = another alive ally or the own master unless 瀕死; `enemy` = any alive enemy, or the whole enemy party once all are down, plus the enemy master — so "味方に<master id>がいるとき" works in the master rules). Human-readable text: `condLineText(cl,nameOf?)` (common.js) phrases it per who × scene (`CL_OTHER` names the counterpart per scene: 対象 / 相手の先頭 / 攻撃してきた相手), e.g. 「味方に黒咲恵梨佳がいる場合」「対象がランスロットの場合」; used by the 図鑑 and the editor's per-row preview (`clPrevText`, refreshed on input without a full re-render), else falls back to `lines[key]`. Skill/face `line` (own) wins over both. `COND_KINDS` also has `id` (character id, `condOk`: `s.def===v`), usable on effects too.
- Any `Cmd` may carry `line?:string[]` (face-specific speech): on an attack it replaces `lines.attack`/`extra`; on a no-damage special action or the ascension face it is said only when set. Not used when the command was copied from another servant (`cmd.from`). Picked via `say(u,key,{own})` → `pickLine(d,key,own)`.
- `Cmd`: `{c:'R'|'B'|'G', dmg, np, star, eff?:Eff[]}` (optional `eff`, e.g. self-cleanse; applied **after** the attack by default; `normCmd` only keeps it when non-empty) / `{c:'W', label, eff:Eff[], dmg, np, star}` (special action; with `dmg>0` it is also a colorless attack that does not count toward chains — `eff` is applied **before** the attack by default) / `{c:'ASC'}` (ascension face; allowed only in `pre`). R = Buster, B = Arts, G = Quick.
- `Eff`: `{k:effectKind, t:target, v:value, turns?, times?, chance?, color?, trait?, at?:'pre'|'post', max?:true, text?}` (`trait` only for effects with `FX[k].trait`: `atkTrait` / `defTrait`; required there. `max` only for `FX[k].maxOk` (`dmg`, `selfDmg`): the value becomes the target's max HP and ignores modifiers / `nullUnder` ("軽減不可"), read via `effVal(e,t)`; editor checkbox "最大HP". `text` only for `desc`)
  - `cond?:{k,v?,not?}` (any effect except `noTgt` ones; `COND_KINDS` in rules.js, `normCond` / `condText` in common.js, `condOk(c,subject)` in engine.js): the effect only works against a unit that meets the condition. `k` = `trait` (v = 属性) / `cls` (v = class) / `fx` (v = FX key, `'*debuff'` or `'*buff'`) / `hpBelow` / `hpAbove` (v = %) / `npFull`; `not:true` inverts. **Who is checked depends on the kind**: effects with `FX[k].condUse` (`atk`, `atkDown`, `def`, `defDown`) are copied onto the runtime fx with `cond` and checked at damage time against the opposing unit (`modsC` in `dmgMods`; attacker's `atk` looks at the target, the defender's `def` looks at the attacker — so "魅了状態の敵から受けるダメージ-x" = `def` + `cond:{k:'fx',v:'charm'}`). All other effects are checked in `applyEffects` against each target when applied (misses are skipped with a log line); a conditional ultimate `dmg` hits only matching targets (`resolveUlt`). The CPU (`cpuEffScore`) filters targets / needs a matching enemy. Editor: `condIn` in `effRow` (`data-act="condKind"`)
  - `sure?:true` (lasting effects only; dropped by `normEff` for instant / `noTgt` ones; editor checkbox 「解除・無効不可」): the runtime fx is not blocked by 強化無効/弱体無効/精神異常無効 (`applyOne0` skips `immuneTo`) and survives `cleanse` / `cleanseMental` / `strip`; it still ends by `turns` / `times`. Shown as ［解除・無効不可］ in `fxText`.
  - `FX[k].noTgt` (`multiHit`, `desc`): no target / chance / timing; `applyEffects` skips them.
  - `desc` (説明文): flavor only. When an effect list contains one, `effLines` / `effsText` (common.js) show only its text instead of the other effects' descriptions (skill/ult tooltips, detail views, skill panel, editor preview).
  - `at` (commands and ultimates only; ignored with a warning on skills and on `dmg`): apply before / after the attack. Unset = default from `EFF_AT_DEFAULT` (rules.js): special action → before, R/B/G command → after, ultimate → array order. Engine: `splitEffs` (commands) and `ultEffOrder` (ultimates: `pre` effects → array order of `dmg` and unset effects → `post` effects). Editor: the "タイミング" select in `effRow` (`effAtSel`).
  - `k` is a key of `FX` in `rules.js`. `t` is a key of `TARGETS`; the allowed targets depend on where the effect lives (`TGT_BY_CTX`: skill / ult / special).
  - `chance` = succeeds on a roll ≤ N (1–5). `color` only applies to effects with `FX[k].color` (`atk`, `onAtkStar`, `onAtkNp`). Effects with `FX[k].only` are restricted to that place (`dmg` → ultimate, `copyRoll` → special action / ultimate). Copy effects (`copyBuff` / `copyDebuff`, `FX[k].copy`) carry an extra `from` field (`FROM_TARGETS`: self / picked / target; allowed set by `FROM_BY_CTX`); `t` is the destination.
  - A unit without an ascension face (e.g. Mash) may leave skill 3 empty; validation skips it.
  - A lasting effect with neither `turns` nor `times` lasts forever (validation warns).
- **`normalizeUnit()` drops unknown fields.** If you add a new field to characters, follow the "Add a new field to characters" row in AGENTS.md §6.

### 4.2 Runtime unit — `makeUnit()` (engine.js)
`{uid:'p{pid}u{idx}', pid, idx, def:<character id>, hp, np, asc, out, used:[bool×3], fx:[], face}`
- `fx[]` holds active effects `{k,v,color,turns,times,owner}`. `owner` is the player who applied it; its `turns` drops by 1 at the start of that player's turn.
- Look up the definition with `D(u.def)` and a unit by uid with `U(uid)`.

### 4.3 Rule constants — `RULES` (rules.js)
`costCap:10, partyMax:3, actionsMax:3, actsTable:[0,1,1,3,2,2], gaugeOnHit:10, gaugeMax:100, ultCost:100, chainR:30, chainB:20, chainG:10, critDmg:30, critDmgR:60, dot:20, dotTiming:'current'|'all'`.
- `RULESETS.team.secondBonus`: the second player's first turn (`G.turn===2`) gives every servant +1 max actions (applied in `rollActs`; still capped at 3 total actions).
- `actsTable`: action count per pencil face (index 0–5 = face 1–6), shared by all units. Set to `null` to use each face's own `acts` instead. Always read it through `faceActs(d, i)`.
- Critical: `critLevel(stars)` → level 0–7 from `CRIT_TABLE`, `critChance(level)` → % (Lv1 10 / Lv2 20 / Lv3 35 / Lv4 50 / Lv5 75 / Lv6 90 / Lv7 100; thresholds at 1/6/11/16/21/26/31 stars).
- `RULESETS` (rules.js) holds per-rule settings: `team` (3 units, d100 crit), `simple` (1 unit, d6 crit via `CRIT_D6_TABLE` / `critNeedD6`, `handicapAsc:1`, `hcapBonus:HCAP_BONUS`) `master` (simple + a master per side, `master:true`, see rules-spec.md) and `mteam` (team + master, `mTeam:true`, `costCap:13`, see rules-spec.md). The active one is `G.rule`; read it through `ruleset()` (engine.js). Party size comes from `ruleset().partyMax`, not `RULES`.
- `dot` is only the fallback damage for poison/burn effects whose value is 0 (old data).

### 4.4 Storage (localStorage)
| Key | Contents |
|---|---|
| `pencilduel.units` | Character array applied from the editor via "apply to game". If present, the game prefers it over the default data |
| `pencilduel.editorDraft` | The editor's draft (auto-saved) |
| `pencilduel.masters` | Masters applied from the editor's master tab. If present and valid (`validateMasters(ms, units)`, incl. no id clash with servants), `loadMasters(units)` prefers it over `DEFAULT_MASTERS`; otherwise falls back with `broken:true` |
| `pencilduel.masterDraft` | The editor's master draft (auto-saved) |
| `pencilduel.editorTab` | The editor's open tab |
| `pencilduel.editorEdits` | `{units:{id:ms}, masters:{id:ms}}`: last draft edit time per character, stamped by `stampEdits()` in `saveDraft` (editor.js). Used by the "未反映の変更" dialog (`#diffdlg`, `renderDiff` / `diffLists` / `diffPaths`), which lists per-character field diffs between the draft and the game data (or `js/units.js` / `js/masters.js`) and says which side is newer by comparing these times with `pencilduel.unitsAt` / `pencilduel.mastersAt` (set on "ゲームに反映") or the file's `Last-Modified` (`checkFile`, also detects the file changing after the page was opened; needs http, unknown on `file://`) |
| `pencilduel.noCanon` | 「原作キャラを含まない」設定（既定ON、`'0'`でOFF）。ONの間、`reloadUnits()`（engine.js）が `CANON_UNIT_IDS` / `CANON_MASTER_IDS` のキャラを `UNITS` / `MASTERS` から外す（`ALL_UNITS` / `ALL_MASTERS` は全員。`D()` は両方から引く）。Worker（localStorageなし）では外さない |
| `pencilduel.logOpen` | Whether the battle log is open |
| `pencilduel.auto` | Whether auto-advance is on (`'1'`) |
| `pencilduel.simExclude` | Character ids excluded from the editor's balance test |
| `pencilduel.match` (**sessionStorage**) | The match in progress (`G`, log trimmed to 200). Saved by `saveMatch()` at the end of every `render()`, removed on the mode screen. `restoreMatch()` at page load resumes it in the same tab after any reload (mobile pull-to-refresh, the browser reloading the tab under memory pressure, going to the editor and back). Skipped if the unit source changed or a character is missing |

If the applied data has validation errors, `loadUnits()` falls back to the default data and returns `broken:true`.

