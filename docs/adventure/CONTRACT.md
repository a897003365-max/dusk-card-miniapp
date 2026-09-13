# 冒险模块协作接口

目标：已批准的三人手动卡牌、3区域×3难度、9节点、22伙伴、74张远行固定牌＋6种临时机会牌、18遗物、21敌人，原生微信小程序。原项目不修改。

## 内容（utils/combat-content.js）

导出 `FIGHTERS`（按familyId索引）、`CARDS`（74张远行固定牌数组）、`OPPORTUNITY_CARDS`（6张临时机会牌）、`BATTLE_RULES/ENVIRONMENTS`（共享规则）、`RELICS`（数组）、`ENEMIES`（数组）、`REGIONS`（数组）、`DIFFICULTIES`（数组），另导出字典 `CARD_BY_ID/RELIC_BY_ID/ENEMY_BY_ID/REGION_BY_ID`。

- Fighter `{id, role:'guard'|'combo'|'echo', maxHp, passive:{trigger,kind,amount,target,frequency,name,description}, cards:[id,id]}`。trigger只用 `battleStart/turnStart/attack/guard/heal/marked/thirdPlay/kill`；frequency=`turn/battle`；被动不触发其他被动。target=`self/party/enemy/enemies`。
- Card `{id,name,familyId:null|string,role,cost,target,effects,upgradeEffects,description,upgradeDescription,tactic?,exhaust?,retain?,temporary?}`。target=`enemy/ally/self/allEnemies/allAllies`；effects元素 `{kind,amount,target?,minPlays?,environmentId?}`，可用kind仅 `damage/block/heal/draw/energy/charge/mark/weak/burn/counter/echo/retainBlock/environment/cleanse/stripBlock/intercept/discover/scout`。target覆盖=`self/party/enemy/enemies`；默认沿用卡牌目标。74张（每家族2张＋30通用），通用基础牌ID=`strike/guard`。`minPlays:3` 表示当前牌作为本回合第3张或之后才结算该效果；`exhaust` 打出后本战移出循环；`retain` 在回合结束保留手牌。临时机会牌不进入远行牌组或奖励池，均带消耗；字典含80种可查询定义。
- `STARTING_TACTICS` 导出四套 `{id,name,summary,cards}`：`classic.cards=[]` 保留原始3张 `strike`；`relay/reserve/weather` 各按队伍顺序用3张通用牌替换三人的 `strike`。仅替换基础攻击，3张 `guard` 和6张专属牌不变，总数仍为12。
- Relic `{id,name,description,trigger,kind,amount,target,frequency}`，同被动语法，18件。本局获得即生效，随本局结束清空；不增加装备或永久遗物记录。
- Enemy `{id,name,regionId,rank:'normal'|'elite'|'boss',maxHp,patterns:[{kind:'attack'|'block'|'burn'|'weak'|'summon',amount,name,target:'lowest'|'front'|'all',summonId?}],phase2?:{maxHp,patterns},lore}`；12普通、6精英、3双阶段Boss；召唤只引用本区域普通怪，敌方最多3名。
- Region `{id:'street'|'bridge'|'market',name,subtitle,description,bossId,normalIds:[4],eliteIds:[2],events:[{id,title,text,choices:[{id,label,description,heal,threads,upgrade?}]}],palette:{sky,ground,accent}}`。3种地图模板仅顺序不同，均4battle+elite+event+camp+treasure+boss；每层1–2候选，同层类型相同，敌人/奖励流派不同。
- Difficulty `{id:0|1|2,name,hpMultiplier,damageMultiplier,rewardMultiplier,description,affixes:[{id,name,description}]}`；词缀必须在engine真实生效。

## 战斗（utils/combat.js）

独立纯函数，不 require game.js、不调用wx。外层state由game.js维持v2，旧字段不改。冒险字段为 `adventure:{threads:0,levels:{每家族:1},clears:{street:[0,0,0],bridge:[0,0,0],market:[0,0,0]},active:null,lastResult:null}`。

导出：

- `createAdventureProfile()` / `assertAdventure(profile, state)` 校验真实存档边界（新旧主线不能同时进行）。
- `startExpedition(state,regionId,difficulty,seed,tacticId='classic')` → `{state,events}`。选择已拥有全局state.team三人，固定出发等级/稀有度；R/SR/SSR/UR只0/4/8/12%数值差。seed为非零32bit整数，UI默认生成。已进行主线/副本时拒绝另开。
- `applyAction(state, action)` → `{state,events}`。action.type固定：`chooseNode`(nodeId)、`playCard`(cardUid,targetId)、`endTurn`、`tradeCard`(cardUid)、`chooseOpportunity`(choiceId或skip)、`chooseCard`(choiceId或skip)、`chooseRelic`(choiceId)、`chooseEvent`(choiceId)、`rest`、`chooseUpgrade`、`upgradeCard`(cardUid)、`abandon`。camp选择升级通过`chooseUpgrade`切phase，`upgradeCard`正式选卡。
- `previewAction(state, action)` → `{allowed,reason,events,summary}`，通过与执行同一resolver对副本演算，绝不修改入参/RNG。未知候选与改签换入牌身份仅在支付并执行后揭晓，预览只包含公开信息。
- `levelUp(state,familyId)` → `{state,events}`，1–10级，费用10×当前级星线，只能升级已拥有且无在途旅程的伙伴。
- `getAdventureView(state)` → `{regions,threads,party,levels,tactics,run,result}`。UI唯一展示模型，不再另算伤害/奖励。`tactics` 中每套战术的3张牌按当前队伍对应伙伴等级/稀有度生成真实 `{id,name,cost,ownerName,description}`。

