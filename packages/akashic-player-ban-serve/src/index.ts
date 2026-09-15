/**
 * akashic serve 用の playerBan バックエンド。
 *
 * ゲーム開発者が sandbox.config.js の client.external から参照する。使い方は
 * このパッケージの README.md を見ること。
 *
 * WHY: 実行基盤向けの @multi-indiegame/akashic-player-ban-plugin とは形も読み手も
 * 違うので、パッケージを分けている。あちらは registerExternalPlugin() に渡す
 * クラスだが、akashic serve が要求するのは「external オブジェクトを返す関数」を
 * module.exports に持つ単一ファイルで、評価スコープには module と exports しか
 * 無く require() が使えない。そこでこのファイルは esbuild で lib/index.js へ
 * バンドルする（iife 形式・依存なし）。import で書いてよいのはバンドル後に
 * 消えるものだけで、プロトコル定数も共通 UI もそこから取り込む。
 * **手写しの定数は置かない。**
 *
 * WHY: akashic serve が要る `module.exports` への代入はここに書かない。書くと esbuild が
 * このファイルを CommonJS と判定してラッパーで包み、`module` が akashic serve のものでは
 * なくラッパー内部のものを指してしまう。default export にしておき、
 * 橋渡しは scripts/build.js の footer が受け持つ。
 */
import {
    buildBanNotificationEvent,
    normalizeBanTargetName,
    NotificationEvent,
} from "@multi-indiegame/akashic-player-ban/protocol";
import {
    button,
    create,
    getDock,
    DockHandle,
} from "@multi-indiegame/akashic-serve-extension-dock";

/** sandbox.config.js のうち、akashic-player-ban-serve が読む部分 */
interface SandboxConfigLike {
    playerBanServe?: { allow?: unknown } | null;
}

/** playlog に流す生イベント。要素数は種類ごとに違う */
type PlaylogEvent = NotificationEvent | unknown[];

/** akashic serve の joinedPlayerTable（mobx の ObservableMap）のうち、使う部分 */
interface PlayerTableLike {
    keys(): Iterable<string>;
}

interface ServeGlobals {
    store?: {
        /** 起動オプションの --target-service。nicolive は nicolive:multi に正規化されている */
        targetService?: string | null;
        currentPlay?: {
            playId?: number | null;
            content?: { sandboxConfig?: SandboxConfigLike | null } | null;
            joinedPlayerTable?: PlayerTableLike | null;
        } | null;
        player?: { id?: string | null } | null;
    } | null;
    gameViewManager?: { getRootElement?: () => HTMLElement | null } | null;
}

const serve = (): ServeGlobals | null => {
    const host = window as unknown as {
        akashicServe?: ServeGlobals;
        __testbed?: ServeGlobals;
    };
    return host.akashicServe ?? host.__testbed ?? null;
};

const currentPlayId = (): number | null =>
    serve()?.store?.currentPlay?.playId ?? null;

/**
 * この画面のプレイヤー id。`createLocalInstance({ player: store.player })`
 * に渡される値なので、コンテンツから見た `g.game.selfId` と一致する。
 */
const selfPlayerId = (): string | null => serve()?.store?.player?.id ?? null;

/**
 * WHY: 通知は playlog に載って全インスタンスへ配られなければならない。
 * g.game.raiseEvent() では playerId が自分のものになり、予約 playerId を
 * 名乗れない。akashic serve は debug 権限の AMFlow を叩く HTTP API を持つのでそれを使う。
 */
const sendEvents = async (events: PlaylogEvent[]): Promise<void> => {
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
        throw new Error(`akashic serve playlog API returned ${res.status}`);
    }
};

// ------------------------------------------------------------ 発行の可否

/**
 * 操作盤で選んだ、このウィンドウからの要求の扱い。
 * "default" は defaultIssue() の判定に任せる。
 */
type IssueSetting = "default" | "allow" | "deny";

/**
 * WHY: 誰に許すかは実行基盤の決めごとで、拡張ライブラリは関与しない
 * （PROTOCOL.md 6.1）。コンテンツ開発者は、いま試している実行基盤の方針に
 * 合わせて許可・禁止の両方の分岐を踏めなければならないので、固定の方針を
 * 押し付けず操作盤から切り替えられるようにする。設定はウィンドウ（playerId）
 * ごとで、リロードしても残るよう localStorage に置く。
 */
