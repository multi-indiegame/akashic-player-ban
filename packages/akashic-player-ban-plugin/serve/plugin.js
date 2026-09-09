/**
 * akashic-cli-serve 用の playerBan バックエンド。
 *
 * ゲーム開発者が sandbox.config.js の client.external から参照する。使い方は
 * docs/akashic-cli-serve.md を見ること。
 *
 * WHY: 実行基盤向けの lib/index.js（PlayerBanPlugin）とは形が違う。あちらは
 * registerExternalPlugin() に渡すクラスだが、akashic-cli-serve が要求するのは
 * 「external オブジェクトを返す関数」を module.exports に持つ単一ファイルで、
 * 評価スコープには module と exports しか無く require() が使えない。
 * したがってこのファイルは依存を持たず、プロトコル定数を自前で持つ。
 * protocol.ts を変えたらここも合わせること。
 */
(() => {
    const RESERVED_PLAYER_ID = ":multi-indiegame";
    const NOTIFICATION_TYPE = "@multi-indiegame/akashic-player-ban";
    const NOTIFICATION_VERSION = 1;
    const EVENT_CODE_MESSAGE = 32; // playlog.EventCode.Message
    const EVENT_CODE_LEAVE = 1; // playlog.EventCode.Leave

    const buildBanNotificationEvent = (action, playerId) => [
        EVENT_CODE_MESSAGE,
        0,
        RESERVED_PLAYER_ID,
        {
            action,
            playerId,
            type: NOTIFICATION_TYPE,
            version: NOTIFICATION_VERSION,
        },
    ];

    const serve = () => window.akashicServe || window.__testbed || null;

    const currentPlayId = () => serve()?.store?.currentPlay?.playId ?? null;

    /**
     * WHY: 通知は playlog に載って全インスタンスへ配られなければならない。
     * g.game.raiseEvent() では playerId が自分のものになり、予約 playerId を
     * 名乗れない。serve は debug 権限の AMFlow を叩く HTTP API を持つのでそれを使う。
     */
    const sendEvents = async (events) => {
        const playId = currentPlayId();
        const url =
            playId != null
                ? `/api/public/v1/plays/${playId}/playlog`
                : "/api/public/v1/plays/latest/playlog";
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ events }),
        });
        if (!res.ok) {
            throw new Error(`serve playlog API returned ${res.status}`);
        }
    };

    /**
     * 追放を発行してよいインスタンスか。
     *
     * WHY: 誰に許すかは実行基盤の決めごとで、拡張ライブラリは関与しない
     * （PROTOCOL.md 6.1）。serve には部屋主の概念が無いので、ここでは
     * 「親ウィンドウなら許す」を代役の方針にする。インスタンス追加で開いた
     * 子ウィンドウは URL に experimentalIsChildWindow=1 を持つ。
     * ?playerBanAllow=0 / =1 で明示的に上書きできる。
     */
    const canIssue = () => {
        const params = new URLSearchParams(window.location.search);
        const override = params.get("playerBanAllow");
        if (override != null) {
            return override !== "0" && override !== "false";
        }
        return params.get("experimentalIsChildWindow") !== "1";
    };

    // ------------------------------------------------------------ 確認 UI

    /**
     * ゲーム画面と重なる要素を返す。
     *
     * WHY: serve 組み込みの resolvePlayerInfo ダイアログは
     * .external-ref_div_game-content の兄弟として、position:relative な
     * game-screen の直下に置かれている。同じ場所に挿せば、ゲーム画面の
     * 寸法・位置・拡縮にそのまま追従する。
     */
    const gameScreenElement = () => {
        const root = serve()?.gameViewManager?.getRootElement();
        const content =
            root?.parentElement ??
            document.querySelector(".external-ref_div_game-content");
        return content?.parentElement ?? document.body;
    };

    const create = (tag, style, props = {}) => {
        const node = Object.assign(document.createElement(tag), props);
        Object.assign(node.style, style);
        return node;
    };

    const button = (label, primary) =>
        create(
            "button",
            {
                font: "inherit",
                fontSize: "13px",
                padding: "6px 18px",
                cursor: "pointer",
                borderRadius: "3px",
                border: primary ? "1px solid #a0342a" : "1px solid #bbb",
                background: primary ? "#c0392b" : "#f4f4f4",
                color: primary ? "#fff" : "#444",
            },
            { type: "button", textContent: label },
        );

    /**
     * 既定の確認ダイアログ。実行基盤が持つべき確認 UI の代役。
     * resolve(true) で続行、resolve(false) で reason:"Rejected" になる。
     *
     * api.confirm に (param) => Promise<boolean> を代入すれば差し替えられる。
     * null を代入すれば確認なしで即時実行になる。
     */
    const defaultConfirm = ({ playerId }) =>
        new Promise((resolve) => {
            const overlay = create(
                "div",
                {
                    position: "absolute",
                    top: "0",
                    left: "0",
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "rgba(0, 0, 0, 0.45)",
                    fontFamily: "sans-serif",
                    zIndex: "5",
                },
                { className: "player-ban-confirm-dialog" },
            );

            const card = create("div", {
                display: "flex",
                flexFlow: "column nowrap",
                gap: "14px",
                minWidth: "260px",
                maxWidth: "88%",
                padding: "18px 22px",
                background: "#fff",
                border: "1px solid silver",
                borderRadius: "2px",
                boxShadow: "0 1px 11px rgba(0, 0, 0, 0.35)",
                color: "#333",
            });

            const title = create(
                "p",
                {
                    margin: "0",
                    fontSize: "15px",
                    fontWeight: "bold",
                    lineHeight: "1.5",
                },
                { textContent: "このプレイヤーを追放しますか？" },
            );

            const idLine = create(
                "p",
                {
                    margin: "0",
                    padding: "6px 10px",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    background: "#f2f2f2",
                    border: "1px solid #e0e0e0",
                    borderRadius: "2px",
                    wordBreak: "break-all",
                },
                { textContent: playerId },
            );

            const note = create(
                "p",
                {
                    margin: "0",
                    fontSize: "11px",
                    color: "#888",
                    lineHeight: "1.6",
                },
                {
                    textContent:
                        "akashic-cli-serve が実行基盤の確認 UI を代行しています。",
                },
            );

            const row = create("div", {
                display: "flex",
                gap: "8px",
                justifyContent: "flex-end",
            });
            const cancel = button("やめる", false);
            const accept = button("追放する", true);
            cancel.className = "player-ban-confirm-cancel";
            accept.className = "player-ban-confirm-ok";

            const close = (result) => {
                overlay.remove();
                document.removeEventListener("keydown", handleKeyDown, true);
                resolve(result);
            };

            const handleKeyDown = (ev) => {
                if (ev.key === "Escape") {
                    ev.stopPropagation();
                    close(false);
                }
            };

            cancel.addEventListener("click", () => close(false));
            accept.addEventListener("click", () => close(true));
            document.addEventListener("keydown", handleKeyDown, true);

            row.append(cancel, accept);
            card.append(title, idLine, note, row);
            overlay.append(card);
            gameScreenElement().append(overlay);
            accept.focus();
        });

    // ------------------------------------------------------------ 本体

    const request = async (playerId, callback) => {
        if (!canIssue()) {
            callback({ ok: false, playerId, reason: "Unauthorized" });
            return;
        }
        try {
            const accepted = api.confirm
                ? await api.confirm({ action: "banned", playerId })
                : true;
            if (!accepted) {
                callback({ ok: false, playerId, reason: "Rejected" });
                return;
            }
            await sendEvents([
                buildBanNotificationEvent("banned", playerId),
                // 実行基盤の契約「状態変化の実効化」の模擬。切断したことにする
                [EVENT_CODE_LEAVE, 0, playerId],
            ]);
            callback({ ok: true, playerId });
        } catch (e) {
            console.error("[playerBan/serve] ban failed", e);
            callback({ ok: false, playerId, reason: "InternalError" });
        }
    };

    const api = {
        /** 確認 UI。差し替え可。null にすると確認なしで実行する */
        confirm: defaultConfirm,
        /** devtools コンソールから直接叩く用 */
        ban: (playerId) => request(playerId, (result) => console.log(result)),
        /**
         * 解除の通知だけを流す。**コンテンツからは呼べない**（external に無い）。
         *
         * WHY: 解除は実行基盤の管理画面の仕事で、拡張の API には無い。ただし
         * onPlayerUnbanned を書いたコンテンツはそれを試せないと困るので、
         * 「管理画面で解除された」状況を作る口を devtools 側にだけ置く。
         */
        unban: (playerId) =>
            sendEvents([buildBanNotificationEvent("unbanned", playerId)]).then(
                () => console.log({ ok: true, playerId }),
                (e) => console.error("[playerBan/serve] unban failed", e),
            ),
    };

    // WHY: require.resolve() ではなく誤って require() された場合に、
    // ここで ReferenceError を投げて serve を起動不能にしないようにする。
    if (typeof window !== "undefined") {
        window.playerBanServe = api;
    }

    // external に生やすのは ban だけ。解除も、発行してよいかの問い合わせも置かない
    module.exports = () => ({
        ban: ({ playerId, callback }) => request(playerId, callback),
    });
})();
