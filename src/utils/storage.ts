import {
  Folder,
  Note,
  NoteMetadata,
  QuickMemo,
  LocalStorageData,
  SyncStorageData,
  AppSettings,
  INBOX_FOLDER_ID,
  LIMITS
} from '../types';

// ========================================
// 内部ヘルパー
// ========================================

async function getSyncValue<K extends keyof SyncStorageData>(
  key: K
): Promise<SyncStorageData[K] | undefined> {
  const data = await chrome.storage.sync.get(key as string);
  return data[key as string] as SyncStorageData[K] | undefined;
}

async function setSyncValue<K extends keyof SyncStorageData>(
  key: K,
  value: SyncStorageData[K]
): Promise<void> {
  await chrome.storage.sync.set({ [key]: value } as Partial<SyncStorageData>);
}

async function getLocalValue<K extends keyof LocalStorageData>(
  key: K
): Promise<LocalStorageData[K] | undefined> {
  const data = await chrome.storage.local.get(key as string);
  return data[key as string] as LocalStorageData[K] | undefined;
}

async function setLocalValue<K extends keyof LocalStorageData>(
  key: K,
  value: LocalStorageData[K]
): Promise<void> {
  await chrome.storage.local.set({ [key]: value } as Partial<LocalStorageData>);
}

// ========================================
// 初期化
// ========================================

/**
 * ストレージを初期化する（初回起動時）
 */
export async function initializeStorage(): Promise<void> {
  const syncData = await chrome.storage.sync.get(null);
  const localData = await chrome.storage.local.get(null);

  // Syncストレージの初期化
  if (!syncData.folders || Object.keys(syncData.folders).length === 0) {
    const inboxFolder: Folder = {
      id: INBOX_FOLDER_ID,
      name: 'Inbox',
      createdAt: Date.now(),
      isSystem: true
    };

    const defaultSettings: AppSettings = {
      shortcutGuideShown: false,
      memoFontSize: LIMITS.DEFAULT_MEMO_FONT_SIZE,
      panelLastWidth: LIMITS.DEFAULT_PANEL_WIDTH,
      panelLastHeight: LIMITS.DEFAULT_PANEL_HEIGHT
    };

    await chrome.storage.sync.set({
      folders: { [INBOX_FOLDER_ID]: inboxFolder },
      noteMetadata: {},
      settings: defaultSettings
    });
  }

  // Localストレージの初期化
  if (!localData.notes) {
    const defaultQuickMemo: QuickMemo = {
      content: '',
      updatedAt: Date.now()
    };

    await chrome.storage.local.set({
      notes: {},
      quickMemo: defaultQuickMemo
    });
  }
}

// ========================================
// フォルダ操作
// ========================================

/**
 * すべてのフォルダを取得
 */
