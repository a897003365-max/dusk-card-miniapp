# 战斗八状态验收

2026-09-10。224 张动作图片已制作并接入，三地区隔离副本的原生交互验收通过。正式工程窗口的最后一次核验尚未完成，见下方待办。

## 交付范围

- 22 位伙伴，每位 8 张状态图；3 位 Boss 各两个阶段，每阶段 8 张。合计 28 组、224 张透明 PNG。
- 出场、攻击、防御、受伤、退场、受控、增益、减益由真实战斗事件驱动。受控使用现有虚弱规则，没有新增眩晕或跳过回合。
- 卡面按攻击、防御、辅助显示动作插画。伙伴与 Boss 详情提供八状态图谱，查看不改变存档或 RNG。
- 战斗中可从“记录 → 结束远行”主动归队；退场播放时，永久收获已经保存。
- Luna / max 编排生成并独立复核，位图由内置 imagegen 生成。[资产与重建说明](../../combat-motion/README.md)。

## 已通过的检查

| 检查 | 证据 |
| --- | --- |
| 129 项 Node 测试 | [日志](node-tests.log) |
| 14 份真实 WXSS 原生编译，无通配选择器 | [日志](native-wxss.log) |
| 224 / 224 动作 PNG 在模拟器解码成功 | [报告](decode-all/report.json) |
| 320、390、430 宽度，详情、目标预览、取消、完整滚动、回城续玩 | [320](layout-320/report.json)、[390](layout-390/report.json)、[430](layout-430/report.json) |
| 三位初始伙伴图谱；真实防御和攻击动作有连续变换 | [羊 / 320](poses-320/report.json)、[橘猫 / 430](poses-430/report.json)、[小鸭 / 390](poses-390-phase2/report.json) |
| Boss 第二阶段实际使用新出场 PNG，播放 actionEnter | [转阶段报告](street-phase2/report.json) |
| 初始三位 R、Lv.1 队伍完整通关黄昏邮街 9 站，46 星线、4 邮票 | [结算报告](street-victory/report.json) |
| 雨巷旧桥和夜行灯市连贯执行真实出牌、确认结束、三人退场、收好回执；永久收获保留 | [最终两地区报告](regions-final/report.json) |
| 28 组图片浅底、深底独立检查 | [图片复核](visual-review/review-summary.md)、[独立复核](independent-review.md) |
| 346 个应用代码和资源文件与验收副本一致 | [文件核对](source-copy-check.json) |

[包体检查](package-budget.json)：主包约 1.373 MiB，全部分包均低于 1.9 MiB。早期的 9 份根目录提示词已移入 docs/combat-motion/prompt-history，避免打入主包。

## 修正过的问题

1. 动作图谱按钮的默认宽度造成横向溢出，已通过 minmax 网格约束修正。[修复前](layout-before-fix/report.json)、[修复后](decode-pilot/sheep-attack-fixed.jpg)。
2. 退场时循环内读取外层 beat，原生节点没有更新退场类。改为逐个敌人传入 exitMotion，已真实验证折叠变换和提前持久化。[原始采样](motion-observation-third/report.json)、[修复后](street-to-boss/report.json)。
3. 旧 CLI auto 流程漏传 AppID；采用普通 cli open 后启动 agent start。函数调用显式使用空参数文件，避免当前工具省略 args 时超时。初始化脚本会检查真实运行 AppID。[CLI 说明](CLI_NOTES.md)、[原始 SDK 错误](market-sdk-error/report.json)、[参数修复](cli-evaluate-args-fix/response.json)。
4. 首次跨地区读取整页数据返回不完整 JSON，已改为读取所需字段；跨分包导航后等待实际页面节点出现。[原始报告](region-read-before-fix/report.json)。

## 正式工程窗口待办

隔离副本的最终两地区检查已通过，且与源工程的应用文件一致。最后打开正式目录时，初始化保护检查报告“运行时 AppID 与项目配置不一致”，[原始启动日志](source-open-pending/launcher.log)已保留。随后电脑控制工具报告 Mac 锁屏，无法继续核对该窗口及其编辑器状态。需要用户手动解锁后继续；不能把这一步记作通过，也不能断言 AppID 问题由锁屏导致。

解锁后核对当前项目窗口，保留任何未保存内容，再完成启动 AppID、实际页面、控制台和截图检查。没有关闭自动锁屏、降低安全设置、伪造 AppID 或 mock 接口。

## 环境与边界

微信开发者工具 2.02.2608040，当前基础库 3.17.0。3.17.2 仅在隔离副本中试验，未解决启动问题，已经恢复。SDK 错误原文和实验记录保留，详见 CLI 说明。

控制台统一使用 get_simulator_console --command 'grep -i error'，有错误时追加 'grep -n .'。各通过报告附有 console-errors-raw.json。历史复合筛选的空结果不能代替本次检查。

本次消费和战斗只发生在隔离副本，没有注入卡牌、余额、存档或 RNG。源工程没有执行出牌、抽取、培养或结束远行。未验证 iPhone 真机、断网首次下载分包、全部 22 位队伍组合和另外两位 Boss 的完整战斗过程；没有上传、发布、提交或推送。
