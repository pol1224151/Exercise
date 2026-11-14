import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adviceStateKey, adviseFromScreen, detectFirstPick, parseRoster, sourceBasis } from "../js/engine.js";
import { DEFAULT_REGIONS, bindRememberedCards, findDraftCards, inferPhase, liveStateKey, matchCardMemory, matchHeroName, matchPortrait, paintFixture, readDraft, readFrame, rememberCard, rememberCorrection, slotFrame } from "../js/screen.js";

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
assert.equal(blocked.action.title, "點這張卡選英雄");
assert.match(blocked.reason.summary, /不會猜一個接近的人/);
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

const turnOnly = adviseFromScreen(catalog, {
  user: ["empty"],
  enemy: ["empty"],
  prebans: [],
  actorId: "empty",
  phase: "preban",
  turnSide: "user",
  skillsReady: [],
}, { trials: 1, rank: "champion", roster });
assert.equal(turnOnly.ok, false);
assert.equal(turnOnly.action.title, "還看不出先後手");
assert.match(turnOnly.reason.summary, /不給禁選/);

const opening = adviseFromScreen(catalog, {
  user: ["empty"],
  enemy: ["empty"],
  prebans: [],
  actorId: "empty",
  phase: "preban",
  leadSide: "user",
  skillsReady: [],
}, { trials: 1, rank: "champion", roster });
assert.equal(opening.ok, true, opening.reason?.summary);
assert.equal(opening.firstPick, true);
assert.match(opening.action.title, /預禁/);

assert.deepEqual(detectFirstPick(1, 2, null, null), { firstPick: true, source: "counts" });
assert.deepEqual(detectFirstPick(0, 1, null, null), { firstPick: false, source: "counts" });
assert.equal(detectFirstPick(0, 0, null, "enemy").firstPick, false);
assert.equal(detectFirstPick(0, 0, "user", null).firstPick, null);
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
assert.equal(readFrame(fitted, 960, 540, DEFAULT_REGIONS, book).user[0], "unknown");
const wide = paintFixture(1920, 1080, DEFAULT_REGIONS, book, { user: [ids[8]], fit: 0.18 });
assert.equal(readFrame(wide, 1920, 1080, DEFAULT_REGIONS, book).user[0], "unknown");
assert.equal(matchPortrait(book.portraits[0].rgb.map((value) => Math.round(value * 0.72)), book), book.portraits[0].id);
const mixed = book.portraits[0].rgb.map((value, index) => Math.round((value + book.portraits[8].rgb[index]) / 2));
assert.equal(matchPortrait(mixed, book), "unknown");

const saved = rememberCorrection([], framedRead.faces[0].rgb, ids[6]);
const corrected = readFrame(framed, 960, 540, DEFAULT_REGIONS, book, saved);
assert.equal(corrected.user[0], ids[6]);
const again = rememberCorrection(JSON.parse(JSON.stringify(saved)), corrected.faces[0].rgb, ids[6]);
assert.equal(again.length, 1);
assert.equal(again[0].id, ids[6]);

const ours = slotFrame(DEFAULT_REGIONS.user, 0);
const oursNext = slotFrame(DEFAULT_REGIONS.user, 1);
assert.ok(ours.y > 0.65 && ours.x > 0.25 && ours.x < 0.4, "our portraits sit in the lower middle");
assert.ok(oursNext.x > ours.x, "a row of portraits runs across the frame");
assert.ok(slotFrame(DEFAULT_REGIONS.enemy, 0).x >= ours.x + DEFAULT_REGIONS.user.w - 0.001);
assert.ok(slotFrame(DEFAULT_REGIONS.preban, 0).y > ours.y);
assert.ok(slotFrame(DEFAULT_REGIONS.actor, 0).y > 0.65);
assert.ok(slotFrame(DEFAULT_REGIONS.skills, 0).x > 0.4);
for (const region of Object.values(DEFAULT_REGIONS)) {
  assert.equal(region.axis, "row");
  const last = slotFrame(region, region.slots - 1);
  assert.ok(last.x + last.w < 0.86, "boxes stay off the side menu");
  assert.ok(last.y > 0.5, "boxes stay off the timer");
}
const narrow = slotFrame(DEFAULT_REGIONS.user, 2);
const wideBox = {
  x: Math.round(narrow.x * 1920) / 1920,
  y: Math.round(narrow.y * 1080) / 1080,
};
assert.ok(Math.abs(wideBox.x - narrow.x) < 0.002 && Math.abs(wideBox.y - narrow.y) < 0.002);

function paintLevelLabel(data, width, height, cx, cy) {
  const th = Math.max(10, Math.round(height * 0.02));
  const gw = Math.max(4, Math.round(th * 0.7));
  const gap = Math.max(2, Math.round(th * 0.25));
  let x = Math.round(cx - (4 * gw + 3 * gap) / 2);
  const y = Math.round(cy - th / 2);
  for (let letter = 0; letter < 4; letter += 1) {
    for (let yy = y; yy < y + th; yy += 1) {
      for (let xx = x; xx < x + gw; xx += 1) {
        const offset = (yy * width + xx) * 4;
        data[offset] = 230;
        data[offset + 1] = 150;
        data[offset + 2] = 40;
        data[offset + 3] = 255;
      }
    }
    x += gw + gap;
  }
}