const issueSettingKey = (): string =>
    `playerBanServe:issue:${currentPlayId() ?? "latest"}:${selfPlayerId() ?? "self"}`;

/** localStorage が使えない環境でも、このページの間は設定を覚えておく */
let issueSettingInMemory: IssueSetting | null = null;

const readIssueSetting = (): IssueSetting => {
    if (issueSettingInMemory) {
        return issueSettingInMemory;
    }
    try {
        const value = localStorage.getItem(issueSettingKey());
        return value === "allow" || value === "deny" ? value : "default";
    } catch (e) {
        return "default";
    }
};

const writeIssueSetting = (setting: IssueSetting): void => {
    issueSettingInMemory = setting;
    try {
        if (setting === "default") {
            localStorage.removeItem(issueSettingKey());
        } else {
            localStorage.setItem(issueSettingKey(), setting);
        }
    } catch (e) {
        // 保存できなくてもこのページの間は効く
    }
    syncPanel();
};

/**
 * 実行基盤の許可モード。sandbox.config.js の playerBanServe.allow で選ぶ。
 *
 * - "all": 全員に許す
 * - "firstPlayer": 最初のユーザーだけに許す（既定）。--target-service nicolive なら
 *   放送者、それ以外ならこのプレイで最初に開いたウィンドウのユーザー
 *
 * WHY: 誰に許すかは実行基盤ごとに違うので、試したい実行基盤に近いモードを
 * コンテンツ側で選べるようにする。akashic serve は sandbox.config.js の未知の
 * キーも捨てずにクライアントへ渡すので、store から読める。要求のたびに読むので、
 * akashic serve が sandbox.config.js の変更を拾えばそれに追従する。
 */
type AllowMode = "all" | "firstPlayer";

const DEFAULT_ALLOW_MODE: AllowMode = "firstPlayer";

let warnedAboutAllowMode = false;

const allowMode = (): AllowMode => {
    const value =
        serve()?.store?.currentPlay?.content?.sandboxConfig?.playerBanServe
            ?.allow;
    if (value === "all" || value === "firstPlayer") {
        return value;
    }
    if (value !== undefined && !warnedAboutAllowMode) {
        warnedAboutAllowMode = true;
        console.warn(
            `[playerBan/serve] sandbox.config.js の playerBanServe.allow は "all" か "firstPlayer" のどちらか。"${String(value)}" は無視して "${DEFAULT_ALLOW_MODE}" として扱う`,
        );
    }
    return DEFAULT_ALLOW_MODE;
};

/**
 * --target-service nicolive で起動しているときの放送者の playerId。それ以外は null。
 *
 * WHY: 放送者だけに追放ボタンを出すコンテンツでは、ボタンが出るウィンドウと
 * 追放が許可されるウィンドウが一致していないと試せない。nicolive 系のモードでは、
 * プレイを作ったウィンドウのプレイヤーが放送者として Join する（akashic serve が
 * createPlay の initialJoinPlayer に自分の store.player を渡す）。akashic serve
 * 自身も「このウィンドウが放送者か」を currentPlay.joinedPlayerTable に自分の id が
 * あるかで判定しているので、それに揃える。表の全員を放送者とみなしてよいのは、
 * nicolive 系のモードでは akashic serve が「Join Me」を押せなくしており
 * （isJoinEnabled が targetService を見ている）、後から Join する経路が無いため。
 * nicolive 以外のモードでは、この表には「Join Me」で参加した人が入るだけで
 * 放送者の意味は無いので見ない。
 */
const broadcasterIds = (): string[] | null => {
    const store = serve()?.store;
    if (!/^nicolive/.test(store?.targetService ?? "")) {
        return null;
    }
    const table = store?.currentPlay?.joinedPlayerTable;
    if (!table || typeof table.keys !== "function") {
        return null;
    }
    const ids = Array.from(table.keys());
    return ids.length > 0 ? ids : null;
};

/**
 * このプレイで最初に akashic-player-ban-serve が読み込まれたウィンドウの playerId。
 * nicolive 以外のモードで「最初のユーザー」として使う。
 *
 * WHY: nicolive 以外のモードには放送者がいないので、ウィンドウを開いた順で決める。
 * akashic serve の playerId は再読み込みしても変わらないので、同一オリジンの
 * localStorage に最初の 1 人を覚えておけばよい。
 */
const firstPlayerKey = (): string =>
    `playerBanServe:firstPlayer:${currentPlayId() ?? "latest"}`;

