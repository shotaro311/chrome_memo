import {
  MessageType,
  Folder,
  Note,
  QuickMemo,
  PanelState,
  LIMITS,
  INBOX_FOLDER_ID,
  AUTOSAVE_DEBOUNCE_MS
} from '../types';

// ========================================
// グローバル変数
// ========================================

let panel: HTMLElement | null = null;
let panelState: PanelState = {
  isVisible: false,
  width: LIMITS.DEFAULT_PANEL_WIDTH,
  height: LIMITS.DEFAULT_PANEL_HEIGHT,
  currentFolderId: INBOX_FOLDER_ID,
  currentNoteId: null,
  searchQuery: '',
  openTabs: [],
  activeTabId: null,
  splitEnabled: false,
  rightTabId: null,
  lastFocusedPane: 'left'
};

let folders: Folder[] = [];
let draftMemo: QuickMemo = { content: '', updatedAt: Date.now() };

let autosaveTimer: number | null = null;

type TabKind = 'draft' | 'note';
type Pane = 'left' | 'right';

interface TabInfo {
  id: string;
  kind: TabKind;
  title: string;
}

const DRAFT_TAB_ID = '__draft__';
const DRAFT_TAB_LABEL = '下書き';
const DRAFT_PLACEHOLDER = 'ここにメモを入力...（下書きは自動保存されます）';
const NOTE_PLACEHOLDER = 'ここにメモを入力...（保存ボタンで保存してください）';

const tabInfoMap: Record<string, TabInfo> = {};
const tabContentCache: Record<string, string> = {};
const tabUnsavedMap: Record<string, boolean> = {};

// ========================================
// 初期化
// ========================================

function init() {
  console.log('[Content] Initializing...');

  // メッセージリスナーを設定
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message);
    sendResponse({ success: true });
  });

  console.log('[Content] Initialized');
}

// ========================================
// メッセージハンドラ
// ========================================

function handleMessage(message: any) {
  console.log('[Content] Message received:', message);

  switch (message.type) {
    case MessageType.TOGGLE_PANEL:
      togglePanel();
      break;

    case MessageType.OPEN_PANEL:
      openPanel(message.noteId);
      break;

    case MessageType.CLOSE_PANEL:
      closePanel();
      break;

    default:
      console.warn('[Content] Unknown message type:', message.type);
  }
}

// ========================================
// パネル制御
// ========================================

async function togglePanel() {
  if (panelState.isVisible) {
    closePanel();
  } else {
    await openPanel();
  }
}

async function openPanel(noteId?: string) {
  if (!panel) {
    createPanel();
  }

  if (panel) {
    panel.classList.remove('is-hidden');
    panel.style.removeProperty('display');
    panelState.isVisible = true;

    // データを読み込む
    await loadData();
    await refreshAuthButton();
    initializeTabsIfNeeded();
    if (noteId) {
      await loadNoteFromFile(noteId);
    }
    renderAll();
  }
}

function closePanel() {
  if (panel) {
    panel.classList.add('is-hidden');
    panel.style.removeProperty('display');
    panelState.isVisible = false;
    flushDraftSave();
  }
}

// ========================================
// パネル作成
// ========================================

