/**
 * g にも DOM にも触れない層。コンテンツ側パッケージと実行基盤向けパッケージの
 * 双方がこのファイルだけを共有する。
 *
 * 仕様: https://github.com/multi-indiegame/akashic-external-protocol/blob/main/PROTOCOL.md
 */

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

/** playlog.EventCode.Message */
const EVENT_CODE_MESSAGE = 32;

export type PlayerBanAction = "banned" | "unbanned";

export type BanResultReason =
    /** 拡張が無い環境（headless runner、akashic-cli-serve、非対応の実行基盤） */
    | "NotSupported"
    /** 部屋主ではないインスタンス */
    | "NotGameMaster"
    /** 対象がこの部屋の視聴者ではない */
    | "NotInRoom"
    /** 自分自身は追放できない */
    | "SelfBan"
    /** 件数上限・レート制限 */
    | "LimitExceeded"
    /** 部屋主が確認ダイアログで拒否した */
    | "Rejected"
    | "Unauthorized"
    | "InternalError";

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
 * WHY: `@akashic/playlog` に依存すると実行基盤の型を引き込むので、最小形で自前定義する。
 */
export type NotificationEvent = [number, number, string, unknown];

export interface PlayerBanExternalContext {
    canBan: boolean;
}

/** `g.game.external.playerBan` に生えるオブジェクト */
export interface PlayerBanExternal {
    getContext: (param: {
        callback: (context: PlayerBanExternalContext) => void;
    }) => void;
    ban: (param: {
        playerId: string;
        callback: (result: BanResult) => void;
    }) => void;
    unban: (param: {
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
        getContext: { type: "function", callbackProp: "arguments[0].callback" },
        ban: { type: "function", callbackProp: "arguments[0].callback" },
        unban: { type: "function", callbackProp: "arguments[0].callback" },
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

/** 実行基盤が BAN / 解除の確定時に注入するイベントを組み立てる */
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
