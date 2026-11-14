# ルール・効果仕様

各ルール(チーム/シンプル/マスター/マスターチーム)と特殊効果の挙動。コードが正。

```
mode → setup (P1 party → P2 party) → [startGame: decide who goes first] → turns repeat → over
turn: actRoll → skill → action → target → end → (endPhase → swap turn → actRoll)
      └ using an ultimate goes skill → target (skips the action phase)
```
| phase | What happens | Main ACTIONS |
|---|---|---|
| `mode` | Mode select (vs CPU / 2-player) | `chooseMode` |
| `setup` | Party building (total cost ≤ 10, up to 3 units). On the CPU's side "おまかせ" has two buttons: `setupCpu {how:'same'}` (same cost as the opponent; team: same total cost and size, nearest if impossible, `setupMsg` says so) and `{how:'random'}` (= `setupRandom`). Master rules add `setupRandom {only:'svt'}` (keep the master) / `{only:'master'}` (keep the servants; team: a master that fits the remaining cost). "← 戻る": P2 → P1 (`setupBack`, picks are kept), P1 → mode screen (`restart`). Each roster tile has an ⓘ (`.tinfo`, `data-ui="sinfo"` → `UI.sinfo` → `sinfoModalHTML`) | `setupToggle` `setupRandom` `setupCpu` `setupBack` `setupConfirm` |
| `actRoll` | ② Each unit rolls its max action count from `actsTable` (0 is possible); +1 per knocked-out (戦闘不能) ally, −1 with fear, capped at 3. **Actions must be used up**: the total must equal `requiredAlloc()` = min(3, sum of max actions); `confirmAlloc` / `setAlloc` refuse anything else and the 決定 button stays disabled. Clicking an own servant adds one action (its card flies into the center lane), clicking a lane card removes one | `rollActs` `alloc` `setAlloc` `confirmAlloc` |
| `skill` | ③ Skills (once each per battle) and ultimate (NP ≥ 100, once per turn). Skills with `pick` wait for target selection (`G.pending`). A chosen ultimate can be undone **within this phase** (`cancelUlt`: NP before use is kept in `G.ultNp` and added back; the ult button of the chosen unit becomes "取消"). Undo never crosses a phase | `useSkill` `useUlt` `cancelUlt` `cancelPick` `skillDone` |
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

The command's own `eff` is split by `splitEffs`: "before" effects run before step 1, "after" effects after step 5 (see `at` in data-model.md). Ultimates apply their effects in `ultEffOrder` (before → array order → after).

Extra attack (Brave Chain): no modifiers, no critical, but evade/invul still apply.
Damage over time (`endPhase`): ignores atk/def, invul, evade and crits; blocked by `debuffImmune`. Poison and burn each don't stack (the highest value applies); `spread` doubles burn.

### 5.2 Simple rule — シンプルルール (`G.rule==='simple'`)

