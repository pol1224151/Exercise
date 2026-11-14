import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { advise, adviseFromScreen, buildGearReport, clearAccount, draftPlans, elementRelation, fightFromRoster, heroKit, heroListed, loadAccount, matchesPicker, parseRoster, readAccountText, saveAccount, selectableHeroes, skillDamage, unclearSkills } from "../js/engine.js";
import { chooseComposition, draftType } from "../js/records.js";

const catalog = JSON.parse(readFileSync(new URL("../data/catalog.json", import.meta.url)));
const sample = JSON.parse(readFileSync(new URL("../data/sample-roster.json", import.meta.url)));
const exported = JSON.parse(readFileSync(new URL("../data/example-fribbels-export.json", import.meta.url)));

assert.equal(elementRelation("fire", "wind"), "advantage");
assert.equal(elementRelation("fire", "ice"), "disadvantage");
assert.equal(elementRelation("light", "dark"), "advantage");
assert.equal(elementRelation("dark", "light"), "advantage");
assert.equal(elementRelation("fire", "light"), "neutral");

const harsetti = catalog.heroes.find((h) => h.id === "harsetti");
const s1 = harsetti.skills.S1;
const damage = skillDamage(
  { atk: 2000, hp: 20000, def: 1000, spd: 120, sets: [], cd: 200 },
  { def: 1500, debuffs: [] },
  { ...s1, enhanceDamagePctApplied: 0 },
  1,
);
const scaling = 2000 * 0.6 + 20000 * 0.08;
const expected = (scaling * 1.871 * 1) / (1500 / 300 + 1);
assert.ok(Math.abs(damage - expected) < 0.01, `${damage} vs ${expected}`);

const roster = parseRoster(sample, catalog);
assert.equal(roster.heroes.length, 16);
assert.match(sample.warning, /不是你的帳號/);
assert.ok(roster.heroes.every((h) => h.sample));

const imported = parseRoster(exported, catalog);
const importedHarsetti = imported.heroes.find((h) => h.id === "harsetti");
assert.ok(importedHarsetti.sets.includes("Speed"));
assert.ok(importedHarsetti.sets.includes("Hit"));
assert.equal(importedHarsetti.artifactLimitBreak, 5);
assert.equal(imported.unknown.length, 0);

const result = advise(catalog, roster, { trials: 2, assumeMaxEnhance: false, rank: "champion", firstPick: true });
assert.equal(result.ok, true);
assert.equal(result.best.draft.userFight.length, 4);
assert.equal(result.best.draft.enemyFight.length, 4);
assert.equal(result.best.draft.picked.user.length, 5);
assert.notEqual(result.best.draft.enemyBan, result.best.draft.picked.user[2]);
assert.notEqual(result.best.draft.userBan, result.best.draft.picked.enemy[2]);
assert.ok(result.best.rate >= 0 && result.best.rate <= 1);
assert.match(result.best.reason.lines.join(" "), /不是保證|估計/);

const draft = result.best.draft;
const fight = fightFromRoster(draft, roster, catalog, result.best.plan, "base", () => 0.1);
assert.ok(["user", "enemy", "draw"].includes(fight.winner));
assert.ok(fight.log.length > 0);
if (draft.userFight.includes("harsetti") || draft.enemyFight.includes("harsetti")) {
  assert.ok(fight.log.some((line) => line.includes("赫爾賽蒂") || fight.firstActor));
}

const partial = parseRoster({ heroes: roster.heroes.slice(0, 3) }, catalog);
const blocked = advise(catalog, partial, { trials: 1 });
assert.equal(blocked.ok, false);

const sampleLisette = buildGearReport(
  roster.heroes.find((hero) => hero.id === "lisette"),
  catalog.heroes.find((hero) => hero.id === "lisette"),
  catalog,
  roster,
);
assert.equal(sampleLisette.foreign, true);
assert.match(sampleLisette.changes.join(" "), /不是你的/);
assert.doesNotMatch(sampleLisette.changes.join(" "), /你穿上的/);

const lisette = buildGearReport(
  imported.heroes.find((hero) => hero.id === "lisette"),
  catalog.heroes.find((hero) => hero.id === "lisette"),
  catalog,
  imported,
);
assert.match(lisette.changes.join(" "), /你穿上的是 210/);
assert.match(lisette.changes.join(" "), /不是你的/);
assert.doesNotMatch(lisette.changes.join(" "), /你穿上的是 206/);
const harsettiReport = buildGearReport(importedHarsetti, harsetti, catalog, imported);
assert.match(harsettiReport.changes.join(" "), /到不了/);
assert.match(harsettiReport.changes.join(" "), /不會寫成你的速度|不會把它當成你的面板/);

