# 整套卡组与费用体系重构验收

本轮已通过188项自动测试、186局公开信息策略对照与微信原生交互验收。初始三名R伙伴1级实际通关首本，Boss在第7回合结束；320/390/430宽度的关键操作均已检查。

源项目：`/Users/maizi/AI-Jobs/Projects/dusk-card-miniapp`。本轮未修改 Love Diary 项目或真实玩家存档；Dusk 目录不是 Git 仓库，没有新建仓库、提交、推送、预览上传或发布。

唯一原生实玩目标：`/var/folders/_4/8v6tx5gx30qgb8l4648rn5tr0000gn/T/dusk-card-acceptance-cAIGWF`，独立 AppID `wx36c7c6b8b54e63c9`，存档 KEY `dusk-letter-rpg-v1-dusk-card-acceptance-cAIGWF`。沿用这份已获准的验收资料，仅用可见按钮进行消耗型操作；没有清存储、注入牌序/生命/余额或改 RNG。

## 本次改动

- 审阅并重新定价74张远行固定牌、22个伙伴被动与18件遗物；0–4费分布由9/52/9/1/3改为9/25/29/8/3。逐牌理由和官方参考见[卡组对标与平衡](../../adventure/卡组对标与平衡.md)。
- 前两回合3能量，第3回合起4；每回合末最多存1余能，蓄能上限3且跨回合保留；所有牌先花能量，再用蓄能补差。卡面保留原费用，确认区明示支付构成。
- 0费牌改写环境、清除负面状态、移除盾、指定护卫、发现临时机会或观星整理真实牌序。6种机会牌均本战临时且消耗，源牌不会递归免费生成。
- 增加付1费改签、第四套起手“巷间应变”和第9回合起的久战压力。发现/观星候选及随机进度持久保存，选择或支付失败不会偷偷消耗资源。
- 规则说明增加到18项，固定横向分类栏与独立正文滚动；选牌窗口展示当前预算、伙伴状态和敌人意图。缩略卡面显示破盾接攻击、多段数和全队/全敌范围。
- 修复预览提前泄漏改签牌身份、观星置底顺序反转、护卫拦截本来就打自己的攻击、回响补刀漏触发击倒被动、发现升级效果挤满手牌，以及蓄能元数据额外插入空动画帧。

## 自动验证

- `npm test`：188/188通过，包含旧功能、迁移、存储失败、支付、牌区、状态、Boss阶段和奖励单次结算。
- `node tests/claw-wxss.test.js --native`：15份实际WXSS原生编译通过，已知非法写法能被拦下。
- `node scripts/benchmark-combat.js --out=...`：186局公开信息策略对照，战斗开始后不注入卡牌、资源或生命。初始3名R伙伴1级、首本四种起手各20/20通过；Boss平均5.85–6.8回合。同一纯防护队的防守/均衡策略分别平均19/6.3个Boss回合，不能把慢局全归因于费用。夜市3级初始队四起手4/8、4/8、5/8、7/8，纯状态队0/8，保留了阵容与战术适配差异。
- 数据只代表指定种子、等级和公开启发式策略，不是最优玩家、真实用户胜率、商业成熟度或10–15分钟真人时长证明。

## 原生实玩已核验的关键链路

发现3选1 → 离开再续玩候选/RNG不变 → 选择0费临时补给 → 主动打出才加蓄能 → 第3回合4能量且保留蓄能 → 改签支付1能量且不增加出牌计数 → 4费牌使用3能量+1蓄能 → 赢得本战并清理临时牌、发放一次奖励。每一步以真实按钮点击后的存档与源引擎对照。

整局脚本在营地因缺少 `chooseUpgrade` 点击映射中止过一次，留下完整失败报告；补齐 `.camp-upgrade` 后从同一份原存档接续。该问题属于验收脚本，未改动或回滚游戏进度。

一次重开回执探针误把类型断言写成 `victory`；实现中的真实类型是 `final-win`。修正探针后，重开前后整个存档一致，查看与收好回执不重复发奖。两份初始失败记录均保留，不计入通过数。

