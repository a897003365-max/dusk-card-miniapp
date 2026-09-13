> 历史样板记录。2026-09-09 用户已选择“纸灵驿使”；当前默认工程包含全部 22 位伙伴和三地区美术，已移除临时 `--art-pilot` 开关。以下图片与评价保留作为选型过程，正式资源见 [素材账目](../ASSET_LEDGER.md)。

# 三人纸灵驿使可玩样板

[方向比较第二稿](directions-v2.png)从左至右为纸灵驿使、灯影行者、釉彩灵偶。这是选型时的比较图；纸灵驿使现已获选。下文记录当时三人、两敌、一处战场的样板。

纸灵采用折纸脸、清楚四肢、纸面折线、靛蓝旅装和邮差配饰。羊使用卷纸角、线轴与信纸盾；橘猫保留敏捷四足轮廓和铜钩；小鸭持路线板与指南针。它们已用于隔离副本，源项目88张收藏图未批量替换。

## 查看与复跑

在项目根目录执行：

```sh
node scripts/prepare-acceptance.js
node scripts/open-devtools.js <上一步输出的临时目录>
node tests/adventure-runtime-smoke.js <临时目录> --allow-progress --one-battle
```

副本从正常初始3R伙伴、6票开始，独立存档；最后一条会真实推进第一战并结算材料。运行素材唯一交付目录为 [runtime/](runtime/)，共11个文件，即6角色姿态、2敌人、3场景层。其他版本为母稿或过程稿，不能按文件名中的runtime推断仍在使用。

## 实际处理流程

母稿由内置 imagegen 创建，提示词与高清原稿保留在本目录。初期“透明底”输出实为不透明背景，失败版本已保留。Kimi官方API仅提供一次文本化Swift方案；本机按真实API修正、编译、运行。

待机与敌人主要使用原生Vision提取，再做受限灰底清理。颜色规则不能识别物体：橘猫深灰纹理发生误抠，已通过 [repair-orangecat-matte.js](repair-orangecat-matte.js) 从原稿局部恢复为v5；脚本拒绝覆盖已有母稿。施招长袍使用灰底仍有破洞，最终改用纯绿背景母稿。

三张施招的FFmpeg过滤器为：

```text
format=rgba,colorkey=0x00ff00:0.20:0,format=gbrap,geq=r='r(X,Y)':g='min(g(X,Y),max(r(X,Y),b(X,Y)))':b='b(X,Y)':a='alpha(X,Y)',format=rgba
```

此去绿处理仅适用于当前没有绿色主体的三张图，不能用于绿色角色。完整RGBA结果经sips缩到512，再经pngquant压缩；待机缩到768。被拒绝的Vision施招和错误despill版本保留为过程稿，未接入runtime。

```sh
xcrun swiftc -O scripts/extract-sprite.swift -o /tmp/dusk-extract-sprite
xcrun swiftc scripts/check-sprite-alpha.swift -o /tmp/dusk-check-sprite-alpha
/tmp/dusk-check-sprite-alpha /绝对路径/角色.png
sips -Z 768 /绝对路径/透明母稿.png --out /绝对路径/缩小图.png
pngquant --quality=0-95 --speed 1 --strip --output /绝对路径/量化图.png /绝对路径/缩小图.png
```

pngquant为本机工具，应用无新增运行依赖。真实alpha检查与洋红底目视检查分别验证透明度和误抠，不能互相替代。远景为JPEG，中景为两侧灯笼，前景为贴边旧信，由原生WXSS绘制动画。

最终版本见[素材记录](../ASSET_LEDGER.md)，验收范围及未完成项见[进度](../STATUS.md)。

## 指定伙伴的真实施招观察

```sh
node tests/pose-runtime-smoke.js <隔离目录> --allow-progress --family=orangecat --width=390
node tests/pose-runtime-smoke.js <隔离目录> --allow-progress --family=nav --width=390
```

脚本只在已进入战斗、指定伙伴当前有可用手牌时执行一次真实出牌；没有合适手牌会停止，不自动推进回合或注入状态。优先选择非伤害牌，需要敌方目标时选当前生命最高者，并读取页面实际预览；预览会结算奖励或结束远行时停止。确认按钮检查44px与可见范围，出牌与只读节点观察并发，随后验证恢复待机。`--width`仅断言设备真实宽度。

一次执行会消耗本局行动能量；它不消费邮票，也不重放已执行动作。若未捕获施招，应先查看保留的报告，不能直接重跑并当作同一次出牌。
