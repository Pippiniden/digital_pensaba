// シナリオの一覧（このフォルダに置いたシナリオJSONのファイル名を書く）。
// ここが空で、JSONの外部読み込みもしていなければ、ゲームのメニューに「シナリオ」は出ません。
//   例： const SCENARIO_FILES = ['prologue.json', 'chapter1.json'];
// 画像・音声をJSONに埋め込まずに使うときは scenarios/assets/ の中に置き、素材の「パス」にそのファイル名を書きます。
// ※ フォルダ内のJSONは http(s) で開いたときだけ読み込めます（file:// では外部読み込みを使ってください）。
const SCENARIO_FILES = [];
