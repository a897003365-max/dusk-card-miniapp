# 美术资产与参考记录

## 授权与用途

本轮授权依据是 [TASK_BRIEF.md](../TASK_BRIEF.md) 记录的用户批准：生成原创角色、敌人、插画与分层背景，先看水彩街巷、纸艺灯影、绒偶微缩三份方向样板，选定后再扩展整套素材。已有公仔图的角色为身份参考，图片本身不贴入场景。全部场景是虚构世界创作。

## 本地身份参考

| 角色 | 路径 | 本轮保留的身份特征 |
| --- | --- | --- |
| 羊咩咩团 | `assets/prizes/sheep/R.png` | 奶油卷绒头罩、深棕圆脸、垂耳、大黑眼、矮圆身形 |
| 橘猫豆包 | `assets/prizes/orangecat/R.png` | 橘色虎斑、奶油脸胸与四爪、黑眼、蓬松条纹尾 |
| 领航小鸭 | `assets/prizes/nav/R.png` | 奶油圆鸟脸、小黄喙、黑眼、棕色圆徽记帽 |

三份参考图均来自当前用户项目，获准用于本轮角色身份参考，生成前已逐张 `view_image` 检查。本地图库只有收藏形态，缺少三种工艺下的完整战斗场景；本轮按已批准的原创生成路线补齐所需素材。没有选用或拼入外部角色、游戏 IP、建筑照片或贴图。

## 方法与材质参考

- 风格库实际读取 `/Users/maizi/.codex/skills/gpt-image-2-style-library/references/style-library.md`，共同使用 `Scene Storytelling / 场景叙事`（`scene-storytelling`，case 330）的方法，先定人物、地点、冲突和机位，再变化材质。A 参考 `Illustration & Art Style` 对笔触与身份的约束；B、C 参考 `3D Collectible Toy` 对材质、脸和配饰锚点的约束。以上是提示方法，未复制库中图片。
- Victor Design 实际读取 aesthetic-core、style-evidence、density-and-care、image-role-routing、poster、execution、three-gates、production-toolkit，实际查看 `assets/benchmarks/poster-board-1.png`。仅采用明确主体关系、密集区与安静区分工、材料受光和接触的判断方法。当前载体是用户明确要求的无字战斗插画样板，海报文字层级及 HTML/Figma 交付规则不用于替换这个载体。
- 辅助工艺检索：[National Gallery Singapore 的吴冠中作品资料](https://www.nationalgallery.sg/content/dam/media-releases/explore-new-perspectives-travel-national-gallery-singapores-first-exhibition-co-created/Explore%20new%20perspectives%20of%20travel%20with%20National%20Gallery%20Singapore%27s%20first%20exhibition%20co-created%20with%20docents.pdf)、[LAIKA 官方纤维手作材料说明](https://shop.laika.com/products/coraline-curious-creator-kit)。只作建筑语言和材质常识检索，没有将这些页面的图像或已有作品人物放入生成参考。

## 生成记录

工具统一为内置 `image_gen__imagegen`。提示词与 PNG 母稿在 `directions/`，原始生成输出保留在工具默认目录。

| 母稿 | 原始输出 | 修正 |
| --- | --- | --- |
| `directions/A-watercolor-alley.png` | `/Users/maizi/.codex/generated_images/01a07999-f4b1-75f3-81f0-1544a1c20c02/exec-93f600d5-e134-4f05-bcbf-643ea8f391e2.png` | 无 |
| `directions/B-paper-lantern.png` | `/Users/maizi/.codex/generated_images/01a07999-f4b1-75f3-81f0-1544a1c20c02/exec-cee31c2e-2655-44fa-a3aa-734a2b868307.png` | 无 |
| `directions/C-plush-miniature.png` | `/Users/maizi/.codex/generated_images/01a07999-f4b1-75f3-81f0-1544a1c20c02/exec-212e6ce4-1633-47c0-ac71-b17542494733.png` | 木牌去字、猫尾上翘；初稿 `exec-1cec0bae-ab94-4c00-800d-85aefd7b7300.png` 保留在同一工具目录 |

三张输出均为 1536 × 1024，无压缩覆盖。当前没有剪裁、代码图替代插画、生成图冒充事实证据或批量资产批准。
