# @multi-indiegame/akashic-player-ban

ゲームの進行から妨害プレイヤーを取り除くための Akashic Engine 拡張ライブラリ。

**Akashic Engine のマルチモード**（実行基盤が開始時に `start` の MessageEvent を送る仕様）で動くコンテンツを作っている方向けの説明です。ライブラリは `JoinEvent` に依存しないので、**ニコ生ゲームマルチプレイ仕様**（開始時に放送者の `JoinEvent`、続けて `start` の MessageEvent を送る仕様）のコンテンツでもそのまま使えます。

断りの無い記述は Akashic Engine のマルチモード全般に当てはまります。ニコ生ゲームマルチプレイ仕様に限る話には「ニコ生ゲームマルチプレイ仕様向け」と書き添えます。

## 最初に読むこと

**`banPlayer()` の callback はローカル、`onPlayerBanned` は決定的(グローバル)です。**

これが利用上いちばん重要な区別です。

|                                       | 性質                                                       | 使ってよいこと                                     |
| ------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| `banPlayer()` の callback             | **ローカル**。呼んだインスタンスにしか返らない             | 押した人の画面のトーストを消す等のローカル UI だけ |
| `isSupported()`                       | **ローカル**。インスタンスによって結果が違うことがある     | 追放ボタンを出すかどうか等のローカル UI だけ       |
| `onPlayerBanned` / `onPlayerUnbanned` | **決定的**。全インスタンスが同一 tick で同一内容を受け取る | **グローバルなゲーム状態の変更はここだけ**         |

callback の結果でグローバルなゲーム状態を書き換えると、インスタンス間で状態がずれます。つまり、callback 処理はローカルな処理に留めてください。

**ボタンを押した時点(`banPlayer()`呼び出し後)で退場させないでください。** 操作の成立と追放の成立は別です。権限が無い、上限に達した、確認ダイアログで取りやめた等の理由で要求が通らない可能性があるからです。実際の退場処理は`onPlayerBanned`で行ってください。

## このライブラリがしないこと

