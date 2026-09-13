"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FAMILIES } = require("../utils/content");
const {
  FIGHTERS, CARDS, OPPORTUNITY_CARDS, STARTING_TACTICS, RELICS, ENEMIES, REGIONS, DIFFICULTIES,
  CARD_BY_ID, RELIC_BY_ID, ENEMY_BY_ID, REGION_BY_ID, STATUS_RULES, BATTLE_RULES, ENVIRONMENTS,
} = require("../utils/combat-content");
const { STATUS_GUIDE } = require("../utils/status-help");

const roles = new Set(["guard", "combo", "echo"]);
const kinds = new Set(["damage", "block", "heal", "draw", "energy", "charge", "mark", "weak", "burn", "counter", "echo", "retainBlock", "cleanse", "stripBlock", "intercept", "discover", "scout", "environment"]);
const effectTargets = new Set(["self", "party", "enemy", "enemies"]);
const cardTargets = new Set(["enemy", "ally", "self", "allEnemies", "allAllies"]);
const triggers = new Set(["battleStart", "turnStart", "attack", "guard", "heal", "marked", "thirdPlay", "kill"]);

test("三套场景和21敌人及三首领二阶段均引用本地区实际资源", () => {
  const art = require("../assets/battle/manifest");
  assert.deepEqual(Object.keys(art.enemies).sort(), ENEMIES.map(enemy => enemy.id).sort());
  assert.deepEqual(Object.keys(art.scenes).sort(), REGIONS.map(region => region.id).sort());
  for (const enemy of ENEMIES) {
    const entry = art.enemies[enemy.id];
    for (const pose of enemy.phase2 ? ["idle", "phase2"] : ["idle"]) {
      assert(entry[pose].startsWith(`/package-${enemy.regionId}/assets/art/`));
      assert(fs.statSync(path.join(__dirname, "..", entry[pose])).size > 0);
    }
    if (enemy.phase2) assert(!fs.readFileSync(path.join(__dirname, "..", entry.idle)).equals(fs.readFileSync(path.join(__dirname, "..", entry.phase2))));
  }
  for (const region of REGIONS) for (const layer of ["background", "middle", "front"]) {
    assert(art.scenes[region.id][layer].startsWith(`/package-${region.id}/assets/art/`));
    assert(fs.statSync(path.join(__dirname, "..", art.scenes[region.id][layer])).size > 0);
  }
  let coverBytes = 0;
  for (const region of REGIONS) {
    const cover = art.scenes[region.id].cover;
    assert(cover.startsWith("/assets/scenes/"), "大厅封面必须随主包下载");
    const bytes = fs.readFileSync(path.join(__dirname, "..", cover));
    assert.equal(bytes.readUInt16BE(0), 0xffd8);
    coverBytes += bytes.length;
  }
  assert(coverBytes <= 70000, "封面不得挤占伙伴资源预算");
});

test("主包22位待机PNG保持四档收藏身份，动作资源独立分包", () => {
  const art = require("../assets/battle/manifest");
  const game = require("../utils/game");
  const state = game.createState();
  const before = JSON.stringify(state);
  assert.equal(art.style, "paper-courier");
  assert.deepEqual(Object.keys(art.heroes).sort(), FAMILIES.map(f => f.id).sort());
  const files = new Set();
  for (const family of FAMILIES) {
    const hero = art.heroes[family.id];
    for (const pose of ["idle"]) {
      assert(hero[pose].startsWith("/assets/partners/"), `${family.id}/${pose} 不应回到旧图`);
      const file = path.join(__dirname, "..", hero[pose]);
      const bytes = fs.readFileSync(file);
      assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
      assert(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0);
      files.add(file);
    }
    const variants = game.getFamily(state, family.id).variants;
    assert.deepEqual(variants.map(v => v.tier), ["R", "SR", "SSR", "UR"]);
    assert(variants.every(v => v.image === hero.idle));
  }
  assert.equal(files.size, 22);
  assert.equal(JSON.stringify(state), before, "外观读取不能更改存档");
});