Chosen on the mode screen (`setRule`, plus `toggleHandicap`; both kept by `restart`/`rematch` via `keepRule()`). Same flow as the team rule (including using the ultimate manually in the skill phase), with:
- 1 servant per side (picking another replaces it). The CPU's "おまかせ（同コスト）" picks the same (or nearest) cost as the opponent.
- Critical: if the player holds stars, roll 1d6; success when roll − `critRoll` ≤ `critNeedD6(stars)` (1–6★: 2, 7–13: 3, 14–29: 5, 30+: certain). Effects of a success are the same as the team rule.
- Win only by knocking out the enemy servant. (The old "NP 100% at turn start = ultimate win" rule was removed.)
- Handicap (`G.handicap`, default ON): `applyHandicap()` in `startGame` ascends the lower-cost side when the cost gap ≥ `handicapAsc` (1). On top of that, `hcapBonus` (= `HCAP_BONUS` in rules.js, a table sorted by `gap`) is looked up with the row of the largest `gap` ≤ the cost gap and sets `G.hcap` = `{pid,atk,np,hp}`: that side's servant gets attack damage +`atk` (added in `dmgMods`), NP gained from attacks / hits / Arts chain ×(100+`np`)% (`npRate`) and max HP +`hp` (added in `maxHp`; current HP is raised by the same amount at start). Table: gap2 atk+20/NP+10%, gap3 atk+30/NP+20%/HP+100, gap4+ atk+70/NP+30%/HP+150. Not an fx (cannot be stripped); shown as a chip via `hcapText`; rule text from `hcapRuleText` / `hcapTierText` (common.js, shared by game / editor / balance lab / tutorial in guide.js).
- Normal-attack AoE (`aoeNormal` fx, rules.js `FX`, group 攻撃強化): while a unit has it (`turns`/`times` as usual, e.g. `{k:'aoeNormal',t:'self',v:0,turns:3}`), `attack()` in engine.js treats its command attacks as AoE exactly like a face's `aoe` effect (hits every living enemy; NP / stars / on-attack effects only once; crit / evade / invul per target; enemy master not hit). NP / skill damage is unaffected; no effect in 1v1. Text in `fxText` (common.js), help in `FX_HELP` (guide.js), CPU score in cpu.js. Not used by any unit yet.
- Percent attack buff/debuff (`atkPct` / `atkPctDown`, rules.js `FX`; value = %, `color` / `cond` work like `atk`): `dmgMods()` returns `pct` (= Σ`atkPct` − Σ`atkPctDown`) and `applyPct(d,pct)` (engine.js) multiplies by (100+pct)% after the flat `atk`/`atkDown` mods and the Buster chain, before critical bonuses (command attacks in `attackHit`), after `npPow` for NP damage (`resolveUlt`), and for master attacks (`masterAtkDmg`). Several % effects add up (never below 0%). cpu.js estimates use `applyPct` too. Used by no unit yet; `hangaku` (HP 600, command damage +10 vs. the old data) NP now has no damage effect: 3T attack +50 / crit power +30 / `aoeNormal`, with a self `defDown` 30 as the drawback (no attack debuff).

### 5.4 Master rule — マスタールール (`G.rule==='master'`, `masterRule()`)