const zio = catalog.heroes.find((hero) => hero.id === "zio");
const slow = parseRoster({
  heroes: [{ name: "Zio", spd: 180, atk: 1000, hp: 8000, def: 800, cr: 100, cd: 200, eff: 20, res: 0, artifactName: "Bloody Rose" }],
  items: ["Weapon", "Helmet", "Armor", "Necklace", "Ring", "Boots"].map((gear) => ({
    gear,
    set: "HitSet",
    main: gear === "Boots" ? { type: "Speed", value: 45 } : { type: "Health", value: 100 },
    substats: [{ type: "Speed", value: 4 }],
  })),
}, catalog);
const slowReport = buildGearReport(slow.heroes[0], zio, catalog, slow);
assert.equal(slowReport.suggestedArtifact, "Bloody Rose");
assert.match(slowReport.changes.join(" "), /到不了/);
assert.match(slowReport.changes.join(" "), /沒有這件/);

const fast = parseRoster({
  heroes: [{ name: "Zio", spd: 180, atk: 1000, hp: 8000, def: 800, cr: 100, cd: 200, eff: 20, res: 0, artifactName: "Bloody Rose" }],
  artifacts: ["Tagehel's Ancient Book"],
  items: ["Weapon", "Helmet", "Armor", "Necklace", "Ring", "Boots"].map((gear) => ({
    gear,
    set: "SpeedSet",
    main: gear === "Boots" ? { type: "Speed", value: 45 } : { type: "Attack", value: 100 },
    substats: [{ type: "Speed", value: 30 }],
  })),
}, catalog);
const fastReport = buildGearReport(fast.heroes[0], zio, catalog, fast);
assert.equal(fastReport.suggestedArtifact, "Tagehel's Ancient Book");
assert.match(fastReport.changes.join(" "), /可以換上/);
assert.match(fastReport.changes.join(" "), /達得到/);
assert.match(fastReport.changes.join(" "), /沙盤仍用你穿上的 180/);

const memory = new Map();
const storage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key),
};
saveAccount(storage, exported);
const gearTxt = readAccountText(JSON.stringify({ heroes: [{ name: "Zio", spd: 200, atk: 1000, hp: 8000, def: 800 }], items: [] }));
assert.equal(gearTxt.heroes[0].name, "Zio");
assert.throws(() => readAccountText(JSON.stringify({ items: [{ gear: "Weapon", set: "SpeedSet" }] })), /沒有英雄/);
assert.throws(() => readAccountText("Weapon,85,Speed"), /gear\.txt/);
assert.equal(loadAccount(storage).heroes[0].name, "Harsetti");
clearAccount(storage);
assert.equal(loadAccount(storage), null);

assert.ok(result.considered.length > 1);
const sandboxKey = draftType(result.best.draft.userFight, result.best.draft.enemyFight, true).key;
const avoided = chooseComposition(result.considered, {
  matches: [{ type: sandboxKey, result: "loss" }, { type: sandboxKey, result: "loss" }],
}, 0.4, true);
assert.equal(avoided.switched, true);
assert.notEqual(avoided.key, sandboxKey);
assert.ok(avoided.line.rate <= result.best.rate);

const season = JSON.parse(readFileSync(new URL("../data/season-heroes.json", import.meta.url)));
const withSeason = { ...catalog, seasonHeroes: season.heroes };
assert.equal(season.heroes.length > 16, true);
assert.ok(season.heroes.every((hero) => hero.nameZh && hero.rtaPresence && typeof hero.listed === "boolean"));
assert.equal(season.heroes.filter((hero) => !hero.listed).length, 0);
const plans = draftPlans(withSeason, roster);
assert.ok(plans.first.length >= 2 && plans.second.length >= 2);
assert.equal(plans.first[0].picks.length, 5);
assert.equal(plans.first[0].prebans.length, 2);
assert.equal(plans.second[0].prebans.length, 2);
assert.notEqual(plans.first[0].id, plans.second[0].id);
assert.match(plans.first[0].why, /沙盤/);
assert.doesNotMatch(plans.first[0].why, /場次最多/);
assert.doesNotMatch(plans.second[0].why, /場次最多/);
const comps = JSON.parse(readFileSync(new URL("../data/season-comps.json", import.meta.url)));
const withComps = { ...withSeason, seasonComps: comps };
const more = draftPlans(withComps, roster);
assert.equal(more.first.length, 2);
assert.equal(more.second.length, 2);
for (const plan of [...more.first, ...more.second]) {
  assert.equal(plan.picks.length, 5);
  assert.equal(plan.prebans.length, 2);
  assert.ok(plan.picks.every((id) => roster.heroes.some((hero) => hero.id === id)));
  assert.match(plan.why, /沙盤/);
  assert.doesNotMatch(plan.why, /場次最多/);
}
const names = selectableHeroes(catalog);
assert.ok(names.some((hero) => hero.nameZh === "天秤之主"));
assert.ok(names.some((hero) => hero.nameZh === "一輪孤月維爾蘿娜"));
assert.equal(names.find((hero) => hero.id === "aubade-ludwig").aliases.includes("黎明序曲魯特比"), true);
assert.equal(names.some((hero) => hero.id === "ludwig"), false);
const unlistedCatalog = {
  ...catalog,
  seasonHeroes: [{ id: "ghost", code: "c0000", name: "Ghost", nameZh: "測試未收錄", listed: false, rtaPresence: { wins: 1, losses: 1, prebans: 3, games: 2 } }],
};
assert.equal(heroListed(unlistedCatalog.seasonHeroes[0]), false);
const unlisted = adviseFromScreen(unlistedCatalog, {
  user: ["ghost"],
  enemy: [],
  prebans: [],
  phase: "pick",
  leadSide: "user",
}, { trials: 1, roster });
assert.equal(unlisted.ok, false);
assert.equal(unlisted.action.title, "這個英雄未收錄");
assert.match(unlisted.reason.summary, /沒有技能倍率/);

