# Parallel Dev DAG（Refactoring）

## DAG サマリー（ノードと依存）
> 形式: `TASK_ID: depends_on -> [ ... ]`

- T1: depends_on -> []（Content: `src/content/content.ts` の分割・責務整理）
- T2: depends_on -> []（Storage: `src/utils/storage.ts` 周辺の整理）
- T3: depends_on -> []（Style: `src/styles/panel.css` の整理）
- T4: depends_on -> [T1, T2, T3]（最終統合・ドキュメント同期）

## タスク一覧

### T1: Content のリファクタ（分割・整理）
- 目的: `src/content/content.ts`（1543行）を責務ごとに分割し、読みやすくする（挙動は変えない）
- 依存: []
- 並行可否: 可（T2/T3 とファイルを被せない）
- SCOPE（変更対象）:
  - `src/content/**`
- 触らない（共有境界）:
  - `src/types/index.ts`
  - `src/utils/storage.ts`
  - `src/styles/panel.css`
- 成果物:
  - diff（またはPR）
- テスト/確認:
  - `npm run build`

### T2: Storage 周辺のリファクタ（重複削減・読みやすさ）
- 目的: `src/utils/storage.ts` を中心に、ストレージ操作の重複を減らし読みやすくする（挙動は変えない）
- 依存: []
- 並行可否: 可（T1/T3 とファイルを被せない）
- SCOPE（変更対象）:
  - `src/utils/storage.ts`
  - （必要なら）`src/lib/chromeStorage.ts`
- 触らない（共有境界）:
  - `src/content/**`
  - `src/types/index.ts`（変更が必要なら architect に相談）
- 成果物:
  - diff（またはPR）
- テスト/確認:
  - `npm run build`

### T3: Style のリファクタ（整理・死活確認）
- 目的: `src/styles/panel.css` を整理し、タブ/スプリット/モーダル周りの見通しを良くする（見た目は極力維持）
- 依存: []
- 並行可否: 可（T1/T2 とファイルを被せない）
- SCOPE（変更対象）:
  - `src/styles/panel.css`
- 触らない（共有境界）:
  - `src/content/**`
  - `src/types/index.ts`
- 成果物:
  - diff（またはPR）
- テスト/確認:
  - `npm run build`

### T4: 統合・動作確認・ドキュメント同期（Architect）
- 目的: T1/T2/T3 の成果を順番に統合し、`docs/20251219_PLAN1.md` と必要なドキュメントを同期する
- 依存: [T1, T2, T3]
- 並行可否: 不可
- SCOPE（変更対象）:
  - `docs/20251219_PLAN1.md`
  - `INSTALL.md`（必要なら）
- テスト/確認:
  - `npm run build`
  - Chrome に読み込みして主要操作を手動確認（タブ/スプリット/保存/同期）

