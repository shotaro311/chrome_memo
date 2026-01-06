import { MessageType, Folder, Note, INBOX_FOLDER_ID } from '../types';
import { getAuthState } from '../lib/auth';

// ========================================
// グローバル変数
// ========================================

let folders: Folder[] = [];
let recentNotes: Note[] = [];
let selectedFolderId: string = INBOX_FOLDER_ID;
let notesInFolder: Note[] = [];

// ========================================
// 初期化
// ========================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Popup] Initializing...');

  setupEventListeners();

  try {
    // 認証状態をチェック
    await updateAuthUI();

    await loadData();
    render();
  } catch (error) {
    console.error('[Popup] Initialization failed:', error);
    showAuthError(`初期化に失敗しました: ${String(error)}`);
  }

  console.log('[Popup] Initialized');
});

// ========================================
// データ読み込み
// ========================================

async function loadData() {
  try {
    // フォルダ一覧を取得
    const foldersResponse = await chrome.runtime.sendMessage({
      type: MessageType.GET_FOLDERS
    });
    if (foldersResponse.success) {
      folders = foldersResponse.data;
    }

    // 最近使ったメモを取得
    const recentNotesResponse = await chrome.runtime.sendMessage({
      type: MessageType.GET_RECENT_NOTES
    });
    if (recentNotesResponse.success) {
      recentNotes = recentNotesResponse.data;
    }

    // 選択中フォルダのメモを取得
    await loadNotesInFolder(selectedFolderId);
  } catch (error) {
    console.error('[Popup] Error loading data:', error);
  }
}

async function loadNotesInFolder(folderId: string) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.GET_NOTES_IN_FOLDER,
      folderId
    });

    if (response.success) {
      notesInFolder = response.data;
    }
  } catch (error) {
    console.error('[Popup] Error loading notes in folder:', error);
  }
}

// ========================================
// レンダリング
// ========================================

function render() {
  renderRecentNotes();
  renderFolders();
  renderFolderSelect();
  renderNoteList();
}

function renderRecentNotes() {
  const container = document.getElementById('recent-notes');
  if (!container) return;

  if (recentNotes.length === 0) {
    container.innerHTML = '<div class="empty-message">最近使ったメモはありません</div>';
    return;
  }

  container.innerHTML = recentNotes
    .map(
      note => `
      <div class="recent-note-item" data-note-id="${note.id}">
        <div class="note-title">${escapeHtml(note.title)}</div>
        <div class="note-preview">${escapeHtml(note.content.substring(0, 30))}${note.content.length > 30 ? '...' : ''}</div>
      </div>
    `
    )
    .join('');

  // クリックイベント
  container.querySelectorAll('.recent-note-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      const noteId = (e.currentTarget as HTMLElement).getAttribute('data-note-id');
      if (noteId) {
        await openNoteInPanel(noteId);
      }
    });
  });
}

function renderFolders() {
  const container = document.getElementById('folder-list');
  if (!container) return;

  if (folders.length === 0) {
    container.innerHTML = '<div class="empty-message">フォルダがありません</div>';
    return;
  }

  container.innerHTML = folders
    .map(
      folder => `
      <div class="folder-item">
        <div class="folder-name">${escapeHtml(folder.name)}</div>
        <div class="folder-actions">
          ${
            !folder.isSystem
              ? `
            <button class="btn-icon rename-folder-btn" data-folder-id="${folder.id}" title="リネーム">✏️</button>
            <button class="btn-icon delete-folder-btn" data-folder-id="${folder.id}" title="削除">🗑️</button>
          `
              : ''
          }
        </div>
      </div>
    `
    )
    .join('');

  // リネームボタン
  container.querySelectorAll('.rename-folder-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const folderId = (e.currentTarget as HTMLElement).getAttribute('data-folder-id');
      if (folderId) {
        await handleRenameFolder(folderId);
      }
    });
  });

  // 削除ボタン
  container.querySelectorAll('.delete-folder-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const folderId = (e.currentTarget as HTMLElement).getAttribute('data-folder-id');
      if (folderId) {
        await handleDeleteFolder(folderId);
      }
    });
  });
}

function renderFolderSelect() {
  const select = document.getElementById('folder-select') as HTMLSelectElement;
  if (!select) return;

  select.innerHTML = folders
    .map(
      folder =>
        `<option value="${folder.id}" ${folder.id === selectedFolderId ? 'selected' : ''}>${escapeHtml(folder.name)}</option>`
    )
    .join('');
}

function renderNoteList() {
  const container = document.getElementById('note-list');
  if (!container) return;

  if (notesInFolder.length === 0) {
    container.innerHTML = '<div class="empty-message">メモがありません</div>';
    return;
  }

  container.innerHTML = notesInFolder
    .map(
      note => `
      <div class="note-item">
        <div class="note-title" data-note-id="${note.id}">${escapeHtml(note.title)}</div>
        <button class="btn-icon delete-note-btn" data-note-id="${note.id}" title="削除">🗑️</button>
      </div>
    `
    )
    .join('');

  // メモタイトルクリック
  container.querySelectorAll('.note-title').forEach(title => {
    title.addEventListener('click', async (e) => {
      const noteId = (e.currentTarget as HTMLElement).getAttribute('data-note-id');
      if (noteId) {
        await openNoteInPanel(noteId);
      }
    });
  });

  // 削除ボタン
  container.querySelectorAll('.delete-note-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const noteId = (e.currentTarget as HTMLElement).getAttribute('data-note-id');
      if (noteId) {
        await handleDeleteNote(noteId);
      }
    });
  });
}

