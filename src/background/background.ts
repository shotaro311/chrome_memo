import {
  BACKUP_SCHEMA_VERSION,
  INBOX_FOLDER_ID,
  LIMITS,
  MessageType,
  type BackupFile,
  type BackupThumbnailV1,
  type Folder,
  type Note,
  type NoteMetadata,
  type QuickMemo,
  Message,
  Response
} from '../types';
import {
  initializeStorage,
  getFolders,
  createFolder,
  deleteFolder,
  renameFolder,
  updateFolderOrder,
  getNotesInFolder,
  getNote,
  getAllNotes,
  createNote,
  updateNote,
  deleteNote,
  markNoteAsOpened,
  getRecentNotes,
  getQuickMemo,
  updateQuickMemo,
  saveQuickMemoAsNote,
  searchNotes,
  getSettings,
  updateSettings
} from '../utils/storage';
import { getAuthState, onAuthStateChange, signInWithGoogle, signOut } from '../lib/auth';
import { deleteFolder as deleteFolderSync, deleteMemo, fullSync, uploadFolder, uploadMemo, uploadQuickMemo } from '../lib/sync';
import { chromeStorage } from '../lib/chromeStorage';
import { generateGeminiText } from '../lib/gemini';
import {
  buildThumbnailPath,
  createThumbnailSignedUrl,
  deleteThumbnail,
  downloadThumbnailWebp,
  uploadThumbnailWebp,
  DEFAULT_THUMBNAIL_SIGNED_URL_EXPIRES_SEC
} from '../lib/thumbnail';

function base64ToArrayBuffer(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function normalizeKey(text: string) {
  return text.trim().toLowerCase();
}

function generateImportId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function normalizeThumbnailData(data: unknown) {
  if (typeof data === 'string') {
    return { success: true as const, buffer: base64ToArrayBuffer(data) };
  }
  if (data instanceof ArrayBuffer) {
    return { success: true as const, buffer: data };
  }
  if (typeof SharedArrayBuffer !== 'undefined' && data instanceof SharedArrayBuffer) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(new Uint8Array(data));
    return { success: true as const, buffer: copy.buffer };
  }
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    const copy = new Uint8Array(view.byteLength);
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return { success: true as const, buffer: copy.buffer };
  }
  return { success: false as const, error: 'サムネのデータ形式が不正です' };
}

// ========================================
// インストール時の初期化
// ========================================

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Background] Extension installed');
  await initializeStorage();
});

// ========================================
// 認証状態の監視と自動同期
// ========================================

// 認証状態の変更を監視
onAuthStateChange(async (state) => {
  console.log('[Background] Auth state changed:', state);
  if (state.isAuthenticated) {
    console.log('[Background] Auto-syncing...');
    const result = await fullSync();
    if (result.success) {
      console.log('[Background] Auto-sync completed');
    } else {
      console.error('[Background] Auto-sync failed:', result.error);
    }
  }
});

// ========================================
// アイコンクリック時の処理
// ========================================

chrome.action.onClicked.addListener(async (tab) => {
  console.log('[Background] Action icon clicked');

  if (!tab?.id) {
    console.error('[Background] No active tab found');
    return;
  }

  // 注入不可ページのチェック
  if (isInjectionBlockedUrl(tab.url)) {
    console.warn('[Background] Cannot inject into this page:', tab.url);
    return;
  }

  try {
    // パネルを開く
    await chrome.tabs.sendMessage(tab.id, {
      type: MessageType.OPEN_PANEL
    });
  } catch (error) {
    console.error('[Background] Error opening panel:', error);
  }
});

// ========================================
// ショートカットキーの処理
// ========================================

chrome.commands.onCommand.addListener(async (command) => {
  console.log('[Background] Command received:', command);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    console.error('[Background] No active tab found');
    return;
  }

  // 注入不可ページのチェック
  if (isInjectionBlockedUrl(tab.url)) {
    console.warn('[Background] Cannot inject into this page:', tab.url);

    // ショートカット案内をポップアップ内で表示するために設定を更新
    // （実際のエラー表示はPopup側で行う）
    return;
  }

  try {
    switch (command) {
      case 'toggle-panel':
        // パネルの開閉
        await chrome.tabs.sendMessage(tab.id, {
          type: MessageType.TOGGLE_PANEL
        });
        break;

      default:
        console.warn('[Background] Unknown command:', command);
    }
  } catch (error) {
    console.error('[Background] Error handling command:', error);
  }
});

