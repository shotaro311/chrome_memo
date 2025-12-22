import { MessageType, Message, Response } from '../types';
import {
  initializeStorage,
  getFolders,
  createFolder,
  deleteFolder,
  renameFolder,
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
import { fullSync } from '../lib/sync';

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
  console.log('[Background] Message received:', message);

  handleMessage(message)
    .then(response => {
      console.log('[Background] Sending response:', response);
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
        await deleteFolder(message.folderId);
        return { success: true, data: null };
      }

      case MessageType.RENAME_FOLDER: {
        await renameFolder(message.folderId, message.newName);
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
          content: message.content
        });
        return { success: true, data: note };
      }

      case MessageType.DELETE_NOTE: {
        await deleteNote(message.noteId);
        return { success: true, data: null };
      }

      case MessageType.OPEN_NOTE: {
        await markNoteAsOpened(message.noteId);
        const note = await getNote(message.noteId);
        return { success: true, data: note };
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
