# Parallel Dev Launch Guide（今回）

※このRUNは終了済みです（worktree削除済み）。再開する場合は新しいRUNを作成してください。

## 1) worktree を作業ディレクトリとして使う
同じリポジトリを「別フォルダにもう1つ/2つチェックアウト」して、衝突を減らしながら並行作業します。

## 2) 起動手順（例）
- pdev-1（T1担当）:
  - `cd /Users/shotaro/code/personal/chrome_memo_pdev-1`
  - `ls` で `task.md` があることを確認
  - Codex/Claude を起動して、最初に「parallel-dev-worker を起動して task.md に従って進める」と伝える
- pdev-2（T2担当）:
  - `cd /Users/shotaro/code/personal/chrome_memo_pdev-2`
  - 同様

## 3) 完了報告
- 例: `done: T1` / `done: T2`
- 進捗は各 worktree の `task.md` に残す
