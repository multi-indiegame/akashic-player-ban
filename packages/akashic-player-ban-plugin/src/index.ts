import {
    BanResult,
    EXTERNAL_KEY,
    PlayerBanExternal,
    UNTRUSTED_SIGNATURE,
    ObjectSignature,
    normalizeBanTargetName,
} from "@multi-indiegame/akashic-player-ban/protocol";

export {
    BanResult,
    BanResultReason,
    BanTarget,
    PlayerBanAction,
    NotificationEvent,
    RESERVED_PLAYER_ID,
    NOTIFICATION_TYPE,
    NOTIFICATION_VERSION,
    EXTERNAL_KEY,
    buildNotificationEvent,
    buildBanNotificationEvent,
    decodeBanNotification,
} from "@multi-indiegame/akashic-player-ban/protocol";

/**
 * 実行基盤の ExternalPlugin 型の最小形。
 *
 * WHY: `registerExternalPlugin()` は duck typing で、公式の @akashic/agvw に型定義なし。
 * 必要な構造のみここで定義する。
 */
export interface ExternalPluginLike {
    name: string;
    untrustedSignature?: unknown;
    onload(
        game: { external: { [key: string]: unknown } },
        databus?: unknown,
        content?: unknown,
    ): void;
}

/**
 * 実行基盤が実装する側。
 *
 * 権限判定・確認 UI・永続化・切断・再入室拒否・通知の注入はすべて実装側の責務。
 * このプラグインは呼び出しを橋渡しするだけで、セキュリティ境界ではない。
 *
 * **誰が追放を発行してよいかはこの実装が決める。** 判定は必ずサーバー側で行い、
 * 認めない要求には reason:"Unauthorized" を返すこと。クライアント側で先に握り潰す
 * 実装を加えてもよいが、それは通信を減らすための最適化であって防御にはならない点に注意。
 */
export interface PlayerBanBackend {
    /**
     * 追放を要求する。
     *
     * detail はコンテンツが添えた補助情報。プラグインは常に渡すが、読まない実装は
     * `ban(playerId)` のままでよい。
     */
    ban(playerId: string, detail?: BanRequestDetail): Promise<BanResult>;
}

/** 追放の要求にコンテンツが添えた補助情報 */
export interface BanRequestDetail {
    /**
     * コンテンツが申告した対象の表示名。申告が無ければ undefined。
     *
     * **実行基盤は検証していない値である。** 使ってよいのは確認 UI で操作者を
     * 補助する表示だけで、次を守ること。
     *
     * - 申告が無いとき、実行基盤が把握しているアカウント名で補わない。並べて出すのも同じ
     * - コンテンツの申告だと分かる形で出す（実行基盤が保証した名前に見せない）
     * - テキストとしてエスケープし、長さや制御文字の扱いは表示側で決める
     * - 権限判定・対象の特定・通知・記録の鍵には使わない
     *
     * WHY: 確認 UI にアカウント名を出すと、確認を出しては取りやめることを繰り返す
     * だけで、同意なく名前を知れてしまう。確認 UI には、要求したインスタンスが
     * すでに知っている情報だけを出す。
     */
    name?: string;
}

export class PlayerBanPlugin implements ExternalPluginLike {
    name: string = EXTERNAL_KEY;
    untrustedSignature: ObjectSignature = UNTRUSTED_SIGNATURE;
    _backend: PlayerBanBackend;

    constructor(backend: PlayerBanBackend) {
        this._backend = backend;
    }

    onload(game: { external: { [key: string]: unknown } }): void {
        game.external[EXTERNAL_KEY] = {
            ban: ({ playerId, name, callback }) => {
                // WHY: untrusted な実行基盤ではここがホスト側なので、コンテンツから
                // 来た値の形をここで揃えてから backend へ渡す
                this._request(
                    playerId,
                    { name: normalizeBanTargetName(name) },
                    callback,
                );
            },
        } satisfies PlayerBanExternal;
    }

    _request(
        playerId: string,
        detail: BanRequestDetail,
        callback: (result: BanResult) => void,
    ): void {
        this._backend.ban(playerId, detail).then(
            (result) => {
                callback(
                    result || {
                        ok: false,
                        playerId: playerId,
                        reason: "Unknown",
                    },
                );
            },
            () => {
                callback({
                    ok: false,
                    playerId: playerId,
                    reason: "Unknown",
                });
            },
        );
    }
}
