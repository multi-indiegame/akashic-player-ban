# @multi-indiegame/akashic-player-ban-serve

[`@multi-indiegame/akashic-player-ban`](../akashic-player-ban) を `akashic serve` の上で動作確認するためのバックエンド。

**Akashic Engine のマルチモード**で動くコンテンツを作っている方向けです（ニコ生ゲームマルチプレイ仕様のコンテンツも含みます）。実行基盤に組み込むものではありません（それは [`@multi-indiegame/akashic-player-ban-plugin`](../akashic-player-ban-plugin) です）。

## これは何をするか

`akashic serve` は playerBan に対応していないので、そのままでは `isSupported()` が `false` になり、`banPlayer()` はつねに `reason: "NotSupported"` を返します。このパッケージを `sandbox.config.js` から読ませると、`akashic serve` の中で実行基盤の代役を務め、**追放の送信・受信・確認ダイアログの動作確認**ができるようになります。

- `g.game.external.playerBan` を生やし、`banPlayer()` の要求を受け取ります
- 誰からの要求を許可するかを、`sandbox.config.js` の許可モードで選べます（既定は最初のユーザーだけ。`--target-service nicolive` なら放送者）。ウィンドウごとに操作盤から上書きもできます
- 確認ダイアログを出します（実行基盤が持つべき確認 UI の代役）
- 承認された追放を全インスタンスに通知し、`onPlayerBanned` を発火させます
- 画面右端の「ゲーム外からBAN」タブから、コンテンツを介さない追放・解除を起こせます
- 追放中のプレイヤーの画面に、そのことを示すオーバーレイを出します