const draftWidth = 960;
const draftHeight = 540;
const draftFrame = new Uint8ClampedArray(draftWidth * draftHeight * 4);
for (let index = 0; index < draftFrame.length; index += 4) draftFrame[index + 3] = 255;
paintLevelLabel(draftFrame, draftWidth, draftHeight, Math.round(draftWidth * 0.28), Math.round(draftHeight * 0.32));
paintLevelLabel(draftFrame, draftWidth, draftHeight, Math.round(draftWidth * 0.28), Math.round(draftHeight * 0.48));
paintLevelLabel(draftFrame, draftWidth, draftHeight, Math.round(draftWidth * 0.64), Math.round(draftHeight * 0.32));
paintLevelLabel(draftFrame, draftWidth, draftHeight, Math.round(draftWidth * 0.9), Math.round(draftHeight * 0.4));
for (let index = 0; index < 6; index += 1) {
  const cx = Math.round(draftWidth * (0.32 + index * 0.06));
  const cy = Math.round(draftHeight * 0.88);
  for (let y = cy - 7; y < cy + 7; y += 1) {
    for (let x = cx - 7; x < cx + 7; x += 1) {
      const offset = (y * draftWidth + x) * 4;
      draftFrame[offset] = 220;
      draftFrame[offset + 1] = 150;
      draftFrame[offset + 2] = 40;
    }
  }
}
const draftCards = findDraftCards(draftFrame, draftWidth, draftHeight);
assert.equal(draftCards.filter((card) => card.side === "user").length, 2);
assert.equal(draftCards.filter((card) => card.side === "enemy").length, 1);
assert.ok(draftCards.every((card) => card.y < 0.7), "recommendation and preban circles are not picks");
assert.ok(draftCards.every((card) => card.x < 0.8), "the hero list on the far right is not a pick");

function paintBlock(x, y, bw, bh, color) {
  for (let yy = y; yy < y + bh; yy += 1) {
    for (let xx = x; xx < x + bw; xx += 1) {
      const offset = (yy * draftWidth + xx) * 4;
      draftFrame[offset] = color[0];
      draftFrame[offset + 1] = color[1];
      draftFrame[offset + 2] = color[2];
    }
  }
}
paintBlock(150, 140, 70, 50, [180, 90, 40]);
paintBlock(150, 230, 70, 50, [40, 90, 180]);
paintBlock(640, 140, 70, 50, [40, 160, 80]);

for (let y = 24; y < 64; y += 1) {
  for (let x = 380; x < 560; x += 1) {
    const offset = (y * draftWidth + x) * 4;
    draftFrame[offset] = 40;
    draftFrame[offset + 1] = 130;
    draftFrame[offset + 2] = 220;
  }
}
const namedDraft = readDraft(draftFrame, draftWidth, draftHeight);
assert.equal(namedDraft.prebans.length, 0);
assert.equal(namedDraft.turnSide, "user");
assert.equal(namedDraft.user.length, 2);
assert.ok(namedDraft.user.every((id) => id === "unknown"));
assert.equal(namedDraft.phase, "pick");

const hero = catalog.heroes.find((row) => row.nameZh.length >= 2 && catalog.heroes.filter((other) => other.nameZh.includes(row.nameZh) || row.nameZh.includes(other.nameZh)).length === 1);
assert.ok(hero);
assert.equal(matchHeroName(`Lv.60 ${hero.nameZh}`, catalog.heroes), hero.id);
assert.equal(matchHeroName(hero.name, catalog.heroes), hero.id);
assert.equal(matchHeroName("Lv.60", catalog.heroes), null);
assert.equal(matchHeroName("推薦英雄", catalog.heroes), null);
assert.equal(matchHeroName(hero.nameZh.slice(0, 1), catalog.heroes), null);

const unread = readDraft(draftFrame, draftWidth, draftHeight, [], [{ sig: namedDraft.cards[0].signature, id: "", text: "柳潔特" }]);
assert.equal(unread.cards[0].text, "柳潔特");
assert.equal(unread.user[0], "unknown");

const remembered = rememberCard([], namedDraft.cards[0].signature, hero.id, {
  text: "柳潔特",
  side: namedDraft.cards[0].side,
  x: namedDraft.cards[0].x,
  y: namedDraft.cards[0].y,
  w: namedDraft.cards[0].w,
  h: namedDraft.cards[0].h,
});
const withMemory = readDraft(draftFrame, draftWidth, draftHeight, remembered);
assert.equal(withMemory.user[0], hero.id);
assert.equal(withMemory.cards[0].text, "柳潔特");
assert.equal(matchCardMemory(namedDraft.cards[1].signature, remembered), null);

const drifted = {
  ...namedDraft.cards[0],
  id: "unknown",
  text: "",
  signature: namedDraft.cards[0].signature.map((value) => Math.min(255, value + 20)),
};
const other = { ...namedDraft.cards[1], id: "unknown", text: "" };
const bound = bindRememberedCards([drifted, other], remembered);
assert.equal(bound[0].id, hero.id);
assert.equal(bound[0].text, "柳潔特");
assert.notEqual(bound[1].id, hero.id);

const still = { user: ["a"], enemy: ["b"], prebans: [], actorId: "empty", turnSide: "user", leadSide: null };
const flippedTurn = { ...still, turnSide: "enemy" };
assert.equal(adviceStateKey(still), adviceStateKey(flippedTurn));
assert.notEqual(adviceStateKey(still), adviceStateKey({ ...still, user: ["a", "c"] }));
assert.notEqual(adviceStateKey({ user: [], enemy: [], leadSide: null }), adviceStateKey({ user: [], enemy: [], leadSide: "user" }));

console.log("screen tests passed", { next: advice.action.title, skill: cast.action.title, burn: cast.action.burn.yes });
