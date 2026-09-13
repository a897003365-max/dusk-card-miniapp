# 蓄能释放机制验收

本轮把“蓄能在当前回合补牌费”改为“蓄能在下一回合全部释放为额外能量”。因此留 1 点能量不再只是隐藏补差：第一回合留 1 点，第二回合显示 `4/3`；第二回合再留 1 点，第三回合显示 `5/4`。

实现范围：`utils/combat.js` 在新回合将蓄能加入能量并记录 `chargeRelease`；卡牌和改签只花当前能量。工具条继续显示实际能量/基础能量，回合结算显示“蓄能释放”，补给说明、卡牌提示和基准脚本同步使用新语义。

## 验收结果

- `npm test`：189/189 通过，包含存能、当前回合不可把蓄能补差、下回合超额能量、上限、旧存档字段缺失和战斗回放。
- `node scripts/check-package-budget.js`：主包 1,782,257 bytes（1.700 MiB）通过；各分包均低于检查阈值。
- `node scripts/benchmark-combat.js`：186 局公开信息策略对照完成。首本四套起手各 20/20 胜；基准现在记录“释蓄”总点数，详情见 `support/dusk-charge-release-benchmark.log`。
- 微信开发者工具 Stable 2.02.2608040，隔离副本 `dusk-card-acceptance-2aJrFR`、390 宽度：所有步骤通过真实点击，控制台 `grep -i error` 为空。

原生实玩报告见 [report.json](native-390/report.json)。关键截图：[第二回合 4/3](native-390/turn-2-four-over-three.jpg)、[第三回合 5/4](native-390/turn-3-five-over-four.jpg)、[补给说明](native-390/charge-guide.jpg)。实玩结束时通过“结束远行”确认返回，隔离副本的已入库资源保持不变。

本轮只验证了模拟器隔离副本，未上传预览、未发布，也不能以此替代手机扫码或真机结果。
