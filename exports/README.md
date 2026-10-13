# Exports

机器生成产物放在此目录，不作为内容源文件。

M0B World Package 可通过 `npm run compile:world -- <manifest.json> <output.json>` 写入此目录。生成包带有确定性 `packageHash`，但仍应由发布流程保留对应清单、源 commit 和编译器版本。
