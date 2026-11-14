import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { battleBrief, fightFromRoster, guidedDraft, hasPublicDamage, parseRoster, selectableHeroes, sourceBasis } from "../js/engine.js";

const catalog = JSON.parse(readFileSync(new URL("../data/catalog.json", import.meta.url)));
const version = JSON.parse(readFileSync(new URL("../data/version.json", import.meta.url)));
const sample = JSON.parse(readFileSync(new URL("../data/sample-roster.json", import.meta.url)));
const roster = parseRoster(sample, catalog);

const basis = sourceBasis(catalog);
assert.equal(basis.ok, true, basis.problems.join(" | "));
assert.ok(basis.version.heroCount >= 100);
assert.equal(basis.version.season, "pvp_rta_ss21");
assert.match(basis.version.patchZh, /8\.7/);
assert.equal(version.heroCount, basis.version.heroCount);

const stripped = structuredClone(catalog);
delete stripped.provenance.rtaSeason;
assert.equal(sourceBasis(stripped).ok, false);
const asked = guidedDraft(catalog, roster, {}, { trials: 1, rank: "champion" });
assert.equal(asked.action.kind, "ask");

const askEnemyBan = guidedDraft(catalog, roster, {
  userFirst: true,
  prebansDone: false,
  enemyPrebansDone: false,
  userPicks: [],
  enemyPicks: [],
  prebans: [],
  enemyPrebans: [],
}, { trials: 1, rank: "champion" });
assert.equal(askEnemyBan.ok, true, askEnemyBan.reason?.summary);
assert.equal(askEnemyBan.action.kind, "enemy-preban");
assert.match(askEnemyBan.action.title, /對方預禁了哪 2 名/);
const openingBan = guidedDraft(catalog, roster, {
  userFirst: true,
  prebansDone: false,
  enemyPrebansDone: true,
  enemyPrebans: ["brieg", "charlotte"],
  userPicks: [],
  enemyPicks: [],
  prebans: [],
}, { trials: 1, rank: "champion" });
assert.equal(openingBan.ok, true, openingBan.reason?.summary);
assert.equal(openingBan.action.kind, "preban");
assert.equal(openingBan.action.ids.length, 2);
assert.equal(openingBan.action.ids.includes("brieg"), false);
assert.equal(openingBan.action.ids.includes("charlotte"), false);
assert.match(openingBan.action.title, /先禁/);

const firstMove = guidedDraft(catalog, roster, {
  userFirst: true,
  prebansDone: true,
  prebans: openingBan.action.ids,
  userPicks: [],
  enemyPicks: [],
}, { trials: 1, rank: "champion" });
assert.equal(firstMove.action.kind, "pick");
assert.equal(firstMove.action.ids.length, 1);
assert.match(firstMove.reason.summary, /先手規則/);
assert.match(firstMove.reason.summary, /先手 1-2-2/);
assert.match(firstMove.reason.summary, /我方第 1 選，關鍵/);

const theirFirst = guidedDraft(catalog, roster, {
  userFirst: false,
  prebansDone: true,
  prebans: [],
  userPicks: [],
  enemyPicks: [],
}, { trials: 1, rank: "champion" });
assert.equal(theirFirst.action.kind, "report");
assert.match(theirFirst.reason.summary, /後手 2-2-1/);
assert.match(theirFirst.reason.summary, /對方第 1 選，關鍵/);

const scales = selectableHeroes(catalog).find((hero) => hero.nameZh === "天秤之主");
assert.ok(scales);
const answerTwo = guidedDraft(catalog, roster, {
  userFirst: false,
  prebansDone: true,
  prebans: openingBan.action.ids,
  userPicks: [],
  enemyPicks: [scales.id],
}, { trials: 1, rank: "champion" });
assert.equal(answerTwo.ok, true, answerTwo.reason?.summary);
assert.equal(answerTwo.action.kind, "pick");
assert.equal(answerTwo.action.ids.length, 2);
assert.equal(answerTwo.action.ids.includes(scales.id), false);
assert.match(answerTwo.reason.summary, /關鍵/);

const heroIds = catalog.heroes.map((hero) => hero.id);
const lastBan = guidedDraft(catalog, roster, {
  userFirst: true,
  prebansDone: true,
  prebans: [],
  userPicks: heroIds.slice(0, 5),
  enemyPicks: heroIds.slice(5, 10),
}, { trials: 1, rank: "champion" });
assert.equal(lastBan.action.kind, "ban");
assert.notEqual(lastBan.action.id, heroIds[7]);
assert.match(lastBan.reason.summary, /保護/);
assert.match(lastBan.reason.summary, /關鍵/);

