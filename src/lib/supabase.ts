import { createClient } from '@supabase/supabase-js';
import { chromeStorage } from './chromeStorage';

const SUPABASE_URL = 'https://jxlnqtueltmmmzbjviwh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4bG5xdHVlbHRtbW16Ymp2aXdoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4MDQ3NDgsImV4cCI6MjA4MTM4MDc0OH0.oV6xtrRs4nXew16Y-758HR35Vub9tgzLvz02ztFQiIM';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storage: chromeStorage
  }
});

// 型定義
export interface SupabaseFolder {
  id: string;
  user_id: string;
  name: string;
  is_system: boolean;
  created_at: number;
  updated_at: number;
}

export interface SupabaseMemo {
  id: string;
  user_id: string;
  folder_id: string;
  title: string;
  content: string;
  thumbnail_path?: string | null;
  created_at: number;
  updated_at: number;
}

export interface SupabaseQuickMemo {
  user_id: string;
  content: string;
  updated_at: number;
}