/** localStorage が使えない環境でも、このページの間は覚えておく */
let firstPlayerInMemory: string | null = null;

const readFirstPlayer = (): string | null => {
    try {
        return localStorage.getItem(firstPlayerKey()) ?? firstPlayerInMemory;
    } catch (e) {
        return firstPlayerInMemory;
    }
};

/** まだ誰も名乗っていなければ、このウィンドウを最初のユーザーにする */
const claimFirstPlayer = (): void => {
    const self = selfPlayerId();
    if (!self || readFirstPlayer() != null) {
        return;
    }
    firstPlayerInMemory = self;
    try {
        localStorage.setItem(firstPlayerKey(), self);
    } catch (e) {
        // 保存できなくてもこのページの間は効く
    }
};

/** 操作盤で指定が無いときの判定と、その根拠 */
const defaultIssue = (): { allowed: boolean; because: string } => {
    const mode = allowMode();
    if (mode === "all") {
        return { allowed: true, because: "playerBanServe.allow: all" };
    }
    const self = selfPlayerId();
    const broadcasters = broadcasterIds();
    if (broadcasters) {
        return {
            allowed: self != null && broadcasters.indexOf(self) !== -1,
            because: `playerBanServe.allow: firstPlayer（放送者は ${broadcasters.join(", ")}）`,
        };
    }
    // WHY: 起動時に playerId がまだ決まっていなかった場合に備え、ここでも名乗る
    claimFirstPlayer();
    const first = readFirstPlayer();
    return {
        allowed: first == null || first === self,
        because: `playerBanServe.allow: firstPlayer（最初に開いたウィンドウは ${first ?? self ?? "不明"}）`,
    };
};

/** 追放を発行してよいインスタンスか。操作盤の設定 > sandbox.config.js のモードの順で決まる */
const canIssue = (): boolean => {
    const setting = readIssueSetting();
    return setting === "default" ? defaultIssue().allowed : setting === "allow";
};

// -------------------------------------------------- 追放中プレイヤーの共有

/**
 * 誰が追放中かを akashic serve のウィンドウ間で共有する。
 *
 * WHY: 本物の実行基盤はサーバー側に状態を持ち、コンテンツは playlog の通知で
 * 知る。しかしこのバックエンドは akashic serve のページ上で動くだけで playlog を
 * 購読できず、別ウィンドウが発行した追放を知る手段がない。同一オリジンの
 * localStorage と storage イベントで代用する。**表示のためだけの仕組み**で、
 * 本物の実行基盤がこうすべきという話ではない。
 */
const bannedKey = (): string =>
    `playerBanServe:banned:${currentPlayId() ?? "latest"}`;

const readBanned = (): string[] => {
    try {
        const raw = localStorage.getItem(bannedKey());
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
};

const markBanned = (playerId: string, banned: boolean): void => {
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

let overlayNode: HTMLElement | null = null;

/**
 * この画面のプレイヤーが追放されているなら、ゲーム画面に半透明の膜をかける。
 *
 * akashic serve は切断も再入室拒否もしないので、**これは表示だけ**。本物の実行基盤は
 * 閲覧もできない状態にする義務を負う（PROTOCOL.md 6.B）。
 */
const syncOverlay = (): void => {
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
            pointerEvents: "auto",
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
                    "akashic serve は表示のみ。実際の切断・再入室拒否は行いません",
            },
        ),
    );
    gameScreenElement().append(overlayNode);
};

// ------------------------------------------------------------ 確認 UI

/**
 * ゲーム画面と重なる要素を返す。
 *
 * WHY: akashic serve 組み込みの resolvePlayerInfo ダイアログは
 * .external-ref_div_game-content の兄弟として、position:relative な
 * game-screen の直下に置かれている。同じ場所に挿せば、ゲーム画面の
 * 寸法・位置・拡縮にそのまま追従する。
 */
const gameScreenElement = (): HTMLElement => {
    const root = serve()?.gameViewManager?.getRootElement?.();
    const content =
        root?.parentElement ??
        document.querySelector(".external-ref_div_game-content");
    return (content?.parentElement as HTMLElement | null) ?? document.body;
};