function createPanel() {
  // 既存のパネルがあれば削除
  const existingPanel = document.getElementById('chrome-memo-panel');
  if (existingPanel) {
    existingPanel.remove();
  }

  // パネルを作成
  panel = document.createElement('div');
  panel.id = 'chrome-memo-panel';
  panel.className = 'chrome-memo-panel';
  panel.style.width = `${panelState.width}px`;
  panel.style.height = `${panelState.height}px`;

  // パネルのHTML構造を作成
  panel.innerHTML = `
    <div class="panel-header">
      <div class="header-left">
        <h2 id="memo-title">メモ</h2>
        <button class="header-btn" id="new-note-btn" title="新規メモ">➕</button>
        <button class="header-btn" id="save-as-btn" title="名前を付けて保存">💾</button>
        <button class="header-btn" id="save-btn" title="上書き保存" style="display: none;">📥</button>
        <button class="header-btn" id="open-file-btn" title="ファイルを開く">📂</button>
        <button class="header-btn" id="split-view-btn" title="スプリットビュー">⇔</button>
        <button class="header-btn" id="auth-btn" title="同期 / サインイン">👤</button>
        <span class="memo-current-label" id="memo-current-label"></span>
      </div>
      <button class="close-btn" id="close-panel-btn">×</button>
    </div>

    <div class="panel-content">
      <!-- タブバー -->
      <div class="tab-bar">
        <div class="tab-list" id="tab-list"></div>
      </div>

      <!-- メモテキストエリア -->
      <div class="memo-split" id="memo-split">
        <div class="memo-pane left" data-pane="left">
          <textarea
            class="memo-textarea"
            id="memo-textarea-left"
            placeholder="${DRAFT_PLACEHOLDER}"
          ></textarea>
        </div>
        <div class="memo-pane right" data-pane="right">
          <textarea
            class="memo-textarea"
            id="memo-textarea-right"
            placeholder="${DRAFT_PLACEHOLDER}"
          ></textarea>
        </div>
      </div>
    </div>

    <!-- ファイル選択モーダル -->
    <div class="file-modal" id="file-modal" style="display: none;">
      <div class="file-modal-content">
        <div class="file-modal-header">
          <h3>メモを開く</h3>
          <button class="close-modal-btn" id="close-file-modal-btn">×</button>
        </div>
        <div class="file-modal-body">
          <div class="folder-tabs" id="modal-folder-tabs"></div>
          <div class="file-list" id="file-list"></div>
        </div>
      </div>
    </div>

    <!-- 保存モーダル -->
    <div class="save-modal" id="save-modal" style="display: none;">
      <div class="save-modal-content">
        <div class="save-modal-header">
          <h3>メモを保存</h3>
          <button class="close-modal-btn" id="close-save-modal-btn">×</button>
        </div>
        <div class="save-modal-body">
          <div class="form-group">
            <label for="save-title">タイトル:</label>
            <input type="text" id="save-title" class="save-input" placeholder="タイトルを入力">
          </div>
          <div class="form-group">
            <label for="save-folder">保存先フォルダ:</label>
            <select id="save-folder" class="save-select"></select>
          </div>
          <div class="form-group" id="new-folder-group" style="display: none;">
            <label for="new-folder-name">新規フォルダ名:</label>
            <input type="text" id="new-folder-name" class="save-input" placeholder="フォルダ名を入力">
          </div>
          <div class="save-modal-actions">
            <button class="btn-primary" id="confirm-save-btn">保存</button>
            <button class="btn-secondary" id="cancel-save-btn">キャンセル</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 認証モーダル -->
    <div class="auth-modal" id="auth-modal" style="display: none;">
      <div class="auth-modal-content">
        <div class="auth-modal-header">
          <h3>同期</h3>
          <button class="close-modal-btn" id="close-auth-modal-btn">×</button>
        </div>
        <div class="auth-modal-body">
          <div id="auth-modal-signed-out">
            <p>サインインすると、複数のデバイス間でメモを同期できます</p>
            <button class="btn-primary" id="auth-sign-in-btn">Googleでサインイン</button>
            <p id="auth-modal-error" class="auth-error" style="display: none;"></p>
          </div>
          <div id="auth-modal-signed-in" style="display: none;">
            <p>サインイン中: <span id="auth-user-email"></span></p>
            <div class="auth-actions">
              <button class="btn-secondary" id="auth-sync-now-btn">今すぐ同期</button>
              <button class="btn-secondary" id="auth-sign-out-btn">サインアウト</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- スプリット選択モーダル -->
    <div class="split-modal" id="split-modal" style="display: none;">
      <div class="split-modal-content">
        <div class="split-modal-header">
          <h3>右側に表示するメモを選択</h3>
          <button class="close-modal-btn" id="close-split-modal-btn">×</button>
        </div>
        <div class="split-modal-body">
          <div class="split-section">
            <div class="split-section-title">開いているメモ</div>
            <div class="split-tab-list" id="split-tab-list"></div>
          </div>
          <div class="split-section">
            <div class="split-section-title">フォルダのメモ</div>
            <div class="folder-tabs" id="split-folder-tabs"></div>
            <div class="file-list" id="split-file-list"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- リサイズハンドル -->
    <div class="resize-handle" id="resize-handle"></div>
  `;

  // イベントリスナーを設定
  setupEventListeners();

  // リサイズ機能を設定
  setupResize();

  // DOMに追加
  document.body.appendChild(panel);
}

// ========================================
// イベントリスナー設定
// ========================================

function setupEventListeners() {
  if (!panel) return;

  // イベントデリゲーション（パネル全体でクリックを監視）
  panel.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const id = target.id || target.closest('button')?.id;

    switch (id) {
      case 'close-panel-btn':
        e.stopPropagation();
        e.preventDefault();
        closePanel();
        break;
      case 'new-note-btn':
        handleNewNote();
        break;
      case 'save-as-btn':
        handleSaveAs();
        break;
      case 'save-btn':
        handleSave();
        break;
      case 'open-file-btn':
        handleOpenFile();
        break;
      case 'split-view-btn':
        void handleSplitViewToggle();
        break;
      case 'auth-btn':
        openAuthModal();
        break;
      case 'close-file-modal-btn':
        e.stopPropagation();
        closeFileModal();
        break;
      case 'close-save-modal-btn':
        e.stopPropagation();
        closeSaveModal();
        break;
      case 'close-auth-modal-btn':
        e.stopPropagation();
        closeAuthModal();
        break;
      case 'close-split-modal-btn':
        e.stopPropagation();
        closeSplitModal();
        break;
      case 'confirm-save-btn':
        handleConfirmSave();
        break;
      case 'cancel-save-btn':
        closeSaveModal();
        break;
      case 'auth-sign-in-btn':
        handleAuthSignIn();
        break;
      case 'auth-sync-now-btn':
        handleAuthSyncNow();
        break;
      case 'auth-sign-out-btn':
        handleAuthSignOut();
        break;
    }
  });

  // メモテキストエリアの入力
  const memoTextareaLeft = panel.querySelector('#memo-textarea-left') as HTMLTextAreaElement;
  const memoTextareaRight = panel.querySelector('#memo-textarea-right') as HTMLTextAreaElement;
  setupTextareaEvents(memoTextareaLeft, 'left');
  setupTextareaEvents(memoTextareaRight, 'right');

  const tabList = panel.querySelector('#tab-list') as HTMLElement | null;
  tabList?.addEventListener('wheel', (e: WheelEvent) => {
    if (e.deltaY === 0) return;
    tabList.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
}

function setupTextareaEvents(textarea: HTMLTextAreaElement | null, pane: Pane) {
  if (!textarea) return;

  textarea.addEventListener('input', (e) => handleMemoInput(e, pane));
  textarea.addEventListener('focus', () => {
    panelState.lastFocusedPane = pane;
    updateHeaderState();
  });
  textarea.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && e.defaultPrevented && !e.isComposing) {
      const current = e.currentTarget as HTMLTextAreaElement;
      const start = current.selectionStart ?? current.value.length;
      const end = current.selectionEnd ?? current.value.length;
      const nextValue = current.value.slice(0, start) + '\n' + current.value.slice(end);
      current.value = nextValue;
      const nextPos = start + 1;
      current.setSelectionRange(nextPos, nextPos);
      current.dispatchEvent(new Event('input', { bubbles: true }));
    }
    e.stopPropagation();
  });
  textarea.addEventListener('keyup', (e: KeyboardEvent) => {
    e.stopPropagation();
  });
}

