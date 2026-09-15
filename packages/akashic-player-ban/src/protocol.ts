/**
 * g にも DOM にも触れない層。コンテンツ側パッケージと実行基盤向けパッケージの
 * 双方がこのファイルだけを共有する。
 *
 * 仕様: https://github.com/multi-indiegame/akashic-external-protocol/blob/main/PROTOCOL.md
 */

import type { MessageEvent } from "@akashic/playlog";

/**
 * 通知イベントの発行者として使う予約 playerId。
 *
 * WHY: XML の名前空間 URI と同じ扱いで、実行基盤の運営者が誰であってもこの文字列の
 * まま注入する。自分の org 名に置き換えると、その基盤の上でコンテンツが通知を
 * 受け取れなくなる。
 */
export const RESERVED_PLAYER_ID = ":multi-indiegame";

/** `g.game.external` 上のキー */
export const EXTERNAL_KEY = "playerBan";

/**
 * 通知イベントの type。
 *
 * WHY: npm パッケージ名をそのまま使うことで、名前空間を共有する他の拡張と
 * 衝突しない。採番表を持たずに済む。
 */
export const NOTIFICATION_TYPE = "@multi-indiegame/akashic-player-ban";

/** この type の payload の版。受信側は完全一致のものだけ採用する */
export const NOTIFICATION_VERSION = 1;

/**
 * playlog.EventCode.Message
 *
 * WHY: EventCode は const enum で、import type では値として参照できないので数値で持つ。
 */
const EVENT_CODE_MESSAGE = 32;

export type PlayerBanAction = "banned" | "unbanned";

/**
 * 追放が成立しなかった理由。
 *
 * NotSupported はライブラリが返す。それ以外は実行基盤が返し**うる**理由の候補で、
 * どの要求を認めてどれを断るか、断るときにどの理由を返すかは実行基盤が決める。
 * ここに理由があるからといって、それに対応するルールを実行基盤に課すものではない。
 *
 * WHY: 「誰が追放を発行してよいか」は実行基盤の決めごとなので、ここには
 * その基盤固有の役割名（部屋主・放送者など）や概念（部屋など）を持ち込まない。
 * 権限が無くて断られた場合は一律 Unauthorized になる。
 */
export type BanResultReason =
    /** 拡張が無い環境（headless runner や、この拡張に対応していない実行基盤）。ライブラリが返す */
    | "NotSupported"
    /** 実行基盤が発行を認めなかった。権限が無い場合はこれ */
    | "Unauthorized"
    /** 対象がこのセッションの参加者として見つからない */
    | "PlayerNotFound"
    /**
     * 対象が要求した本人だった。自分自身への追放を断る実行基盤が使う。
     * 自分自身を追放してはならないという決まりがあるわけではない
     */
    | "SelfBan"
    /** 実行基盤が設けている件数上限・レート制限に達した */
    | "LimitExceeded"
    /** 実行基盤の確認 UI で、操作者が取りやめた */
    | "UserCancel"
    /**
     * 上のいずれにも当てはまらない、または理由が分からない。ライブラリと
     * プラグインは、実行基盤から結果が返らなかったときや例外になったときにこれを返す
     */
    | "Unknown";

export interface BanResult {
    ok: boolean;
    playerId: string;
    reason?: BanResultReason;
}

export interface PlayerBanNotification {
    playerId: string;
}

export interface PlayerBanNotificationPayload {
    type: string;
    version: number;
    action: PlayerBanAction;
    playerId: string;
}

/**
 * playlog の MessageEvent。
 *
 * WHY: AMFlow の sendEvent などへそのまま渡せるよう playlog の型に合わせる。
 */
export type NotificationEvent = MessageEvent;

/**
 * `g.game.external.playerBan` に生えるオブジェクト。
 *
 * WHY: 追放を要求する口だけを置く。解除は実行基盤の管理画面の仕事で、コンテンツに
 * 渡さない（ban は保護をかける操作で誤っても管理画面から戻せるが、unban は保護を
 * 外す操作で、外された側が得をする）。
 *
 * 発行の可否を問い合わせる口も置かない。**誰が追放を発行できるかは実行基盤が
 * 決める**ことで、コンテンツはそれを知らないまま要求してよい。認められなければ
 * reason:"Unauthorized" が返る。
 */
export interface PlayerBanExternal {
    ban: (param: {
        playerId: string;
        callback: (result: BanResult) => void;
    }) => void;
}

export interface FunctionSignature {
    type: "function";
    callbackProp: string | null;
}

export interface ObjectSignature {
    type: "object";
    content: { [key: string]: FunctionSignature | ObjectSignature };
}

/**
 * `untrusted: true` の実行基盤で関数呼び出しを橋渡しするためのメタデータ。
 *
 * WHY: 実行基盤ごとに書き起こすと、引数の位置がずれても気づけない。プロトコルの
 * 一部としてここで固定する。
 */
export const UNTRUSTED_SIGNATURE: ObjectSignature = {
    type: "object",
    content: {
        ban: { type: "function", callbackProp: "arguments[0].callback" },
    },
};

/**
 * 名前空間 `:multi-indiegame` の通知イベントを組み立てる。
 * この名前空間の他の拡張も同じ形を使う。
 */
export function buildNotificationEvent(
    type: string,
    version: number,
    payload: { [key: string]: unknown },
): NotificationEvent {
    const data: { [key: string]: unknown } = {};
    for (const key in payload) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) {
            data[key] = payload[key];
        }
    }
    // WHY: type / version は payload 側で上書きできてはならないので後から入れる
    data.type = type;
    data.version = version;
    return [EVENT_CODE_MESSAGE, 0, RESERVED_PLAYER_ID, data];
}

/**
 * 実行基盤が追放 / 解除の確定時に注入するイベントを組み立てる。
 *
 * `playerId` は実行基盤がコンテンツへ申告している in-game playerId
 * （コンテンツが `ev.player.id` で観測している値）を渡すこと。実行基盤の内部
 * 識別子を渡すとコンテンツ側で誰にもマッチせず、追放が静かに効かなくなる。
 */
export function buildBanNotificationEvent(
    action: PlayerBanAction,
    playerId: string,
): NotificationEvent {
    return buildNotificationEvent(NOTIFICATION_TYPE, NOTIFICATION_VERSION, {
        action: action,
        playerId: playerId,
    });
}

/**
 * 受信した MessageEvent が自分宛の通知かを判定する。宛先違い・偽装・版違いは null。
 *
 * WHY: version は範囲比較ではなく完全一致で判定する。移行期間に実行基盤が複数の
 * version を並行送信するため、範囲比較にすると同じ確定を二重に処理してしまう。
 */
export function decodeBanNotification(
    senderPlayerId: string | null | undefined,
    data: unknown,
): PlayerBanNotificationPayload | null {
    if (senderPlayerId !== RESERVED_PLAYER_ID) {
        return null;
    }
    if (!data || typeof data !== "object") {
        return null;
    }
    const payload = data as { [key: string]: unknown };
    if (payload.type !== NOTIFICATION_TYPE) {
        return null;
    }
    if (payload.version !== NOTIFICATION_VERSION) {
        return null;
    }
    if (payload.action !== "banned" && payload.action !== "unbanned") {
        return null;
    }
    if (typeof payload.playerId !== "string" || payload.playerId === "") {
        return null;
    }
    return {
        type: NOTIFICATION_TYPE,
        version: NOTIFICATION_VERSION,
        action: payload.action,
        playerId: payload.playerId,
    };
}
