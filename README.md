# 晚霞来信 · 纸灵驿使

独立原生微信小程序，以旧街巷童话、信匣抽取和三人卡牌冒险组成离线 RPG。22 位伙伴已按用户确认的“纸灵驿使”方向重构：折纸身体、纸纤维、邮路职业工具，各有待机肖像和八种战斗动作立绘。保留原伙伴 ID 和收藏进度。

6 段原创场景配乐已重编为舒缓木质拨弦、持续和声与留白乐句，配合 16 条交互音效，新音频按 CC0 提供。主页面顶部可分别开关音乐、音效；战斗中从「记录」调整，切后台会停止播放。音乐默认关闭，详见 [声音使用说明与素材来源](docs/audio/README.md)。

## 打开项目

```sh
cd /Users/maizi/AI-Jobs/Projects/dusk-card-miniapp
npm run devtools
```

使用本机微信开发者工具官方 CLI 导入、启动并读取实际页面。不需要 npm 运行依赖，也可直接导入此目录。独立测试号为 `wx36c7c6b8b54e63c9`；未上传或发布。

默认工程已包含整套新美术。需要隔离实玩时：

```sh
node scripts/prepare-acceptance.js
node scripts/open-devtools.js <输出的临时目录>
```

副本采用专属存档键，从正常初始状态开始，不复制或注入玩家存档。旧样板 `--art-pilot` 参数已移除。

## 玩法

- **冒险**：黄昏邮街、雨巷旧桥、夜行灯市依次解锁，各有普通、险路、深夜。每程 9 站，三人共享牌堆和能量，点击牌、选择目标、确认出牌；根据敌人意图安排护盾、连击、标记与回响。战后选牌、事件、营地和遗物改变本局构筑。
- **信匣**：初始 6 张邮票，单封或五封抽取。R 初笺、SR 花信、SSR 星笺、UR 霞章使用不同层次与时长的启封演出，可跳过或直接查看全部；结果在演出前一次入库。
- **旅伴**：22 位伙伴、88 个收藏信印。四档共用同一伙伴身份，边框、光效和起手改造体现差别。编成三人队伍，以副本星线培养至 10 级；已拥有信印可免费重温登场。
- **来信**：保留 4 章、12 幕、24 个选择，队伍能力影响事件结果；回信和纪念品可重复查看。每章首次送达奖励 3 票，重访奖励 1 票。

全套 74 张远行固定牌已重新审阅费用与用途。出发前可选“稳妥出发”“加急接力”“灯火储备”“巷间应变”，起手仍为 12 张。前两回合基础补 3 能量，第 3 回合起基础补 4；余能每回合最多存 1 点为蓄能，蓄能会在下回合变为额外能量，最多 3 层。0 费牌提供雨幕/顺风、净化、破盾、拦截、发现与观星；另有 6 种本战临时机会牌。卡牌详情可付费改签，换掉暂时无用的牌。

牌价、官方参考与逐卡理由见 [卡组对标与平衡](docs/adventure/卡组对标与平衡.md)，完整通关、费用与三尺寸证据见 [整套卡组经济重构验收](docs/验收/2026-09-12-整套卡组经济重构/README.md)，蓄能释放的新机制见 [蓄能释放机制验收](docs/验收/2026-09-13-蓄能释放机制/README.md)。此对标是规则与验证框架，不代表已经取得成熟商业游戏的玩家数据或市场验证。

Boss 按 800ms 蓄势、1200ms 命中读数、300ms 间歇行动。战后纸张展开、盖戳、队伍和收获依次呈现，回执会一直保留到玩家确认；显示期间不再发奖。前一轮的节奏、失败与音频记录见 [配乐节奏与战术卡组验收](docs/验收/2026-09-12-配乐节奏与战术卡组/README.md)。

战斗中可通过“记录 → 结束远行”主动归队，伙伴会播放退场动作，已经入库的收获保留。

回响、标记、弱化及蓄能、消耗、保留、连锁等 18 项机制可在“记录 → 玩法说明”中查阅，伙伴、敌人及卡牌详情也有入口；说明包含触发、消耗、结束时机与例子，浏览不消耗行动。此前手机声音及 Boss 反馈改进见 [上一轮验收](docs/验收/2026-09-12-手机声音与Boss反馈/README.md)。