// ========================================
// メッセージハンドラ
// ========================================

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  const isGeminiMessage = message.type === MessageType.GEMINI_GENERATE;
  if (isGeminiMessage) {
    console.log('[Background] Message received:', { type: message.type });
  } else {
    console.log('[Background] Message received:', message);
  }

  handleMessage(message)
    .then(response => {
      if (isGeminiMessage) {
        console.log('[Background] Sending response:', { success: response.success });
      } else {
        console.log('[Background] Sending response:', response);
      }
      sendResponse(response);
    })
    .catch(error => {
      console.error('[Background] Error handling message:', error);
      sendResponse({
        success: false,
        error: error.message || '不明なエラーが発生しました'
      });
    });

  // 非同期レスポンスを返すためにtrueを返す
  return true;
});

/**
 * メッセージを処理
 */
async function handleMessage(message: Message): Promise<Response> {
  try {
    switch (message.type) {
      // 認証
      case MessageType.AUTH_SIGN_IN: {
        const result = await signInWithGoogle();
        if (!result.success) {
          return { success: false, error: result.error || 'サインインに失敗しました' };
        }
        return { success: true, data: null };
      }

      case MessageType.AUTH_SIGN_OUT: {
        const result = await signOut();
        if (!result.success) {
          return { success: false, error: result.error || 'サインアウトに失敗しました' };
        }
        return { success: true, data: null };
      }

      case MessageType.AUTH_GET_STATE: {
        const state = await getAuthState();
        return { success: true, data: state };
      }

      case MessageType.AUTH_SYNC_NOW: {
        const result = await fullSync();
        if (!result.success) {
          return { success: false, error: result.error || '同期に失敗しました' };
        }
        return { success: true, data: null };
      }

      // 設定
      case MessageType.GET_SETTINGS: {
        const settings = await getSettings();
        return { success: true, data: settings };
      }

      case MessageType.UPDATE_SETTINGS: {
        const settings = await updateSettings(message.updates);
        return { success: true, data: settings };
      }

      // AI
      case MessageType.GEMINI_GENERATE: {
        const apiKey = await chromeStorage.getItem('geminiApiKey');
        if (!apiKey) {
          return { success: false, error: 'Gemini APIキーが未設定です' };
        }
        const result = await generateGeminiText({
          apiKey,
          prompt: message.prompt,
          model: message.model
        });
        if (!result.success) {
          return { success: false, error: result.error || 'Geminiの呼び出しに失敗しました' };
        }
        return { success: true, data: result.text };
      }

      // フォルダ操作
      case MessageType.GET_FOLDERS: {
        const folders = await getFolders();
        return { success: true, data: folders };
      }

      case MessageType.CREATE_FOLDER: {
        const folder = await createFolder(message.name);
        return { success: true, data: folder };
      }

      case MessageType.DELETE_FOLDER: {
        const notesInFolder = await getNotesInFolder(message.folderId);
        const thumbnailPaths = notesInFolder
          .map(note => note.thumbnailPath)
          .filter((path): path is string => Boolean(path));

        await deleteFolder(message.folderId);
        const syncResult = await deleteFolderSync(message.folderId);
        if (!syncResult.success && syncResult.error !== 'Not authenticated') {
          console.error('[Background] Delete folder sync error:', syncResult.error);
        }
        for (const path of thumbnailPaths) {
          const deleteResult = await deleteThumbnail({ path });
          if (!deleteResult.success && deleteResult.error !== 'Not authenticated') {
            console.error('[Background] Delete thumbnail error:', deleteResult.error);
          }
        }
        return { success: true, data: null };
      }

      case MessageType.RENAME_FOLDER: {
        await renameFolder(message.folderId, message.newName);
        return { success: true, data: null };
      }

      case MessageType.UPDATE_FOLDER_ORDER: {
        await updateFolderOrder(message.order);
        return { success: true, data: null };
      }

      // メモ操作
      case MessageType.GET_NOTES_IN_FOLDER: {
        const notes = await getNotesInFolder(message.folderId);
        return { success: true, data: notes };
      }

      case MessageType.GET_NOTE: {
        const note = await getNote(message.noteId);
        return { success: true, data: note };
      }

      case MessageType.CREATE_NOTE: {
        const note = await createNote(message.folderId, message.title);
        return { success: true, data: note };
      }

      case MessageType.UPDATE_NOTE: {
        const note = await updateNote(message.noteId, {
          title: message.title,
          content: message.content,
          folderId: message.folderId,
          thumbnailPath: message.thumbnailPath
        });
        return { success: true, data: note };
      }

      case MessageType.DELETE_NOTE: {
        const note = await getNote(message.noteId);
        if (note?.thumbnailPath) {
          const deleteResult = await deleteThumbnail({ path: note.thumbnailPath });
          if (!deleteResult.success && deleteResult.error !== 'Not authenticated') {
            console.error('[Background] Delete thumbnail error:', deleteResult.error);
          }
        }
        await deleteNote(message.noteId);
        const syncResult = await deleteMemo(message.noteId);
        if (!syncResult.success && syncResult.error !== 'Not authenticated') {
          console.error('[Background] Delete memo sync error:', syncResult.error);
        }
        return { success: true, data: null };
      }

      case MessageType.OPEN_NOTE: {
        await markNoteAsOpened(message.noteId);
        const note = await getNote(message.noteId);
        return { success: true, data: note };
      }

      case MessageType.SET_NOTE_THUMBNAIL: {
        const authState = await getAuthState();
        if (!authState.isAuthenticated || !authState.userId) {
          return { success: false, error: 'サインインが必要です' };
        }

        const note = await getNote(message.noteId);
        if (!note) {
          return { success: false, error: 'メモが見つかりません' };
        }

        const nextPath = buildThumbnailPath({ userId: authState.userId, noteId: note.id });
        const prevPath = note.thumbnailPath;

        const normalized = normalizeThumbnailData(message.data);
        if (!normalized.success) {
          return { success: false, error: normalized.error };
        }

	        const uploadResult = await uploadThumbnailWebp({ path: nextPath, data: normalized.buffer });
        if (!uploadResult.success) {
          return {
            success: false,
            error:
	              uploadResult.error === 'Not authenticated'
	                ? 'サインインが必要です'
	                : (uploadResult.error ?? 'サムネのアップロードに失敗しました')
	          };
	        }

	        const memoUploadResult = await uploadMemo({
	          ...note,
	          thumbnailPath: nextPath,
	          updatedAt: Date.now()
	        });
	        if (!memoUploadResult.success) {
	          await deleteThumbnail({ path: nextPath });
	          return {
	            success: false,
	            error:
	              memoUploadResult.error === 'Not authenticated'
	                ? 'サインインが必要です'
	                : (memoUploadResult.error ?? '同期に失敗しました')
	          };
	        }

        const updatedNote = await updateNote(note.id, { thumbnailPath: nextPath });
        if (prevPath && prevPath !== nextPath) {
          const deleteResult = await deleteThumbnail({ path: prevPath });
          if (!deleteResult.success && deleteResult.error !== 'Not authenticated') {
            console.error('[Background] Delete thumbnail error:', deleteResult.error);
          }
        }
        return { success: true, data: updatedNote };
      }

      case MessageType.DELETE_NOTE_THUMBNAIL: {
        const authState = await getAuthState();
        if (!authState.isAuthenticated || !authState.userId) {
          return { success: false, error: 'サインインが必要です' };
        }

        const note = await getNote(message.noteId);
        if (!note) {
          return { success: false, error: 'メモが見つかりません' };
        }
        if (!note.thumbnailPath) {
          return { success: true, data: note };
        }

	        const memoUploadResult = await uploadMemo({
	          ...note,
	          thumbnailPath: undefined,
	          updatedAt: Date.now()
	        });
	        if (!memoUploadResult.success) {
	          return {
	            success: false,
	            error:
	              memoUploadResult.error === 'Not authenticated'
	                ? 'サインインが必要です'
	                : (memoUploadResult.error ?? '同期に失敗しました')
	          };
	        }

        const updatedNote = await updateNote(note.id, { thumbnailPath: null });
        const deleteResult = await deleteThumbnail({ path: note.thumbnailPath });
        if (!deleteResult.success && deleteResult.error !== 'Not authenticated') {
          console.error('[Background] Delete thumbnail error:', deleteResult.error);
        }
        return { success: true, data: updatedNote };
      }

      case MessageType.GET_NOTE_THUMBNAIL_URL: {
        const authState = await getAuthState();
        if (!authState.isAuthenticated || !authState.userId) {
          return { success: false, error: 'サインインが必要です' };
        }

        const note = await getNote(message.noteId);
        if (!note) {
          return { success: false, error: 'メモが見つかりません' };
        }
        if (!note.thumbnailPath) {
          return { success: false, error: 'サムネが設定されていません' };
        }

	        const signed = await createThumbnailSignedUrl({
	          path: note.thumbnailPath,
	          expiresIn: message.expiresIn ?? DEFAULT_THUMBNAIL_SIGNED_URL_EXPIRES_SEC
	        });
	        if (!signed.success) {
	          return {
	            success: false,
	            error:
	              signed.error === 'Not authenticated'
	                ? 'サインインが必要です'
	                : (signed.error ?? '署名URLの取得に失敗しました')
	          };
	        }
        return { success: true, data: signed.url };
      }

      case MessageType.GET_RECENT_NOTES: {
        const notes = await getRecentNotes();
        return { success: true, data: notes };
      }

	      case MessageType.GET_EXPORT_DATA: {
	        return await handleGetExportData();
	      }

	      case MessageType.IMPORT_BACKUP_DATA: {
	        return await handleImportBackupData(message.data);
	      }

      // 下書きメモ操作
      case MessageType.GET_QUICK_MEMO: {
        const quickMemo = await getQuickMemo();
        return { success: true, data: quickMemo };
      }

      case MessageType.UPDATE_QUICK_MEMO: {
        const quickMemo = await updateQuickMemo(message.content);
        return { success: true, data: quickMemo };
      }

      case MessageType.SAVE_QUICK_MEMO_AS_NOTE: {
        const note = await saveQuickMemoAsNote(message.folderId, message.title);
        return { success: true, data: note };
      }

      // 検索
      case MessageType.SEARCH_NOTES: {
        const notes = await searchNotes(message.query, message.folderId);
        return { success: true, data: notes };
      }

      default:
        return { success: false, error: '不明なメッセージタイプです' };
    }
  } catch (error: any) {
    return { success: false, error: error.message || '不明なエラーが発生しました' };
  }
}

