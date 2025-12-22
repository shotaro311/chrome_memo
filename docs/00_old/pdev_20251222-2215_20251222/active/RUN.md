# Parallel Dev RUN

## RUN メタ情報
- RUN_ID: 20251222-2215
- 作成日: 2025-12-22
- ベースブランチ: main
- 並行ストリーム数: 合計3（main + pdev-1 + pdev-2）
- worktree:
  - pdev-1: pdev/20251222-2215/t1-ai-ui
  - pdev-2: pdev/20251222-2215/t2-gemini-bg

## 読んだ入力（仕様ソース）
- requirement:
  - `docs/requirement.md`
- planning:
  - `docs/plan/20251222_PLAN2.md`
- 追加指示（要約）:
  - AIボタンで「生成/編集指示」ができる
  - 選択範囲がある場合は選択部分だけ編集できる
  - APIキーはGeminiを利用、UIから入力して管理したい
  - `npm run dev` は実行しない（コマンド案内のみ）

## 決定事項（確定）
- 選択なし時の既定: カーソル位置に挿入
- 出力の扱い: プレビューなしで即反映（AI反映直後は Cmd/Ctrl+Z で戻す）
- APIキー保存: `chrome.storage.local`（同期しない）

## 未確定事項
- なし（RESTで実装）

## DAG（参照）
- `docs/00_old/pdev_20251222-2215_20251222/DAG.md`

## タスク割り当て
- pdev-1: T1 UI/選択/適用 + APIキーUI
- pdev-2: T2 Gemini呼び出し/Background

## 合流順（提案）
- 1) T1 → main
- 2) T2 → main
- 3) T3（結線）→ main

## ステータス
- done: T1
- done: T2
- 結線（T3）: 完了
- `npm run build`: 成功
- クローズ: docs/pdev をアーカイブし、worktree削除済み
