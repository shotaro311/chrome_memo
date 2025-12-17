-- =========================================
-- Chrome Memo Extension - Supabase Schema
-- =========================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================================
-- Users Table (自動生成されるauth.usersを使用)
-- =========================================

-- =========================================
-- Folders Table
-- =========================================
CREATE TABLE folders (
  id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  is_system BOOLEAN DEFAULT false,
  created_at BIGINT NOT NULL,
  updated_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000,
  PRIMARY KEY (user_id, id)
);

-- インデックス
CREATE INDEX idx_folders_user_id ON folders(user_id);
CREATE INDEX idx_folders_created_at ON folders(created_at);

-- Row Level Security (RLS)
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;

-- ポリシー: ユーザーは自分のフォルダのみアクセス可能
CREATE POLICY "Users can view their own folders"
  ON folders FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own folders"
  ON folders FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own folders"
  ON folders FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own folders"
  ON folders FOR DELETE
  USING (auth.uid() = user_id);

-- =========================================
-- Memos Table
-- =========================================
CREATE TABLE memos (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  folder_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (user_id, folder_id) REFERENCES folders(user_id, id) ON DELETE CASCADE
);

-- インデックス
CREATE INDEX idx_memos_user_id ON memos(user_id);
CREATE INDEX idx_memos_folder_id ON memos(folder_id);
CREATE INDEX idx_memos_updated_at ON memos(updated_at);

-- Row Level Security (RLS)
ALTER TABLE memos ENABLE ROW LEVEL SECURITY;

-- ポリシー: ユーザーは自分のメモのみアクセス可能
CREATE POLICY "Users can view their own memos"
  ON memos FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own memos"
  ON memos FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own memos"
  ON memos FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own memos"
  ON memos FOR DELETE
  USING (auth.uid() = user_id);

-- =========================================
-- Quick Memo Table (1ユーザー1レコード)
-- =========================================
CREATE TABLE quick_memo (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  updated_at BIGINT NOT NULL
);

-- Row Level Security (RLS)
ALTER TABLE quick_memo ENABLE ROW LEVEL SECURITY;

-- ポリシー: ユーザーは自分のクイックメモのみアクセス可能
CREATE POLICY "Users can view their own quick memo"
  ON quick_memo FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own quick memo"
  ON quick_memo FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own quick memo"
  ON quick_memo FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own quick memo"
  ON quick_memo FOR DELETE
  USING (auth.uid() = user_id);

-- =========================================
-- Functions: 自動でinboxフォルダを作成
-- =========================================
CREATE OR REPLACE FUNCTION create_inbox_folder()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO folders (id, user_id, name, is_system, created_at, updated_at)
  VALUES (
    'inbox',
    NEW.id,
    'Inbox',
    true,
    EXTRACT(EPOCH FROM NOW())::BIGINT * 1000,
    EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
  )
  ON CONFLICT (user_id, id) DO NOTHING;

  INSERT INTO quick_memo (user_id, content, updated_at)
  VALUES (
    NEW.id,
    '',
    EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- トリガー: 新規ユーザー作成時にinboxフォルダとクイックメモを自動作成
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_inbox_folder();
