# AGENTS.md — Pencil Duel 仕様・構造ガイド（AIエージェント向け）

コードを触る前にこのファイルを読み、「やりたいこと → 触るファイル」の表（§7）で入口を決めてください。
内容はコード（`js/*.js`）から起こしたものです。食い違いを見つけたらコードを正とし、このファイルも直してください。

## 1. これは何か

- ブラウザで遊ぶ、鉛筆(6面ダイス)を使った1対1のパーティ戦闘ゲーム「**PENCIL DUEL**」（Fate二次創作風・日本語UI）と、キャラデータを編集する「**ペンシルエディタ**」。
- 構成は静的HTML + 素のJavaScript。**ビルド・npm・フレームワーク・テストは無い**。ES Modulesも使わず、`<script>`の読み込み順でグローバル変数を共有する。
- 起動: `python -m http.server 8765` を実行し `http://localhost:8765/index.html`（`.claude/launch.json` に同じ設定あり）。
- Webフォント(Google Fonts)のみ外部依存。サーバー・DBは無く、保存先はブラウザの `localStorage`。

## 2. ファイル構成

| パス | 役割 |
|---|---|
| `index.html` | ゲーム画面の土台。`#app`(描画先)と`#fx`(演出レイヤー)だけ持つ |
| `editor.html` | エディタ画面の土台。`#list` `#form` `#side` の3カラム |
| `js/rules.js` | **ルール定義**: 用語`TERMS`、数値`RULES`、効果の種類`FX`、対象`TARGETS`、セリフ種別`LINE_KEYS`、クラス、画像設定 |
| `js/units.js` | **標準キャラデータ** `DEFAULT_UNITS`（エディタの「units.jsを書き出し」で生成される形式） |
| `js/common.js` | ゲームとエディタ**共通**: データの正規化・検証・読み書き・書き出し、HTML/文字列生成（カード、効果説明文） |
| `js/engine.js` | **ゲームロジック**: 状態`G`、`ACTIONS`、ダメージ/効果処理、ターン進行 |
| `js/cpu.js` | CPUの思考。`cpuDecide()`が次の1手を返すだけ |
| `js/fx.js` | 演出（吹き出し・ダメージ数値・宝具カットイン）。`FXQ`を順に再生 |
| `js/game-ui.js` | ゲーム画面の描画(`render`)と入力(クリック処理) |
| `js/editor.js` | エディタの描画・入力・自動保存 |
| `css/base.css` | 共通スタイル（CSS変数・ボタン・ヘッダー） |
| `css/game.css` / `css/editor.css` | 各画面のスタイル |
| `img/classes/` | クラスアイコン(webp) / `img/placeholder/` 仮画像(svg) / `img/ui/` 魔法陣 |

## 3. スクリプト読み込み順と依存

順序が重要。後ろのファイルは前のファイルのグローバルを使う。

```
ゲーム  (index.html) : rules → units → common → engine → cpu → fx → game-ui
エディタ(editor.html): rules → units → common → editor
```

- `engine.js` は読み込み時に `reloadUnits()` を呼ぶので、`common.js` の `loadUnits` と `units.js` の `DEFAULT_UNITS` が先に必要。
- `engine.js` が `render()` を、`cpu.js` が `fxBusy()` を呼ぶ（どちらも後ろのファイルで定義。実行時に解決されるので問題ない）。
- 新しい `.js` を足す場合は、依存先より後ろに `<script>` を置く。

## 4. データモデル

### 4.1 キャラ(サーヴァント)定義 — `DEFAULT_UNITS[i]` / `UNITS[i]`
```
{ id, name, cls, cost, hp,
  img:   { face, card },                 // card空欄なら face、それも仮画像なら card.svg
  lines: { start, attack, damage, skill, np, npDamage, defeat, win },  // 各 string[]（LINE_KEYS）
  faces: [ {acts:1|2|3, pre:Cmd, post:Cmd} ×6 ],   // 鉛筆の出目1〜6。pre=覚醒前 / post=覚醒後
  skills:[ {name, eff:Eff[], pick?:'ally'|'enemy'|'any'} ×3 ],   // スキル3は覚醒後のみ使用可
  ult:   { name, c:'R'|'B'|'G', eff:Eff[] } }                    // 宝具
```
- `Cmd`: `{c:'R'|'B'|'G', dmg, np, star}` / `{c:'W', label, eff:Eff[], np, star}`(特殊行動) / `{c:'ASC'}`(覚醒面。`pre`にだけ置ける)。R=Buster, B=Arts, G=Quick。
- `Eff`: `{k:効果種類, t:対象, v:値, turns?, times?, chance?, color?}`
  - `k`は `rules.js` の `FX` のキー。`t`は `TARGETS` のキー（使える対象は場所ごとに `TGT_BY_CTX`: skill / ult / special）。
  - `chance`=ロールN以下で成功(1〜5)。`color`は `atk` のときだけ有効。`dmg`効果は宝具でのみ可。
  - `turns`/`times` が無い持続系効果は「ずっと続く」(検証で警告)。
