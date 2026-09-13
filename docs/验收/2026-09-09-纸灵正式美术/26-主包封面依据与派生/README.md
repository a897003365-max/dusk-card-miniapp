# 主包地区封面

大厅之前直接读取分包背景。微信官方说明启动默认下载主包、进入分包页面才下载对应分包；目录内文件按分包打包。依此推断，未下载分包时不能依赖这些图片作为大厅封面。

依据：[分包加载](https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages.html)、[使用分包](https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/basic.html)、[运行环境](https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/env.html)。不声称模拟器一定忽略分包，也不把模拟器显示成功外推真机冷启动。

改为三个主包320×320、JPEG50的独立封面，合计66229字节。每张从已接入背景经sips缩放派生，构图不变；战场仍使用原分包1024背景。当前主包大小以第19目录的实际预算报告为准。复建命令为 node scripts/build-cover-art.js，先同步完整背景再执行。
