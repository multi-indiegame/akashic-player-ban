# akashic-player-ban

ゲームの進行を妨害しているプレイヤーを、**コンテンツの進行上から確実に取り除く**ための [Akashic Engine](https://akashic-games.github.io/) 拡張。

強制切断だけでは足りない。ターン制ゲームなら、切断された相手はコンテンツ上「放置しているプレイヤー」として残り続け、毎ターン待たされる。プレイ感を戻すには**コンテンツ自身がそのプレイヤーを進行から外す**必要があり、そのためには「誰が追放されたか」が全インスタンスに同じタイミング・同じ内容で届かなければならない。

この拡張の主役は `onPlayerBanned` の方で、`banPlayer()` は実行基盤の追放機能を呼ぶ入口にすぎない。

## パッケージ

| パッケージ                                                                           | 使う人           | 内容                                           |
| ------------------------------------------------------------------------------------ | ---------------- | ---------------------------------------------- |
| [`@multi-indiegame/akashic-player-ban`](./packages/akashic-player-ban)               | ゲーム開発者     | コンテンツにバンドルする拡張ライブラリ         |
| [`@multi-indiegame/akashic-player-ban-plugin`](./packages/akashic-player-ban-plugin) | 実行基盤の開発者 | `g.game.external.playerBan` を生やすプラグイン |

2 つは wire format を共有するので、**同じリポジトリで同時にリリースする**。プロトコル定数は `packages/akashic-player-ban/src/protocol.ts` にあり、`@multi-indiegame/akashic-player-ban/protocol` として双方から参照する。

仕様は [akashic-external-protocol](https://github.com/multi-indiegame/akashic-external-protocol) の PROTOCOL.md にある。

## 開発

```sh
npm install
npm run build     # 依存順に 2 パッケージをビルドする
npm run format
```

## ライセンス

MIT
