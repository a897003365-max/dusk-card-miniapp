# 形象重构素材记录 · 2026-09-09

[查看22位待机素材总览](production/previews/paper-couriers-22-overview.png) · [查看三地区分层合成](production/previews/three-regions-layer-composite.png)（静态素材展示，非游戏实机截图）

## 当前生产接入

用户已确认“纸灵驿使”。当前 [运行素材映射](../../assets/battle/manifest.js) 的 `style` 为 `paper-courier`，默认应用已引用全22位伙伴、三地区敌人与场景。逐文件路径和字节记录见 [current-files.json](production/current-files.json)，复建及同步说明见 [production/README.md](production/README.md)。

以下为本次按磁盘文件核验的快照。清单共80个文件项，即原77项角色/战场素材加3张主包封面；文件均存在、字节记录吻合，应用文件与对应生产派生文件字节一致，邮街场景与历史 `pilots/runtime/` 一致。文件核验不代表全部页面CLI或真机验收。

| 类型 | 当前数量与尺寸 | 应用读取位置 | 派生文件位置 | 文件合计字节 |
| --- | --- | --- | --- | ---: |
| 伙伴 | 22待机 + 22施招；最长边分别384 / 224 | `assets/partners/<id>.png`、`<id>-cast.png` | [production/runtime/](production/runtime/) | 1126453 |
| 敌人 | 21种基础敌人 + 3首领第二阶段；24张PNG，最长边384 | `package-<region>/assets/art/<enemy-id>.png` | [production/enemy-runtime/](production/enemy-runtime/) | 1164079 |
| 地区场景 | 3地区 × 远/中/前3层；3张JPEG + 6张PNG，均1024×1024 | `package-<region>/assets/art/<region>-{back,middle,front}` | 邮街 [pilots/runtime/](pilots/runtime/)；其余 [production/scene-runtime/](production/scene-runtime/) | 1558728 |
| 大厅地区封面 | 3张320×320 JPEG，质量50 | `assets/scenes/<region>-cover.jpg` | [production/cover-runtime/](production/cover-runtime/) | 66229 |

尺寸为最长边或画布尺寸，不是角色在界面中的CSS显示尺寸。伙伴按家族复用待机图，并保留独立施招图；这44张不等于重新绘制88张稀有度专属PNG。

大厅读取 `manifest.scenes[region].cover` 的主包封面，使冷启动展示地区图时不依赖战场分包背景。战场继续读取 `background`、`middle`、`front`，三层完整素材仍放在对应分包，1024背景未被320封面替换。封面继承原背景完整构图，仅作本机缩放压缩。

| 地区 | 主包封面 | 实际字节 |
| --- | --- | ---: |
| 黄昏邮街 | [street-cover.jpg](../../assets/scenes/street-cover.jpg) | 23746 |
| 雨巷旧桥 | [bridge-cover.jpg](../../assets/scenes/bridge-cover.jpg) | 21129 |
| 夜行灯市 | [market-cover.jpg](../../assets/scenes/market-cover.jpg) | 21354 |

封面合计66229字节（约64.68 KiB），应用文件与 `production/cover-runtime/` 的对应文件一致。先同步完整场景到分包，再运行 [build-cover-art.js](../../scripts/build-cover-art.js)，最后检查并同步封面到主包；完整顺序见 [复建说明](production/README.md)。

| 地区 | 7种基础敌人ID | 独立第二阶段图 |
| --- | --- | --- |
| 黄昏邮街 `street` | paper-ball、stamp-moth、twine-sprite、wax-drop、postbag-guard、stamp-press、paper-lion | paper-lion-phase2 |
| 雨巷旧桥 `bridge` | ink-puddle、tile-sprite、rain-knot、reed-shadow、umbrella-spirit、bridge-drum、ink-tide | ink-tide-phase2 |
| 夜行灯市 `market` | lantern-mote、bell-sprite、paper-mask、silk-tail、lantern-rack、market-usher、bell-warden | bell-warden-phase2 |

