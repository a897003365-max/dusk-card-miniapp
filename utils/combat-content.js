"use strict";

// 战斗结算、牌面文案和状态说明共用这些数值。
const STATUS_RULES = Object.freeze({ markBonus: 2, weakMultiplier: 0.75, echoMultiplier: 0.5, maxCharge: 3 });
const BATTLE_RULES = Object.freeze({
  energyStart: 3,
  energyLate: 4,
  energyGrowthTurn: 3,
  bankLimit: 1,
  tradeCost: 1,
  pressureTurn: 9,
  pressureStep: 2,
});
const ENVIRONMENTS = Object.freeze({
  rain: Object.freeze({ id: "rain", name: "雨幕", damageModifier: -2, description: "双方直接伤害降低2点，持续到下个己方回合开始。" }),
  tailwind: Object.freeze({ id: "tailwind", name: "顺风", damageModifier: 2, description: "双方直接伤害提高2点，持续到下个己方回合开始。" }),
});

// 战斗内容仅使用 CONTRACT.md 约定的效果；升级数组完整替代基础数组。
function effect(kind, amount, target, minPlays) {
  return { kind, amount, ...(target ? { target } : {}), ...(minPlays ? { minPlays } : {}) };
}
function environment(environmentId) { return { kind: "environment", amount: 1, environmentId }; }

const TARGET_NAMES = { enemy: "目标敌人", enemies: "所有敌人", allEnemies: "所有敌人", ally: "目标队友", self: "自身", party: "全队", allAllies: "全队" };
function describeEffect(item, target) {
  const who = TARGET_NAMES[item.target || target];
  const n = item.amount;
  switch (item.kind) {
    case "damage": return `对${who}造成${n}点伤害`;
    case "block": return `${who}获得${n}点护盾`;
    case "heal": return `${who}恢复${n}点生命`;
    case "draw": return `抽${n}张牌`;
    case "energy": return `恢复${n}点能量`;
    case "charge": return `获得${n}层蓄能（上限${STATUS_RULES.maxCharge}层）`;
    case "mark": return `给${who}施加${n}层标记（每次直接伤害额外加${STATUS_RULES.markBonus}，消耗1层）`;
    case "weak": return `给${who}施加${n}回合虚弱（主动伤害降低${(1 - STATUS_RULES.weakMultiplier) * 100}%）`;
    case "burn": return `给${who}施加${n}层灼烧（行动开始无视护盾扣当前层数生命，再减1层）`;
    case "counter": return `${who}本回合每次遭敌主动攻击后反击${n}点伤害`;
    case "echo": return `${who}获得${n}层回响（下一张伤害牌首个伤害效果追加${STATUS_RULES.echoMultiplier * 100}%，消耗1层）`;
    case "retainBlock": return `${who}接下来${n}次回合开始保留护盾`;
    case "cleanse": return `${who}的灼烧、虚弱和标记各减少${n}`;
    case "stripBlock": return `移除${who}${n}点护盾（不造成伤害）`;
    case "intercept": return `${who}本轮拦截下一次指向其他队友的敌方单体主动攻击`;
    case "discover": return `从${n}张随机机会牌中选择1张加入手牌`;
    case "scout": return `查看本牌组顶${n}张牌，选择1张加入手牌，其余依原顺序置于牌组底`;
    case "environment": return `将环境改为${ENVIRONMENTS[item.environmentId].name}：${ENVIRONMENTS[item.environmentId].description.replace(/。$/, "")}`;
    default: throw new Error(`未知战斗效果：${item.kind}`);
  }
}
function cardText(effects, target, traits) {
  const rules = effects.map(item => `${item.minPlays ? `若这是本回合第${item.minPlays}张或之后打出的牌：` : ""}${describeEffect(item, target)}`);
  if (traits.retain) rules.push("回合结束时保留在手牌中");
  if (traits.exhaust) rules.push("打出后本场战斗移出牌组循环");
  if (traits.temporary) rules.push("仅在本场战斗中存在，战斗结束后消失");
  return rules.join("；") + "。";
}
function card(id, name, familyId, role, cost, target, effects, upgradeEffects, traits = {}) {
  return { id, name, familyId, role, cost, target, effects, upgradeEffects, ...traits,
    description: cardText(effects, target, traits),
    upgradeDescription: cardText(upgradeEffects, target, traits) };
}

const TRIGGER_NAMES = {
  battleStart: "战斗开始时", turnStart: "己方回合开始时", attack: "打出伤害效果时", guard: "打出护盾效果时",
  heal: "打出治疗效果时", marked: "施加标记时", thirdPlay: "队伍本回合打出第3张牌时", kill: "用卡牌直接伤害（含回响）击倒敌人时",
};
function ability(name, trigger, kind, amount, target, frequency) {
  return { name, trigger, kind, amount, target, frequency,
    description: `${TRIGGER_NAMES[trigger]}，${describeEffect({ kind, amount, target }, target)}；每${frequency === "turn" ? "回合" : "场战斗"}限1次。` };
}

