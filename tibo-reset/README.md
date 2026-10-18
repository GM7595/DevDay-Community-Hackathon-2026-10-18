# tibo-reset

X **公式API v2** から `@thsottiaux` の直近100件の公開投稿・返信を取得し、OpenAI Decisions APIでCodexの臨時使用枠リセットを予測します。通常の5時間・週次更新は対象外です。Cookie認証・ゲスト取得・非公式APIへのフォールバックはありません。

ホスト先: https://tibo-reset-watch.soumame.chatgpt.site （現在は本人のみ閲覧）

## 設定

Node.js 22以上。外部SDKなしで公式APIを呼び出します。

```sh
cd tibo-reset
npm ci
cp .env.example .env
```

`.env` または `.env.cloud` に以下を設定します。CLIは両方を読み、`.env.cloud` が優先されます。秘密値をチャットに貼る必要はありません。

- `X_BEARER_TOKEN`: X Developer Console → App → Keys and Tokens の **app-only Bearer Token**。API Key / API Key Secret / Cookieではありません。
- `OPENAI_API_KEY`: Decisions APIを呼び出すOpenAIキー。

Sitesのクラウド実行では、同名のシークレットをSites環境変数に設定してデプロイします。ローカルenvファイルはアップロードしません。旧 `X_AUTH_TOKEN` / `X_CT0` / `X_PLATFORM` は不要です。

APIの閲覧権限・利用枠・課金設定はX Developer Consoleで確認してください。トークンの失効時には再設定します。

## CLI

```sh
npm start -- collect --count 100 --out data/posts.json
npm start -- analyze --input data/posts.json --signals --out data/report-with-signals.json
npm start -- run --count 100 --hours 24 --signals

# APIを呼ばず、合成データでリクエストだけ作る
npm start -- analyze --input examples/synthetic-posts.json \
  --as-of 2026-10-18T06:00:00Z --dry-run
npm test
```

`--count` は1–190件、`--hours` は1–168時間。`--context-limit 0–100` は返信元・引用を追加取得する**投稿ID数**の上限（既定20）です。`--target api-credit` は金額としてのAPIクレジットを対象にする任意モードです。

## 公式APIの取得

- `GET /2/users/by/username/:username` でユーザーIDと公開設定を確認。
- `GET /2/users/:id/tweets` を `exclude=retweets` で取得。返信は除外しません。`pagination_token` でページを送り、重複・他人の投稿・リポストを除きます。
- `post.fields` と `expansions` で長文、投稿日時、著者、返信先・引用を取得。不足する文脈だけ `GET /2/tweets?ids=…` で一括補完します。
- 欠落・削除・非公開の投稿は補いません。著者や日時も推測せず、不足を記録します。添付画像は公式APIのmedia展開から取得し、Decisionsへ本文と一緒に渡します。リンク先記事・会話全体は取得しません。
- 401（認証）・403（アクセス権）・402（課金・クレジット）・429（レート制限）を区別し、自動再試行せず終了します。エラー応答の本文や認証ヘッダーは出力しません。

`source: "x-official-api"` を保存します。移行前の保存データを公式取得済みとして扱わず、ホスト画面は公式取得の成功後に新しい履歴を開始します。手動インポートは来歴未検証として扱います。

## スコア

**全体予測**は、解析時点から24時間以内にOpenAI全体の臨時Codexリセットが起きるかの推定です。過去の実施済みリセット、個人の通常更新、願望だけを未来の根拠にはしません。**投稿シグナル**は、その投稿に予告・実施報告・具体的示唆が含まれる確率で、過去の明確な発表も高くなります。全体予測は投稿スコアの平均ではありません。

Decisions APIの `gpt-6-luna` に全体予測・根拠の充足度をpredicate、各投稿の内容をchoiceで質問します。時刻の根拠と上限時間帯も質問し、100投稿の全体解析は104問。個別シグナルは100投稿ごとに別リクエスト（200問）です。変更のない公式取得投稿は内容スコアを再利用します。画像・返信元・引用・本人の接続された続報が変わった場合は再採点します。

数値は**未校正**で、実際の的中率は未検証です。根拠不足でもモデルの推測確率を表示し、その下に根拠の充足度を使った小さな信頼度を表示します。信頼度は的中率ではありません。画像が読めず信頼度を評価できない場合は —。回答拒否では数値を捏造しません。最新投稿が48時間以上古い場合はOpenAIを呼ばず予測を保留します。表示の0.5閾値や48時間の鮮度基準は暫定です。過去日時で後日取得した投稿を絞り込むだけでは有効なバックテストになりません。

## 画像と時刻

Xの `attachments.media_keys` / `media.fields` から写真・memeと動画/GIFの静止プレビューを取得します。本文・画像内の文字・返信/引用・本人の続報を一緒に判断し、meme形式だからといって機械的に低くしません。未取得画像は未解析であり0%ではありません。動画の全フレームは解析しません。

画像は公開X画像ホストのみ、認証なし・リダイレクトなしで取得し、inline base64でDecisionsに渡します。1画像2MB、1リクエスト96画像/12MBまで。画像バイナリはメモリー内だけで扱い、公開JSON・ソース・R2には保存しません。

`timing` は、未実施の予告/示唆に具体的な将来時刻の根拠があり、全体予測・時刻根拠・分類が表示条件を満たす場合だけ推定します。投稿時刻と元のタイムゾーンを基準に、2/6/12/24時間以内などの上限を選びます。過去の予告期限や実施済み報告は次回時刻に流用しません。表示はJSTで、根拠不足や期限経過時は「まだ読めない」。秒単位の到着時刻は捏造しません。

UIはETAを主役、発生確率を補助表示にし、投稿はシグナルに応じて色・発光・動きの強さを変えます。アニメーション停止とOSの動きの抑制設定に対応します。

## クラウド運用

Sitesのクラウドタスクが毎時0分（JST）に `POST /api/refresh` を呼び、公式取得→予測→R2保存を行います。同じ時刻の1時間枠での重複実行は `status: current` と保存結果を返し、有料APIを再実行しません。開いている画面は1分ごとに保存結果を読み込みます。Sitesのタスク上限により予測の間隔は1時間です。取得・解析失敗時は最後の正常な**公式APIデータ**を保持します。

[サーバーと画面の運用](site/README.md) / [定期タスクの更新手順](site/UPDATE.md)

```sh
npm run site:preview
# ローカルのフォールバック用seedを更新。クラウドのR2とは別です。
npm run site:export
```

公開範囲の変更はこの実装変更に含みません。

## 参照

- [X: ユーザーの投稿](https://docs.x.com/x-api/users/get-posts)
- [X: 投稿の一括取得](https://docs.x.com/x-api/posts/get-posts-by-ids)
- [X: Bearer Token](https://docs.x.com/fundamentals/authentication/oauth-2-0/bearer-tokens)
- [X: OpenAPI仕様](https://docs.x.com/openapi.json)
- [OpenAI Decisions API](https://developers.openai.com/api/docs/guides/decisions)
