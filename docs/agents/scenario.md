# シナリオモード / シナリオエディタ

サウンドノベル形式の物語＋戦闘。コードが正。サンプルは `docs/scenario-sample.json`（エディタやゲームの「設定 → シナリオの読み込み」で読める）。

## ファイル
| Path | Role |
|---|---|
| `js/scenario-core.js` | 共有：形式の定数（`SCN_CMDS` など）、`normScenario` / `validateScenario`、URLの安全確認 `scnSafeSrc`、文章→HTML `scnTextHTML`、ウィンドウの中身 `scnWinInner`、IndexedDB（`scnDbGet/Put/Del/Keys`） |
| `js/scenario.js` | ゲーム側の再生（`SCN`、`scnRun`、セーブ、BGM、`#scn` の描画） |
| `js/scenario-editor.js` / `scenario-editor.html` / `css/scenario-editor.css` | シナリオエディタ |
| `css/scenario.css` | 再生画面（エディタのプレビューも同じクラス `.sn-*` を使う） |
| `scenarios/index.js` | `SCENARIO_FILES`（フォルダ内のシナリオJSONの一覧。静的サイトはフォルダを一覧できないため） |
| `scenarios/assets/` | JSONに埋め込まない画像・音声の置き場 |

読み込み順：ゲームは `game-ui → tapfx → scenarios/index.js → scenario-core → scenario`、エディタは `rules → units → masters → common → cpu（CPU_LEVELS の名前だけ使う）→ scenario-core → scenario-editor`。

## いつ表示されるか
`scnAvail()`（＝`SCN.list` に読めたシナリオがある）が真のときだけ、トップメニューに「シナリオ」が出る。読み込み元は2つ：
- `SCENARIO_FILES` に書いた `scenarios/*.json`（`fetch`。http(s) のみ）→ キー `f:<ファイル名>`
- 外部読み込み（設定の「JSONを読み込む」、エディタの「ゲームで試す」）→ IndexedDB `pensaba-scenarios` のキー `imp:<シナリオID>`

エディタの下書きは同じDBの `draft`。「ゲームで試す」は `imp:<id>` に保存して `index.html#scn=<id>` を開く（その場で最初から始まる）。

## データ形式（`normScenario` が整える。知らない項目は落とす）
```
{ format:'pensaba-scenario', v:1, id, title, author, desc, cover:画像参照, start:シーンid('' = 最初),
  assets:   { <key>: {type:'bg'|'face'|'bgm'|'se', name, src} },   // src = data:URL（埋め込み）か scenarios/assets/ からの相対パス。外部URLは不可（scnSafeSrc）
  chars:    [ {id, name, img:画像参照, faces:[{name, img}]} ],     // セリフの話者。faces = 表情
  units:    [ ...ペンシルエディタと同じ形式 ], masters:[...],        // シナリオ専用キャラ（同じ id はゲームのキャラを差し替え）
  unitImgs: { <キャラid>: {face:assetKey, card:assetKey} },        // 専用キャラの画像（IMG_OVERRIDE に入る）
  scenes:   [ {id, name, cmds:[Cmd]} ] }
```
画像参照＝素材のキー、または `unit:<キャラid>`（`img/units/{id}.webp`）。

`Cmd`（`t` で種類）：
| t | 項目 | 動き |
|---|---|---|
| `say` | `pos:'top'\|'bottom'`, `who`(chars の id。空＝地の文), `face`(表情名), `name`(表示名の上書き), `text` | そのウィンドウに表示。クリック待ち。`｜漢字《かな》` でルビ、`{フラグ名}` で値 |
| `choice` | `opts:[{text, to, flag, v}]` | 選ぶと `flag=v`（任意）→ `to` のシーンへ（空＝続き） |
| `bg` / `bgm` / `se` | `img`, `fade` / `audio` | 空の `bg`＝黒、空の `bgm`＝停止 |
| `fx` | `kind:'flash'\|'shake'\|'fadeout'\|'fadein'` | 画面効果（暗転は `st.dark` に残る） |
| `wait` / `clear` | `ms` / `pos:'both'\|'top'\|'bottom'` | 待つ / ウィンドウを消す |
| `set` / `if` / `jump` | `flag, op:'='\|'+'\|'-', v` / `flag, cmp, v, to` / `to` | フラグは数値（未設定は 0） |
| `battle` | 下記 | 戦闘 |
| `end` | `text` | エンディング（オートセーブを消す） |

シーンは並び順に進む（最後のコマンドの次は次のシーン。最後のシーンが終われば終了）。

