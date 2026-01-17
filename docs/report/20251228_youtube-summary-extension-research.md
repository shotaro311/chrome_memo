# リサーチレポート

## 0. まず結論（要約）
- 「YouTube Summary with ChatGPT & Claude（Glasp）」自体の**公開ソースコード**や実装詳細は、Chrome Web Store の掲載情報・公式サイト・ステータスページでは確認できませんでした（少なくとも参照した公開ページ内には OSS/コードリンクが見当たりません）。citeturn1search0turn1search2turn2search5
- ただし、関連する**公開リポジトリ**として `kazuki-sf/YouTube_Summary_with_ChatGPT` があり、README で「字幕は手動取得で、YouTube 側変更により壊れる可能性がある」と明記されています。これは今回の「字幕取得が空になる」現象と整合するヒントです。citeturn2search1
- Glasp 側のステータス更新では「YouTube の data flow 変更により transcript 取得が壊れた」と明言しており、根本原因が**YouTube 側の取得仕様変更**にあることが示唆されています。citeturn2search5

## 1. 調査対象（テーマ）
- 「YouTube Summary with ChatGPT & Claude」拡張に実装ヒントとなる公開コードや、字幕取得まわりの公開情報があるか。citeturn1search0turn1search2turn2search5

## 2. 前提 / 解釈（曖昧さがある場合）
- 仮定: 公式拡張そのもののコードが公開されていれば参照したい。
- 仮定: 近い機能を持つ OSS があれば、その README や実装方針がヒントになる。

## 3. 調査方法（どう調べたか）
- Chrome Web Store の公式掲載情報を確認（リンク/開発者情報/説明文）。citeturn1search0
- Glasp の公式紹介ページと機能ページ、ステータスページを確認。citeturn1search2turn2search2turn2search5
- GitHub 上の関連リポジトリの有無を検索し、README を確認。citeturn2search1

## 4. 調査結果（詳細）
### 4.1 重要ポイント
- 公式ストア/公式サイト/ステータスページでは、実装コードや OSS の案内は確認できなかった（少なくとも参照ページ内にリンクがない）。citeturn1search0turn1search2turn2search5
- Glasp のステータスページで「YouTube の data flow 変更が字幕取得問題の原因」と明記されている。citeturn2search5
- `kazuki-sf/YouTube_Summary_with_ChatGPT` の README に「字幕取得は手動で、YouTube 側変更で壊れる可能性がある」と明記されている。citeturn2search1

### 4.2 根拠つき解説（段落ごとに引用）
Chrome Web Store と公式サイトは機能説明が中心で、公開コードや OSS リンクの記載は確認できませんでした（参照ページ範囲内の観測）。citeturn1search0turn1search2

Glasp のステータス更新では、字幕取得の不具合が「YouTube の data flow 変更」に起因すると明記されており、今回の現象（字幕取得が空になる）と一致する文脈です。citeturn2search5

公開 OSS として `kazuki-sf/YouTube_Summary_with_ChatGPT` が存在し、README で「字幕は手動取得で、YouTube 側変更で壊れ得る」と明記されています。これは今回のバグが仕様変更で壊れた可能性を補強するヒントになります。citeturn2search1

## 5. 高リスク領域の注意（該当する場合のみ）
- 公式拡張の内部実装は非公開の可能性が高く、未公開情報に踏み込む調査は行っていません（公開情報のみで整理）。citeturn1search0turn1search2turn2search5

## 6. 限界 / 未検証 / TODO
- 公式拡張のソースコードが「公開されていない」ことを断定できる一次資料は見つかりませんでした（参照した公開ページ内では確認できなかった、という範囲に留まります）。citeturn1search0turn1search2turn2search5
- TODO: OSS リポジトリの実装詳細（background.js 等）を直接確認し、字幕取得方式の具体例を抽出（別途 URL の直接確認が必要）。citeturn2search1

## 7. 参考文献（リンク）
- Chrome Web Store: YouTube Summary with ChatGPT & Claude citeturn1search0turn2search3
- Glasp 公式ページ（YouTube Summary） citeturn1search2turn2search2
- Glasp Extension Status（Transcript issues） citeturn2search5
- GitHub: kazuki-sf/YouTube_Summary_with_ChatGPT citeturn2search1