// ========================================
// リサイズ機能
// ========================================

function setupResize() {
  if (!panel) return;

  const resizeHandle = panel.querySelector('#resize-handle') as HTMLElement;
  if (!resizeHandle) return;

  let isResizing = false;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;

  resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
    isResizing = true;
    startX = e.clientX;
    startY = e.clientY;
    startWidth = panelState.width;
    startHeight = panelState.height;

    e.preventDefault();
  });

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isResizing || !panel) return;

    const deltaX = startX - e.clientX;
    const deltaY = e.clientY - startY;

    let newWidth = startWidth + deltaX;
    let newHeight = startHeight + deltaY;

    // 最小・最大サイズの制限
    newWidth = Math.max(LIMITS.MIN_PANEL_WIDTH, Math.min(LIMITS.MAX_PANEL_WIDTH, newWidth));
    newHeight = Math.max(LIMITS.MIN_PANEL_HEIGHT, Math.min(LIMITS.MAX_PANEL_HEIGHT, newHeight));

    panel.style.width = `${newWidth}px`;
    panel.style.height = `${newHeight}px`;

    panelState.width = newWidth;
    panelState.height = newHeight;
  });

  document.addEventListener('mouseup', () => {
    isResizing = false;
  });
}

// ========================================
// データ読み込み
// ========================================

async function loadData() {
  try {
    // 下書きメモを取得
    const quickMemoResponse = await chrome.runtime.sendMessage({
      type: MessageType.GET_QUICK_MEMO
    });
    if (quickMemoResponse.success) {
      draftMemo = quickMemoResponse.data;
      if (panelState.openTabs.includes(DRAFT_TAB_ID)) {
        tabContentCache[DRAFT_TAB_ID] = draftMemo.content || '';
      }
    }

    // フォルダ一覧を取得
    const foldersResponse = await chrome.runtime.sendMessage({
      type: MessageType.GET_FOLDERS
    });
    if (foldersResponse.success) {
      folders = foldersResponse.data;
    }
  } catch (error) {
    console.error('[Content] Error loading data:', error);
  }
}

// ========================================
// レンダリング
// ========================================

function renderAll() {
  renderTabs();
  renderPanes();
  updateHeaderState();
}

function renderTabs() {
  if (!panel) return;

  const tabList = panel.querySelector('#tab-list') as HTMLElement | null;
  if (!tabList) return;

  tabList.innerHTML = panelState.openTabs
    .map(tabId => {
      if (tabId === DRAFT_TAB_ID && !tabInfoMap[DRAFT_TAB_ID]) {
        tabInfoMap[DRAFT_TAB_ID] = {
          id: DRAFT_TAB_ID,
          kind: 'draft',
          title: DRAFT_TAB_LABEL
        };
      }
      const tab = tabInfoMap[tabId];
      if (!tab) return '';
      const title = tab.kind === 'draft' ? DRAFT_TAB_LABEL : (tab.title || '無題のメモ');
      const isActive = tabId === panelState.activeTabId;
      return `
        <button class="tab-item ${isActive ? 'active' : ''}" data-tab-id="${tabId}">
          <span class="tab-title">${escapeHtml(title)}</span>
          <span class="tab-close" data-tab-id="${tabId}">×</span>
        </button>
      `;
    })
    .join('');

  tabList.querySelectorAll('.tab-item').forEach(tabEl => {
    tabEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('tab-close')) {
        e.stopPropagation();
        const tabId = target.getAttribute('data-tab-id');
        if (tabId) {
          closeTab(tabId);
        }
        return;
      }

      const tabId = (tabEl as HTMLElement).getAttribute('data-tab-id');
      if (tabId) {
        setActiveTab(tabId);
      }
    });
  });
}

function renderPanes() {
  if (!panel) return;

  panel.classList.toggle('is-split', panelState.splitEnabled);
  renderPane('left');
  renderPane('right');
}

function renderPane(pane: Pane) {
  if (!panel) return;

  const paneTabId = getPaneTabId(pane);
  const textarea = panel.querySelector(`#memo-textarea-${pane}`) as HTMLTextAreaElement | null;
  const paneContainer = panel.querySelector(`.memo-pane.${pane}`) as HTMLElement | null;

  if (!textarea || !paneContainer) return;

  if (!paneTabId) {
    textarea.value = '';
    textarea.placeholder = '';
    paneContainer.style.display = 'none';
    return;
  }

  paneContainer.style.display = 'flex';
  textarea.value = getTabContent(paneTabId);
  textarea.placeholder = getTabPlaceholder(paneTabId);
}

