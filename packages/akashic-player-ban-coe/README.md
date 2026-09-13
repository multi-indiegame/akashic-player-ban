# @multi-indiegame/akashic-player-ban-coe

[`@akashic-extension/coe`](https://github.com/akashic-games/coe) を使ったコンテンツで [`@multi-indiegame/akashic-player-ban`](../akashic-player-ban) の通知を受け取るためのアダプタ。

**Akashic Engine のマルチモード**で動くコンテンツを coe で作っている方向けの説明です（ニコ生ゲームマルチプレイ仕様のコンテンツも含みます）。

## なぜ要るのか

**coe は届いた `g.MessageEvent` をすべて握りつぶします。** coe の `Scene` の JSDoc にも以下のように書かれています。

> 本シーンを利用した場合、すべての g.MessageEvent がフレームワーク側で握りつぶされる点に注意。

拡張ライブラリは MessageEvent で追放されたことを全インスタンスに共有するため、そのままでは `banPlayer()` が `ok: true` を返しながら、 **`onPlayerBanned` が永久に発火しない**という致命的な問題が発生してします。

そこで本アダプタは Controller の `broadcast()` に通知を載せ替えることで、 coe コンテンツでも本拡張ライブラリが動作するようにします。

|                                | 担当                                                            |
| ------------------------------ | --------------------------------------------------------------- |
| 送信（アクティブインスタンス） | アクションとして届いた通知を検証し、そのまま `broadcast()` する |
| 受信（全インスタンス）         | コマンドとして届いた通知を拡張ライブラリの状態へ取り込む        |

この取り込みにより、 **`onPlayerBanned` / `onPlayerUnbanned` / `isBanned()` / `bannedPlayerIds()` はすべて通常どおり動きます。**

## インストール

**拡張ライブラリ本体とアダプタを、両方とも `akashic install` してください。**

```sh
akashic install @multi-indiegame/akashic-player-ban @multi-indiegame/akashic-player-ban-coe
```

## 使い方

`attachCoeController` に自身の Controller をセットして呼び出してください。

```ts
import * as coe from "@akashic-extension/coe";
import { attachCoeController } from "@multi-indiegame/akashic-player-ban-coe";
import { onPlayerBanned } from "@multi-indiegame/akashic-player-ban";

const controller = new MyController();

// Scene を作る前に一度だけ
attachCoeController(controller);

const scene = new coe.Scene({ game: g.game, controller, assetPaths });

// 進行からの除去はここで行います。全インスタンス同じタイミングで呼ばれます
onPlayerBanned.add(({ playerId }) => {
  players.remove(playerId);
});

g.game.pushScene(scene);
```

### コマンド dispatch への流入を防ぐには

通知はコンテンツの `onCommandReceive` にも流れます。 `isBanCommand` を用いることで、拡張ライブラリ由来のコマンドを除外できます。

```ts
import { isBanCommand } from "@multi-indiegame/akashic-player-ban-coe";

scene.onCommandReceive.add((command) => {
  if (isBanCommand(command)) return; // アダプタが処理済み
  dispatch(command);
});
```

本アダプタは別途コマンドを受け取っているので、ここで除外しても通知は失われません。

## 設計

**coe には依存しない。** 使うのは `Trigger` と `broadcast()` という形だけなので、型ではなく構造で受ける。利用側と coe の版を揃える必要がない。

**Controller を継承させない。** `coe.Scene` に渡せる Controller は 1 つだけなので、継承を要求すると同じことをする他の拡張と衝突する。`onActionReceive` は Trigger なので、インスタンスに足すだけなら複数の拡張が共存できる。

**Scene の `_controller` は掘らない。** `protected` かつ「ゲーム開発者は参照してはならない」と明記されているため、Controller だけはコンテンツから渡してもらう。

## 信頼モデルが変わる点

`broadcast()` は playerId を落とすので、**偽装の検証はアクティブインスタンスの Controller 1 箇所だけ**になる。MessageEvent 経路（全インスタンスが各自で予約 playerId を確認する）とは性質が違う。

`broadcast()` を呼べるのは Controller だけなので、コンテンツ外から偽の通知を注入する経路にはならない。ただし**コンテンツ自身が誤って通知形のデータを broadcast すると、それは通知として扱われる**。

## ライセンス

MIT
