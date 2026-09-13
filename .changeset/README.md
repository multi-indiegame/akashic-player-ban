# Changesets

パッケージの version と CHANGELOG は [Changesets](https://changesets.dev) で管理します。

## 変更を入れる PR で

```sh
npx changeset
```

変更したパッケージと bump の種類（patch / minor / major）を選び、変更内容を書きます。
できた `.changeset/*.md` を PR に含めてください。利用者に影響しない変更（README のみ等）なら不要です。

本体（`@multi-indiegame/akashic-player-ban`）の major を出して依存側の範囲が外れる場合、
依存側は自動で patch になります。coe の peerDependencies のように、それが依存側にとっても
破壊的変更になるときは、依存側の bump も changeset で明示してください。

## リリース

main にマージされると GitHub Actions が「Version Packages」PR を作ります（以降のマージで更新され続けます）。
その PR をマージすると、npm に無い version のパッケージだけが publish され、
パッケージごとに `<パッケージ名>@<version>` のタグと GitHub Release が作られます。
