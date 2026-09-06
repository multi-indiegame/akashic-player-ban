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

export interface BanContext {
    /** 部屋主の player.id。JoinEvent 由来なので全インスタンスで同じ値 */
    gameMasterId: string | null;
    /** 自分がこのインスタンスで追放を発行できるか（＝自分が部屋主か） */
    canBan: boolean;
}

/**
 * 追放の成立。全インスタンスが同一 tick で同一内容を受け取る。
 * ゲーム状態を変えてよいのはここだけ。
 *
 * この部屋で発行された追放に限らず、部屋主の他の部屋や実行基盤の設定画面で
 * 確定した追放も届く。
 */
export const onPlayerBanned: g.Trigger<PlayerBanNotification> =
    new g.Trigger<PlayerBanNotification>();

/** 追放の解除。性質は onPlayerBanned と同じ */
export const onPlayerUnbanned: g.Trigger<PlayerBanNotification> =
    new g.Trigger<PlayerBanNotification>();

let _gameMasterId: string | null = null;
let _canBan = false;
let _contextResolved = false;
let _joinSeen = false;
let _joinGraceExpired = false;
let _prepareCallback: ((info: BanContext) => void) | null = null;
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

function firePrepareIfReady(): void {
    if (!_prepareCallback || !_contextResolved) {
        return;
    }
    if (!_joinSeen && !_joinGraceExpired) {
        return;
    }
    const callback = _prepareCallback;
    _prepareCallback = null;
    callback({ gameMasterId: _gameMasterId, canBan: _canBan });
}

function handleJoin(ev: g.JoinEvent): void {
    if (_joinSeen) {
        return;
    }
    _joinSeen = true;
    _gameMasterId = ev.player && ev.player.id ? ev.player.id : null;
    firePrepareIfReady();
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

g.game.onJoin.add(handleJoin);
g.game.onSceneChange.add(attachToScene);
attachToScene(g.game.scene());

/**
 * 起動時（モジュール読み込み直後）に一度だけ呼ぶ。
 * JoinEvent を取り逃さないよう、シーン生成より前に呼ぶこと。
 *
 * callback はローカル。ここで得た canBan で出し分けるものはローカルエンティティに置く。
 * gameMasterId だけは全インスタンス共通なのでゲーム状態に使ってよい。
 */
export function prepare(callback: (info: BanContext) => void): void {
    _prepareCallback = callback;

    const external = findExternal();
    if (!external) {
        _canBan = false;
        _contextResolved = true;
    } else {
        external.getContext({
            callback: (context) => {
                _canBan = !!(context && context.canBan);
                _contextResolved = true;
                firePrepareIfReady();
            },
        });
    }

    // WHY: JoinEvent を流さない実行基盤でも prepare が沈黙しないよう、最初の
    // update まで待って gameMasterId: null で発火する。ここで待たずに即発火すると、
    // Join を流す実行基盤で gameMasterId を取り逃す。
    const expireJoinGrace = (): void => {
        g.game.onUpdate.remove(expireJoinGrace);
        _joinGraceExpired = true;
        firePrepareIfReady();
    };
    g.game.onUpdate.add(expireJoinGrace);

    firePrepareIfReady();
}

/** 部屋主の playerId。全インスタンスで同じ値なのでゲーム状態に使ってよい */
export function gameMasterId(): string | null {
    return _gameMasterId;
}

/** 自分が追放を発行できる立場か。インスタンス固有（表示の出し分け専用） */
export function canBan(): boolean {
    return _canBan;
}

function request(
    kind: "ban" | "unban",
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
    if (!_canBan) {
        done({ ok: false, playerId: playerId, reason: "NotGameMaster" });
        return;
    }
    if (kind === "ban" && playerId === g.game.selfId) {
        done({ ok: false, playerId: playerId, reason: "SelfBan" });
        return;
    }
    external[kind]({
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

/**
 * 追放する。部屋主のインスタンス以外では reason:"NotGameMaster" で即返る。
 *
 * callback はローカル。進行から外すのは onPlayerBanned の中だけで行うこと。
 */
export function banPlayer(
    playerId: string,
    callback?: (result: BanResult) => void,
): void {
    request("ban", playerId, callback);
}

/** 追放を解除する。スコープは実行基盤の仕様に従う */
export function unbanPlayer(
    playerId: string,
    callback?: (result: BanResult) => void,
): void {
    request("unban", playerId, callback);
}

/** 通知を積み上げた決定的な状態 */
export function isBanned(playerId: string): boolean {
    return _bannedPlayerIds.indexOf(playerId) !== -1;
}

/** 通知を積み上げた決定的な状態。到着順のコピーを返す */
export function bannedPlayerIds(): string[] {
    return _bannedPlayerIds.slice();
}