function updateHeaderState() {
  if (!panel) return;

  const titleElement = panel.querySelector('#memo-title') as HTMLElement | null;
  const currentLabel = panel.querySelector('#memo-current-label') as HTMLElement | null;
  const saveBtn = panel.querySelector('#save-btn') as HTMLButtonElement | null;

  if (titleElement) {
    titleElement.textContent = 'メモ';
  }

  const leftTabId = panelState.activeTabId;
  const rightTabId = panelState.splitEnabled ? panelState.rightTabId : null;
  const leftLabel = leftTabId ? getTabTitle(leftTabId) : '';
  const rightLabel = rightTabId ? getTabTitle(rightTabId) : '';

  if (currentLabel) {
    if (panelState.splitEnabled && rightLabel) {
      currentLabel.textContent = `左: ${leftLabel} / 右: ${rightLabel}`;
      currentLabel.title = currentLabel.textContent;
    } else {
      currentLabel.textContent = leftLabel;
      currentLabel.title = leftLabel;
    }
  }

  let focusedTab = getFocusedTabInfo();
  if (!focusedTab && panelState.activeTabId) {
    panelState.lastFocusedPane = 'left';
    focusedTab = getFocusedTabInfo();
  }
  if (saveBtn) {
    saveBtn.style.display = focusedTab?.kind === 'note' ? 'inline-flex' : 'none';
  }
}

function initializeTabsIfNeeded() {
  if (panelState.openTabs.length === 0) {
    openDraftTab();
    return;
  }

  if (!panelState.activeTabId) {
    panelState.activeTabId = panelState.openTabs[0] || null;
  }
  if (panelState.activeTabId && !panelState.openTabs.includes(panelState.activeTabId)) {
    panelState.activeTabId = panelState.openTabs[0] || null;
  }

  const missingDraft = panelState.openTabs.includes(DRAFT_TAB_ID) && !tabInfoMap[DRAFT_TAB_ID];
  if (missingDraft) {
    tabInfoMap[DRAFT_TAB_ID] = {
      id: DRAFT_TAB_ID,
      kind: 'draft',
      title: DRAFT_TAB_LABEL
    };
  }
}

function openDraftTab() {
  if (!tabInfoMap[DRAFT_TAB_ID]) {
    tabInfoMap[DRAFT_TAB_ID] = {
      id: DRAFT_TAB_ID,
      kind: 'draft',
      title: DRAFT_TAB_LABEL
    };
  }

  if (!panelState.openTabs.includes(DRAFT_TAB_ID)) {
    panelState.openTabs.push(DRAFT_TAB_ID);
  }

  tabContentCache[DRAFT_TAB_ID] = draftMemo.content || '';
  setActiveTab(DRAFT_TAB_ID);
}

function openNoteTab(
  note: Note,
  contentOverride?: string,
  options?: { activate?: boolean }
) {
  const exists = panelState.openTabs.includes(note.id);
  tabInfoMap[note.id] = {
    id: note.id,
    kind: 'note',
    title: note.title
  };

  tabContentCache[note.id] = contentOverride ?? note.content;
  tabUnsavedMap[note.id] = false;

  if (!exists) {
    panelState.openTabs.push(note.id);
  }

  panelState.currentFolderId = note.folderId;
  if (options?.activate === false) {
    renderAll();
    return;
  }
  setActiveTab(note.id);
}

function closeTab(tabId: string) {
  const index = panelState.openTabs.indexOf(tabId);
  if (index === -1) return;

  panelState.openTabs.splice(index, 1);

  if (tabId !== DRAFT_TAB_ID) {
    delete tabInfoMap[tabId];
    delete tabContentCache[tabId];
    delete tabUnsavedMap[tabId];
  }

  if (panelState.splitEnabled && panelState.rightTabId === tabId) {
    panelState.splitEnabled = false;
    panelState.rightTabId = null;
  }

  if (panelState.activeTabId === tabId) {
    const nextTabId = panelState.openTabs[index] || panelState.openTabs[index - 1] || null;
    if (nextTabId) {
      setActiveTab(nextTabId);
    } else {
      openDraftTab();
    }
  } else {
    renderAll();
  }
}

function setActiveTab(tabId: string) {
  if (!panelState.openTabs.includes(tabId)) return;
  panelState.activeTabId = tabId;
  panelState.lastFocusedPane = 'left';
  renderAll();
  focusMemoTextarea('left');
}

function setRightTab(tabId: string) {
  if (!panelState.openTabs.includes(tabId)) return;
  panelState.rightTabId = tabId;
  renderAll();
}

function getFocusedTabInfo(): TabInfo | null {
  const tabId = getPaneTabId(panelState.lastFocusedPane);
  if (!tabId) return null;
  return tabInfoMap[tabId] || null;
}

function getPaneTabId(pane: Pane): string | null {
  if (pane === 'left') {
    return panelState.activeTabId;
  }
  if (!panelState.splitEnabled) return null;
  return panelState.rightTabId;
}

function getTabTitle(tabId: string): string {
  if (tabId === DRAFT_TAB_ID) return DRAFT_TAB_LABEL;
  return tabInfoMap[tabId]?.title || '無題のメモ';
}

function getTabContent(tabId: string): string {
  if (tabId === DRAFT_TAB_ID) {
    return draftMemo.content || '';
  }
  return tabContentCache[tabId] ?? '';
}