Boss 重复通关按难度获得 1/2/3 票，地区首次额外 3 票。已结算星线即时保存；失败或结束远行保留永久伙伴及已入库材料。主线与副本互斥，返回邮局和关闭后可续玩，出发后的队伍快照固定。SSR 或以上最多 10 封保底，UR 最多 40 封保底。

存档版本为 v2，沿用 `dusk-letter-rpg-v1`；升级前保留旧档备份。不访问原项目钱包或存档，无支付、远程服务或云同步。清除小程序本地数据会失去进度。

## 美术与实现

- 主包保留 22 张伙伴待机 PNG；新增 176 张伙伴动作、48 张 Boss 动作（3 位 × 2 阶段 × 8 状态）。原有 24 张敌人 PNG、9 张远中近场景层和 3 张主包地区封面保留。原 88 张收藏图仍留在磁盘，当前打包排除，避免重复占用主包。
- 卡面按攻击、防御、辅助效果显示对应动作插画。战斗事件驱动出场、攻击、防御、受伤、退场、受控、增益和减益姿态；点伙伴或 Boss 可查看八种动作图谱。图片和动画解释已结算结果，不负责伤害、状态或奖励。
- 伙伴动作通过三个公共分包组件加载，Boss 动作留在地区包。Luna / max 编排生成与核验，图片由内置 imagegen 生成；高分辨率母稿和复建流程见 [动作资产说明](docs/combat-motion/README.md)。
- 高分辨率母稿、提示词、处理脚本与来源记录见 [素材账目](docs/visual-rework/ASSET_LEDGER.md) 和 [资源复建说明](docs/visual-rework/production/README.md)。
- 战斗核心为纯 JavaScript，统一预览与结算规则，随机数进度跟随存档。开源研究与许可记录见 [固定版本与开源来源](docs/adventure/开源来源.md)。

本轮动作扩展的实际范围及边界见 [9 月 10 日原生验收](docs/验收/2026-09-10-战斗八状态/README.md)。历史三人样板记录保留在 [9 月 9 日样板证据](docs/验收/2026-09-09-三人纸灵样板/README.md)，不能替代整套新资源验收。

## 检查与隔离实玩

```sh
npm test
npm run check:wxss
npm run check:budget
node tests/art-runtime-smoke.js <隔离目录> --width=390
node tests/adventure-layout-smoke.js <隔离目录> --width=390
node tests/action-decode-smoke.js <隔离目录>
node tests/pose-runtime-smoke.js <隔离目录> --width=390 --family=sheep --gallery-only
node tests/summon-replay-smoke.js <隔离目录> --width=390 --observe-motion
```

`--width` 只断言当前模拟器尺寸，须先在开发者工具切换设备。美术页面与收藏重温脚本只查看、不消耗；重温必须已真实拥有对应档位。`--observe-motion` 额外采集真实节点的阶段、变换和图像路径；`--tier=UR` 可只复查一档。

```sh
node tests/tactics-runtime-smoke.js <隔离目录> --allow-progress --tactic=relay
node tests/tactics-layout-runtime.js <隔离目录> --width=390
node tests/adventure-runtime-smoke.js <隔离目录> --allow-progress
node tests/adventure-runtime-smoke.js <隔离目录> --allow-progress --resume
node tests/adventure-runtime-smoke.js <隔离目录> --allow-progress --bridge
node tests/adventure-runtime-smoke.js <隔离目录> --allow-progress --market
```

真实进度测试只在获准的临时副本运行。`--resume` 接续当前远行；`--bridge` / `--market` 必须已按正常进度解锁，不能绕过关卡。`--camp-upgrade` 检查营地升级；`--defeat` 通过仅结束回合验证失败；`--one-battle` 只检查首场胜利。

```sh
node tests/runtime-smoke.js <隔离目录> --allow-progress
node tests/summon-runtime-smoke.js <隔离目录> --allow-progress --width=390 --all-tiers
node tests/summon-controls-smoke.js <隔离目录> --allow-progress
```

实抽脚本通过正常章节赚取缺少的邮票，不注入余额、卡牌或随机数。运行截图和日志先写系统临时目录，再归档至 `docs/验收/`。模拟器通过不等同于 iPhone 真机通过。