function checkEffect(item) {
  assert(kinds.has(item.kind), `未支持的效果 ${item.kind}`);
  assert(Number.isInteger(item.amount) && item.amount > 0, "效果必须是正整数");
  assert(!item.target || effectTargets.has(item.target), `未支持的效果目标 ${item.target}`);
  if (item.minPlays !== undefined) assert(Number.isInteger(item.minPlays) && item.minPlays >= 2);
  if (item.kind === "environment") {
    assert.equal(item.amount, 1);
    assert(ENVIRONMENTS[item.environmentId], `未知环境 ${item.environmentId}`);
  } else assert.equal(item.environmentId, undefined);
  const expected = ["amount", "kind", ...(item.minPlays ? ["minPlays"] : []), ...(item.target ? ["target"] : []), ...(item.environmentId ? ["environmentId"] : [])].sort();
  assert.deepEqual(Object.keys(item).sort(), expected);
}

function abilitySignature(item) {
  return [item.trigger, item.kind, item.target, item.frequency].join("/");
}

test("22位原公仔都有独立战斗身份，初始三人分别覆盖三流派", () => {
  assert.deepEqual(Object.keys(FIGHTERS).sort(), FAMILIES.map(item => item.id).sort());
  assert.equal(FIGHTERS.sheep.role, "guard");
  assert.equal(FIGHTERS.orangecat.role, "combo");
  assert.equal(FIGHTERS.nav.role, "echo");
  for (const fighter of Object.values(FIGHTERS)) {
    assert.equal(FIGHTERS[fighter.id], fighter);
    assert(roles.has(fighter.role));
    assert(Number.isInteger(fighter.maxHp) && fighter.maxHp >= 35 && fighter.maxHp <= 60);
    assert.equal(fighter.cards.length, 2);
    assert.equal(new Set(fighter.cards).size, 2);
    for (const id of fighter.cards) {
      assert.equal(CARD_BY_ID[id].familyId, fighter.id);
      assert.equal(CARD_BY_ID[id].role, fighter.role);
    }
  }
});

test("74张永久牌与6张机会牌分池入库，字典不丢失或覆盖内容", () => {
  assert.equal(CARDS.length, 74);
  assert.equal(CARDS.filter(item => item.familyId).length, 44);
  assert.equal(CARDS.filter(item => item.familyId === null).length, 30);
  assert.equal(OPPORTUNITY_CARDS.length, 6);
  assert.equal(Object.keys(CARD_BY_ID).length, 80);
  assert(CARDS.every(item => !item.temporary));
  assert(OPPORTUNITY_CARDS.every(item => item.temporary && item.exhaust));
  assert.equal(CARD_BY_ID.strike.familyId, null);
  assert.equal(CARD_BY_ID.guard.familyId, null);
  for (const [items, index] of [[RELICS, RELIC_BY_ID], [ENEMIES, ENEMY_BY_ID], [REGIONS, REGION_BY_ID]]) {
    assert.equal(Object.keys(index).length, items.length);
    assert.equal(new Set(items.map(item => item.name)).size, items.length);
    items.forEach(item => assert.equal(index[item.id], item));
  }
  for (const item of [...CARDS, ...OPPORTUNITY_CARDS]) assert.equal(CARD_BY_ID[item.id], item);
  assert.equal(new Set([...CARDS, ...OPPORTUNITY_CARDS].map(item => item.id)).size, 80);
  assert.equal(new Set([...CARDS, ...OPPORTUNITY_CARDS].map(item => item.name)).size, 80);
  const exclusiveIds = Object.values(FIGHTERS).flatMap(item => item.cards).sort();
  assert.deepEqual(exclusiveIds, CARDS.filter(item => item.familyId).map(item => item.id).sort());
});

test("所有牌只包含可执行契约原语，升级提供可见且不退化的效果", () => {
  for (const item of [...CARDS, ...OPPORTUNITY_CARDS]) {
    assert(roles.has(item.role));
    assert(cardTargets.has(item.target));
    assert(Number.isInteger(item.cost) && item.cost >= 0 && item.cost <= 4);
    assert(item.description.endsWith("。") && item.upgradeDescription.endsWith("。"));
    assert(Array.isArray(item.effects) && item.effects.length > 0);
    assert(item.upgradeEffects.length >= item.effects.length);
    [...item.effects, ...item.upgradeEffects].forEach(checkEffect);
    assert.notDeepEqual(item.upgradeEffects, item.effects, `${item.id} 升级必须有可见提升`);
    item.effects.forEach(effect => {
      const upgraded = item.upgradeEffects.find(candidate => candidate.kind === effect.kind && candidate.target === effect.target && candidate.minPlays === effect.minPlays && candidate.environmentId === effect.environmentId);
      assert(upgraded, `${item.id} 升级后不能丢失基础效果`);
      assert.equal(upgraded.kind, effect.kind);
      assert.equal(upgraded.target, effect.target);
      assert.equal(upgraded.minPlays, effect.minPlays);
      assert(upgraded.amount >= effect.amount, `${item.id} 升级效果不应降低`);
    });
  }
  assert.deepEqual(Object.fromEntries([0, 1, 2, 3, 4].map(cost => [cost, CARDS.filter(item => item.cost === cost).length])), { 0: 9, 1: 25, 2: 29, 3: 8, 4: 3 });
});