function getTabPlaceholder(tabId: string): string {
  if (tabId === DRAFT_TAB_ID) {
    return DRAFT_PLACEHOLDER;
  }
  return NOTE_PLACEHOLDER;
}

function renderFileList(folderId: string) {
  if (!panel) return;

  const fileList = panel.querySelector('#file-list');
  if (!fileList) return;

  // フォルダ内のメモを取得
  chrome.runtime.sendMessage({
    type: MessageType.GET_NOTES_IN_FOLDER,
    folderId
  }).then(response => {
    if (response.success) {
      const folderNotes: Note[] = response.data;

      if (folderNotes.length === 0) {
        fileList.innerHTML = '<div class="empty-message">メモがありません</div>';
        return;
      }

      fileList.innerHTML = folderNotes
        .map(
          note => `
          <div class="file-item" data-note-id="${note.id}">
            <div class="file-item-info">
              <div class="file-item-title">${escapeHtml(note.title)}</div>
              <div class="file-item-preview">${escapeHtml(note.content.substring(0, 50))}${note.content.length > 50 ? '...' : ''}</div>
            </div>
            <div class="file-item-actions">
              <button class="file-action-btn edit-btn" data-note-id="${note.id}" title="名前を変更">✏️</button>
              <button class="file-action-btn delete-btn" data-note-id="${note.id}" title="削除">🗑️</button>
            </div>
          </div>
        `
        )
        .join('');

      // メモアイテムのクリックイベント（info部分のみ）
      fileList.querySelectorAll('.file-item-info').forEach(item => {
        item.addEventListener('click', async (e) => {
          const noteId = (e.currentTarget as HTMLElement).parentElement?.getAttribute('data-note-id');
          if (noteId) {
            await loadNoteFromFile(noteId);
            closeFileModal();
          }
        });
      });

      // 編集ボタンのクリックイベント
      fileList.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const noteId = (e.currentTarget as HTMLElement).getAttribute('data-note-id');
          if (noteId) {
            await handleRenameNote(noteId, folderId);
          }
        });
      });

      // 削除ボタンのクリックイベント
      fileList.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const noteId = (e.currentTarget as HTMLElement).getAttribute('data-note-id');
          if (noteId) {
            await handleDeleteNote(noteId, folderId);
          }
        });
      });
    }
  });
}

function renderFolderTabs() {
  if (!panel) return;

  const folderTabs = panel.querySelector('#modal-folder-tabs');
  if (!folderTabs) return;

  folderTabs.innerHTML = folders
    .map(
      folder => `
      <button
        class="folder-tab ${folder.id === panelState.currentFolderId ? 'active' : ''}"
        data-folder-id="${folder.id}"
      >
        ${escapeHtml(folder.name)}
      </button>
    `
    )
    .join('');

  // フォルダタブのクリックイベント
  folderTabs.querySelectorAll('.folder-tab').forEach(tab => {
    tab.addEventListener('click', async (e) => {
      const folderId = (e.target as HTMLElement).getAttribute('data-folder-id');
      if (folderId) {
        panelState.currentFolderId = folderId;
        renderFolderTabs();
        renderFileList(folderId);
      }
    });
  });
}

function renderSaveFolderSelect() {
  if (!panel) return;

  const folderSelect = panel.querySelector('#save-folder') as HTMLSelectElement;
  const newFolderGroup = panel.querySelector('#new-folder-group') as HTMLElement;
  if (!folderSelect) return;

  // 既存フォルダ + 新規フォルダオプション
  const folderOptions = folders
    .map(
      folder =>
        `<option value="${folder.id}" ${folder.id === INBOX_FOLDER_ID ? 'selected' : ''}>${escapeHtml(folder.name)}</option>`
    )
    .join('');

  folderSelect.innerHTML = folderOptions + '<option value="__new__">+ 新規フォルダ</option>';

  // フォルダ選択変更時のイベント
  folderSelect.onchange = () => {
    if (newFolderGroup) {
      newFolderGroup.style.display = folderSelect.value === '__new__' ? 'block' : 'none';
    }
  };
}

// ========================================
// 入力・保存ハンドラー
// ========================================

function handleMemoInput(e: Event, pane: Pane) {
  const textarea = e.target as HTMLTextAreaElement;
  const content = textarea.value;
  const tabId = getPaneTabId(pane);
  if (!tabId) return;

  if (tabId === DRAFT_TAB_ID) {
    // 下書き：デバウンスして自動保存
    draftMemo.content = content;
    draftMemo.updatedAt = Date.now();
    tabContentCache[DRAFT_TAB_ID] = content;

    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
    }

    autosaveTimer = window.setTimeout(async () => {
      await chrome.runtime.sendMessage({
        type: MessageType.UPDATE_QUICK_MEMO,
        content
      });
    }, AUTOSAVE_DEBOUNCE_MS);
  } else {
    tabContentCache[tabId] = content;
    tabUnsavedMap[tabId] = true;
  }
}

async function handleSaveAs() {
  const pane = getFocusedPane();
  const textarea = getTextarea(pane);
  if (!textarea) return;

  const content = textarea.value;
  if (!content.trim()) {
    alert('メモの内容が空です');
    return;
  }

  // 保存モーダルを開く
  renderSaveFolderSelect();
  const saveModal = panel?.querySelector('#save-modal') as HTMLElement;
  if (saveModal) {
    saveModal.style.display = 'flex';
  }
}

