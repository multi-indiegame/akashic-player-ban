# akashic-cli-serve で動作確認する

`akashic serve` は実行基盤だが playerBan には対応していないので、そのままでは `banPlayer()` が `reason: "NotSupported"` を返すだけで何も起きない。`sandbox.config.js` に数行足すと、**追放の送信・受信・確認ダイアログまで serve の上で確かめられる**。

akashic-cli にパッチを当てる必要はない。使うのは `sandbox.config.js` の `client.external` という akashic-cli-serve の標準機能だけ。

## セットアップ

### 1. game.json に `environment.external` があることを確認する

```sh
akashic install @multi-indiegame/akashic-player-ban
```

`akashic-lib.json` から `game.json` に次が追記される。

```jsonc
"environment": {
    "sandbox-runtime": "3",
    "external": { "playerBan": "0" }
}
```

**この宣言が無いと external は生えない。** `sandbox.config.js` を正しく書いても無反応、という一番分かりにくい形で失敗する。

### 2. serve 用のバックエンドを入れる

```sh
npm install -D @multi-indiegame/akashic-player-ban-plugin
```

動作確認にしか使わないので devDependency でよい。コンテンツにはバンドルされない。

### 3. sandbox.config.js を置く

`game.json` と同じディレクトリに置く。

```js
module.exports = {
  client: {
    external: {
      // require() ではなく require.resolve()。渡すのはパスであって値ではない
      playerBan:
        require.resolve("@multi-indiegame/akashic-player-ban-plugin/serve"),
    },
  },
};
```

### 3.5 放送者を出したいなら nicolive モードで起動する

追放ボタンの出し分けなど、**コンテンツが放送者を識別する**なら `--target-service nicolive` を使う。

```sh
akashic serve --target-service nicolive
```

このモードは起動直後に放送者の `JoinEvent` を playlog へ流す。素の `akashic serve` は流さないので、コンテンツは放送者を決められない。

**放送者の id は自分のウィンドウの id とは別になる。** 実測では放送者に `pid1` が使われ、ウィンドウ側には `pid2`（以降リロードのたびに `pid3`, `pid4`…）が割り当たった。自分の id はツールバーの `selfId` 表示か `window.akashicServe.store.player.id` で確認できる。

つまり **`g.game.selfId === broadcasterId` で出し分けているボタンは、そのままでは自分のウィンドウに出ない。** 自分を放送者にして試したいなら、nicolive モードではなく `sandbox.config.js` で Join を自作する。

```js
module.exports = {
  // 自分のウィンドウの id を放送者として Join させる
  autoSendEventName: "broadcasterJoin",
  events: {
    broadcasterJoin: [[0, 3, "pid1", "broadcaster"]],
  },
  client: {/* ... 上記のとおり ... */},
};
```

`[0, 3, ...]` は `playlog.EventCode.Join` と eventFlags。第 3 要素が放送者の playerId なので、**ツールバーに出ている自分の id に合わせる**こと。ツールバーの「Join Me」を押しても Join は流れる。

**この拡張自体は `JoinEvent` を使わない。** 誰が追放を発行してよいかは実行基盤の決めごとで、ライブラリは関与しない。放送者を知りたいのは**コンテンツの都合**なので、必要なときだけ用意すればよい。

### 4. コンテンツ側の骨格を確認する

`g.game.onJoin` の登録は **`pushScene()` より前**に置く。シーンを作り、初期化を `onLoad` に書き、`pushScene()` で登録する、という Akashic の通常の流れに乗せること。毎フレームの処理は `g.Scene#onUpdate` に書く。

```js
const {
  banPlayer,
  onPlayerBanned,
} = require("@multi-indiegame/akashic-player-ban");

// 部屋主の識別はコンテンツの責務。pushScene より前に登録する
let broadcasterId = null;
g.game.onJoin.add((ev) => {
  if (broadcasterId === null) {
    broadcasterId = ev.player.id;
  }
});

module.exports = () => {
  const scene = new g.Scene({ game: g.game });

  scene.onLoad.add(() => {
    if (g.game.selfId === broadcasterId) {
      // 追放ボタンの出し分けはここで。ボタンはローカルエンティティに置く
    }

    onPlayerBanned.add(({ playerId }) => {
      // 進行から外すのはここだけ
    });

    scene.onUpdate.add(() => {
      // 毎フレームの進行はここ
    });
  });

  g.game.pushScene(scene);
};
```

## 動かす

```sh
akashic serve --target-service nicolive
```

- **親ウィンドウ**（最初に開いたもの）に発行を許す。これは serve 代役の方針で、実行基盤ごとに違ってよい
- ツールバーの **インスタンス追加** で開いた子ウィンドウには許さない。`banPlayer()` は確認ダイアログも出さずに `Unauthorized` を返す
- 親から `banPlayer()` を呼ぶと確認ダイアログが出る。承認すると全インスタンス（子ウィンドウとサーバ側インスタンスを含む）で `onPlayerBanned` が発火する

