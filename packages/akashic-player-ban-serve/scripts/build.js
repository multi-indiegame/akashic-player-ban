/*
 * src/index.ts → lib/index.js。
 *
 * WHY: akashic serve は client.external にパスを渡された 1 ファイルを、
 * module と exports しか無いスコープで評価する。require() が無いので、
 * 依存は全部バンドルで畳んでおかなければならない。
 *
 * WHY: format:"iife" + globalName で、出力は `var X = (() => { ... })();` になる。
 * akashic serve が要求する module.exports への代入は footer で行う。entry 側に
 * `module.exports = ...` と書くと esbuild がそのファイルを CommonJS と判定して
 * ラッパーで包み、`module` が akashic serve のものではなくラッパー内部のものを指してしまう。
 *
 * WHY: globalName の var は akashic serve が this ファイルを評価する関数スコープに閉じる
 * （akashic serve は module / exports を引数に取る関数として評価する）ので window は汚さない。
 *
 * WHY: charset:"utf8" が無いと日本語の文字列リテラルが \u エスケープに化ける。
 * この成果物はコピーして書き換える使い方を案内しているので、読める形で出す。
 */
const path = require("path");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");

esbuild
    .build({
        entryPoints: [path.join(root, "src", "index.ts")],
        outfile: path.join(root, "lib", "index.js"),
        bundle: true,
        format: "iife",
        globalName: "__playerBanServeModule",
        target: "es2018",
        charset: "utf8",
        legalComments: "none",
        banner: {
            js: "/* このファイルは src/index.ts から生成されています。直接編集しないこと（コピーして使うのは構いません）。 */",
        },
        footer: {
            js: "module.exports = __playerBanServeModule.default;",
        },
    })
    .catch(() => process.exit(1));