/**
 * 既定の確認ダイアログ。実行基盤が持つべき確認 UI の代役。
 * resolve(true) で続行、resolve(false) で reason:"UserCancel" になる。
 *
 * api.confirm に (param) => Promise<boolean> を代入すれば差し替えられる。
 * null を代入すれば確認なしで即時実行になる。
 *
 * WHY: 名前はコンテンツが申告したときだけ、申告だと分かる見出しを付けて出す。
 * 申告が無ければ playerId だけを出し、他の情報で補わない（本物の実行基盤が
 * アカウント名で補うと、確認を繰り返すだけで名前を知れてしまう）。
 */
const defaultConfirm = ({ playerId, name }: ConfirmParam): Promise<boolean> =>
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

        const nameBlock: HTMLElement[] = [];
        if (name) {
            const block = create("div", {
                display: "flex",
                flexFlow: "column nowrap",
                gap: "2px",
            });
            block.append(
                create(
                    "p",
                    { margin: "0", fontSize: "11px", color: "#888" },
                    { textContent: "ゲームが申告した名前" },
                ),
                create(
                    "p",
                    { margin: "0", fontSize: "15px", wordBreak: "break-all" },
                    { className: "player-ban-confirm-name", textContent: name },
                ),
            );
            nameBlock.push(block);
        }

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
            {
                className: "player-ban-confirm-player-id",
                textContent: playerId,
            },
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
                    "akashic serve が実行基盤の確認 UI を代行しています。" +
                    (name
                        ? "名前はゲームの申告で、実行基盤は確かめていません。"
                        : ""),
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

        const close = (result: boolean): void => {
            overlay.remove();
            document.removeEventListener("keydown", handleKeyDown, true);
            resolve(result);
        };

        const handleKeyDown = (ev: KeyboardEvent): void => {
            if (ev.key === "Escape") {
                ev.stopPropagation();
                close(false);
            }
        };

        cancel.addEventListener("click", () => close(false));
        accept.addEventListener("click", () => close(true));
        document.addEventListener("keydown", handleKeyDown, true);

        row.append(cancel, accept);
        card.append(title, ...nameBlock, idLine, note, row);
        overlay.append(card);
        gameScreenElement().append(overlay);
        accept.focus();
    });

// -------------------------------------- 「ゲーム外から操作」パネル（実行基盤の代役）

let panelListNode: HTMLElement | null = null;
let panelInputNode: HTMLInputElement | null = null;
let panelIssueNode: HTMLElement | null = null;
let panelHandle: DockHandle | null = null;

/**
 * 追放中の playerId ひとつぶん。押すとその場で解除する。
 *
 * WHY: 解除したい相手は必ずこの一覧に居る。id を目で読んで打ち直すのは
 * 写し間違いのもとなので、一覧そのものを解除の口にする。
 * playerId を打ち込む口も残してある（自動入力で動かすときに要る）。
 */
const bannedTag = (playerId: string): HTMLButtonElement => {
    const isSelf = playerId === selfPlayerId();
    /**
     * WHY: 省略は id の部分だけにかける。1 つの文字列のまま text-overflow を
     * かけると末尾から削られ、押せば解除になることを示す ✕ と「（自分）」が
     * 先に消えてしまう。一覧の幅を超える分だけ id を … にし、全体は title で読む。
     */
    const tag = create(
        "button",
        {
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            maxWidth: "100%",
            font: "inherit",
            fontSize: "12px",
            lineHeight: "1.5",
            padding: "1px 7px",
            cursor: "pointer",
            border: "1px solid #d9b3ae",
            borderRadius: "9px",
            background: "#fbecea",
            color: "#a0342a",
            whiteSpace: "nowrap",
        },
        {
            type: "button",
            className: "player-ban-external-banned-tag",
            title: `${playerId} の追放を解除する`,
        },
    );
    tag.append(
        create(
            "span",
            { minWidth: "0", overflow: "hidden", textOverflow: "ellipsis" },
            { textContent: playerId },
        ),
        ...(isSelf
            ? [create("span", { flexShrink: "0" }, { textContent: "（自分）" })]
            : []),
        create("span", { flexShrink: "0" }, { textContent: "✕" }),
    );
    tag.dataset.playerId = playerId;
    tag.addEventListener("click", () => api.unban(playerId));
    return tag;
};

/**
 * 発行可否の欄を描き直す。
 *
 * WHY: 「既定に従う」かどうかと「許可か禁止か」は別の問いなので、既定は
 * チェックボックスにし、外したときだけ許可・禁止を選べるようにする。
 * 既定がこの画面で許可か禁止かは開くまで分からないので、チェックボックスの
 * 括弧内にその画面での結果を書く。根拠（モードと最初のユーザー）は title に置く。
 * 既定に従っている間も、許可・禁止のボタンは押せない状態でいまの判定を示す。
 */
