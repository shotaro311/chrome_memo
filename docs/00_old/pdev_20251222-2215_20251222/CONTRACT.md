# Parallel Development Contract（並行開発 契約）

## 目的
複数エージェントの並行作業を、速さではなく「壊れずに合流できること」を最優先で運用する。

## 用語
- RUN: 今回の並行開発のひとまとまり（RUN_IDで識別）
- Architect: DAG/契約/合流を管理する役割
- Worker: task.md の範囲に集中して実装する役割

## 並行化の原則
- 依存がない作業だけを並行化する。
- 合流（マージ）は同時ではなく、1本ずつ順番に行う。

## 変更領域の境界（責務分離）
### T1（UI/選択/適用）
- Allowed: `src/content/**`, `src/styles/panel.css`
- Not allowed: `src/background/**`, `src/types/**`（統合タスクでまとめて触る）

### T2（Gemini呼び出し/Background）
- Allowed: `src/background/**`, `src/lib/**`, `src/types/**`
- Not allowed: `src/content/**`, `src/styles/**`

### T3（統合）
- Architect が実施（T1/T2合流後にまとめて結線・最終調整）

## 共有の約束（I/O）
- APIキー保存先: `chrome.storage.local`
- 保存キー名（案）: `geminiApiKey`（T1/T2で一致させる）
- AI適用の既定:
  - 選択あり: 選択範囲を置換
  - 選択なし: カーソル位置に挿入
- まずは「プレビュー → 適用」で運用する（いきなり本文を書き換えない）

## セキュリティ注意
- APIキーをconsole/logに出さない
- 開発者の共通キーを拡張に埋め込まない（抜かれて悪用される）

