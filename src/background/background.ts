import { MessageType, Message, Response } from '../types';
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
import { deleteFolder as deleteFolderSync, deleteMemo, fullSync, uploadMemo } from '../lib/sync';
import { chromeStorage } from '../lib/chromeStorage';
import { generateGeminiText } from '../lib/gemini';
import {
  buildThumbnailPath,
  createThumbnailSignedUrl,
  deleteThumbnail,
  uploadThumbnailWebp,
  DEFAULT_THUMBNAIL_SIGNED_URL_EXPIRES_SEC
} from '../lib/thumbnail';

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

	        const uploadResult = await uploadThumbnailWebp({ path: nextPath, data: message.data });
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
        const [folders, notes, quickMemo, settings] = await Promise.all([
          getFolders(),
          getAllNotes(),
          getQuickMemo(),
          getSettings()
        ]);
        return {
          success: true,
          data: {
            exportedAt: new Date().toISOString(),
            folders,
            notes,
            quickMemo,
            settings
          }
        };
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
