# Changesets

パッケージの version と CHANGELOG は [Changesets](https://changesets.dev) で管理します。

## 変更を入れる PR で

```sh
npx changeset
```

変更したパッケージと bump の種類（patch / minor / major）を選び、変更内容を書きます。
できた `.changeset/*.md` を PR に含めてください。

changeset が要るのは、npm に publish されるファイルが変わるときだけです。選ぶのも、中身が変わったパッケージだけにします。

- 要る: `src` の変更、`package.json` の依存や exports の変更、パッケージ内の README（tarball に含まれ npm のページに出る）の変更
- 要らない: CI や `.changeset` の設定、リポジトリ直下の README など、publish されるファイルが変わらない変更

本体（`@multi-indiegame/akashic-player-ban`）の major を出して依存側の範囲が外れる場合、
依存側は自動で patch になります。coe の peerDependencies のように、それが依存側にとっても
破壊的変更になるときは、依存側の bump も changeset で明示してください。

### serve は依存をバンドルしているので、自動では追従しません

`@multi-indiegame/akashic-player-ban-serve` は、本体の `protocol` と `@multi-indiegame/akashic-serve-extension-dock` を
`lib/index.js` にバンドルしています（akashic serve の評価環境に `require()` が無いため）。
依存は devDependencies なので Changesets は serve を bump せず、serve を出し直さない限り利用者には古い実装が届きます。

次のときは、**changeset に serve も含めてください。**

- 本体の `packages/akashic-player-ban/src/protocol.ts` を変えたとき
- `@multi-indiegame/akashic-serve-extension-dock` を更新したとき

## リリース

main にマージされると GitHub Actions が「Version Packages」PR を作ります（以降のマージで更新され続けます）。
その PR をマージすると、npm に無い version のパッケージだけが publish され、
パッケージごとに `<パッケージ名>@<version>` のタグと GitHub Release が作られます。