- **正規化 `normalizeUnit()` が未知のフィールドを捨てる**ので、キャラに新しい項目を足す場合は §7 の手順を全部通すこと。

### 4.2 実行時ユニット — `makeUnit()`（engine.js）
`{uid:'p{pid}u{idx}', pid, idx, def:<キャラid>, hp, np, asc, out, used:[bool×3], fx:[], face}`
- `fx[]` は付与中の効果 `{k,v,color,turns,times,owner}`。`owner`はそれを付与したプレイヤーで、そのプレイヤーのターン開始時に `turns` が1減る。
- 定義の取得は `D(u.def)`、uidからの取得は `U(uid)`。

### 4.3 ルール定数 — `RULES`（rules.js）
`costCap:10, partyMax:3, actionsMax:3, gaugeOnHit:10, gaugeMax:300, ultCost:100, chainR:30, chainB:20, chainG:10, dot:20, dotTiming:'current'|'all'`。
クリティカル閾値は `critThreshold(stars)`（★30以上=確定、14以上=出目4以下、7以上=2以下、1以上=1以下）。

### 4.4 保存(localStorage)
| キー | 内容 |
|---|---|
| `pencilduel.units` | エディタで「ゲームに反映」したキャラ配列。あればゲームが標準データより優先して使う |
| `pencilduel.editorDraft` | エディタの下書き（自動保存） |
| `pencilduel.logOpen` | バトルログの開閉 |

`loadUnits()` は、反映データが検証エラーなら標準データにフォールバックして `broken:true` を返す。

## 5. ゲームの流れ（`G.phase`）

```
mode → setup(1P編成→2P編成) → [startGame: 先攻決定] → ターン繰り返し → over
ターン: actRoll → skill → action → target → end → (endPhase → 手番交代 → actRoll)
        └ 宝具を使うと skill → target（行動フェイズを飛ばす）
```
| phase | 内容 | 主な ACTIONS |
|---|---|---|
| `mode` | モード選択(CPU戦/2人対戦) | `chooseMode` |
| `setup` | パーティ編成(コスト合計≤10, 最大3体) | `setupToggle` `setupRandom` `setupCpu` `setupConfirm` |
| `actRoll` | ②全員の出目で最大行動回数を決め、合計3回まで配分。撤退済み人数ぶん行動回数ボーナス | `rollActs` `alloc` `setAlloc` `confirmAlloc` |
| `skill` | ③スキル(各1回/戦闘)・宝具(NP100以上、1ターン1回)。`pick`付きは対象選択待ち(`G.pending`) | `useSkill` `useUlt` `cancelPick` `skillDone` |
| `action` | ④配分した回数ぶん鉛筆をロールしてコマンド決定 | `rollAction` `toTarget` |
| `target` | ⑤攻撃対象を選ぶ（`taunt`があればその相手のみ） | `cardClick` `resolve` |
| `end` | ⑥ダメージ処理後。⑦で毒等の継続ダメージ、★獲得、手番交代 | `endTurn` |
| `over` | 決着。`restart` `rematch` `toggleSpeed` `useDefaultData` のみ受付 | |

ダメージ解決(`resolveDamage`)の要点: 各コマンドを順に`resolveCommand` →同色3枚でチェイン(R:ダメージ+30 / B:行動者NP+20 / G:★10発生) →同一キャラ3回行動でブレイブチェイン(エクストラアタック)。クラス相性は無い。

## 6. 設計上の約束事（壊さないこと）

1. **状態は `G` に集約し、変更は `act(type, payload)` → `ACTIONS[type]` だけ**。`act()` の末尾で `render()` が呼ばれる。人間・CPU・（将来のオンライン対戦）が同じ経路を通る前提なので、`ACTIONS` を経由せず `G` を直接書き換えない。
2. **ルール判定は `ACTIONS` 側で必ず再検証する**（フェイズ・手番・使用済みなど）。UIで`disabled`にするだけでは不十分。
3. **画面だけの状態は `UI`（game-ui.js）**に持ち、`G` には入れない。
4. **`render()` は `#app.innerHTML` を毎回丸ごと作り直す**。イベントは `document` への委譲（`data-a`=ゲーム操作、`data-ui`=画面操作、エディタは `data-act` / `data-p`）。要素に直接リスナーを付けない。
5. **演出は `FXQ`**（`fxEmit`/`say`）に積み、`fx.js` が`#fx`上で再生する。ルール処理は演出の完了を待たない。CPUだけ `fxBusy()` を見て待つ。
6. ユーザーデータをHTMLに埋め込むときは必ず `esc()`。`log()` のメッセージはHTMLとして描画されるので、名前は `nm()`/`dn()` 経由で入れる。
7. 画面に出る用語は `TERMS`（rules.js）から引く。直書きしない。
8. **CPUはルールを知らない**。強さの調整は `cpuSkillScore`（スキルの使いどき）と `cpuBestTarget`（攻撃対象）、`cpuAlloc`（行動配分）。`FX` に新しい効果を足したら `cpuSkillScore` の `switch` にも点数を足す（無いと「使う価値0」扱い）。

