/// <reference types="@akashic/akashic-engine/index.runtime" />

import {
    BanResult,
    EXTERNAL_KEY,
    PlayerBanExternal,
    PlayerBanNotification,
    decodeBanNotification,
} from "./protocol";

export {
    BanResult,
    BanResultReason,
    PlayerBanNotification,
    RESERVED_PLAYER_ID,
    NOTIFICATION_TYPE,
    NOTIFICATION_VERSION,
} from "./protocol";

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

/**
 * WHY: MessageEvent は Game ではなく Scene に届く（Game に onMessage は無い）。
 * カレントシーンが変わるたびに登録し直すことで、ローカルシーンを挟んでも
 * 全インスタンスがどこかのシーンで通知を受け取れる状態を保つ。
 */
function attachToScene(scene: g.Scene | undefined): void {
    if (!scene || scene.onMessage.contains(handleMessage)) {
        return;
    }
    scene.onMessage.add(handleMessage);
}

g.game.onSceneChange.add(attachToScene);
attachToScene(g.game.scene());

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
                    reason: "InternalError",
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
