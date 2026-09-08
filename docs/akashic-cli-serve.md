# akashic-cli-serve で動作確認する

`akashic serve` は playerBan に対応していないので、そのままでは `banPlayer()` が `reason: "NotSupported"` を返すだけで何も起きない。`sandbox.config.js` に数行足すと、**追放の送信・受信・確認ダイアログまで serve の上で確かめられる**。

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
  // 部屋主の Join を、コンテンツ起動前に playlog へ流す
  autoSendEventName: "broadcasterJoin",
  events: {
    broadcasterJoin: [[0, 3, "pid1", "broadcaster"]],
  },
  client: {
    external: {
      // require() ではなく require.resolve()。渡すのはパスであって値ではない
      playerBan:
        require.resolve("@multi-indiegame/akashic-player-ban-plugin/serve"),
    },
  },
};
```

`autoSendEventName` と `events` は、コンテンツが部屋主を識別するなら必要。実行基盤は部屋主の `JoinEvent` を流すが、serve には部屋主の概念が無いので流れてこない。ここで代わりに流して部屋主を作る。書かない場合はツールバーの「Join Me」を押すと Join が流れる。`"pid1"` は serve が最初のウィンドウに割り当てる playerId なので、親ウィンドウの `g.game.selfId` と一致する。

**部屋主が誰かを知るのはコンテンツの責務**で、拡張ライブラリは関与しない。`g.game.onJoin` を自分で見ること。

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
akashic serve
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
window.playerBanServe.ban("pid2");
window.playerBanServe.unban("pid2"); // 解除の通知だけを流す
```

**`unban` はコンテンツからは呼べない。** 解除は実行基盤の管理画面の仕事で、拡張の API に無いため。ただし `onPlayerUnbanned` を書いたなら試せないと困るので、「管理画面で解除された」状況を作る口を devtools 側にだけ置いている。

`sandbox.config.js` からプラグインに設定値を渡す口は無いので、本格的に作り替えるなら `node_modules/@multi-indiegame/akashic-player-ban-plugin/serve/plugin.js` をコンテンツ側にコピーして編集し、そのパスを `client.external` に書く。依存を持たない 1 ファイルなのでそのまま動く。

## 落とし穴

**`sandbox.config.js` が例外を投げると serve が起動時に落ちる。** ブラウザ側のエラーではなくサーバの起動失敗として出る。`require.resolve()` のパッケージ名を間違えたときはこうなる。

**`npm install` だけでは `environment.external` が追記されない。** `akashic install` を使うこと。既に `npm install` 済みなら `akashic scan globalScripts --force`。

**`g.game.onJoin` の登録が遅いと部屋主を取り逃す。** `pushScene()` より前、できればエントリポイントの先頭で登録すること。シーンの `onLoad` の中だと、Join の処理順によっては届いた後になる。

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

- **再入室の拒否** — 追放したウィンドウを開き直せば戻ってくる。`ban()` は Leave イベントを流して切断を模擬するだけ
- **予約 playerId の拒否** — serve はクライアント由来のイベントを検証しない。コンテンツから `:multi-indiegame` を名乗ったイベントを流せてしまう
- **権限判定** — 部屋主かどうかは「親ウィンドウか」だけで決めている。サーバ側の再判定は無い

## 関連

- [`@multi-indiegame/akashic-player-ban`](../packages/akashic-player-ban) — コンテンツ側の API
- [PROTOCOL.md](https://github.com/multi-indiegame/akashic-external-protocol) — 実行基盤との通信仕様
