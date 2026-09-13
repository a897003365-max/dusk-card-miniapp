# 场景音乐与音效验收

本次为《晚霞来信 · 纸灵驿使》加入 6 段原创配乐、16 条事件音效及独立声音开关。Luna max 参与音频合成、页面接入和独立源码复核；主任务完成播放管理器、原生检查和修正。

新音频全部由本机脚本合成，没有引用现成歌曲或录音采样；仅新音频适用 [CC0 许可](../../audio/LICENSE.md)，未修改其他代码或素材的许可。文件、时长和复建方法见 [资产台账](../../audio/ASSET_LEDGER.md)。

## 已验证

| 范围 | 结果与证据 |
| --- | --- |
| 规则、存储、迁移、页面与声音测试 | `npm test`，138/138；[日志](node-tests.log) |
| 实际 WXSS | 15 份原生编译通过，且已知错误能被拦截；[日志](native-wxss.log) |
| 包体 | 主包 1,683,812 B，约 1.606 MiB；全部分包低于 1.9 MiB；[日志](package-budget.log) |
| 运行文件一致性 | 462 个应用文件与源码一致，只有验收存档键按设计替换；[记录](source-copy-parity.json) |
| 390 宽度、全部 22 个 MP3 | 原生 `onPlay`、时长与播放进度检查通过；城镇、来信、黄昏邮街实际播放；[报告](street-and-decode-390/report.json) |
| 雨巷旧桥、夜行灯市 | 由真实解锁入口出发、进入普通战、确认出牌、结束回合、主动归队；音乐切换与事件音实际播放；[旧桥](bridge-390/report.json)、[灯市](market-390/report.json) |
| 320 / 430 宽度 | 四个主页面切换、截图，全部声音按钮至少 44px 且无横向溢出；[320](main-320/report.json)、[430](main-430/report.json) |
| 独立开关 | 真实界面点击关闭音乐、关闭音效、恢复；CLI 回读设置与播放状态，游戏存档不变；[基线](controls-390/baseline.json)、[只关音乐](controls-390/music-off.json)、[全部关闭](controls-390/muted.json)、[恢复](controls-390/restored.json) |
| 后台生命周期 | 实际点右上角退出至后台，再从场景入口返回；后台停止、前台恢复音乐，旧音效没有补播；[后台](controls-390/background.json)、[前台](controls-390/foreground.json) |
| 一封来信 | 隔离副本真实扣 1 张邮票并触发启封音。该次素材探针随后因测试代码调用不存在的 API 失败；已改为实际页面导航加载分包，后续 22 个素材探针全部通过。原始记录保留于 [报告](draw-and-first-probe/report.json) |

上述最终通过的原生场景报告均使用现场 `get_simulator_console --command 'grep -i error'` 检查，返回为空。结算先保存再发声音，保存失败、延迟回调、声音偏好保存失败仍可立即静音等边界由 Node 测试覆盖。

音乐默认关闭、音效默认开启。音乐音量 0.18、音效 0.4；运行时最多一段音乐及两条短音，战斗每个节拍只选一个主要反馈。音乐、音效偏好使用当前存档键加 `-audio`，不混入游戏存档。

## CLI 与实玩边界

CLI 为 `/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide`，客户端 `Codex`，微信开发者工具 2.02.2608040，基础库 3.17.0。使用独立测试号 `wx36c7c6b8b54e63c9`。

所有消费和战斗操作只在 `dusk-card-acceptance-K3yvHv` 与 `dusk-card-acceptance-nyMDCE` 执行。前者从正常初始状态出发；后者复用此前真实实玩获得的解锁和等级。未注入手牌、余额、伙伴、随机数或通关标记，未修改正式存档。

主要命令：

```sh
node tests/audio-runtime-smoke.js <隔离目录> --controls-observed --probe-assets --region=street --allow-progress
node tests/audio-runtime-smoke.js <已解锁隔离目录> --controls-observed --region=bridge --allow-progress
node tests/audio-runtime-smoke.js <已解锁隔离目录> --controls-observed --region=market --allow-progress
node tests/audio-runtime-smoke.js <隔离目录> --controls-observed
```

本次 CLI 的跨组件 `tap/trigger` 未送达声音按钮事件；该项使用 CUA 真实点击，随后用 CLI 读回和截图。`--controls-observed` 明确跳过该自动点击部分，不能把它作为 CLI 按钮自动点击已通过的证明。其他游戏动作由 CLI 点击、滚动、选择目标和确认执行。

首领配乐选择与转阶段音的映射通过规则和页面测试；全部首领音频通过原生解码。本轮没有自然推进至首领战，不将素材探针称为首领实战验收。也没有进行本轮完整剧情章回、完整副本时长或真机听感回归。

## 保留的问题与处理记录

正式源码目录的窗口只读核验**未完成**：用 `cli open` 和 `wechatide open_project_window` 打开均在编译器启动处报 `Cannot read properties of undefined (reading 'MaxCodeSize')` 及 `MaxSubPackageLimit`，未进入应用。没有重置项目注册、删除缓存、改 AppID 或操作正式游戏存档。[原始日志、截图与状态](source-window/status.json) 已保留。隔离副本的 462 个应用文件已与源码核对一致，音频运行验收在副本完成；最后展示可运行的 `dusk-card-acceptance-nyMDCE`，不把它称为正式窗口验收通过。

初期编译和窗口切换时出现过 SDK 错误：

```text
routeDone with a webviewId 18 is not found
SystemError (appServiceSDKScriptError)
[Page route 错误(system error)] routeDone with a webviewId 18 is not found
```

原始 error 筛选和完整日志保存在 [SDK 记录](sdk-route-error/console-errors-raw.json)。重新打开、导入项目并读取页面后恢复；也曾出现自动化请求超时。没有清空缓存、停用热重载、改代理或降低安全设置。

模拟器明确不支持 `wx.setInnerAudioOption`。现仅在真实设备调用它，模拟器仍可正常播放，且不再把已知不支持的接口作为音频加载失败。手机静音键、与其他 App 混音及扬声器实际听感仍需真机确认。

没有上传、发布、提交或推送。本报告不把模拟器通过外推为 iPhone 真机通过。