権限が無い側の分岐を親ウィンドウで試したいときは、URL に `?playerBanAllow=0` を付ける。

### 確認ダイアログ

ゲーム画面に重なる形で出る。実行基盤が持つべき確認 UI の代役で、akashic-cli-serve 組み込みのプレイヤー名確認ダイアログと同じ位置に置かれるため、ゲーム画面の拡縮にも追従する。

- **「追放する」** — 通知が playlog に流れ、全インスタンスで `onPlayerBanned` が発火する
- **「やめる」**（または Esc） — callback に `{ ok: false, reason: "Rejected" }` が返り、**playlog には何も流れない**

`Rejected` は「部屋主が確認ダイアログで拒否した」ときの理由コードなので、その分岐を書いたなら実際に踏んで確かめること。

ダイアログを出している間もコンテンツは止まらない。実行基盤も普通は止めないので、これは仕様どおり。止めて確認したいならツールバーのポーズを使う。

### 確認できること

| やること                              | 期待する結果                                        |
| ------------------------------------- | --------------------------------------------------- |
| 子ウィンドウから `banPlayer()`        | `Unauthorized`。ダイアログも出ない                  |
| 親で「やめる」                        | `Rejected`。他のインスタンスは何も起きない          |
| 親で「追放する」                      | 全インスタンスで `onPlayerBanned`                   |
| 同じ相手をもう一度追放                | 2 回目は `onPlayerBanned` が発火しない              |
| 追放後に新しいウィンドウを開く        | playlog を再生して `bannedPlayerIds()` が復元される |
| `window.playerBanServe.unban("pid2")` | 全インスタンスで `onPlayerUnbanned`                 |

### ダイアログの差し替え・無効化

`window.playerBanServe.confirm` に入っている。

```js
// 自前の UI に差し替える
window.playerBanServe.confirm = ({ action, playerId }) =>
  Promise.resolve(window.confirm(`${action}: ${playerId}`));

// 確認なしで即実行する
window.playerBanServe.confirm = null;
```

ブラウザの devtools コンソールからそのまま叩ける口も生えている。

```js
window.playerBanServe.ban("pid2"); // コンテンツからの要求と同じ経路（確認 UI あり）
window.playerBanServe.externalBan("pid2"); // 外部契機の追放
window.playerBanServe.unban("pid2"); // 外部契機の解除
window.playerBanServe.panel(); // 外部契機パネルの開閉
```

**`externalBan` と `unban` はコンテンツからは呼べない**（`external` に無い）。下の「外部契機」を参照。

## 外部契機の追放・解除を起こす

実行基盤は、管理画面やチャット UI など**コンテンツの外**でも追放・解除を起こしうる。そこで確定した変化も通知する義務があり（PROTOCOL.md 6.C）、**コンテンツはそれに追従できなければならない**。`banPlayer()` を一度も呼んでいなくても `onPlayerBanned` / `onPlayerUnbanned` は飛んでくる。

ページ左下に出る **「外部契機」** ボタンを押すと、その状況を作る小さな操作盤が開く。playerId を入れて「追放する」「解除する」を押すだけ。

操作盤はゲーム画面の**外**（ページの隅）に固定してある。コンテンツ自身の UI を覆わないようにするため。

- **確認ダイアログを通さず、発行権限も見ない。** 管理画面からの操作の模擬なので、コンテンツからの要求とは経路が違う
- 追放中の playerId が一覧に出る

確かめたいのはたとえばこういう挙動になる。

| やること                             | 期待する結果                                            |
| ------------------------------------ | ------------------------------------------------------- |
| タイトル（募集）画面で外部契機の追放 | 参加表明済みの相手がゲーム開始メンバーから外れる        |
| ゲーム進行中に外部契機の追放         | `onPlayerBanned` が飛び、ターン順から外れる             |
| 外部契機の解除                       | `onPlayerUnbanned` が飛び、`isBanned()` が false に戻る |

## 追放中の表示

**追放された playerId の画面には、半透明のオーバーレイと「BAN 中」が出る。**

自分の画面が対象かどうかは `store.player.id`（コンテンツから見た `g.game.selfId`）で判定している。別ウィンドウで起こした追放も、同一オリジンの `localStorage` 経由で伝わる。

**これは表示だけで、切断も再入室拒否もしない。** 本物の実行基盤は「進行から外れるだけでなく閲覧もできない状態にする」義務を負う（PROTOCOL.md 6.B）。serve でオーバーレイ越しに操作できてしまっても、それは serve の限界であってコンテンツの不具合ではない。

`sandbox.config.js` からプラグインに設定値を渡す口は無いので、本格的に作り替えるなら `node_modules/@multi-indiegame/akashic-player-ban-plugin/serve/plugin.js` をコンテンツ側にコピーして編集し、そのパスを `client.external` に書く。依存を持たない 1 ファイルなのでそのまま動く。

