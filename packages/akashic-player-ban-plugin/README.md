# @multi-indiegame/akashic-player-ban-plugin

`@multi-indiegame/akashic-player-ban` を受け入れる**コンテンツ実行基盤**向けのプラグイン。`g.game.external.playerBan` を生やし、要求を `PlayerBanBackend` へ委譲する。

ゲーム開発者が使うのはこちらではなく [`@multi-indiegame/akashic-player-ban`](../akashic-player-ban) の方。ただし後述の `serve` サブパスだけは例外で、ゲーム開発者が動作確認に使う。

## 2 つのエントリポイント

| import                                             | 使う人           | 形                                                                    |
| -------------------------------------------------- | ---------------- | --------------------------------------------------------------------- |
| `@multi-indiegame/akashic-player-ban-plugin`       | 実行基盤の開発者 | `registerExternalPlugin()` に渡す `PlayerBanPlugin` クラス            |
| `@multi-indiegame/akashic-player-ban-plugin/serve` | ゲーム開発者     | akashic-cli-serve の `sandbox.config.js` から参照する単一 JS ファイル |

形が違うのは、akashic-cli-serve が「external オブジェクトを返す関数を `module.exports` に持つ単一ファイル」を要求し、評価スコープに `require()` が無いため。`serve/plugin.js` は依存を持たず、プロトコル定数を自前で持っている。**`src/protocol.ts` を変えたら `serve/plugin.js` も合わせること。**

## 使い方

```ts
import {
  PlayerBanPlugin,
  PlayerBanBackend,
  buildBanNotificationEvent,
} from "@multi-indiegame/akashic-player-ban-plugin";

const backend: PlayerBanBackend = {
  ban: (playerId) => banPlayerInGame(play.id, playerId),
};

view.registerExternalPlugin(new PlayerBanPlugin(backend));
```

生えるのは `ban` だけ。解除の口も、発行してよいかを問い合わせる口も持たない。

`registerExternalPlugin()` は duck typing なので、`@akashic/agvw` でも互換実装でも構造的に通る。プラグイン側は実行基盤の型に依存しない。

## akashic-cli-serve での動作確認

ゲーム開発者向け。`sandbox.config.js` の `client.external` から `serve` サブパスを参照すると、`akashic serve` の上で `g.game.external.playerBan` が生え、確認ダイアログ付きで追放を試せる。

```js
// sandbox.config.js
module.exports = {
  client: {
    external: {
      playerBan:
        require.resolve("@multi-indiegame/akashic-player-ban-plugin/serve"),
    },
  },
};
```

`require()` ではなく `require.resolve()`。serve に渡すのはパスであって値ではない。手順の全体は [docs/akashic-cli-serve.md](../../docs/akashic-cli-serve.md) にある。

## 実行基盤が満たすべき契約

仕様の全文は [akashic-external-protocol](https://github.com/multi-indiegame/akashic-external-protocol) の PROTOCOL.md にある。最低限これを満たすこと。

1. **通知の注入**
   BAN / 解除が確定したら `buildBanNotificationEvent(action, playerId)` で組み立てたイベントを playlog に注入し、active インスタンス経由で全インスタンスへ配る。**部屋主のブラウザに依存しない経路で配ること。** 他の部屋や設定画面で確定した BAN も届かないと、表示と実態がずれる。
   `playerId` は**コンテンツへ申告している in-game playerId**（コンテンツが `ev.player.id` で観測している値）であること。実行基盤の内部識別子を送るとコンテンツ側で誰にもマッチせず、追放が静かに効かなくなる（PROTOCOL.md 4.1）

2. **予約 playerId の拒否**
   クライアント由来のイベント送信のうち、`:` で始まる playerId を名乗るものを破棄する。ただし **tick 書き込み権限を持つ接続は除く**。Akashic Engine 自身が `:akashic` を送るため、無条件に弾くと起動しなくなる

3. **状態変化の実効化**
   対象を実際に切断し、再入室を拒否する

4. **特権プレイヤーの Join**
   部屋主・放送者にあたるプレイヤーがいるなら、その参加を `JoinEvent` として playlog に流す。**これを見るのはコンテンツ**で、追放ボタンの出し分けに使う。拡張ライブラリは見ない

2 と 3 を満たさない実行基盤でもコンテンツは動くが、追放が演出だけになる。4 を満たさないと、コンテンツは操作 UI の出し分けができない。

## 権限は実装側が決める

**誰が追放を発行してよいかはこのプラグインが決めることではない。** 部屋主だけに許す基盤も、モデレーター権限を配る基盤も、全員に許す基盤もありうる。プラグインは要求をそのまま `PlayerBanBackend` へ渡すだけで、判定はしない。認めない要求には `reason: "Unauthorized"` を返すこと。

**判定は必ずサーバー側で行う。** コンテンツが実行基盤と同一オリジンで動く構成では、このプラグインを経由せずに API を直接叩ける。クライアント側で先に握り潰す実装を足しても構わないが、それは通信を減らすための最適化であって防御ではない。

`PlayerBanBackend` の実装側で、必ず次を独立に行うこと。

- 発行元の再判定（cookie / 認証情報から決め、クライアントから受け取らない）
- 対象が実際にそのセッションの参加者かの確認
- 件数上限とレート制限
- 表示名を組むならサーバー側で組む（コンテンツから渡された表示名を使わない）

## 解除の口は無い

追放は保護をかける操作で誤っても管理画面から戻せるが、解除は保護を外す操作で、外された側が得をする。コンテンツに渡すと「追放された人が自作ゲームを公開し、権限を持つ人に遊ばせて自分の追放を外させる」が成立しうるため、`external` に解除は生やしていない。

**解除の通知は流すこと。** 管理画面などで解除が確定したら `buildBanNotificationEvent("unbanned", playerId)` を注入する。コンテンツ側の `onPlayerUnbanned` は残っており、これが届かないと「解除したのにコンテンツは追放したままの扱い」になる。

## 通知イベントの組み立て

```ts
import { buildBanNotificationEvent } from "@multi-indiegame/akashic-player-ban-plugin";

const event = buildBanNotificationEvent("banned", targetPlayerId);
// => [32, 0, ":multi-indiegame", { action, playerId, type, version }]
```

`:multi-indiegame` は名前空間であり、**実行基盤の運営者が自分の org 名に置き換えてはならない**。置き換えるとその基盤の上でコンテンツが通知を受け取れなくなる。

## ライセンス

MIT
