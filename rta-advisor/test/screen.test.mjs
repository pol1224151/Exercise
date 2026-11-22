import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GEAR_ASK, battleBrief, effectGapItems, fightFromRoster, guidedDraft as guidedDraftRaw, hasPublicDamage, heroCode, parseRoster, rosterReadLine, selectableHeroes, sourceBasis } from "../js/engine.js";

function guidedDraft(catalog, roster, state = {}, options = {}) {
  if (state.rule && state.userFirst != null && state.prebansDone == null && !options.rawPreban) {
    state = {
      prebans: ["estelle", "zio"],
      prebansDone: true,
      enemyPrebans: ["belian", "tidal-rift-elvira"],
      enemyPrebansDone: true,
      ...state,
    };
  }
  return guidedDraftRaw(catalog, roster, state, options);
}

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
assert.equal(asked.action.title, rosterReadLine(roster));
assert.deepEqual(asked.reason.lines, [rosterReadLine(roster)]);
const noGear = guidedDraft(catalog, { heroes: [], unknown: [] }, {});
assert.equal(noGear.ok, false);
assert.equal(noGear.action.title, GEAR_ASK);
assert.equal(noGear.reason.summary.includes("選"), false);

const firstMove = guidedDraft(catalog, roster, {
  userFirst: true,
  rule: "attack",
  userPicks: [],
  enemyPicks: [],
}, { trials: 1, rank: "champion" });
assert.equal(firstMove.action.kind, "pick");
assert.equal(firstMove.action.ids.length, 3);
assert.equal(firstMove.action.need, 1);
assert.match(firstMove.reason.summary, /【局面確認】/);
assert.match(firstMove.reason.summary, /【我方推薦 Top 3】/);
assert.match(firstMove.reason.summary, /燒魂傷害提高/);
assert.equal(firstMove.reason.summary.includes("【BAN 建議】"), false);
assert.equal(firstMove.reason.summary.includes("【戰鬥建議】"), false);
assert.equal(firstMove.reason.summary.includes("【對手新角色檔案】"), false);

const theirFirst = guidedDraft(catalog, roster, {
  userFirst: false,
  rule: "defense",
  userPicks: [],
  enemyPicks: [],
}, { trials: 1, rank: "champion" });
assert.equal(theirFirst.action.kind, "report");
assert.match(theirFirst.reason.summary, /對方第 1 選/);
assert.equal(theirFirst.reason.summary.includes("【我方推薦 Top 3】"), false);

const scales = selectableHeroes(catalog).find((hero) => hero.nameZh === "天秤之主");
assert.ok(scales);
const answerTwo = guidedDraft(catalog, roster, {
  userFirst: false,
  rule: "resist",
  userPicks: [],
  enemyPicks: [scales.id],
}, { trials: 1, rank: "champion" });
assert.equal(answerTwo.ok, true, answerTwo.reason?.summary);
assert.equal(answerTwo.reason.summary.includes("【對手新角色檔案】"), false);
assert.equal(answerTwo.reason.summary.includes("一技："), false);
assert.equal(answerTwo.reason.summary.includes("頁上S"), false);
assert.match(answerTwo.reason.summary, /天秤之主/);
assert.match(answerTwo.reason.summary, /【我方推薦 Top 3】/);
assert.notEqual(answerTwo.action.title, "這一手沒有可選的人");
assert.ok(answerTwo.action.ids.length > 0);
assert.match(answerTwo.reason.summary, /控場與減益的成功率下降/);
assert.equal(answerTwo.action.ids.includes(scales.id), false);
assert.equal(answerTwo.reason.summary.includes("【BAN 建議】"), false);
assert.equal(answerTwo.reason.summary.includes("【戰鬥建議】"), false);

