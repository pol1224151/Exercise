import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { advise, buildGearReport, clearAccount, elementRelation, fightFromRoster, loadAccount, parseRoster, saveAccount, skillDamage } from "../js/engine.js";

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
assert.equal(loadAccount(storage).heroes[0].name, "Harsetti");
clearAccount(storage);
assert.equal(loadAccount(storage), null);

console.log("engine tests passed", { rate: result.best.rate, first: fight.firstActor });
