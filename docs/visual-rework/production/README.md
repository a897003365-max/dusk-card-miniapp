# 纸灵驿使生产素材

本目录保存已确认“纸灵驿使”方向的母稿、提示词、派生图和接入前历史备份。当前清单共80项，包括22位伙伴的44张运行PNG、24张敌人PNG、三地区9张战场层和3张主包地区封面；文件映射以 [assets/battle/manifest.js](../../../assets/battle/manifest.js) 为准，逐文件字节清单见 [current-files.json](current-files.json)。

## 目录与应用位置

| 内容 | 母稿与提示词 | 高清透明派生 | 压缩派生 | 应用读取位置 |
| --- | --- | --- | --- | --- |
| 伙伴 | [masters/](masters/)、[prompts/](prompts/)；三位旧样板母稿在 `../pilots/` | [rgba/](rgba/) | [runtime/](runtime/) | `assets/partners/` |
| 敌人 | [enemy-masters/](enemy-masters/)、[enemy-prompts/](enemy-prompts/)；纸团/小蛾母稿在 `../pilots/` | [enemy-rgba/](enemy-rgba/) | [enemy-runtime/](enemy-runtime/) | 所属 `package-<region>/assets/art/` |
| 旧桥、灯市场景 | [scenes/](scenes/)、[scenes/prompts/](scenes/prompts/) | 构建临时目录内检查 | [scene-runtime/](scene-runtime/) | 对应地区 `package-<region>/assets/art/` |
| 邮街场景 | `../pilots/street-back-master.png`、`street-middle-composed.png`、`street-front-composed.png` | 历史合成稿 | [../pilots/runtime/](../pilots/runtime/) 中的 `street-*` | `package-street/assets/art/` |
| 大厅地区封面 | 当前已接入的三个 `package-<region>/assets/art/<region>-back.jpg` | 不需要透明派生 | [cover-runtime/](cover-runtime/) | 主包 `assets/scenes/<region>-cover.jpg` |

伙伴运行文件名是 `<id>.png` 和 `<id>-cast.png`，最长边分别为 **384** 与 **224**。图像保留各自宽高比，不应将横图按“高度384”解释。敌人及独立 `-phase2` 图最长边为 **384**；21种基础敌人加纸狮、墨潮桥灵、铜铃雾守的第二阶段，共24张。战场三层均为 **1024×1024**，背景为不透明JPEG，中景和前景为带alpha的PNG；大厅封面则为 **320×320、JPEG质量50**。

`scene-runtime/` 只有旧桥、灯市的6个文件。邮街继续使用已保留的历史三层运行图，因此不能将这个目录的数量误记为全项目场景总数。`cover-runtime/` 另存3张主包封面，不计入9张战场层。

## 主包封面与分包战场

大厅通过 `manifest.scenes[region].cover` 读取主包 `assets/scenes/`，用于首次打开应用时显示地区封面。完整战场通过 `background`、`middle`、`front` 读取对应分包的三层图。封面保留背景原构图，不承担战场背景或中/前景的用途；分包的1024背景保持不变。

当前三个封面的实际字节为 `street-cover.jpg` 23746、`bridge-cover.jpg` 21129、`market-cover.jpg` 21354，合计 **66229字节（约64.68 KiB）**。`current-files.json` 每地区的 `layers.cover` 记录这个主包路径，另外三个字段仍记录战场三层。

## 母稿来源

母稿使用内置 imagegen 生成；提示词、修订词和选定PNG已存于本项目。FFmpeg、sips、pngquant和Swift检查器只负责本机派生，不生成新的角色或读取玩家存档。

- 三位伙伴待机分别读取 `../pilots/paper-sheep-v5-transparent.png`、`paper-orangecat-v5-transparent.png`、`paper-nav-v3-transparent.png`；施招读取 `paper-<id>-cast-keyed.png`。这些文件已有真实alpha。
- 其余19位读取 `masters/<id>-{idle,cast}-key.png`。doudou施招的当前规范文件已使用v3修订，右下为绿色护架；早期v1/v2母稿以 `rejected` 文件名保留。
- 纸团和小蛾读取 `../pilots/paper-ball-v3-transparent.png`、`stamp-moth-v2-transparent.png`。其余敌人读取 `enemy-masters/<enemy-id>-key.png`，第二阶段ID带 `-phase2`。
- 旧桥和灯市读取 `scenes/<region>-back-master.png` 及 `<region>-{middle,front}-key.png`。原稿1254×1254，叠加母稿使用近洋红底，留空中心与边角位置；生成背景可有少量RGB波动，不能按精确单色像素替换处理。
- 大厅封面从当前已接入分包的 `background` 派生，继承同一场景的图像来源，没有另行生成或改画。

完整来源及历史11文件账目见 [ASSET_LEDGER.md](../ASSET_LEDGER.md)。

## 本机复建

以下命令在项目根目录执行。工具需已在本机可用：Node、`/opt/homebrew/bin/ffmpeg`、`/opt/homebrew/bin/pngquant`、系统 `sips` 和可编译Swift的 `xcrun`。脚本不会安装工具。