const heroIds = catalog.heroes.map((hero) => hero.id);
const lastBan = guidedDraft(catalog, roster, {
  userFirst: true,
  rule: "none",
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
const beforeArtifacts = (summary) => {
  const at = summary.indexOf("【配裝與專武分支】");
  return at < 0 ? summary : summary.slice(0, at);
};
assert.equal(beforeArtifacts(brief.reason.summary).includes("使用率"), false);
assert.match(brief.reason.summary, /【配裝與專武分支】/);
assert.match(brief.reason.summary, /【戰鬥建議】/);
assert.equal(brief.reason.summary.includes("【BAN 建議】"), false);
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
  rule: "attack",
  userPicks: ["estelle"],
  enemyPicks: ["notos", "mercedes"],
}, { trials: 1, rank: "champion" });
assert.equal(notosPick.ok, true, notosPick.reason?.summary);
assert.equal(notosPick.action.kind, "pick");
assert.equal(notosPick.action.need, 2);
assert.ok(notosPick.action.ids.length > 0);
assert.ok(Array.isArray(notosPick.action.plans) && notosPick.action.plans.length > 1);
assert.match(notosPick.reason.summary, /諾托斯/);
assert.match(notosPick.reason.summary, /計數器|反制|協同|速度|建造|配對/);
assert.match(notosPick.reason.summary, /已選/);
assert.match(notosPick.reason.summary, /目前對手/);
assert.match(notosPick.reason.summary, /保護位|關鍵位/);
assert.equal(notosPick.action.ids.includes("estelle"), false);
assert.equal(notosPick.action.ids.includes("notos"), false);
assert.equal(notosPick.reason.summary.includes("無視所有"), false);