const brief = battleBrief(catalog, roster, {
  userFirst: true,
  userFight: heroIds.slice(0, 4),
  enemyFight: heroIds.slice(4, 8),
});
assert.equal(brief.ok, true, brief.reason?.summary);
assert.match(brief.reason.summary, /先打|先動/);
assert.match(brief.reason.summary, /開大/);
assert.match(brief.reason.summary, /先殺|增益|減益|開大給/);
assert.equal(brief.reason.summary.includes("不指定先殺"), false);
assert.equal(brief.reason.summary.includes("擦傷"), false);
assert.equal(brief.reason.summary.includes("cannotCrit"), false);
assert.match(brief.reason.summary, /還活著的機會/);
assert.match(brief.action.title, /^我方/);
assert.equal(brief.reason.summary.includes("使用率"), false);
assert.equal(brief.reason.summary.includes("速度分位"), false);
assert.equal(brief.reason.summary, brief.reason.lines.join("\n"));
for (const label of ["誰先打誰：", "要不要開大：", "打到誰：", "先殺誰："]) {
  assert.ok(brief.reason.lines.some((row) => row.startsWith(label)), label);
}
assert.match(brief.reason.lines.find((row) => row.startsWith("誰先打誰：")), /我方/);

const added = ["lone-crescent-bellona", "midnight-gala-lilias", "sylvan-sage-vivian"];
for (const id of added) {
  const hero = catalog.heroes.find((row) => row.id === id);
  assert.ok(hero, id);
  assert.equal(hero.skills.S1.soulburnCost, 10);
  assert.equal(hero.skills.S3.penetration, 0);
  assert.equal(typeof hero.skills.S3.cooldownShown, "number");
  assert.ok(hero.skills.S1.rate > 0 && hero.skills.S1.pow > 0);
  assert.ok(hero.skills.S3.rate > 0 && hero.skills.S3.pow > 0);
}
const bellona = catalog.heroes.find((row) => row.id === "lone-crescent-bellona");
assert.equal(bellona.skills.S1.rate, 1);
assert.equal(bellona.skills.S3.rate, 1.6);
assert.equal(bellona.skills.S3.cooldownShown, 3);
const gala = catalog.heroes.find((row) => row.id === "midnight-gala-lilias");
assert.equal(gala.skills.S1.rate, 1.1);
assert.equal(gala.skills.S3.rate, 0.5);
assert.equal(gala.skills.S3.cooldownShown, 4);
assert.equal(gala.skills.S3.effects.find((effect) => effect.kind === "penetrate").simulated, false);
const sage = catalog.heroes.find((row) => row.id === "sylvan-sage-vivian");
assert.equal(sage.skills.S1.rate, 1);
assert.equal(sage.skills.S1.targets, 1);
assert.equal(sage.skills.S3.rate, 1.1);
assert.equal(sage.skills.S3.targets, 3);
assert.equal(sage.skills.S3.cooldownShown, 5);
assert.equal(sage.skills.S1.effects.find((effect) => effect.kind === "crPush").amount, 15);
assert.equal(gala.skills.S2.effects.find((effect) => effect.amount === 15).simulated, false);
const filled = battleBrief(catalog, roster, {
  userFirst: true,
  userFight: [...added, heroIds[0]],
  enemyFight: heroIds.slice(1, 5),
});
assert.equal(filled.ok, true, filled.reason?.summary);
assert.equal(filled.reason.summary.includes("沒有技能倍率"), false);

const noRate = catalog.database.filter((hero) => !hasPublicDamage(hero)).map((hero) => hero.nameZh).sort();
assert.deepEqual(noRate, ["偵查兵瑪伊堤", "野生安卡拉"]);
for (const hero of catalog.database) {
  for (const slot of ["S1", "S2", "S3"]) {
    const skill = hero.skills[slot];
    assert.equal(typeof skill.rate, "number", `${hero.id} ${slot} rate`);
    assert.equal(typeof skill.pow, "number", `${hero.id} ${slot} pow`);
    assert.ok("cooldownShown" in skill, `${hero.id} ${slot} cooldown`);
    assert.ok("soulburnCost" in skill, `${hero.id} ${slot} soulburn`);
  }
}
const withCooldown = catalog.database.filter((hero) => ["S1", "S2", "S3"].some((slot) => typeof hero.skills[slot].cooldownShown === "number"));
assert.ok(withCooldown.length > 300, String(withCooldown.length));
const outsider = battleBrief(catalog, roster, {
  userFirst: true,
  userFight: ["sigret", "vildred", "mercedes", "ravi"],
  enemyFight: heroIds.slice(0, 4),
});
assert.equal(outsider.ok, true, outsider.reason?.summary);
assert.equal(outsider.reason.summary.includes("沒有技能倍率"), false);
const scout = battleBrief(catalog, roster, {
  userFirst: true,
  userFight: ["mighty-scout", heroIds[0], heroIds[1], heroIds[2]],
  enemyFight: heroIds.slice(3, 7),
});
assert.equal(scout.ok, false);
assert.match(scout.reason.summary, /偵查兵瑪伊堤/);
assert.match(scout.reason.summary, /沒有技能倍率/);
assert.match(filled.reason.summary, /先打|先動/);
assert.equal(filled.reason.summary.includes("不指定先殺"), false);