test("零费循环资源只来自消耗牌，蓄能下回合释放且发现与观星不会递归", () => {
  for (const item of [...CARDS, ...OPPORTUNITY_CARDS]) {
    for (const effects of [item.effects, item.upgradeEffects]) {
      if (item.cost === 0 && effects.some(effect => ["draw", "energy", "charge", "discover", "scout"].includes(effect.kind))) assert.equal(item.exhaust, true, item.id);
      const energy = effects.filter(effect => effect.kind === "energy").reduce((total, effect) => total + effect.amount, 0);
      assert(energy <= item.cost, `${item.id} 不能产生无次数限制的净能量`);
      if (energy > 0) assert(!effects.some(effect => effect.kind === "draw"), `${item.id} 不应同时补能和过牌`);
      effects.filter(effect => effect.kind === "charge").forEach(effect => assert(effect.amount <= STATUS_RULES.maxCharge));
      effects.filter(effect => ["discover", "scout"].includes(effect.kind)).forEach(effect => assert.equal(effect.amount, 3));
    }
  }
  assert.equal(CARDS.filter(item => item.tactic).length, 12);
  assert.equal([...CARDS, ...OPPORTUNITY_CARDS].filter(item => item.chargeDiscount).length, 0);
  assert(OPPORTUNITY_CARDS.every(item => !item.effects.some(effect => ["discover", "scout"].includes(effect.kind))));
  assert(CARD_BY_ID["quick-sketch"].description.includes("本场战斗移出牌组循环"));
  assert.equal(CARD_BY_ID["quick-sketch"].exhaust, true);
  assert.equal(CARD_BY_ID["wax-spark"].exhaust, true);
  assert.equal(CARD_BY_ID["dusk-ledger"].exhaust, true);
  assert(CARD_BY_ID["sealed-route"].description.includes("本回合第3张或之后"));
  assert.deepEqual([CARD_BY_ID["wind-up-stamp"].cost, CARD_BY_ID["thermos-pause"].cost, CARD_BY_ID["relay-mark"].cost], [2, 2, 2]);
  assert.equal(CARD_BY_ID["borrowed-step"].effects.some(effect => effect.kind === "energy"), false);
  assert.deepEqual(CARD_BY_ID["chance-mark"].effects.map(effect => effect.kind), ["environment", "mark"]);
  assert.equal(CARD_BY_ID["chance-mark"].effects[0].environmentId, "tailwind");
  assert.deepEqual(CARD_BY_ID["quick-sketch"].upgradeEffects.map(effect => effect.kind), ["discover", "charge"]);
});

test("四套起手战术只替换三位伙伴的基础攻击并引用真实通用牌", () => {
  assert.deepEqual(STARTING_TACTICS.map(item => item.id), ["classic", "relay", "reserve", "weather"]);
  assert.deepEqual(STARTING_TACTICS[0].cards, []);
  for (const tactic of STARTING_TACTICS.slice(1)) {
    assert.equal(tactic.cards.length, 3);
    assert.equal(new Set(tactic.cards).size, 3);
    tactic.cards.forEach(id => assert.equal(CARD_BY_ID[id].familyId, null));
  }
  for (const tactic of STARTING_TACTICS.slice(1, 3)) tactic.cards.forEach(id => assert(CARD_BY_ID[id].tactic));
  assert.match(STARTING_TACTICS.find(item => item.id === "relay").summary, /发现/);
  assert.match(STARTING_TACTICS.find(item => item.id === "reserve").summary, /观星/);
  assert.deepEqual(STARTING_TACTICS.find(item => item.id === "weather").cards, ["folded-corner", "stamped-route", "express-finale"]);
});

test("专属牌具有不同效果结构，不靠改名或单独改数值冒充独特技能", () => {
  const signatures = new Map();
  for (const item of CARDS.filter(card => card.familyId)) {
    const signature = JSON.stringify([item.cost, item.target, item.effects.map(effect => [effect.kind, effect.target || item.target])]);
    assert(!signatures.has(signature), `${item.id} 与 ${signatures.get(signature)} 效果结构相同`);
    signatures.set(signature, item.id);
  }
  assert.equal(signatures.size, 44);
});

