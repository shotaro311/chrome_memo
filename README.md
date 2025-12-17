# Chrome拡張メモアプリ

ブラウザ右上に表示される**ダークモード**のシンプルなメモパネル。すぐにメモを取れる究極にシンプルなChrome拡張機能です。

## 主な機能

### シンプルなメモ機能
- **画面いっぱいのメモエリア** - クイックメモのみに特化
- **ダークモード** - 目に優しいダークテーマ
- **自動保存** - 入力すると自動で保存
- **等幅フォント** - コードやメモが読みやすい

### 快適な操作
- **ツールバーアイコンクリック** - ポップアップ（管理画面）が開く
- **ショートカット対応** - キーボードで素早く操作
- **リサイズ可能** - 自分の好みのサイズに調整可能

### ショートカットキー
- `Cmd+Shift+M` (Mac) / `Ctrl+Shift+M` (Windows): メモパネルを開閉
- `Cmd+Shift+A` (Mac) / `Ctrl+Shift+A` (Windows): クイックメモに追記（選択テキストがあれば追記）

## セットアップ

### 依存関係のインストール

```bash
npm install
```

### ビルド

#### 開発ビルド（ウォッチモード）
```bash
npm run dev
```

#### 本番ビルド
```bash
npm run build
```

### Chromeへのインストール

1. Chromeを開き、`chrome://extensions/` にアクセス
2. 右上の「デベロッパーモード」を有効にする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. プロジェクトの `dist` フォルダを選択

## プロジェクト構造

```
chrome_memo/
├── src/
│   ├── background/          # Background script
│   │   └── background.ts
│   ├── content/            # Content script（パネル）
│   │   └── content.ts
│   ├── popup/              # ツールバーPopup
│   │   ├── popup.html
│   │   ├── popup.ts
│   │   └── popup.css
│   ├── types/              # 型定義
│   │   └── index.ts
│   ├── utils/              # ユーティリティ
│   │   └── storage.ts
│   └── styles/             # スタイル
│       └── panel.css
├── public/
│   ├── manifest.json       # 拡張機能の設定
│   └── icons/              # アイコン画像
├── dist/                   # ビルド出力
├── package.json
├── tsconfig.json
└── webpack.config.js
```

## データ保存

- **保存先**: `chrome.storage.local`（端末ローカル）
- **自動保存**: 入力から約800ms後に自動保存
- **同期**: Chrome同期を有効にしていれば、設定が同期されます
- **文字数制限**: 1メモあたり最大20,000文字

## 技術スタック

- TypeScript
- Webpack
- Chrome Extension Manifest V3
- Chrome Storage API

## ライセンス

MIT