const FIGHTERS = {
  sheep: { id: "sheep", role: "guard", maxHp: 54, passive: ability("叠信成盾", "battleStart", "block", 3, "party", "battle"), cards: ["sheep-coat", "sheep-flock"] },
  ramen: { id: "ramen", role: "guard", maxHp: 44, passive: ability("汤还温着", "heal", "retainBlock", 1, "self", "turn"), cards: ["ramen-broth", "ramen-lid"] },
  sunset: { id: "sunset", role: "echo", maxHp: 40, passive: ability("余晖落款", "marked", "burn", 1, "enemy", "turn"), cards: ["sunset-glow", "sunset-horizon"] },
  ticket: { id: "ticket", role: "echo", maxHp: 40, passive: ability("片尾重映", "thirdPlay", "echo", 1, "self", "turn"), cards: ["ticket-replay", "ticket-cut"] },
  catcafe: { id: "catcafe", role: "echo", maxHp: 42, passive: ability("今日菜单", "battleStart", "draw", 1, "self", "battle"), cards: ["catcafe-foam", "catcafe-night"] },
  moon: { id: "moon", role: "echo", maxHp: 40, passive: ability("月光识路", "battleStart", "mark", 1, "enemies", "battle"), cards: ["moon-arc", "moon-watch"] },
  nav: { id: "nav", role: "echo", maxHp: 44, passive: ability("地图旁的注解", "marked", "draw", 1, "self", "turn"), cards: ["nav-chart", "nav-compass"] },
  tea: { id: "tea", role: "guard", maxHp: 50, passive: ability("歇一口气", "turnStart", "heal", 2, "self", "turn"), cards: ["tea-sharing", "tea-straw"] },
  sushi: { id: "sushi", role: "guard", maxHp: 50, passive: ability("潮水回推", "guard", "damage", 3, "enemy", "turn"), cards: ["sushi-nori", "sushi-tide"] },
  pear: { id: "pear", role: "guard", maxHp: 46, passive: ability("给大家缝叶芽", "heal", "block", 2, "party", "turn"), cards: ["pear-leaf", "pear-button"] },
  burger: { id: "burger", role: "combo", maxHp: 48, passive: ability("外带纸袋", "attack", "block", 2, "self", "turn"), cards: ["burger-delivery", "burger-double"] },
  badminton: { id: "badminton", role: "combo", maxHp: 44, passive: ability("第三拍抢网", "thirdPlay", "damage", 4, "enemy", "turn"), cards: ["badminton-rally", "badminton-drop"] },
  bomb: { id: "bomb", role: "combo", maxHp: 46, passive: ability("出炉余温", "kill", "burn", 2, "enemies", "turn"), cards: ["bomb-crust", "bomb-oven"] },
  orangecat: { id: "orangecat", role: "combo", maxHp: 48, passive: ability("尾巴护住后路", "attack", "counter", 2, "self", "turn"), cards: ["orangecat-pounce", "orangecat-sidestep"] },
  doudou: { id: "doudou", role: "guard", maxHp: 52, passive: ability("嫩芽并排站", "turnStart", "block", 1, "party", "turn"), cards: ["doudou-root", "doudou-water"] },
  hydrangea: { id: "hydrangea", role: "echo", maxHp: 42, passive: ability("花粉辨踪", "marked", "weak", 1, "enemy", "turn"), cards: ["hydrangea-pollen", "hydrangea-petal"] },
  pearlamp: { id: "pearlamp", role: "guard", maxHp: 50, passive: ability("先暖一暖手", "battleStart", "heal", 3, "party", "battle"), cards: ["pearlamp-shade", "pearlamp-wick"] },
  cloudmail: { id: "cloudmail", role: "combo", maxHp: 44, passive: ability("送达回执", "kill", "draw", 1, "self", "turn"), cards: ["cloudmail-stamp", "cloudmail-express"] },
  firefly: { id: "firefly", role: "combo", maxHp: 42, passive: ability("照亮落脚处", "attack", "mark", 1, "enemy", "turn"), cards: ["firefly-trail", "firefly-flash"] },
  soup: { id: "soup", role: "guard", maxHp: 50, passive: ability("喝完再出发", "heal", "charge", 1, "self", "turn"), cards: ["soup-ladle", "soup-steam"] },
  blanket: { id: "blanket", role: "echo", maxHp: 46, passive: ability("星线回针", "guard", "echo", 1, "self", "turn"), cards: ["blanket-quilt", "blanket-stitch"] },
  seedling: { id: "seedling", role: "combo", maxHp: 44, passive: ability("落地生根", "kill", "heal", 3, "party", "turn"), cards: ["seedling-break", "seedling-travel"] },
};

