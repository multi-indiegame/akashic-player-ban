# @multi-indiegame/akashic-player-ban-plugin

`@multi-indiegame/akashic-player-ban` を受け入れる**コンテンツ実行基盤**向けのプラグイン。`g.game.external.playerBan` を生やし、要求を `PlayerBanBackend` へ委譲する。

ゲーム開発者が使うのはこちらではなく [`@multi-indiegame/akashic-player-ban`](../akashic-player-ban) の方。

## 使い方

```ts
import {
  PlayerBanPlugin,
  PlayerBanBackend,
  buildBanNotificationEvent,
} from "@multi-indiegame/akashic-player-ban-plugin";

const backend: PlayerBanBackend = {
  isGameMaster: () => viewerId === play.gameMasterId,
  ban: (playerId) => banPlayerInGame(play.id, playerId),
  unban: (playerId) => unbanPlayerInGame(play.id, playerId),
};

view.registerExternalPlugin(new PlayerBanPlugin(backend));
```

`registerExternalPlugin()` は duck typing なので、`@akashic/agvw` でも互換実装でも構造的に通る。プラグイン側は実行基盤の型に依存しない。

## 実行基盤が満たすべき契約

仕様の全文は [akashic-external-protocol](https://github.com/multi-indiegame/akashic-external-protocol) の PROTOCOL.md にある。最低限これを満たすこと。

1. **通知の注入**
   BAN / 解除が確定したら `buildBanNotificationEvent(action, playerId)` で組み立てたイベントを playlog に注入し、active インスタンス経由で全インスタンスへ配る。**部屋主のブラウザに依存しない経路で配ること。** 他の部屋や設定画面で確定した BAN も届かないと、表示と実態がずれる。
   `playerId` は**コンテンツへ申告している in-game playerId**（コンテンツが `ev.player.id` で観測している値）であること。実行基盤の内部識別子を送るとコンテンツ側で誰にもマッチせず、追放が静かに効かなくなる（PROTOCOL.md 4.1）

2. **予約 playerId の拒否**
   クライアント由来のイベント送信のうち、`:` で始まる playerId を名乗るものを破棄する。ただし **tick 書き込み権限を持つ接続は除く**。Akashic Engine 自身が `:akashic` を送るため、無条件に弾くと起動しなくなる

3. **状態変化の実効化**
   対象を実際に切断し、再入室を拒否する

4. **部屋主の Join**
   部屋主の参加を `JoinEvent` として playlog に流す。ライブラリはこれで部屋主の playerId を決定的に得る

2 と 3 を満たさない実行基盤でもコンテンツは動くが、追放が演出だけになる。

## 権限判定はここではない

プラグインは部屋主でないインスタンスからの要求を握り潰すが、**これはセキュリティ境界ではない**。コンテンツが実行基盤と同一オリジンで動く構成では、このプラグインを経由せずに実行基盤の API を直接叩ける。

`PlayerBanBackend` の実装側で、必ず次を独立に行うこと。

- 発行元の再判定（cookie / 認証情報から決め、クライアントから受け取らない）
- 対象が実際にその部屋の視聴者かの確認
- 件数上限とレート制限
- 表示名を組むならサーバー側で組む（コンテンツから渡された表示名を使わない）

## 通知イベントの組み立て

```ts
import { buildBanNotificationEvent } from "@multi-indiegame/akashic-player-ban-plugin";

const event = buildBanNotificationEvent("banned", targetPlayerId);
// => [32, 0, ":multi-indiegame", { action, playerId, type, version }]
```

`:multi-indiegame` は名前空間であり、**実行基盤の運営者が自分の org 名に置き換えてはならない**。置き換えるとその基盤の上でコンテンツが通知を受け取れなくなる。

## ライセンス

MIT
