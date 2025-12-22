// ========================================
// データモデル
// ========================================

/**
 * フォルダ
 */
export interface Folder {
  id: string;
  name: string;
  createdAt: number;
  isSystem: boolean; // Inboxの場合true
}

/**
 * メモ（通常メモ）
 */
export interface Note {
  id: string;
  folderId: string;
  title: string;
  content: string; // 本文
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number; // 最近使ったメモ用
}

/**
 * メモのメタデータ（sync用）
 */
export interface NoteMetadata {
  id: string;
  folderId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
}

/**
 * 下書きメモ
 */
export interface QuickMemo {
  content: string;
  updatedAt: number;
}

// ========================================
// ストレージデータ構造
// ========================================

/**
 * chrome.storage.local に保存するデータ（本文含む）
 */
export interface LocalStorageData {
  notes: Record<string, Note>; // noteId -> Note
  quickMemo: QuickMemo;
}

/**
 * chrome.storage.sync に保存するデータ（設定・構造・メタデータのみ）
 */
export interface SyncStorageData {
  folders: Record<string, Folder>; // folderId -> Folder
  noteMetadata: Record<string, NoteMetadata>; // noteId -> NoteMetadata
  settings: AppSettings;
}

/**
 * アプリ設定
 */
export interface AppSettings {
  shortcutGuideShown: boolean; // ショートカット案内を表示したか
  memoFontSize: number; // メモ欄のフォントサイズ(px)
  panelLastWidth: number; // 最後に手動で調整したパネル幅
  panelLastHeight: number; // 最後に手動で調整したパネル高さ
}

// ========================================
// パネル状態（タブ内保持）
// ========================================

/**
 * パネルの状態（タブごとに保持）
 */
export interface PanelState {
  isVisible: boolean;
  width: number;
  height: number;
  currentFolderId: string | null; // 現在選択中のフォルダ
  currentNoteId: string | null; // 現在開いているメモ
  searchQuery: string;
  openTabs: string[]; // 開いているタブ（順序保持）
  activeTabId: string | null; // 左側のアクティブタブ
  splitEnabled: boolean;
  rightTabId: string | null; // 右側のタブ
  lastFocusedPane: 'left' | 'right';
}

// ========================================
// メッセージ通信
// ========================================

/**
 * メッセージタイプ
 */
export enum MessageType {
  // パネル制御
  TOGGLE_PANEL = 'TOGGLE_PANEL',
  OPEN_PANEL = 'OPEN_PANEL',
  CLOSE_PANEL = 'CLOSE_PANEL',

  // 認証
  AUTH_SIGN_IN = 'AUTH_SIGN_IN',
  AUTH_SIGN_OUT = 'AUTH_SIGN_OUT',
  AUTH_GET_STATE = 'AUTH_GET_STATE',
  AUTH_SYNC_NOW = 'AUTH_SYNC_NOW',

  // 設定
  GET_SETTINGS = 'GET_SETTINGS',
  UPDATE_SETTINGS = 'UPDATE_SETTINGS',

  UPDATE_QUICK_MEMO = 'UPDATE_QUICK_MEMO',

  // AI
  GEMINI_GENERATE = 'GEMINI_GENERATE',

  // フォルダ操作
  CREATE_FOLDER = 'CREATE_FOLDER',
  DELETE_FOLDER = 'DELETE_FOLDER',
  RENAME_FOLDER = 'RENAME_FOLDER',

  // メモ操作
  CREATE_NOTE = 'CREATE_NOTE',
  UPDATE_NOTE = 'UPDATE_NOTE',
  DELETE_NOTE = 'DELETE_NOTE',
  OPEN_NOTE = 'OPEN_NOTE',
  SAVE_QUICK_MEMO_AS_NOTE = 'SAVE_QUICK_MEMO_AS_NOTE',

  // データ取得
  GET_FOLDERS = 'GET_FOLDERS',
  GET_NOTES_IN_FOLDER = 'GET_NOTES_IN_FOLDER',
  GET_NOTE = 'GET_NOTE',
  GET_QUICK_MEMO = 'GET_QUICK_MEMO',
  GET_RECENT_NOTES = 'GET_RECENT_NOTES',