**実行基盤の契約のうち「状態変化の実効化」は代役を務めません。** 切断も再入室拒否もしないので、そこは本番の実行基盤で確かめてください（[代行していないこと](#代行していないこと)）。

## セットアップ

### 1. 拡張ライブラリ本体が入っているか確認する

`game.json` に次の記述があれば入っています。

```jsonc
"environment": {
  "external": {
    "playerBan": "0"
  }
}
```

無ければ、先に本体をインストールしてください。

```sh
akashic install @multi-indiegame/akashic-player-ban
```

### 2. このパッケージをインストールする

```sh
npm install -D @multi-indiegame/akashic-player-ban-serve
```

動作確認にしか使わないので devDependency でよく、コンテンツのスクリプトには影響しません。

### 3. `sandbox.config.js` を編集する

```js
module.exports = {
  // ... 既存の設定
  client: {
    external: {
      playerBan: require.resolve("@multi-indiegame/akashic-player-ban-serve"),
    },
  },
};
```

`require()` ではなく `require.resolve()` です。`akashic serve` に渡すのはパスであって値ではありません。

`akashic serve` を起動すると、コンテンツ内で定義した追放機能が動作するようになります。

## 追放を許可するインスタンス

**誰からの追放を許可するかは実行基盤の決めごと**です。このパッケージでは、試したい実行基盤に近い許可モードを `sandbox.config.js` で選べます。さらにウィンドウごとに、操作盤から許可・禁止を上書きできます。

- 追放が認められたウィンドウから `banPlayer()` を呼ぶと、確認ダイアログが出ます。承認すると全インスタンス（サーバ側インスタンスを含む）で `onPlayerBanned` が発火します
- 追放が認められていないウィンドウからの `banPlayer()` は `Unauthorized` を返します。確認ダイアログは出ません

### 許可モードを選ぶ

`sandbox.config.js` の `playerBanServe.allow` で選びます。指定が無い場合は `"firstPlayer"` です。

```js
module.exports = {
  // ... 既存の設定
  client: {
    external: {
      playerBan: require.resolve("@multi-indiegame/akashic-player-ban-serve"),
    },
  },
  playerBanServe: {
    allow: "firstPlayer", // または "all"
  },
};
```

| `allow`                 | 誰に許すか         |
| ----------------------- | ------------------ |
| `"firstPlayer"`（既定） | 最初のユーザーだけ |
| `"all"`                 | 全員               |

「最初のユーザー」は、起動方法によって決まり方が違います。

| 起動方法                    | 最初のユーザー                                                       |
| --------------------------- | -------------------------------------------------------------------- |
| `--target-service nicolive` | **放送者**                                                           |
| それ以外                    | そのプレイでこのパッケージが最初に読み込まれたウィンドウのプレイヤー |

- **`--target-service nicolive` では、コンテンツが判定する放送者と一致します。** `akashic serve` はプレイを作ったウィンドウのプレイヤーを放送者として Join させるので、このパッケージもその Join の記録を見て判定しています。放送者だけに追放ボタンを出すコンテンツでも、ボタンが出るウィンドウと追放が許可されるウィンドウが揃います
- `akashic serve` は既定で起動時にブラウザを 1 つ開き、そのウィンドウがプレイを作ります。そのため `--target-service nicolive` では、**起動時に自動で開いたウィンドウが放送者**になります（`-B` で自動で開かないようにすると、自分で最初に開いたウィンドウが放送者になります）
- どちらの起動方法でも、再読み込みでは playerId が変わらないので、最初のユーザーも変わりません
- `--target-service nicolive` 以外では、最初に開いたウィンドウの記録を `localStorage` に置いています。記録を共有できるのは同じブラウザのタブやウィンドウの間だけで、**別のブラウザで開くと、そのブラウザでも自分が最初のユーザーになります。** 複数のブラウザで試すときは `allow: "all"` にするか、操作盤で上書きしてください

### 操作盤で上書きする

「ゲーム外からBAN」タブで開くパネルの下にある **「banPlayer()時のルール」** で、そのウィンドウからの要求の扱いを決めます。

- **「既定に従う」にチェックが入っている間**は、許可モードの判定に従います。括弧内に、その画面での結果が出ます（例: `既定に従う（許可）`）。根拠（モードと最初のユーザー）はラベルにマウスを重ねると出ます。許可・禁止のボタンは、いまの判定を示すだけで押せません
- **チェックを外すと**、許可・禁止を自分で選べます。外した直後は既定と同じ判定から始まるので、外しただけで挙動は変わりません

上書きはウィンドウ（playerId）ごとで、再読み込みしても残ります。

## 確認ダイアログ

ゲーム画面に重なる形で出ます。実行基盤が持つべき確認 UI の代役です。

- **「追放する」** — 全インスタンスで `onPlayerBanned` が発火します
- **「やめる」**（または Esc） — callback に `{ ok: false, reason: "UserCancel" }` が返ります。他のインスタンスには何も通知されません

ダイアログを出している間も、コンテンツは止まりません。

### ダイアログの差し替え・無効化

`window.playerBanServe.confirm` を書き換えてください。

```js
// 自前の UI に差し替える
window.playerBanServe.confirm = ({ action, playerId }) =>
  Promise.resolve(window.confirm(`${action}: ${playerId}`));

// 確認なしで即実行する
window.playerBanServe.confirm = null;
```

## ゲーム外から追放・解除を起こす

実行基盤は、管理画面やチャット UI など**コンテンツの外**でも追放・解除を確定できます。そこで確定した変化も通知されるので（PROTOCOL.md 6.C）、**コンテンツはそれに追従しなければなりません。** `banPlayer()` を一度も呼んでいなくても `onPlayerBanned` / `onPlayerUnbanned` が呼ばれうる点に注意してください。

画面**右端**の **「ゲーム外からBAN」** タブを押すと、その状況を作る小さな操作盤が左へ開きます。playerId を入れて「追放する」「解除する」を押すと、追放・解除が実行されます。

- **許可モードや操作盤の上書きに関わらず実行します。確認ダイアログも出しません。** 実行基盤の管理画面からの操作を模しているためです
- 追放する playerId は自由に指定できます
- 追放中の playerId がタグとして並びます。タグを押すと、その相手の追放を解除します

タブは URL に **`?playerBanPanel=0`** を付けると消せます。その場合も `window.playerBanServe.panel()` で開けます。

## 追放中の表示

**追放された playerId の画面には、半透明のオーバーレイと「BAN 中」が出ます。**

自分の画面が対象かどうかは `store.player.id`（コンテンツから見た `g.game.selfId`）で判定しています。

`akashic serve` では動作確認のために状態を表示するだけです。対応した実行基盤では、ゲーム画面そのものを閲覧できない状態にします（PROTOCOL.md 6.B）。

## devtools コンソールから操作する

ブラウザの devtools コンソールから、そのまま叩ける口を用意しています。自動操作で動かしたいときにも使えます。

```js
window.playerBanServe.ban("pid2"); // コンテンツからの要求と同じ経路（許可の判定と確認 UI あり）
window.playerBanServe.externalBan("pid2"); // ゲーム外からの追放
window.playerBanServe.unban("pid2"); // ゲーム外からの解除
window.playerBanServe.allow(false); // このウィンドウからの banPlayer() を禁止（true で許可、null で既定、省略でいまの判定を返す）
window.playerBanServe.panel(); // 操作盤の開閉（true / false で指定）
```

**`externalBan` と `unban` はコンテンツからは呼べません**（`g.game.external.playerBan` には生やしていません）。

## 補足 — このパッケージを入れずに通知だけ撃つ

`onPlayerBanned` を受ける側だけ確かめたいなら、`sandbox.config.js` に名前付きイベントを置くだけでも足ります。devtools の **Events タブ**に出るので、クリックするとイベントとして受信できます。

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

ターミナルからも撃てます。

```sh
curl -X POST http://localhost:3300/api/public/v1/plays/latest/playlog \
  -H 'Content-Type: application/json' \
  -d '{"events":[[32,0,":multi-indiegame",{"type":"@multi-indiegame/akashic-player-ban","version":1,"action":"banned","playerId":"pid2"}]]}'
```

## 中身を書き換えたいとき

`sandbox.config.js` から変えられるのは許可モード（`playerBanServe.allow`）だけです。確認 UI は、上の [ダイアログの差し替え](#ダイアログの差し替え無効化) のとおり実行時に差し替えられます。

それ以上を変えたいなら、`node_modules/@multi-indiegame/akashic-player-ban-serve/lib/index.js` をコンテンツ側にコピーして編集し、そのパスを `client.external` に書いてください。依存を持たない 1 ファイルなのでそのまま動きます。

## 仕組み

読まなくても使えますが、うまく動かないときの当たりを付けるために。

1. `game.json` の `environment.external` のキーが、`akashic serve` が `client.external` から読み込むファイルを探す名前になります
2. `akashic serve` は `sandbox.config.js` の `client.external[key]` のファイルを `/contents/:contentId/sandboxConfig/plugins/:key` で配信します。このとき `module` / `exports` だけを与えた無名関数で包むので、**読み込まれるファイルの中で `require()` は使えません**
3. `akashic serve` のクライアントが `module.exports()` を呼び、戻り値を `g.game.external[key]` に代入します
4. `ban()` は `POST /api/public/v1/plays/:playId/playlog` に通知イベントを投げます。`akashic serve` の debug 権限 AMFlow がそれを playlog に書き、active インスタンス経由で全インスタンスへ同一 tick で配ります

つまりこのパッケージは、実行基盤が満たすべき契約のうち「通知の注入」と「確認 UI」を `akashic serve` の中で代行しています。

## 代行していないこと

`akashic serve` は開発用のサーバなので、実行基盤の契約のうち次は満たしません。**ここは本番の実行基盤でしか確かめられません。**

- **状態変化の実効化（PROTOCOL.md 6.B）** — 本番の実行基盤は、追放した相手を**進行から外すだけでなく閲覧もできない状態にする**義務を負います。このパッケージがやるのは、対象の画面にオーバーレイを被せることだけです。切断しませんし、ウィンドウも閉じませんし、再入室も拒みません
- **権限判定** — 発行してよいかを、許可モードと操作盤の上書きだけで決めています。サーバ側の再判定はありません
- **クライアント由来イベントの検証** — `akashic serve` は検証しないので、コンテンツから `:multi-indiegame` を名乗ったイベントを流せてしまいます

実行基盤側が何を満たすべきかは [PROTOCOL.md](https://github.com/multi-indiegame/akashic-external-protocol) と [`@multi-indiegame/akashic-player-ban-plugin`](../akashic-player-ban-plugin) にあります。**Akashic Engine のマルチモードをサポートする実行基盤（PROTOCOL.md でいうマルチモード実行基盤）を作っている方**はそちらを参照してください。

## 開発

**`lib/index.js` は生成物。** 直接編集せず、`src/index.ts` を直して `npm run build` してください（esbuild が iife 形式・依存なしの 1 ファイルへ畳みます）。

`akashic serve` は `client.external` に指定したファイルを「`module` と `exports` しか無いスコープ」で評価し、`require()` が無いので、依存はすべてバンドルで畳み込む必要があります。プロトコル定数は `@multi-indiegame/akashic-player-ban/protocol` から、操作盤の置き場は [`@multi-indiegame/akashic-serve-extension-dock`](https://github.com/multi-indiegame/akashic-serve-extension-dock) から取り込むので、**手写しの定数はありません。**

## 関連

- [`@multi-indiegame/akashic-player-ban`](../akashic-player-ban) — コンテンツ側の API
- [PROTOCOL.md](https://github.com/multi-indiegame/akashic-external-protocol) — 実行基盤との通信仕様

## ライセンス

MIT