```sh
node scripts/build-partner-art.js --idle-size=384 --cast-size=224
node scripts/build-partner-art.js --enemies --enemy-size=384
node scripts/build-scene-art.js
```

[build-partner-art.js](../../../scripts/build-partner-art.js) 不传ID时处理全部伙伴；加 `--enemies` 后处理全部敌人及首领阶段。也可只复建选定素材：

```sh
node scripts/build-partner-art.js ramen firefly soup
node scripts/build-partner-art.js --enemies paper-lion paper-lion-phase2
```

它先验证全部所选ID和输入文件，缺少母稿直接报错。所选产物在系统临时目录全部通过检查后，才替换 `rgba/`、`runtime/` 或对应的敌人派生目录；不覆盖键色母稿。终端会输出临时 `report.json` 路径，内含来源、尺寸、字节、alpha、边界、逐轮边缘清理和局部孔隙清理计数。

[build-scene-art.js](../../../scripts/build-scene-art.js) 只复建旧桥和灯市。背景缩至1024并以JPEG质量82输出；叠加层保持整张画布，经色键、边缘清理、1024缩放和PNG量化输出。不能对场景使用角色的内容裁切，否则两角物件会移位。当前脚本没有重建邮街历史三层的步骤，邮街使用上表保留文件。

场景更新后，**先检查并同步完整三层到分包，再复建大厅封面**。封面脚本读取的是manifest中已接入的 `background`，不是 `scene-runtime/` 内可能尚未同步的候选：

```sh
cp docs/visual-rework/pilots/runtime/street-* package-street/assets/art/
cp docs/visual-rework/production/scene-runtime/bridge-* package-bridge/assets/art/
cp docs/visual-rework/production/scene-runtime/market-* package-market/assets/art/
node scripts/build-cover-art.js
```

[build-cover-art.js](../../../scripts/build-cover-art.js) 用sips将三张背景等比缩至320，先输出无损PNG中间稿，再转JPEG质量50，结果存入 `cover-runtime/`，报告写入系统临时目录。脚本在三个封面合计超过70000字节时停止；这个局部上限不能替代整包预算检查。检查封面后再同步主包文件：

```sh
cp docs/visual-rework/production/cover-runtime/*-cover.jpg assets/scenes/
```

## Alpha处理与检查

新键色母稿的基础过滤器是 `colorkey=0xFF00FF:0.20:0,format=rgba`。新母稿主体不能使用洋红，以免与背景冲突；三位伙伴和两种敌人的已透明样板不走这段色键及边缘清理。

键色之后最多清理两轮。每轮只清除与该轮开始时alpha为0的像素四邻接、同时符合高饱和洋红条件的像素；按旧alpha快照判断，避免一轮连续向主体内洪泛。保留像素的RGB不作全局去红、去蓝或去色处理。

伙伴和敌人随后读取真实非透明边界，裁切到完整内容，四边各加内容宽/高5%的透明留白，并把完全透明像素的RGB归零。已知漏勺、绳孔和敌人细线孔隙由脚本的 `cleanKnownHoles` 在归一化局部区域内清理，计数为 `keyHolePixels`。这些区域跟随当前母稿，换稿后应重新目视定位，不能盲目沿用或扩大到全图。

运行PNG统一经过 `sips` 等比缩放和 `pngquant --quality=0-95 --speed 1 --strip`。脚本编译 [check-sprite-alpha.swift](../../../scripts/check-sprite-alpha.swift)，检查实际透明像素、可见内容和边界。alpha检查通过只能证明像素条件，不能证明纸边、孔洞、手形或细小色边的视觉质量；复建后仍需在明暗底检查对应局部。

## 同步与验证范围

复建脚本只更新本目录的派生图。检查满意后，按 [manifest.js](../../../assets/battle/manifest.js) 将伙伴复制到 `assets/partners/`，敌人按地区复制到对应分包，战场三层按地区和层名复制；邮街场景从 `../pilots/runtime/` 取文件。完整场景同步完成后再生成并同步主包封面，避免大厅封面来自旧背景。同步后核对目标文件与派生文件的字节一致性，并更新 [current-files.json](current-files.json) 的80项文件记录。

项目现有检查命令为：

```sh
npm test
node scripts/check-package-budget.js
```

涉及WXSS时另按项目规则运行原生编译。图片及文件清单接入不代表所有CLI页面、战斗阶段或设备尺寸通过；原生交互验收需要在获准的隔离副本中进行，真机结果需独立记录。当前已验证与未验证范围以 [STATUS.md](../STATUS.md) 和对应验收报告为准。

## 历史保留

旧 `assets/prizes/` 的88张稀有度图仍在磁盘；[project.config.json](../../../project.config.json) 已把该目录排除出打包，默认伙伴引用改为 `assets/partners/`。`docs/` 也被打包忽略，因此母稿、提示词及历史版本不会作为运行资源一起进入主包。

`masters/*-rejected-*.png`、`enemy-masters/*-rejected-*.png` 和 `../pilots/` 的旧候选保留供追溯。构建脚本只按规范文件名读取选定母稿，不自动回退到这些候选。[source-before-integration/](source-before-integration/) 是接入前源码快照；使用它恢复文件前须另行核对当前改动，不能直接覆盖工作区。
