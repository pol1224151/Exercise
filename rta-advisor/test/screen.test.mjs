import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adviseFromScreen, parseRoster, sourceBasis } from "../js/engine.js";
import { DEFAULT_REGIONS, liveStateKey, paintFixture, readFrame } from "../js/screen.js";

const catalog = JSON.parse(readFileSync(new URL("../data/catalog.json", import.meta.url)));
const book = JSON.parse(readFileSync(new URL("../data/portrait-signatures.json", import.meta.url)));
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

const ids = catalog.heroes.map((hero) => hero.id);
const draft = paintFixture(960, 540, DEFAULT_REGIONS, book, {
  prebans: [ids[0]],
  user: [ids[3]],
  enemy: [ids[1], ids[2]],
});
const draftRead = readFrame(draft, 960, 540, DEFAULT_REGIONS, book);
assert.equal(draftRead.prebans[0], ids[0]);
assert.equal(draftRead.user[0], ids[3]);
assert.equal(draftRead.enemy[1], ids[2]);
assert.equal(draftRead.user[1], "empty");
assert.equal(draftRead.phase, "pick");

const scaled = paintFixture(960, 540, DEFAULT_REGIONS, book, {
  user: [ids[9]],
  scale: 1.15,
});
const scaledRead = readFrame(scaled, 960, 540, DEFAULT_REGIONS, book);
assert.equal(scaledRead.user[0], ids[9]);

const noise = paintFixture(960, 540, DEFAULT_REGIONS, book, { user: ["noise"] });
const noiseRead = readFrame(noise, 960, 540, DEFAULT_REGIONS, book);
assert.equal(noiseRead.user[0], "unknown");
const blocked = adviseFromScreen(catalog, noiseRead, { trials: 1, roster });
assert.equal(blocked.ok, false);
assert.match(blocked.reason, /建議無效/);
assert.equal(blocked.version.season, catalog.provenance.rtaSeason);

const needsAccount = adviseFromScreen(catalog, draftRead, { trials: 1 });
assert.equal(needsAccount.ok, false);
assert.match(needsAccount.reason, /帳號/);

const advice = adviseFromScreen(catalog, draftRead, { trials: 2, firstPick: true, rank: "champion", roster });
assert.equal(advice.ok, true, advice.reason);
assert.ok(["pick", "wait", "preban", "ban"].includes(advice.action.kind));
assert.match(advice.action.title, /選|預禁|禁|對手/);
assert.ok(advice.rate >= 0 && advice.rate <= 1);
assert.match(JSON.stringify(advice.reason), /不是保證|估計/);
assert.match(advice.version.patchZh, /8\.7/);

const battle = paintFixture(960, 540, DEFAULT_REGIONS, book, {
  user: ids.slice(0, 4),
  enemy: ids.slice(4, 8),
  actor: ids[0],
  skills: ["bright", "bright", "bright"],
});
const battleRead = readFrame(battle, 960, 540, DEFAULT_REGIONS, book);
assert.equal(battleRead.phase, "battle");
assert.equal(battleRead.yourTurn, true);
assert.equal(battleRead.actorId, ids[0]);
const cast = adviseFromScreen(catalog, battleRead, { trials: 2, roster });
assert.equal(cast.ok, true, cast.reason);
assert.equal(cast.action.kind, "skill");
assert.match(cast.action.title, /技能/);
assert.ok(cast.action.burn);
assert.match(cast.action.burn.text, /燒魂/);

const flickering = { ...battleRead, skillsReady: [false, true, false] };
assert.equal(liveStateKey(battleRead), liveStateKey(flickering));
assert.notEqual(liveStateKey(battleRead), liveStateKey({ ...battleRead, actorId: ids[1] }));
assert.notEqual(liveStateKey(battleRead), liveStateKey({ ...battleRead, user: [ids[1], ...battleRead.user.slice(1)] }));

console.log("screen tests passed", { next: advice.action.title, skill: cast.action.title, burn: cast.action.burn.yes });