const CARDS = [
  card("sheep-coat", "信笺外衣", "sheep", "guard", 2, "self", [effect("block", 12), effect("retainBlock", 1)], [effect("block", 16), effect("retainBlock", 1)]),
  card("sheep-flock", "围成小羊圈", "sheep", "guard", 2, "allAllies", [effect("block", 4), effect("counter", 1)], [effect("block", 6), effect("counter", 2)]),
  card("ramen-broth", "慢熬暖汤", "ramen", "guard", 1, "ally", [effect("heal", 4), effect("draw", 1, "self")], [effect("heal", 7), effect("draw", 1, "self")]),
  card("ramen-lid", "陶碗扣住风", "ramen", "guard", 2, "self", [effect("block", 7), effect("heal", 4), effect("counter", 2)], [effect("block", 10), effect("heal", 6), effect("counter", 3)]),
  card("sunset-glow", "晚霞烫金", "sunset", "echo", 1, "enemy", [effect("burn", 3), effect("mark", 1)], [effect("burn", 4), effect("mark", 2)]),
  card("sunset-horizon", "地平线回声", "sunset", "echo", 3, "allEnemies", [effect("damage", 5), effect("burn", 2), effect("echo", 1, "self")], [effect("damage", 7), effect("burn", 3), effect("echo", 1, "self")]),
  card("ticket-replay", "留一张回程票", "ticket", "echo", 1, "self", [effect("echo", 1), effect("draw", 1)], [effect("echo", 1), effect("draw", 2)]),
  card("ticket-cut", "剪下一格月光", "ticket", "echo", 2, "enemy", [effect("damage", 8), effect("weak", 1), effect("draw", 1, "self")], [effect("damage", 11), effect("weak", 2), effect("draw", 1, "self")]),
  card("catcafe-foam", "奶泡猫爪", "catcafe", "echo", 1, "enemy", [effect("weak", 1), effect("mark", 1)], [effect("weak", 2), effect("mark", 2)]),
  card("catcafe-night", "续杯到夜深", "catcafe", "echo", 2, "self", [effect("draw", 2), effect("heal", 5)], [effect("draw", 3), effect("heal", 6)]),
  card("moon-arc", "弯月轻扫", "moon", "echo", 1, "allEnemies", [effect("damage", 2), effect("mark", 1)], [effect("damage", 4), effect("mark", 2)]),
  card("moon-watch", "窗边守月", "moon", "echo", 1, "ally", [effect("block", 6), effect("echo", 1)], [effect("block", 9), effect("echo", 1)]),
  card("nav-chart", "圈出下一站", "nav", "echo", 1, "enemy", [effect("mark", 2), effect("draw", 1, "self")], [effect("mark", 3), effect("draw", 1, "self")]),
  card("nav-compass", "罗盘借星光", "nav", "echo", 1, "ally", [effect("echo", 1), effect("block", 2)], [effect("echo", 1), effect("block", 5)]),
  card("tea-sharing", "长椅分半杯", "tea", "guard", 3, "allAllies", [effect("heal", 5), effect("block", 3)], [effect("heal", 7), effect("block", 5)]),
  card("tea-straw", "吸管小栅栏", "tea", "guard", 1, "ally", [effect("block", 6), effect("counter", 2)], [effect("block", 9), effect("counter", 3)]),
  card("sushi-nori", "海苔包好啦", "sushi", "guard", 2, "self", [effect("block", 8), effect("weak", 1, "enemies")], [effect("block", 12), effect("weak", 2, "enemies")]),
  card("sushi-tide", "潮水推小船", "sushi", "guard", 3, "allEnemies", [effect("damage", 6), effect("block", 4, "party")], [effect("damage", 8), effect("block", 6, "party")]),
  card("pear-leaf", "叶芽缝在衣角", "pear", "guard", 1, "ally", [effect("heal", 4), effect("cleanse", 1)], [effect("heal", 7), effect("cleanse", 2)]),
  card("pear-button", "纽扣小展览", "pear", "guard", 2, "self", [effect("block", 6), effect("draw", 1), effect("block", 2, "party")], [effect("block", 9), effect("draw", 1), effect("block", 3, "party")]),
  card("burger-delivery", "热面包快送", "burger", "combo", 1, "enemy", [effect("damage", 6), effect("block", 2, "self")], [effect("damage", 9), effect("block", 3, "self")]),
  card("burger-double", "双层夹心", "burger", "combo", 2, "enemy", [effect("damage", 6), effect("damage", 6), effect("heal", 2, "self")], [effect("damage", 8), effect("damage", 8), effect("heal", 3, "self")]),
  card("badminton-rally", "来回三拍", "badminton", "combo", 2, "enemy", [effect("damage", 3), effect("damage", 3), effect("damage", 3)], [effect("damage", 4), effect("damage", 4), effect("damage", 4)]),
  card("badminton-drop", "网前落叶球", "badminton", "combo", 0, "enemy", [effect("stripBlock", 5), effect("weak", 1)], [effect("stripBlock", 8), effect("weak", 2)]),
  card("bomb-crust", "外壳脆脆响", "bomb", "combo", 1, "enemy", [effect("damage", 4), effect("burn", 2)], [effect("damage", 7), effect("burn", 3)]),
  card("bomb-oven", "烤箱开小缝", "bomb", "combo", 3, "allEnemies", [effect("burn", 3), effect("block", 5, "self")], [effect("burn", 5), effect("block", 8, "self")]),
  card("orangecat-pounce", "豆包连扑", "orangecat", "combo", 1, "enemy", [effect("damage", 3), effect("damage", 3)], [effect("damage", 4), effect("damage", 4)]),
  card("orangecat-sidestep", "窗台借一步", "orangecat", "combo", 1, "enemy", [effect("damage", 5), effect("cleanse", 1, "self")], [effect("damage", 8), effect("cleanse", 2, "self")]),
  card("doudou-root", "根须抓稳啦", "doudou", "guard", 1, "ally", [effect("block", 6), effect("retainBlock", 1)], [effect("block", 9), effect("retainBlock", 1)]),
  card("doudou-water", "浇一圈小雨", "doudou", "guard", 2, "allAllies", [effect("heal", 3), effect("counter", 1)], [effect("heal", 5), effect("counter", 2)]),
  card("hydrangea-pollen", "雾里认花粉", "hydrangea", "echo", 2, "allEnemies", [effect("mark", 1), effect("weak", 1)], [effect("mark", 2), effect("weak", 2)]),
  card("hydrangea-petal", "花瓣慢慢转", "hydrangea", "echo", 1, "enemy", [effect("burn", 2), effect("draw", 1, "self")], [effect("burn", 4), effect("draw", 1, "self")]),
  card("pearlamp-shade", "灯罩挡夜风", "pearlamp", "guard", 2, "allAllies", [effect("block", 4), effect("retainBlock", 1)], [effect("block", 6), effect("retainBlock", 1)]),
  card("pearlamp-wick", "把灯芯拨亮", "pearlamp", "guard", 1, "ally", [effect("heal", 5), effect("counter", 2)], [effect("heal", 8), effect("counter", 3)]),
  card("cloudmail-stamp", "火漆敲两下", "cloudmail", "combo", 2, "enemy", [effect("mark", 1), effect("damage", 4), effect("damage", 4)], [effect("mark", 2), effect("damage", 5), effect("damage", 5)]),
  card("cloudmail-express", "穿过街角的风", "cloudmail", "combo", 2, "allEnemies", [effect("damage", 4), effect("draw", 1, "self")], [effect("damage", 6), effect("draw", 1, "self")]),
  card("firefly-trail", "沿光点轻跃", "firefly", "combo", 2, "enemy", [effect("mark", 2), effect("damage", 7)], [effect("mark", 3), effect("damage", 10)]),
  card("firefly-flash", "灯笼晃一晃", "firefly", "combo", 0, "enemy", [effect("cleanse", 1, "self"), effect("mark", 1)], [effect("cleanse", 2, "self"), effect("mark", 2)]),
  card("soup-ladle", "盛一勺再走", "soup", "guard", 2, "ally", [effect("heal", 9), effect("block", 4)], [effect("heal", 12), effect("block", 6)]),
  card("soup-steam", "锅盖冒暖雾", "soup", "guard", 3, "allEnemies", [effect("weak", 1), effect("heal", 4, "party")], [effect("weak", 2), effect("heal", 6, "party")]),
  card("blanket-quilt", "星毯铺平", "blanket", "echo", 2, "ally", [effect("block", 8), effect("echo", 1), effect("retainBlock", 1)], [effect("block", 11), effect("echo", 1), effect("retainBlock", 1)]),
  card("blanket-stitch", "银线绣一针", "blanket", "echo", 1, "enemy", [effect("damage", 6), effect("echo", 1, "self")], [effect("damage", 9), effect("echo", 1, "self")]),
  card("seedling-break", "嫩芽顶开砖", "seedling", "combo", 2, "enemy", [effect("stripBlock", 6), effect("damage", 8)], [effect("stripBlock", 10), effect("damage", 11)]),
  card("seedling-travel", "沿路撒下种子", "seedling", "combo", 2, "allEnemies", [effect("damage", 4), effect("heal", 2, "party")], [effect("damage", 6), effect("heal", 3, "party")]),

  card("strike", "小小出手", null, "combo", 1, "enemy", [effect("damage", 6)], [effect("damage", 9)]),
  card("guard", "护好邮包", null, "guard", 1, "self", [effect("block", 6)], [effect("block", 9)]),
  card("postbag", "厚布邮袋", null, "guard", 2, "ally", [effect("block", 12)], [effect("block", 17)]),
  card("umbrella", "并肩撑伞", null, "guard", 2, "allAllies", [effect("block", 5)], [effect("block", 7)]),
  card("folded-corner", "折好纸角", null, "guard", 0, "self", [environment("rain")], [environment("rain"), effect("cleanse", 1)]),
  card("safety-pin", "别住袖口", null, "guard", 2, "self", [effect("counter", 5), effect("block", 6)], [effect("counter", 7), effect("block", 9)]),
  card("packed-lunch", "路边便当", null, "guard", 1, "ally", [effect("heal", 6)], [effect("heal", 9)]),
  card("paper-dart", "纸飞机掠过", null, "combo", 0, "enemy", [environment("tailwind")], [environment("tailwind"), effect("mark", 1)]),
  card("stamped-route", "盖章再出发", null, "combo", 1, "enemy", [effect("damage", 4), effect("mark", 1)], [effect("damage", 7), effect("mark", 1)]),
  card("street-sweep", "扫开一排落叶", null, "combo", 3, "allEnemies", [effect("damage", 8)], [effect("damage", 11)]),
  card("borrowed-step", "借一块踏脚石", null, "combo", 1, "ally", [effect("block", 4), effect("intercept", 1)], [effect("block", 7), effect("intercept", 1)]),
  card("quick-note", "随手记一笔", null, "combo", 2, "enemy", [effect("damage", 5), effect("draw", 2, "self")], [effect("damage", 8), effect("draw", 2, "self")]),
  card("address-label", "新写的地址", null, "echo", 0, "ally", [effect("cleanse", 1)], [effect("cleanse", 2)]),
  card("ink-drop", "墨滴慢洇", null, "echo", 2, "enemy", [effect("burn", 4)], [effect("burn", 6)]),
  card("quiet-bell", "轻按铜铃", null, "echo", 1, "allEnemies", [effect("weak", 1)], [effect("weak", 2)]),
  card("return-envelope", "留一只回邮信封", null, "echo", 2, "ally", [effect("echo", 1), effect("heal", 6)], [effect("echo", 2), effect("heal", 8)]),
  card("margin-notes", "空白处补两行", null, "echo", 2, "self", [effect("draw", 3)], [effect("draw", 4)]),
  card("wax-impression", "火漆留下纹路", null, "echo", 3, "enemy", [effect("burn", 3), effect("mark", 2), effect("weak", 1)], [effect("burn", 5), effect("mark", 3), effect("weak", 2)]),

  card("loose-thread", "抽出一缕线", null, "guard", 0, "enemy", [effect("stripBlock", 5)], [effect("stripBlock", 8)], { tactic: true }),
  card("sleeve-knot", "袖口打个结", null, "guard", 0, "ally", [effect("intercept", 1)], [effect("intercept", 1), effect("block", 3)], { tactic: true }),
  card("thermos-pause", "暖壶歇一站", null, "guard", 2, "ally", [effect("heal", 6), effect("charge", 1)], [effect("heal", 9), effect("charge", 1)], { tactic: true }),
  card("night-shelter", "撑起整夜雨棚", null, "guard", 4, "allAllies", [effect("block", 10), effect("retainBlock", 1)], [effect("block", 14), effect("retainBlock", 1)], { tactic: true, retain: true }),

  card("quick-sketch", "路边速写", null, "combo", 0, "self", [effect("discover", 3)], [effect("discover", 3), effect("charge", 1)], { tactic: true, exhaust: true }),
  card("wind-up-stamp", "旋紧发条邮戳", null, "combo", 2, "enemy", [effect("damage", 6), effect("charge", 1)], [effect("damage", 9), effect("charge", 1)], { tactic: true }),
  card("sealed-route", "封好的近路", null, "combo", 3, "enemy", [effect("damage", 8), effect("damage", 10, null, 3)], [effect("damage", 11), effect("damage", 14, null, 3)], { tactic: true, retain: true }),
  card("express-finale", "加急送到终点", null, "combo", 4, "enemy", [effect("stripBlock", 12), effect("damage", 22)], [effect("stripBlock", 18), effect("damage", 28)], { tactic: true, retain: true }),

  card("wax-spark", "点亮火漆星", null, "echo", 0, "self", [effect("scout", 3)], [effect("scout", 3), effect("charge", 1)], { tactic: true, exhaust: true }),
  card("dusk-ledger", "暮色记账本", null, "echo", 1, "self", [effect("draw", 1), effect("charge", 1)], [effect("draw", 2), effect("charge", 1)], { tactic: true, exhaust: true }),
  card("relay-mark", "接力落款", null, "echo", 2, "enemy", [effect("mark", 2), effect("charge", 1), effect("weak", 1, null, 3)], [effect("mark", 3), effect("charge", 1), effect("weak", 2, null, 3)], { tactic: true }),
  card("lantern-storm", "放出满街灯火", null, "echo", 4, "allEnemies", [effect("burn", 4), effect("mark", 2), environment("rain")], [effect("burn", 6), effect("mark", 3), environment("rain")], { tactic: true, retain: true }),
];

