# Parallel Dev DAG（メモ帳AI / Gemini）

## DAG サマリー（ノードと依存）
> 形式: `TASK_ID: depends_on -> [ ... ]`

- T1: depends_on -> []（UI/選択/適用 + APIキーUI）
- T2: depends_on -> []（Gemini呼び出し + Backgroundメッセージ）
- T3: depends_on -> [T1, T2]（結線・最終調整）
- T4: depends_on -> [T3]（手動確認 + `docs/requirement.md` 同期）

## タスク一覧

### T1: UI/選択範囲/適用 + APIキーUI
- 目的: AIモーダルで「指示→プレビュー→適用」を実現し、選択範囲に対して適用できるようにする
- 依存: []
- 並行可否: 可（T2と独立）
- SCOPE（変更対象）:
  - `src/content/**`
  - `src/styles/panel.css`
- 共有境界（触るなら提案）:
  - `src/types/index.ts`
  - `src/background/background.ts`
- 受け入れ条件（要約）:
  - AIボタン/AIモーダルのUIが動く
  - 選択範囲の取得ができる（左右ペイン対応）
  - 「置換/挿入/全文置換」が適用できる（まずはローカル適用のみでもOK）
  - APIキーを `chrome.storage.local` に保存/削除できる（キー名: `geminiApiKey`）

### T2: Gemini呼び出し/Background
- 目的: Gemini APIへ問い合わせてテキストを生成し、content script へ返す
- 依存: []
- 並行可否: 可（T1と独立）
- SCOPE（変更対象）:
  - `src/background/**`
  - `src/types/**`
  - `src/lib/**`（必要なら新規追加）
- 受け入れ条件（要約）:
  - content script からのメッセージを受け取れる
  - `chrome.storage.local` の `geminiApiKey` を読んでGeminiへリクエストできる
  - 成功/失敗を分かる形で返せる（キー未設定・HTTPエラーなど）

### T3: 統合（Architect）
- 目的: T1のUIとT2のGemini呼び出しを結線し、実動作にする
- 依存: [T1, T2]
- 並行可否: 不可（合流後に実施）

### T4: 手動確認 + ドキュメント同期（Architect）
- 目的: 主要フロー確認と `docs/requirement.md` 更新
- 依存: [T3]
- 並行可否: 不可

