# 晚霞来信形象资产清单（dusk-card-miniapp）

本清单用于“重构形象”盘点，不包含运行文件改动。当前共 22 伙伴、88 张稀有图（R / SR / SSR / UR）。

## 运行引用范围与来源

以下是当前伙伴图像在运行链路中的实际引用点（按要求对应到 
`utils/game/content/combat`、`pages` 与 `manifest`）：

- `utils/content.js`
  - `FAMILIES` 仅定义伙伴 ID/名称/角色/特征（语义主题）、剧情文本。
- `utils/game.js`
  - `getFamily()` 组装四档路径：`/assets/prizes/${id}/${tier}.png`
  - `draw()` 返回抽卡项 `image`。
- `utils/combat.js`
  - `memberView()`、`getAdventureView()` 产出伙伴展示路径：`/assets/prizes/${member.id}/${member.tier}.png`
- `assets/battle/manifest.js`
  - `heroes` 为所有伙伴写死 R 档（`idle`/`cast`）
- `utils/expedition-page.js` + `templates/expedition.wxml`
  - 冒险界面读取 `art.heroes[id].idle|cast`，以及 `art.scenes` 的背景/前景（当前 scenes 为空）
- `pages/home/index.js`、`pages/home/index.wxml`
  - 抽卡结果 `item.image` 与 3 个静态示例图。
- `pages/story/index.js`、`pages/story/index.wxml`
  - 引导图片 `guideImage: /assets/prizes/${chapter.guide}/SR.png`
  - 剧情页队伍成员头像使用 `item.image`。
- `pages/collection/index.js`、`pages/collection/index.wxml`
  - 图鉴/详情页使用 `detail.image`、`previewImage`、`item.image`。
- `pages/adventure/index.js`、`pages/adventure/index.wxml`
  - 冒险页队伍/关卡显示走当前 `item.image`（来自 `combat.getAdventureView` 与 `game.getFamily`）。

## 伙伴资产映射（22 位）

