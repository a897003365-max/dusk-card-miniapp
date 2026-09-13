# CLI 定位记录

项目：`/Users/maizi/AI-Jobs/Projects/dusk-card-miniapp`。本轮定位确认旧 `cli auto` 的开窗函数 `j()` 漏传 `appid`，并把 `projectpath` 错用了 `projectid`；正确路径是先用 `cli open` 打开当前项目，再用 `cli agent start` 接入已有窗口。当前初始化脚本不再例行重新编译，连接后读取页数据和真实 AppID 核验。`trustProject` 未启用。

`automation_evaluate` 的 `args` 在 schema 中可选，但现场验证表明省略 args 会超时；显式使用 `--args-file`，内容为不可变空数组 `[]`，立即返回 `result: 1`。CLI 的 `--args` 已被拦截为 `deprecated_args`，因此统一使用 args 文件。证据保存在 `/var/folders/_4/8v6tx5gx30qgb8l4648rn5tr0000gn/T/dusk-evaluate-args-probe-ZtEfMb/`。官方 Skill 位于微信开发者工具安装目录的 `wechatide-skill`，相关实现源码在 `app.asar/js/3f4b5a7224d7b710a48a9b753d705048.js` 及 automator bundle；本记录只引用结论，不复制 vendor 源码。

SDK `3.17.2` 试验没有解决该问题，已恢复现场使用的 `3.17.0`。未修改登录、认证、代理或 TLS 设置。编译缓存已重建，完整存档 hash 保持一致。224 张战斗状态图片已生成并解码，129 项 Node 测试通过；细节以本目录 [README](README.md) 及其证据文件为准。

夜市单独检查及雨巷旧桥、夜行灯市连贯回归均已通过，见 [最终两地区报告](regions-final/report.json)。正式工程最后一次初始化仍被 AppID 核验拦住，之后 Mac 锁屏；该窗口待用户解锁后继续核验，不能记为通过。