// ========================================
// イベントリスナー設定
// ========================================

function setupEventListeners() {
  // 認証関連
  const signInBtn = document.getElementById('sign-in-btn');
  signInBtn?.addEventListener('click', handleSignIn);

  const signOutBtn = document.getElementById('sign-out-btn');
  signOutBtn?.addEventListener('click', handleSignOut);

  const syncFromRemoteBtn = document.getElementById('sync-from-remote-btn');
  syncFromRemoteBtn?.addEventListener('click', handleSyncFromRemote);

  const syncToRemoteBtn = document.getElementById('sync-to-remote-btn');
  syncToRemoteBtn?.addEventListener('click', handleSyncToRemote);

  // パネルを開くボタン
  const openPanelBtn = document.getElementById('open-panel-btn');
  openPanelBtn?.addEventListener('click', async () => {
    await openPanel();
  });

  // 新規フォルダボタン
  const createFolderBtn = document.getElementById('create-folder-btn');
  createFolderBtn?.addEventListener('click', handleCreateFolder);

  // 新規メモボタン
  const createNoteBtn = document.getElementById('create-note-btn');
  createNoteBtn?.addEventListener('click', handleCreateNote);

  // フォルダ選択
  const folderSelect = document.getElementById('folder-select') as HTMLSelectElement;
  folderSelect?.addEventListener('change', async (e) => {
    const select = e.target as HTMLSelectElement;
    selectedFolderId = select.value;
    await loadNotesInFolder(selectedFolderId);
    renderNoteList();
  });
}

// ========================================
// ハンドラ
// ========================================

async function handleCreateFolder() {
  const name = prompt('フォルダ名を入力してください:');
  if (!name) return;

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.CREATE_FOLDER,
      name
    });

    if (response.success) {
      await loadData();
      render();
    } else {
      alert(`エラー: ${response.error}`);
    }
  } catch (error) {
    console.error('[Popup] Error creating folder:', error);
    alert('フォルダの作成中にエラーが発生しました');
  }
}

async function handleRenameFolder(folderId: string) {
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;

  const newName = prompt('新しいフォルダ名を入力してください:', folder.name);
  if (!newName) return;

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.RENAME_FOLDER,
      folderId,
      newName
    });

    if (response.success) {
      await loadData();
      render();
    } else {
      alert(`エラー: ${response.error}`);
    }
  } catch (error) {
    console.error('[Popup] Error renaming folder:', error);
    alert('フォルダのリネーム中にエラーが発生しました');
  }
}

async function handleDeleteFolder(folderId: string) {
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;

  if (!confirm(`フォルダ「${folder.name}」とその中のメモをすべて削除しますか?`)) {
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.DELETE_FOLDER,
      folderId
    });

    if (response.success) {
      await loadData();
      render();
    } else {
      alert(`エラー: ${response.error}`);
    }
  } catch (error) {
    console.error('[Popup] Error deleting folder:', error);
    alert('フォルダの削除中にエラーが発生しました');
  }
}

async function handleCreateNote() {
  const title = prompt('メモのタイトルを入力してください（省略可）:');
  if (title === null) return; // キャンセル

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.CREATE_NOTE,
      folderId: INBOX_FOLDER_ID,
      title: title || undefined
    });

    if (response.success) {
      const note = response.data;

      // パネルを開いてメモを表示
      await openNoteInPanel(note.id);
    } else {
      alert(`エラー: ${response.error}`);
    }
  } catch (error) {
    console.error('[Popup] Error creating note:', error);
    alert('メモの作成中にエラーが発生しました');
  }
}

async function handleDeleteNote(noteId: string) {
  const note = notesInFolder.find(n => n.id === noteId);
  if (!note) return;

  if (!confirm(`メモ「${note.title}」を削除しますか?`)) {
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.DELETE_NOTE,
      noteId
    });

    if (response.success) {
      await loadData();
      render();
    } else {
      alert(`エラー: ${response.error}`);
    }
  } catch (error) {
    console.error('[Popup] Error deleting note:', error);
    alert('メモの削除中にエラーが発生しました');
  }
}

async function openPanel() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    alert('アクティブなタブが見つかりません');
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: MessageType.OPEN_PANEL
    });

    // ポップアップを閉じる
    window.close();
  } catch (error) {
    console.error('[Popup] Error opening panel:', error);
    alert('パネルを開けませんでした。このページでは拡張機能が動作しない可能性があります。');
  }
}

async function openNoteInPanel(noteId: string) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    alert('アクティブなタブが見つかりません');
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: MessageType.OPEN_PANEL,
      noteId
    });

    // ポップアップを閉じる
    window.close();
  } catch (error) {
    console.error('[Popup] Error opening note in panel:', error);
    alert('パネルを開けませんでした。このページでは拡張機能が動作しない可能性があります。');
  }
}

