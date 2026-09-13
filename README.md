# akashic-player-ban

ゲームの進行を妨害しているプレイヤーを、**コンテンツの進行上から確実に取り除く**ための [Akashic Engine](https://akashic-games.github.io/) 拡張ライブラリ。

実行基盤が妨害プレイヤーを強制切断したとしても、コンテンツ上には放置しているプレイヤーとして残り続ける。ターン制ゲームであれば毎ターン待たされる結果となるため、**コンテンツ自身がそのプレイヤーを進行から外せることが望ましい**。そのために「誰が追放されたか」という情報を全インスタンスが同じタイミングで受信できるようにする。

ただし、**コンテンツができるのは追放を要求するところまで。** 実施して確定させるのは実行基盤であり、確定した追放だけが全インスタンスへ同じタイミングで通知される。要求が必ず通るとはかぎらない。

そして、**確定した追放をコンテンツから解除することはできない。** 解除を要求する口はあえて設けていない（[理由](./packages/akashic-player-ban/README.md#なぜ解除の-api-が無いのか)）。解除するかどうかは実行基盤側で決まり、そこで確定した解除も追放と同じ経路でコンテンツへ通知される。

つまり、コンテンツから出ていくのは追放の要求だけで、入ってくるのは追放・解除の両方になる。

|      | 実施     | コンテンツからの要求       | 確定の通知         |
| ---- | -------- | -------------------------- | ------------------ |
| 追放 | 実行基盤 | `banPlayer()`              | `onPlayerBanned`   |
| 解除 | 実行基盤 | **無い**（あえて設けない） | `onPlayerUnbanned` |

`banPlayer()` はあくまで実行基盤の追放機能を呼ぶ入口である。どのプレイヤーからの要求を許可し、どのプレイヤーへの追放を許可するかといった権限判定は実行基盤の責務である。

対象は **Akashic Engine のマルチモード**（実行基盤が開始時に `start` の MessageEvent を送る仕様）で、`JoinEvent` には依存しない。そのため **ニコ生ゲームマルチプレイ仕様**（開始時に放送者の `JoinEvent`、続けて `start` の MessageEvent を送る仕様）でもそのまま動く。

## パッケージ

| パッケージ                                                                           | 使う人           | 内容                                             |
| ------------------------------------------------------------------------------------ | ---------------- | ------------------------------------------------ |
| [`@multi-indiegame/akashic-player-ban`](./packages/akashic-player-ban)               | ゲーム開発者     | コンテンツ向け拡張ライブラリ                     |
| [`@multi-indiegame/akashic-player-ban-coe`](./packages/akashic-player-ban-coe)       | ゲーム開発者     | coe コンテンツ向けアダプタ（本体と併用）         |
| [`@multi-indiegame/akashic-player-ban-plugin`](./packages/akashic-player-ban-plugin) | 実行基盤の開発者 | `g.game.external.playerBan` を生やすプラグイン   |
| [`@multi-indiegame/akashic-player-ban-serve`](./packages/akashic-player-ban-serve)   | ゲーム開発者     | `akashic serve` で動作確認するためのバックエンド |

4 つとも wire format を共有するので、**同じリポジトリで同時にリリースする**。プロトコル定数は `packages/akashic-player-ban/src/protocol.ts` にあり、`@multi-indiegame/akashic-player-ban/protocol` として各パッケージから参照する。

仕様は [akashic-external-protocol](https://github.com/multi-indiegame/akashic-external-protocol) の PROTOCOL.md にある。

## ドキュメント

- [`akashic serve` で動作確認する](./packages/akashic-player-ban-serve) — コンテンツを作っている人が `akashic serve` の上で追放を試すための手順（`akashic-player-ban-serve` の README）。

## 開発

```sh
npm install
npm run build     # 依存順にビルドする（akashic-player-ban-serve のバンドルもここ）
npm run format
```

## ライセンス

MIT
