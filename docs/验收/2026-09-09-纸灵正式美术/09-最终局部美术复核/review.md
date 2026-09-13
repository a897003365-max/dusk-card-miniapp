# 指定 11 张最终运行 PNG 局部复核

## 结论

本轮没有发现 P1/P2 问题，也没有发现仍实质影响可见性的残键色、孔洞残底或局部掩模误伤。此前列出的粉边问题与 doudou 施招手形问题，可以按本次静态图复核范围关闭；不建议为只有放大后才留意到的极细混边继续返工。

这是对最新实际使用路径的复核：
- assets/partners/ramen.png、firefly.png、soup.png、doudou-cast.png
- package-street/assets/art/twine-sprite.png、paper-lion.png、paper-lion-phase2.png
- package-bridge/assets/art/rain-knot.png
- package-market/assets/art/market-usher.png、bell-warden.png、bell-warden-phase2.png

没有以 production 键色母稿替代运行 PNG；来源尺寸与 SHA-256 已写入 sources.json。

## 逐项结果

| 范围 | 结果 |
|---|---|
| market-usher | 原衣摆折口粉点在 1x/2x 深浅底均不再突出；衣摆边缘连续，游离 C 卷未再出现。 |
| twine-sprite / rain-knot | 指定线穗、纸穗外缘没有影响轮廓识别的残粉。纤维端部与绳环主体保留；不将极细混边列为新返工项。 |
| paper-lion / paper-lion-phase2 | 尾部空隙与鬃片间旧粉缝已消除到可用程度；红绳、印纹、尾片和鬃片仍保留。 |
| bell-warden / bell-warden-phase2 | 红绳旁旧粉色小孔不再形成醒目色点；绳结与邻近金属/纸片未见断裂。 |
| ramen idle | 漏勺网孔能透出深浅底，铜沿与网丝保留，没有显著粉底。 |
| firefly idle | 杆侧、下臂边缘无显著粉点；工具杆仍连续。 |
| soup idle | 锅底挂绳孔无显著粉点，红绳与铜珠保留。 |
| doudou cast | 1x 能读出左上握工具手及盆底左侧托盆手。2x 确认旧盆底右侧指形已并回连续叶片，没有第三只手的清楚轮廓。 |

## 证据

- enemies-light-1x.png / enemies-dark-1x.png：7 张敌人，按原 PNG 像素尺寸合成
- partners-light-1x.png / partners-dark-1x.png：4 张伙伴，按原 PNG 像素尺寸合成
- focus-light-2x.png / focus-dark-2x.png：10 张旧问题坐标局部，最近邻放大 2 倍
- doudou-cast-2x.png：完整施招图 2 倍深浅底对照
- sources.json：本次实际文件路径、尺寸、SHA-256

证据图已全部使用 view_image 实际查看。此处“1x”指文件像素 1:1 合成，“2x”指最近邻放大，并非原生页面显示比例。没有操作模拟器、修改业务代码或资源，也没有重新生成图片。结论仅覆盖这 11 张的指定局部与主体连续性，不外推为所有资源、动态演出或真机通过。

