---
"@multi-indiegame/akashic-player-ban": minor
"@multi-indiegame/akashic-player-ban-plugin": minor
"@multi-indiegame/akashic-player-ban-serve": minor
---

`banPlayer()` に `{ playerId, name }` を渡して、対象の表示名を申告できるようにしました。名前は任意で、実行基盤の確認 UI で相手を見分ける補助にだけ使われます。実行基盤は名前を検証せず、通知にも載りません。

- `@multi-indiegame/akashic-player-ban`: `banPlayer()` が playerId の文字列に加えて `BanTarget`（`{ playerId, name? }`）を受け取ります。名前に対応していない実行基盤では、名前が無視されるだけで追放はそのまま行われます。
- `@multi-indiegame/akashic-player-ban-plugin`: `PlayerBanBackend.ban()` の第 2 引数 `detail.name` に申告名が渡されます。既存の `ban(playerId)` 実装はそのまま動きます。表示するときの決まり（申告が無いときにアカウント名で補わない、など）は README を参照してください。
- `@multi-indiegame/akashic-player-ban-serve`: 確認ダイアログに申告名を出します。`window.playerBanServe.confirm` の引数に `name` が加わりました。
