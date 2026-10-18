# tibo-reset

Tibo (`@thsottiaux`) の直近100件の公開投稿と返信を取得し、**Decisions API** で「今後24時間以内に臨時リセットが起きるか」を0–100で表示する実験用 CLI。根拠候補の投稿URL・日時・分類と、文脈の欠落も保存します。

**現時点の的中率は未検証です。** 数値は未来の出来事についての未校正のモデル推定で、実際の発生確率を保証しません。根拠不足・回答拒否時はスコアを `null` とし「判定保留」と表示します。投稿がないことを0%と扱いません。

## 実行

Node.js 22 以上が必要です。

```sh
cd tibo-reset
npm ci --ignore-scripts
cp .env.example .env
```

`.env` に `OPENAI_API_KEY`、自分の X セッションの `X_AUTH_TOKEN` (`auth_token`)、`X_CT0` (`ct0`) をローカルで設定してください。Cookie はログイン済みブラウザーの開発者ツール → Application/Storage → Cookies → `https://x.com` で確認できます。Cookie を発行した OS に `X_PLATFORM` を合わせます。このファイルと取得データは Git 管理から除外しています。秘密値をチャットへ貼り付ける必要はありません。

```sh
# 取得 → data/posts.json → Decisions → data/report.json
npm start -- run --username thsottiaux --count 100 --hours 24

# 取得と解析を分ける。解析時に X への接続は不要
npm start -- collect --count 100 --out data/posts.json
npm start -- analyze --input data/posts.json --target codex --hours 24

# 金額としての OpenAI API credit を対象にする場合
npm start -- analyze --input data/posts.json --target api-credit
```

`codex` は Codex サブスクリプションの臨時の使用枠補充、`api-credit` は金額としての API クレジット補充です。通常の5時間・週次更新や、個人が保存済みリセットを使う行為は対象外です。既定対象は `codex`、予測期間は解析時点から24時間です。`--hours` は1–168時間、`--count` は1–190件を指定できます。

`--guest` で未認証取得も試せますが、X 側が拒否したり、返信を返さなかったりすることがあります。ログインが必要な場合は終了します。認証制限やチャレンジを迂回する処理はありません。

2026年10月18日の動作確認では、ゲスト取得は99件を返しましたが、最新日時は2025年11月19日でした。**取得件数だけでは「直近100件」の保証になりません。** このデータから現在のスコアは算出していません。最新の投稿を取得できるかは有効なログインセッションでの追加検証が必要です。

## API を呼ばずに確認

```sh
npm test
npm start -- analyze --input examples/synthetic-posts.json \
  --as-of 2026-10-18T06:00:00Z --dry-run
```

サンプルは架空アカウントの**合成データ**で、Tibo の実際の投稿ではありません。dry-run は OpenAI API を呼ばず、`data/decisions-request.json` を作ります。`run --dry-run` は X 取得を行うため、完全オフラインでの確認には上記 `analyze` を使います。

インポート JSON の最小形式:

```json
{
  "username": "thsottiaux",
  "source": "manual-import",
  "posts": [{
    "id": "1234567890123456789",
    "author": "thsottiaux",
    "createdAt": "2026-10-18T05:00:00Z",
    "text": "実際に取得した投稿本文"
  }]
}
```

`parent` と `quoted` には同じ形式の投稿を付けられます。URL は ID と author から再構成し、モデルが作ったURLは採用しません。

## 処理とスコアの意味

1. fa0311 氏の `twitter-openapi-typescript` で `UserTweetsAndReplies` をカーソル取得します。本人の投稿と返信を数え、広告・単純なリポスト・重複を除外します。古い固定投稿の影響を減らすため、指定件数を満たしたあと1ページ追加し、日時順で指定件数を選びます。X の表示制限などにより完全性は保証できません。
2. 長文投稿の本文と引用元の著者を保持します。返信先が手元にない場合は `TweetDetail` で補います。追加取得は既定20件（`--context-limit 0–100`）。不足・削除・取得失敗は記録します。画像内容・リンク先記事・会話全体は取得しません。
3. `POST https://api.openai.com/v1/decisions` に全投稿の文脈を渡します。現行資料に従いモデルは `gpt-6-luna`。未来のリセット確率と根拠の充足度を `predicate` で質問し、各投稿を `choice` で「未来の予告・実施済み・否定・間接的示唆・無関係」に分類します。100件なら1リクエスト・102問です。自由文の説明生成は行わず、投稿本文と分類を根拠候補として表示します。
4. 最新投稿が基準時刻より48時間以上古ければ、OpenAI API を呼ばず `stale_data` として予測を保留します。48時間は入力鮮度の暫定基準です。新しい入力では、予測値に100を掛けた値をスコアにします。根拠充足度が0.5未満、未来に関する根拠候補がない場合、主要質問が回答拒否の場合は表示を保留します。**0.5は暫定の表示基準で、統計的に検証した閾値ではありません。** 生のモデル値は `rawModelProbability`、投稿ごとの分類確信度は `evidence[].confidence` に残します。これらは別の指標です。

取得JSON・レポートに日時と取得元を残します。`--as-of` より後の投稿・返信先・引用は入力から除外します。ただし後日取得した過去投稿には編集・削除・選択の偏りがあり、これだけでバックテストはできません。予測精度を測るには、事前に保存したスナップショットと、実際の臨時リセットの正解ラベルを蓄積し、時系列で分離した評価と確率校正が必要です。

HTTPエラー・欠落したAPI回答・異常な確率は予測に変換せず終了します。429では取得を止め、自動再試行は行いません。取得間隔は1秒、タイムラインは最大20ページです。API への課金が発生するのは `analyze` / `run` の実解析時です。

## Sites の表示画面

ホスト先: https://tibo-reset-watch.soumame.chatgpt.site （本人のみ閲覧）

`site/` に、投稿本文・返信元・引用・投稿ごとの示唆確率・全体予測を確認する画面があります。[画面の更新・運用手順](site/README.md) を参照してください。

タイムラインの点を選ぶと、投稿本文と文脈を表示します。投稿側のv2スコアは「リセットの予告・実施報告・具体的示唆を含むか」で、過去の明確な発表も対象です。現在から24時間の発生予測は別の指標です。全体予測の履歴は実際に保存した解析結果だけを蓄積します。

```sh
# 投稿ごとの示唆確率も含めて解析（全体解析とは別の1リクエストを追加）
npm start -- analyze --input data/posts.json --signals --out data/report-with-signals.json
npm run site:export
npm run site:preview
```

全体予測・投稿の示唆確率・分類確信度を区別します。ブラウザーには API キーや X Cookie を送らず、保存済みの公開投稿と解析結果だけを表示します。クラウド更新用のサーバーとR2保存を実装しています。定期実行はSitesのクラウドタスクから行います。キー・Cookieの設定と初回成功を確認してから有効化します。

## 参照資料

- [ユーザー指定の TwitterInternalAPIDocument](https://github.com/fa0311/TwitterInternalAPIDocument) — README が、より正確な仕様として `twitter-openapi` を案内しています。
- [fa0311/twitter-openapi-typescript](https://github.com/fa0311/twitter-openapi-typescript) — 使用している取得ライブラリ。内部 API の変更により動かなくなる場合があります。依存元のデュアルライセンスは同リポジトリを参照してください。
- [OpenAI Decisions API guide](https://developers.openai.com/api/docs/guides/decisions)
- [OpenAI Decisions API reference](https://developers.openai.com/api/reference/resources/decisions/methods/create)