const OPPORTUNITY_CARDS = [
  card("chance-intercept", "借伞同路", null, "guard", 1, "ally", [effect("block", 6), effect("intercept", 1)], [effect("block", 8), effect("intercept", 1)], { temporary: true, exhaust: true }),
  card("chance-cleanse", "温热回执", null, "guard", 1, "ally", [effect("cleanse", 2), effect("heal", 4)], [effect("cleanse", 3), effect("heal", 6)], { temporary: true, exhaust: true }),
  card("chance-breach", "拆开封条", null, "combo", 1, "enemy", [effect("stripBlock", 8), effect("damage", 5)], [effect("stripBlock", 11), effect("damage", 7)], { temporary: true, exhaust: true }),
  card("chance-mark", "陌生人的路标", null, "echo", 1, "enemy", [environment("tailwind"), effect("mark", 2)], [environment("tailwind"), effect("mark", 3)], { temporary: true, exhaust: true }),
  card("chance-charge", "拾起余光", null, "combo", 0, "self", [effect("charge", 1)], [effect("charge", 2)], { temporary: true, exhaust: true }),
  card("chance-echo", "借来一句回声", null, "echo", 1, "self", [effect("echo", 1), effect("draw", 1)], [effect("echo", 2), effect("draw", 1)], { temporary: true, exhaust: true }),
];