| 原生验证 | 结果与证据 |
| --- | --- |
| 发现、续玩、临时牌、改签、混合支付 | [17项检查](opportunity-payment/report.json)，[4费支付画面](opportunity-payment/four-cost-payment-preview.jpg) |
| 9节点首本通关 | [前段记录及脚本修复点](run-before-camp-fix/report.json)、[继续通关的89项检查](run-complete/report.json)、[第7回合Boss回执](run-complete/receipt-3.jpg)；本程46星线、重复通关1邮票，三人均存活 |
| 0费雨幕 | [原生报告](rain/report.json)、[雨幕生效](rain/rain-active.jpg)；敌攻预览降低2，实际同源结算，下一己方回合清除 |
| 观星 | [320宽度原生报告](scout-320/report.json)、[实际候选](scout-320/scout-choice.jpg)；自然抽到源牌、真实牌区、候选与RNG持久化、选中进手且其余依序置底 |
| 护卫 | [430宽度原生报告](intercept-430/report.json)、[指定后的单体意图](intercept-430/intercept-active.jpg)；一次自然发现得到护卫，无重开刷候选；[原生存档中的一次拦截事件](withdraw-intercept/report.json) |
| 320/390/430布局 | [320报告](layout-320/report.json)、[390报告](layout-390/report.json)、[430报告](layout-430/report.json)；分别26/24/24项检查，每个已点击目标至少44×44像素 |
| 说明入口与正文 | HUD、卡牌详情直达；8个新规则分类可横向切换、正文可完整滚动、返回原记录或卡牌页且存档不变；[最新天气顺序提示的小屏复查](weather-tip-320/report.json) |
| 重开、信匣与图片 | [回执与信匣报告](receipt-and-home/report.json)、[原生JPEG画面](receipt-and-home/postoffice-jpeg-native.jpg)；微信原生解码成功，查看信匣规则未消耗邮票 |
| 测试收尾 | 三次单项实玩均通过实际“结束远行”确认退出；[最终状态](final-hub/report.json)无活动远行，星线96、邮票11，已恢复390宽度，四套打法可切换且不改存档 |

本轮使用的主要命令如下。所有消耗型步骤只针对上述同一个已获准隔离副本，观星/雨幕/护卫脚本从无活动远行开始，绝不覆盖旧进行中存档。首次发现暂停使用 `--stop-at-choice`，续玩使用 `--resume`。

```sh
dusk_acceptance_project='/var/folders/_4/8v6tx5gx30qgb8l4648rn5tr0000gn/T/dusk-card-acceptance-cAIGWF'
npm test
node tests/claw-wxss.test.js --native
node scripts/check-package-budget.js
node scripts/benchmark-combat.js --out=/tmp/dusk-economy-LekxRH/benchmark-final.json
node tests/tactics-runtime-smoke.js "$dusk_acceptance_project" --allow-progress --tactic=relay --stop-at-choice
node tests/opportunity-runtime.js "$dusk_acceptance_project" --allow-progress
node tests/tactics-runtime-smoke.js "$dusk_acceptance_project" --allow-progress --resume --tactic=relay
node tests/tactical-choice-runtime.js "$dusk_acceptance_project" --allow-progress --environment
node tests/tactical-choice-runtime.js "$dusk_acceptance_project" --allow-progress --scout
node tests/tactical-choice-runtime.js "$dusk_acceptance_project" --allow-progress --intercept
node tests/tactics-layout-runtime.js "$dusk_acceptance_project" --width=320
node tests/tactics-layout-runtime.js "$dusk_acceptance_project" --width=390
node tests/tactics-layout-runtime.js "$dusk_acceptance_project" --width=430
```

`--width`只断言真实设备尺寸，不会自动改尺寸。切换通过开发者工具机型菜单完成；底层点击、页面数据、滚动、关闭、控制台与截图由 `/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide -c Codex` 执行。原始报告保留当时临时路径，图片副本与报告同目录归档。

## 资源与环境

主包最终1,781,940字节（1.699 MiB），全部分包低于1.9 MiB检查阈值。主包通过保留元数据的JPEG无损渐进封装节省12,768字节；原图与新图解码像素SHA256相同。没有压低音频码率或替换画面，详见[无损封装记录](support/image-packaging.json)与[最终包体输出](support/package-budget-final.log)。

460份运行文件在源项目与隔离副本中字节一致，`app.js`仅保留原有隔离KEY替换；[比对范围](support/source-copy-parity-final.json)、[运行文件SHA256](support/source-runtime-sha256.json)、[完整测试输出](support/node-tests-final.log)、[186局原始结果](support/benchmark-final.json)均已归档。规则审阅记录位于 `support/dusk-economy-review.md`，它是人工审查记录，不能代替上述实际日志。

原生工具 Stable 2.02.2608040，基础库3.17.0。CLI控制台使用现场命令 `get_simulator_console --command 'grep -i error'`。原生窗口另见灰度基础库、工具资源预载及 `[worker] reportRealtimeAction:fail not support` 警告，原文保留在 `support/native-ui-warnings.txt`；未改变基础库、热重载或安全设置。

手机扫码预览、真机声音和手感、本轮桥/夜市的完整原生通关未在此验收中覆盖；不能由模拟器或纯JS数据外推。没有生成或上传新的预览二维码。