## 当前来源与母稿

母稿由内置 imagegen 生成，提示词与选定PNG保存在项目内；本机FFmpeg、sips、pngquant和Swift检查器负责派生。素材声明描述本项目的制作来源，不以生成或alpha检查代替人工视觉审查。

| 素材 | 当前读取的母稿 | 提示词与历史 |
| --- | --- | --- |
| 羊、橘猫、小鸭待机 | `pilots/paper-sheep-v5-transparent.png`、`paper-orangecat-v5-transparent.png`、`paper-nav-v3-transparent.png` | [样板说明](pilots/README.md)及 `pilots/*-prompt.txt` |
| 上述三位施招 | `pilots/paper-<id>-cast-keyed.png`，已有真实alpha | 原始绿底与早期候选保留在 `pilots/` |
| 其余19位的38张姿态母稿 | `production/masters/<id>-{idle,cast}-key.png` | [伙伴提示词](production/prompts/)；doudou施招当前母稿已使用v3修订，v1/v2以 `rejected` 文件名保留 |
| 迷途纸团、邮戳小蛾 | `pilots/paper-ball-v3-transparent.png`、`stamp-moth-v2-transparent.png` | 已有透明样板母稿 |
| 其余敌人及首领阶段 | `production/enemy-masters/<enemy-id>-key.png` | [敌人提示词](production/enemy-prompts/)；market-usher首稿以 `rejected-v1` 保留 |
| 黄昏邮街三层 | `pilots/street-back-master.png`、`street-middle-composed.png`、`street-front-composed.png` | 历史三层运行图仍用于邮街；未混用其他旧候选 |
| 旧桥、灯市各三层 | `production/scenes/<region>-back-master.png`、`<region>-middle-key.png`、`<region>-front-key.png` | [场景提示词与修订版](production/scenes/prompts/) |
| 大厅地区封面 | 当前已接入的 `package-<region>/assets/art/<region>-back.jpg` | [build-cover-art.js](../../scripts/build-cover-art.js) 本机派生，沿用原场景来源；没有新增图像生成母稿 |

新键色母稿采用近洋红背景，主体禁用洋红。当前派生先使用 `colorkey=0xFF00FF:0.20:0,format=rgba`，再限定两轮、按每轮旧alpha快照清理四邻接的洋红边缘。伙伴与敌人按真实内容边界裁切并在四边各留内容宽/高5%的透明边；场景叠加层保持完整画布和边角物件位置。

已目视定位的伙伴漏勺/绳孔及部分敌人细线孔隙，在 [cleanKnownHoles](../../scripts/build-partner-art.js) 的归一化小区域内清理偏洋红像素，并在派生报告记录 `keyHolePixels`。规则只删符合局部条件的像素，不调整保留像素的RGB；更换母稿后必须复核原区域，不能把规则扩成全图去色。PNG量化前，完全透明像素的RGB归零；最终使用Swift检查真实alpha、非空内容及边界。

## 历史素材保留

- 原 `assets/prizes/*/{R,SR,SSR,UR}.png` 共88张、507438字节仍在磁盘，[project.config.json](../../project.config.json) 已将 `assets/prizes` 列入 `packOptions.ignore`。当前伙伴映射使用 `assets/partners`。
- `pilots/` 的母稿、透明修复稿和旧运行尺寸保留为历史及复建来源；下表字节是三人样板时期的尺寸，不是当前384/224伙伴运行图。
- `production/masters/*-rejected-*.png`、`enemy-masters/*-rejected-*.png` 记录被替代母稿；构建脚本只读取没有 `rejected` 后缀的指定文件。
- [source-before-integration/](production/source-before-integration/) 保存接入前源码快照，属于历史备份，不是另一条活动运行路径。
- `docs/` 整体已被打包忽略。历史图是否保留在磁盘与是否进入小程序包是两件事。