// ========================================
// バックアップ（エクスポート/インポート）
// ========================================

async function handleGetExportData(): Promise<Response<BackupFile>> {
  const [folders, notes, quickMemo, settings, syncData] = await Promise.all([
    getFolders(),
    getAllNotes(),
    getQuickMemo(),
    getSettings(),
    chrome.storage.sync.get(['folderOrder'])
  ]);

  const folderOrder = Array.isArray(syncData.folderOrder) ? syncData.folderOrder : undefined;

  const notesWithThumbnail = notes.filter((note) => typeof note.thumbnailPath === 'string' && note.thumbnailPath.length > 0);
  let thumbnailsByNoteId: Record<string, BackupThumbnailV1> | undefined = undefined;

  if (notesWithThumbnail.length > 0) {
    const authState = await getAuthState();
    if (!authState.isAuthenticated) {
      return { success: false, error: 'サムネイルを含めてエクスポートするにはサインインが必要です' };
    }

    thumbnailsByNoteId = {};

    for (const note of notesWithThumbnail) {
      const result = await downloadThumbnailWebp({ path: note.thumbnailPath as string });
      if (!result.success) {
        return {
          success: false,
          error: result.error === 'Not authenticated' ? 'サインインが必要です' : (result.error ?? 'サムネイルの取得に失敗しました')
        };
      }

      thumbnailsByNoteId[note.id] = {
        mimeType: 'image/webp',
        base64: arrayBufferToBase64(result.buffer)
      };
    }
  }

  const data: BackupFile = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    folders,
    folderOrder,
    notes,
    quickMemo,
    settings,
    thumbnailsByNoteId
  };

  return { success: true, data };
}