`battle`：`{rule:RULESETS のキー, level:CPU_LEVELS のキー, cap:コスト上限(0=ルールどおり), party:{mode, lock:[id], master:id, pool:[id]}, enemy:{units:[id], master:id, name}, win:シーンid, lose:シーンid | '' | '@next'}`
- `party.mode`：`keep`＝最初に選んだチーム（使えなければ選ぶ） / `choose`＝戦闘の前に毎回選ぶ / `fixed`＝`lock` と `master` で全員固定
- `party.lock`＝必ず出撃する固定メンバー（どの mode でも有効） / `pool`＝選べるキャラ（空＝ゲームの全キャラ。専用キャラを選ばせるならここに入れる）
- `lose`：`''`＝再挑戦のみ（結果画面は「再挑戦」） / `'@next'`＝負けても続きへ / シーンid＝そのシーンへ

## エンジンとのつなぎ（`G.scn`）
- `scenario.js` の `scnBattle(c)` → `act('scnBattle',spec)` → `scnBegin(spec)`（engine.js）。`G.scn={spec,title,lock,mlock,pool,cap,pick,loseGo}`、`G.mode='cpu'`。`pick` が真なら `phase:'setup'`（自分だけ編成）、偽ならすぐ `startGame()`。
- 「選んだチーム」は `SCN.st.team={picks,mpick,rule}`。**自分で選んだとき（`G.scn.pick`）だけ**覚える（`scnHook`）。ルールの人数・マスターの有無が違う戦闘では選び直し。
- 編成の制限は `ACTIONS` 側で再確認：`setupToggle`（固定は外せない・`ROSTER()` 以外は選べない）、`setupMaster`（`mlock`）、`setupRandom` → `scnRandom`、`setupConfirm`、`setupCpu`（無効）。`ROSTER()`＝編成で選べるサーヴァント（`G.scn.pool` があればそれ）、`costCap()` は `G.scn.cap` を優先。
- 決着後：結果画面の `scnResultBtn()` →「物語を進める」（`data-ui="scnAfter"` → `scnAfter()`：`act('restart')` で `G` を戻して次のシーンへ）か「再挑戦」（`rematch` → 同じ `spec` で `scnBegin`）。
- 専用キャラ：`setScnData(units,masters)`（engine.js）が `XUNITS`/`XMASTERS` に入れて `reloadUnits()`。`D()` で引けるが、編成の一覧・図鑑には出ない。シナリオを抜けるとき（`scnExit`）に必ず `setScnData()` で戻す。
- `render()` は最後に `scnHook()` を呼ぶ：戦闘中に `G.scn` が消えていたら（「タイトルに戻る」）`scnExit()`。

## 再生側の状態
- `SCN.st={scene, pc, flags, team, bg, bgm, dark, wins:{top,bottom}, cur}`。`scnRun()` が止まるコマンド（say / choice / battle / wait / 暗転 / end）まで進める。
- セーブ＝`SCN.snap`（セリフ・選択肢・戦闘を出す**直前**の `st` の写し＋ログ）。ロードするとその行からやり直す。
- `#scn` は `#app` の外で、`render()` では作り直さない（文字送り・BGMが途切れない。無限アニメーションもここなら可）。操作は `data-sn` を `scnAct` で受ける。`G` には物語の状態を入れない。
- ページの再読み込み：`sessionStorage 'pencilduel.scnRun'`（`{key,snap,battle}`）から再開。戦闘中だった場合は、シナリオを読み込んだあと `restoreMatch(true)` で対戦も戻す（それまで `MATCH_HOLD` が保存を守る）。

## 保存先
| Key | 内容 |
|---|---|
| IndexedDB `pensaba-scenarios` / store `s` | `imp:<id>`＝読み込んだシナリオ、`draft`＝エディタの下書き |
| `pencilduel.scn.save.<id>` | `{auto:snap, slots:[snap×6]}` |
| `pencilduel.scn.read.<id>` | 既読の行（`'シーンid:位置'` の配列。既読スキップ用） |
| `pencilduel.scn.prefs` | `{speed, auto, bgm, se, skipAll}` |
| `pencilduel.scnRun`（sessionStorage） | 再生中のシナリオ（再読み込みからの復帰用） |

## 変更するとき
- **コマンドを足す**：`SCN_CMDS` + `scnNormCmd` + `validateScenario`（scenario-core.js）→ `scnRun` の switch（scenario.js）→ `cmdFields`（scenario-editor.js。プレビューに効くなら `drawSide` も）。
- シナリオのJSONは外部データ：HTMLに入れる文字は `esc()`、URLは `scnSafeSrc()` / `scnImgUrl()` を必ず通す。
- ボタンの見た目は `buttons.css`（`.sn-bar` / `.sn-choices` / `.sn-slot`）。
