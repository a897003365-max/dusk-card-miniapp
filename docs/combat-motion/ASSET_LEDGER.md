# 战斗动作资产清单

快照：2026-09-10。状态集合固定为 `enter`、`attack`、`guard`、`hurt`、`exit`、`control`、`buff`、`debuff`。每一行身份应有一个母稿、8 个 `frames`、8 个 `runtime`，并同步到表中的生产目录。

通用路径模式：

```text
母稿：masters/<id>-sheet.png
提示词：prompts/<id>.txt
中间帧：frames/<id>/<state>.png
运行帧：runtime/<id>/<state>.png
```

## 伙伴清单

提示词列是本次目录的只读扫描结果。`有`表示存在同名 `prompts/<id>.txt`；本轮 28 份已全部归档。

| ID | 分组 | 提示词 | 生产同步目录 | 帧数 | 备注 |
| --- | --- | --- | --- | ---: | --- |
| `sheep` | a | 有 | `package-actors-a/assets/sheep/` | 8 |  |
| `ramen` | a | 有 | `package-actors-a/assets/ramen/` | 8 |  |
| `sunset` | a | 有 | `package-actors-a/assets/sunset/` | 8 |  |
| `ticket` | a | 有 | `package-actors-a/assets/ticket/` | 8 |  |
| `catcafe` | a | 有 | `package-actors-a/assets/catcafe/` | 8 |  |
| `moon` | a | 有 | `package-actors-a/assets/moon/` | 8 |  |
| `nav` | a | 有 | `package-actors-a/assets/nav/` | 8 |  |
| `tea` | a | 有 | `package-actors-a/assets/tea/` | 8 |  |
| `sushi` | b | 有 | `package-actors-b/assets/sushi/` | 8 |  |
| `pear` | b | 有 | `package-actors-b/assets/pear/` | 8 |  |
| `burger` | b | 有 | `package-actors-b/assets/burger/` | 8 |  |
| `badminton` | b | 有 | `package-actors-b/assets/badminton/` | 8 |  |
| `bomb` | b | 有 | `package-actors-b/assets/bomb/` | 8 |  |
| `orangecat` | b | 有 | `package-actors-b/assets/orangecat/` | 8 |  |
| `doudou` | b | 有 | `package-actors-b/assets/doudou/` | 8 |  |
| `hydrangea` | c | 有 | `package-actors-c/assets/hydrangea/` | 8 |  |
| `pearlamp` | c | 有 | `package-actors-c/assets/pearlamp/` | 8 |  |
| `cloudmail` | c | 有 | `package-actors-c/assets/cloudmail/` | 8 |  |
| `firefly` | c | 有 | `package-actors-c/assets/firefly/` | 8 |  |
| `soup` | c | 有 | `package-actors-c/assets/soup/` | 8 |  |
| `blanket` | c | 有 | `package-actors-c/assets/blanket/` | 8 |  |
| `seedling` | c | 有 | `package-actors-c/assets/seedling/` | 8 |  |

伙伴合计：22 个身份、176 个状态帧。22 份同名伙伴 prompt 均已归档。

## Boss 与阶段清单

Boss 的 phase2 是独立身份目录和独立 8 格母稿，不能回退到 phase1 的动作路径。

| ID | 地区 | 提示词 | 生产同步目录 | 帧数 |
| --- | --- | --- | --- | ---: |
| `paper-lion` | street | 有 | `package-street/assets/actions/paper-lion/` | 8 |
| `paper-lion-phase2` | street | 有 | `package-street/assets/actions/paper-lion-phase2/` | 8 |
| `ink-tide` | bridge | 有 | `package-bridge/assets/actions/ink-tide/` | 8 |
| `ink-tide-phase2` | bridge | 有 | `package-bridge/assets/actions/ink-tide-phase2/` | 8 |
| `bell-warden` | market | 有 | `package-market/assets/actions/bell-warden/` | 8 |
| `bell-warden-phase2` | market | 有 | `package-market/assets/actions/bell-warden-phase2/` | 8 |

Boss 合计：6 个身份/阶段、48 个状态帧。伙伴与 Boss 合计 28 个身份/阶段、224 个 `frames` 和 224 个 `runtime` 文件。

## 生产前检查记录

- `frames/`：224 个 PNG，28 个身份均为 8/8。
- `runtime/`：224 个 PNG，28 个身份均为 8/8。
- 同步目标：22 位伙伴进入 `package-actors-a/b/c`；6 个 Boss 阶段进入 street、bridge、market 地区包，当前统计均存在。
- 旧 cast：22 个 `*-cast.png` 已移到 `legacy-casts/`；主包 `assets/partners/` 当前保留 22 张 idle PNG。
- 构建约束：`node scripts/build-action-art.js` 的报告必须满足每个身份 `foregroundPixels === assignedPixels`；构建参数为 256px / 128 色。
- 顺序约束：每个目录的 8 个文件按 `enter → attack → guard → hurt → exit → control → buff → debuff` 使用，不能按文件系统排序推断语义。
- 预算快照：`/tmp/dusk-actions-complete-budget.json` 中 main、三个地区包和三个伙伴动作包均为 `PASS`。具体数字见 [README.md](README.md)。
- 原生验收：三地区隔离验收已通过，正式工程窗口最后核验待 Mac 解锁；详见 [原生验收索引](../验收/2026-09-10-战斗八状态/README.md)。

## 维护顺序

母稿或提示词发生变化时，先更新 `masters/` 和 `prompts/`，再运行构建并检查前景分配、8 格顺序、alpha 和尺寸，最后运行同步脚本。不要直接编辑 `frames/`、`runtime/` 或已同步包内的派生 PNG，也不要用裁切掩盖跨格前景。若身份 ID、分组或 Boss 地区变化，必须同时检查 `utils/action-art.js`、`utils/combat-content.js`、构建目录和同步目录。
