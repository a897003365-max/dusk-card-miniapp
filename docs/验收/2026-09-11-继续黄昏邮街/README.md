# 继续黄昏邮街验收

问题表现为点击“继续黄昏邮街”后提示“请联网”。原因是动作素材异步分包加载失败时，页面把增强表现误当成进入副本的必要条件。

已将行为改为：动作分包加载失败只记录 `action-pack-load-fallback`，继续使用主包待机肖像并进入已保存副本；只有真正的页面导航失败才提示“暂时无法进入，远行已保存”。同时增加导航锁，避免快速重复点击造成重复导航或重复提交。

验证结果：

- 测试号 AppID：`wx36c7c6b8b54e63c9`
- 隔离存档副本：`dusk-card-acceptance-7soI38`
- 真实点击“出发”创建黄昏邮街远行，再返回大厅点击“继续”
- 实际到达 `package-street/pages/run/index`
- 战斗页真实加载，按钮触控区域为 354×48 px
- 截图：[resume-street.jpg](resume-street.jpg)
- 控制台 `grep -i error` 为空：[report.json](report.json)

Node 测试 129/129 通过。没有修改测试号真实存档，没有上传或发布。