  // エクスポート
  GET_EXPORT_DATA = 'GET_EXPORT_DATA',

  // 検索
  SEARCH_NOTES = 'SEARCH_NOTES',

  // エラー
  ERROR = 'ERROR'
}

/**
 * メッセージの基底型
 */
export interface BaseMessage {
  type: MessageType;
}

/**
 * パネルトグルメッセージ
 */
export interface TogglePanelMessage extends BaseMessage {
  type: MessageType.TOGGLE_PANEL;
}

/**
 * パネルを開くメッセージ
 */
export interface OpenPanelMessage extends BaseMessage {
  type: MessageType.OPEN_PANEL;
  noteId?: string; // 特定のメモを開く場合
}

/**
 * サインイン開始メッセージ
 */
export interface AuthSignInMessage extends BaseMessage {
  type: MessageType.AUTH_SIGN_IN;
}

/**
 * サインアウトメッセージ
 */
export interface AuthSignOutMessage extends BaseMessage {
  type: MessageType.AUTH_SIGN_OUT;
}

/**
 * 認証状態取得メッセージ
 */
export interface AuthGetStateMessage extends BaseMessage {
  type: MessageType.AUTH_GET_STATE;
}

/**
 * 同期実行メッセージ
 */
export interface AuthSyncNowMessage extends BaseMessage {
  type: MessageType.AUTH_SYNC_NOW;
}

/**
 * 設定取得メッセージ
 */
export interface GetSettingsMessage extends BaseMessage {
  type: MessageType.GET_SETTINGS;
}

/**
 * 設定更新メッセージ
 */
export interface UpdateSettingsMessage extends BaseMessage {
  type: MessageType.UPDATE_SETTINGS;
  updates: Partial<AppSettings>;
}

/**
 * Gemini生成メッセージ
 */
export interface GeminiGenerateMessage extends BaseMessage {
  type: MessageType.GEMINI_GENERATE;
  prompt: string;
  model?: string;
}

/**
 * 下書きメモ更新メッセージ
 */
export interface UpdateQuickMemoMessage extends BaseMessage {
  type: MessageType.UPDATE_QUICK_MEMO;
  content: string;
}

/**
 * フォルダ作成メッセージ
 */
export interface CreateFolderMessage extends BaseMessage {
  type: MessageType.CREATE_FOLDER;
  name: string;
}

/**
 * フォルダ削除メッセージ
 */
export interface DeleteFolderMessage extends BaseMessage {
  type: MessageType.DELETE_FOLDER;
  folderId: string;
}

/**
 * フォルダリネームメッセージ
 */
export interface RenameFolderMessage extends BaseMessage {
  type: MessageType.RENAME_FOLDER;
  folderId: string;
  newName: string;
}

/**
 * メモ作成メッセージ
 */
export interface CreateNoteMessage extends BaseMessage {
  type: MessageType.CREATE_NOTE;
  folderId: string;
  title?: string;
}

/**
 * メモ更新メッセージ
 */
export interface UpdateNoteMessage extends BaseMessage {
  type: MessageType.UPDATE_NOTE;
  noteId: string;
  title?: string;
  content?: string;
}

/**
 * メモ削除メッセージ
 */
export interface DeleteNoteMessage extends BaseMessage {
  type: MessageType.DELETE_NOTE;
  noteId: string;
}

/**
 * メモを開くメッセージ
 */
export interface OpenNoteMessage extends BaseMessage {
  type: MessageType.OPEN_NOTE;
  noteId: string;
}

/**
 * 下書きメモを通常メモとして保存
 */
export interface SaveQuickMemoAsNoteMessage extends BaseMessage {
  type: MessageType.SAVE_QUICK_MEMO_AS_NOTE;
  folderId: string;
  title?: string;
}

/**
 * フォルダ一覧取得メッセージ
 */
