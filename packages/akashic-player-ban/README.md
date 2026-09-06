# @multi-indiegame/akashic-player-ban

ゲームの進行から妨害プレイヤーを取り除くための Akashic Engine 拡張ライブラリ（コンテンツ側）。

## 最初に読むこと

**`banPlayer()` の callback はローカル、`onPlayerBanned` は決定的。**

これが利用上いちばん重要な区別。

|                                             | 性質                                                       | 使ってよいこと                                   |
| ------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| `banPlayer()` / `unbanPlayer()` の callback | **ローカル**。呼んだインスタンスにしか返らない             | 部屋主の画面のトーストを消す等のローカル UI だけ |
| `onPlayerBanned` / `onPlayerUnbanned`       | **決定的**。全インスタンスが同一 tick で同一内容を受け取る | **ゲーム状態の変更はここだけ**                   |

callback の結果でゲーム状態を書き換えるとインスタンス間で state がずれる。

**ボタンを押した時点で退場させないこと。** 操作の成立と追放の成立は別で、押下時に進行から外すと、実行基盤に拒否された（上限に達した、部屋主が確認ダイアログで拒否した等）ときにコンテンツだけが「いない」と思い込む。

## インストール

```sh
akashic install @multi-indiegame/akashic-player-ban
```

`akashic-lib.json` で `environment.external.playerBan` を宣言しているので、`game.json` には自動で追記される。

## 使い方 1 — 部屋主が妨害プレイヤーを外す

```ts
import {
  prepare,
  gameMasterId,
  banPlayer,
  onPlayerBanned,
} from "@multi-indiegame/akashic-player-ban";

prepare(() => {
  // 部屋主（放送者）だけに追放ボタンを見せる。
  // 表示はローカル情報に基づくので、ボタンはローカルエンティティに置く。
  if (g.game.selfId !== gameMasterId()) {
    return;
  }
  const banButton = new g.FilledRect({ scene, local: true /* ... */ });
  banButton.onPointDown.add(() => {
    banPlayer(target.id);
  });
});

// 進行からの除去はここで行う。全インスタンスが同じ tick で通る
onPlayerBanned.add(({ playerId }) => {
  players.remove(playerId); // ターン順から外す
  if (currentTurn === playerId) {
    advanceTurn(); // 手番中ならその場で次へ送る
  }
});
```

`banPlayer()` は部屋主のインスタンス以外では何もしない（`reason: "NotGameMaster"` で即返る）ので、ボタンを非ローカルにして全員のインスタンスで同じコードを通しても壊れない。

## 使い方 2 — 追放済みの相手を受け付けない

```ts
import { isBanned } from "@multi-indiegame/akashic-player-ban";

scene.onMessage.add((ev) => {
  if (isBanned(ev.player.id)) {
    return; // 切断と再入室拒否の間に届いた操作を無視する
  }
  handleAction(ev);
});
```

## API

### `prepare(callback: (info: BanContext) => void): void`

起動時（モジュール読み込み直後）に一度だけ呼ぶ。**`JoinEvent` を取り逃さないよう、シーン生成より前に呼ぶこと。**

`BanContext` は `{ gameMasterId: string | null; canBan: boolean }`。

### `gameMasterId(): string | null`

部屋主の `player.id`。`JoinEvent` 由来で全インスタンスに同じ値が決定的に配られるので、**ゲーム状態に使ってよい**。

### `canBan(): boolean`

自分が追放を発行できる立場か。**インスタンス固有**なので表示の出し分け専用。

### `banPlayer(playerId, callback?)` / `unbanPlayer(playerId, callback?)`

追放と解除を要求する。`callback` はローカル。`BanResult` の `reason` は次のいずれか。

| reason                           | 意味                                                                   |
| -------------------------------- | ---------------------------------------------------------------------- |
| `NotSupported`                   | 拡張が無い環境（headless runner、akashic-cli-serve、非対応の実行基盤） |
| `NotGameMaster`                  | 部屋主ではないインスタンス                                             |
| `NotInRoom`                      | 対象がこの部屋の視聴者ではない                                         |
| `SelfBan`                        | 自分自身は追放できない                                                 |
| `LimitExceeded`                  | 件数上限・レート制限                                                   |
| `Rejected`                       | 部屋主が確認ダイアログで拒否した                                       |
| `Unauthorized` / `InternalError` | —                                                                      |

解除のスコープは実行基盤の仕様に従う。

### `onPlayerBanned` / `onPlayerUnbanned: g.Trigger<{ playerId: string }>`

追放・解除の成立。全インスタンスが同一 tick で同一内容を受け取る。この部屋で発行された追放に限らず、**部屋主の他の部屋や実行基盤の設定画面で確定した追放も届く**。

コンテンツが知らない `playerId` も届きうる（ゲームに触れていない相手の追放）。知らない id は無視してよい。

同じ確定が再送されても、状態が実際に動いたときだけ発火する。

### `isBanned(playerId): boolean` / `bannedPlayerIds(): string[]`

通知を積み上げた決定的な状態。

## 制約

- **非対応環境では no-op に degrade する。** `g.game.external.playerBan` が無ければ `banPlayer()` は `NotSupported` を返すだけで、例外は出ない
- **スナップショット起動では内部状態が欠落する。** `bannedPlayerIds()` の内容はイベント再生では復元されるが、スナップショットには載らない。必要なら `bannedPlayerIds()` をコンテンツ側のスナップショットに含め、復帰時に自前で持ち直すこと
- **この拡張はセキュリティ境界ではない。** 権限判定・スコープ・上限は実行基盤のサーバー側にある

## ライセンス

MIT