## 落とし穴

**`sandbox.config.js` が例外を投げると serve が起動時に落ちる。** ブラウザ側のエラーではなくサーバの起動失敗として出る。`require.resolve()` のパッケージ名を間違えたときはこうなる。

**`npm install` だけでは `environment.external` が追記されない。** `akashic install` を使うこと。既に `npm install` 済みなら `akashic scan globalScripts --force`。

**`g.game.onJoin` の登録が遅いと放送者を取り逃す。** `pushScene()` より前、できればエントリポイントの先頭で登録すること。シーンの `onLoad` の中だと、Join の処理順によっては届いた後になる。

**素の `akashic serve` では `JoinEvent` が流れない。** 放送者を識別するコードを書いたなら `--target-service nicolive` で起動すること。

**`client.external` に相対パスを書くと serve プロセスの cwd 基準で解決される。** `require.resolve()` は絶対パスを返すのでこの問題は起きない。ファイルをコピーして使う場合だけ `path.join(__dirname, ...)` で絶対パスにすること。

**`--debug-untrusted` では動かない。** serve が組み立てるプラグインオブジェクトに `untrustedSignature` が付かないため関数呼び出しが橋渡しされない。コンテンツが別 origin の iframe に入るのでダイアログの DOM も届かない。

## 補足 — プラグインを入れずに通知だけ撃つ

`onPlayerBanned` を受ける側だけ確かめたいなら、`sandbox.config.js` に名前付きイベントを置くだけでもよい。devtool（右上のメニュー → Devtools）の **Events タブ**に出るので、クリックすると playlog に流れる。

```js
module.exports = {
  events: {
    banPid2: [
      [
        32, // playlog.EventCode.Message
        0,
        ":multi-indiegame", // 予約 playerId
        {
          type: "@multi-indiegame/akashic-player-ban",
          version: 1,
          action: "banned",
          playerId: "pid2",
        },
      ],
    ],
  },
};
```

ターミナルからも撃てる。

```sh
curl -X POST http://localhost:3300/api/public/v1/plays/latest/playlog \
  -H 'Content-Type: application/json' \
  -d '{"events":[[32,0,":multi-indiegame",{"type":"@multi-indiegame/akashic-player-ban","version":1,"action":"banned","playerId":"pid2"}]]}'
```

拡張ライブラリが仕様どおり無視することも、ここで確かめられる。

| 撃つもの                                           | 期待する挙動               |
| -------------------------------------------------- | -------------------------- |
| `version` を `99` にしたもの                       | 発火しない。エラーも出ない |
| 送信者を `":multi-indiegame"` ではなく `"pid2"` に | 発火しない。エラーも出ない |

何も設定しない素の `akashic serve` でも、`banPlayer()` が `NotSupported` を返すだけで例外は出ないことを確認しておくとよい。非対応の実行基盤でコンテンツが落ちないことの確認になる。

## 仕組み

読まなくても使えるが、うまく動かないときの当たりを付けるために。

1. `game.json` の `environment.external` のキーが、akashic-cli-serve がプラグインを探す名前になる
2. serve は `sandbox.config.js` の `client.external[key]` のファイルを `/contents/:contentId/sandboxConfig/plugins/:key` で配信する。このとき `module` / `exports` だけを与えた無名関数で包む（**`require()` は使えない**）
3. serve のクライアントが `module.exports()` を呼び、戻り値を `g.game.external[key]` に代入する
4. `ban()` は `POST /api/public/v1/plays/:playId/playlog` に通知イベントを投げる。serve の debug 権限 AMFlow がそれを playlog に書き、active インスタンス経由で全インスタンスへ同一 tick で配る

つまりこのバックエンドは、実行基盤が満たすべき契約のうち「通知の注入」と「確認 UI」を serve の中で代行している。

## 代行していないこと

serve は開発用のサーバなので、実行基盤の契約のうち次は満たさない。**本番の実行基盤で確かめること。**

- **状態変化の実効化（PROTOCOL.md 6.B）** — 本番の実行基盤は、追放した相手を**進行から外すだけでなく閲覧もできない状態にする**義務を負う。serve は何もしない。追放したウィンドウを開き直せば戻ってくるし、`ban()` は Leave イベントを流して切断を模擬するだけ
- **権限判定** — 発行してよいかを「親ウィンドウか」だけで決めている。サーバ側の再判定は無い
- **クライアント由来イベントの検証** — serve は検証しないので、コンテンツから `:multi-indiegame` を名乗ったイベントを流せてしまう

## 関連

- [`@multi-indiegame/akashic-player-ban`](../packages/akashic-player-ban) — コンテンツ側の API
- [PROTOCOL.md](https://github.com/multi-indiegame/akashic-external-protocol) — 実行基盤との通信仕様
