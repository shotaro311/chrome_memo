# VS Code「ホバーで意味表示」用：高速モデル候補まとめ（API / ローカル）

## 作成日
2025-12-27

## 概要
VS Code のエディター上で、カーソルをホバーした単語（日本語/英語）について **日本語で「辞書っぽく」意味を短く表示**する用途を想定し、Gemini Flash 系以外の「速さ重視」モデル候補をまとめる。

## 前提（ユースケース）
- 1回のホバーで投げる入力は **「単語 + 周辺の短い文脈（例: 同一行 or 前後N文字）」**程度
- 応答は **1〜3文**程度（冗長にしない）
- 体感速度を優先（そのため **キャッシュ/デバウンス/タイムアウト**前提）

---

## 選定観点（速さ重視）
- **レイテンシ**：初回のTTFT（最初のトークン）と、短文生成の完了まで
- **安定性**：レート制限、エラー時のリトライ、モデルの継続提供
- **日本語の説明品質**：英語→日本語の意味説明、和文の語義説明（文脈込み）
- **コスト**：ホバーは呼び出し回数が増えやすい
- **データ送信**：コード/文章を外部に送る前提になることが多い（運用ルール必須）

---

## APIモデル候補（Gemini Flash 以外）

### OpenAI（小型・低遅延寄り）
候補例：
- `gpt-5-nano` / `gpt-5-mini`（軽量・低コスト寄りの枠）
- `gpt-4.1-nano` / `gpt-4.1-mini`、`gpt-4o-mini`（小型モデル枠）
- `gpt-realtime-mini`（Realtime 系。実装次第で“低遅延体験”を作りやすい）

参考：
- https://platform.openai.com/docs/models

### Anthropic（高速・コスパ枠）
候補例：
- Claude Haiku 4.5（Anthropicが「最速・最もコスパが良い」位置付けのモデル）

補足：
- Anthropic API の“正確な model id”は更新されることがあるため、実装時は `GET /v1/models` で取得して選ぶのが安全。

参考：
- https://www.anthropic.com/claude/haiku
- https://docs.anthropic.com/en/api/models-list
- https://docs.anthropic.com/en/docs/models-overview

### Groq（トークン生成が非常に速い系）
候補例：
- `llama-3.1-8b-instant`（超高速の“instant”枠）
- `openai/gpt-oss-20b`（低レイテンシ向けの open-weight 系をGroqで推論）

参考：
- https://console.groq.com/docs/models

### Cerebras Inference（tokens/s が非常に高い系）
候補例：
- `llama3.1-8b` / `llama-3.3-70b` / `gpt-oss-120b` / `qwen-3-32b`（公式が tokens/s の目安を掲載）

参考：
- https://inference-docs.cerebras.ai/models/overview

### Mistral（小〜中規模モデル枠も豊富）
候補例：
- `ministral-3b-2410` / `ministral-8b-2410`（軽量寄り）
- `mistral-small-2501` / `mistral-small-2503` 等（Small 系）

参考：
- https://docs.mistral.ai/getting-started/models/

---

## ローカルモデル候補（M3 MacBook Air 想定）

### ローカル推論の現実的な方針
- **3B前後（4bit量子化）**を基準にすると、速度・メモリのバランスが取りやすい
- 7B以上は「モデル/量子化/メモリ容量」で体感が大きく変わる（16GB以上だと選択肢が増える）

### 推論ランタイム候補
- **Ollama**：ローカルにモデルを入れて、HTTP で叩ける運用がしやすい
- **MLX / mlx-lm**：Apple Silicon 向けで、MLX対応モデルを扱える（Python）

参考：
- https://docs.ollama.com/
- https://github.com/ml-explore/mlx
- https://github.com/ml-explore/mlx-lm

### モデル候補（軽量〜中量）
#### Qwen2.5（日本語含む多言語）
- 0.5B / 1.5B / 3B / 7B … など幅があり、**日本語を含む多言語対応**が明記されている
- ライセンスがサイズで異なる点に注意（運用前に要確認）

参考：
- https://ollama.com/library/qwen2.5

#### Llama 3.2（1B / 3B）
- 1B / 3B の小型があり、ローカル用途に扱いやすい
- 日本語“公式サポート”は明記されていない（ただし多言語学習はされている、という説明はある）

参考：
- https://ollama.com/library/llama3.2

---

## 実装メモ（ホバー用途で必須になりがち）
- **キャッシュ**：`(単語 + 文脈)` で結果をメモ化（短時間の再ホバーは即返す）
- **デバウンス**：ホバー移動中の連打を抑える（例: 200〜400ms）
- **タイムアウト**：例: 700〜1200ms で一旦打ち切り、「詳細はコマンドで再実行」へ誘導
- **フォールバック**：API失敗時は「簡易（単語のみ）」や「ローカルモデル」に切り替え
- **プロンプト固定**：出力フォーマットを固定（例: 「意味 / この文脈では / 英語」など）