function validateBackupFile(data: unknown): { success: true; backup: BackupFile } | { success: false; error: string } {
  if (!data || typeof data !== 'object') {
    return { success: false, error: 'バックアップ形式が不正です' };
  }

  const obj = data as Record<string, unknown>;
  if (obj.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    return { success: false, error: 'バックアップのバージョンが不正です' };
  }

  if (typeof obj.exportedAt !== 'string') {
    return { success: false, error: 'バックアップ形式が不正です（exportedAt）' };
  }
  if (!Array.isArray(obj.folders) || !Array.isArray(obj.notes)) {
    return { success: false, error: 'バックアップ形式が不正です（folders/notes）' };
  }

  const quickMemo = obj.quickMemo as Record<string, unknown> | undefined;
  if (!quickMemo || typeof quickMemo.content !== 'string' || typeof quickMemo.updatedAt !== 'number') {
    return { success: false, error: 'バックアップ形式が不正です（quickMemo）' };
  }

  const settings = obj.settings as Record<string, unknown> | undefined;
  if (
    !settings ||
    typeof settings.shortcutGuideShown !== 'boolean' ||
    typeof settings.memoFontSize !== 'number' ||
    typeof settings.panelLastWidth !== 'number' ||
    typeof settings.panelLastHeight !== 'number'
  ) {
    return { success: false, error: 'バックアップ形式が不正です（settings）' };
  }

  return { success: true, backup: data as BackupFile };
}