export async function getFolders(): Promise<Folder[]> {
  const folders = (await getSyncValue('folders')) || {};

  // Inbox を先頭、その後はフォルダ名昇順
  return Object.values(folders).sort((a, b) => {
    if (a.id === INBOX_FOLDER_ID) return -1;
    if (b.id === INBOX_FOLDER_ID) return 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

/**
 * フォルダを作成
 */
export async function createFolder(name: string): Promise<Folder> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('フォルダ名を入力してください');
  }

  const folderList = await getFolders();

  // 上限チェック
  if (folderList.length >= LIMITS.MAX_FOLDERS) {
    throw new Error(`フォルダ数の上限（${LIMITS.MAX_FOLDERS}）に達しています`);
  }

  // 重複チェック（ケース無視）
  const isDuplicate = folderList.some(
    f => f.name.toLowerCase() === trimmedName.toLowerCase()
  );
  if (isDuplicate) {
    throw new Error('同じ名前のフォルダが既に存在します');
  }

  const newFolder: Folder = {
    id: generateId(),
    name: trimmedName,
    createdAt: Date.now(),
    isSystem: false
  };

  const folderMap = (await getSyncValue('folders')) || {};
  const updatedFolders = { ...folderMap, [newFolder.id]: newFolder };
  await setSyncValue('folders', updatedFolders);

  return newFolder;
}

/**
 * フォルダを削除（配下のメモも削除）
 */
export async function deleteFolder(folderId: string): Promise<void> {
  const folderList = await getFolders();
  const folder = folderList.find(f => f.id === folderId);

  if (!folder) {
    throw new Error('フォルダが見つかりません');
  }

  if (folder.isSystem) {
    throw new Error('システムフォルダは削除できません');
  }

  // 配下のメモを取得して削除
  const notes = await getNotesInFolder(folderId);
  for (const note of notes) {
    await deleteNote(note.id);
  }

  // フォルダを削除
  const folderMap = (await getSyncValue('folders')) || {};
  const updatedFolders = { ...folderMap };
  delete updatedFolders[folderId];
  await setSyncValue('folders', updatedFolders);
}

/**
 * フォルダをリネーム
 */
export async function renameFolder(folderId: string, newName: string): Promise<void> {
  const trimmedName = newName.trim();
  if (!trimmedName) {
    throw new Error('フォルダ名を入力してください');
  }

  const folderList = await getFolders();
  const folder = folderList.find(f => f.id === folderId);

  if (!folder) {
    throw new Error('フォルダが見つかりません');
  }

  if (folder.isSystem) {
    throw new Error('システムフォルダはリネームできません');
  }

  // 重複チェック（自分自身は除外）
  const isDuplicate = folderList.some(
    f => f.id !== folderId && f.name.toLowerCase() === trimmedName.toLowerCase()
  );
  if (isDuplicate) {
    throw new Error('同じ名前のフォルダが既に存在します');
  }

  const folderMap = (await getSyncValue('folders')) || {};
  const updatedFolders = {
    ...folderMap,
    [folderId]: { ...folder, name: trimmedName }
  };
  await setSyncValue('folders', updatedFolders);
}

// ========================================
// メモ操作
// ========================================

/**
 * 指定フォルダ内のメモを取得（最終更新日時降順）
 */
export async function getNotesInFolder(folderId: string): Promise<Note[]> {
  const notes = (await getLocalValue('notes')) || {};

  const folderNotes = Object.values(notes)
    .filter(note => note.folderId === folderId)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return folderNotes;
}

/**
 * メモを取得
 */
export async function getNote(noteId: string): Promise<Note | null> {
  const notes = (await getLocalValue('notes')) || {};
  return notes[noteId] || null;
}

/**
 * すべてのメモを取得
 */
export async function getAllNotes(): Promise<Note[]> {
  const notes = (await getLocalValue('notes')) || {};
  return Object.values(notes);
}

/**
 * メモを作成
 */
export async function createNote(
  folderId: string,
  title?: string,
  content: string = ''
): Promise<Note> {
  // フォルダ存在チェック
  const folders = await getFolders();
  const folder = folders.find(f => f.id === folderId);
  if (!folder) {
    throw new Error('フォルダが見つかりません');
  }

  // フォルダ内のメモ数チェック
  const folderNotes = await getNotesInFolder(folderId);
  if (folderNotes.length >= LIMITS.MAX_NOTES_PER_FOLDER) {
    throw new Error(`1フォルダあたりのメモ数上限（${LIMITS.MAX_NOTES_PER_FOLDER}）に達しています`);
  }

  // 総メモ数チェック
  const allNotes = await getAllNotes();
  if (allNotes.length >= LIMITS.MAX_TOTAL_NOTES) {
    throw new Error(`総メモ数の上限（${LIMITS.MAX_TOTAL_NOTES}）に達しています`);
  }

  // タイトル生成
  const noteTitle = title?.trim() || generateDefaultTitle();

  // 同一フォルダ内でタイトル重複チェック
  const isDuplicate = folderNotes.some(
    note => note.title.toLowerCase() === noteTitle.toLowerCase()
  );
  if (isDuplicate) {
    throw new Error('同じタイトルのメモが既に存在します');
  }

  const now = Date.now();
  const newNote: Note = {
    id: generateId(),
    folderId,
    title: noteTitle,
    content,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now
  };

  // Localストレージに本文を保存
  const notes = (await getLocalValue('notes')) || {};
  const updatedNotes = { ...notes, [newNote.id]: newNote };
  await setLocalValue('notes', updatedNotes);

  // Syncストレージにメタデータを保存
  const metadata: NoteMetadata = {
    id: newNote.id,
    folderId: newNote.folderId,
    title: newNote.title,
    createdAt: newNote.createdAt,
    updatedAt: newNote.updatedAt,
    lastOpenedAt: newNote.lastOpenedAt
  };
  const noteMetadata = (await getSyncValue('noteMetadata')) || {};
  const updatedMetadata = { ...noteMetadata, [metadata.id]: metadata };
  await setSyncValue('noteMetadata', updatedMetadata);

  return newNote;
}

/**
 * メモを更新
 */
export async function updateNote(
  noteId: string,
  updates: { title?: string; content?: string }
): Promise<Note> {
  const note = await getNote(noteId);
  if (!note) {
    throw new Error('メモが見つかりません');
  }

  // タイトル更新の場合、重複チェック
  if (updates.title !== undefined) {
    const trimmedTitle = updates.title.trim() || generateDefaultTitle();
    const folderNotes = await getNotesInFolder(note.folderId);
    const isDuplicate = folderNotes.some(
      n => n.id !== noteId && n.title.toLowerCase() === trimmedTitle.toLowerCase()
    );
    if (isDuplicate) {
      throw new Error('同じタイトルのメモが既に存在します');
    }
    note.title = trimmedTitle;
  }

  // 本文更新
  if (updates.content !== undefined) {
    if (updates.content.length > LIMITS.MAX_NOTE_LENGTH) {
      throw new Error(`メモの最大文字数（${LIMITS.MAX_NOTE_LENGTH}）を超えています`);
    }
    note.content = updates.content;
  }

  note.updatedAt = Date.now();

  // Localストレージを更新
  const notes = (await getLocalValue('notes')) || {};
  const updatedNotes = { ...notes, [noteId]: note };
  await setLocalValue('notes', updatedNotes);

  // Syncストレージのメタデータを更新
  const metadata: NoteMetadata = {
    id: note.id,
    folderId: note.folderId,
    title: note.title,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    lastOpenedAt: note.lastOpenedAt
  };
  const noteMetadata = (await getSyncValue('noteMetadata')) || {};
  const updatedMetadata = { ...noteMetadata, [metadata.id]: metadata };
  await setSyncValue('noteMetadata', updatedMetadata);

  return note;
}

/**
 * メモを削除
 */
export async function deleteNote(noteId: string): Promise<void> {
  // Localストレージから削除
  const notes = (await getLocalValue('notes')) || {};
  const updatedNotes = { ...notes };
  delete updatedNotes[noteId];
  await setLocalValue('notes', updatedNotes);

  // Syncストレージのメタデータから削除
  const noteMetadata = (await getSyncValue('noteMetadata')) || {};
  const updatedMetadata = { ...noteMetadata };
  delete updatedMetadata[noteId];
  await setSyncValue('noteMetadata', updatedMetadata);
}

/**
 * メモを開いた記録を更新
 */
export async function markNoteAsOpened(noteId: string): Promise<void> {
  const note = await getNote(noteId);
  if (!note) {
    throw new Error('メモが見つかりません');
  }

  note.lastOpenedAt = Date.now();

  // Localストレージを更新
  const notes = (await getLocalValue('notes')) || {};
  const updatedNotes = { ...notes, [noteId]: note };
  await setLocalValue('notes', updatedNotes);

  // Syncストレージのメタデータを更新
  const noteMetadata = (await getSyncValue('noteMetadata')) || {};
  const metadata = noteMetadata[noteId];
  if (metadata) {
    metadata.lastOpenedAt = note.lastOpenedAt;
    const updatedMetadata = { ...noteMetadata, [noteId]: metadata };
    await setSyncValue('noteMetadata', updatedMetadata);
  }
}

/**
 * 最近使ったメモを取得（最大3件）
 */
export async function getRecentNotes(): Promise<Note[]> {
  const allNotes = await getAllNotes();
  return allNotes
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(0, LIMITS.MAX_RECENT_NOTES);
}

// ========================================
// 下書きメモ操作
// ========================================

/**
 * 下書きメモを取得
 */
export async function getQuickMemo(): Promise<QuickMemo> {
  const quickMemo = await getLocalValue('quickMemo');
  return quickMemo || { content: '', updatedAt: Date.now() };
}

/**
 * 下書きメモを更新
 */
export async function updateQuickMemo(content: string): Promise<QuickMemo> {
  const quickMemo: QuickMemo = {
    content,
    updatedAt: Date.now()
  };
  await setLocalValue('quickMemo', quickMemo);
  return quickMemo;
}

/**
 * 下書きメモを追記
 */
export async function appendToQuickMemo(text: string): Promise<QuickMemo> {
  const quickMemo = await getQuickMemo();
  const newContent = quickMemo.content ? `${quickMemo.content}\n${text}` : text;
  return await updateQuickMemo(newContent);
}

/**
 * 下書きメモを通常メモとして保存（コピー方式）
 */
export async function saveQuickMemoAsNote(
  folderId: string,
  title?: string
): Promise<Note> {
  const quickMemo = await getQuickMemo();
  if (!quickMemo.content.trim()) {
    throw new Error('下書きメモが空です');
  }

  return await createNote(folderId, title, quickMemo.content);
}

// ========================================
// 検索
// ========================================

/**
 * メモを検索（タイトル + 本文、部分一致、ケース無視）
 */
export async function searchNotes(
  query: string,
  folderId?: string
): Promise<Note[]> {
  if (!query.trim()) {
    return [];
  }

  const searchQuery = query.toLowerCase();
  let notes = await getAllNotes();

  // フォルダ指定があればフィルタ
  if (folderId) {
    notes = notes.filter(note => note.folderId === folderId);
  }

  // タイトルまたは本文に含まれるメモを検索
  return notes.filter(note => {
    return (
      note.title.toLowerCase().includes(searchQuery) ||
      note.content.toLowerCase().includes(searchQuery)
    );
  });
}

// ========================================
// 設定
// ========================================

/**
 * 設定を取得
 */
export async function getSettings(): Promise<AppSettings> {
  const settings = await getSyncValue('settings');
  return {
    shortcutGuideShown: false,
    memoFontSize: LIMITS.DEFAULT_MEMO_FONT_SIZE,
    panelLastWidth: LIMITS.DEFAULT_PANEL_WIDTH,
    panelLastHeight: LIMITS.DEFAULT_PANEL_HEIGHT,
    ...(settings || {})
  };
}

/**
 * 設定を更新
 */
export async function updateSettings(
  updates: Partial<AppSettings>
): Promise<AppSettings> {
  const settings = await getSettings();
  const updatedSettings = { ...settings, ...updates };
  await setSyncValue('settings', updatedSettings);
  return updatedSettings;
}

// ========================================
// ユーティリティ
// ========================================

/**
 * ユニークIDを生成
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * デフォルトタイトルを生成
 */
function generateDefaultTitle(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');

  return `New Note (${year}-${month}-${day} ${hours}:${minutes})`;
}
