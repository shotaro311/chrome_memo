-- Fix: allow per-user "inbox" folder and avoid auth trigger failures.
-- This resolves: server_error: Database error saving new user

-- 1) Drop existing auth trigger/function (if any)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.create_inbox_folder();

-- 2) Ensure folders primary key is (user_id, id)
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.memos'::regclass
      AND contype = 'f'
      AND confrelid = 'public.folders'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.memos DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
END $$;

DO $$
DECLARE
  pk_name text;
BEGIN
  SELECT conname INTO pk_name
  FROM pg_constraint
  WHERE conrelid = 'public.folders'::regclass
    AND contype = 'p'
  LIMIT 1;

  IF pk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.folders DROP CONSTRAINT IF EXISTS %I', pk_name);
  END IF;
END $$;

ALTER TABLE public.folders
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.folders
  ADD CONSTRAINT folders_pkey PRIMARY KEY (user_id, id);

-- 3) Ensure memos references folders by (user_id, folder_id)
ALTER TABLE public.memos
  ADD CONSTRAINT memos_folder_user_id_fkey
  FOREIGN KEY (user_id, folder_id) REFERENCES public.folders(user_id, id) ON DELETE CASCADE;

-- 4) Recreate trigger function (idempotent) with safe search_path
CREATE OR REPLACE FUNCTION public.create_inbox_folder()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.folders (id, user_id, name, is_system, created_at, updated_at)
  VALUES (
    'inbox',
    NEW.id,
    'Inbox',
    true,
    EXTRACT(EPOCH FROM NOW())::BIGINT * 1000,
    EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
  )
  ON CONFLICT (user_id, id) DO NOTHING;

  INSERT INTO public.quick_memo (user_id, content, updated_at)
  VALUES (
    NEW.id,
    '',
    EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.create_inbox_folder();
