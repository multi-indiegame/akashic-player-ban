import {
    BanResult,
    EXTERNAL_KEY,
    PlayerBanExternal,
    UNTRUSTED_SIGNATURE,
    ObjectSignature,
} from "@multi-indiegame/akashic-player-ban/protocol";

export {
    BanResult,
    BanResultReason,
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
 * WHY: `registerExternalPlugin()` は duck typing で、公式の @akashic/agvw は
 * minify 済みで .d.ts すら配っていない。実行基盤の型を import すると依存が生えるので、
 * 構造だけをここで自前定義する。agvw / agvw-like のどちらに登録しても構造的に通る。
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
 * **誰が BAN を発行してよいかはこの実装が決める。** 判定は必ずサーバー側で行い、
 * 認めない要求には reason:"Unauthorized" を返すこと。クライアント側で先に握り潰す
 * 実装を足しても構わないが、それは通信を減らすための最適化であって防御ではない
 * （コンテンツは実行基盤と同一オリジンで動くことがあり、このプラグインを経由せず
 * API を直接叩ける）。
 */
export interface PlayerBanBackend {
    /** BAN を要求する */
    ban(playerId: string): Promise<BanResult>;
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
            ban: ({ playerId, callback }) => {
                this._request(playerId, callback);
            },
        } satisfies PlayerBanExternal;
    }

    _request(playerId: string, callback: (result: BanResult) => void): void {
        this._backend.ban(playerId).then(
            (result) => {
                callback(
                    result || {
                        ok: false,
                        playerId: playerId,
                        reason: "InternalError",
                    },
                );
            },
            () => {
                callback({
                    ok: false,
                    playerId: playerId,
                    reason: "InternalError",
                });
            },
        );
    }
}