function buildUniqueTitle(params: { desiredTitle: string; used: Set<string> }) {
  const base = params.desiredTitle.trim() || 'Imported Note';
  let candidate = base;
  let suffix = 2;

  while (params.used.has(normalizeKey(candidate))) {
    candidate = `${base} (import ${suffix})`;
    suffix += 1;
  }

  params.used.add(normalizeKey(candidate));
  return candidate;
}

async function handleImportBackupData(
  rawData: unknown
): Promise<Response<{
  addedFolders: number;
  addedNotes: number;
  restoredThumbnails: number;
  sync: { success: boolean; error?: string };
}>> {
  const validated = validateBackupFile(rawData);
  if (!validated.success) {
    return { success: false, error: validated.error };
  }

  const backup = validated.backup;

  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get(['folders', 'folderOrder', 'noteMetadata', 'settings']),
    chrome.storage.local.get(['notes', 'quickMemo'])
  ]);

  const existingFolderMap = (syncData.folders || {}) as Record<string, Folder>;
  const existingNotesMap = (localData.notes || {}) as Record<string, Note>;
  const existingMetadataMap = (syncData.noteMetadata || {}) as Record<string, NoteMetadata>;

  const existingFolderIdByName = new Map<string, string>();
  for (const folder of Object.values(existingFolderMap)) {
    existingFolderIdByName.set(normalizeKey(folder.name), folder.id);
  }

  const folderIdMap = new Map<string, string>();
  folderIdMap.set(INBOX_FOLDER_ID, INBOX_FOLDER_ID);

  const foldersToAdd: Record<string, Folder> = {};
  let addedFolders = 0;

  for (const folder of backup.folders) {
    if (!folder || typeof folder !== 'object') {
      return { success: false, error: 'バックアップ形式が不正です（folder）' };
    }

    const f = folder as Folder;
    if (f.id === INBOX_FOLDER_ID || f.isSystem) {
      folderIdMap.set(f.id, INBOX_FOLDER_ID);
      continue;
    }

    const name = typeof f.name === 'string' ? f.name.trim() : '';
    if (!name) {
      return { success: false, error: 'バックアップ形式が不正です（folder.name）' };
    }

    const existingId = existingFolderIdByName.get(normalizeKey(name));
    if (existingId) {
      folderIdMap.set(f.id, existingId);
      continue;
    }

    let id = typeof f.id === 'string' ? f.id : generateImportId();
    if (!id || id === INBOX_FOLDER_ID || existingFolderMap[id] || foldersToAdd[id]) {
      id = generateImportId();
    }

    foldersToAdd[id] = {
      id,
      name,
      createdAt: typeof f.createdAt === 'number' ? f.createdAt : Date.now(),
      isSystem: false
    };

    folderIdMap.set(f.id, id);
    existingFolderIdByName.set(normalizeKey(name), id);
    addedFolders += 1;
  }

  if (Object.keys(existingFolderMap).length + Object.keys(foldersToAdd).length > LIMITS.MAX_FOLDERS) {
    return { success: false, error: `フォルダ数の上限（${LIMITS.MAX_FOLDERS}）に達するため、インポートできません` };
  }

  const mergedFolderMap: Record<string, Folder> = { ...existingFolderMap, ...foldersToAdd };

  const existingFolderOrder = Array.isArray(syncData.folderOrder) ? syncData.folderOrder : undefined;
  let nextFolderOrder: string[] | undefined = existingFolderOrder ? [...existingFolderOrder] : undefined;

  if (nextFolderOrder && Object.keys(foldersToAdd).length > 0) {
    const importedOrderSource = Array.isArray(backup.folderOrder)
      ? backup.folderOrder
      : backup.folders.map(folder => (folder as Folder).id);

    const seen = new Set(nextFolderOrder);
    for (const oldId of importedOrderSource) {
      const mappedId = folderIdMap.get(oldId);
      if (!mappedId || mappedId === INBOX_FOLDER_ID) continue;
      if (!mergedFolderMap[mappedId]) continue;
      if (seen.has(mappedId)) continue;
      nextFolderOrder.push(mappedId);
      seen.add(mappedId);
    }
  }

  const existingCountsByFolder = new Map<string, number>();
  const usedTitlesByFolder = new Map<string, Set<string>>();

  for (const note of Object.values(existingNotesMap)) {
    existingCountsByFolder.set(note.folderId, (existingCountsByFolder.get(note.folderId) ?? 0) + 1);
    const set = usedTitlesByFolder.get(note.folderId) ?? new Set<string>();
    set.add(normalizeKey(note.title));
    usedTitlesByFolder.set(note.folderId, set);
  }

  const incomingCountsByFolder = new Map<string, number>();
  for (const note of backup.notes) {
    const n = note as Note;
    const folderId = folderIdMap.get(n.folderId) ?? INBOX_FOLDER_ID;
    incomingCountsByFolder.set(folderId, (incomingCountsByFolder.get(folderId) ?? 0) + 1);
  }

  for (const [folderId, count] of incomingCountsByFolder) {
    const current = existingCountsByFolder.get(folderId) ?? 0;
    if (current + count > LIMITS.MAX_NOTES_PER_FOLDER) {
      return { success: false, error: `フォルダ内メモ数の上限（${LIMITS.MAX_NOTES_PER_FOLDER}）に達するため、インポートできません` };
    }
  }

  if (Object.keys(existingNotesMap).length + backup.notes.length > LIMITS.MAX_TOTAL_NOTES) {
    return { success: false, error: `総メモ数の上限（${LIMITS.MAX_TOTAL_NOTES}）に達するため、インポートできません` };
  }

  const notesToAdd: Record<string, Note> = {};
  const metadataToAdd: Record<string, NoteMetadata> = {};
  const noteIdMap = new Map<string, string>();

  for (const note of backup.notes) {
    if (!note || typeof note !== 'object') {
      return { success: false, error: 'バックアップ形式が不正です（note）' };
    }

    const n = note as Note;
    if (typeof n.id !== 'string' || typeof n.content !== 'string' || typeof n.title !== 'string' || typeof n.folderId !== 'string') {
      return { success: false, error: 'バックアップ形式が不正です（note fields）' };
    }

    if (n.content.length > LIMITS.MAX_NOTE_LENGTH) {
      return { success: false, error: `メモの最大文字数（${LIMITS.MAX_NOTE_LENGTH}）を超えているため、インポートできません` };
    }

    const folderId = folderIdMap.get(n.folderId) ?? INBOX_FOLDER_ID;

    let id = generateImportId();
    while (existingNotesMap[id] || notesToAdd[id]) {
      id = generateImportId();
    }

    const used = usedTitlesByFolder.get(folderId) ?? new Set<string>();
    const title = buildUniqueTitle({ desiredTitle: n.title, used });
    usedTitlesByFolder.set(folderId, used);

    const createdAt = typeof n.createdAt === 'number' ? n.createdAt : Date.now();
    const updatedAt = typeof n.updatedAt === 'number' ? n.updatedAt : createdAt;
    const lastOpenedAt = typeof n.lastOpenedAt === 'number' ? n.lastOpenedAt : 0;

    notesToAdd[id] = {
      id,
      folderId,
      title,
      content: n.content,
      createdAt,
      updatedAt,
      lastOpenedAt
    };

    noteIdMap.set(n.id, id);
  }

  const thumbnailsByNoteId = backup.thumbnailsByNoteId ?? {};
  const thumbnailKeys = Object.keys(thumbnailsByNoteId);

  if (!backup.thumbnailsByNoteId) {
    const legacyHasThumbnailPath = backup.notes.some(note => typeof (note as Note).thumbnailPath === 'string' && (note as Note).thumbnailPath?.length);
    if (legacyHasThumbnailPath) {
      return { success: false, error: 'このバックアップにはサムネイルが含まれていません（古い形式の可能性があります）' };
    }
  }

  let restoredThumbnails = 0;

  if (thumbnailKeys.length > 0) {
    const authState = await getAuthState();
    if (!authState.isAuthenticated || !authState.userId) {
      return { success: false, error: 'サムネイルの復元にはサインインが必要です' };
    }

    for (const oldNoteId of thumbnailKeys) {
      const thumb = thumbnailsByNoteId[oldNoteId] as BackupThumbnailV1 | undefined;
      if (!thumb || thumb.mimeType !== 'image/webp' || typeof thumb.base64 !== 'string') {
        return { success: false, error: 'バックアップ形式が不正です（thumbnail）' };
      }

      const newNoteId = noteIdMap.get(oldNoteId);
      if (!newNoteId) continue;

      const buffer = base64ToArrayBuffer(thumb.base64);
      const path = buildThumbnailPath({ userId: authState.userId, noteId: newNoteId });
      const uploaded = await uploadThumbnailWebp({ path, data: buffer });
      if (!uploaded.success) {
        return { success: false, error: uploaded.error ?? 'サムネイルの復元に失敗しました' };
      }

      notesToAdd[newNoteId].thumbnailPath = path;
      restoredThumbnails += 1;
    }
  }

  for (const note of Object.values(notesToAdd)) {
    metadataToAdd[note.id] = {
      id: note.id,
      folderId: note.folderId,
      title: note.title,
      thumbnailPath: note.thumbnailPath,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      lastOpenedAt: note.lastOpenedAt
    };
  }

  await Promise.all([
    chrome.storage.sync.set({
      folders: mergedFolderMap,
      noteMetadata: { ...existingMetadataMap, ...metadataToAdd },
      ...(nextFolderOrder ? { folderOrder: nextFolderOrder } : {}),
      settings: backup.settings
    }),
    chrome.storage.local.set({
      notes: { ...existingNotesMap, ...notesToAdd },
      quickMemo: backup.quickMemo
    })
  ]);

  const authState = await getAuthState();
  let sync: { success: boolean; error?: string } = { success: false, error: '未サインインのため、Supabaseへの同期は行っていません' };

  if (authState.isAuthenticated) {
    let syncError: string | null = null;
    const folderIds = new Set<string>();

    for (const note of Object.values(notesToAdd)) {
      folderIds.add(note.folderId);
    }

    for (const folderId of folderIds) {
      const folder = mergedFolderMap[folderId];
      if (!folder) continue;
      const result = await uploadFolder(folder);
      if (!result.success) {
        syncError = result.error || 'Supabaseへのフォルダ同期に失敗しました';
        break;
      }
    }

    if (!syncError) {
      for (const note of Object.values(notesToAdd)) {
        const result = await uploadMemo(note);
        if (!result.success) {
          syncError = result.error || 'Supabaseへのメモ同期に失敗しました';
          break;
        }
      }
    }

    if (!syncError) {
      const result = await uploadQuickMemo(backup.quickMemo);
      if (!result.success) {
        syncError = result.error || 'Supabaseへの下書きメモ同期に失敗しました';
      }
    }

    sync = syncError ? { success: false, error: syncError } : { success: true };
  }

  return {
    success: true,
    data: {
      addedFolders,
      addedNotes: Object.keys(notesToAdd).length,
      restoredThumbnails,
      sync
    }
  };
}

// ========================================
// ユーティリティ
// ========================================

/**
 * 注入がブロックされるURLかどうかを判定
 */
function isInjectionBlockedUrl(url: string | undefined): boolean {
  if (!url) return true;

  const blockedPrefixes = [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'about:',
    'view-source:'
  ];

  const blockedDomains = [
    'chrome.google.com/webstore'
  ];

  // プレフィックスチェック
  for (const prefix of blockedPrefixes) {
    if (url.startsWith(prefix)) {
      return true;
    }
  }

  // ドメインチェック
  for (const domain of blockedDomains) {
    if (url.includes(domain)) {
      return true;
    }
  }

  return false;
}

console.log('[Background] Service worker loaded');
