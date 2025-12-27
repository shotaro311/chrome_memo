import { supabase, SupabaseFolder, SupabaseMemo, SupabaseQuickMemo } from './supabase';
import { Folder, Note, NoteMetadata, QuickMemo } from '../types';
import { getAuthState } from './auth';

// =========================================
// 同期状態
// =========================================

let isSyncing = false;
let lastSyncTime = 0;

const LAST_SYNC_USER_ID_KEY = 'lastSyncedSupabaseUserId';

/**
 * フォルダをSupabaseにアップロード
 */
export async function uploadFolder(folder: Folder): Promise<{ success: boolean; error?: string }> {
  const authState = await getAuthState();
  if (!authState.isAuthenticated || !authState.userId) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const supabaseFolder: SupabaseFolder = {
      id: folder.id,
      user_id: authState.userId,
      name: folder.name,
      is_system: folder.isSystem || false,
      created_at: folder.createdAt,
      updated_at: Date.now()
    };

    const { error } = await supabase
      .from('folders')
      .upsert(supabaseFolder, { onConflict: 'user_id,id' });

    if (error) {
      console.error('[Sync] Upload folder error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('[Sync] Upload folder exception:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * メモをSupabaseにアップロード
 */
export async function uploadMemo(note: Note): Promise<{ success: boolean; error?: string }> {
  const authState = await getAuthState();
  if (!authState.isAuthenticated || !authState.userId) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const supabaseMemo: SupabaseMemo = {
      id: note.id,
      user_id: authState.userId,
      folder_id: note.folderId,
      title: note.title,
      content: note.content,
      thumbnail_path: note.thumbnailPath ?? null,
      created_at: note.createdAt,
      updated_at: note.updatedAt
    };

    const { error } = await supabase
      .from('memos')
      .upsert(supabaseMemo, { onConflict: 'id' });

    if (error) {
      console.error('[Sync] Upload memo error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('[Sync] Upload memo exception:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * 下書きメモをSupabaseにアップロード
 */
export async function uploadQuickMemo(quickMemo: QuickMemo): Promise<{ success: boolean; error?: string }> {
  const authState = await getAuthState();
  if (!authState.isAuthenticated || !authState.userId) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const supabaseQuickMemo: SupabaseQuickMemo = {
      user_id: authState.userId,
      content: quickMemo.content,
      updated_at: quickMemo.updatedAt
    };

    const { error } = await supabase
      .from('quick_memo')
      .upsert(supabaseQuickMemo, { onConflict: 'user_id' });

    if (error) {
      console.error('[Sync] Upload quick memo error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('[Sync] Upload quick memo exception:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Supabaseからフォルダをダウンロード
 */
export async function downloadFolders(): Promise<{ success: boolean; data?: Folder[]; error?: string }> {
  const authState = await getAuthState();
  if (!authState.isAuthenticated || !authState.userId) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const { data, error } = await supabase
      .from('folders')
      .select('*')
      .eq('user_id', authState.userId);

    if (error) {
      console.error('[Sync] Download folders error:', error);
      return { success: false, error: error.message };
    }

    const folders: Folder[] = (data || []).map((f: SupabaseFolder) => ({
      id: f.id,
      name: f.name,
      createdAt: f.created_at,
      isSystem: f.is_system
    }));

    return { success: true, data: folders };
  } catch (error) {
    console.error('[Sync] Download folders exception:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Supabaseからメモをダウンロード
 */
export async function downloadMemos(): Promise<{ success: boolean; data?: Note[]; error?: string }> {
  const authState = await getAuthState();
  if (!authState.isAuthenticated || !authState.userId) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const { data, error } = await supabase
      .from('memos')
      .select('*')
      .eq('user_id', authState.userId);

    if (error) {
      console.error('[Sync] Download memos error:', error);
      return { success: false, error: error.message };
    }

    const notes: Note[] = (data || []).map((m: SupabaseMemo) => ({
      id: m.id,
      folderId: m.folder_id,
      title: m.title,
      content: m.content,
      thumbnailPath: m.thumbnail_path ?? undefined,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
      lastOpenedAt: 0
    }));

    return { success: true, data: notes };
  } catch (error) {
    console.error('[Sync] Download memos exception:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Supabaseから下書きメモをダウンロード
 */
export async function downloadQuickMemo(): Promise<{ success: boolean; data?: QuickMemo; error?: string }> {
  const authState = await getAuthState();
  if (!authState.isAuthenticated || !authState.userId) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const { data, error } = await supabase
      .from('quick_memo')
      .select('*')
      .eq('user_id', authState.userId)
      .single();

    if (error) {
    // レコードが存在しない場合は空の下書きメモを返す
      if (error.code === 'PGRST116') {
        return { success: true, data: { content: '', updatedAt: Date.now() } };
      }
      console.error('[Sync] Download quick memo error:', error);
      return { success: false, error: error.message };
    }

    const quickMemo: QuickMemo = {
      content: data.content,
      updatedAt: data.updated_at
    };

    return { success: true, data: quickMemo };
  } catch (error) {
    console.error('[Sync] Download quick memo exception:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * メモを削除
 */
export async function deleteMemo(noteId: string): Promise<{ success: boolean; error?: string }> {
  const authState = await getAuthState();
  if (!authState.isAuthenticated || !authState.userId) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const { error } = await supabase
      .from('memos')
      .delete()
      .eq('id', noteId)
      .eq('user_id', authState.userId);

    if (error) {
      console.error('[Sync] Delete memo error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('[Sync] Delete memo exception:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * フォルダを削除
 */
export async function deleteFolder(folderId: string): Promise<{ success: boolean; error?: string }> {
  const authState = await getAuthState();
  if (!authState.isAuthenticated || !authState.userId) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const { error } = await supabase
      .from('folders')
      .delete()
      .eq('id', folderId)
      .eq('user_id', authState.userId);

    if (error) {
      console.error('[Sync] Delete folder error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('[Sync] Delete folder exception:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * 完全同期（アップロード + ダウンロード）
 */
export async function fullSync(): Promise<{ success: boolean; error?: string }> {
  if (isSyncing) {
    return { success: false, error: 'Sync already in progress' };
  }

  const authState = await getAuthState();
  if (!authState.isAuthenticated || !authState.userId) {
    return { success: false, error: 'Not authenticated' };
  }

  isSyncing = true;

  try {
    console.log('[Sync] Starting full sync...');

    const localState = await chrome.storage.local.get([LAST_SYNC_USER_ID_KEY]);
    const lastSyncedUserId =
      typeof localState[LAST_SYNC_USER_ID_KEY] === 'string'
        ? (localState[LAST_SYNC_USER_ID_KEY] as string)
        : null;

    const isDifferentUser = !!lastSyncedUserId && lastSyncedUserId !== authState.userId;

    // アカウント切替時は、旧アカウントのローカルデータを新アカウントへ誤同期しないためにダウンロードのみ行う
    if (!isDifferentUser) {
      // ローカルデータを取得
      const localData = await chrome.storage.local.get(['notes', 'quickMemo']);
      const syncData = await chrome.storage.sync.get(['folders', 'noteMetadata']);

      // フォルダをアップロード
      const folders = syncData.folders || {};
      for (const folder of Object.values(folders) as Folder[]) {
        await uploadFolder(folder);
      }

      // メモをアップロード
      const notes = localData.notes || {};
      for (const note of Object.values(notes) as Note[]) {
        await uploadMemo(note);
      }

      // 下書きメモをアップロード
      const quickMemo = localData.quickMemo || { content: '', updatedAt: Date.now() };
      await uploadQuickMemo(quickMemo);
    } else {
      console.warn('[Sync] Different user detected, running download-only sync to avoid data leakage');
      await chrome.storage.sync.remove(['folderOrder', 'noteMetadata']);
    }

    // ダウンロード（他のデバイスからの更新を取得）
    const foldersResult = await downloadFolders();
    const memosResult = await downloadMemos();
    const quickMemoResult = await downloadQuickMemo();

    if (!foldersResult.success || !foldersResult.data) {
      return { success: false, error: foldersResult.error || 'Failed to download folders' };
    }
    if (!memosResult.success || !memosResult.data) {
      return { success: false, error: memosResult.error || 'Failed to download memos' };
    }
    if (!quickMemoResult.success || !quickMemoResult.data) {
      return { success: false, error: quickMemoResult.error || 'Failed to download quick memo' };
    }

    const foldersObj: Record<string, Folder> = {};
    foldersResult.data.forEach(f => { foldersObj[f.id] = f; });

    const notesObj: Record<string, Note> = {};
    const noteMetadataObj: Record<string, NoteMetadata> = {};
    memosResult.data.forEach(n => {
      notesObj[n.id] = n;
      noteMetadataObj[n.id] = {
        id: n.id,
        folderId: n.folderId,
        title: n.title,
        thumbnailPath: n.thumbnailPath,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        lastOpenedAt: n.lastOpenedAt
      };
    });

    await Promise.all([
      chrome.storage.sync.set({ folders: foldersObj, noteMetadata: noteMetadataObj }),
      chrome.storage.local.set({
        notes: notesObj,
        quickMemo: quickMemoResult.data,
        [LAST_SYNC_USER_ID_KEY]: authState.userId
      })
    ]);

    if (isDifferentUser) {
      const stateAfter = await chrome.storage.sync.get(['folders', 'noteMetadata']);
      if (stateAfter.folders && stateAfter.noteMetadata) {
        console.log('[Sync] Download-only sync completed for new user');
      }
    }

    lastSyncTime = Date.now();
    console.log('[Sync] Full sync completed');

    return { success: true };
  } catch (error) {
    console.error('[Sync] Full sync exception:', error);
    return { success: false, error: String(error) };
  } finally {
    isSyncing = false;
  }
}