const notosPick = guidedDraft(catalog, roster, {
  userFirst: true,
  prebansDone: true,
  prebans: [],
  userPicks: ["estelle"],
  enemyPicks: ["notos", "mercedes"],
}, { trials: 1, rank: "champion" });
assert.equal(notosPick.ok, true, notosPick.reason?.summary);
assert.equal(notosPick.action.kind, "pick");
assert.equal(notosPick.action.ids.length, 2);
assert.match(notosPick.reason.summary, /諾托斯/);
assert.match(notosPick.reason.summary, /計數器|反制|協同|速度|建造|配對/);
assert.match(notosPick.reason.summary, /我方已選/);
assert.match(notosPick.reason.summary, /對方已選/);
assert.match(notosPick.reason.summary, /保護位|關鍵位/);
assert.equal(notosPick.action.ids.includes("estelle"), false);
assert.equal(notosPick.action.ids.includes("notos"), false);
assert.equal(notosPick.reason.summary.includes("無視所有"), false);

const damagePick = guidedDraft(catalog, roster, {
  userFirst: true,
  prebansDone: true,
  prebans: [],
  userPicks: ["estelle"],
  enemyPicks: ["mercedes", "ras"],
}, { trials: 1, rank: "champion" });
const buffPick = guidedDraft(catalog, roster, {
  userFirst: true,
  prebansDone: true,
  prebans: [],
  userPicks: ["estelle"],
  enemyPicks: ["diene", "elena"],
}, { trials: 1, rank: "champion" });
assert.equal(damagePick.ok, true, damagePick.reason?.summary);
assert.equal(buffPick.ok, true, buffPick.reason?.summary);
assert.notDeepEqual(damagePick.action.ids, buffPick.action.ids);
assert.match(buffPick.reason.summary, /迪埃妮|艾蕾娜/);
assert.match(damagePick.reason.summary, /玫勒賽德絲|拉斯/);

const yulhaBrief = battleBrief(catalog, roster, {
  userFirst: true,
  userFight: ["arbiter-vildred", "aubade-ludwig", "belian", "estelle"],
  enemyFight: ["school-nurse-yulha", "perfumer-byblis", "notos", "lisette"],
});
assert.equal(yulhaBrief.ok, true, yulhaBrief.reason?.summary);
assert.match(yulhaBrief.action.title, /^我方/);
assert.equal(/^對方/.test(yulhaBrief.action.title), false);
assert.match(yulhaBrief.reason.summary, /我方/);

const specterBrief = battleBrief(catalog, roster, {
  userFirst: true,
  userFight: ["arbiter-vildred", "aubade-ludwig", "belian", "estelle"],
  enemyFight: ["sea-phantom-politis", "mercedes", "ras", "diene"],
});
assert.equal(specterBrief.ok, true, specterBrief.reason?.summary);
const specterAt = specterBrief.reason.summary.indexOf("海上幽靈佛里蒂絲");
const specterEnd = specterBrief.reason.summary.indexOf("玫勒賽德絲", specterAt);
const specterSlice = specterBrief.reason.summary.slice(specterAt, specterEnd);
assert.match(specterSlice, /隱身/);
assert.match(specterSlice, /資源減少 50%/);
assert.equal(specterSlice.includes("使用率"), false);

