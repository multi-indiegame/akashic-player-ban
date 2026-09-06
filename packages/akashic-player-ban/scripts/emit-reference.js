/*
 * WHY: tsc は g のグローバル参照を .d.ts に持ち出さない。参照ディレクティブが無いと、
 * g の型をグローバルに持たない環境で lib/index.d.ts が解決できなくなる。
 */
const fs = require("fs");
const path = require("path");

const target = path.join(__dirname, "..", "lib", "index.d.ts");
const directive =
    '/// <reference types="@akashic/akashic-engine/index.runtime" />';
const source = fs.readFileSync(target, "utf8");

if (!source.startsWith(directive)) {
    fs.writeFileSync(target, directive + "\n" + source);
}
