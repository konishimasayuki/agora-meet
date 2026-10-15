# Agora

話した言葉が相手の言語で字幕になるビデオ会議(日本語 / Türkçe / English)。

- 入室: `https://<ドメイン>/room/<ルーム名>` を開き、名前と話す言語を選ぶ
- 映像・音声・画面共有: Agora Web SDK
- 音声認識: ブラウザの音声認識(PCのGoogle Chrome推奨)
- 翻訳: Claude API(`/api/translate`)
- 字幕の受け渡し: Agoraのデータストリーム(サーバー保存なし)。ログは右側に表示、「ログを保存」でテキスト保存
- チャット・添付ファイル: チャットは自動翻訳してログに表示。ファイルはVercel Blobに保存してリンクを共有(100MBまで、画像はプレビュー表示)

## Vercelの環境変数
- `NEXT_PUBLIC_AGORA_APP_ID`
- `AGORA_APP_CERTIFICATE`
- `ANTHROPIC_API_KEY`
- `BLOB_READ_WRITE_TOKEN`(VercelのStorageでBlobを接続すると自動で入る)