## 7. やりたいこと → 触る場所

| やりたいこと | 触るファイル・場所 |
|---|---|
| キャラを追加・調整（数値/スキル/セリフ） | `js/units.js`（またはエディタで編集→書き出して置き換え）。`id`は半角英数・`_`・`-`で重複不可。コスト≤`RULES.costCap` |
| 数値バランス（NP量、チェイン、毒ダメージ等） | `js/rules.js` の `RULES` |
| 用語・表示名の変更 | `js/rules.js` の `TERMS` |
| クラスを追加 | `js/rules.js` の `CLASS_ICONS`（アイコンは`img/classes/`）。一覧外の名前も自由に使え`extra.webp`になる |
| セリフの場面を追加 | `rules.js` の `LINE_KEYS` → `engine.js` で `say(u,'新キー')` を呼ぶ。エディタ・書き出しは`LINE_KEYS`を自動で見る |
| **新しい効果の種類**（例: 新しい状態） | ① `rules.js` `FX` に定義 ② `engine.js` で効果を反映する処理（即時効果は`applyOne`、持続効果は`mods()`で参照する側＝`resolveCommand`/`resolveUlt`/`blocked`等） ③ 表示文は`common.js`の`fxText`（`default`は`FX[k].name`） ④ `cpu.js` `cpuSkillScore` に点数 ⑤ 検証が必要なら`common.js`の`checkEffs`。エディタの選択肢は`FX`から自動生成 |
| 新しい効果の対象を追加 | `rules.js` `TARGETS` と `TGT_BY_CTX` → `engine.js` `resolveTargets` |
| ターンの流れ・フェイズを変更 | `engine.js` の `ACTIONS` と `beginTurn`/`endPhase`/`toTargetPhase`。表示側は `game-ui.js` の `promptHTML`/`stageHTML`(`stepNo`)/`ctlHTML`。`cpu.js` の `cpuDecide` も合わせる |
| ダメージ計算・クリティカル・チェイン | `engine.js` の `resolveCommand`（通常）/`resolveUlt`（宝具）/`resolveDamage`（チェイン）。CPUの見積り`estDamage`（cpu.js）も同期させる |
| 新しい ACTION（操作）を追加 | `engine.js` `ACTIONS` に追加 → UIに `data-a="名前"` のボタン → CPUが使うなら `cpuDecide`。決着後も受け付けるなら `engine.js` `act()` 内の許可リスト、CPUの手番中でも押せるようにするなら `game-ui.js` の `FREE_ACTIONS` に追記（用途が別の2つのリスト） |
| CPUを賢く/弱く | `js/cpu.js`（`level`は`'easy'`/`'normal'`。`easy`は`rnd01`で決定的な擬似乱数） |
| ゲーム画面のレイアウト・見た目 | `js/game-ui.js`(HTML生成) + `css/game.css` |
| 演出（吹き出し・数値・カットイン） | `js/fx.js`、待ち時間は`FX_WAIT`、CSSは`game.css` |
| コマンドカードの見た目・共通素材 | `common.js` の `cmdCardHTML`/`cardLayers`、素材パスは`rules.js`の`CARD_LAYERS` |
| エディタのフォーム・プレビュー | `js/editor.js`（`renderForm`/`effRow`/`renderSide`）+ `css/editor.css` |
| データ検証ルール（エラー/警告） | `common.js` の `validateUnits`/`checkEffs` |
| **キャラに新しいフィールドを足す** | `common.js` の `normalizeUnit`（通さないと消える）→ `unitsToJS`（書き出し）→ `editor.js` の `newUnit` と `renderForm` → `validateUnits` → `units.js` の既存データ |
| 色・フォント・共通部品 | `css/base.css` の CSS変数 |

## 8. 動作確認

自動テストは無いので、ブラウザで手動確認する。
- ゲーム: `index.html` → CPU戦(よわい/ふつう)と2人対戦で1戦通す。変更点によっては宝具・覚醒・チェイン・スキル対象選択・撤退も通す。
- エディタ: `editor.html` で編集 → 右の「検証」にエラーが出ないこと →「ゲームに反映」→ ゲーム側のモード選択に反映されること →「標準データに戻す」。
- ブラウザの開発者ツールでコンソールエラーが無いこと。`pencilduel.units`が壊れた状態の挙動を見るときは`localStorage`を直接編集する。

## 9. 既知の注意点

- `README.md` は実質空。説明は本ファイルに集約している。
- 「ゲームに反映」は同一ブラウザの`localStorage`経由。端末間共有や公開には`units.js`を書き出して`js/units.js`を置き換える。
- `G.phase==='init'` は `setupConfirm` が一瞬セットするだけで、`startGame()`→`beginTurn()` ですぐ `actRoll` になる（画面は無い）。
- 日本語の文字列とログがロジックに直書きされている箇所が多い（`engine.js` の `log(...)`）。用語は`TERMS`に寄せる方針だが、全部は寄っていない。