const STARTING_TACTICS = [
  { id: "classic", name: "稳妥出发", summary: "保留每位伙伴的小小出手，攻守直接。", cards: [] },
  { id: "relay", name: "加急接力", summary: "通过发现取得一次性机会，用蓄能铺路后送出高费终结牌。", cards: ["quick-sketch", "wind-up-stamp", "express-finale"] },
  { id: "reserve", name: "灯火储备", summary: "先用观星整理牌序，再以蓄能和标记准备群体灯火。", cards: ["wax-spark", "dusk-ledger", "lantern-storm"] },
  { id: "weather", name: "巷间应变", summary: "先完成进攻，再用雨幕减轻来袭；以标记和高费牌收束。", cards: ["folded-corner", "stamped-route", "express-finale"] },
];

function relic(id, name, trigger, kind, amount, target, frequency) {
  return { id, ...ability(name, trigger, kind, amount, target, frequency) };
}
const RELICS = [
  relic("blue-thread", "暮蓝缝线", "battleStart", "block", 3, "party", "battle"),
  relic("tea-token", "热茶木牌", "turnStart", "heal", 2, "self", "turn"),
  relic("brass-buckle", "旧邮袋铜扣", "guard", "counter", 3, "self", "turn"),
  relic("folded-map", "折角地图", "marked", "draw", 1, "self", "turn"),
  relic("rush-stamp", "加急邮戳", "thirdPlay", "charge", 1, "self", "turn"),
  relic("glass-star", "玻璃星星", "battleStart", "echo", 1, "party", "battle"),
  relic("red-ribbon", "灯市红丝带", "kill", "heal", 2, "party", "turn"),
  relic("smooth-pebble", "桥下圆石", "battleStart", "charge", 1, "self", "battle"),
  relic("paper-lantern", "纸灯笼芯", "attack", "burn", 1, "enemy", "turn"),
  relic("wooden-whistle", "站台木哨", "thirdPlay", "mark", 1, "enemies", "turn"),
  relic("silk-sachet", "雨巷香囊", "heal", "weak", 1, "enemy", "turn"),
  relic("bamboo-rib", "竹伞骨", "guard", "retainBlock", 1, "self", "turn"),
  relic("ticket-punch", "小小剪票钳", "attack", "draw", 1, "self", "turn"),
  relic("dry-inkstone", "干燥小砚台", "battleStart", "mark", 2, "enemies", "battle"),
  relic("warm-handkerchief", "暖手方巾", "heal", "block", 2, "party", "turn"),
  relic("copper-windbell", "屋檐铜风铃", "thirdPlay", "damage", 2, "enemies", "turn"),
  relic("courier-pin", "邮差别针", "kill", "charge", 1, "self", "turn"),
  relic("night-bookmark", "夜读书签", "turnStart", "draw", 1, "self", "battle"),
];

