---
"@multi-indiegame/akashic-player-ban": patch
"@multi-indiegame/akashic-player-ban-plugin": patch
"@multi-indiegame/akashic-player-ban-serve": patch
---

`NotificationEvent` の型を `@akashic/playlog` の `MessageEvent` にしました。`playlog.Event` を受け取る API（AMFlow の `sendEvent` など）へ型変換なしで渡せます。