const syncIssueControl = (): void => {
    if (!panelIssueNode) {
        return;
    }
    const setting = readIssueSetting();
    const fallback = defaultIssue();
    const followsDefault = setting === "default";
    const allowed = canIssue();

    const defaultBox = create(
        "input",
        { margin: "0", cursor: "pointer" },
        {
            type: "checkbox",
            className: "player-ban-issue-default",
            checked: followsDefault,
        },
    );
    defaultBox.addEventListener("change", () => {
        // WHY: 外した直後は既定と同じ判定から始める。外しただけで挙動が変わらないように
        writeIssueSetting(
            defaultBox.checked
                ? "default"
                : fallback.allowed
                  ? "allow"
                  : "deny",
        );
    });
    const defaultLabel = create(
        "label",
        {
            display: "flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "14px",
            color: "#444",
            cursor: "pointer",
        },
        { title: fallback.because },
    );
    defaultLabel.append(
        defaultBox,
        create(
            "span",
            {},
            {
                textContent: `既定に従う（${fallback.allowed ? "許可" : "禁止"}）`,
            },
        ),
    );

    const options: [IssueSetting, string][] = [
        ["allow", "許可"],
        ["deny", "禁止"],
    ];
    const segments = create("div", {
        display: "flex",
        opacity: followsDefault ? "0.5" : "1",
    });
    options.forEach(([value, label], i) => {
        const selected = value === (allowed ? "allow" : "deny");
        const segment = create(
            "button",
            {
                font: "inherit",
                fontSize: "14px",
                lineHeight: "1.5",
                padding: "2px 12px",
                cursor: followsDefault ? "default" : "pointer",
                border: "1px solid #bbb",
                borderLeft: i === 0 ? "1px solid #bbb" : "none",
                borderRadius: i === 0 ? "4px 0 0 4px" : "0 4px 4px 0",
                background: selected ? "#555" : "#f4f4f4",
                color: selected ? "#fff" : "#444",
            },
            {
                type: "button",
                className: `player-ban-issue-${value}`,
                textContent: label,
                disabled: followsDefault,
            },
        );
        segment.setAttribute("aria-pressed", String(selected));
        segment.addEventListener("click", () => writeIssueSetting(value));
        segments.append(segment);
    });

    const verdict = create(
        "div",
        {
            fontSize: "12px",
            color: allowed ? "#2e7d32" : "#a0342a",
            // WHY: 文言でパネルが横に伸びないよう、幅の算出に口を出さない
            width: "0",
            minWidth: "100%",
        },
        {
            className: "player-ban-issue-verdict",
            textContent: allowed
                ? "→ 確認ダイアログを経て追放されます"
                : "→ Unauthorized を返します",
        },
    );

    panelIssueNode.textContent = "";
    panelIssueNode.append(
        create(
            "span",
            { fontSize: "12px", color: "#888" },
            {
                textContent: "banPlayer()時のルール:",
                title: "コンテンツからの追放要求を、実行基盤の代役として認めるか",
            },
        ),
        defaultLabel,
        segments,
        verdict,
    );
};

const syncPanel = (): void => {
    syncIssueControl();
    if (!panelListNode) {
        return;
    }
    const ids = readBanned();
    panelListNode.textContent = "";
    panelListNode.append(
        create(
            "span",
            { color: "#888" },
            {
                textContent: ids.length
                    ? "追放中（押すと解除）:"
                    : "追放中: なし",
            },
        ),
        ...ids.map(bannedTag),
    );
};

/**
 * コンテンツを介さずに追放・解除を起こすための小さな操作盤。
 *
 * WHY: 実行基盤は管理画面やチャット UI など、コンテンツの外でも同種の状態変化を
 * 起こしうる。そこで確定した変化も通知する義務がある（PROTOCOL.md 6.C）。
 * コンテンツはその通知を受けて追従できなければならないので、開発中に
 * 「ゲーム外から起きた追放」を作れる口が要る。ここでの発行は確認ダイアログを
 * 通さず、発行権限も見ない。実行基盤側の操作の模擬だから。
 *
 * 位置・開閉・見出し・閉じるボタンはドックが持つ。ここは中身だけ作る。
 */
