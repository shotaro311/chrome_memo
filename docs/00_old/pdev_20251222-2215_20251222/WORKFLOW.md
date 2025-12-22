# Parallel Development Workflow（並行開発 運用）

## 目的
並行開発を「速さ」ではなく「統合の安全性」で運用する。

## 役割
- Architect: `docs/pdev/*` を整備し、合流を管理する
- Worker: worktree の `task.md` に従って担当範囲を実装する

## 並行ストリーム数
- main + 2 worktrees（合計3）を前提（T1/T2を並行）

## 進め方（最小）
1) Architect が `docs/pdev/active/LAUNCH.md` を更新
2) 各 worktree で Worker が `task.md` を読み、実装→進捗ログ更新
3) 完了報告（例: `done: T1`）
4) Architect が順番に合流（T1 → T2 → T3）

## 合流（マージ）ルール
- 同時に合流しない
- 合流後に最小の動作確認をしてから次へ進む