run展示字段：`{id,tacticName,regionId,regionName,difficulty,difficultyName,phase,layer,progress,nodes,party,hand,enemies,energy,energyRefill,nextEnergyRefill,bankAtEnd,charge,maxCharge,availableBudget,environmentId,environmentName,interceptorId,interceptorName,pressure,pendingChoice,temporaryCards,turn,plays,drawCount,discardCount,removedCount,deck,relics,choices,event,log,threadsEarned,hint}`；phase仅 `map/startingUpgrade/battle/cardReward/relicReward/event/camp/campUpgrade`。`charge` 一场战斗内上限3，跨己方回合保留；新回合开始时全部加入本回合能量，下一场战斗清零。旧活动存档缺少 `charge/tacticId` 时按 `0/classic` 接受并在下一次动作写入；其他新字段缺少时按null/空数组读取，不在view中写存档。

- `nodes`=全部9层 `[{index,type,label,options:[{id,name,description,role}],visited,chosenId,current}]`。
- party元素 `{id,name,hp,maxHp,block,tier,level,role,passiveName,passiveDescription,statusText,down}`，id=familyId；enemies `{id,definitionId,name,hp,maxHp,block,statusText,intentText,intentTarget,phase,rank}`，id=运行实例ID。
- hand/deck/choices卡牌元素 `{uid,cardId,ownerId,ownerName,name,cost,payment,paymentText,target,description,shortDescription,flavor,role,upgraded,exhaust,retain,temporary,playable,reason,canTrade,tradePayment,tradePaymentText}`。`cost` 始终是印刷费用；`payment`只消耗当前能量，蓄能在下回合释放为额外能量；牌description与shortDescription必须反映当前升级/效果。
- levels中每家族条目 `{id,name,tier,level,cost,owned,canUpgrade,reason,role,roleName,maxHp,nextMaxHp,levelBonus,image,passiveName,passiveDescription,cards:[{id,name,cost,target,role,description,shortDescription,upgradeDescription}]`，用于主页/远行开始界面展示。
- relics/choices遗物 `{id,name,description}`；choices事件 `{id,label,description}`。event `{title,text}`。
- regions元素含内容字段，加 `unlocked,difficulties:[{id,name,unlocked,clears,description,affixes}]`。
- result `{win,reason,regionId,regionName,difficultyName,nodesCleared,threads,tickets}`。结束后active=null,lastResult=结果；主页面可关闭lastResult，无再领奖接口。
- events元素 `{kind,actorId,targetId,amount,text,hpDelta?}`；供UI动画/日志。`hpDelta` 仅在生命变化时出现（`damage/echo/heal/revive` 与 `burn` 的伤害结算）；状态施加（如`mark/weak/block/retainBlock/levelUp`）不带此字段。存档已结算才播放；关界面不重算。

规则：12起始牌=每位战术基础牌+guard+2专属。T1/T2基础补3能量，T3起基础补4；结束回合最多把1点余能存为蓄能(上限3)，下个己方回合开始时蓄能全部转为额外能量，随后能量清零。抽5、手牌上限8；弃牌不足则洗入抽牌堆。保留牌占据手牌上限；消耗牌本战不回洗，远行固定牌下一场恢复，临时机会牌在战斗结束后消失。0费发现、观星及机会补能来源均消耗；机会牌自身不含发现/观星效果，避免免费自生成。倒下者的牌本场暂移出，战胜后25%血归队。普战3选1可跳过且每组至少含1张新战术牌；精英/宝箱3遗物选1；营地35%回血或升1牌。反击仅响应敌主动攻击，不循环；致命受击仍完成此次反击，双方最后单位同时倒下判失败，不发Boss奖励。每节点星线即时入库（普通4/精英8/事件按配置/宝箱8/Boss12，乘难度倍率）；Boss票1/2/3，区域首次额外3。结束副本、失败保留已入库奖励；只在phase转换时结算一次。

新增规则：

- `run.pendingChoice={kind:'discover'|'scout',ownerId,options:[id]}`。发现保存3个机会牌ID；观星保存真实牌顶UID，候选暂离抽牌堆。选择后选中者进手，其余按展示顺序置底；可skip，返回邮局和重新打开不会重抽。pending期间只允许完成选择或结束远行。
- `temporaryCards` 仅保存本战生成实例；与deck共用UID编号，牌堆校验同时覆盖它们和观星候选。倒下者所有可用牌本场退出；胜利后临时实例清空，远行固定牌组不被删除。
- 改签付1点预算，先抽另一张，再把原牌放牌底；不发动原效果、不计plays、不触发连锁。没有其他牌可抽时先拒绝，不收费。
- 雨幕/顺风分别让敌我所有直接伤害-2/+2，先计算环境，再虚弱、标记和护盾；包括回响与反击，不影响灼烧。环境覆盖而不叠加，下个己方回合开始清空。
- 净化对灼烧、虚弱、标记各减少指定层数；破盾只移除护盾，不扣生命。拦截只改写原本指向其他伙伴的下一次敌方主动单体攻击，不拦全体和状态；若原目标本来是拦截者则不消费，下一己方回合开始清空。
- 第9回合起敌方主动攻击+1，此后每2回合再+1；久战加伤包含在同源敌方意图中。仅实际治疗>0才触发治疗被动；击倒被动限卡牌直接伤害（含回响）击倒，不从反击/灼烧扩展自动触发链。

工程分工：内容Agent只写combat-content.js及内容测试；引擎Agent只写combat.js及引擎测试；root负责旧game/app迁移、UI、资源接入与CLI验收；美术Agent负责设计样板与生成资产，未批准样板前不扩量。