async function handleSave() {
  const pane = getFocusedPane();
  const tabId = getPaneTabId(pane);
  if (!tabId || tabId === DRAFT_TAB_ID) {
    alert('保存するメモがありません');
    return;
  }

  const textarea = getTextarea(pane);
  if (!textarea) return;

  const content = textarea.value;
  const title = tabInfoMap[tabId]?.title ?? '';

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.UPDATE_NOTE,
      noteId: tabId,
      title,
      content
    });

    if (response.success) {
      tabUnsavedMap[tabId] = false;
      tabContentCache[tabId] = content;
      updateHeaderState();
      alert('上書き保存しました');
    } else {
      alert(`エラー: ${response.error}`);
    }
  } catch (error) {
    console.error('[Content] Error saving note:', error);
    alert('保存中にエラーが発生しました');
  }
}

async function handleNewNote() {
  const focusedTabId = getFocusedTabId();
  if (focusedTabId && focusedTabId !== DRAFT_TAB_ID && tabUnsavedMap[focusedTabId]) {
    const ok = confirm('未保存の変更があります。保存せずに下書きを開きますか？');
    if (!ok) return;
  }

  openDraftTab();
}

async function handleConfirmSave() {
  const titleInput = panel?.querySelector('#save-title') as HTMLInputElement;
  const folderSelect = panel?.querySelector('#save-folder') as HTMLSelectElement;
  const newFolderInput = panel?.querySelector('#new-folder-name') as HTMLInputElement;
  const pane = getFocusedPane();
  const textarea = getTextarea(pane);

  if (!titleInput || !folderSelect || !textarea) return;

  const title = titleInput.value.trim();
  let folderId = folderSelect.value;
  const content = textarea.value;

  if (!content.trim()) {
    alert('メモの内容が空です');
    return;
  }

  try {
    // 新規フォルダの場合は先に作成
    if (folderId === '__new__') {
      const newFolderName = newFolderInput?.value.trim();
      if (!newFolderName) {
        alert('フォルダ名を入力してください');
        return;
      }

      const folderResponse = await chrome.runtime.sendMessage({
        type: MessageType.CREATE_FOLDER,
        name: newFolderName
      });

      if (folderResponse.success) {
        folderId = folderResponse.data.id;
        // フォルダリストを更新
        await loadData();
      } else {
        alert(`フォルダ作成エラー: ${folderResponse.error}`);
        return;
      }
    }

    const response = await chrome.runtime.sendMessage({
      type: MessageType.CREATE_NOTE,
      folderId,
      title: title || undefined
    });

    if (response.success) {
      const note: Note = response.data;

      // 保存したメモの内容を更新
      await chrome.runtime.sendMessage({
        type: MessageType.UPDATE_NOTE,
        noteId: note.id,
        content
      });

      openNoteTab(note, content);
      closeSaveModal();
      alert('メモを保存しました');
    } else {
      alert(`エラー: ${response.error}`);
    }
  } catch (error) {
    console.error('[Content] Error saving note:', error);
    alert('保存中にエラーが発生しました');
  }
}

async function handleOpenFile() {
  await loadData();
  renderFolderTabs();
  renderFileList(panelState.currentFolderId || INBOX_FOLDER_ID);

  const fileModal = panel?.querySelector('#file-modal') as HTMLElement;
  if (fileModal) {
    fileModal.style.display = 'flex';
  }
}

async function handleSplitViewToggle() {
  if (panelState.splitEnabled) {
    panelState.splitEnabled = false;
    panelState.rightTabId = null;
    renderAll();
    return;
  }
  await loadData();
  renderSplitTabList(panelState.openTabs.filter(tabId => tabId !== panelState.activeTabId));
  renderSplitFolderTabs();
  renderSplitFileList(panelState.currentFolderId || INBOX_FOLDER_ID);
  openSplitModal();
}

function renderSplitTabList(tabIds: string[]) {
  if (!panel) return;
  const list = panel.querySelector('#split-tab-list') as HTMLElement | null;
  if (!list) return;

  if (tabIds.length === 0) {
    list.innerHTML = '<div class="empty-message">開いているメモはありません</div>';
    return;
  }

  list.innerHTML = tabIds
    .map(tabId => {
      const title = getTabTitle(tabId);
      return `<button class="split-tab-item" data-tab-id="${tabId}">${escapeHtml(title)}</button>`;
    })
    .join('');

  list.querySelectorAll('.split-tab-item').forEach(item => {
    item.addEventListener('click', () => {
      const tabId = (item as HTMLElement).getAttribute('data-tab-id');
      if (!tabId) return;
      panelState.splitEnabled = true;
      setRightTab(tabId);
      closeSplitModal();
    });
  });
}

function renderSplitFolderTabs() {
  if (!panel) return;
  const folderTabs = panel.querySelector('#split-folder-tabs');
  if (!folderTabs) return;

  folderTabs.innerHTML = folders
    .map(
      folder => `
      <button
        class="folder-tab ${folder.id === panelState.currentFolderId ? 'active' : ''}"
        data-folder-id="${folder.id}"
      >
        ${escapeHtml(folder.name)}
      </button>
    `
    )
    .join('');

  folderTabs.querySelectorAll('.folder-tab').forEach(tab => {
    tab.addEventListener('click', async (e) => {
      const folderId = (e.target as HTMLElement).getAttribute('data-folder-id');
      if (folderId) {
        panelState.currentFolderId = folderId;
        renderSplitFolderTabs();
        renderSplitFileList(folderId);
      }
    });
  });
}

