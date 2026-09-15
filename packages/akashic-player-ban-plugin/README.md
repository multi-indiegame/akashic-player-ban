# @multi-indiegame/akashic-player-ban-plugin

`@multi-indiegame/akashic-player-ban` を受け入れる**コンテンツ実行基盤**向けのプラグイン。`g.game.external.playerBan` を生やし、要求を `PlayerBanBackend` へ委譲する。

**Akashic Engine のマルチモードをサポートする実行基盤（PROTOCOL.md でいうマルチモード実行基盤）を作る人**向け。実行基盤側に必要な処理を把握している前提で書いてある。プラグインは `JoinEvent` の送出に関与しないので、ニコ生ゲームマルチプレイ仕様をサポートする実行基盤にも同じように組み込める。

ゲーム開発者が使うのはこちらではなく [`@multi-indiegame/akashic-player-ban`](../akashic-player-ban) の方。`akashic serve` での動作確認に使う代役のバックエンドは [`@multi-indiegame/akashic-player-ban-serve`](../akashic-player-ban-serve) に分かれている。

## 使い方

```ts
import {
  PlayerBanPlugin,
  PlayerBanBackend,
  buildBanNotificationEvent,
} from "@multi-indiegame/akashic-player-ban-plugin";

const backend: PlayerBanBackend = {
  // detail.name はコンテンツが申告した表示名（任意）。使わないなら ban: (playerId) => ... でよい
  ban: (playerId, detail) => banPlayerInGame(play.id, playerId, detail?.name),
};

view.registerExternalPlugin(new PlayerBanPlugin(backend));
```

生えるのは `ban` だけ。解除の口も、発行してよいかを問い合わせる口も持たない。

`registerExternalPlugin()` は duck typing なので、`@akashic/agvw` でも互換実装でも構造的に通る。プラグイン側は実行基盤の型に依存しない。

## 実行基盤が満たすべき契約

仕様の全文は [akashic-external-protocol](https://github.com/multi-indiegame/akashic-external-protocol) の PROTOCOL.md にある。最低限これを満たすこと。

1. **通知の注入（6.A）**
   追放が確定したら `buildBanNotificationEvent("banned", playerId)` で組み立てたイベントを、**Event を subscribe しているインスタンスへ AMFlow のインタフェースを通じて**届ける。**コンテンツが `g.game.raiseEvent()` で送ったイベントを傍受する方式では満たさない**（承認可否を検証する余地が残らないため）。
   `playerId` は**コンテンツへ申告している in-game playerId**（コンテンツが `ev.player.id` で観測している値）であること。実行基盤の内部識別子を送るとコンテンツ側で誰にもマッチせず、追放が静かに効かなくなる（PROTOCOL.md 4.1）

2. **状態変化の実効化（6.B）**
   通知を出したなら、その状態を実際に作る。追放なら、対象が**ゲームの進行から外れるだけでなく、そのセッションを閲覧もできない状態にする**こと。
   **要求そのものを拒否するのは自由。** この契約が縛るのは通知を出したあとであって、要求を必ず承認せよという意味ではない

3. **コンテンツ外で確定した変化の通知（6.C・条件付き）**
   管理画面やチャット UI など、コンテンツの外で追放・解除を確定できる経路を持つなら、そこで確定した変化も 1 と同じ経路で通知する。持たない実行基盤には課さない。
   届かないと、実行基盤は対象を締め出したのにコンテンツはターン順に残したまま、という食い違いが起きる

## 権限は実装側が決める

**誰が追放を発行してよいかはこのプラグインが決めることではない。** 部屋主だけに許す基盤も、モデレーター権限を配る基盤も、全員に許す基盤もありうる。プラグインは要求をそのまま `PlayerBanBackend` へ渡すだけで、判定はしない。認めない要求には `reason: "Unauthorized"` を返すこと。

**判定は必ずサーバー側で行う。** コンテンツが実行基盤と同一オリジンで動く構成では、このプラグインを経由せずに API を直接叩ける。クライアント側で先に握り潰す実装を足しても構わないが、それは通信を減らすための最適化であって防御ではない。

`PlayerBanBackend` の実装側で、必ず次を独立に行うこと。

- 発行元の再判定（cookie / 認証情報から決め、クライアントから受け取らない）
- 対象が実際にそのセッションの参加者かの確認
- 件数上限とレート制限
- 管理画面や記録に出す名前はサーバー側で組む（コンテンツが申告した表示名を使わない）

## 確認 UI に出す名前

コンテンツは、追放の要求に対象の表示名を添えることがある。プラグインはそれを `detail.name` として `PlayerBanBackend` に渡す。申告が無いとき、また空文字や文字列以外が来たときは `undefined` になる。

**これはコンテンツの申告で、実行基盤は検証していない値である。** 使ってよいのは、確認 UI で操作者が相手を見分けるための補助表示だけ。表示するなら次を守ること。

1. **申告が無いとき、実行基盤が把握しているアカウント名で補わない。** 申告名とアカウント名を並べて出すのも同じ。playerId だけを出すか、名前の申告が無いと出す
2. **コンテンツの申告だと分かる形で出す。** 実行基盤が保証した名前に見せない。悪意あるコンテンツは、運営を名乗る名前や別人の名前を申告できる
3. **信頼できない文字列として扱う。** テキストとしてエスケープし、長さや制御文字（双方向制御文字を含む）の扱いは表示側で決める
4. **権限判定・対象の特定・通知・記録の鍵には使わない。** 対象は常に `playerId` で決まる

1 を守る理由: 確認 UI にアカウント名を出すと、確認を出しては取りやめることを繰り返すだけで、ユーザーの同意なく名前を知れてしまう。ニコ生ゲームでは、アカウント名はもともと `resolvePlayerInfo` でユーザーの同意を得て取得するものだった。**確認 UI には、要求したインスタンスがすでに知っている情報だけを出す。** 追放が確定した後に、管理画面などでアカウント名を出すのはこの限りではない。

名前を読まない実装でも問題ない。`ban: (playerId) => ...` のままで動き、確認 UI には playerId だけが出る。

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