function pattern(kind, amount, name, target, summonId) {
  return { kind, amount, name, target, ...(summonId ? { summonId } : {}) };
}
const ENEMIES = [
  { id: "paper-ball", name: "迷途纸团", regionId: "street", rank: "normal", maxHp: 34, patterns: [pattern("attack", 6, "滚过信口", "front"), pattern("block", 4, "裹紧纸层", "front")], lore: "被揉皱的地址聚成一团，总想钻进不属于自己的信箱。" },
  { id: "stamp-moth", name: "邮戳小蛾", regionId: "street", rank: "normal", maxHp: 32, patterns: [pattern("weak", 1, "灰粉遮字", "front"), pattern("attack", 7, "扑向灯面", "lowest")], lore: "循着火漆的香气飞来，翅粉会让脚步暂时慢下来。" },
  { id: "twine-sprite", name: "绕线小怪", regionId: "street", rank: "normal", maxHp: 36, patterns: [pattern("block", 5, "线轴打结", "front"), pattern("attack", 8, "甩出绳头", "front")], lore: "邮袋上的旧棉线不肯松手，把每条路都打成一个结。" },
  { id: "wax-drop", name: "火漆滴滴", regionId: "street", rank: "normal", maxHp: 34, patterns: [pattern("burn", 2, "热蜡落点", "front"), pattern("attack", 5, "铜盘弹跳", "lowest")], lore: "从印章旁溜走的小蜡滴，脾气热，身子却软。" },
  { id: "postbag-guard", name: "空邮袋守卫", regionId: "street", rank: "elite", maxHp: 42, patterns: [pattern("block", 10, "袋口收紧", "front"), pattern("attack", 12, "盖下邮袋", "front"), pattern("attack", 4, "纸屑扑面", "all")], lore: "它怕信件再丢失，干脆把所有出口都挡住。" },
  { id: "stamp-press", name: "旧戳印偶", regionId: "street", rank: "elite", maxHp: 38, patterns: [pattern("weak", 1, "暂缓投递", "all"), pattern("attack", 9, "双印落台", "lowest"), pattern("burn", 2, "红泥散开", "all")], lore: "旧印章记错了投递日期，一次次把通行证盖成暂缓。" },
  { id: "paper-lion", name: "吞信纸狮", regionId: "street", rank: "boss", maxHp: 48, patterns: [pattern("block", 14, "折纸厚甲", "front"), pattern("attack", 13, "拆信扑咬", "front"), pattern("attack", 4, "纸鬃散落", "all")], phase2: { maxHp: 52, patterns: [pattern("block", 8, "重折纸甲", "front"), pattern("attack", 6, "满街纸风", "all"), pattern("attack", 17, "扑向最薄信页", "lowest")] }, lore: "它用遗失信封折出厚甲；护甲合拢时准备连击，展开攻击时才露出褶缝。第一层纸甲散开后，它会换上更轻、更急的纸鬃。" },
  { id: "ink-puddle", name: "洇墨水洼", regionId: "bridge", rank: "normal", maxHp: 28, patterns: [pattern("burn", 3, "墨点沾鞋", "front"), pattern("attack", 7, "水面弹墨", "lowest")], lore: "雨水把没写完的句子汇成墨洼，脚印一落就泛起涟漪。" },
  { id: "tile-sprite", name: "青瓦跳跳", regionId: "bridge", rank: "normal", maxHp: 30, patterns: [pattern("block", 6, "叠起瓦片", "front"), pattern("attack", 9, "屋檐落步", "front")], lore: "脱落的小瓦片想回到屋檐，每次起跳都会发出清脆一声。" },
  { id: "rain-knot", name: "雨丝结", regionId: "bridge", rank: "normal", maxHp: 25, patterns: [pattern("weak", 1, "雨线缠手", "all"), pattern("attack", 8, "绷紧雨丝", "front")], lore: "屋檐滴下的雨丝打成活结，松开一头才能继续赶路。" },
  { id: "reed-shadow", name: "苇叶影", regionId: "bridge", rank: "normal", maxHp: 27, patterns: [pattern("attack", 4, "苇叶横扫", "all"), pattern("attack", 8, "贴水掠影", "lowest")], lore: "桥洞吹来的风借了苇叶的形状，喜欢追赶提灯的影子。" },
  { id: "umbrella-spirit", name: "倒伞雨偶", regionId: "bridge", rank: "elite", maxHp: 49, patterns: [pattern("block", 12, "伞面聚雨", "front"), pattern("attack", 16, "翻伞泼雨", "front"), pattern("weak", 2, "湿衣迟步", "lowest")], lore: "伞面朝上收满了雨。先留意蓄水的动作，别在翻伞时空着手。" },
  { id: "bridge-drum", name: "桥墩空鼓", regionId: "bridge", rank: "elite", maxHp: 52, patterns: [pattern("weak", 1, "闷响回荡", "all"), pattern("attack", 6, "桥面震三声", "all"), pattern("block", 8, "潮痕成圈", "front")], lore: "桥洞的回声藏在石鼓里，敲响一次，三道影子都跟着摇晃。" },
  { id: "ink-tide", name: "墨潮桥灵", regionId: "bridge", rank: "boss", maxHp: 60, patterns: [pattern("block", 6, "墨潮蓄起", "front"), pattern("attack", 20, "一笔越过桥面", "front"), pattern("weak", 1, "潮字散开", "all")], phase2: { maxHp: 68, patterns: [pattern("block", 9, "浓墨再聚", "front"), pattern("attack", 9, "满桥墨浪", "all"), pattern("attack", 15, "追上最轻脚步", "lowest")] }, lore: "桥灵先聚墨，再落重笔。看见蓄力时施加虚弱或备好护盾，能让下一次墨浪缓下来；第二阶段的墨浪会铺满桥面。" },
  { id: "lantern-mote", name: "灯芯小灵", regionId: "market", rank: "normal", maxHp: 29, patterns: [pattern("burn", 3, "一点灯花", "lowest"), pattern("attack", 8, "借火蹦跳", "front")], lore: "灯芯上飞起的小火星，想找一盏尚未点亮的灯。" },
  { id: "bell-sprite", name: "铜铃小雾", regionId: "market", rank: "normal", maxHp: 31, patterns: [pattern("weak", 1, "细铃迷步", "front"), pattern("attack", 5, "铃声一圈", "all")], lore: "雾躲进小铜铃，敲一声便把人领向另一条摊道。" },
  { id: "paper-mask", name: "纸面小客", regionId: "market", rank: "normal", maxHp: 34, patterns: [pattern("block", 8, "面具转半边", "front"), pattern("attack", 10, "穿过灯架", "lowest")], lore: "一张忘了主人的纸面具，在熄灯以前寻找最后一个摊位。" },
  { id: "silk-tail", name: "绸尾风", regionId: "market", rank: "normal", maxHp: 28, patterns: [pattern("attack", 9, "红绸轻抽", "front"), pattern("burn", 2, "擦过灯焰", "all")], lore: "灯棚飘带被风吹出了尾巴，所到之处总有微小火光。" },
  { id: "lantern-rack", name: "走马灯架", regionId: "market", rank: "elite", maxHp: 58, patterns: [pattern("block", 10, "灯骨合拢", "front"), pattern("attack", 7, "影马奔一圈", "all"), pattern("burn", 3, "灯纸生暖焰", "all")], lore: "走马灯转得太快，里面的影马冲出了灯纸。" },
  { id: "market-usher", name: "雾灯引客", regionId: "market", rank: "elite", maxHp: 54, patterns: [pattern("weak", 2, "请走这边", "front"), pattern("attack", 18, "灯杆点地", "lowest"), pattern("block", 9, "雾袖合拢", "front")], lore: "它一直热心指路，却把所有旅人领回原来的路口。" },
  { id: "bell-warden", name: "铜铃雾守", regionId: "market", rank: "boss", maxHp: 68, patterns: [pattern("summon", 1, "招来灯芯", "front", "lantern-mote"), pattern("attack", 6, "雾铃传满街", "all"), pattern("block", 10, "铜铃合罩", "front")], phase2: { maxHp: 78, patterns: [pattern("summon", 1, "招来铜铃小雾", "front", "bell-sprite"), pattern("attack", 18, "重铃追影", "lowest"), pattern("attack", 8, "灯市长鸣", "all")] }, lore: "守市的铜铃被浓雾塞满，呼来小灵替它看守道路。先处理召来的小怪，再找机会靠近；第二阶段会换一种铃声呼唤同伴。" },
];