function renderSplitFileList(folderId: string) {
  if (!panel) return;
  const fileList = panel.querySelector('#split-file-list');
  if (!fileList) return;

  chrome.runtime.sendMessage({
    type: MessageType.GET_NOTES_IN_FOLDER,
    folderId
  }).then(response => {
    if (!response.success) return;
    const folderNotes: Note[] = response.data;

    if (folderNotes.length === 0) {
      fileList.innerHTML = '<div class="empty-message">メモがありません</div>';
      return;
    }

    fileList.innerHTML = folderNotes
      .map(
        note => `
        <div class="file-item" data-note-id="${note.id}">
          <div class="file-item-info">
            <div class="file-item-title">${escapeHtml(note.title)}</div>
            <div class="file-item-preview">${escapeHtml(note.content.substring(0, 50))}${note.content.length > 50 ? '...' : ''}</div>
          </div>
        </div>
      `
      )
      .join('');

    fileList.querySelectorAll('.file-item-info').forEach(item => {
      item.addEventListener('click', async (e) => {
        const noteId = (e.currentTarget as HTMLElement).parentElement?.getAttribute('data-note-id');
        if (noteId) {
          await openNoteInSplit(noteId);
        }
      });
    });
  });
}

async function openNoteInSplit(noteId: string) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.OPEN_NOTE,
      noteId
    });

    if (response.success && response.data) {
      const note: Note = response.data;
      openNoteTab(note, undefined, { activate: false });
      panelState.splitEnabled = true;
      setRightTab(note.id);
      closeSplitModal();
    }
  } catch (error) {
    console.error('[Content] Error loading note for split:', error);
    alert('メモの読み込み中にエラーが発生しました');
  }
}

function openSplitModal() {
  const modal = panel?.querySelector('#split-modal') as HTMLElement | null;
  if (modal) {
    modal.style.display = 'flex';
  }
}

function closeSplitModal() {
  const modal = panel?.querySelector('#split-modal') as HTMLElement | null;
  if (modal) {
    modal.style.display = 'none';
  }
}

async function refreshAuthButton() {
  const btn = panel?.querySelector('#auth-btn') as HTMLButtonElement | null;
  if (!btn) return;

  try {
    const response = await chrome.runtime.sendMessage({ type: MessageType.AUTH_GET_STATE });
    if (!response?.success) return;

    const state = response.data as { isAuthenticated: boolean; email: string | null };
    btn.title = state.isAuthenticated ? `同期 / サインアウト（${state.email || ''}）` : '同期 / サインイン';
    btn.style.opacity = state.isAuthenticated ? '1' : '0.7';
  } catch (error) {
    console.error('[Content] Error refreshing auth button:', error);
  }
}

function showAuthModalError(message: string) {
  const el = panel?.querySelector('#auth-modal-error') as HTMLElement | null;
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
}

function hideAuthModalError() {
  const el = panel?.querySelector('#auth-modal-error') as HTMLElement | null;
  if (!el) return;
  el.textContent = '';
  el.style.display = 'none';
}

function closeAuthModal() {
  const authModal = panel?.querySelector('#auth-modal') as HTMLElement;
  if (authModal) {
    authModal.style.display = 'none';
  }
  hideAuthModalError();
}

function renderAuthModalState(state: { isAuthenticated: boolean; email: string | null }) {
  const signedOut = panel?.querySelector('#auth-modal-signed-out') as HTMLElement | null;
  const signedIn = panel?.querySelector('#auth-modal-signed-in') as HTMLElement | null;
  const email = panel?.querySelector('#auth-user-email') as HTMLElement | null;

  if (!signedOut || !signedIn || !email) return;

  if (state.isAuthenticated) {
    signedOut.style.display = 'none';
    signedIn.style.display = 'block';
    email.textContent = state.email || '';
  } else {
    signedOut.style.display = 'block';
    signedIn.style.display = 'none';
    email.textContent = '';
  }
}

async function openAuthModal() {
  hideAuthModalError();

  try {
    const response = await chrome.runtime.sendMessage({ type: MessageType.AUTH_GET_STATE });
    if (response?.success) {
      renderAuthModalState(response.data);
    }
  } catch (error) {
    console.error('[Content] Error opening auth modal:', error);
  }

  const authModal = panel?.querySelector('#auth-modal') as HTMLElement;
  if (authModal) {
    authModal.style.display = 'flex';
  }
}

async function handleAuthSignIn() {
  const btn = panel?.querySelector('#auth-sign-in-btn') as HTMLButtonElement | null;
  const prevText = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'サインイン中...';
  }
  hideAuthModalError();

  try {
    const response = await chrome.runtime.sendMessage({ type: MessageType.AUTH_SIGN_IN });
    if (!response?.success) {
      showAuthModalError(response?.error || 'サインインに失敗しました');
      return;
    }

    const syncResponse = await chrome.runtime.sendMessage({ type: MessageType.AUTH_SYNC_NOW });
    if (!syncResponse?.success) {
      showAuthModalError(syncResponse?.error || '同期に失敗しました');
    }

    await loadData();
    renderAll();

    const stateResponse = await chrome.runtime.sendMessage({ type: MessageType.AUTH_GET_STATE });
    if (stateResponse?.success) {
      renderAuthModalState(stateResponse.data);
    }
    await refreshAuthButton();
  } catch (error) {
    console.error('[Content] Sign in failed:', error);
    showAuthModalError(String(error));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prevText || 'Googleでサインイン';
    }
  }
}

