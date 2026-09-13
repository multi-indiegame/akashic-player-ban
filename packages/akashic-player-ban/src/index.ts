import {
    BanResult,
    EXTERNAL_KEY,
    PlayerBanExternal,
    PlayerBanNotification,
    PlayerBanNotificationPayload,
    decodeBanNotification,
} from "./protocol";

export {
    BanResult,
    BanResultReason,
    PlayerBanAction,
    PlayerBanNotification,
    PlayerBanNotificationPayload,
    RESERVED_PLAYER_ID,
    NOTIFICATION_TYPE,
    NOTIFICATION_VERSION,
    // WHY: サブパス (@multi-indiegame/akashic-player-ban/protocol) は
    // package.json の exports 由来で、Akashic の g._require は exports を
    // 解釈しない。実行基盤アダプタが本体エントリだけで完結できるよう、
    // decode もここから出す。
    decodeBanNotification,
} from "./protocol";

/*
 * WHY: lib に DOM を含めていないので console の型が無い。設定ミスを知らせる
 * 警告にだけ使うので、必要な形だけをここで宣言する。
 */
declare const console: { warn?: (...data: unknown[]) => void } | undefined;

/**
 * 追放の成立。全インスタンスが同一 tick で同一内容を受け取る。
 * ゲーム状態を変えてよいのはここだけ。
 *
 * このセッションで発行された追放に限らず、実行基盤の管理画面など別の経路で
 * 確定した追放も届く。
 */
export const onPlayerBanned: g.Trigger<PlayerBanNotification> =
    new g.Trigger<PlayerBanNotification>();

/**
 * 追放の解除。性質は onPlayerBanned と同じ。
 *
 * 解除を要求する API は無い（実行基盤の管理画面の仕事）。届いた解除に追従できる
 * よう、通知だけを受け取る。
 */
export const onPlayerUnbanned: g.Trigger<PlayerBanNotification> =
    new g.Trigger<PlayerBanNotification>();

const _bannedPlayerIds: string[] = [];

function findExternal(): PlayerBanExternal | null {
    const external = g.game.external as { [key: string]: unknown } | undefined;
    if (!external) {
        return null;
    }
    const found = external[EXTERNAL_KEY] as PlayerBanExternal | undefined;
    if (!found || typeof found.ban !== "function") {
        return null;
    }
    return found;
}

function handleMessage(ev: g.MessageEvent): void {
    const payload = decodeBanNotification(
        ev.player ? ev.player.id : null,
        ev.data,
    );
    if (!payload) {
        return;
    }
    acceptBanNotification(payload);
}

/**
 * 確定した通知を状態へ取り込む。
 *
 * 通常は g.Scene#onMessage から呼ばれる。**MessageEvent を握り潰す
 * フレームワークの上では、通知はコンテンツ側の別経路で運ばれてくる。**
 * その経路から状態機械へ入るための口である（例: coe は届いた MessageEvent を
 * すべて Controller のアクションへ変換し、tick に載せない。
 * @multi-indiegame/akashic-player-ban-coe を参照）。
 *
 * WHY: 重複排除をここに置いているのは、全インスタンスが同じ判定で収束する
 * 必要があるため。運搬経路の送信側に置くと instance 間で state がずれる。
 *
 * 発行者の検証（予約 playerId を名乗っているか）は**呼び出し側の責務**。
 *
 * @internal 実行基盤アダプタ用。通常のコンテンツは使わない。
 */
export function acceptBanNotification(
    payload: PlayerBanNotificationPayload,
): void {
    const index = _bannedPlayerIds.indexOf(payload.playerId);
    if (payload.action === "banned") {
        // WHY: 同じ確定が再送されても進行を二重に動かさないよう、状態が実際に
        // 変わったときだけ発火する。二重発火はターンの二重進行を生む。
        if (index !== -1) {
            return;
        }
        _bannedPlayerIds.push(payload.playerId);
        onPlayerBanned.fire({ playerId: payload.playerId });
    } else {
        if (index === -1) {
            return;
        }
        _bannedPlayerIds.splice(index, 1);
        onPlayerUnbanned.fire({ playerId: payload.playerId });
    }
}

let _bridgeInstalled = false;
let _warnedAboutSwallowing = false;

/**
 * 通知の運搬をアダプタが引き受けたことを申告する。
 *
 * 申告が無いまま MessageEvent を握り潰すフレームワークを検出すると、
 * ライブラリは警告を出す。
 *
 * @internal 実行基盤アダプタ用。通常のコンテンツは使わない。
 */
export function markNotificationBridgeInstalled(): void {
    _bridgeInstalled = true;
}