test("22被动与18遗物均有真实触发时机、目标和一次触发频率", () => {
  assert.equal(RELICS.length, 18);
  const passives = Object.values(FIGHTERS).map(item => item.passive);
  assert.equal(new Set(passives.map(abilitySignature)).size, 22);
  assert.equal(new Set(RELICS.map(abilitySignature)).size, 18);
  for (const item of [...passives, ...RELICS]) {
    assert(triggers.has(item.trigger), item.name);
    assert(kinds.has(item.kind), item.name);
    assert(effectTargets.has(item.target), item.name);
    assert(["turn", "battle"].includes(item.frequency), item.name);
    assert(Number.isInteger(item.amount) && item.amount > 0);
    assert(item.description.includes(item.frequency === "turn" ? "每回合限1次" : "每场战斗限1次"));
    if (["energy", "draw"].includes(item.kind)) assert(item.amount <= 1, "被动与遗物不应一次补满资源");
  }
});

test("牌面准确公开新版标记、虚弱、回响与保盾语义及升级数值", () => {
  assert.match(CARD_BY_ID["nav-chart"].description, /2层标记（每次直接伤害额外加2，消耗1层）/);
  assert.match(CARD_BY_ID["nav-chart"].upgradeDescription, /3层标记/);
  assert.match(CARD_BY_ID["quiet-bell"].description, /所有敌人施加1回合虚弱（主动伤害降低25%）/);
  assert.match(CARD_BY_ID["ticket-replay"].description, /首个伤害效果追加50%/);
  assert.match(CARD_BY_ID["sheep-coat"].description, /自身获得12点护盾.*接下来1次回合开始保留护盾/);
  assert.match(CARD_BY_ID["sheep-coat"].upgradeDescription, /自身获得16点护盾/);
  assert.match(CARD_BY_ID["ink-drop"].description, /4层灼烧.*无视护盾扣当前层数生命/);
  assert.match(CARD_BY_ID["safety-pin"].description, /每次遭敌主动攻击后反击5点伤害.*获得6点护盾/);
  assert.match(CARD_BY_ID["folded-corner"].description, /雨幕.*直接伤害降低2点.*下个己方回合开始/);
  assert.match(CARD_BY_ID["paper-dart"].description, /顺风.*直接伤害提高2点.*下个己方回合开始/);
  assert.match(CARD_BY_ID["address-label"].description, /灼烧、虚弱和标记各减少1/);
  assert.match(CARD_BY_ID["loose-thread"].description, /移除目标敌人5点护盾（不造成伤害）/);
  assert.match(CARD_BY_ID["sleeve-knot"].description, /拦截下一次.*单体主动攻击/);
  assert.match(CARD_BY_ID["quick-sketch"].description, /3张随机机会牌中选择1张/);
  assert.match(CARD_BY_ID["wax-spark"].description, /牌组顶3张牌.*其余依原顺序置于牌组底/);
});

test("战斗预算、环境和状态说明引用同一组公开规则", () => {
  assert.deepEqual(BATTLE_RULES, { energyStart: 3, energyLate: 4, energyGrowthTurn: 3, bankLimit: 1, tradeCost: 1, pressureTurn: 9, pressureStep: 2 });
  assert.equal(STATUS_RULES.maxCharge, 3);
  assert.deepEqual(Object.fromEntries(Object.values(ENVIRONMENTS).map(item => [item.id, item.damageModifier])), { rain: -2, tailwind: 2 });
  const guideIds = STATUS_GUIDE.map(item => item.id);
  for (const id of ["echo", "mark", "weak", "burn", "counter", "retainBlock", "charge", "exhaust", "retain", "sequence", "environment", "cleanse", "stripBlock", "intercept", "discover", "scout", "trade", "pressure"]) assert(guideIds.includes(id), id);
  const help = Object.fromEntries(STATUS_GUIDE.map(item => [item.id, item.rules.join(" ")]));
  assert.match(help.charge, /第 1—2 回合基础补给各有 3 点能量.*第 3 回合起基础补给为 4 点/);
  assert.match(help.charge, /新回合开始时，全部蓄能会变成额外能量/);
  assert.match(help.charge, /剩余能量最多将 1 点存为蓄能.*最多 3 层/);
  assert.match(help.environment, /雨幕.*-2.*顺风.*\+2/);
  assert.match(help.discover, /固定的6张机会牌池随机给出3张/);
  assert.match(help.trade, /花费 1 点预算.*不是打牌/);
  assert.match(help.pressure, /第 9 回合.*每过 2 回合/);
});

