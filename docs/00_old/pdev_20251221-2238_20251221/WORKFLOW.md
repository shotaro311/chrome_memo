# Parallel Development Workflow（並行開発 運用）

## 目的
- 並行開発を「速さ」ではなく「統合の安全性」で運用する。

## 役割
- parallel-dev-auto: 状態を見て architect/worker を自動判定
- parallel-dev-architect: DAG/契約/指示書/worktree を整備
- parallel-dev-worker: task.md を読み、担当範囲に集中して実装

## 起動タイミング
- ユーザーが「並行開発で進めたい」と言ったタイミングで開始する。
- `docs/00_old/pdev_20251221-2238_20251221/active/RUN.md` と `docs/00_old/pdev_20251221-2238_20251221/DAG.md` を先に読む。

## 並行ストリーム数
- main + 1（合計2）または main + 2（合計3）
- 衝突が怖い場合は合計2を優先する

## 統合（マージ）の進め方
- PR は同時にマージせず、1 本ずつ順番にマージする
- 各マージ後に `npm run build` を実行し、壊れていないことを確認してから次へ進む

## 終了
- すべての worker 完了を確認したら、アーキテクトが `docs/pdev` を `docs/00_old/` にアーカイブし、worktree を削除して並行開発を閉じる

## 進捗報告の最小フォーマット
- `done: T1` / `done: pdev-1` のように短く送る
