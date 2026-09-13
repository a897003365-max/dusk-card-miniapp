# 项目规则

- 本项目为独立原生微信小程序「晚霞来信」，不访问原项目业务逻辑与玩家存档。当前按用户要求重构角色外观以区别娃娃机公仔；保持家族ID与收藏数据，不把旧图换色视作完成重构。新角色方向与进度见 `docs/visual-rework/STATUS.md`。
- 应用代码只使用 `dusk-letter-rpg-v1` 存档；v2 仍沿用该 KEY，不替换旧 KEY。玩法参数与剧情内容分别集中在 `utils/game.js`、`utils/content.js`。不要接入充值、远程服务或引入原项目钱包。
- 修改后运行 `npm test`；WXSS 修改须运行 `node tests/claw-wxss.test.js --native`，不允许通配选择器；资源修改运行 `node scripts/check-package-budget.js`。
- 交付前必须用微信开发者工具 CLI 实际打开目标页面、点击、切换、滚动、关闭、检查节点/控制台并截图；编译 success 不能代替运行验收。冒险模块新增页面建议至少覆盖：
  - `/pages/adventure/index` 首入口与 TAB 切换
  - `/package-street/pages/run/index`
  - `/package-bridge/pages/run/index`
  - `/package-market/pages/run/index`
- 消耗邮票或更改剧情进度的验收只在明确获准的临时副本中进行，不清理真实存档，不注入测试卡牌或余额。截图和日志先存系统临时目录，再归档到 `docs/验收/`。
- 原生验收最小闭环命令示例：

```sh
node scripts/prepare-acceptance.js
node scripts/open-devtools.js <临时项目路径>
node tests/runtime-smoke.js <临时项目路径> --allow-progress
```

- 冒险模块新增原生验收示例（使用当前脚本）：

```sh
node tests/adventure-runtime-smoke.js <临时项目路径> --allow-progress
```

如需验证非默认路线：

```sh
node tests/adventure-runtime-smoke.js <临时项目路径> --allow-progress --bridge
node tests/adventure-runtime-smoke.js <临时项目路径> --allow-progress --market
```

`--resume` 可用于已有未结束远行时继续当前局面；未开启 `--resume` 时，脚本按正常新局校验运行且不允许带入旧进行中的远行。
`--bridge`/`--market` 仅用于验证对应路线在满足解锁与养成前提后的真实入口；三线路不得通过参数直接越过真实进度。
- 当前使用已验证可用的独立测试号 `wx36c7c6b8b54e63c9` 做本地开发。更换正式 AppID 必须由用户指定，不得绑定原项目正式 AppID。未经明确授权不上传、发布、提交、推送。
- 模拟器通过不等于 iPhone 真机通过；CLI 阻塞时明确标注“验收未完成”。
