# バグフィックスナレッジ

このドキュメントは「後で同じ詰まり方をしない」ために、原因と直し方を短く残します。

---

## 2025-12-17: Googleログインが `server_error` で失敗する

### 症状

- 拡張の「Googleでサインイン」を押すと `server_error` が表示され、サインインできない
- 詳細として `Database error saving new user` が出る場合がある

### 原因（結論）

1) **MV3のPopupからOAuthフローを実行していた**
   - `chrome.identity.launchWebAuthFlow` をPopupで実行すると、Popupが閉じたタイミングで処理が途中で切れやすい
   - 結果として `server_error` などの失敗になりやすい

2) **Supabase側DBスキーマが「複数ユーザー」を想定していなかった**
   - `auth.users` の `AFTER INSERT` トリガーで `folders` に `id='inbox'` をINSERTしていた
   - `folders.id` が単独主キーだと、2人目以降のユーザー作成で `inbox` が衝突して失敗する
   - その結果、Supabase Auth側で `Database error saving new user` が発生する

### 対応（やったこと）

#### A. 拡張側（認証フローを安定化）

- OAuth実行を **Popup → background（Service Worker）** に移動
- backgroundにメッセージで「サインイン/サインアウト/状態取得/手動同期」を依頼する方式に変更

主な変更ファイル:
- `src/types/index.ts`（メッセージ追加）
- `src/background/background.ts`（AUTH_* を処理）
- `src/popup/popup.ts`（Popup直実行をやめてbackgroundへ委譲）
- `src/lib/auth.ts`（エラーメッセージ改善、`error_description` も拾う）

#### B. Supabase側（新規ユーザー作成失敗を解消）

- `folders` の主キーを `(user_id, id)` に変更（ユーザーごとに `inbox` を持てる）
- `memos` の外部キーを `(user_id, folder_id)` → `folders(user_id, id)` に変更
- `create_inbox_folder` を `ON CONFLICT DO NOTHING` にし、`search_path` を固定（安全 & 冪等）
- クライアント側のUpsertも複合キーに合わせる（`onConflict: 'user_id,id'`）

主な変更ファイル:
- `supabase_setup.sql`（スキーマ・トリガー定義を更新）
- `supabase/migrations/20251216145748_remote_schema.sql`（本番適用用のマイグレーションSQL）
- `src/lib/sync.ts`（foldersのupsertのonConflictを修正）

#### C. UI（アイコン押下で最初にパネルを出す / 認証UIをパネル側へ）

- 拡張アイコン押下で「Popup」ではなく「パネル」を開くように変更
- 認証（サインイン/同期/サインアウト）はパネル上部の👤から開くモーダルに移動

主な変更ファイル:
- `public/manifest.json`（`default_popup` を削除）
- `src/content/content.ts`（ヘッダーに👤追加、認証モーダル追加）
- `src/styles/panel.css`（認証モーダルのスタイル追加）

### Supabase CLIで詰まった点（メモ）

- `supabase db pull` は環境によってDockerを要求することがある（Docker未起動だと失敗）
- `db pull` が途中失敗すると、空のmigrationファイルだけ残って「migration history mismatch」になりやすい
  - 対策: `supabase db push` でmigrationを先に揃える / `supabase migration repair` を必要に応じて使う

### 再発防止チェックリスト

- [ ] OAuthはPopupで完結させず、backgroundで完走できる形にする
- [ ] Supabaseの初期データ投入トリガーで「全ユーザー共通の固定ID」を単独PKにしない
- [ ] 新規ユーザー作成を最低2回（別アカウント）試して、2人目で落ちないことを確認する
- [ ] 画面/CLIログにDBパスワードやキーを貼らない（漏洩扱いになる）

