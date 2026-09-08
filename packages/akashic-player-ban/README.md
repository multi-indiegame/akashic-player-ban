# @multi-indiegame/akashic-player-ban

ゲームの進行から妨害プレイヤーを取り除くための Akashic Engine 拡張ライブラリ（コンテンツ側）。

## 最初に読むこと

**`banPlayer()` の callback はローカル、`onPlayerBanned` は決定的。**

これが利用上いちばん重要な区別。

|                                       | 性質                                                       | 使ってよいこと                                     |
| ------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| `banPlayer()` の callback             | **ローカル**。呼んだインスタンスにしか返らない             | 押した人の画面のトーストを消す等のローカル UI だけ |
| `onPlayerBanned` / `onPlayerUnbanned` | **決定的**。全インスタンスが同一 tick で同一内容を受け取る | **ゲーム状態の変更はここだけ**                     |

callback の結果でゲーム状態を書き換えるとインスタンス間で state がずれる。

**ボタンを押した時点で退場させないこと。** 操作の成立と追放の成立は別で、押下時に進行から外すと、実行基盤に拒否された（権限が無い、上限に達した、確認ダイアログで拒否された等）ときにコンテンツだけが「いない」と思い込む。

## このライブラリがしないこと

- **解除の要求。** 追放を外すのは実行基盤の管理画面の仕事で、API を持たない（[なぜか](#なぜ解除の-api-が無いのか)）。ただし別経路で確定した解除の**通知は届く**ので、`onPlayerUnbanned` で追従できる
- **権限の判定。** 誰が追放を発行してよいかは実行基盤の決めごと。呼ばれたらそのまま要求を投げ、認められなければ `Unauthorized` が返る
- **部屋主（放送者）の識別。** これはコンテンツの責務。ニコ生ゲームと同じく `g.game.onJoin` を自分で見る（[下記](#部屋主の識別はコンテンツの責務)）

## インストール

```sh
akashic install @multi-indiegame/akashic-player-ban
```

`akashic-lib.json` で `environment.external.playerBan` を宣言しているので、`game.json` には自動で追記される。

## 動作確認

`akashic serve` は playerBan に対応していないので、そのままでは `banPlayer()` が `NotSupported` を返すだけで何も起きない。`sandbox.config.js` に数行足すと、追放の送信・受信・確認ダイアログまで serve の上で確かめられる。akashic-cli にパッチを当てる必要はない。

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

手順は [docs/akashic-cli-serve.md](../../docs/akashic-cli-serve.md) にある。

## 部屋主の識別はコンテンツの責務

追放ボタンを誰に見せるかを決めるには、部屋主（放送者）が誰かを知る必要がある。**これはコンテンツが `g.game.onJoin` を見て決める。** 実行基盤は部屋主の参加を `JoinEvent` として playlog に流すので、その playerId は全インスタンスに同じ値が決定的に配られる。

```ts
// 起動直後に登録する。pushScene より前に置くこと
let broadcasterId: string | null = null;
g.game.onJoin.add((ev) => {
  if (broadcasterId === null) {
    broadcasterId = ev.player.id;
  }
});
```

**なぜライブラリが代行しないのか。** 代行するとライブラリが `g.game.onJoin` を自前で購読することになり、コンテンツ側の登録との順序で取れたり取れなかったりする。しかも「発行してよいのは部屋主だけ」は実行基盤ごとに違う決めごとで、ライブラリが知っていてよい情報ではない。`JoinEvent` はコンテンツが直接見れば済むので、ここは丸ごとコンテンツに返している。

**判定結果はインスタンス固有。** `g.game.selfId === broadcasterId` の結果はインスタンスごとに違うので、それで出し分けるボタンは**ローカルエンティティ**に置くこと。`broadcasterId` 自体は全インスタンス共通なのでゲーム状態に使ってよい。

## 使い方 1 — 妨害プレイヤーを外す

```ts
import { banPlayer, onPlayerBanned } from "@multi-indiegame/akashic-player-ban";

let broadcasterId: string | null = null;
g.game.onJoin.add((ev) => {
  if (broadcasterId === null) {
    broadcasterId = ev.player.id;
  }
});

module.exports = () => {
  const scene = new g.Scene({ game: g.game });

  scene.onLoad.add(() => {
    // 部屋主だけに追放ボタンを見せる。ローカル情報に基づくのでローカルエンティティに置く
    if (g.game.selfId === broadcasterId) {
      const banButton = new g.FilledRect({ scene, local: true /* ... */ });
      banButton.onPointDown.add(() => {
        banPlayer(target.id);
      });
    }

    // 進行からの除去はここで行う。全インスタンスが同じ tick で通る
    onPlayerBanned.add(({ playerId }) => {
      players.remove(playerId); // ターン順から外す
      if (currentTurn === playerId) {
        advanceTurn(); // 手番中ならその場で次へ送る
      }
    });

    scene.onUpdate.add(() => {
      // 毎フレームの進行はここ
    });
  });

  g.game.pushScene(scene);
};
```

権限の無いインスタンスから `banPlayer()` を呼んでも実行基盤が `Unauthorized` で断るので、ボタンを非ローカルにして全員のインスタンスで同じコードを通しても壊れはしない。ただし無駄な要求が飛ぶので、出し分けはしておくのがよい。

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

### `banPlayer(playerId, callback?)`

追放を要求する。`callback` はローカル。`BanResult` の `reason` は次のいずれか。

| reason          | 意味                                                                        |
| --------------- | --------------------------------------------------------------------------- |
| `NotSupported`  | 拡張が無い環境（headless runner、素の akashic-cli-serve、非対応の実行基盤） |
| `Unauthorized`  | 実行基盤が発行を認めなかった。**権限が無い場合はこれ**                      |
| `NotInRoom`     | 対象がこのセッションの参加者ではない                                        |
| `SelfBan`       | 自分自身は追放できない                                                      |
| `LimitExceeded` | 件数上限・レート制限                                                        |
| `Rejected`      | 実行基盤の確認 UI で拒否された                                              |
| `InternalError` | —                                                                           |

実行基盤ごとの役割名（部屋主・放送者・モデレーター…）は理由コードに現れない。誰に許すかは実行基盤の決めごとなので、断られたことは `Unauthorized` ひとつで表す。

### `onPlayerBanned` / `onPlayerUnbanned: g.Trigger<{ playerId: string }>`

追放・解除の成立。全インスタンスが同一 tick で同一内容を受け取る。このセッションで発行された追放に限らず、**実行基盤の管理画面など別の経路で確定した追放・解除も届く**。

`playerId` は `ev.player.id` や `g.game.selfId` と同じ id 空間なので、そのまま突き合わせてよい。

コンテンツが知らない `playerId` も届きうる（ゲームに触れていない相手の追放）。知らない id は無視してよい。

同じ確定が再送されても、状態が実際に動いたときだけ発火する。

### `isBanned(playerId): boolean` / `bannedPlayerIds(): string[]`

通知を積み上げた決定的な状態。

## なぜ解除の API が無いのか

追放とその解除は対称ではない。

- **追放は保護をかける操作。** 誤っても実行基盤の管理画面から戻せる
- **解除は保護を外す操作。** 外された側が得をする

コンテンツに解除を渡すと、**追放された人が自作ゲームを公開し、権限を持つ人に遊ばせて自分の追放を外させる**、という筋が成立する。実行基盤が対象を引くにはその相手がそのセッションに居た証跡が要るが、証跡を広く残すほどこの筋が通りやすくなる。

解除は管理画面の仕事にするのが素直で、そのぶん `onPlayerUnbanned` は残してある。コンテンツは自分から解除を要求できないだけで、**解除されたことは知れる**。

## 制約

- **非対応環境では no-op に degrade する。** `g.game.external.playerBan` が無ければ `banPlayer()` は `NotSupported` を返すだけで、例外は出ない
- **スナップショット起動では内部状態が欠落する。** `bannedPlayerIds()` の内容はイベント再生では復元されるが、スナップショットには載らない。必要なら `bannedPlayerIds()` をコンテンツ側のスナップショットに含め、復帰時に自前で持ち直すこと
- **この拡張はセキュリティ境界ではない。** 権限判定・スコープ・上限は実行基盤のサーバー側にある

## ライセンス

MIT
