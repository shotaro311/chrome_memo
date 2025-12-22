import type { Folder, Note, PanelState, QuickMemo } from '../types';
import { AUTOSAVE_DEBOUNCE_MS, INBOX_FOLDER_ID, MessageType } from '../types';
import type { Pane, TabInfo } from './panelTypes';
import { DRAFT_TAB_ID } from './panelTypes';
import type { createPanelView } from './panelView';

type Timers = { autosaveTimer: number | null };
type View = ReturnType<typeof createPanelView>;

export interface PanelActionsState {
  getPanel: () => HTMLElement | null;
  panelState: PanelState;
  folders: Folder[];
  draftMemo: QuickMemo;
  tabInfoMap: Record<string, TabInfo>;
  tabContentCache: Record<string, string>;
  tabUnsavedMap: Record<string, boolean>;
  timers: Timers;
}

export interface PanelActionsDeps {
  view: View;
  getTextarea: (pane: Pane) => HTMLTextAreaElement | null;
  escapeHtml: (text: string) => string;
}

export function createPanelActions(state: PanelActionsState, deps: PanelActionsDeps) {
  const { getPanel, panelState, folders, draftMemo, tabInfoMap, tabContentCache, tabUnsavedMap, timers } = state;
  const { view, getTextarea, escapeHtml } = deps;
  let folderHoverTimer: number | null = null;
  let lastHoverFolderId: string | null = null;

  async function loadData() {
    try {
      const quickMemoResponse = await chrome.runtime.sendMessage({
        type: MessageType.GET_QUICK_MEMO
      });
      if (quickMemoResponse.success) {
        const next = quickMemoResponse.data as QuickMemo;
        draftMemo.content = next.content || '';
        draftMemo.updatedAt = next.updatedAt ?? Date.now();
        if (panelState.openTabs.includes(DRAFT_TAB_ID)) {
          tabContentCache[DRAFT_TAB_ID] = draftMemo.content || '';
        }
      }

      const foldersResponse = await chrome.runtime.sendMessage({
        type: MessageType.GET_FOLDERS
      });
      if (foldersResponse.success) {
        const nextFolders = foldersResponse.data as Folder[];
        folders.length = 0;
        folders.push(...nextFolders);
      }
    } catch (error) {
      console.error('[Content] Error loading data:', error);
    }
  }

  function handleMemoInput(e: Event, pane: Pane) {
    const textarea = e.target as HTMLTextAreaElement;
    const content = textarea.value;
    const tabId = view.getPaneTabId(pane);
    if (!tabId) return;

    if (tabId === DRAFT_TAB_ID) {
      draftMemo.content = content;
      draftMemo.updatedAt = Date.now();
      tabContentCache[DRAFT_TAB_ID] = content;

      if (timers.autosaveTimer) {
        clearTimeout(timers.autosaveTimer);
      }

      timers.autosaveTimer = window.setTimeout(async () => {
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

    renderSaveFolderSelect();
    const panel = getPanel();
    const saveModal = panel?.querySelector('#save-modal') as HTMLElement | null;
    if (saveModal) {
      saveModal.style.display = 'flex';
    }
  }

  async function handleSave() {
    const pane = getFocusedPane();
    const tabId = view.getPaneTabId(pane);
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
        view.updateHeaderState();
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

    view.openDraftTab();
  }

  async function handleConfirmSave() {
    const panel = getPanel();
    const titleInput = panel?.querySelector('#save-title') as HTMLInputElement | null;
    const folderSelect = panel?.querySelector('#save-folder') as HTMLSelectElement | null;
    const newFolderInput = panel?.querySelector('#new-folder-name') as HTMLInputElement | null;
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

        await chrome.runtime.sendMessage({
          type: MessageType.UPDATE_NOTE,
          noteId: note.id,
          content
        });

        view.openNoteTab(note, content);
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

    const panel = getPanel();
    const fileModal = panel?.querySelector('#file-modal') as HTMLElement | null;
    if (fileModal?.style.display === 'flex') {
      return;
    }
    if (fileModal) {
      fileModal.style.display = 'flex';
    }
  }

  async function handleSplitViewToggle() {
    if (panelState.splitEnabled) {
      panelState.splitEnabled = false;
      panelState.rightTabId = null;
      view.renderAll();
      return;
    }
    await loadData();
    renderSplitTabList(panelState.openTabs.filter(tabId => tabId !== panelState.activeTabId));
    renderSplitFolderTabs();
    renderSplitFileList(panelState.currentFolderId || INBOX_FOLDER_ID);
    openSplitModal();
  }

  function renderSplitTabList(tabIds: string[]) {
    const panel = getPanel();
    if (!panel) return;
    const list = panel.querySelector('#split-tab-list') as HTMLElement | null;
    if (!list) return;

    if (tabIds.length === 0) {
      list.innerHTML = '<div class="empty-message">開いているメモはありません</div>';
      return;
    }

    list.innerHTML = tabIds
      .map(tabId => {
        const title = view.getTabTitle(tabId);
        return `<button class="split-tab-item" data-tab-id="${tabId}">${escapeHtml(title)}</button>`;
      })
      .join('');

    list.querySelectorAll('.split-tab-item').forEach(item => {
      item.addEventListener('click', () => {
        const tabId = (item as HTMLElement).getAttribute('data-tab-id');
        if (!tabId) return;
        panelState.splitEnabled = true;
        view.setRightTab(tabId);
        closeSplitModal();
      });
    });
  }

  function renderSplitFolderTabs() {
    const panel = getPanel();
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
    const panel = getPanel();
    if (!panel) return;
    const fileList = panel.querySelector('#split-file-list');
    if (!fileList) return;

    chrome.runtime
      .sendMessage({
        type: MessageType.GET_NOTES_IN_FOLDER,
        folderId
      })
      .then(response => {
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
        view.openNoteTab(note, undefined, { activate: false });
        panelState.splitEnabled = true;
        view.setRightTab(note.id);
        closeSplitModal();
      }
    } catch (error) {
      console.error('[Content] Error loading note for split:', error);
      alert('メモの読み込み中にエラーが発生しました');
    }
  }

  function openSplitModal() {
    const panel = getPanel();
    const modal = panel?.querySelector('#split-modal') as HTMLElement | null;
    if (modal) {
      modal.style.display = 'flex';
    }
  }

  function closeSplitModal() {
    const panel = getPanel();
    const modal = panel?.querySelector('#split-modal') as HTMLElement | null;
    if (modal) {
      modal.style.display = 'none';
    }
  }

  async function refreshAuthButton() {
    const panel = getPanel();
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
    const panel = getPanel();
    const el = panel?.querySelector('#auth-modal-error') as HTMLElement | null;
    if (!el) return;
    el.textContent = message;
    el.style.display = 'block';
  }

  function hideAuthModalError() {
    const panel = getPanel();
    const el = panel?.querySelector('#auth-modal-error') as HTMLElement | null;
    if (!el) return;
    el.textContent = '';
    el.style.display = 'none';
  }

  function closeAuthModal() {
    const panel = getPanel();
    const authModal = panel?.querySelector('#auth-modal') as HTMLElement | null;
    if (authModal) {
      authModal.style.display = 'none';
    }
    hideAuthModalError();
  }

  function renderAuthModalState(state: { isAuthenticated: boolean; email: string | null }) {
    const panel = getPanel();
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

    const panel = getPanel();
    const authModal = panel?.querySelector('#auth-modal') as HTMLElement | null;
    if (authModal) {
      authModal.style.display = 'flex';
    }
  }

  async function handleAuthSignIn() {
    const panel = getPanel();
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
      view.renderAll();

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
    const panel = getPanel();
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
      view.renderAll();
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

    const panel = getPanel();
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
        view.openNoteTab(note);
      }
    } catch (error) {
      console.error('[Content] Error loading note:', error);
      alert('メモの読み込み中にエラーが発生しました');
    }
  }

  async function handleRenameNote(noteId: string, folderId: string) {
    const newTitle = prompt('新しいタイトルを入力してください:');
    if (newTitle === null) return;

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
        renderFileList(folderId);
        if (tabInfoMap[noteId]) {
          tabInfoMap[noteId].title = newTitle.trim();
          view.renderTabs();
          view.updateHeaderState();
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
        renderFileList(folderId);
        if (panelState.openTabs.includes(noteId)) {
          view.closeTab(noteId);
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
    const panel = getPanel();
    const fileModal = panel?.querySelector('#file-modal') as HTMLElement | null;
    if (fileModal) {
      fileModal.style.display = 'none';
    }
  }

  function closeSaveModal() {
    const panel = getPanel();
    const saveModal = panel?.querySelector('#save-modal') as HTMLElement | null;
    if (saveModal) {
      saveModal.style.display = 'none';
    }

    const titleInput = panel?.querySelector('#save-title') as HTMLInputElement | null;
    if (titleInput) {
      titleInput.value = '';
    }

    const newFolderInput = panel?.querySelector('#new-folder-name') as HTMLInputElement | null;
    const newFolderGroup = panel?.querySelector('#new-folder-group') as HTMLElement | null;
    if (newFolderInput) {
      newFolderInput.value = '';
    }
    if (newFolderGroup) {
      newFolderGroup.style.display = 'none';
    }
  }

  function renderFileList(folderId: string) {
    const panel = getPanel();
    if (!panel) return;

    const fileList = panel.querySelector('#file-list');
    if (!fileList) return;

    chrome.runtime
      .sendMessage({
        type: MessageType.GET_NOTES_IN_FOLDER,
        folderId
      })
      .then(response => {
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

          fileList.querySelectorAll('.file-item-info').forEach(item => {
            item.addEventListener('click', async (e) => {
              const noteId = (e.currentTarget as HTMLElement).parentElement?.getAttribute('data-note-id');
              if (noteId) {
                await loadNoteFromFile(noteId);
                closeFileModal();
              }
            });
          });

          fileList.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
              e.stopPropagation();
              const noteId = (e.currentTarget as HTMLElement).getAttribute('data-note-id');
              if (noteId) {
                await handleRenameNote(noteId, folderId);
              }
            });
          });

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
    const panel = getPanel();
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

    if (!folderTabs.hasAttribute('data-hover-bound')) {
      folderTabs.setAttribute('data-hover-bound', 'true');
      folderTabs.addEventListener('pointerleave', () => {
        if (folderHoverTimer) {
          clearTimeout(folderHoverTimer);
          folderHoverTimer = null;
        }
      });
    }

    folderTabs.querySelectorAll('.folder-tab').forEach(tab => {
      tab.addEventListener('pointerenter', () => {
        const folderId = tab.getAttribute('data-folder-id');
        if (!folderId) return;
        if (folderId === panelState.currentFolderId || folderId === lastHoverFolderId) return;
        if (folderHoverTimer) {
          clearTimeout(folderHoverTimer);
        }
        folderHoverTimer = window.setTimeout(() => {
          panelState.currentFolderId = folderId;
          lastHoverFolderId = folderId;
          renderFolderTabs();
          renderFileList(folderId);
        }, 150);
      });

      tab.addEventListener('click', async (e) => {
        const folderId = (e.target as HTMLElement).getAttribute('data-folder-id');
        if (folderId) {
          if (folderHoverTimer) {
            clearTimeout(folderHoverTimer);
            folderHoverTimer = null;
          }
          panelState.currentFolderId = folderId;
          renderFolderTabs();
          renderFileList(folderId);
        }
      });
    });
  }

  function renderSaveFolderSelect() {
    const panel = getPanel();
    if (!panel) return;

    const folderSelect = panel.querySelector('#save-folder') as HTMLSelectElement | null;
    const newFolderGroup = panel.querySelector('#new-folder-group') as HTMLElement | null;
    if (!folderSelect) return;

    const folderOptions = folders
      .map(
        folder =>
          `<option value="${folder.id}" ${folder.id === INBOX_FOLDER_ID ? 'selected' : ''}>${escapeHtml(folder.name)}</option>`
      )
      .join('');

    folderSelect.innerHTML = folderOptions + '<option value="__new__">+ 新規フォルダ</option>';

    folderSelect.onchange = () => {
      if (newFolderGroup) {
        newFolderGroup.style.display = folderSelect.value === '__new__' ? 'block' : 'none';
      }
    };
  }

  function getFocusedPane(): Pane {
    return panelState.lastFocusedPane;
  }

  function getFocusedTabId(): string | null {
    return view.getPaneTabId(getFocusedPane());
  }

  function flushDraftSave() {
    if (timers.autosaveTimer) {
      clearTimeout(timers.autosaveTimer);
      timers.autosaveTimer = null;
    }

    chrome.runtime.sendMessage({
      type: MessageType.UPDATE_QUICK_MEMO,
      content: draftMemo.content || ''
    });
  }

  return {
    closeAuthModal,
    closeFileModal,
    closeSaveModal,
    closeSplitModal,
    flushDraftSave,
    handleAuthSignIn,
    handleAuthSignOut,
    handleAuthSyncNow,
    handleConfirmSave,
    handleDeleteNote,
    handleMemoInput,
    handleNewNote,
    handleOpenFile,
    handleRenameNote,
    handleSave,
    handleSaveAs,
    handleSplitViewToggle,
    loadData,
    loadNoteFromFile,
    openAuthModal,
    openSplitModal,
    refreshAuthButton
  };
}