- **BAN解除の要求。** 追放を外すのは実行基盤の管理画面の仕事なので、API を持ちません（[理由](#なぜ解除の-api-が無いのか)）。ただし別経路で確定した解除の**通知は届く**ので、`onPlayerUnbanned` で解除時のふるまいを定義する必要があります。
- **権限の判定。** 誰が追放を発行してよいかは実行基盤の決めごとです。ライブラリはそのまま実行基盤に要求を投げるだけです。実行基盤が拒否すれば `Unauthorized` が返ります。
- **（ニコ生ゲームマルチプレイ仕様）放送者の役割を持つプレイヤーの識別。** 誰に追放ボタンを見せるかを決めるのはコンテンツの責務です。ライブラリはそこに関与しません（[詳細](#部屋主の識別には関与しません)）

## インストール

```sh
akashic install @multi-indiegame/akashic-player-ban
```

インストール後、`game.json` に以下が追加されたことを確認してください。

```jsonc
"environment": {
  "external": {
    "playerBan": "0"
  }
}
```

## 動作確認

`akashic serve` で追放の送信・受信・確認ダイアログの挙動を確認するには `sandbox.config.js` に下記の追加設定が必要です。設定しない場合、 `banPlayer()` がつねに `NotSupported` を返します。

```js
// sandbox.config.js
module.exports = {
  client: {
    external: {
      playerBan: require.resolve("@multi-indiegame/akashic-player-ban-serve"),
    },
  },
};
```

具体的な手順は [`@multi-indiegame/akashic-player-ban-serve`](../akashic-player-ban-serve) を参照してください。

## （ニコ生ゲームマルチプレイ仕様）放送者の識別に関与しない

どのプレイヤーからの `banPlayer()` を許可するのか、ライブラリは制御しません。

たとえば、ニコ生ゲームマルチプレイ仕様における「放送者」の役割を持ったプレイヤーにのみ追放ボタンを見せたい場合、コンテンツ側で放送者の画面だけに追放ボタンを表示するよう制御してください。

## 使い方 1 — 妨害プレイヤーを外す

```ts
import { banPlayer, onPlayerBanned } from "@multi-indiegame/akashic-player-ban";

module.exports = () => {
  const scene = new g.Scene({ game: g.game });

  scene.onLoad.add(() => {
    // ownerId はコンテンツ側で決める
    if (g.game.selfId === ownerId) {
      // owner だけに追放ボタンを見せる。グローバルイベントを起こさないよう、ローカルエンティティ
      const banButton = new g.FilledRect({
        scene,
        local: true,
        touchable: true,
        tag: "<対象プレイヤーのid>",
        /* ... */,
      });
      banButton.onPointDown.add((ev) => {
        banPlayer(ev.target.tag, (result) => {
          /*
            // 成功時の例
            { ok: true, playerId: "<対象プレイヤーのid>" }
            // 失敗時の例
            { ok: false, playerId: "<対象プレイヤーのid>", reason: "Unauthorized" }
          */
          console.log("callback result", result);
        });
      });
    }

    // 進行からの除去はここで行う。全インスタンス同じタイミングで発火する
    onPlayerBanned.add((ev) => {
      players.remove(ev.playerId); // ターン順から外す
    });
  });

  g.game.pushScene(scene);
};
```

## 使い方 2 — 追放済みの相手を受け付けない

```ts
import { isBanned } from "@multi-indiegame/akashic-player-ban";

scene.onMessage.add((ev) => {
  if (isBanned(ev.player.id)) {
    return; // 通信ラグのためにBAN確定前に送信されたメッセージが届きうる。確実に操作を無視
  }
  handleAction(ev);
});
```

## 使い方 3 — 非対応の実行基盤にも投稿する

このライブラリは非対応の実行基盤でも例外やエラーを起こしません。`banPlayer()` は `NotSupported` を返し、`onPlayerBanned` / `onPlayerUnbanned` は呼ばれないだけです。そのため、**対応している実行基盤にもしていない実行基盤にも、同じコンテンツをそのまま投稿できます。**

非対応の実行基盤で起動された際は追放ボタンを隠す場合、`isSupported()` で出し分けることができます。

```ts
import {
  banPlayer,
  isSupported,
  onPlayerBanned,
} from "@multi-indiegame/akashic-player-ban";

// 追放ボタンはローカルエンティティにする。isSupported() の結果はインスタンスごとに違いうるため
if (isSupported()) {
  const banButton = new g.FilledRect({ scene, local: true /* ... */ });
  banButton.onPointDown.add(() => {
    banPlayer(targetId);
  });
}

// 通知のハンドラは isSupported() に関わらず登録してよい。非対応の実行基盤では呼ばれないだけ
onPlayerBanned.add(({ playerId }) => {
  players.remove(playerId);
});
```

**`isSupported()` の結果でゲーム状態を分岐させないでください。** 同じ実行基盤上でも、プレイヤーの画面では `true`、サーバ側で動くインスタンスでは `false` ということがあります。この戻り値の値でゲーム共通のルールやターン順を変えてしまうと、インスタンス間で状態がずれる可能性があります。

## API

### `isSupported(): boolean`

このインスタンスで追放を要求できるか（`g.game.external.playerBan` があるか）。結果はローカル。

### `banPlayer(playerId, callback?)`

追放を要求する。`callback` はローカルな処理のみ記述する。`BanResult` の `reason` （拒否理由）は次のいずれかです。

| reason           | 意味                                                                        |
| ---------------- | --------------------------------------------------------------------------- |
| `NotSupported`   | 拡張が無い環境（素の `akashic serve`、headless runner、非対応の実行基盤）。 |
| `Unauthorized`   | 実行基盤が発行を認めなかった                                                |
| `PlayerNotFound` | 対象がこのセッションの参加者として見つからない                              |
| `SelfBan`        | 対象が要求した本人だった                                                    |
| `LimitExceeded`  | 実行基盤が設けている件数上限・レート制限に達した                            |
| `UserCancel`     | 実行基盤の確認 UI で、操作者が取りやめた                                    |
| `Unknown`        | 上のいずれにも当てはまらない、または理由が分からない                        |

上記理由は実行基盤が返しうる候補です。実行基盤によっては許可される場合もあります。

### `onPlayerBanned` / `onPlayerUnbanned: g.Trigger<{ playerId: string }>`

追放・解除の成立。全インスタンスが同じタイミングで同じ内容を受け取る。

**自分が要求していない追放・解除も届くことがあります。** 実行基盤が追放機能の管理画面を持っている場合、そこで確定した情報も通知されます。`banPlayer()` を呼んだかどうかに関わらず通知が届きうるので、**常に両方のハンドラを用意してください**。

実行基盤側の通知とコンテンツが連動しないと、たとえば「ゲーム外チャットで荒らした人を追い出したのに、ゲーム内には残り続けてしまう」という不自然な挙動になってしまいます。

`playerId` は `ev.player.id` や `g.game.selfId` に設定されるような値が格納されています。

コンテンツが知らない `playerId` も届きうる（ゲームに触れていない相手の追放）ので、知らない id は無視するようにしてください。

### `isBanned(playerId): boolean`

特定のプレイヤーがBAN状態にあるか判定します。

### `bannedPlayerIds(): string[]`

BAN状態にあるプレイヤー一覧を返します。

## なぜ解除の API が無いのか

追放とその解除は対称ではありません。

- **追放は保護をかける操作です。** 誤っても実行基盤の管理画面から戻せます
- **解除は保護を外す操作です。** 外された側が得をします

コンテンツに解除要求権を許してしまうと、意図的に追放を解除させるような悪意あるゲームが投稿できてしまいます。そのため、安全なプレイ環境を維持できるよう、解除機能は実行基盤の専権事項としています。追放解除をコンテンツ側と連動できるよう `onPlayerUnbanned` は提供しています。

## 制約

- **非対応環境では no-op に degrade します。** `g.game.external.playerBan` が無ければ `banPlayer()` は `NotSupported` を返すだけで、例外は出ません。事前に判定したいときは `isSupported()` を使えます（[使い方 3](#使い方-3--非対応の実行基盤にも投稿する)）
- **Scene を自由に切り替えて構いません。** 通知の受信は Scene 遷移に追従して担保しています。
- **スナップショット起動では内部状態が欠落します。** `bannedPlayerIds()` の内容は受信したイベント情報から復元されますが、スナップショットポイント以前のイベント情報は欠落します。スナップショット機能を利用する場合、 `bannedPlayerIds()` を含め、自前で復元できるようにしてください。
- ニコ生ゲームマルチプレイ仕様向け: **追放は放送者に限らず誰にでも起こりえます。**。特定の役割の存在を前提にするコンテンツは、その人が居なくなった場合の振る舞いを決めておいてください
- **この拡張はセキュリティ境界ではありません。** 権限判定・スコープ・上限は実行基盤のサーバー側にあります

## ライセンス

MIT