const buildPanelBody = (): HTMLElement => {
    const body = create("div", {
        display: "flex",
        flexFlow: "column nowrap",
        gap: "8px",
    });

    panelInputNode = create(
        "input",
        {
            font: "inherit",
            fontSize: "14px",
            padding: "6px 6px",
            width: "150px",
            border: "1px solid #ccc",
            borderRadius: "2px",
        },
        { type: "text", placeholder: "playerId (例: pid2)" },
    );
    if (selfPlayerId()) {
        panelInputNode.placeholder = `playerId (自分は ${selfPlayerId()})`;
    }

    const row = create("div", { display: "flex", gap: "8px" });
    const banBtn = button("追放する", true);
    const unbanBtn = button("解除する", false);
    banBtn.className = "player-ban-external-ban";
    unbanBtn.className = "player-ban-external-unban";
    banBtn.addEventListener("click", () => {
        const id = panelInputNode?.value.trim();
        if (id) {
            api.externalBan(id);
        }
    });
    unbanBtn.addEventListener("click", () => {
        const id = panelInputNode?.value.trim();
        if (id) {
            api.unban(id);
        }
    });
    row.append(banBtn, unbanBtn);

    /**
     * WHY: 一覧の幅はパネルの他の中身（入力欄とボタン列）に合わせる。固定の
     * maxWidth だとパネルの右が空いていても折り返してしまい、外すとタグが
     * 増えるほどパネルが横に伸びる。width:0 で幅の算出に口を出さず、
     * minWidth:100% で決まった幅いっぱいまで広がる。
     */
    panelListNode = create(
        "div",
        {
            display: "flex",
            flexFlow: "row wrap",
            alignItems: "center",
            gap: "6px",
            fontSize: "12px",
            color: "#666",
            width: "0",
            minWidth: "100%",
        },
        { className: "player-ban-external-banned-list" },
    );

    /**
     * WHY: ここから上は「ゲーム外で起きた追放・解除」の模擬、ここから下は
     * 「コンテンツからの要求を実行基盤が認めるか」の設定。性質が違うので線で分ける。
     */
    panelIssueNode = create(
        "div",
        {
            display: "flex",
            flexFlow: "column nowrap",
            gap: "4px",
            paddingTop: "8px",
            borderTop: "1px solid #ddd",
        },
        { className: "player-ban-issue-setting" },
    );

    body.append(panelInputNode, row, panelListNode, panelIssueNode);
    syncPanel();
    return body;
};

/**
 * 縦タブを出してよいか。
 *
 * WHY: 常時出ている固定要素はコンテンツの動作確認の邪魔になることがある。
 * ウィンドウごとに切りたいので、sandbox.config.js ではなく URL クエリで切る。
 * 消しても window.playerBanServe.panel() で開く口は残る。
 * ?akashicServeDock=0 ならドックのタブごと消える。
 */
const tabEnabled = (): boolean => {
    const value = new URLSearchParams(window.location.search).get(
        "playerBanPanel",
    );
    return value == null || (value !== "0" && value !== "false");
};

// ------------------------------------------------------------ 本体

interface ConfirmParam {
    action: string;
    playerId: string;
    /** コンテンツが申告した表示名。申告が無ければ undefined */
    name?: string;
}

interface BanResultLike {
    ok: boolean;
    playerId: string;
    reason?: string;
}

const request = async (
    playerId: string,
    name: string | undefined,
    callback: (result: BanResultLike) => void,
): Promise<void> => {
    if (!canIssue()) {
        callback({ ok: false, playerId, reason: "Unauthorized" });
        return;
    }
    try {
        const accepted = api.confirm
            ? await api.confirm({ action: "banned", playerId, name })
            : true;
        if (!accepted) {
            callback({ ok: false, playerId, reason: "UserCancel" });
            return;
        }
        await notifyBanned(playerId);
        callback({ ok: true, playerId });
    } catch (e) {
        console.error("[playerBan/serve] ban failed", e);
        callback({ ok: false, playerId, reason: "Unknown" });
    }
};

/**
 * 追放の通知を流し、表示用の状態にも反映する。
 *
 * WHY: 流すのは通知だけ。「状態変化の実効化」（PROTOCOL.md 6.B）は本番の実行基盤で
 * 確かめる領分として、akashic serve では代行しない。
 */
const notifyBanned = async (playerId: string): Promise<void> => {
    await sendEvents([buildBanNotificationEvent("banned", playerId)]);
    markBanned(playerId, true);
};

