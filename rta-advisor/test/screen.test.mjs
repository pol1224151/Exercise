import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adviseFromScreen, detectFirstPick, parseRoster, sourceBasis } from "../js/engine.js";
import { DEFAULT_REGIONS, inferPhase, liveStateKey, matchPortrait, paintFixture, readFrame, rememberCorrection } from "../js/screen.js";

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
assert.equal(blocked.action.title, "認不出畫面上的英雄");
assert.match(blocked.reason.summary, /不會把空位猜成/);
assert.equal(blocked.version.season, catalog.provenance.rtaSeason);

const needsAccount = adviseFromScreen(catalog, draftRead, { trials: 1 });
assert.equal(needsAccount.ok, false);
assert.equal(needsAccount.action.title, "先讀入帳號");
assert.match(needsAccount.reason.summary, /還沒有讀入帳號/);

const advice = adviseFromScreen(catalog, draftRead, { trials: 2, rank: "champion", roster });
assert.equal(advice.ok, true, advice.reason?.summary || advice.reason);
assert.equal(advice.firstPick, true);
assert.ok(["pick", "wait", "preban", "ban"].includes(advice.action.kind));
assert.match(advice.action.title, /選|預禁|禁/);
assert.ok(advice.action.title.length > 0);
assert.ok(advice.reason.summary);

const withStrayActor = adviseFromScreen(catalog, { ...draftRead, actorId: "unknown" }, { trials: 2, rank: "champion", roster });
assert.equal(withStrayActor.ok, true, withStrayActor.reason?.summary);
assert.equal(inferPhase({ ...draftRead, actorId: ids[3], skillsReady: [false, false, false] }), "pick");

const second = adviseFromScreen(catalog, {
  user: ["empty"],
  enemy: [ids[1]],
  prebans: [],
  actorId: "empty",
  skillsReady: [false, false, false],
  phase: "pick",
}, { trials: 2, rank: "champion", roster });
assert.equal(second.ok, true, second.reason?.summary);
assert.equal(second.firstPick, false);
assert.match(second.action.title, /選/);

const unseen = adviseFromScreen(catalog, {
  user: [],
  enemy: [],
  prebans: [],
  actorId: "empty",
  phase: "unknown",
  skillsReady: [],
}, { trials: 1, roster });
assert.equal(unseen.ok, false);
assert.equal(unseen.action.title, "畫面上還沒有選角");

const opening = adviseFromScreen(catalog, {
  user: ["empty"],
  enemy: ["empty"],
  prebans: [],
  actorId: "empty",
  phase: "preban",
  turnSide: "user",
  skillsReady: [],
}, { trials: 1, rank: "champion", roster });
assert.equal(opening.ok, true, opening.reason?.summary);
assert.equal(opening.firstPick, true);
assert.match(opening.action.title, /預禁|選/);

assert.deepEqual(detectFirstPick(1, 2, null, null), { firstPick: true, source: "counts" });
assert.deepEqual(detectFirstPick(0, 1, null, null), { firstPick: false, source: "counts" });
assert.equal(detectFirstPick(0, 0, null, "enemy").firstPick, false);
assert.equal(detectFirstPick(0, 0, "user", null).firstPick, true);
assert.equal(detectFirstPick(1, 1, null, null).firstPick, null);

const lead = paintFixture(960, 540, DEFAULT_REGIONS, book, { lead: "user" });
assert.equal(readFrame(lead, 960, 540, DEFAULT_REGIONS, book).leadSide, "user");
const lit = paintFixture(960, 540, DEFAULT_REGIONS, book, { turn: "enemy" });
assert.equal(readFrame(lit, 960, 540, DEFAULT_REGIONS, book).turnSide, "enemy");
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

const dim = paintFixture(960, 540, DEFAULT_REGIONS, book, { user: [ids[4]], scale: 0.72 });
assert.equal(readFrame(dim, 960, 540, DEFAULT_REGIONS, book).user[0], ids[4]);
const framed = paintFixture(960, 540, DEFAULT_REGIONS, book, { user: [ids[5]], border: true });
const framedRead = readFrame(framed, 960, 540, DEFAULT_REGIONS, book);
assert.equal(framedRead.user[0], ids[5], framedRead.user[0]);
assert.equal(framedRead.faces[0].side, "user");
const fitted = paintFixture(960, 540, DEFAULT_REGIONS, book, { user: [ids[7]], fit: 0.22 });
assert.equal(readFrame(fitted, 960, 540, DEFAULT_REGIONS, book).user[0], ids[7]);
const wide = paintFixture(1920, 1080, DEFAULT_REGIONS, book, { user: [ids[8]], fit: 0.18 });
assert.equal(readFrame(wide, 1920, 1080, DEFAULT_REGIONS, book).user[0], ids[8]);
assert.equal(matchPortrait(book.portraits[0].rgb.map((value) => Math.round(value * 0.72)), book), book.portraits[0].id);
const mixed = book.portraits[0].rgb.map((value, index) => Math.round((value + book.portraits[8].rgb[index]) / 2));
assert.equal(matchPortrait(mixed, book), "unknown");

const saved = rememberCorrection([], framedRead.faces[0].rgb, ids[6]);
const corrected = readFrame(framed, 960, 540, DEFAULT_REGIONS, book, saved);
assert.equal(corrected.user[0], ids[6]);
const again = rememberCorrection(JSON.parse(JSON.stringify(saved)), corrected.faces[0].rgb, ids[6]);
assert.equal(again.length, 1);
assert.equal(again[0].id, ids[6]);

console.log("screen tests passed", { next: advice.action.title, skill: cast.action.title, burn: cast.action.burn.yes });
