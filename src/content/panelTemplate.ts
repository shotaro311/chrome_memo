import { DRAFT_PLACEHOLDER } from './panelTypes';

export function getPanelHtml(): string {
  return `
    <div class="panel-header">
      <div class="header-left">
        <h2 id="memo-title">メモ</h2>
        <button class="header-btn" id="save-as-btn" title="名前を付けて保存">💾</button>
        <button class="header-btn" id="save-btn" title="上書き保存" style="display: none;">📥</button>
        <button class="header-btn" id="open-file-btn" title="ファイルを開く">📂</button>
        <button class="header-btn" id="split-view-btn" title="スプリットビュー">⇔</button>
        <div class="font-size-control" id="font-size-control">
          <button class="header-btn" id="font-size-btn" title="フォントサイズ">🔠</button>
          <div class="font-size-menu" id="font-size-menu">
            <label>文字サイズ</label>
            <div class="font-size-options" id="font-size-options"></div>
          </div>
	        </div>
	        <button class="header-btn" id="ai-btn" title="AI">🤖</button>
	        <button class="header-btn" id="auth-btn" title="同期 / サインイン">👤</button>
	        <button class="header-btn" id="export-data-btn" title="メモをエクスポート">📤</button>
	        <button class="header-btn" id="import-data-btn" title="メモをインポート">📦</button>
	        <span class="memo-current-label" id="memo-current-label"></span>
	      </div>
	      <div class="header-right">
	        <button class="header-btn" id="toggle-panel-size-btn" title="パネルサイズ切り替え">⤢</button>
	        <button class="close-btn" id="close-panel-btn">×</button>
	      </div>
	    </div>

	    <input type="file" id="import-data-input" accept="application/json" style="display: none;" />

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

    <!-- メモ移動モーダル -->
    <div class="save-modal" id="move-note-modal" style="display: none;">
      <div class="save-modal-content">
        <div class="save-modal-header">
          <h3>メモを移動</h3>
          <button class="close-modal-btn" id="close-move-note-modal-btn">×</button>
        </div>
        <div class="save-modal-body">
          <div class="form-group">
            <label for="move-note-folder">移動先フォルダ:</label>
            <select id="move-note-folder" class="save-select"></select>
          </div>
          <div class="save-modal-actions">
            <button class="btn-primary" id="confirm-move-note-btn">移動</button>
            <button class="btn-secondary" id="cancel-move-note-btn">キャンセル</button>
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
          <div class="api-key-section">
            <div class="api-key-title">Gemini APIキー</div>
            <input
              type="password"
              id="gemini-api-key-input"
              class="save-input"
              placeholder="APIキーを入力"
            >
            <div class="api-key-actions">
              <button class="btn-primary" id="save-gemini-api-key-btn">保存</button>
              <button class="btn-secondary" id="delete-gemini-api-key-btn">削除</button>
            </div>
            <p class="api-key-status" id="gemini-api-key-status">未保存</p>
          </div>
        </div>
      </div>
    </div>

    <!-- AIモーダル -->
    <div class="ai-modal" id="ai-modal" style="display: none;">
      <div class="ai-modal-content">
        <div class="ai-modal-header">
          <h3>AI</h3>
          <div class="ai-modal-header-actions">
            <button class="close-modal-btn" id="ai-settings-btn" title="AI設定">⚙</button>
            <button class="close-modal-btn" id="close-ai-modal-btn">×</button>
          </div>
        </div>
        <div class="ai-modal-body">
          <div class="ai-settings" id="ai-settings" style="display: none;">
            <div class="ai-settings-title">AI設定</div>
            <div class="form-group">
              <label for="gemini-custom-prompt-input">常に適用するプロンプト</label>
              <textarea
                id="gemini-custom-prompt-input"
                class="save-input ai-textarea"
                placeholder="例: 日本語で、箇条書き中心で、丁寧語で"
              ></textarea>
            </div>
            <div class="ai-settings-actions">
              <button class="btn-primary" id="save-gemini-custom-prompt-btn">保存</button>
              <button class="btn-secondary" id="clear-gemini-custom-prompt-btn">クリア</button>
            </div>
            <p class="api-key-status" id="gemini-custom-prompt-status">未保存</p>
          </div>
          <div class="form-group">
            <label for="ai-prompt-input">指示</label>
            <textarea
              id="ai-prompt-input"
              class="save-input ai-textarea"
              placeholder="例: 要約して、箇条書きで"
            ></textarea>
            <div class="ai-hint">Enterで実行 / Shift+Enterで改行</div>
          </div>
          <div class="ai-loading" id="ai-loading" style="display: none;">
            <div class="ai-spinner"></div>
            <span>反映中...</span>
          </div>
          <div class="ai-status-row">
            <span id="ai-selection-status">カーソル挿入</span>
          </div>
        </div>
      </div>
    </div>

    <!-- フォルダメニュー -->
    <div class="folder-context-menu" id="folder-context-menu" style="display: none;">
      <button class="folder-context-item" id="folder-context-rename">名前を変更</button>
      <button class="folder-context-item" id="folder-context-delete">削除</button>
    </div>

    <!-- タブサムネメニュー -->
    <div class="tab-thumbnail-menu" id="tab-thumbnail-menu" style="display: none;">
      <div class="tab-thumbnail-preview">
        <div class="tab-thumbnail-loading" id="tab-thumbnail-loading">読み込み中...</div>
        <img class="tab-thumbnail-img" id="tab-thumbnail-img" alt="thumbnail" />
      </div>
      <div class="tab-thumbnail-actions">
        <button class="btn-secondary" id="tab-thumbnail-delete-btn">削除</button>
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
}
