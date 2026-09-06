import {
    BanResult,
    EXTERNAL_KEY,
    PlayerBanExternal,
    PlayerBanExternalContext,
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
 */
export interface PlayerBanBackend {
    /** この視聴者が部屋主か。ローカル判定 */
    isGameMaster(): boolean;
    /** 追放を要求する */
    ban(playerId: string): Promise<BanResult>;
    /** 追放の解除を要求する */
    unban(playerId: string): Promise<BanResult>;
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
            getContext: ({ callback }) => {
                callback({
                    canBan: this._backend.isGameMaster(),
                } satisfies PlayerBanExternalContext);
            },
            ban: ({ playerId, callback }) => {
                this._request("ban", playerId, callback);
            },
            unban: ({ playerId, callback }) => {
                this._request("unban", playerId, callback);
            },
        } satisfies PlayerBanExternal;
    }

    _request(
        kind: "ban" | "unban",
        playerId: string,
        callback: (result: BanResult) => void,
    ): void {
        // WHY: 部屋主でないインスタンスはここで握り潰し、実行基盤へ投げない。
        // ただし実行基盤側でも発行元を再判定すること。コンテンツは同一オリジンで
        // 動くため、このプラグインを経由せずに直接叩ける（PROTOCOL.md §8）。
        if (!this._backend.isGameMaster()) {
            callback({
                ok: false,
                playerId: playerId,
                reason: "NotGameMaster",
            });
            return;
        }
        this._backend[kind](playerId).then(
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
