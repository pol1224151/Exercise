import assert from "node:assert/strict";
import { chooseComposition, draftType, rateForType, recordResult } from "../js/records.js";

const same = ["belian", "harsetti", "lisette", "zio"];
const other = ["estelle", "notos", "school-nurse-yulha", "boss-arunka"];
const type = draftType(same, other, true);
const flipped = draftType([...same].reverse(), [...other].reverse(), true);
assert.equal(type.key, flipped.key);
assert.equal(draftType(same.slice(0, 3), other, true), null);
assert.notEqual(type.key, draftType(same, other, false).key);

let book = { matches: [] };
const first = recordResult(book, type.key, "win");
book = { matches: first.matches };
const second = recordResult(book, type.key, "loss");
book = { matches: second.matches };
const corrected = recordResult(book, type.key, "win", second.id);
book = { matches: corrected.matches };
const otherType = recordResult(book, draftType(same, other, false).key, "loss");
book = { matches: otherType.matches };

const rate = rateForType(book, type.key);
assert.equal(rate.wins, 2);
assert.equal(rate.losses, 0);
assert.equal(rate.total, 2);
assert.equal(rate.rate, 1);
assert.equal(rateForType(book, "missing").rate, null);
assert.equal(rateForType(book, draftType(same, other, false).key).rate, 0);

function line(user, enemy, sandbox) {
  return { draft: { userFight: user, enemyFight: enemy }, rate: sandbox };
}
const weak = line(same, other, 0.8);
const otherComp = line(["belian", "harsetti", "lisette", "notos"], ["estelle", "zio", "school-nurse-yulha", "boss-arunka"], 0.5);
const losses = { matches: [{ type: type.key, result: "loss" }, { type: type.key, result: "loss" }] };
const switched = chooseComposition([weak, otherComp], losses, 0.4, true);
assert.equal(switched.switched, true);
assert.equal(switched.line, otherComp);
assert.equal(switched.line.rate, 0.5);
const held = chooseComposition([weak, otherComp], losses, 0, true);
assert.equal(held.switched, false);
assert.equal(held.line, weak);
const stuck = chooseComposition([weak], losses, 0.4, true);
assert.equal(stuck.stuck, true);
assert.equal(stuck.line, weak);
const fresh = chooseComposition([weak, otherComp], { matches: [] }, 0.4, true);
assert.equal(fresh.switched, false);
assert.equal(fresh.line, weak);

console.log("record tests passed", rate);
