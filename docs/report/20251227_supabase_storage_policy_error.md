# Supabase Storage ポリシー設定時の権限エラー対処法

## 発生日

2025-12-27

## 概要

Supabase のマイグレーションで `storage.objects` テーブルにポリシーを設定しようとした際、権限エラーが発生した問題と、その解決方法をまとめる。

---

## 発生したエラー

```
ERROR: 42501: must be owner of table objects
```

### 発生したタイミング

- `supabase db push` コマンド実行時
- Supabase Dashboard の SQL Editor で直接 SQL 実行時

### 問題の SQL

```sql
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can upload their own memo thumbnails"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'memo-thumbnails' AND auth.uid() = owner);
```

---

## 原因

### Supabase の内部アーキテクチャ

Supabase には、ユーザーが自由に操作できるテーブルと、**システムが管理する内部テーブル**がある。

| スキーマ | 説明 | ユーザー操作 |
|---------|------|-------------|
| `public` | ユーザーが作成したテーブル | ◯ 自由に操作可能 |
| `auth` | 認証関連（users等） | △ 一部のみ |
| `storage` | ファイルストレージ関連 | ✕ 直接操作不可 |

### なぜエラーになるのか

1. **`storage.objects` テーブルは Supabase が所有**
   - このテーブルの owner は `supabase_admin` ロール
   - 通常の接続（pooler経由、postgres ユーザー）では ALTER や POLICY 作成ができない

2. **セキュリティ上の理由**
   - Storage は Supabase の重要な機能
   - 不正なポリシー設定を防ぐため、GUI からのみ設定可能にしている

---

## 解決方法

### Storage ポリシーは Dashboard から設定する

`storage.objects` へのポリシーは **SQL ではなく GUI** で設定する。

#### 手順

1. **Supabase Dashboard** にログイン
2. **Storage** → **Policies** を選択
3. 対象のバケット（例: `memo-thumbnails`）を選択
4. **New policy** をクリック
5. 必要な操作（INSERT/SELECT/UPDATE/DELETE）ごとにポリシーを作成

#### ポリシー設定例

| 操作 | Policy definition |
|------|-------------------|
| INSERT | `bucket_id = 'memo-thumbnails' AND auth.uid() = owner` |
| SELECT | `bucket_id = 'memo-thumbnails' AND auth.uid() = owner` |
| UPDATE | `bucket_id = 'memo-thumbnails' AND auth.uid() = owner` |
| DELETE | `bucket_id = 'memo-thumbnails' AND auth.uid() = owner` |

### マイグレーションファイルの分離

マイグレーションファイルには、**SQL で実行可能な部分のみ**を含める。

```sql
-- OK: public スキーマへの変更
ALTER TABLE public.memos
  ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;

-- OK: バケットの作成（storage.buckets は操作可能）
INSERT INTO storage.buckets (id, name, public)
VALUES ('memo-thumbnails', 'memo-thumbnails', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- NG: storage.objects へのポリシーは SQL では設定不可
-- → Dashboard から手動で設定する
```

### マイグレーション履歴の同期

Dashboard で手動設定した後、ローカルのマイグレーション履歴と同期する：

```bash
supabase migration repair --status applied <migration_timestamp>
```

---

## 基礎知識

### Supabase の接続方式

| 接続方式 | 説明 | 権限 |
|---------|------|------|
| Pooler（Transaction mode） | 通常の接続。CLI のデフォルト | 制限あり |
| Pooler（Session mode） | セッション維持が必要な場合 | 制限あり |
| Direct connection | データベースへの直接接続 | やや高い |
| Dashboard SQL Editor | ブラウザからの実行 | 高いが storage.objects は不可 |

### Row Level Security (RLS) とは

PostgreSQL の機能で、行単位でアクセス制御を行う仕組み。

```sql
-- RLS を有効化
ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;

-- ポリシーを作成（このルールに合致する行のみアクセス可能）
CREATE POLICY "Users can view own data"
  ON my_table FOR SELECT
  USING (user_id = auth.uid());
```

### Supabase Storage の構造

```
storage.buckets     -- バケット（フォルダのようなもの）の定義
    ↓
storage.objects     -- 実際のファイルメタデータ
    ↓
実ファイル           -- S3互換ストレージに保存
```

---

## Tips

### 1. マイグレーション作成時のチェックリスト

- [ ] `public` スキーマへの変更か？ → SQL OK
- [ ] `storage.buckets` の作成か？ → SQL OK
- [ ] `storage.objects` へのポリシーか？ → **Dashboard で設定**
- [ ] `auth` スキーマへの変更か？ → 要確認（多くは不可）

### 2. エラー発生時の切り分け

```bash
# まず migration list で状態確認
supabase migration list

# Local と Remote が一致していない場合
# → 手動で設定後、repair コマンドで同期
supabase migration repair --status applied <timestamp>
```

### 3. 開発フローの推奨

1. **ローカルで開発** (`supabase start`)
2. **マイグレーション作成** (`supabase migration new`)
3. **ローカルでテスト** (`supabase db reset`)
4. **本番反映時に Storage ポリシーは分離**
   - SQL 部分 → `supabase db push`
   - Storage ポリシー → Dashboard で手動設定

### 4. よく使うコマンド

```bash
# マイグレーション状態確認
supabase migration list

# マイグレーション履歴を修正（手動適用後の同期）
supabase migration repair --status applied <timestamp>

# マイグレーションを強制プッシュ（パスワード入力）
supabase db push --yes -p "<password>"

# 直接接続でプッシュ（pooler をバイパス）
supabase db push --yes --db-url "postgresql://postgres:<password>@<host>:5432/postgres"
```

---

## 参考リンク

- [Supabase Storage - Access Control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase CLI - Migration Commands](https://supabase.com/docs/reference/cli/supabase-migration)
- [PostgreSQL - Row Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)

---

## まとめ

| やりたいこと | 方法 |
|-------------|------|
| テーブル作成・変更 | SQL / マイグレーション |
| Storage バケット作成 | SQL / マイグレーション |
| Storage ポリシー設定 | **Dashboard のみ** |
| マイグレーション履歴同期 | `supabase migration repair` |

**重要**: `storage.objects` への操作は SQL ではできない。必ず Dashboard の Storage → Policies から設定すること。
