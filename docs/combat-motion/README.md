# 战斗动作图片资产

这套资产为「纸灵驿使」战斗中的角色动作表现服务。当前目录保留 28 个身份或 Boss 阶段，每个身份 8 个动作状态，共 224 个状态 PNG。动作状态的顺序和运行时语义由 `utils/action-art.js` 统一定义，图片只表现已经由战斗 resolver 结算的事件与状态。

## 当前范围

每个身份的母稿都是 4 列 2 行，读取顺序固定为：

```text
第一行：enter  attack  guard  hurt
第二行：exit   control buff   debuff
```

状态含义如下：

| 状态 | 运行时含义 |
| --- | --- |
| `enter` | 出场、召唤或 Boss 进入第二阶段 |
| `attack` | 角色出牌造成攻击性效果，或敌方主动施招 |
| `guard` | 施加护盾、敌方防御，或伤害被护盾完全挡下 |
| `hurt` | 受到了实际生命损失的伤害 |
| `exit` | 倒下、被击败或正在退场 |
| `control` | 已有 `weak` 虚弱状态对应的受制表现 |
| `buff` | `counter`、`echo`、`retainBlock`、`energy` 等增益表现 |
| `debuff` | 已有 `burn` 灼烧或 `mark` 标记状态对应的减益表现 |

`control`、`buff`、`debuff` 不新增战斗规则。动画不计算伤害、不改变状态、不发放奖励；`previewAction` 仍通过真实 resolver 生成结果，并保持状态和 RNG 不变。相同事件的优先级以 `utils/action-art.js` 为准，不能在页面层另建一套映射。

## 目录和职责

```text
docs/combat-motion/
├── masters/<id>-sheet.png       # 4x2 高分辨率母稿，原始来源
├── prompts/<id>.txt             # 生图提示词和版本说明
├── frames/<id>/<state>.png      # 透明高分辨率中间帧
├── runtime/<id>/<state>.png     # 待同步运行帧，最长边 256px / 128 色
├── legacy-casts/*-cast.png      # 旧 22 位 cast 图的归档，仅作历史参考
├── TASK_BRIEF.md                # 范围、状态和技术约束
└── ASSET_LEDGER.md              # 身份、路径和完整性清单
```

母稿使用纯洋红 `#FF00FF` 作为生产中间底，最终运行帧由本机管线按色键转为透明 PNG。不要对母稿或运行帧手工裁掉角色、武器、尾巴、光弧或其他前景像素。运行图采用 256px、128 色的当前生产参数；原始母稿始终保留。

全部母稿由 Luna max 编排的内置 `imagegen` 任务生成。这里的“Luna max”记录源模型任务的编排选择；位图由内置 imagegen 生成，不把 Luna 语言模型本身描述成绘图模型。提示词应和母稿放在 `prompts/` 中；28 份同名提示词均已归档，详见 [ASSET_LEDGER.md](ASSET_LEDGER.md)。

## 生成、检查、同步

从项目根目录执行：

```sh
node scripts/build-action-art.js
node scripts/sync-action-art.js
```

两步之间必须先检查构建输出，再执行同步。构建脚本默认处理 22 位伙伴和 3 个 Boss 的两个阶段。也可以传入身份 ID 做有界重建，例如：

```sh
node scripts/build-action-art.js sheep paper-lion-phase2
node scripts/sync-action-art.js sheep paper-lion-phase2
```

构建过程会：

1. 从 `masters/<id>-sheet.png` 读取 RGBA 前景；对洋红底只做本机色键转换。
2. 沿透明分隔缝寻找横向和纵向 seam，避免用直线截断武器或特效。
3. 将每个前景像素分配给一个状态格，报告中的 `foregroundPixels` 必须等于 `assignedPixels`。
4. 从已分配的前景生成母帧和 256px / 128 色运行帧，前景像素不因分割被静默丢弃。
5. 全部身份通过后才写入 `frames/` 和 `runtime/`；任一身份失败都不能把半成品同步到生产包。

同步脚本只复制 `runtime/`，不会重新生成图。伙伴路径由 `utils/action-art.GROUPS` 决定，Boss 路径由 `ENEMY_BY_ID` 的地区决定。微信异步分包边界参考[官方异步分包说明](https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/async.html)。

## 运行时分包

22 位伙伴不再把动作帧放入主包。主包保留 22 位伙伴的 idle 肖像；旧的 22 张 `*-cast.png` 已移到 `legacy-casts/`。动作组件在出发或续玩时按当前队伍加载所需的伙伴素材包，组件路径必须和 `utils/action-art.GROUPS` 保持一致。

| 分组 | 身份 | 运行包 |
| --- | --- | --- |
| `a` | sheep、ramen、sunset、ticket、catcafe、moon、nav、tea | `package-actors-a/assets/<id>/<state>.png` |
| `b` | sushi、pear、burger、badminton、bomb、orangecat、doudou | `package-actors-b/assets/<id>/<state>.png` |
| `c` | hydrangea、pearlamp、cloudmail、firefly、soup、blanket、seedling | `package-actors-c/assets/<id>/<state>.png` |

Boss 动作留在各自地区包：

| Boss | 地区包 | 运行路径 |
| --- | --- | --- |
| `paper-lion`、`paper-lion-phase2` | street | `package-street/assets/actions/<id>/<state>.png` |
| `ink-tide`、`ink-tide-phase2` | bridge | `package-bridge/assets/actions/<id>/<state>.png` |
| `bell-warden`、`bell-warden-phase2` | market | `package-market/assets/actions/<id>/<state>.png` |

## 当前预算快照

以下数据来自 [当前包体检查](../验收/2026-09-10-战斗八状态/package-budget.json)；预算检查本身不是原生验收结果。

| 包 | 字节 | MiB | 状态 | 距 2 MiB 的余量 |
| --- | ---: | ---: | --- | ---: |
| main | 1,439,362 | 1.372683 | PASS | 657,790 |
| package-street | 1,304,494 | 1.244062 | PASS | 792,658 |
| package-bridge | 1,241,018 | 1.183527 | PASS | 856,134 |
| package-market | 1,313,409 | 1.252564 | PASS | 783,743 |
| package-actors-a | 1,289,540 | 1.229801 | PASS | 807,612 |
| package-actors-b | 1,033,468 | 0.985592 | PASS | 1,063,684 |
| package-actors-c | 1,037,651 | 0.989581 | PASS | 1,059,501 |

## 验证边界

当前文件统计确认 28 个身份各有 8 个 `frames` 和 8 个 `runtime` PNG，共 224 + 224；三个伙伴动作包和三个 Boss 地区包的同步目标均存在。`tests/action-art.test.js` 已覆盖状态顺序、分组、Boss phase2 路径、真实 resolver 事件映射和预览纯读边界。

微信模拟器已通过 224 张图片解码、320/390/430 布局、三位初始伙伴图谱和真实出牌、吞信纸狮两阶段切图及完整黄昏邮街通关。三地区入口与主动结束交互已通过；正式窗口核验待解锁，状态见 [原生验收索引](../验收/2026-09-10-战斗八状态/README.md)。模拟器结果不外推为 iPhone 真机通过。