| ID | 名称 | 语义主题 | 现图路径（现用路径） | 替换需涉及的源文件 |
| --- | --- | --- | --- | --- |
| sheep | 羊咩咩团 | 倾听者 | `/assets/prizes/sheep/R.png`、`/assets/prizes/sheep/SR.png`、`/assets/prizes/sheep/SSR.png`、`/assets/prizes/sheep/UR.png` | `assets/prizes/sheep/*.png`、`utils/content.js`、`utils/game.js`、`utils/combat.js`、`assets/battle/manifest.js`（R 档）、`pages/home/index.wxml`、`pages/story/index.wxml`、`pages/story/index.js`、`pages/collection/index.wxml`、`pages/collection/index.js`、`pages/adventure/index.js`、`pages/adventure/index.wxml`、`templates/expedition.wxml`、`utils/expedition-page.js` |
| ramen | 拉面猫 | 汤面师 | `/assets/prizes/ramen/R.png`、`/assets/prizes/ramen/SR.png`、`/assets/prizes/ramen/SSR.png`、`/assets/prizes/ramen/UR.png` | `assets/prizes/ramen/*.png`、`utils/content.js`、`utils/game.js`、`utils/combat.js`、`assets/battle/manifest.js`（R 档）、`pages/story/index.wxml`、`pages/story/index.js`、`pages/collection/index.wxml`、`pages/collection/index.js`、`pages/adventure/index.js`、`pages/adventure/index.wxml`、`templates/expedition.wxml`、`utils/expedition-page.js` |
| sunset | 晚霞云 | 拾光员 | `/assets/prizes/sunset/R.png`、`/assets/prizes/sunset/SR.png`、`/assets/prizes/sunset/SSR.png`、`/assets/prizes/sunset/UR.png` | `assets/prizes/sunset/*.png`、`utils/content.js`、`utils/game.js`、`utils/combat.js`、`assets/battle/manifest.js`（R 档）、`pages/story/index.wxml`、`pages/story/index.js`、`pages/collection/index.wxml`、`pages/collection/index.js`、`pages/adventure/index.js`、`pages/adventure/index.wxml`、`templates/expedition.wxml`、`utils/expedition-page.js` |
| ticket | 票根小狐 | 放映员 | `/assets/prizes/ticket/R.png`、`/assets/prizes/ticket/SR.png`、`/assets/prizes/ticket/SSR.png`、`/assets/prizes/ticket/UR.png` | `assets/prizes/ticket/*.png`、`utils/content.js`、`utils/game.js`、`utils/combat.js`、`assets/battle/manifest.js`（R 档）、`pages/story/index.wxml`、`pages/story/index.js`、`pages/collection/index.wxml`、`pages/collection/index.js`、`pages/adventure/index.js`、`pages/adventure/index.wxml`、`templates/expedition.wxml`、`utils/expedition-page.js` |
| catcafe | 猫咖团子 | 暖饮师 | `/assets/prizes/catcafe/R.png`、`/assets/prizes/catcafe/SR.png`、`/assets/prizes/catcafe/SSR.png`、`/assets/prizes/catcafe/UR.png` | `assets/prizes/catcafe/*.png`、`utils/content.js`、`utils/game.js`、`utils/combat.js`、`assets/battle/manifest.js`（R 档）、`pages/story/index.wxml`、`pages/story/index.js`、`pages/collection/index.wxml`、`pages/collection/index.js`、`pages/adventure/index.js`、`pages/adventure/index.wxml`、`templates/expedition.wxml`、`utils/expedition-page.js` |
| moon | 月亮兔 | 观星员 | `/assets/prizes/moon/R.png`、`/assets/prizes/moon/SR.png`、`/assets/prizes/moon/SSR.png`、`/assets/prizes/moon/UR.png` | `assets/prizes/moon/*.png`（含 `pages/home/index.wxml` 有静态 SR 示例）、`utils/content.js`、`utils/game.js`、`utils/combat.js`、`assets/battle/manifest.js`（R 档）、`pages/home/index.wxml`、`pages/story/index.wxml`、`pages/story/index.js`、`pages/collection/index.wxml`、`pages/collection/index.js`、`pages/adventure/index.js`、`pages/adventure/index.wxml`、`templates/expedition.wxml`、`utils/expedition-page.js` |
| nav | 领航小鸭 | 引路人 | `/assets/prizes/nav/R.png`、`/assets/prizes/nav/SR.png`、`/assets/prizes/nav/SSR.png`、`/assets/prizes/nav/UR.png` | `assets/prizes/nav/*.png`、`utils/content.js`、`utils/game.js`、`utils/combat.js`、`assets/battle/manifest.js`（R 档）、`pages/story/index.wxml`、`pages/story/index.js`、`pages/collection/index.wxml`、`pages/collection/index.js`、`pages/adventure/index.js`、`pages/adventure/index.wxml`、`templates/expedition.wxml`、`utils/expedition-page.js` |
| tea | 奶茶熊 | 歇脚客 | `/assets/prizes/tea/R.png`、`/assets/prizes/tea/SR.png`、`/assets/prizes/tea/SSR.png`、`/assets/prizes/tea/UR.png` | `assets/prizes/tea/*.png`、`utils/content.js`、`utils/game.js`、`utils/combat.js`、`assets/battle/manifest.js`（R 档）、`pages/story/index.wxml`、`pages/story/index.js`、`pages/collection/index.wxml`、`pages/collection/index.js`、`pages/adventure/index.js`、`pages/adventure/index.wxml`、`templates/expedition.wxml`、`utils/expedition-page.js` |
| sushi | 寿司海豹 | 潮汐客 | `/assets/prizes/sushi/R.png`、`/assets/prizes/sushi/SR.png`、`/assets/prizes/sushi/SSR.png`、`/assets/prizes/sushi/UR.png` | `assets/prizes/sushi/*.png`、`utils/content.js`、`utils/game.js`、`utils/combat.js`、`assets/battle/manifest.js`（R 档）、`pages/story/index.wxml`、`pages/story/index.js`、`pages/collection/index.wxml`、`pages/collection/index.js`、`pages/adventure/index.js`、`pages/adventure/index.wxml`、`templates/expedition.wxml`、`utils/expedition-page.js` |
| pear | 小梨挂件 | 收集家 | `/assets/prizes/pear/R.png`、`/assets/prizes/pear/SR.png`、`/assets/prizes/pear/SSR.png`、`/assets/prizes/pear/UR.png` | `assets/prizes/pear/*.png`、`utils/content.js`、`utils/game.js`、`utils/combat.js`、`assets/battle/manifest.js`（R 档）、`pages/story/index.wxml`、`pages/story/index.js`、`pages/collection/index.wxml`、`pages/collection/index.js`、`pages/adventure/index.js`、`pages/adventure/index.wxml`、`templates/expedition.wxml`、`utils/expedition-page.js` |
| burger | 汉堡柴 | 跑腿员 | `/assets/prizes/burger/R.png`、`/assets/prizes/burger/SR.png`、`/assets/prizes/burger/SSR.png`、`/assets/prizes/burger/UR.png` | `assets/prizes/burger/*.png`、`utils/content.js`、`utils/game.js`、`utils/combat.js`、`assets/battle/manifest.js`（R 档）、`pages/story/index.wxml`、`pages/story/index.js`、`pages/collection/index.wxml`、`pages/collection/index.js`、`pages/adventure/index.js`、`pages/adventure/index.wxml`、`templates/expedition.wxml`、`utils/expedition-page.js` |
| badminton | 羽球啾 | 追风手 | `/assets/prizes/badminton/R.png`、`/assets/prizes/badminton/SR.png`、`/assets/prizes/badminton/SSR.png`、`/assets/prizes/badminton/UR.png` | `assets/prizes/badminton/*.png`、`utils/content.js`、`utils/game.js`、`utils/combat.js`、`assets/battle/manifest.js`（R 档）、`pages/story/index.wxml`、`pages/story/index.js`、`pages/collection/index.wxml`、`pages/collection/index.js`、`pages/adventure/index.js`、`pages/adventure/index.wxml`、`templates/expedition.wxml`、`utils/expedition-page.js` |
| bomb | 外焦里嫩弹 | 点心师 | `/assets/prizes/bomb/R.png`、`/assets/prizes/bomb/SR.png`、`/assets/prizes/bomb/SSR.png`、`/assets/prizes/bomb/UR.png` | `assets/prizes/bomb/*.png`、`utils/content.js`、`utils/game.js`、`utils/combat.js`、`assets/battle/manifest.js`（R 档）、`pages/story/index.wxml`、`pages/story/index.js`、`pages/collection/index.wxml`、`pages/collection/index.js`、`pages/adventure/index.js`、`pages/adventure/index.wxml`、`templates/expedition.wxml`、`utils/expedition-page.js` |
| orangecat | 橘猫豆包 | 探路客 | `/assets/prizes/orangecat/R.png`、`/assets/prizes/orangecat/SR.png`、`/assets/prizes/orangecat/SSR.png`、`/assets/prizes/orangecat/UR.png` | `assets/prizes/orangecat/*.png`（含 `pages/home/index.wxml` 有静态 SSR 示例）、`utils/content.js`、`utils/game.js`、`utils/combat.js`、`assets/battle/manifest.js`（R 档）、`pages/home/index.wxml`、`pages/story/index.wxml`、`pages/story/index.js`、`pages/collection/index.wxml`、`pages/collection/index.js`、`pages/adventure/index.js`、`pages/adventure/index.wxml`、`templates/expedition.wxml`、`utils/expedition-page.js` |
| doudou | 豆豆花盆 | 育苗人 | `/assets/prizes/doudou/R.png`、`/assets/prizes/doudou/SR.png`、`/assets/prizes/doudou/SSR.png`、`/assets/prizes/doudou/UR.png` | `assets/prizes/doudou/*.png`、`utils/content.js`、`utils/game.js`、`utils/combat.js`、`assets/battle/manifest.js`（R 档）、`pages/story/index.wxml`、`pages/story/index.js`、`pages/collection/index.wxml`、`pages/collection/index.js`、`pages/adventure/index.js`、`pages/adventure/index.wxml`、`templates/expedition.wxml`、`utils/expedition-page.js` |
| hydrangea | 绣球花球 | 园丁 | `/assets/prizes/hydrangea/R.png`、`/assets/prizes/hydrangea/SR.png`、`/assets/prizes/hydrangea/SSR.png`、`/assets/prizes/hydrangea/UR.png` | `assets/prizes/hydrangea/*.png`、`utils/content.js`、`utils/game.js`、`utils/combat.js`、`assets/battle/manifest.js`（R 档）、`pages/story/index.wxml`、`pages/story/index.js`、`pages/collection/index.wxml`、`pages/collection/index.js`、`pages/adventure/index.js`、`pages/adventure/index.wxml`、`templates/expedition.wxml`、`utils/expedition-page.js` |
| pearlamp | 梨灯精 | 守灯人 | `/assets/prizes/pearlamp/R.png`、`/assets/prizes/pearlamp/SR.png`、`/assets/prizes/pearlamp/SSR.png`、`/assets/prizes/pearlamp/UR.png` | `assets/prizes/pearlamp/*.png`、`utils/content.js`、`utils/game.js`、`utils/combat.js`、`assets/battle/manifest.js`（R 档）、`pages/story/index.wxml`、`pages/story/index.js`、`pages/collection/index.wxml`、`pages/collection/index.js`、`pages/adventure/index.js`、`pages/adventure/index.wxml`、`templates/expedition.wxml`、`utils/expedition-page.js` |
| cloudmail | 云朵邮差 | 送信人 | `/assets/prizes/cloudmail/R.png`、`/assets/prizes/cloudmail/SR.png`、`/assets/prizes/cloudmail/SSR.png`、`/assets/prizes/cloudmail/UR.png` | `assets/prizes/cloudmail/*.png`（含 `pages/home/index.wxml` 有静态 UR 示例）、`utils/content.js`、`utils/game.js`、`utils/combat.js`、`assets/battle/manifest.js`（R 档）、`pages/home/index.wxml`、`pages/story/index.wxml`、`pages/story/index.js`、`pages/collection/index.wxml`、`pages/collection/index.js`、`pages/adventure/index.js`、`pages/adventure/index.wxml`、`templates/expedition.wxml`、`utils/expedition-page.js` |
| firefly | 路灯萤火 | 夜行客 | `/assets/prizes/firefly/R.png`、`/assets/prizes/firefly/SR.png`、`/assets/prizes/firefly/SSR.png`、`/assets/prizes/firefly/UR.png` | `assets/prizes/firefly/*.png`、`utils/content.js`、`utils/game.js`、`utils/combat.js`、`assets/battle/manifest.js`（R 档）、`pages/story/index.wxml`、`pages/story/index.js`、`pages/collection/index.wxml`、`pages/collection/index.js`、`pages/adventure/index.js`、`pages/adventure/index.wxml`、`templates/expedition.wxml`、`utils/expedition-page.js` |
| soup | 暖汤锅仔 | 掌勺人 | `/assets/prizes/soup/R.png`、`/assets/prizes/soup/SR.png`、`/assets/prizes/soup/SSR.png`、`/assets/prizes/soup/UR.png` | `assets/prizes/soup/*.png`、`utils/content.js`、`utils/game.js`、`utils/combat.js`、`assets/battle/manifest.js`（R 档）、`pages/story/index.wxml`、`pages/story/index.js`、`pages/collection/index.wxml`、`pages/collection/index.js`、`pages/adventure/index.js`、`pages/adventure/index.wxml`、`templates/expedition.wxml`、`utils/expedition-page.js` |
| blanket | 星光毯卷 | 织梦人 | `/assets/prizes/blanket/R.png`、`/assets/prizes/blanket/SR.png`、`/assets/prizes/blanket/SSR.png`、`/assets/prizes/blanket/UR.png` | `assets/prizes/blanket/*.png`、`utils/content.js`、`utils/game.js`、`utils/combat.js`、`assets/battle/manifest.js`（R 档）、`pages/story/index.wxml`、`pages/story/index.js`、`pages/collection/index.wxml`、`pages/collection/index.js`、`pages/adventure/index.js`、`pages/adventure/index.wxml`、`templates/expedition.wxml`、`utils/expedition-page.js` |
| seedling | 晚霞籽精 | 播种员 | `/assets/prizes/seedling/R.png`、`/assets/prizes/seedling/SR.png`、`/assets/prizes/seedling/SSR.png`、`/assets/prizes/seedling/UR.png` | `assets/prizes/seedling/*.png`、`utils/content.js`、`utils/game.js`、`utils/combat.js`、`assets/battle/manifest.js`（R 档）、`pages/story/index.wxml`、`pages/story/index.js`、`pages/collection/index.wxml`、`pages/collection/index.js`、`pages/adventure/index.js`、`pages/adventure/index.wxml`、`templates/expedition.wxml`、`utils/expedition-page.js` |

## 图片数量验收

- 伙伴数：`22`
- 稀有度档位：`R / SR / SSR / UR`（4 档）
- 资产总数：`22 × 4 = 88`
- 文件实际存在：`88`（已验证，`assets/prizes` 目录下完整）

## 静态锚定图（非动态生成）

- `/assets/prizes/moon/SR.png`（首页示例卡片）
- `/assets/prizes/orangecat/SSR.png`（首页示例卡片）
- `/assets/prizes/cloudmail/UR.png`（首页示例卡片）

## 可用本地图片压缩工具（仅输出可用路径）

- `sips`：`/usr/bin/sips`
- `cwebp`：`/opt/homebrew/bin/cwebp`
- `pngquant`：未检测到（not found）
- `sharp`：未检测到（`node` 模块未安装）
