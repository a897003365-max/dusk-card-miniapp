# 原创音频资产台账

## 来源与复建

- 生成入口：`node scripts/build-audio.js`
- 原始母稿：`docs/audio/masters/music/*.wav`、`docs/audio/masters/sfx/*.wav`
- 生成方式：本机 Node.js 标准库合成单声道 22050Hz/16-bit PCM；木质拨弦、持续弦音、低音、呼吸噪声、胜负反馈均为脚本内原创加法合成，噪声使用固定种子，结果可复建。
- MP3 派生：本机 `/opt/homebrew/bin/ffmpeg` 的 `libmp3lame`，不下载、不引用现成曲目、第三方采样或版权不明素材。
- 音量边界：本次重编后，`ffmpeg volumedetect` 检查的 6 首音乐峰值均为 `-8.4dBFS`；SFX 峰值为 `-20.5dBFS`（select）及 `-15.2dBFS` 至 `-6.9dBFS`（其余），胜负音均为 `-9.8dBFS`，未见削波。运行时总音量由管理器控制，本目录不写运行时音量策略。
- 循环边界：WAV 母稿统一首末样本为 0，末端经过 80ms 淡出；音乐时长为 18s、14s 或 24s，适合短循环播放。音乐母稿最后 20ms 的最大绝对 PCM 值为 `0.02380`（boss），首末样本跳变为 0，未见边界爆音。

## 音乐

| ID | 用途 | 时长 | MP3 | 体积 | 母稿 |
| --- | --- | ---: | ---: | ---: | --- |
| town | 主包城镇 | 18.000s | `/assets/audio/town.mp3` | 72,534 B | `docs/audio/masters/music/town.wav` |
| letter | 主包信件/安静界面 | 18.000s | `/assets/audio/letter.mp3` | 72,534 B | `docs/audio/masters/music/letter.wav` |
| boss | 主包首领战 | 14.000s | `/assets/audio/boss.mp3` | 56,443 B | `docs/audio/masters/music/boss.wav` |
| street | 黄昏邮街 | 24.000s | `/package-street/assets/audio/theme.mp3` | 96,462 B | `docs/audio/masters/music/street.wav` |
| bridge | 雨巷旧桥 | 24.000s | `/package-bridge/assets/audio/theme.mp3` | 96,462 B | `docs/audio/masters/music/bridge.wav` |
| market | 夜行灯市 | 24.000s | `/package-market/assets/audio/theme.mp3` | 96,462 B | `docs/audio/masters/music/market.wav` |

主包音乐合计 `201,511 B / 196.79 KiB`；加 16 条 SFX 后主包音频合计 `230,955 B / 225.54 KiB`；三首地区音乐各 `96,462 B / 94.20 KiB`。音乐均按目标单声道约 32kbps 编码。

### 本次音乐参数

| ID | 速度与循环结构 | 主要声部 |
| --- | --- | --- |
| town | 80 BPM，4/4，6 小节 / 18s | 木质拨弦主句、低音根音、稀疏持续和弦 |
| letter | 80 BPM，4/4，6 小节 / 18s | 留白弦音、低音持续、柔和呼吸与长音回答 |
| boss | 约 68.6 BPM，4/4，4 小节 / 14s；A natural minor | 低音持续、庄重木拨弦、慢速上方张力音；Am/F/Dsus/Am |
| street | 80 BPM，4/4，8 小节 / 24s | 旧街民谣木拨弦、低音行走、句尾休止 |
| bridge | 80 BPM，4/4，8 小节 / 24s；D natural minor | 细噪呼吸、低动态和声、稀疏漂浮句；Dm/Bb/F/Cm |
| market | 80 BPM，4/4，8 小节 / 24s | 温和木拨弦切分、低音行走、短回答句 |

## 音效

SFX 均为单声道短音，名义编码目标 16kbps；实际 MP3 体积由编码帧取整决定。

| ID | 时长 | MP3 | 体积 | 母稿 |
| --- | ---: | ---: | ---: | --- |
| select | 0.180s | `/assets/audio/sfx/select.mp3` | 697 B | `docs/audio/masters/sfx/select.wav` |
| card | 0.320s | `/assets/audio/sfx/card.mp3` | 1,011 B | `docs/audio/masters/sfx/card.wav` |
| attack | 0.500s | `/assets/audio/sfx/attack.mp3` | 1,377 B | `docs/audio/masters/sfx/attack.wav` |
| hit | 0.220s | `/assets/audio/sfx/hit.mp3` | 802 B | `docs/audio/masters/sfx/hit.wav` |
| guard | 0.300s | `/assets/audio/sfx/guard.mp3` | 959 B | `docs/audio/masters/sfx/guard.wav` |
| heal | 0.600s | `/assets/audio/sfx/heal.mp3` | 1,533 B | `docs/audio/masters/sfx/heal.wav` |
| buff | 0.700s | `/assets/audio/sfx/buff.mp3` | 1,742 B | `docs/audio/masters/sfx/buff.wav` |
| debuff | 0.500s | `/assets/audio/sfx/debuff.mp3` | 1,377 B | `docs/audio/masters/sfx/debuff.wav` |
| shuffle | 0.800s | `/assets/audio/sfx/shuffle.mp3` | 1,951 B | `docs/audio/masters/sfx/shuffle.wav` |
| summon | 0.900s | `/assets/audio/sfx/summon.mp3` | 2,160 B | `docs/audio/masters/sfx/summon.wav` |
| rare | 0.750s | `/assets/audio/sfx/rare.mp3` | 1,847 B | `docs/audio/masters/sfx/rare.wav` |
| reward | 0.700s | `/assets/audio/sfx/reward.mp3` | 1,742 B | `docs/audio/masters/sfx/reward.wav` |
| chest | 1.000s | `/assets/audio/sfx/chest.mp3` | 2,369 B | `docs/audio/masters/sfx/chest.wav` |
| victory | 1.800s | `/assets/audio/sfx/victory.mp3` | 3,937 B | `docs/audio/masters/sfx/victory.wav` |
| defeat | 1.600s | `/assets/audio/sfx/defeat.mp3` | 3,571 B | `docs/audio/masters/sfx/defeat.wav` |
| phase | 1.000s | `/assets/audio/sfx/phase.mp3` | 2,369 B | `docs/audio/masters/sfx/phase.wav` |

## 试听与质量边界

本批已接入微信小程序的场景音乐与事件音效管理器。旧音频版本曾通过微信开发者工具的原生播放回调与时长读取检查；本次重编后的 22 个 MP3 目前只完成本机脚本复建、解码、时长、格式、峰值和循环边界检查，新的 CLI 播放验收由交付 Agent 另行执行。

本机数值检查覆盖音量、淡出、时长、格式和包体；模拟器不能代替真机听感、手机静音键和系统混音验收。本轮手机修复将音乐运行音量调整为 0.32，SFX 为 0.75，每个战斗节拍最多一条主要反馈。