const peira = heroKit(catalog, "lone-wolf-peira");
assert.match(peira, /閃避增加 35%/);
assert.match(peira, /攻擊增加 20%/);
assert.match(peira, /最多 5 層/);
assert.match(peira, /全體隊友戰鬥準備度 \+10%/);
assert.match(peira, /解除全體隊友 2 個弱化/);
assert.match(peira, /再行動一次/);
assert.match(peira, /沒有公開的開戰配裝/);
assert.equal(peira.includes("沒有另編數字"), false);
assert.equal(/大招：冷卻 8 回合，沒有傷害倍率，持續 3 回合/.test(peira), false);

const armin = heroKit(catalog, "armin");
assert.match(armin, /35%/);
assert.match(armin, /防禦架勢/);
assert.match(armin, /30% 反擊/);
assert.match(armin, /傷害減少 30%/);
assert.match(armin, /防禦力增加 60%/);
assert.match(armin, /這是被動，沒有攻擊倍率/);
assert.equal(armin.includes("缺倍率"), false);

const elena = heroKit(catalog, "astromancer-elena");
assert.match(elena, /星之庇護/);
assert.match(elena, /15%/);
assert.match(elena, /速度增加 20%/);
assert.match(elena, /無法恢復/);
assert.match(elena, /束縛/);
assert.match(elena, /這是被動，沒有攻擊倍率/);
assert.equal(elena.includes("缺倍率"), false);

const badCat = heroKit(catalog, "bad-cat-armin");
assert.match(badCat, /巨盾/);
assert.match(badCat, /45%/);
assert.match(badCat, /50%/);
assert.match(badCat, /暴擊傷害增加 70%/);
assert.match(badCat, /2 倍/);
assert.match(badCat, /防禦力增加 60%/);
assert.match(badCat, /燒魂 10/);
assert.match(badCat, /畫面沒有印防護罩吸收比例，不另編/);
assert.match(badCat, /這是被動，沒有攻擊倍率/);
assert.equal(badCat.includes("缺倍率"), false);

const ainz = heroKit(catalog, "ainz-ooal-gown");
assert.match(ainz, /雷霆審判/);
assert.match(ainz, /25%/);
assert.match(ainz, /燒魂 20：產生追加回合/);
assert.match(ainz, /死亡支配者/);
assert.match(ainz, /光明屬性敵人造成的傷害量增加 30%/);
assert.match(ainz, /魔力屏障/);
assert.match(ainz, /畫面沒有印防護罩係數，不另編/);
assert.match(ainz, /生命終將死亡/);
assert.match(ainz, /70%/);
assert.match(ainz, /50000/);
assert.match(ainz, /第 12 回合/);
assert.match(ainz, /冷卻 4 回合/);
assert.match(ainz, /不受技能冷卻增加與減少的影響/);
assert.match(ainz, /這是被動，沒有攻擊倍率/);
assert.equal(ainz.includes("缺倍率"), false);

const skipped = new Set(["奧樂緹", "夏率", "達拉士", "偵查兵瑪伊堤", "野生安卡拉"]);
const blankNames = unclearSkills(catalog).map((row) => row.name);
for (const name of skipped) assert.equal(blankNames.includes(name), false, name);
assert.equal(blankNames.includes("壞壞貓亞敏"), false);
assert.equal(blankNames.includes("安茲‧烏爾‧恭"), false);

const listed = selectableHeroes(catalog);
const arm = listed.find((hero) => hero.id === "armin");
assert.equal(matchesPicker(arm, {}), true);
assert.equal(arm.rarity, 4);
assert.equal(matchesPicker(arm, { stars: [4], elements: ["wind"], roles: ["knight"] }), true);
assert.equal(matchesPicker(arm, { stars: [5] }), false);
assert.equal(matchesPicker(arm, { elements: ["fire"] }), false);
assert.equal(matchesPicker(arm, { roles: ["mage"] }), false);
assert.equal(listed.filter((hero) => matchesPicker(hero, {})).length, listed.length);

console.log("engine tests passed", { rate: result.best.rate, first: fight.firstActor });