async function handleAuthSyncNow() {
  const btn = panel?.querySelector('#auth-sync-now-btn') as HTMLButtonElement | null;
  const prevText = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = '同期中...';
  }
  hideAuthModalError();

  try {
    const response = await chrome.runtime.sendMessage({ type: MessageType.AUTH_SYNC_NOW });
    if (!response?.success) {
      showAuthModalError(response?.error || '同期に失敗しました');
      return;
    }

    await loadData();
    renderAll();
    alert('同期が完了しました');
  } catch (error) {
    console.error('[Content] Sync failed:', error);
    showAuthModalError(String(error));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prevText || '今すぐ同期';
    }
  }
}

async function handleAuthSignOut() {
  if (!confirm('サインアウトしますか？ローカルのメモは残りますが、同期は停止します。')) {
    return;
  }

  const btn = panel?.querySelector('#auth-sign-out-btn') as HTMLButtonElement | null;
  const prevText = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'サインアウト中...';
  }
  hideAuthModalError();

  try {
    const response = await chrome.runtime.sendMessage({ type: MessageType.AUTH_SIGN_OUT });
    if (!response?.success) {
      showAuthModalError(response?.error || 'サインアウトに失敗しました');
      return;
    }

    const stateResponse = await chrome.runtime.sendMessage({ type: MessageType.AUTH_GET_STATE });
    if (stateResponse?.success) {
      renderAuthModalState(stateResponse.data);
    }
    await refreshAuthButton();
    closeAuthModal();
    alert('サインアウトしました');
  } catch (error) {
    console.error('[Content] Sign out failed:', error);
    showAuthModalError(String(error));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prevText || 'サインアウト';
    }
  }
}

async function loadNoteFromFile(noteId: string) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.OPEN_NOTE,
      noteId
    });

    if (response.success && response.data) {
      const note: Note = response.data;

      openNoteTab(note);
    }
  } catch (error) {
    console.error('[Content] Error loading note:', error);
    alert('メモの読み込み中にエラーが発生しました');
  }
}

async function handleRenameNote(noteId: string, folderId: string) {
  const newTitle = prompt('新しいタイトルを入力してください:');
  if (newTitle === null) return; // キャンセル

  if (!newTitle.trim()) {
    alert('タイトルを入力してください');
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.UPDATE_NOTE,
      noteId,
      title: newTitle.trim()
    });

    if (response.success) {
      // リストを更新
      renderFileList(folderId);
      if (tabInfoMap[noteId]) {
        tabInfoMap[noteId].title = newTitle.trim();
        renderTabs();
        updateHeaderState();
      }
    } else {
      alert(`エラー: ${response.error}`);
    }
  } catch (error) {
    console.error('[Content] Error renaming note:', error);
    alert('名前の変更中にエラーが発生しました');
  }
}

async function handleDeleteNote(noteId: string, folderId: string) {
  if (!confirm('このメモを削除しますか？')) return;

  try {
    const response = await chrome.runtime.sendMessage({
      type: MessageType.DELETE_NOTE,
      noteId
    });

    if (response.success) {
      // リストを更新
      renderFileList(folderId);
      if (panelState.openTabs.includes(noteId)) {
        closeTab(noteId);
      }
    } else {
      alert(`エラー: ${response.error}`);
    }
  } catch (error) {
    console.error('[Content] Error deleting note:', error);
    alert('削除中にエラーが発生しました');
  }
}

function closeFileModal() {
  const fileModal = panel?.querySelector('#file-modal') as HTMLElement;
  if (fileModal) {
    fileModal.style.display = 'none';
  }
}

function closeSaveModal() {
  const saveModal = panel?.querySelector('#save-modal') as HTMLElement;
  if (saveModal) {
    saveModal.style.display = 'none';
  }

  // 入力フィールドをクリア
  const titleInput = panel?.querySelector('#save-title') as HTMLInputElement;
  if (titleInput) {
    titleInput.value = '';
  }

  // 新規フォルダ入力欄をクリア・非表示
  const newFolderInput = panel?.querySelector('#new-folder-name') as HTMLInputElement;
  const newFolderGroup = panel?.querySelector('#new-folder-group') as HTMLElement;
  if (newFolderInput) {
    newFolderInput.value = '';
  }
  if (newFolderGroup) {
    newFolderGroup.style.display = 'none';
  }
}

// ========================================
// ユーティリティ
// ========================================

function getTextarea(pane: Pane): HTMLTextAreaElement | null {
  if (!panel) return null;
  return panel.querySelector(`#memo-textarea-${pane}`) as HTMLTextAreaElement | null;
}

function focusMemoTextarea(pane: Pane) {
  const textarea = getTextarea(pane);
  if (textarea) {
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }
}

function getFocusedPane(): Pane {
  return panelState.lastFocusedPane;
}

function getFocusedTabId(): string | null {
  return getPaneTabId(getFocusedPane());
}

function flushDraftSave() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }

  if (!draftMemo) return;

  chrome.runtime.sendMessage({
    type: MessageType.UPDATE_QUICK_MEMO,
    content: draftMemo.content || ''
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========================================
// 初期化実行
// ========================================

init();