// 遭遇预算是整场预算，不把数只完整强度的敌人直接相加。只在黄昏邮街的新局使用。
// hp 为普通难度的生命；attackPercent 只缩放主动攻击，不放大负面状态或久战压力。
const STREET_ENCOUNTERS = {
  'street-patrol': { name: "信口与灯面", description: "双敌分工：纸团挡路，小蛾干扰。选择先集火谁。", rank: "normal", units: [
    { id: "paper-ball", hp: 20, attackPercent: 75 }, { id: "stamp-moth", hp: 18, attackPercent: 65 }
  ] },
  'street-swarm': { name: "散信小队", description: "三只低血敌人：群攻清场，或击杀一只接续出牌。", rank: "normal", units: [
    { id: "paper-ball", hp: 14, attackPercent: 50 }, { id: "stamp-moth", hp: 12, attackPercent: 45 }, { id: "wax-drop", hp: 12, attackPercent: 60 }
  ] },
  'street-armor': { name: "打结的厚邮袋", description: "单体厚甲：准备破盾、灼烧，或蓄能后的集中攻击。", rank: "normal", units: [
    { id: "twine-sprite", hp: 44, attackPercent: 100 }
  ] },
  'street-crossfire': { name: "线轴与火漆", description: "护盾与灼烧交错：先解决干扰，还是抓住攻击空档？", rank: "normal", units: [
    { id: "twine-sprite", hp: 24, attackPercent: 65 }, { id: "wax-drop", hp: 20, attackPercent: 80 }
  ] },
  'street-guard': { name: "袋口巡守", description: "精英与小蛾同行：先处理干扰，再应对单体重击和全队攻击。", rank: "elite", units: [
    { id: "postbag-guard", hp: 34, attackPercent: 80 }, { id: "stamp-moth", hp: 16, attackPercent: 60 }
  ] },
  'street-press': { name: "旧戳检查站", description: "精英与纸团同行：控制、集火和净化都能打开突破口。", rank: "elite", units: [
    { id: "stamp-press", hp: 30, attackPercent: 85 }, { id: "paper-ball", hp: 16, attackPercent: 65 }
  ] },
};
const STREET_BATTLE_PATH = [
  ['street-patrol', 'street-armor'],
  ['street-swarm', 'street-crossfire'],
  ['street-crossfire', 'street-swarm'],
];