const warfare = battleBrief(catalog, roster, {
  userFirst: false,
  userFight: ["arbiter-vildred", "aubade-ludwig", "belian", "estelle"],
  enemyFight: ["notos", "hecate", "mei-lin", "dark-corvus"],
});
assert.equal(warfare.ok, true, warfare.reason?.summary);
for (const name of ["諾托斯", "赫卡特", "梅鈴", "黑暗的科爾布思"]) {
  assert.match(warfare.reason.summary, new RegExp(`${name}[\\s\\S]{0,80}開場大招可用`));
}
const ranger = battleBrief(catalog, roster, {
  userFirst: true,
  userFight: ["arbiter-vildred", "belian", "estelle", "harsetti"],
  enemyFight: ["aubade-ludwig", "mercedes", "ras", "diene"],
});
assert.equal(ranger.ok, true, ranger.reason?.summary);
const rangerAt = ranger.reason.summary.indexOf("黎明的序曲魯特比");
const rangerSlice = ranger.reason.summary.slice(rangerAt, rangerAt + 180);
assert.match(rangerSlice, /黎明的序曲魯特比/);
assert.equal(rangerSlice.includes("16.41%"), false);
assert.equal(ranger.reason.summary.includes("使用率"), false);
const worn = fightFromRoster({
  userFight: ["arbiter-vildred", "belian", "estelle", "harsetti"],
  enemyFight: ["aubade-ludwig", "mercedes", "ras", "diene"],
  userFirst: true,
}, roster, catalog, { order: ["S1"], burn: false }, "max", () => 0.5);
assert.match(worn.log.join("\n"), /黎明寶珠 最大強化，獲得 10 魂/);
const light = fightFromRoster({
  userFight: ["arbiter-vildred", "belian", "estelle", "harsetti"],
  enemyFight: ["aubade-ludwig", "mercedes", "ras", "diene"],
  userFirst: true,
}, roster, catalog, { order: ["S1"], burn: false }, "max", () => 0.8);
assert.match(light.log.join("\n"), /引導之光 最大強化/);
assert.match(light.log.join("\n"), /隱身 1 回合/);
assert.match(yulhaBrief.reason.summary, /增益/);
const yulhaWho = yulhaBrief.reason.lines.find((row) => row.startsWith("誰先打誰："));
const yulhaUlt = yulhaBrief.reason.lines.find((row) => row.startsWith("要不要開大："));
assert.match(yulhaWho, /我方/);
assert.match(yulhaUlt, /我方|要開大|不開大|開大給/);
assert.equal(yulhaBrief.action.title.includes("對方"), false);
assert.equal(yulhaBrief.reason.summary.includes("不指定先殺"), false);
const ruled = battleBrief(catalog, roster, {
  userFirst: true,
  rule: "attack",
  userFight: heroIds.slice(0, 4),
  enemyFight: heroIds.slice(4, 8),
});
assert.equal(ruled.reason.lines[0], "戰爭規則：進攻。靈魂燃燒技能造成的傷害提升 15%。");
const plain = battleBrief(catalog, roster, {
  userFirst: true,
  rule: "none",
  userFight: heroIds.slice(0, 4),
  enemyFight: heroIds.slice(4, 8),
});
assert.equal(plain.reason.lines[0], "戰爭規則：無規則。");
assert.equal(plain.reason.summary.includes("靈魂燃燒技能造成的傷害提升 15%"), false);
const aubeFight = battleBrief(catalog, roster, {
  userFirst: true,
  rule: "defense",
  userFight: ["arbiter-vildred", "belian", "estelle", "harsetti"],
  enemyFight: ["aube", "mercedes", "ras", "diene"],
});
assert.equal(aubeFight.ok, true, aubeFight.reason?.summary);
assert.match(aubeFight.reason.summary, /可提升回收量與防護強度 30%/);
assert.match(aubeFight.reason.summary, /奧芙/);
assert.equal(aubeFight.reason.summary.includes("速度分位"), false);
assert.equal(aubeFight.reason.summary.includes("使用率"), false);
assert.equal(aubeFight.reason.summary.includes("梯隊"), false);
assert.equal(aubeFight.reason.summary.includes("Aubade"), false);
assert.equal(aubeFight.reason.summary.includes("Postban"), false);
const protectedBan = heroIds[7];
assert.equal(lastBan.action.id === protectedBan, false);