const damagePick = guidedDraft(catalog, roster, {
  userFirst: true,
  rule: "attack",
  userPicks: ["estelle"],
  enemyPicks: ["mercedes", "ras"],
}, { trials: 1, rank: "champion" });
const buffPick = guidedDraft(catalog, roster, {
  userFirst: true,
  rule: "attack",
  userPicks: ["estelle"],
  enemyPicks: ["diene", "elena"],
}, { trials: 1, rank: "champion" });
assert.equal(damagePick.ok, true, damagePick.reason?.summary);
assert.equal(buffPick.ok, true, buffPick.reason?.summary);
assert.equal(/一上場就會燒魂/.test(damagePick.action.forecast), false);
assert.equal(/一上場就會燒魂/.test(buffPick.action.forecast), false);
assert.notEqual(damagePick.action.forecast, buffPick.action.forecast);
assert.equal(damagePick.action.forecast.includes("強力克制"), false);
assert.equal(buffPick.action.forecast.includes("強力克制"), false);
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
assert.equal(beforeArtifacts(ranger.reason.summary).includes("使用率"), false);
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
assert.equal(ruled.reason.lines[0], "【局面確認】");
assert.match(ruled.reason.summary, /靈魂燃燒技能的傷害量增加 15%/);
assert.match(ruled.reason.summary, /燒魂傷害提高/);
const plain = battleBrief(catalog, roster, {
  userFirst: true,
  rule: "none",
  userFight: heroIds.slice(0, 4),
  enemyFight: heroIds.slice(4, 8),
});
assert.equal(plain.reason.lines[0], "【局面確認】");
assert.match(plain.reason.summary, /無規則：沒有額外效果/);
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
assert.equal(beforeArtifacts(aubeFight.reason.summary).includes("使用率"), false);
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
assert.equal(booked.log.join("\n").includes("預設魂書"), false);
assert.equal(booked.log.join("\n").includes("開場 20 魂"), false);
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
    rule: "attack",
    userPicks: [],
    enemyPicks: [],
  };
  const reasons = [];
  for (let guard = 0; state.userPicks.length < 5 && guard < 20; guard += 1) {
    const result = guidedDraft(catalog, roster, state, { rank: "champion", trials: 1 });
    if (result.action.kind === "pick") {
      const take = result.action.need || 1;
      for (const id of result.action.ids.slice(0, take)) {
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

const darkClaws = battleBrief(catalog, roster, {
  userFirst: true,
  rule: "none",
  userFight: ["shepherd-of-the-dark-diene", "sylvan-sage-vivian", "eye-of-the-abyss-fumyr", "lisette"],
  enemyFight: ["school-nurse-yulha", "estelle", "briar-witch-iseria", "ivana"],
});
assert.equal(darkClaws.ok, true, darkClaws.reason?.summary);
assert.match(darkClaws.action.title, /^我方黑暗牧者迪埃妮先打/);
assert.equal(darkClaws.action.title.includes("開一技給"), false);
assert.equal(darkClaws.action.title.includes("給森之賢者薇薇安"), false);
const darkKill = darkClaws.reason.lines.find((row) => row.startsWith("先殺誰："));
const darkHit = darkClaws.reason.lines.find((row) => row.startsWith("打到誰："));
assert.match(darkKill, /^先殺誰：先殺/);
assert.equal(darkKill.includes("增益"), false);
assert.equal(darkHit.includes("開給"), false);
assert.match(darkHit, /公開傷害倍率 0\.5/);
assert.match(darkHit, /公開係數 生命 0\.12/);
assert.match(darkHit, /必暴/);
assert.match(darkHit, /強化到最大的傷害增加 30%/);
assert.match(darkHit, /開場自己有不死 1 回合，叫攻擊最高的森之賢者薇薇安夾攻/);
assert.match(darkClaws.reason.summary, /技能組合：黑暗牧者迪埃妮一技打對方/);
assert.equal(darkClaws.reason.summary.includes("一技給隊友"), false);
assert.equal(darkClaws.reason.summary.includes("這是增益，先幫我方輸出"), false);

assert.equal(heroCode("Rhianna and Luciella"), "rhianna-and-luciella");
const thin = parseRoster({
  heroes: [
    { name: "Arbiter Vildred", atk: 4000, hp: 12000, def: 1000, cr: 100, cd: 280, eff: 20, res: 0, dac: 5, spd: 250 },
    { name: "Estelle", atk: 0, hp: 0, def: 0, cr: 0, cd: 0, eff: 0, res: 0, dac: 0, spd: 0 },
    { name: "Not A Real Person" },
  ],
}, catalog);
assert.equal(thin.unknown.join("、"), "Not A Real Person");
assert.equal(thin.heroes.find((hero) => hero.id === "estelle").geared, false);
assert.equal(rosterReadLine(thin), "已讀取 3 隻角色，其中 1 隻有配裝，0 隻有完整神器與專武資料。請告訴我規則與先後手。");
const thinPick = guidedDraft(catalog, thin, {
  userFirst: true,
  rule: "special",
  userPicks: ["arbiter-vildred"],
  enemyPicks: ["school-nurse-yulha"],
});
assert.equal(thinPick.action.ids.includes("estelle"), false);
assert.match(thinPick.reason.summary, /迴避變低/);
assert.match(thinPick.reason.summary, /Not A Real Person/);
assert.equal(thinPick.reason.summary.includes("檔案沒有神器"), false);
assert.equal(thinPick.reason.summary.includes("不從檔案猜"), false);

const sampleTurn = guidedDraft(catalog, roster, {
  userFirst: true,
  rule: "attack",
  userPicks: ["arbiter-vildred"],
  enemyPicks: ["school-nurse-yulha"],
});
assert.equal(sampleTurn.ok, true, sampleTurn.reason.summary);
assert.match(sampleTurn.reason.summary, /【局面確認】/);
assert.equal(sampleTurn.reason.summary.includes("【對手新角色檔案】"), false);
assert.match(sampleTurn.reason.summary, /【對手陣容判讀】/);
assert.match(sampleTurn.reason.summary, /【我方推薦 Top 3】/);
assert.equal(sampleTurn.reason.summary.includes("【配裝與專武分支】"), false);
assert.equal(sampleTurn.reason.summary.includes("【信心度】"), false);
assert.equal(sampleTurn.reason.summary.includes("【需要我補充】"), false);
assert.equal(sampleTurn.reason.summary.includes("【BAN 建議】"), false);
assert.equal(sampleTurn.reason.summary.includes("【戰鬥建議】"), false);
assert.equal(sampleTurn.reason.summary.includes("一技："), false);
assert.equal(sampleTurn.reason.summary.includes("開場效果："), false);
assert.match(sampleTurn.reason.summary, /保健室老師律荷/);
assert.match(sampleTurn.reason.summary, /組合使用率/);
assert.match(sampleTurn.reason.summary, /這是套裝組合的比例，不是神器使用率/);
assert.equal(/常見神器/.test(sampleTurn.reason.summary), false);
const comboLine = sampleTurn.reason.summary.split("\n").find((row) => row.includes("組合使用率"));
assert.match(comboLine, /組合使用率 \d/);
assert.equal(/神器使用率 \d/.test(comboLine), false);

const noBuild = guidedDraft(catalog, roster, {
  userFirst: true,
  rule: "attack",
  userPicks: ["arbiter-vildred"],
  enemyPicks: ["coli"],
});
assert.equal(noBuild.ok, true, noBuild.reason?.summary);
assert.equal(noBuild.reason.summary.includes("【配裝與專武分支】"), false);
assert.match(noBuild.reason.summary, /缺少可麗的配裝表/);

const scoutTurn = guidedDraft(catalog, roster, {
  userFirst: true,
  rule: "attack",
  userPicks: ["arbiter-vildred"],
  enemyPicks: ["mighty-scout"],
});
assert.match(scoutTurn.reason.summary, /缺少偵查兵瑪伊堤的角色資料卡/);
assert.equal(scoutTurn.reason.summary.includes("【信心度】"), false);
assert.equal(scoutTurn.reason.summary.includes("一技："), false);
assert.match(scoutTurn.reason.summary, /資料可能過時，請確認/);

const told = guidedDraft(catalog, roster, {
  userFirst: true,
  rule: "attack",
  userPicks: ["arbiter-vildred"],
  enemyPicks: ["school-nurse-yulha"],
  exclusiveNote: "我的維德瑞有專武",
});
assert.match(told.reason.summary, /你說執行官維德瑞有專武/);
assert.equal(told.reason.summary.includes("專武效果全部"), false);

const filledHero = {
  name: "Arbiter Vildred",
  atk: 4000, hp: 12000, def: 1000, cr: 100, cd: 280, eff: 20, res: 0, dac: 5, spd: 250,
  artifactName: "Alexa's Basket", artifactLevel: 30, imprintNumber: 3, eeNumber: 15,
  artifactAttack: 0, artifactHealth: 0, artifactDefense: 0,
};
const blankHero = { name: "Notos", atk: 3000, hp: 10000, def: 900, cr: 80, cd: 250, eff: 40, res: 0, dac: 0, spd: 200 };
const ungearedHero = { name: "Estelle", atk: 0, hp: 0, def: 0, cr: 0, cd: 0, eff: 0, res: 0, dac: 0, spd: 0, artifactName: "War Horn", eeNumber: 15 };
const mixed = parseRoster({ heroes: [filledHero, blankHero, ungearedHero] }, catalog);
assert.equal(rosterReadLine(mixed), "已讀取 3 隻角色，其中 2 隻有配裝，2 隻有完整神器與專武資料。請告訴我規則與先後手。");
assert.equal(mixed.heroes.find((hero) => hero.id === "arbiter-vildred").eeNumber, 15);
assert.equal(mixed.heroes.find((hero) => hero.id === "notos").gearStatus, "unconfirmed");
const mixedTurn = guidedDraft(catalog, mixed, {
  userFirst: true,
  rule: "attack",
  userPicks: [],
  enemyPicks: [],
});
assert.match(mixedTurn.reason.summary, /執行官維德瑞[\s\S]*效果不確定/);
assert.match(mixedTurn.reason.summary, /執行官維德瑞[\s\S]*專武 已裝備（已確認），數值 15/);
assert.match(mixedTurn.reason.summary, /執行官維德瑞[\s\S]*烙印 3（已確認）/);
assert.match(mixedTurn.reason.summary, /諾托斯[\s\S]*專武 已裝備（預設，未確認）/);
assert.match(mixedTurn.reason.summary, /諾托斯[\s\S]*（預設，未確認）/);
assert.match(mixedTurn.reason.summary, /信心度降一級/);
assert.equal(/諾托斯[\s\S]{0,240}神器使用率 \d/.test(mixedTurn.reason.summary) === false || /這不是套裝組合使用率/.test(mixedTurn.reason.summary), true);
const override = guidedDraft(catalog, mixed, {
  userFirst: true,
  rule: "attack",
  userPicks: [],
  enemyPicks: [],
  exclusiveNote: "諾托斯沒有專武",
});
assert.match(override.reason.summary, /諾托斯[\s\S]*專武 沒有（已確認，你另外講的）/);
const schuriGear = {
  name: "Schuri",
  atk: 3000, hp: 9000, def: 800, cr: 100, cd: 250, eff: 0, res: 0, dac: 0, spd: 260,
};
const schuriRoster = parseRoster({ heroes: [schuriGear, filledHero] }, catalog);
const schuriTurn = guidedDraft(catalog, schuriRoster, {
  userFirst: true,
  rule: "attack",
  userPicks: ["arbiter-vildred"],
  enemyPicks: ["harsetti"],
});
assert.match(schuriTurn.reason.summary, /修里對上赫爾賽蒂是被強力克制，對戰分數 -4\.86/);
assert.match(schuriTurn.reason.summary, /協同效果普通，協同分數 \+0\.00/);
const schuriPage = guidedDraft(catalog, schuriRoster, {
  userFirst: true,
  rule: "attack",
  userPicks: ["arbiter-vildred"],
  enemyPicks: ["schuri"],
});
assert.match(schuriPage.reason.summary, /香袋伊妲涅斯/);
assert.match(schuriPage.reason.summary, /組合使用率 70%/);
assert.match(schuriPage.reason.summary, /這是套裝組合的比例，不是神器使用率/);
assert.match(schuriPage.reason.summary, /射手/);
assert.match(schuriPage.reason.summary, /頁上沒有陣行使用率，不編陣行/);
assert.match(schuriPage.reason.summary, /我方用 JSON 的實際練度/);
assert.equal(schuriPage.reason.summary.includes("敵人死亡時"), false);
assert.equal(schuriPage.reason.summary.includes("頁上S"), false);
const ariaTurn = guidedDraft(catalog, schuriRoster, {
  userFirst: true,
  rule: "attack",
  userPicks: ["arbiter-vildred"],
  enemyPicks: ["disciplinary-prefect-aria"],
});
assert.match(ariaTurn.reason.summary, /風紀委員艾莉雅/);
assert.equal(ariaTurn.reason.summary.includes("貫徹使命"), false);
assert.equal(ariaTurn.reason.summary.includes("權威之證"), false);
assert.equal(ariaTurn.reason.summary.includes("一技："), false);
assert.ok(ariaTurn.action.ids.length > 0);
const geared = (name, speed) => ({ name, atk: 3000, hp: 10000, def: 900, cr: 100, cd: 250, eff: 0, res: 0, dac: 0, spd: speed });
const standIn = guidedDraft(catalog, parseRoster({ heroes: [geared("Arbiter Vildred", 250)] }, catalog), {
  userFirst: true,
  rule: "attack",
  userPicks: ["rhianna-and-luciella"],
  enemyPicks: ["harsetti", "notos"],
});
assert.match(standIn.reason.summary, /替代：沒有黎潔特或沒有他的配裝，執行官維德瑞最相似分數 \+0\.37/);
const keepSynergy = guidedDraft(catalog, parseRoster({ heroes: [geared("Arbiter Vildred", 250), geared("Lisette", 240)] }, catalog), {
  userFirst: true,
  rule: "attack",
  userPicks: ["rhianna-and-luciella"],
  enemyPicks: ["harsetti", "notos"],
});
assert.match(keepSynergy.reason.summary, /協同：和里安娜路西艾拉的協同分數 \+3\.04/);
assert.equal(keepSynergy.reason.summary.includes("替代：沒有黎潔特"), false);
const lisetteAt = keepSynergy.action.ids.indexOf("lisette");
const vildredAt = keepSynergy.action.ids.indexOf("arbiter-vildred");
assert.ok(lisetteAt >= 0 && (vildredAt < 0 || lisetteAt < vildredAt));
const gaps = effectGapItems(catalog, mixed, {});
assert.ok(gaps.some((item) => item.key === "artifact:Alexa's Basket" && item.heroes.includes("執行官維德瑞")));
assert.ok(gaps.some((item) => item.key === "ee:arbiter-vildred"));
assert.equal(gaps.some((item) => item.heroes.includes("諾托斯")), false);
assert.equal(gaps.some((item) => item.heroes.includes("艾絲黛")), false);
const savedEffects = {
  "artifact:Alexa's Basket": { effect: "攻擊時，以 20% 的機率使攻擊力增加。", source: "使用者截圖" },
  "ee:arbiter-vildred": { effect: "戰鬥開始時，獲得護盾。", source: "使用者截圖" },
};
assert.equal(effectGapItems(catalog, mixed, savedEffects).some((item) => item.key === "artifact:Alexa's Basket" || item.key === "ee:arbiter-vildred"), false);
const cited = guidedDraft(catalog, mixed, {
  userFirst: true,
  rule: "attack",
  userPicks: [],
  enemyPicks: [],
  effectNotes: savedEffects,
});
assert.match(cited.reason.summary, /攻擊時，以 20% 的機率使攻擊力增加。來源：使用者截圖/);
assert.match(cited.reason.summary, /戰鬥開始時，獲得護盾。來源：使用者截圖/);
assert.equal(/執行官維德瑞[\s\S]{0,180}效果不確定/.test(cited.reason.summary), false);
for (const id of sampleTurn.action.ids) {
  const own = roster.heroes.find((hero) => hero.id === id);
  assert.equal(own?.geared, true, id);
}

const e7 = JSON.parse(readFileSync(new URL("../data/e7rtabot-rta.json", import.meta.url)));
const overForty = Object.values(e7.英雄).filter((row) => row.選擇率 > 0.4);
assert.equal(overForty.length, 0);
assert.deepEqual(e7.出場率門檻["超過40%"], []);
assert.deepEqual(e7.出場率門檻.缺頁, []);

const preban = guidedDraftRaw(catalog, roster, { userFirst: false, rule: "none" }, { rank: "champion" });
assert.equal(preban.action.kind, "preban");
assert.equal(preban.action.ids.length, 2);
assert.equal(preban.reason.summary.includes("【我方推薦 Top 3】"), false);
assert.equal(preban.reason.summary.includes("一技："), false);
for (const id of preban.action.ids) assert.equal(roster.heroes.find((hero) => hero.id === id)?.geared, true);
const enemyBan = guidedDraftRaw(catalog, roster, {
  userFirst: false,
  rule: "none",
  prebans: preban.action.ids,
  prebansDone: true,
}, { rank: "champion" });
assert.equal(enemyBan.action.kind, "enemy-preban");
assert.match(enemyBan.action.title, /對方預禁的 2 名/);
assert.equal(enemyBan.reason.summary.includes("【我方推薦 Top 3】"), false);
const scalesTurn = guidedDraftRaw(catalog, roster, {
  userFirst: false,
  rule: "none",
  prebans: preban.action.ids,
  prebansDone: true,
  enemyPrebans: ["estelle", "zio"],
  enemyPrebansDone: true,
  enemyPicks: ["lady-of-the-scales"],
}, { rank: "champion" });
assert.equal(scalesTurn.action.kind, "pick");
assert.equal(scalesTurn.action.need, 2);
assert.notEqual(scalesTurn.action.title, "這一手沒有可選的人");
assert.ok(scalesTurn.action.ids.length > 0);
assert.equal(scalesTurn.reason.summary.includes("一技："), false);
assert.equal(scalesTurn.reason.summary.includes("頁上S"), false);
assert.equal(scalesTurn.reason.summary.includes("開場效果"), false);
assert.match(scalesTurn.reason.summary, /【局面確認】/);
assert.match(scalesTurn.reason.summary, /【對手陣容判讀】/);
assert.match(scalesTurn.reason.summary, /【我方推薦 Top 3】/);

function notosHand(names, enemy = "notos", memory) {
  return guidedDraft(catalog, parseRoster({ heroes: names.map((name) => geared(name, 220)) }, catalog), {
    userFirst: false,
    rule: "resist",
    userPicks: [],
    enemyPicks: [enemy],
  }, { memory });
}
const bypass = notosHand(["Apocalypse Ravi", "Sez", "Destina"]);
assert.notEqual(bypass.action.ids[0], "apocalypse-ravi");
assert.equal(bypass.action.ids.includes("apocalypse-ravi"), false);
assert.equal(/1\. 末日蘿菲/.test(bypass.reason.summary), false);
assert.equal(bypass.reason.summary.includes("3.18"), false);
const coolBlank = bypass.action.plans.find((plan) => plan.label === "加冷卻");
const speedPlan = bypass.action.plans.find((plan) => plan.label === "速度");
assert.ok(coolBlank && coolBlank.ids.length === 0 && coolBlank.reason === "");
assert.equal(speedPlan.ids.includes("sez"), true);
assert.match(speedPlan.reason, /速度：諾托斯中位 202/);
assert.match(bypass.action.forecast, /瑟琳/);
assert.match(bypass.action.forecast, /有開戰/);
assert.equal(/一上場就會燒魂/.test(bypass.action.forecast), false);
assert.equal(/黑暗牧者迪埃妮/.test(bypass.action.forecast), false);
assert.equal(bypass.action.forecast.includes("3.18"), false);
assert.equal(bypass.action.forecast.includes("末日蘿菲"), false);
assert.equal(bypass.action.forecast.includes("強力克制"), false);
assert.equal(bypass.action.ids.includes("sez"), true);
assert.equal(bypass.action.ids.includes("apocalypse-ravi"), false);
assert.equal(bypass.action.ids[0], "sez");
assert.match(bypass.action.forecastReason, /速度：諾托斯中位 202/);
assert.equal(bypass.action.plans.some((plan) => plan.label === "解除"), false);
assert.equal(bypass.action.plans.some((plan) => (plan.ids || []).includes("apocalypse-ravi")), false);
const withKawerik = notosHand(["Apocalypse Ravi", "Sez", "Destina", "Kawerik"]);
const coolPlan = withKawerik.action.plans.find((plan) => plan.label === "加冷卻");
assert.equal(coolPlan.ids.includes("kawerik"), true);
assert.match(coolPlan.reason, /資料庫有開戰套，這名能加冷卻/);
assert.equal(coolPlan.reason.includes("3.18"), false);
assert.equal(withKawerik.action.ids.includes("kawerik"), true);
assert.equal(withKawerik.action.ids[0], "kawerik");
assert.match(withKawerik.action.forecastReason, /能加冷卻/);
assert.equal(/一上場就會燒魂/.test(withKawerik.action.forecast), false);
const otherPlan = withKawerik.action.plans.find((plan) => plan.ids.length && plan.label !== "加冷卻");
assert.ok(otherPlan);
assert.equal(otherPlan.ids.includes("kawerik"), false);
assert.equal(otherPlan.ids.includes("apocalypse-ravi"), false);
assert.equal(withKawerik.reason.summary.includes("3.18"), false);
const onlyCool = notosHand(["Kawerik"]);
assert.equal(onlyCool.action.ids.includes("kawerik"), true);
assert.match(onlyCool.action.forecastReason, /能加冷卻/);
assert.equal(onlyCool.action.plans.find((plan) => plan.label === "另一套").ids.length, 0);
assert.equal(onlyCool.action.plans.find((plan) => plan.label === "另一套").reason, "");
const notWarfare = notosHand(["Kawerik", "Apocalypse Ravi"], "sez");
assert.equal(notWarfare.action.plans.some((plan) => plan.label === "加冷卻"), false);
assert.equal(notWarfare.reason.summary.includes("能加冷卻"), false);
const immuneOnly = notosHand(["School Nurse Yulha", "Apocalypse Ravi"]);
assert.equal(immuneOnly.action.plans.find((plan) => plan.label === "加冷卻").ids.includes("school-nurse-yulha"), false);
const remembered = notosHand(["Apocalypse Ravi", "Sez", "Destina"], "notos", {
  matches: [{
    result: "win",
    userPicks: ["apocalypse-ravi", "sez", "destina", "schuri", "arbiter-vildred"],
  }],
});
const winPlan = remembered.action.plans.find((plan) => plan.label === "勝場");
assert.ok(winPlan);
assert.equal(winPlan.ids.includes("apocalypse-ravi"), true);
assert.match(winPlan.reason, /已記住 1 場有這名的勝利/);
assert.equal(winPlan.reason.includes("勝率"), false);
assert.notEqual(remembered.action.ids[0], "apocalypse-ravi");
assert.equal(bypass.reason.summary.includes("勝場："), false);
assert.equal(bypass.reason.summary.includes("勝率"), false);
const opened = notosHand(["Flan", "Eda", "Boss Arunka"], "briar-witch-iseria");
assert.equal(opened.action.ids.includes("flan"), false);
assert.equal(opened.action.ids.includes("eda"), false);
assert.equal(opened.action.ids[0], "boss-arunka");
assert.match(opened.action.forecast, /灰光森林的伊賽麗亞會燒魂/);
assert.match(opened.action.forecast, /黑暗牧者迪埃妮使用暗月，速攻值增加 35%/);
assert.match(opened.action.forecast, /第 4、5 選/);
assert.match(opened.action.forecastReason, /不確定/);
assert.equal(opened.action.forecast.includes("？"), false);
const fastKawerik = guidedDraft(catalog, parseRoster({
  heroes: [geared("Kawerik", 320), geared("Flan", 200), geared("Destina", 180)],
}, catalog), {
  userFirst: false,
  rule: "resist",
  enemyPicks: ["notos"],
});
assert.equal(fastKawerik.action.ids.includes("kawerik"), true);
assert.equal(fastKawerik.action.ids[0], "kawerik");
assert.match(fastKawerik.action.forecastReason, /能加冷卻/);
assert.equal(/一上場就會燒魂/.test(fastKawerik.action.forecast), false);

const namedBriar = notosHand(["Destina"], "astromancer-elena");
assert.match(namedBriar.action.forecast, /灰光森林的伊賽麗亞一上場就會燒魂/);
assert.match(namedBriar.action.forecast, /黑暗牧者迪埃妮使用暗月/);
assert.match(namedBriar.action.forecast, /35%/);
assert.match(namedBriar.action.forecast, /第 4、5 選/);

function rnlBoard(heroes) {
  return guidedDraft(catalog, parseRoster({ heroes }, catalog), {
    userFirst: false,
    rule: "none",
    userPicks: ["boss-arunka", "desert-jewel-basar"],
    enemyPicks: ["rhianna-and-luciella", "arbiter-vildred", "aube"],
    enemyPrebans: ["cidd", "kise"],
  });
}
const rnl = rnlBoard([
  geared("Boss Arunka", 210),
  geared("Desert Jewel Basar", 250),
  geared("Belian", 180),
  geared("Kawerik", 320),
  geared("Sez", 220),
]);
assert.equal(rnl.action.ids.length, 1);
assert.equal(rnl.action.ids[0], "kawerik");
assert.equal(rnl.action.ids.includes("belian"), false);
assert.match(rnl.action.forecast, /後面是/);
assert.match(rnl.action.forecast, /里安娜路西艾拉/);
assert.match(rnl.action.forecastReason, /里安娜路西艾拉/);
assert.match(rnl.action.forecastReason, /執行官維德瑞/);
assert.match(rnl.action.forecastReason, /檔案速度比開場快/);
assert.equal(/協同分數/.test(rnl.action.forecastReason), false);
assert.equal(/灰光|暗迪埃妮|黑暗牧者迪埃妮/.test(rnl.action.forecast), false);
assert.equal(/灰光|暗迪埃妮|黑暗牧者迪埃妮/.test(rnl.action.forecastReason), false);
assert.equal(/伯里安/.test(`${rnl.action.forecast}${rnl.action.forecastReason}`), false);
const slowRnl = rnlBoard([
  geared("Boss Arunka", 210),
  geared("Desert Jewel Basar", 250),
  geared("Belian", 180),
  geared("Sez", 220),
]);
assert.equal(slowRnl.action.ids.includes("belian"), false);
assert.equal(slowRnl.action.ids.length, 0);
assert.match(slowRnl.action.forecastReason, /檔案速度打不過開場/);
assert.match(slowRnl.action.forecastReason, /里安娜路西艾拉/);
assert.match(slowRnl.action.forecastReason, /執行官維德瑞/);
assert.equal(/協同分數/.test(slowRnl.action.forecastReason), false);
assert.equal(/灰光|暗迪埃妮|黑暗牧者迪埃妮/.test(`${slowRnl.action.forecast}${slowRnl.action.forecastReason}`), false);

console.log("screen tests passed", { next: firstMove.action.title, brief: brief.action.title, knights: knights.picks, buffers: buffers.picks });
