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
     * この画面のプレイヤー id。`createLocalInstance({ player: store.player })`
     * に渡される値なので、コンテンツから見た `g.game.selfId` と一致する。
     */
    const selfPlayerId = () => serve()?.store?.player?.id ?? null;

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

    // -------------------------------------------------- 追放中プレイヤーの共有

    /**
     * 誰が追放中かを serve のウィンドウ間で共有する。
     *
     * WHY: 本物の実行基盤はサーバー側に状態を持ち、コンテンツは playlog の通知で
     * 知る。しかしこのバックエンドは serve のページ上で動くだけで playlog を
     * 購読できず、別ウィンドウが発行した追放を知る手段がない。同一オリジンの
     * localStorage と storage イベントで代用する。**表示のためだけの仕組み**で、
     * 本物の実行基盤がこうすべきという話ではない。
     */
    const bannedKey = () =>
        `playerBanServe:banned:${currentPlayId() ?? "latest"}`;

    const readBanned = () => {
        try {
            const raw = localStorage.getItem(bannedKey());
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    };

    const markBanned = (playerId, banned) => {
        const ids = readBanned().filter((id) => id !== playerId);
        if (banned) {
            ids.push(playerId);
        }
        try {
            localStorage.setItem(bannedKey(), JSON.stringify(ids));
        } catch (e) {
            // 保存できなくても通知そのものは流れている。表示だけ諦める
        }
        // WHY: storage イベントは書いた本人には飛ばないので、自分の分は直接呼ぶ
        syncOverlay();
        syncPanel();
    };

    // ------------------------------------------------------ 追放中オーバーレイ

    let overlayNode = null;

    /**
     * この画面のプレイヤーが追放されているなら、ゲーム画面に半透明の膜をかける。
     *
     * serve は切断も再入室拒否もしないので、**これは表示だけ**。本物の実行基盤は
     * 閲覧もできない状態にする義務を負う（PROTOCOL.md 6.B）。
     */
    const syncOverlay = () => {
        const self = selfPlayerId();
        const shouldShow = !!self && readBanned().indexOf(self) !== -1;
        if (!shouldShow) {
            if (overlayNode) {
                overlayNode.remove();
                overlayNode = null;
            }
            return;
        }
        if (overlayNode) {
            return;
        }
        overlayNode = create(
            "div",
            {
                position: "absolute",
                top: "0",
                left: "0",
                width: "100%",
                height: "100%",
                display: "flex",
                flexFlow: "column nowrap",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                background: "rgba(0, 0, 0, 0.55)",
                fontFamily: "sans-serif",
                color: "#fff",
                textAlign: "center",
                pointerEvents: "none",
                zIndex: "4",
            },
            { className: "player-ban-overlay" },
        );
        overlayNode.append(
            create(
                "p",
                { margin: "0", fontSize: "22px", fontWeight: "bold" },
                { textContent: "BAN 中" },
            ),
            create(
                "p",
                { margin: "0", fontSize: "12px", opacity: "0.85" },
                {
                    textContent: `この画面のプレイヤー (${self}) は追放されています`,
                },
            ),
            create(
                "p",
                { margin: "0", fontSize: "11px", opacity: "0.7" },
                {
                    textContent:
                        "serve は表示のみ。実際の切断・再入室拒否は行いません",
                },
            ),
        );
        gameScreenElement().append(overlayNode);
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

    // ---------------------------------------------- 外部契機パネル（管理画面の代役）

    let panelNode = null;
    let panelListNode = null;
    let panelInputNode = null;

    const syncPanel = () => {
        if (!panelListNode) {
            return;
        }
        const ids = readBanned();
        panelListNode.textContent = ids.length
            ? `追放中: ${ids.join(", ")}`
            : "追放中: なし";
    };

    /**
     * コンテンツを介さずに追放・解除を起こすための小さな操作盤。
     *
     * WHY: 実行基盤は管理画面やチャット UI など、コンテンツの外でも同種の状態変化を
     * 起こしうる。そこで確定した変化も通知する義務がある（PROTOCOL.md 6.C）。
     * コンテンツはその通知を受けて追従できなければならないので、開発中に
     * 「外から起きた追放」を作れる口が要る。ここでの発行は確認ダイアログを通さず、
     * 発行権限も見ない。管理画面からの操作の模擬だから。
     */
    const buildPanel = () => {
        const root = create(
            "div",
            {
                position: "absolute",
                left: "8px",
                bottom: "8px",
                display: "flex",
                flexFlow: "column nowrap",
                gap: "6px",
                padding: "8px 10px",
                background: "rgba(255, 255, 255, 0.94)",
                border: "1px solid silver",
                borderRadius: "3px",
                boxShadow: "0 1px 6px rgba(0, 0, 0, 0.3)",
                fontFamily: "sans-serif",
                fontSize: "12px",
                color: "#333",
                zIndex: "6",
            },
            { className: "player-ban-external-panel" },
        );

        const title = create(
            "div",
            { fontWeight: "bold", fontSize: "11px", color: "#666" },
            { textContent: "外部契機（管理画面の代役）" },
        );

        panelInputNode = create(
            "input",
            {
                font: "inherit",
                fontSize: "12px",
                padding: "3px 6px",
                width: "150px",
                border: "1px solid #ccc",
                borderRadius: "2px",
            },
            { type: "text", placeholder: "playerId (例: pid2)" },
        );

        const row = create("div", { display: "flex", gap: "6px" });
        const banBtn = button("追放する", true);
        const unbanBtn = button("解除する", false);
        banBtn.className = "player-ban-external-ban";
        unbanBtn.className = "player-ban-external-unban";
        banBtn.addEventListener("click", () => {
            const id = panelInputNode.value.trim();
            if (id) {
                api.externalBan(id);
            }
        });
        unbanBtn.addEventListener("click", () => {
            const id = panelInputNode.value.trim();
            if (id) {
                api.unban(id);
            }
        });
        row.append(banBtn, unbanBtn);

        panelListNode = create(
            "div",
            { fontSize: "11px", color: "#666", maxWidth: "180px" },
            { textContent: "追放中: なし" },
        );

        root.append(title, panelInputNode, row, panelListNode);
        return root;
    };

    const togglePanel = (open) => {
        const shouldOpen = open == null ? !panelNode : open;
        if (!shouldOpen) {
            if (panelNode) {
                panelNode.remove();
                panelNode = null;
                panelListNode = null;
                panelInputNode = null;
            }
            return;
        }
        if (panelNode) {
            return;
        }
        panelNode = buildPanel();
        gameScreenElement().append(panelNode);
        syncPanel();
        if (selfPlayerId()) {
            panelInputNode.placeholder = `playerId (自分は ${selfPlayerId()})`;
        }
    };

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
            await notifyBanned(playerId);
            callback({ ok: true, playerId });
        } catch (e) {
            console.error("[playerBan/serve] ban failed", e);
            callback({ ok: false, playerId, reason: "InternalError" });
        }
    };

    /** 追放の通知を流し、表示用の状態にも反映する */
    const notifyBanned = async (playerId) => {
        await sendEvents([
            buildBanNotificationEvent("banned", playerId),
            // 実行基盤の契約「状態変化の実効化」の模擬。切断したことにする
            [EVENT_CODE_LEAVE, 0, playerId],
        ]);
        markBanned(playerId, true);
    };

    const notifyUnbanned = async (playerId) => {
        await sendEvents([buildBanNotificationEvent("unbanned", playerId)]);
        markBanned(playerId, false);
    };

    const api = {
        /** 確認 UI。差し替え可。null にすると確認なしで実行する */
        confirm: defaultConfirm,
        /**
         * コンテンツからの要求と同じ経路。発行権限を見て、確認 UI を挟む。
         * devtools コンソールから直接叩く用。
         */
        ban: (playerId) => request(playerId, (result) => console.log(result)),
        /**
         * 外部契機の追放。**コンテンツからは呼べない**（external に無い）。
         *
         * WHY: 管理画面やチャット UI で確定した追放も通知する義務がある
         * （PROTOCOL.md 6.C）。コンテンツがそれに追従できるかを試す口。
         * 発行権限も確認 UI も通さない。管理画面からの操作の模擬だから。
         */
        externalBan: (playerId) =>
            notifyBanned(playerId).then(
                () => console.log({ ok: true, playerId }),
                (e) => console.error("[playerBan/serve] externalBan failed", e),
            ),
        /**
         * 解除の通知を流す。**コンテンツからは呼べない**（external に無い）。
         *
         * WHY: 解除は実行基盤の管理画面の仕事で、拡張の API には無い。ただし
         * onPlayerUnbanned を書いたコンテンツはそれを試せないと困るので、
         * 「管理画面で解除された」状況を作る口をこちらに置く。
         */
        unban: (playerId) =>
            notifyUnbanned(playerId).then(
                () => console.log({ ok: true, playerId }),
                (e) => console.error("[playerBan/serve] unban failed", e),
            ),
        /** 外部契機パネルの開閉。引数省略でトグル */
        panel: (open) => togglePanel(open),
    };

    // WHY: require.resolve() ではなく誤って require() された場合に、
    // ここで ReferenceError を投げて serve を起動不能にしないようにする。
    if (typeof window !== "undefined") {
        window.playerBanServe = api;

        // 別ウィンドウが発行した追放・解除に追従する
        window.addEventListener("storage", (ev) => {
            if (ev.key === null || ev.key === bannedKey()) {
                syncOverlay();
                syncPanel();
            }
        });

        // ゲーム画面が組み上がるのを待ってから、状態を反映しハンドルを出す
        const boot = () => {
            if (!serve()) {
                window.setTimeout(boot, 300);
                return;
            }
            syncOverlay();
            const handle = button("外部契機", false);
            Object.assign(handle.style, {
                position: "absolute",
                left: "8px",
                bottom: "8px",
                fontSize: "11px",
                padding: "3px 10px",
                opacity: "0.75",
                zIndex: "6",
            });
            handle.className = "player-ban-external-handle";
            handle.addEventListener("click", () => {
                togglePanel();
                handle.style.display = panelNode ? "none" : "";
            });
            gameScreenElement().append(handle);
            // パネルを閉じたらハンドルを戻す
            const observer = window.setInterval(() => {
                if (!panelNode) {
                    handle.style.display = "";
                }
            }, 500);
            window.addEventListener("beforeunload", () =>
                window.clearInterval(observer),
            );
        };
        boot();
    }

    // external に生やすのは ban だけ。解除も、発行してよいかの問い合わせも置かない
    module.exports = () => ({
        ban: ({ playerId, callback }) => request(playerId, callback),
    });
})();