export interface GetFoldersMessage extends BaseMessage {
  type: MessageType.GET_FOLDERS;
}

/**
 * フォルダ内のメモ一覧取得メッセージ
 */
export interface GetNotesInFolderMessage extends BaseMessage {
  type: MessageType.GET_NOTES_IN_FOLDER;
  folderId: string;
}

/**
 * メモ取得メッセージ
 */
export interface GetNoteMessage extends BaseMessage {
  type: MessageType.GET_NOTE;
  noteId: string;
}

/**
 * 下書きメモ取得メッセージ
 */
export interface GetQuickMemoMessage extends BaseMessage {
  type: MessageType.GET_QUICK_MEMO;
}

/**
 * 最近使ったメモ取得メッセージ
 */
export interface GetRecentNotesMessage extends BaseMessage {
  type: MessageType.GET_RECENT_NOTES;
}

/**
 * エクスポートデータ取得メッセージ
 */
export interface GetExportDataMessage extends BaseMessage {
  type: MessageType.GET_EXPORT_DATA;
}

/**
 * 検索メッセージ
 */
export interface SearchNotesMessage extends BaseMessage {
  type: MessageType.SEARCH_NOTES;
  query: string;
  folderId?: string; // 指定されたフォルダ内のみ検索
}

/**
 * エラーメッセージ
 */
export interface ErrorMessage extends BaseMessage {
  type: MessageType.ERROR;
  message: string;
}

/**
 * すべてのメッセージ型の統合型
 */
export type Message =
  | TogglePanelMessage
  | OpenPanelMessage
  | AuthSignInMessage
  | AuthSignOutMessage
  | AuthGetStateMessage
  | AuthSyncNowMessage
  | GetSettingsMessage
  | UpdateSettingsMessage
  | GeminiGenerateMessage
  | UpdateQuickMemoMessage
  | CreateFolderMessage
  | DeleteFolderMessage
  | RenameFolderMessage
  | CreateNoteMessage
  | UpdateNoteMessage
  | DeleteNoteMessage
  | OpenNoteMessage
  | SaveQuickMemoAsNoteMessage
  | GetFoldersMessage
  | GetNotesInFolderMessage
  | GetNoteMessage
  | GetQuickMemoMessage
  | GetRecentNotesMessage
  | GetExportDataMessage
  | SearchNotesMessage
  | ErrorMessage;

// ========================================
// レスポンス
// ========================================

/**
 * 成功レスポンス
 */
export interface SuccessResponse<T = any> {
  success: true;
  data: T;
}

/**
 * エラーレスポンス
 */
export interface ErrorResponse {
  success: false;
  error: string;
}

/**
 * レスポンス型
 */
export type Response<T = any> = SuccessResponse<T> | ErrorResponse;

// ========================================
// 定数
// ========================================

/**
 * 制限値
 */
export const LIMITS = {
  MAX_FOLDERS: 30,
  MAX_NOTES_PER_FOLDER: 10,
  MAX_TOTAL_NOTES: 300,
  MAX_NOTE_LENGTH: 20000,
  MAX_RECENT_NOTES: 3,

  // パネルサイズ制限
  MIN_PANEL_WIDTH: 360,
  MIN_PANEL_HEIGHT: 260,
  MAX_PANEL_WIDTH: 800,
  MAX_PANEL_HEIGHT: 900,

  // デフォルトパネルサイズ
  DEFAULT_PANEL_WIDTH: 600,
  DEFAULT_PANEL_HEIGHT: 700,

  // デフォルトメモフォントサイズ(px)
  DEFAULT_MEMO_FONT_SIZE: 15
} as const;

/**
 * システムフォルダID
 */
export const INBOX_FOLDER_ID = 'inbox';

/**
 * デバウンス間隔（ミリ秒）
 */
export const AUTOSAVE_DEBOUNCE_MS = 800;

/**
 * 空メモの自動削除タイムアウト（ミリ秒）
 */
export const EMPTY_NOTE_DELETE_TIMEOUT_MS = 30000; // 30秒