Simple rule + one master (泥ペンマス) per side. Setup picks a servant (`setupToggle`) and a master (`setupMaster`, `G.mpicks`); CPU "おまかせ（同コスト）" matches servant+master total cost. Handicap uses the total (`sideCost`).
- Master data (`normalizeMaster` in common.js): `{id,name,cls:'マスター',cost,hp,master:true,lines:{support,attack,spell}(MASTER_LINE_KEYS),faces:[{label,eff,line?}×6],spells:[{name,eff,line?}×3]}`. Master speech: `say(m,'support'|'attack'|'spell',{own:face.line|spell.line})`; the editor's master form has a セリフ section plus per-face / per-spell 専用セリフ. Effects use `TGT_BY_CTX.master` (`svt` 自軍サーヴァント, `self` the master, `ally_all` incl. master, `enemy_all` (enemy servants only, labelled 敵サーヴァント全体 via `mTLabel`), `enemy_both` (敵全体: servants + enemy master; `dmg` is split into `enemy_all` + `enemy_master` in `masterEffects` so the master can still be guarded), `ally_svt` 選んだ自軍1騎 (all master rules, support and spells; picked like `enemy_svt` via `pickSide` / `supPickSide`), `enemy_svt` 選んだ敵1体, `enemy_master`, `master` stars). `enemy_svt` needs a pick: `G.spellPick={i,now?,use?,sup?,side}` waits for a click on an enemy servant (`pickSide` / `pickOk` / `pickCands`); support faces roll first, then `masterSupportPick` (cannot be cancelled), spells go through `masterSpell` / `masterSpellUse` with `uid`. `dmg` is allowed there as fixed damage (`fixedHit`). `D()` looks up `UNITS` then `MASTERS`.
- Runtime master: `makeMaster()` → `G.players[pid].master` (uid `p{pid}m`, same shape as a unit so fx/damage code is shared). It is **not** in `party`/`alive()`/`ALL()`; use `ALLM()` / `U()` / `masterOf(pid)`. `m.out` = 瀕死. Damage to a master goes through `dealDamage` → `masterHit` (at HP 0: 瀕死, own servant takes the master's max HP as damage).
- Flow: `actRoll → master → skill → …`. `G.phase==='master'` (once per turn, `G.mastered`): `masterSupport` (roll a face, effects get `tmp` and are removed in `endPhase` = this turn only), `masterAttack {to:'master'|'svt'}` (cost × `masterAtk.master`(20) / `.svt`(10), blocked by the target master's `evac`), `masterSpell` (declare: `P.spell='decl'`, skip to `endPhase`; next master phase `masterSpellUse {i}`) or `masterSpell {now,i}` (pay `spellNowStars`=16★, no skip), `masterEvac` (`P.evac` until that player's next `beginTurn`). 令呪 needs ≥1 action this turn (`canDeclareSpell`), once per game (`P.spell`).
- `G.phase==='guard'` (actor = the defender, `actor()` in cpu.js): `G.guard.kind==='spell'` → master-on-master attack can be voided with the defender's unused 令呪; `'svt'` → a servant attack (or single-target ult) aimed at the enemy master (`masterTargetable()`, not while taunt) lets the defender take it on the servant or the master (`guard {to}`).
- Enemy-all ult damage also hits the enemy master unless evacuated (no invul/evade). Ally-all effects also reach the own master.
- Action count: +1 from `G.turn>=lateBonus` (6 = 3rd round, second player) and +1 after a turn with 0 actions (`P.zeroNext`).
- Non-damage ult (no `dmg` effect): used in the skill phase immediately, costs one allocated action, `G.ultDone`, then normal action phase.
- CPU: `cpuMaster` / `cpuGuard` (cpu.js); it never aims servant attacks at the master (the defender would pick the better side anyway). Log phase numbers go through `PN()`.
- Spell state: `P.spellLeft` (画 left), `P.spellUsed[i]`, `P.spell==='decl'` (master rule declaration only). `canGuardSpell(pid)` / `canDeclareSpell()`. Support/spell effects go through `masterEffects()`, which turns `dmg` on `enemy_master` into a `guard` (kind `spell`) when the defender can still spend a 画.

UI notes: in the master rule (not mteam) the master is drawn as a card beside the servant (`masterCardHTML`, `.svts.withm`); mteam keeps the `.mchip`. Every `.svt` carries a `<i class="glow gl-…">` frame (`glowHTML`): green = evade/invul, blue = buff, red = debuff, cycling green→blue→red when several apply (phase synced via `PULSES`). On ≤860px the NP gauge label (`.npl`) is hidden.

### 5.5 Master team battle — マスターチームバトル (`G.rule==='mteam'`, `mTeam()`)

`RULESETS.mteam`: team rule (3 servants, d100 crit, KO bonus) + a master, total cost ≤ `costCap` 13 **including the master** (`costCap()` / `mcost(pid)` in setup, `setupMaster` refuses an over-cap master; CPU おまかせ enumerates master × servant combos). Everything in the Master rule section applies except:
- Master phase is only `masterSupport` and `masterSpell {i}` (`masterAttack` / `masterEvac` are refused). 令呪: `spells` = 3 画, each effect once (`P.spellUsed`), used immediately at the cost of one allocated action; unusable when any alive servant rolled 0 actions (`canDeclareSpell`). Guarding with a 画 against master-targeted damage still works.
- **Master cost bonus** (`RULESETS.mteam.costBonus = {base:3, atk:5, hp:50}`): every own servant gets `(masterCost-3)×5` attack damage and `(masterCost-3)×50` max HP (negative for masters cheaper than 3). It is **not an fx**: `costBonus(u)` is added in `dmgMods` (attack sum) and `maxHp()`, and `startGame` sets the starting HP to `maxHp`, so strip/cleanse/`atkVs` never touch it. Shown as a chip (`costChip` in game-ui) and one log line at start. The 3 only works with servants' total cost = 13 − master cost.
- Masters cannot be targeted by servant attacks (`masterTargetable()` → null), are not hit by enemy-all ults, and ignore debuffs (`applyOne`). Ally-all buffs still reach them.
- 令呪 with a `svt` (自軍サーヴァント) effect target **one chosen servant** in this rule (`spellPicks(s)`): `masterSpell {i}` without `uid` sets `G.spellPick` and waits for a click on an own servant (`cardClick` → `masterSpell {i,uid}`; `cancelPick` clears it); the action and 画 are spent only after the pick. `resolveTargets('svt', picked)` returns just the picked unit. Display text via `spellTgt` / `spellText`. CPU (`spellBest` in `cpuMaster`) scores each spell × each ally and passes `uid`. 補助 effects with `svt` still hit all own servants.

### 5.3 Effect kinds that need special handling (`FX` in rules.js)

| key | Meaning | Where it is implemented |
|---|---|---|
| `critPow` | Critical damage **+x** (additive, not a multiplier). Optional `color`: only counts when the critting command is that color (`mods(att,'critPow',cmd.c)`) | `attackHit` |
| `critRoll` | "クリティカル率アップ" (was クリティカルロール-) = critical level **+x**; pair of `critDown` (クリティカル率ダウン) | `resolveCommand` |
| `buffDown` | 強化成功率ダウン: when the holder applies a buff (`FX[k].buff===true`) to an **ally/self**, the `chance` threshold N becomes N−x (0–6; "必ず" counts as 6, so any `buffDown` can make it fail). One use consumed per effect. Shares `debuffRate` / `applyEffects` with `debuffUp`/`debuffDown` | `debuffRate` / `applyEffects` |
| `debuffUp` / `debuffDown` | 弱体成功率アップ／ダウン: when the holder applies a debuff (`FX[k].buff===false`) to an **enemy**, the `chance` roll threshold N becomes N+up−down (0–6; "必ず" counts as 6, so only `debuffDown` can make it fail; `debuffUp` only helps effects with `chance`). One use is consumed per effect (not per target). Not for self/ally targets or instant effects | `debuffRate` / `applyEffects` / `chanceRoll` |
| `critMult` | "Crit multiplier": on a crit, damage becomes (damage before the crit step) × x% **instead of** +30/+60 and the color-buff doubling; `critPow` is still added after. Highest value wins. NP / stars keep the normal crit ×2 | `resolveCommand` |
| `healBlock` | Debuff: blocks `heal` and `regenHp` (not the HP gained from `maxHp`) | `applyOne`, `endPhase` |
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
| `debuffImmune` / `buffImmune` | Blocks debuffs (incl. DoT) / buffs; consumes one time per block. Optional `vs` (FX key; debuff for debuffImmune, buff for buffImmune) limits it to that one status (e.g. 毒だけ無効); unset = all. DoT is checked per component (poison / burn / drain) | `immuneTo()` in `applyOne`, `endPhase` |
| `ignoreDef` | Ignore the target's `def` | `dmgMods()` |
| `instantDeath` | HP → 0 and knocked out; **guts still triggers** (see `guts`) | `applyOne` (`doSkill` then calls `checkWin`) |
| `guts` | When HP reaches 0 the unit is **not** knocked out: it stays at HP 0 (`gutsHold`, marks the fx `fired`) until the current sequence ends (damage phase, skill, end phase, master action), so further hits on it are normal hits, **not overkill**. `settleGuts()` (first thing in `flushKo`) then removes the guts and sets HP to its value; a unit left at HP ≤ 0 without guts (e.g. stripped meanwhile) is knocked out there | `dealDamage`, `gutsHold` / `settleGuts` |
| `multiHit` | 連続攻撃 (special / R-B-G command eff, or ultimate). The command's attack runs v times (max 10, `hitsOf(effs)`); each hit is a full `attackHit` (modifiers, crit roll, evade/invul, NP / stars, on-attack effects, buffs with `times` consumed per hit). On an ultimate every `dmg` effect is repeated v times. CPU estimates multiply by `hitsOf` | `resolveCommand` → `attackHit`, `resolveUlt` |
| `selfDmg` | 自傷: instant fixed damage to the target (usually self; no modifiers / invul / evade / NP). Usable anywhere (command eff = default after the attack; `at:'pre'` can knock the attacker out before it attacks). `max` = target's max HP | `applyOne` |
| `npPow` / `npPowDown` | Ultimate damage +x / −x per `dmg` effect per hit (additive like `atk`), consumed per hit | `resolveUlt`, CPU `ultPower` / `estDamage` |
| `cleanse` / `strip` + `vs` | Optional `vs` (an `FX` key; debuff for cleanse, buff for strip) limits it to that one status; unset = all. Which kinds take `vs` and which side it must be: `VS_KINDS` / `vsOk` (rules.js) | `applyOne0` |
| `stripImmune` / `deathImmune` / `npDownImmune` / `starLossImmune` | Buffs that block 強化解除 / 即死 / NP減少 (`np` with v<0) / スター消失; one `times` consumed per block. The last two only block effects from the enemy side. Checked right after `immuneTo` in `applyOne0`. Listed in `MSHEET.limit2` | `applyOne0` |
| `desc` | Description override (no effect) — see data-model.md | `effLines` (common.js) |
| `hitNpSeal` | Like `curse` (no NP gain when hit, incl. 被ダメージ時NP) but takes `turns` and/or `times` (a use is consumed per block only if `times` is set). Both go through `npSealFx(u)` | `dealDamage`, `hitEffects` |
| `starLoss` | Target's master loses x stars (min 0) | `applyOne` / `changeStars` |
| `onAtkStar` / `onAtkNp` | "On attack": each damaging command (optionally only of `color`) generates x stars / gains x% NP. Not on extra attacks or ultimates | end of `resolveCommand` |
| `regenHp` / `regenNp` / `regenStar` | "ターン開始時": at the start of the owner's turn (`turnStartEffects` in `beginTurn`, before turn counts drop), alive units of `G.cur` heal (up to `maxHp`), gain NP, and add stars straight to the hand (usable that turn) | `beginTurn` |
| `atkVs` | Attack +x when the target has the debuff named by the effect's extra field `vs` (an `FX` key with `buff:false`; unset = any debuff). `vs` is kept by `normEff`, copied onto the runtime fx, and edited via the "弱体" select in `effRow` | `dmgMods()` |
| `counter` | Each time the unit takes an attack hit (command or ultimate; `dealDamage(...,true,{att})`), the attacker takes x fixed damage (no modifiers / invul / evade / NP). An attacker knocked out by it stops: its remaining commands, Brave Chain and the rest of its ultimate are skipped | `dealDamage`, `resolveDamage`, `resolveUlt` |
| `onHitNp` / `onHitStar` | "被ダメージ時": once, in the end phase of a turn in which the unit was an attack target (`u.tgtd`, set in `resolveDamage` / `resolveUlt` even if evaded): NP +x (a `curse` blocks it and uses one time) / stars via `gainStars` | `hitEffects` in `endPhase` |
| `maxHp` | Max HP +x; HP also rises by x when applied. Read max HP via `maxHp(u)` (engine.js; UI bars, `heal`, CPU `hpR`), never `D(u.def).hp` for a runtime unit. `clampHp` lowers HP when it expires (`beginTurn`) or is stripped | `applyOne`, `maxHp` / `clampHp` |
| `critDown` | Debuff on the attacker: crit level −x (simple rule: die roll +x, and the 30★ "certain" no longer applies) | `resolveCommand` |
| `cardConv` | Requires `color`. Converts an R/B/G command rolled in `rollAction` to that color (one time per conversion; not on extra attacks or copied commands) | `ACTIONS.rollAction` |
| `buffExtend` | Instant: the target's buffs that have `turns` get +x turns | `applyOne` |
| `skillCharge` | Instant: resets up to x used skills of the target (lowest index first). `doSkill` marks the skill used **after** applying effects so it never resets itself; skills that contain `skillCharge` are never reset (prevents two units resetting each other forever) | `applyOne`, `doSkill` |
| `atkTrait` / `defTrait` | 特攻 / 特防: attack +x when the target's `traits` include `e.trait` / damage taken −x when the attacker's `traits` include it. `defTrait` is skipped by `ignoreDef` like `def`. `trait` is copied onto the runtime fx. Validation warns when no servant has that trait (`traitUseCheck`) | `dmgMods()` |
| `copyBuff` / `copyDebuff` | Copy all buffs (debuffs) of `from` (one unit: self / picked / attack target) onto each `t` target with the same value, remaining turns and times. Each is applied through `applyOne0`, so buff/debuff immunity is checked one by one; `sure` and master-aid `tmp` effects are not copied | `applyEffects` (resolves `from`), `applyOne0` case `copyBuff` |
| `copyRoll` | Special action or ultimate. Roll another servant's pencil and use its post-ascension command (rerolls if it lands on another `copyRoll`). On an extra attack the servant is picked at random. In an ultimate (`ultCopyRoll`) the pencil of the unit chosen by `ult.pick` is rolled (random if none), the command is used on the attack target with `noGain` (no NP/stars); an ult with `copyRoll` needs an attack target (`ultNoTarget`). Brave Chain still counts it as the roller's action | `isCopyCmd` / `copyCands` / `doCopy` (engine), `cardClick`, CPU `cpuDecide` |