const REGIONS = [
  { id: "street", name: "黄昏邮街", subtitle: "把散落的地址送回信匣", description: "沿暮蓝邮局外的石板街找回遗失的信，穿过旧牌楼和仍亮着灯的窗。", bossId: "paper-lion", normalIds: ["paper-ball", "stamp-moth", "twine-sprite", "wax-drop"], eliteIds: ["postbag-guard", "stamp-press"], palette: { sky: "#354964", ground: "#897662", accent: "#d7ac64" }, events: [
    { id: "street-tea", title: "窗下的一碗热茶", text: "守窗的街坊请旅伴歇一会儿。茶还热着，一只拆开的邮袋也正等人缝好。", choices: [
      { id: "tea", label: "坐下喝完热茶", description: "全队恢复8点生命，获得2星线。", heal: 8, threads: 2 },
      { id: "sew", label: "帮忙缝好邮袋", description: "获得7星线。", heal: 0, threads: 7 },
      { id: "refit", label: "重新整理一张邮路牌", description: "放弃本次其他收益，三选一替换一张非专属牌；牌数不变，原牌升级不继承。", replace: true, heal: 0, threads: 0 },
    ] },
    { id: "street-corner", title: "信封上翘起的角", text: "旧书摊里有一册邮路剪贴簿。摊主愿意教你把一张常用卡牌折得更顺手。", choices: [
      { id: "learn", label: "学会一种折法", description: "随机升级1张尚未升级的牌，获得2星线。", heal: 0, threads: 2, upgrade: true },
      { id: "sort", label: "替摊主整理旧书", description: "全队恢复3点生命，获得5星线。", heal: 3, threads: 5 },
      { id: "refit", label: "重新整理一张邮路牌", description: "放弃本次其他收益，三选一替换一张非专属牌；牌数不变，原牌升级不继承。", replace: true, heal: 0, threads: 0 },
    ] },
  ] },
  { id: "bridge", name: "雨巷旧桥", subtitle: "沿青瓦和雨声找到来路", description: "雨水洗淡了青瓦上的旧字。顺着桥灯穿过窄巷，留意墨潮落下前的停顿。", bossId: "ink-tide", normalIds: ["ink-puddle", "tile-sprite", "rain-knot", "reed-shadow"], eliteIds: ["umbrella-spirit", "bridge-drum"], palette: { sky: "#354752", ground: "#657a78", accent: "#b9cab3" }, events: [
    { id: "bridge-umbrella", title: "补伞师的屋檐", text: "屋檐下挂着一排竹伞。补伞师把干毛巾递给你们，请大家替他按住一根松动的伞骨。", choices: [
      { id: "dry", label: "先擦干衣角", description: "全队恢复10点生命，获得2星线。", heal: 10, threads: 2 },
      { id: "hold", label: "一起扶稳伞骨", description: "获得8星线。", heal: 0, threads: 8 },
    ] },
    { id: "bridge-note", title: "桥栏上的字条", text: "一张防雨字条写着旧桥的走法，旁边还有一段能让动作更稳的小诀窍。", choices: [
      { id: "practice", label: "照着练习一次", description: "随机升级1张尚未升级的牌，获得3星线。", heal: 0, threads: 3, upgrade: true },
      { id: "leave", label: "给后来者留张新条", description: "全队恢复4点生命，获得5星线。", heal: 4, threads: 5 },
    ] },
  ] },
  { id: "market", name: "夜行灯市", subtitle: "让每一盏灯认得回家的人", description: "灯棚沿小街排开，铜铃声藏进雾里。把走散的灯火带回原处，找出真正的出口。", bossId: "bell-warden", normalIds: ["lantern-mote", "bell-sprite", "paper-mask", "silk-tail"], eliteIds: ["lantern-rack", "market-usher"], palette: { sky: "#282f4b", ground: "#745d61", accent: "#e8bd72" }, events: [
    { id: "market-soup", title: "灯棚后的汤摊", text: "一锅清汤还冒着暖气，摊主正把空碗摞好。你们可以歇脚，也可以帮忙送最后一桌。", choices: [
      { id: "eat", label: "每人喝一碗暖汤", description: "全队恢复12点生命，获得2星线。", heal: 12, threads: 2 },
      { id: "carry", label: "替摊主送完热汤", description: "获得9星线。", heal: 0, threads: 9 },
    ] },
    { id: "market-paper", title: "剪灯花的小桌", text: "剪纸师把余下的彩纸递来。用一点耐心，熟悉的动作也能添上一朵新的灯花。", choices: [
      { id: "cut", label: "学着剪一朵灯花", description: "随机升级1张尚未升级的牌，获得4星线。", heal: 0, threads: 4, upgrade: true },
      { id: "tidy", label: "把彩纸分好颜色", description: "全队恢复5点生命，获得6星线。", heal: 5, threads: 6 },
    ] },
  ] },
];

const DIFFICULTIES = [
  { id: 0, name: "普通", hpMultiplier: 1, damageMultiplier: 1, rewardMultiplier: 1, description: "标准敌人生命与主动攻击伤害，星线奖励×1。Boss奖励1邮票，区域首次另加3。", affixes: [] },
  { id: 1, name: "险路", hpMultiplier: 1.18, damageMultiplier: 1.15, rewardMultiplier: 1.5, description: "敌人生命×1.18，主动攻击伤害×1.15，星线奖励×1.5。敌方行动开始额外获得2护盾。Boss奖励2邮票。", affixes: [{ id: "armor", name: "厚衣", description: "每次敌方行动开始，每个敌人额外获得2点护盾。" }] },
  { id: 2, name: "深夜", hpMultiplier: 1.4, damageMultiplier: 1.3, rewardMultiplier: 2, description: "敌人生命×1.4，主动攻击伤害×1.3，星线奖励×2。厚衣生效；每逢第3、6、9…回合，敌人主动伤害再加2。Boss奖励3邮票。", affixes: [{ id: "armor", name: "厚衣", description: "每次敌方行动开始，每个敌人额外获得2点护盾。" }, { id: "fury", name: "夜潮", description: "每逢第3、6、9…回合，敌人的每次主动攻击伤害额外加2。" }] },
];

const CARD_BY_ID = Object.fromEntries([...CARDS, ...OPPORTUNITY_CARDS].map(item => [item.id, item]));
const RELIC_BY_ID = Object.fromEntries(RELICS.map(item => [item.id, item]));
const ENEMY_BY_ID = Object.fromEntries(ENEMIES.map(item => [item.id, item]));
const REGION_BY_ID = Object.fromEntries(REGIONS.map(item => [item.id, item]));

module.exports = {
  FIGHTERS, CARDS, OPPORTUNITY_CARDS, STARTING_TACTICS, RELICS, ENEMIES, REGIONS, DIFFICULTIES, STREET_ENCOUNTERS, STREET_BATTLE_PATH,
  CARD_BY_ID, RELIC_BY_ID, ENEMY_BY_ID, REGION_BY_ID, STATUS_RULES, BATTLE_RULES, ENVIRONMENTS,
};