test("三个区域各有4普通、2精英和1个双阶段Boss，召唤绝不越区", () => {
  assert.equal(ENEMIES.length, 21);
  assert.deepEqual(REGIONS.map(item => item.id), ["street", "bridge", "market"]);
  for (const region of REGIONS) {
    assert.equal(region.normalIds.length, 4);
    assert.equal(region.eliteIds.length, 2);
    const ids = [...region.normalIds, ...region.eliteIds, region.bossId];
    assert.equal(new Set(ids).size, 7);
    assert.deepEqual(ENEMIES.filter(item => item.regionId === region.id).map(item => item.id).sort(), ids.sort());
    region.normalIds.forEach(id => assert.equal(ENEMY_BY_ID[id].rank, "normal"));
    region.eliteIds.forEach(id => assert.equal(ENEMY_BY_ID[id].rank, "elite"));
    assert.equal(ENEMY_BY_ID[region.bossId].rank, "boss");
    assert(ENEMY_BY_ID[region.bossId].phase2);
    for (const enemy of ENEMIES.filter(item => item.regionId === region.id)) {
      assert(Number.isInteger(enemy.maxHp) && enemy.maxHp > 0);
      if (enemy.rank !== "boss") assert.equal(enemy.phase2, undefined);
      const stages = enemy.phase2 ? [enemy, enemy.phase2] : [enemy];
      for (const stage of stages) {
        assert(stage.patterns.length >= 2);
        assert(Number.isInteger(stage.maxHp) && stage.maxHp > 0);
        stage.patterns.forEach(pattern => {
          assert(["attack", "block", "burn", "weak", "summon"].includes(pattern.kind));
          assert(["lowest", "front", "all"].includes(pattern.target));
          assert(Number.isInteger(pattern.amount) && pattern.amount > 0);
          if (pattern.kind === "summon") {
            assert.equal(pattern.amount, 1);
            assert(region.normalIds.includes(pattern.summonId));
          } else assert.equal(pattern.summonId, undefined);
        });
      }
      if (enemy.phase2) assert.notDeepEqual(enemy.phase2.patterns, enemy.patterns);
    }
  }
});

test("Boss使用可见的防御与蓄力序列，灯市Boss两阶段召唤不同普通怪", () => {
  const lion = ENEMY_BY_ID["paper-lion"];
  const tide = ENEMY_BY_ID["ink-tide"];
  const bell = ENEMY_BY_ID["bell-warden"];
  assert.equal(lion.patterns[0].kind, "block");
  assert.equal(lion.patterns[1].kind, "attack");
  assert.equal(tide.patterns[0].kind, "block");
  assert.equal(tide.patterns[1].kind, "attack");
  assert(tide.patterns[1].amount > lion.patterns[1].amount);
  assert.equal(bell.patterns[0].summonId, "lantern-mote");
  assert.equal(bell.phase2.patterns[0].summonId, "bell-sprite");
});

test("每区事件提供两种明确收益路线，难度只公开约定倍数和词缀", () => {
  for (const region of REGIONS) {
    assert.equal(region.events.length, 2);
    for (const event of region.events) {
      assert.equal(event.choices.length, 2);
      assert.equal(new Set(event.choices.map(item => item.id)).size, 2);
      for (const choice of event.choices) {
        assert(Number.isInteger(choice.heal) && choice.heal >= 0);
        assert(Number.isInteger(choice.threads) && choice.threads > 0);
        assert(choice.description.includes(`${choice.threads}星线`));
        if (choice.heal) assert(choice.description.includes(`${choice.heal}点生命`));
        assert(choice.upgrade === undefined || choice.upgrade === true);
      }
    }
  }
  assert.deepEqual(DIFFICULTIES.map(item => item.id), [0, 1, 2]);
  assert.deepEqual(DIFFICULTIES.map(item => item.affixes.map(affix => affix.id)), [[], ["armor"], ["armor", "fury"]]);
  for (let i = 0; i < DIFFICULTIES.length; i += 1) {
    const item = DIFFICULTIES[i];
    for (const key of ["hpMultiplier", "damageMultiplier", "rewardMultiplier"]) {
      assert(Number.isFinite(item[key]) && item[key] >= 1);
      if (i) assert(item[key] > DIFFICULTIES[i - 1][key]);
    }
  }
});