// ========================================
// 認証UI
// ========================================

async function updateAuthUI() {
  const authState = await getAuthState();

  const signedOutDiv = document.getElementById('auth-signed-out') as HTMLElement;
  const signedInDiv = document.getElementById('auth-signed-in') as HTMLElement;
  const userEmailSpan = document.getElementById('user-email') as HTMLElement;
  hideAuthError();

  if (authState.isAuthenticated && authState.email) {
    signedOutDiv.style.display = 'none';
    signedInDiv.style.display = 'block';
    userEmailSpan.textContent = authState.email;
  } else {
    signedOutDiv.style.display = 'block';
    signedInDiv.style.display = 'none';
  }
}

function showAuthError(message: string) {
  const el = document.getElementById('auth-error') as HTMLElement | null;
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
}

function hideAuthError() {
  const el = document.getElementById('auth-error') as HTMLElement | null;
  if (!el) return;
  el.textContent = '';
  el.style.display = 'none';
}

async function handleSignIn() {
  const signInBtn = document.getElementById('sign-in-btn') as HTMLButtonElement | null;
  const prevText = signInBtn?.textContent;
  if (signInBtn) {
    signInBtn.disabled = true;
    signInBtn.textContent = 'サインイン中...';
  }
  hideAuthError();

  try {
    const response = await chrome.runtime.sendMessage({ type: MessageType.AUTH_SIGN_IN });
    if (!response?.success) {
      showAuthError(`サインインに失敗しました: ${response?.error || '不明なエラーが発生しました'}`);
    } else {
      await updateAuthUI();
      await loadData();
      render();
    }
  } catch (error) {
    console.error('[Popup] Sign in failed:', error);
    showAuthError(`サインインに失敗しました: ${String(error)}`);
  }

  if (signInBtn) {
    signInBtn.disabled = false;
    signInBtn.textContent = prevText || 'Googleでサインイン';
  }
}

async function handleSignOut() {
  if (!confirm('サインアウトしますか？ローカルのメモは残りますが、同期は停止します。')) {
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({ type: MessageType.AUTH_SIGN_OUT });
    if (response?.success) {
      await updateAuthUI();
      alert('サインアウトしました');
    } else {
      alert(`サインアウトに失敗しました: ${response?.error || '不明なエラーが発生しました'}`);
    }
  } catch (error) {
    console.error('[Popup] Sign out failed:', error);
    alert(`サインアウトに失敗しました: ${String(error)}`);
  }
}

async function handleSyncFromRemote() {
  const ok = confirm(
    'リモートの内容でローカルを上書きします。未同期のローカルデータが失われる可能性があります。続行しますか？'
  );
  if (!ok) return;

  const syncFromBtn = document.getElementById('sync-from-remote-btn') as HTMLButtonElement;
  const syncToBtn = document.getElementById('sync-to-remote-btn') as HTMLButtonElement | null;
  const prevText = syncFromBtn?.textContent;
  if (syncFromBtn) {
    syncFromBtn.disabled = true;
    syncFromBtn.textContent = '同期中...';
  }
  if (syncToBtn) {
    syncToBtn.disabled = true;
  }

  const result = await chrome.runtime.sendMessage({ type: MessageType.AUTH_SYNC_FROM_REMOTE });

  if (result?.success) {
    await loadData();
    render();
    alert('リモート→ローカルの同期が完了しました');
  } else {
    alert(`同期に失敗しました: ${result?.error || '不明なエラーが発生しました'}`);
  }

  if (syncFromBtn) {
    syncFromBtn.disabled = false;
    syncFromBtn.textContent = prevText || 'リモート→ローカル';
  }
  if (syncToBtn) {
    syncToBtn.disabled = false;
  }
}

async function handleSyncToRemote() {
  const ok = confirm(
    'ローカルの内容でリモートを上書きします。リモートのデータが失われる可能性があります。続行しますか？'
  );
  if (!ok) return;

  const syncToBtn = document.getElementById('sync-to-remote-btn') as HTMLButtonElement;
  const syncFromBtn = document.getElementById('sync-from-remote-btn') as HTMLButtonElement | null;
  const prevText = syncToBtn?.textContent;
  if (syncToBtn) {
    syncToBtn.disabled = true;
    syncToBtn.textContent = '同期中...';
  }
  if (syncFromBtn) {
    syncFromBtn.disabled = true;
  }

  const result = await chrome.runtime.sendMessage({ type: MessageType.AUTH_SYNC_TO_REMOTE });

  if (result?.success) {
    await loadData();
    render();
    alert('ローカル→リモートの同期が完了しました');
  } else {
    alert(`同期に失敗しました: ${result?.error || '不明なエラーが発生しました'}`);
  }

  if (syncToBtn) {
    syncToBtn.disabled = false;
    syncToBtn.textContent = prevText || 'ローカル→リモート';
  }
  if (syncFromBtn) {
    syncFromBtn.disabled = false;
  }
}

// ========================================
// ユーティリティ
// ========================================

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