const notifyUnbanned = async (playerId: string): Promise<void> => {
    await sendEvents([buildBanNotificationEvent("unbanned", playerId)]);
    markBanned(playerId, false);
};

const api = {
    /** 確認 UI。差し替え可。null にすると確認なしで実行する */
    confirm: defaultConfirm as
        ((param: ConfirmParam) => Promise<boolean>) | null,
    /**
     * コンテンツからの要求と同じ経路。発行権限を見て、確認 UI を挟む。
     * devtools コンソールから直接叩く用。name を渡すと、コンテンツが名前を
     * 申告したときと同じ確認 UI になる。
     */
    ban: (playerId: string, name?: string): void => {
        void request(playerId, normalizeBanTargetName(name), (result) =>
            console.log(result),
        );
    },
    /**
     * ゲーム外からの追放。**コンテンツからは呼べない**（external に無い）。
     *
     * WHY: 管理画面やチャット UI で確定した追放も通知する義務がある
     * （PROTOCOL.md 6.C）。コンテンツがそれに追従できるかを試す口。
     * 発行権限も確認 UI も通さない。実行基盤側の操作の模擬だから。
     */
    externalBan: (playerId: string): void => {
        void notifyBanned(playerId).then(
            () => console.log({ ok: true, playerId }),
            (e) => console.error("[playerBan/serve] externalBan failed", e),
        );
    },
    /**
     * 解除の通知を流す。**コンテンツからは呼べない**（external に無い）。
     *
     * WHY: 解除は実行基盤の管理画面の仕事で、拡張の API には無い。ただし
     * onPlayerUnbanned を書いたコンテンツはそれを試せないと困るので、
     * 「管理画面で解除された」状況を作る口をこちらに置く。
     */
    unban: (playerId: string): void => {
        void notifyUnbanned(playerId).then(
            () => console.log({ ok: true, playerId }),
            (e) => console.error("[playerBan/serve] unban failed", e),
        );
    },
    /**
     * このウィンドウからの追放要求（banPlayer）を認めるか。
     * true / false で固定し、null で既定（sandbox.config.js の
     * playerBanServe.allow に従う）に戻す。引数を省略すると、いまの判定を返すだけ。
     */
    allow: (allowed?: boolean | null): boolean => {
        if (allowed !== undefined) {
            writeIssueSetting(
                allowed == null ? "default" : allowed ? "allow" : "deny",
            );
        }
        return canIssue();
    },
    /** 「ゲーム外から操作」パネルの開閉。引数省略でトグル */
    panel: (open?: boolean): void => {
        if (!panelHandle) {
            return;
        }
        if (open == null) {
            panelHandle.toggle();
        } else if (open) {
            panelHandle.open();
        } else {
            panelHandle.close();
        }
    },
};

// WHY: require.resolve() ではなく誤って require() された場合に、
// ここで ReferenceError を投げて akashic serve を起動不能にしないようにする。
if (typeof window !== "undefined") {
    (window as unknown as { playerBanServe: unknown }).playerBanServe = api;

    // 別ウィンドウが発行した追放・解除や、最初のユーザーの決定に追従する
    window.addEventListener("storage", (ev) => {
        if (ev.key === null || ev.key === bannedKey()) {
            syncOverlay();
            syncPanel();
        } else if (ev.key === firstPlayerKey()) {
            syncPanel();
        }
    });

    // ゲーム画面が組み上がるのを待ってから、状態を反映しタブを出す
    const boot = (): void => {
        if (!serve()) {
            window.setTimeout(boot, 300);
            return;
        }
        claimFirstPlayer();
        syncOverlay();
        panelHandle = getDock().register({
            id: "player-ban",
            label: "ゲーム外からBAN",
            heading: "ゲーム外から追放操作（実行基盤の代役）",
            showTab: tabEnabled(),
            build: buildPanelBody,
            onClose: () => {
                panelListNode = null;
                panelInputNode = null;
                panelIssueNode = null;
            },
        });
    };
    boot();
}

// external に生やすのは ban だけ。解除も、発行してよいかの問い合わせも置かない
export default () => ({
    ban: ({
        playerId,
        name,
        callback,
    }: {
        playerId: string;
        name?: unknown;
        callback: (result: BanResultLike) => void;
    }) => request(playerId, normalizeBanTargetName(name), callback),
});
