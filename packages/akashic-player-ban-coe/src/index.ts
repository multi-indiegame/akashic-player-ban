import {
    PlayerBanNotificationPayload,
    RESERVED_PLAYER_ID,
    acceptBanNotification,
    decodeBanNotification,
    markNotificationBridgeInstalled,
} from "@multi-indiegame/akashic-player-ban";

/*
 * coe は届いた g.MessageEvent をすべて Controller のアクションへ変換し、
 * tick に載せない（coe の Scene の JSDoc にも「本シーンを利用した場合、
 * すべての g.MessageEvent がフレームワーク側で握りつぶされる」とある）。
 * そのため拡張ライブラリの onPlayerBanned は coe コンテンツでは発火しない。
 *
 * coe で全インスタンスへ届く経路は Controller の broadcast() だけなので、
 * このアダプタが次の 2 つを担う。
 *
 *   送信: アクションとして届いた通知を検証し、そのまま broadcast する
 *   受信: コマンドとして届いた通知を拡張ライブラリの状態へ取り込む
 *
 * WHY: coe そのものには依存しない。依存すると利用側と coe の版を揃える必要が
 * 出るうえ、このアダプタが使うのは Trigger と broadcast() という形だけである。
 * 型ではなく形（構造）で受ける。
 */

/** このアダプタが使う Controller の形。coe の COEController が満たす。 */
export interface CoeControllerLike {
    onActionReceive: {
        add(handler: (action: CoeActionLike) => void): void;
    };
    broadcast(data: unknown, priority?: number): void;
}

/** このアダプタが使う Action の形。 */
export interface CoeActionLike {
    player?: { id?: string } | null;
    data?: unknown;
}

interface CommandTriggerLike {
    add(handler: (command: unknown) => void): void;
    contains(handler: (command: unknown) => void): boolean;
}

let _controllerAttached = false;

/**
 * 受け取ったコマンドが追放通知か判定する。
 *
 * コンテンツのコマンド dispatch が未知の型を受け取ると困る場合、これで
 * 早期リターンする。アダプタは別途自分で受け取っているので、ここで弾いても
 * 通知は失われない。
 *
 * ```ts
 * scene.onCommandReceive.add((command) => {
 *   if (isBanCommand(command)) return;
 *   dispatch(command);
 * });
 * ```
 */
export function isBanCommand(command: unknown): boolean {
    return decodeCommand(command) !== null;
}

/**
 * Controller に送信側の橋渡しを仕込む。
 *
 * **Scene を作る前に、一度だけ呼ぶこと。**
 *
 * ```ts
 * const controller = new MyController();
 * attachCoeController(controller);
 * const scene = new coe.Scene({ game: g.game, controller, assetPaths });
 * ```
 *
 * WHY: Controller を継承させるのではなく、インスタンスを受け取って
 * onActionReceive に足すだけにしてある。coe.Scene に渡せる Controller は
 * 1 つだけなので、継承を要求すると同じことをする他の拡張と衝突する。
 * onActionReceive は Trigger なので、複数の拡張が共存できる。
 *
 * WHY: Scene の _controller は protected かつ「ゲーム開発者は参照しては
 * ならない」と明記されているため、アダプタからは掘らない。Controller だけは
 * コンテンツから渡してもらう。
 */
export function attachCoeController(controller: CoeControllerLike): void {
    if (_controllerAttached) {
        return;
    }
    _controllerAttached = true;

    controller.onActionReceive.add((action) => {
        // 予約 playerId を名乗れるのは実行基盤だけ。ここが偽装の防波堤になる。
        //
        // NOTE: onActionReceive はアクティブインスタンスでしか発火しないので、
        // 検証もそこで一度だけ行われる。broadcast() は playerId を落とすため、
        // 受信側では検証できない。broadcast できるのは Controller だけなので
        // 抜け道にはならないが、MessageEvent 経路（全インスタンスが各自で
        // 検証する）とは信頼モデルが違う点に注意。
        const payload = decodeBanNotification(
            action && action.player ? action.player.id : null,
            action ? action.data : null,
        );
        if (!payload) {
            return;
        }

        // WHY: payload をそのまま流す。type が名前空間付きの文字列なので、
        // コンテンツ自身のコマンドとは衝突しない。新しいスキーマは要らない。
        controller.broadcast(payload);
    });
}

/**
 * WHY: 送信側だけ仕込んで受信側を忘れる、という壊れ方をさせない。受信側は
 * Scene の乗り換えに追従して自動で購読する。拡張ライブラリが onMessage に
 * 対してやっているのと同じ扱いである。
 */
function handleCommand(command: unknown): void {
    const payload = decodeCommand(command);
    if (!payload) {
        return;
    }
    acceptBanNotification(payload);
}

/**
 * WHY: broadcast() は playerId を落とすので、受信側では発行者を確認できない。
 * 予約 playerId を渡して payload の形だけを検証する。検証済みであることは
 * 送信側（アクティブインスタンスの Controller）が保証している。
 */
function decodeCommand(command: unknown): PlayerBanNotificationPayload | null {
    return decodeBanNotification(RESERVED_PLAYER_ID, command);
}

function attachToScene(scene: g.Scene | undefined): void {
    if (!scene) {
        return;
    }
    const trigger = (scene as unknown as { onCommandReceive?: unknown })
        .onCommandReceive as CommandTriggerLike | undefined;
    if (!trigger || typeof trigger.add !== "function") {
        return;
    }
    if (trigger.contains(handleCommand)) {
        return;
    }
    trigger.add(handleCommand);
}

markNotificationBridgeInstalled();
g.game.onSceneChange.add(attachToScene);
attachToScene(g.game.scene());