const mage = catalog.heroes.find((hero) => hero.role === "mage");
const rest = catalog.heroes.filter((hero) => hero.id !== mage.id);
const booked = fightFromRoster({
  userFight: [mage.id, rest[0].id, rest[1].id, rest[2].id],
  enemyFight: [rest[3].id, rest[4].id, rest[5].id, rest[6].id],
}, roster, catalog, { order: ["S1"], burn: false }, "base", () => 0.5);
assert.match(booked.log.join("\n"), /魂書/);
assert.match(booked.log.join("\n"), /20 魂/);
const list = selectableHeroes(catalog);
assert.ok(list.some((hero) => hero.nameZh === "天秤之主"));
assert.ok(list.some((hero) => hero.nameZh === "一輪孤月維爾蘿娜"));
assert.ok(list.some((hero) => hero.nameZh === "黎明的序曲魯特比" && hero.aliases.includes("黎明序曲魯特比")));
assert.equal(list.some((hero) => hero.id === "ludwig"), false);
assert.equal(list.some((hero) => hero.id === "swift-flagbearer-sigret"), false);
assert.ok(list.some((hero) => hero.nameZh === "執行官維德瑞"));
assert.ok(list.length > 300);
assert.ok(list.some((hero) => hero.listed === false));
function sideDraft(enemyIds) {
  const state = {
    userFirst: true,
    prebansDone: true,
    enemyPrebansDone: true,
    enemyPrebans: [],
    prebans: [],
    userPicks: [],
    enemyPicks: [],
  };
  const reasons = [];
  for (let guard = 0; state.userPicks.length < 5 && guard < 20; guard += 1) {
    const result = guidedDraft(catalog, roster, state, { rank: "champion", trials: 1 });
    if (result.action.kind === "pick") {
      for (const id of result.action.ids) {
        assert.equal(state.userPicks.includes(id) || state.enemyPicks.includes(id), false, id);
        state.userPicks.push(id);
      }
      reasons.push(result.reason.summary);
    } else if (result.action.kind === "report") {
      const next = enemyIds[state.enemyPicks.length];
      assert.ok(next);
      state.enemyPicks.push(next);
    } else {
      break;
    }
  }
  return { picks: state.userPicks, reasons: reasons.join("\n") };
}
const knights = sideDraft(["brieg", "unbound-knight-arowell", "charles", "hasol", "charlotte"]);
const buffers = sideDraft(["diene", "elena", "mercedes", "ras", "dark-corvus"]);
assert.equal(knights.picks.length, 5, knights.reasons);
assert.equal(buffers.picks.length, 5, buffers.reasons);
assert.notDeepEqual(knights.picks, buffers.picks);
assert.match(knights.reasons, /計數器|反制|速度|建造|協同|配對/);
assert.match(buffers.reasons, /計數器|反制|速度|建造|協同|配對/);
const fixed = ["rhianna-and-luciella", "eye-of-the-abyss-fumyr", "school-nurse-yulha", "aubade-ludwig", "lady-of-the-scales"];
assert.notDeepEqual(knights.picks, fixed);
assert.equal(knights.picks[0], "arbiter-vildred");
assert.equal(buffers.picks[0], "arbiter-vildred");

const yulhaCombo = battleBrief(catalog, roster, {
  userFirst: true,
  userFight: ["school-nurse-yulha", "estelle", "arbiter-vildred", "notos"],
  enemyFight: ["brieg", "charles", "hasol", "charlotte"],
});
assert.equal(yulhaCombo.ok, true, yulhaCombo.reason?.summary);
assert.equal(yulhaCombo.action.title, "我方保健室老師律荷開大給艾絲黛");
assert.match(yulhaCombo.reason.summary, /技能組合：保健室老師律荷大招給隊友/);
assert.match(yulhaCombo.reason.summary, /戰鬥準備度 \+50%/);
assert.match(yulhaCombo.reason.summary, /超人化 3 回合，最大生命增加 100%，速度增加 100%/);
assert.match(yulhaCombo.reason.summary, /艾絲黛的傷害依自己最大生命增加/);
assert.equal(yulhaCombo.reason.summary.includes("吸收"), false);

const dieneCombo = battleBrief(catalog, roster, {
  userFirst: true,
  userFight: ["diene", "arbiter-vildred", "belian", "aubade-ludwig"],
  enemyFight: ["brieg", "charles", "hasol", "charlotte"],
});
assert.equal(dieneCombo.ok, true, dieneCombo.reason?.summary);
assert.match(dieneCombo.action.title, /^我方迪埃妮開二技給/);
assert.match(dieneCombo.reason.summary, /增加攻擊 2 回合，頁上沒寫比例/);
assert.match(dieneCombo.reason.summary, /防護罩 2 回合，依目標最大生命，沒有印吸收比例，不另編/);
assert.match(dieneCombo.reason.summary, /戰鬥準備度 \+15%/);

const e7 = JSON.parse(readFileSync(new URL("../data/e7rtabot-rta.json", import.meta.url)));
const overForty = Object.values(e7.英雄).filter((row) => row.選擇率 > 0.4);
assert.equal(overForty.length, 0);
assert.deepEqual(e7.出場率門檻["超過40%"], []);
assert.deepEqual(e7.出場率門檻.缺頁, []);

console.log("screen tests passed", { next: firstMove.action.title, brief: brief.action.title, knights: knights.picks, buffers: buffers.picks });