## 历史记录：三人可玩样板的11个文件

以下记录当时 `--art-pilot` 使用的11个文件。运行路径位于 `pilots/runtime/`；母稿与过程稿保留在 `pilots/`，来源为本轮内置 imagegen 原创生成，未复制商业游戏角色或卡面。当前接入及运行尺寸以上文为准。

| 运行文件 | 身份 | 当前压缩来源 | 母稿与处理 | 字节 |
| --- | --- | --- | --- | ---: |
| [sheep.png](pilots/runtime/sheep.png) | 羊咩咩团待机 | paper-sheep-runtime-v5-q.png | paper-sheep-v5-transparent.png；Vision与绳环清理 | 119628 |
| [orangecat.png](pilots/runtime/orangecat.png) | 橘猫豆包待机 | paper-orangecat-runtime-v5-q.png | paper-orangecat-v5-transparent.png；恢复肩部和尾纹 | 108015 |
| [nav.png](pilots/runtime/nav.png) | 领航小鸭待机 | paper-nav-runtime-v3-q.png | paper-nav-v3-transparent.png；Vision灰底清理 | 123187 |
| [sheep-cast.png](pilots/runtime/sheep-cast.png) | 羊咩咩团施招 | paper-sheep-cast-keyed-q.png | paper-sheep-cast-green.png；绿底色键 | 68902 |
| [orangecat-cast.png](pilots/runtime/orangecat-cast.png) | 橘猫豆包施招 | paper-orangecat-cast-keyed-q.png | paper-orangecat-cast-green.png；绿底色键 | 49867 |
| [nav-cast.png](pilots/runtime/nav-cast.png) | 领航小鸭施招 | paper-nav-cast-keyed-q.png | paper-nav-cast-green.png；绿底色键 | 61279 |
| [paper-ball.png](pilots/runtime/paper-ball.png) | 迷途纸团 | paper-ball-runtime.png | paper-ball-v3-transparent.png；Vision及绳环处理 | 90887 |
| [stamp-moth.png](pilots/runtime/stamp-moth.png) | 邮戳小蛾 | stamp-moth-runtime.png | stamp-moth-v2-transparent.png；Vision | 51369 |
| [street-back.jpg](pilots/runtime/street-back.jpg) | 黄昏邮街远景 | runtime/street-back.jpg | street-back-master.png；1024 JPEG | 453222 |
| [street-middle.png](pilots/runtime/street-middle.png) | 两侧灯笼中景 | runtime/street-middle.png | street-middle-composed.png；灯笼素材合成 | 20798 |
| [street-front.png](pilots/runtime/street-front.png) | 贴边旧信前景 | runtime/street-front.png | street-front-composed.png；旧信素材合成 | 28189 |

三张施招的完整透明母稿为 `paper-{sheep,orangecat,nav}-cast-keyed.png`。较早的 `*-cast-runtime.png` 是被替代候选，未用于该历史样板。原始提示见同目录的 `*-prompt.txt`。

该历史阶段仅隔离样板中的三张R和三张施招使用新图，整套22人方向当时尚未批准。角色ID、收藏、稀有度与战斗规则未随该轮图片改变。此段仅记录当时边界，不代表当前仍停留在三人样板。

共用首页/演出场景 `assets/scenes/summon-postoffice.jpg` 已在源项目接入，310651字节。参考游戏仅用于演出节奏研究，见[参考研究](REFERENCE_STUDY.md)。

[方向第二稿](pilots/directions-v2.png)保留了当时的候选比较；用户现已选择纸灵驿使。[22位设计说明](CHARACTER_BRIEFS.md)是设定来源，实际交付以当前运行清单为准。历史处理和使用方法见[样板说明](pilots/README.md)。CLI、设备尺寸及真机的已验证范围以 [STATUS.md](STATUS.md) 和对应验收报告为准，不从本素材账目推导。
