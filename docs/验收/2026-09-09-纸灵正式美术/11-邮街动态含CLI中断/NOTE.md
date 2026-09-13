# 动作采样通过，完整流程被工具中断

本段实际记录 enemyHit、enemyStrike、enemyFold、enemySpell 四类变换；退场期间读到已落库星线。流程在第二站选择目标时遇到开发者工具 APPID_ERROR / TLS 建连中断，故总状态保留 fail。尚未完成该次出牌确认，不将37条局部检查写成完整副本通过。后续先读取真实状态，再使用 --resume 正常接续。