/**
 * WHY: この拡張の最悪の壊れ方は「banPlayer() が ok を返すのに何も起きない」で、
 * 原因がフレームワークの内部にあるため追跡にひどく時間がかかる。握り潰す
 * フレームワークを検出したら、黙って失敗せずに知らせる。
 *
 * coe の Scene は onCommandReceive を持つ。これを目印にする。coe に依存すると
 * 版を固定することになるので、型ではなく形で見る。
 */
function warnIfNotificationsAreSwallowed(scene: g.Scene): void {
    if (_bridgeInstalled || _warnedAboutSwallowing) {
        return;
    }
    const suspect = scene as unknown as { onCommandReceive?: unknown };
    if (!suspect.onCommandReceive) {
        return;
    }
    _warnedAboutSwallowing = true;
    if (typeof console !== "undefined" && console && console.warn) {
        console.warn(
            "[akashic-player-ban] このシーンは g.MessageEvent を握り潰す" +
                "フレームワーク (coe 等) のものに見えます。" +
                "このままでは onPlayerBanned は発火しません。" +
                "@multi-indiegame/akashic-player-ban-coe を導入してください。",
        );
    }
}

/**
 * WHY: MessageEvent は Game ではなく `g.Scene#onMessage` にしか届かず、Scene は
 * コンテンツが自由に積み替える。カレントシーンが変わるたびに登録し直すことで、
 * **コンテンツ側に「Scene を変えるな」という制約を課さずに**受信を担保する。
 * これはライブラリ側の責務（PROTOCOL.md 7-6）。
 */
function attachToScene(scene: g.Scene | undefined): void {
    if (!scene || scene.onMessage.contains(handleMessage)) {
        return;
    }
    scene.onMessage.add(handleMessage);
    warnIfNotificationsAreSwallowed(scene);
}

g.game.onSceneChange.add(attachToScene);
attachToScene(g.game.scene());

/**
 * このインスタンスで追放を要求できるか（`g.game.external.playerBan` があるか）。
 *
 * **結果はローカル。** 同じ実行基盤の上でも、プレイヤーの画面では true、
 * サーバ側で動くインスタンス（headless runner など）では false ということがある。
 * 追放ボタンを出すかどうかのようなローカルな判断にだけ使い、ゲーム状態をこれで
 * 分岐させないこと。
 *
 * WHY: 対応・非対応の両方の実行基盤に同じコンテンツを投稿するとき、非対応の
 * 実行基盤では押しても何も起きないボタンを出したくない。banPlayer() を呼んで
 * NotSupported が返るのを待つのでは、ボタンを出す前に判断できない。
 */
export function isSupported(): boolean {
    return findExternal() !== null;
}

/**
 * プレイヤーの追放を要求する。
 *
 * **誰が発行してよいかは実行基盤が決める。** このライブラリは判定に関与せず、
 * 呼ばれたらそのまま要求を投げる。認められなければ reason:"Unauthorized" が返る
 * （例: みんなでゲーム! では部屋主のインスタンスからの要求だけを受け付ける）。
 *
 * WHY: 権限をこちらで判定しようとすると、実行基盤ごとに違う役割（部屋主・放送者・
 * モデレーター…）をライブラリが知る必要が出るうえ、たとえば部屋主を JoinEvent から
 * 割り出す実装にすると、コンテンツ側のハンドラ登録との順序で取れたり取れなかったり
 * する。誰が発行できるかは実行基盤の決めごとに戻す。ボタンの出し分けが要るなら、
 * コンテンツが自分で知っている情報（g.game.selfId と、コンテンツが把握している
 * 部屋主の id など）で行う。
 *
 * callback はローカル。**進行から外すのは onPlayerBanned の中だけで行うこと。**
 * 押した時点で外すと、実行基盤に拒否されたときコンテンツだけが「いない」と思い込む。
 */
export function banPlayer(
    playerId: string,
    callback?: (result: BanResult) => void,
): void {
    const done = (result: BanResult): void => {
        if (callback) {
            callback(result);
        }
    };
    const external = findExternal();
    if (!external) {
        done({ ok: false, playerId: playerId, reason: "NotSupported" });
        return;
    }
    external.ban({
        playerId: playerId,
        callback: (result) => {
            done(
                result || {
                    ok: false,
                    playerId: playerId,
                    reason: "Unknown",
                },
            );
        },
    });
}

/** 通知を積み上げた決定的な状態 */
export function isBanned(playerId: string): boolean {
    return _bannedPlayerIds.indexOf(playerId) !== -1;
}

/** 通知を積み上げた決定的な状態。到着順のコピーを返す */
export function bannedPlayerIds(): string[] {
    return _bannedPlayerIds.slice();
}
