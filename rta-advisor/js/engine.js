/**
 * RTA draft and fight sandbox.
 * Multipliers and effect numbers come from catalog.json.
 * Win rate is the share of simulated trials, not a promise.
 */

import heroLinks from "../data/hero-links.json" with { type: "json" };
import screenSkills from "../data/screen-skills.json" with { type: "json" };
import rarityByCode from "../data/rarity.json" with { type: "json" };
import e7Rta from "../data/e7rtabot-rta.json" with { type: "json" };
import skillEnhanceMax from "../data/skill-enhance-max.json" with { type: "json" };

const ADVANTAGE = { fire: "wind", wind: "ice", ice: "fire", light: "dark", dark: "light" };

const PIECES = {
  Health: 2, Defense: 2, Attack: 4, Speed: 4, Critical: 2, Hit: 2, Destruction: 4,
  Lifesteal: 4, Counter: 4, Resist: 2, Unity: 2, Rage: 4, Immunity: 2, Penetration: 2,
  Revenge: 4, Injury: 4, Protection: 4, Torrent: 2, Reversal: 4, Riposte: 4,
  Warfare: 4, Pursuit: 2, Weakening: 4, Fervor: 2,
};

const FRIBBELS_SET = {
  HealthSet: "Health", DefenseSet: "Defense", AttackSet: "Attack", SpeedSet: "Speed",
  CriticalSet: "Critical", HitSet: "Hit", DestructionSet: "Destruction", LifestealSet: "Lifesteal",
  CounterSet: "Counter", ResistSet: "Resist", UnitySet: "Unity", RageSet: "Rage",
  ImmunitySet: "Immunity", PenetrationSet: "Penetration", RevengeSet: "Revenge",
  InjurySet: "Injury", ProtectionSet: "Protection", TorrentSet: "Torrent",
  ReversalSet: "Reversal", RiposteSet: "Riposte", WarfareSet: "Warfare",
  PursuitSet: "Pursuit", WeakeningSet: "Weakening", FervorSet: "Fervor",
};

const STAT_ZH = {
  Attack: "攻擊", AttackPercent: "攻擊%", Health: "生命", HealthPercent: "生命%",
  Defense: "防禦", DefensePercent: "防禦%", Speed: "速度",
  CriticalHitChancePercent: "暴擊", CriticalHitDamagePercent: "暴擊傷害",
  EffectivenessPercent: "效果命中", EffectResistancePercent: "效果抗性",
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function elementRelation(att, def) {
  if (ADVANTAGE[att] === def) return "advantage";
  if (ADVANTAGE[def] === att && ADVANTAGE[att] !== def) return "disadvantage";
  return "neutral";
}

export function skillDamage(att, defUnit, skill, hitMult) {
  const rate = skill.rate || 0;
  const hp = att.hp || 0;
  const atk = att.atk || 0;
  const defStat = att.def || 0;
  const spd = att.spd || att.speed || 0;
  if (rate <= 0 && !(skill.selfHpScaling || skill.selfAtkScaling || skill.selfDefScaling || skill.selfSpdScaling)) {
    return 0;
  }
  const scaling =
    (skill.selfHpScaling || 0) * hp +
    (skill.selfAtkScaling || 0) * atk +
    (skill.selfDefScaling || 0) * defStat +
    (skill.selfSpdScaling || 0) * spd;
  const increased = 1 + (skill.increasedValue || 0) + (skill.enhanceDamagePctApplied || 0);
  const pen = skill.penetration || 0;
  let remain = 1 - pen;
  if ((att.sets || []).includes("Penetration") && (skill.targets || 1) === 1) remain *= 0.85;
  remain = Math.max(0, remain);
  let pct = 1;
  if ((att.sets || []).includes("Torrent")) pct += 0.1;
  if ((att.sets || []).includes("Rage") && (defUnit.debuffs || []).length) pct += 0.3;
  const offensive = (atk * rate + scaling) * 1.871 * (skill.pow || 1) * increased * hitMult * pct;
  const targetDef = defUnit.def || 0;
  const defensive = 1 / ((targetDef * remain) / 300 + 1);
  return Math.max(0, offensive * defensive);
}

function activeSets(setNamesOrCounts) {
  if (Array.isArray(setNamesOrCounts)) return setNamesOrCounts.filter((name) => PIECES[name]);
  const active = [];
  for (const [name, count] of Object.entries(setNamesOrCounts || {})) {
    if ((PIECES[name] || 99) <= count) active.push(name);
  }
  return active;
}

function fightRecord(catalog, id) {
  const modeled = (catalog?.heroes || []).find((hero) => hero.id === id);
  if (modeled) return hasPublicDamage(modeled) ? modeled : null;
  const row = (catalog?.database || []).find((hero) => hero.id === id);
  if (!row || !hasPublicDamage(row)) return null;
  const normalized = normalizeHeroDef(row);
  return {
    ...normalized,
    role: row.role || normalized.role || "",
    rtaGear: row.rtaGear || null,
    reference: row.reference || null,
  };
}

function normalizeHeroDef(row) {
  if (!row) return null;
  if (row.base && (row.base.speed != null || row.base.attack != null)) return row;
  return {
    ...row,
    base: {
      attack: row.baseAttack ?? null,
      hp: row.baseHp ?? null,
      defense: row.baseDefense ?? null,
      speed: row.baseSpeed ?? null,
      crit: null,
      critDamage: null,
      effectiveness: null,
      effectResistance: null,
    },
  };
}

export function hasPublicDamage(hero) {
  const skills = hero?.skills || {};
  return ["S1", "S2", "S3"].some((slot) => {
    const skill = skills[slot];
    if (!skill) return false;
    const scaling = (skill.selfHpScaling || 0) + (skill.selfAtkScaling || 0) + (skill.selfDefScaling || 0) + (skill.selfSpdScaling || 0);
    return (typeof skill.rate === "number" && typeof skill.pow === "number" && skill.rate > 0 && skill.pow > 0) || scaling > 0;
  });
}

export function heroListed(hero) {
  if (!hero) return false;
  if (typeof hero.listed === "boolean") return hero.listed;
  return hasPublicDamage(hero);
}

function personOf(id) {
  for (const person of heroLinks.people) {
    if (person.id === id || (person.also || []).includes(id)) return person;
  }
  return null;
}

function canonicalId(id) {
  return personOf(id)?.id || id;
}

function findDef(catalog, id) {
  const pools = [catalog.heroes || [], catalog.seasonHeroes || [], catalog.database || []];
  for (const pool of pools) {
    const found = pool.find((hero) => hero.id === id);
    if (found) return found;
  }
  return null;
}

export function selectableHeroes(catalog) {
  const hidden = new Set();
  const names = new Map();
  for (const person of heroLinks.people) {
    for (const id of person.also || []) hidden.add(id);
    names.set(person.id, person.names || []);
  }
  const byId = new Map();
  for (const hero of catalog.database || []) {
    if (!hero?.id || hidden.has(hero.id)) continue;
    byId.set(hero.id, { ...hero });
  }
  for (const hero of [...(catalog.seasonHeroes || []), ...(catalog.heroes || [])]) {
    if (!hero?.id || hidden.has(hero.id)) continue;
    byId.set(hero.id, { ...(byId.get(hero.id) || {}), ...hero });
  }
  return [...byId.values()].map((hero) => ({
    ...hero,
    aliases: names.get(hero.id) || [],
    listed: heroListed(hero),
    rarity: hero.rarity ?? rarityByCode[hero.code] ?? null,
  }));
}

function heroByName(catalog, name) {
  const key = String(name || "").trim().toLowerCase();
  const raw = String(name || "").trim();
  if (!key) return null;
  for (const person of heroLinks.people) {
    const labels = [person.id, ...(person.names || [])];
    if (labels.some((label) => String(label).trim() === raw || String(label).trim().toLowerCase() === key)) {
      const found = findDef(catalog, person.id);
      if (found) return normalizeHeroDef(found);
    }
  }
  const pools = [catalog.heroes || [], catalog.seasonHeroes || [], catalog.database || []];
  for (const pool of pools) {
    const found = pool.find((hero) => hero.name?.toLowerCase() === key || hero.nameZh === raw || hero.id === key);
    if (!found) continue;
    const canonical = findDef(catalog, canonicalId(found.id)) || found;
    return normalizeHeroDef(canonical);
  }
  return null;
}

export const ACCOUNT_STORAGE_KEY = "rta-advisor-account";

export function saveAccount(storage, data) {
  storage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify({ data }));
}

export function loadAccount(storage) {
  const raw = storage.getItem(ACCOUNT_STORAGE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return parsed?.data ?? null;
}

export function clearAccount(storage) {
  storage.removeItem(ACCOUNT_STORAGE_KEY);
}

export function readAccountText(text) {
  const trimmed = String(text || "").replace(/^\uFEFF/, "").trim();
  let data;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new Error("這個檔不是 gear.txt，也不是 Fribbels 的 Save all JSON。");
  }
  if (Array.isArray(data)) data = { items: data };
  const heroes = data.heroes || data.units;
  const hasHeroes = Array.isArray(heroes)
    ? heroes.length > 0
    : Boolean(heroes && typeof heroes === "object" && Object.keys(heroes).length);
  if (!hasHeroes) {
    throw new Error("這份 gear.txt 只有裝備、沒有英雄。請改匯入 Fribbels 的 Save all optimizer data。");
  }
  return data;
}

export function parseRoster(input, catalog) {
  const data = typeof input === "string" ? readAccountText(input) : input;
  let list = data.heroes || data.units || [];
  if (!Array.isArray(list) && list && typeof list === "object") list = Object.values(list);
  if (!Array.isArray(list)) throw new Error("找不到 heroes 陣列");
  const heroes = [];
  const unknown = [];
  for (const raw of list) {
    const name = raw.name || raw.heroName;
    const def = heroByName(catalog, name);
    if (!def) {
      unknown.push(name || "(未命名)");
      continue;
    }
    const finalStats = raw.atk != null || raw.attack != null;
    const attack = num(raw.attack ?? raw.atk, def.base.attack);
    const hp = num(raw.hp, def.base.hp);
    const defense = num(raw.defense ?? raw.def, def.base.defense);
    const speed = num(raw.speed ?? raw.spd, def.base.speed);
    const crit = num(raw.crit ?? raw.cr ?? raw.chc, def.base.crit);
    const critDamage = num(raw.critDamage ?? raw.cd ?? raw.chd, def.base.critDamage);
    const effectiveness = num(raw.effectiveness ?? raw.eff, def.base.effectiveness);
    const effectResistance = num(raw.effectResistance ?? raw.res ?? raw.efr, def.base.effectResistance);
    const gear = readGear(raw);
    heroes.push({
      id: def.id,
      name: def.name,
      nameZh: def.nameZh,
      sample: Boolean(raw.sample || data.label),
      attack, hp, defense, speed, crit, critDamage, effectiveness, effectResistance,
      artifact: raw.artifact || raw.artifactName || null,
      artifactLevel: raw.artifactLevel ?? null,
      artifactLimitBreak: raw.artifactLimitBreak ?? limitBreakFromLevel(raw.artifactLevel),
      imprint: raw.imprint || raw.imprintNumber || null,
      awakening: raw.awakening ?? raw.awaken ?? (raw.stars >= 6 ? null : null),
      stars: raw.stars ?? null,
      skillEnhance: raw.skillEnhance || { s1: null, s2: null, s3: null },
      sets: gear.sets.length ? activeSets(gear.counts) : activeSets(raw.sets || []),
      gearPieces: gear.pieces,
      statsAreFinal: finalStats,
    });
  }
  const ownedArtifacts = collectOwnedArtifacts(data, heroes);
  const warehouse = Array.isArray(data.items) && data.items.length
    ? data.items.map(normalizePiece).filter((piece) => piece.slot)
    : [];
  return {
    label: data.label || data._label || null,
    warning: data.warning || null,
    heroes,
    unknown,
    ownedArtifacts,
    gearWarehouse: warehouse,
  };
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function limitBreakFromLevel(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return null;
  if (n <= 15) return 0;
  return Math.max(0, Math.round((n - 15) / 3));
}

function normalizeSlot(slot) {
  const name = String(slot || "");
  if (name === "Neck") return "Necklace";
  return name;
}

function normalizePiece(item) {
  if (!item || !item.set) return { slot: null, set: null, main: null, mainValue: null, substats: [] };
  const set = FRIBBELS_SET[item.set] || String(item.set).replace(/Set$/, "");
  const main = item.main?.type || (typeof item.main === "string" ? item.main : null);
  return {
    slot: normalizeSlot(item.gear || item.slot),
    set,
    main,
    mainValue: item.main?.value ?? item.mainValue ?? null,
    substats: (item.substats || []).map((sub) => (
      typeof sub === "string" ? { type: sub, value: null } : { type: sub.type, value: sub.value ?? null }
    )),
  };
}

function readGear(raw) {
  const pieces = [];
  const counts = {};
  const equip = raw.equipment || {};
  for (const item of Object.values(equip)) {
    const piece = normalizePiece(item);
    if (!piece.set) continue;
    counts[piece.set] = (counts[piece.set] || 0) + 1;
    pieces.push(piece);
  }
  return { pieces, counts, sets: activeSets(counts) };
}

function collectOwnedArtifacts(data, heroes) {
  const owned = new Set();
  for (const hero of heroes) {
    if (hero.sample || !hero.artifact) continue;
    owned.add(hero.artifact);
  }
  const lists = [data.artifacts, data.artifactInventory, data.artifactList];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const name = typeof item === "string" ? item : item?.name || item?.artifactName;
      if (name) owned.add(name);
    }
  }
  return [...owned];
}

function isSpeedStat(type) {
  return type === "Speed" || type === "spd";
}

function pieceSpeed(piece) {
  let flat = 0;
  let missing = false;
  if (isSpeedStat(piece.main)) {
    if (Number.isFinite(Number(piece.mainValue))) flat += Number(piece.mainValue);
    else missing = true;
  }
  for (const sub of piece.substats || []) {
    const type = typeof sub === "string" ? sub : sub.type;
    const value = typeof sub === "string" ? null : sub.value;
    if (!isSpeedStat(type)) continue;
    if (Number.isFinite(Number(value))) flat += Number(value);
    else missing = true;
  }
  return { flat, missing };
}

const GEAR_SLOTS = ["Weapon", "Helmet", "Armor", "Necklace", "Ring", "Boots"];

export function speedFromPieces(baseSpeed, pieces) {
  const bySlot = {};
  let incomplete = false;
  for (const piece of pieces || []) {
    if (!GEAR_SLOTS.includes(piece.slot)) continue;
    const speed = pieceSpeed(piece);
    if (speed.missing) incomplete = true;
    (bySlot[piece.slot] ||= []).push({ flat: speed.flat, set: piece.set, missing: speed.missing });
  }
  const usable = (slot) => (bySlot[slot] || []).filter((piece) => !piece.missing);
  if (!GEAR_SLOTS.some((slot) => usable(slot).length)) return null;
  const best = (list) => list.reduce((left, right) => (right.flat > left.flat ? right : left));
  const chosen = GEAR_SLOTS.map((slot) => (usable(slot).length ? best(usable(slot)) : null));
  let flat = chosen.reduce((sum, piece) => sum + (piece?.flat || 0), 0);
  let bonus = chosen.filter((piece) => piece?.set === "Speed").length >= 4 ? Math.round(baseSpeed * 0.25) : 0;
  const speedSet = GEAR_SLOTS.map((slot) => {
    const list = usable(slot).filter((piece) => piece.set === "Speed");
    return list.length ? best(list) : null;
  });
  const ranked = speedSet.map((piece, index) => ({ piece, index })).filter((row) => row.piece);
  ranked.sort((left, right) => right.piece.flat - left.piece.flat);
  if (ranked.length >= 4) {
    const use = new Set(ranked.slice(0, 4).map((row) => row.index));
    let alt = Math.round(baseSpeed * 0.25);
    GEAR_SLOTS.forEach((slot, index) => {
      if (use.has(index)) alt += speedSet[index].flat;
      else if (usable(slot).length) alt += best(usable(slot)).flat;
    });
    if (alt > flat + bonus) {
      bonus = Math.round(baseSpeed * 0.25);
      flat = alt - bonus;
    }
  }
  return { speed: baseSpeed + flat + bonus, flat, bonus, incomplete };
}

export function reachableSpeed(baseSpeed, panelSpeed, pieces, warehouse) {
  const worn = Number(panelSpeed);
  const panel = Number.isFinite(worn) ? worn : baseSpeed;
  if (!warehouse) return { speed: panel, from: "worn", incomplete: false };
  const built = speedFromPieces(baseSpeed, pieces);
  if (!built || built.incomplete) return { speed: panel, from: "worn", incomplete: true };
  return {
    speed: Math.max(panel, built.speed),
    from: built.speed > panel ? "inventory" : "worn",
    built: built.speed,
    incomplete: false,
  };
}

function writtenEnhance(hero, slot) {
  const skill = hero?.skills?.[slot] || {};
  const row = skillEnhanceMax[hero?.id]?.[slot];
  if (!row) {
    return {
      damage: skill.enhanceDamagePct || 0,
      chance: skill.enhanceEffectPct || 0,
      cooldown: skill.enhanceCooldownCut || 0,
      readiness: 0,
      soul: 0,
      healing: 0,
      barrier: 0,
      spirit: 0,
      spiritGain: 0,
      duration: 0,
    };
  }
  return {
    damage: row.damage || 0,
    chance: row.chance || 0,
    cooldown: row.cooldown || 0,
    readiness: row.readiness || 0,
    soul: row.soul || 0,
    healing: row.healing || 0,
    barrier: row.barrier || 0,
    spirit: row.spirit || 0,
    spiritGain: row.spiritGain || 0,
    duration: row.duration || 0,
  };
}

function preparedSkill(heroDef, slot, enhanceMode) {
  const skill = heroDef.skills[slot];
  const copy = { ...skill, slot };
  const written = writtenEnhance(heroDef, slot);
  const maxed = enhanceMode === "max";
  if (maxed) {
    copy.enhanceDamagePctApplied = written.damage;
    copy.enhanceEffectPctApplied = written.chance;
    copy.enhanceHealingApplied = written.healing;
    copy.soulGain = (skill.soulGain || 0) + written.soul;
    if (skill.cooldownShown != null) {
      copy.cooldown = Math.max(0, skill.cooldownShown - written.cooldown);
    } else {
      copy.cooldown = 0;
    }
    copy.effects = (skill.effects || []).map((effect) => {
      const next = { ...effect };
      if (written.readiness && (effect.kind === "crPush" || effect.kind === "crPushback") && typeof effect.amount === "number") {
        next.amount = effect.amount + Math.round(written.readiness * 100);
      }
      if (written.duration && typeof effect.turns === "number") next.turns = effect.turns + written.duration;
      return next;
    });
  } else {
    copy.enhanceDamagePctApplied = 0;
    copy.enhanceEffectPctApplied = 0;
    copy.enhanceHealingApplied = 0;
    copy.cooldown = skill.cooldownShown || 0;
  }
  return copy;
}

function unitFrom(rosterHero, def, enhanceMode) {
  const skills = {};
  for (const slot of ["S1", "S2", "S3"]) skills[slot] = preparedSkill(def, slot, enhanceMode);
  return {
    id: def.id,
    name: def.name,
    nameZh: def.nameZh,
    attribute: def.attribute,
    side: null,
    hp: rosterHero.hp,
    maxHp: rosterHero.hp,
    atk: rosterHero.attack,
    def: rosterHero.defense,
    baseDef: rosterHero.defense,
    speed: rosterHero.speed,
    baseSpeed: rosterHero.speed,
    crit: rosterHero.crit,
    cd: rosterHero.critDamage,
    eff: rosterHero.effectiveness,
    res: rosterHero.effectResistance,
    sets: rosterHero.sets || [],
    role: def.role || "",
    skills,
    cdLeft: { S1: 0, S2: 0, S3: 0 },
    cr: 0,
    alive: true,
    debuffs: [],
    buffs: [],
    barrier: 0,
    lockedSpeed: rosterHero.speed,
    passives: collectPassives(skills),
  };
}

function collectPassives(skills) {
  const list = [];
  for (const skill of Object.values(skills)) {
    if (!skill.passive && skill.slot !== "S2") continue;
    for (const effect of skill.effects || []) {
      if (["speedCap", "crLockOnCasterTurn", "fixOwnSpeed", "crImmune", "soulCut", "cannotCrit"].includes(effect.kind)) {
        list.push(effect);
      }
      if (effect.kind === "crPush" && effect.atBattleStart) list.push(effect);
    }
  }
  return list;
}

function effectText(effect) {
  switch (effect.kind) {
    case "speedCap":
      return `其他角色速度上限為施放者的 ${Math.round(effect.ratio * 100)}%`;
    case "crLockOnCasterTurn":
      return "施放者行動時，戰鬥準備度增加不會生效";
    case "fixOwnSpeed":
      return "自己的速度在開場後固定";
    case "crImmune":
      return "不受戰鬥準備度增減影響";
    case "soulCut":
      return `敵方獲得的魂降低 ${Math.round(effect.ratio * 100)}%`;
    case "crPush":
      return `戰鬥準備度 +${effect.amount}`;
    case "crPushback":
      return effect.amountMin != null
        ? `戰鬥準備度 -${effect.amountMin} 到 -${effect.amountMax}`
        : `戰鬥準備度 -${effect.amount}`;
    case "stun":
    case "fear":
      return `${Math.round((effect.chance ?? 1) * 100)}% 無法行動`;
    case "silence":
      return `${Math.round((effect.chance ?? 1) * 100)}% 沉默`;
    case "defDown":
      return `${Math.round((effect.chance ?? 1) * 100)}% 防禦下降${effect.value ? ` ${Math.round(effect.value * 100)}%` : ""}`;
    case "dispelBuff":
      return "驅散強化";
    case "penetrate":
      return effect.ratio != null ? `防禦穿透 ${Math.round(effect.ratio * 100)}%` : "防禦穿透（倍率用公開數字）";
    case "extraAttack":
      return "額外攻擊（沒有獨立倍率，傷害不計算）";
    case "heal":
      return effect.full ? "完全回復生命" : "回復生命";
    case "extraTurn":
      return "再行動一次";
    case "cannotCrit":
      return "不會暴擊";
    default:
      return "";
  }
}

export function counterEdges(catalog) {
  const edges = [];
  const heroes = catalog.heroes;
  for (const a of heroes) {
    for (const b of heroes) {
      if (a.id === b.id) continue;
      if (elementRelation(a.attribute, b.attribute) === "advantage") {
        edges.push({
          from: a.id,
          to: b.id,
          why: `${a.attributeZh}屬性克制${b.attributeZh}屬性，優勢傷害 ×1.1，且不會擦傷`,
          kind: "element",
        });
      }
    }
    const texts = Object.values(a.skills).flatMap((s) => s.effects || []);
    if (texts.some((e) => e.kind === "speedCap")) {
      const ratio = texts.find((e) => e.kind === "speedCap").ratio;
      for (const b of heroes) {
        if (b.id === a.id) continue;
        const bSpeed = b.reference?.median?.speed || b.base.speed;
        const aSpeed = a.reference?.median?.speed || a.base.speed;
        if (bSpeed > aSpeed * ratio) {
          edges.push({
            from: a.id,
            to: b.id,
            why: `${a.nameZh}把其他人的速度壓到自己的 ${Math.round(ratio * 100)}%。${b.nameZh}的參考速度 ${bSpeed} 高過這個上限，先手優勢會被吃掉`,
            kind: "speedCap",
          });
        }
      }
    }
    if (texts.some((e) => e.kind === "soulCut")) {
      for (const b of heroes) {
        const burn = Object.values(b.skills).find((s) => s.soulburnCost);
        if (burn) {
          edges.push({
            from: a.id,
            to: b.id,
            why: `${a.nameZh}讓敵方獲得的魂降為 0，${b.nameZh}的燒魂（${burn.soulburnCost} 魂）比較難交得出來`,
            kind: "soul",
          });
        }
      }
    }
    if (texts.some((e) => e.kind === "crPush" && e.atBattleStart)) {
      for (const b of heroes) {
        if (b.id === a.id) continue;
        if (Object.values(b.skills).some((s) => (s.effects || []).some((e) => e.kind === "speedCap" || e.kind === "crPushback"))) {
          edges.push({
            from: b.id,
            to: a.id,
            why: `${a.nameZh}開場推戰鬥準備度，${b.nameZh}的拉條或速度上限是針對這種先手`,
            kind: "opener",
          });
        }
      }
    }
  }
  return edges;
}

function answers(edges, fromId, toId) {
  return edges.filter((e) => e.from === fromId && e.to === toId);
}

function ownsArtifact(owned, name) {
  const key = String(name || "").toLowerCase();
  return (owned || []).some((item) => String(item).toLowerCase() === key);
}

export function buildGearReport(rosterHero, def, catalog, roster = {}) {
  if (!def?.rtaGear) {
    const listed = heroListed(def);
    return {
      foreign: false,
      haveSets: [],
      metaSets: [],
      haveArtifact: null,
      metaArtifact: null,
      changes: [listed ? "資料庫有這名英雄，但沒有這一季的配裝統計，不建議裝備。" : "這個英雄未收錄，沒有技能倍率，不建議裝備。"],
      mains: null,
      substatPriority: [],
      substatAvoid: [],
      haveSubs: {},
      speed: null,
      editorialNote: listed ? "不編配裝。" : "未收錄。",
      unlisted: !listed,
    };
  }
  const editorial = def.editorialGear || {};
  const mainLine = translateMains(editorial.mainsSentence);
  const priority = (editorial.substatPriority || []).map(translateStat);
  if (rosterHero.sample) {
    return {
      foreign: true,
      haveSets: [],
      metaSets: [],
      haveArtifact: null,
      metaArtifact: null,
      changes: ["這筆速度、面板和神器是公開配裝的中位數，不是你的裝備。不會把它寫成你現在的面板，也不用它來建議神器或速度。"],
      mains: null,
      substatPriority: [],
      substatAvoid: [],
      haveSubs: {},
      speed: null,
      editorialNote: "範例名單不是你的帳號。",
      source: def.sources?.rtaGear,
    };
  }
  const combo = (def.rtaGear.setCombos || [])[0] || null;
  const ladder = def.rtaGear.artifacts || [];
  const metaSets = combo?.names || [];
  const haveSets = rosterHero.sets || [];
  const haveArtZh = artifactZh(catalog, rosterHero.artifact);
  const changes = [];
  const missing = metaSets.filter((set) => !haveSets.includes(set));
  const extra = haveSets.filter((set) => !metaSets.includes(set));
  if (combo && (missing.length || extra.length || !haveSets.length)) {
    changes.push(`套裝：你現在是 ${haveSets.map(setZh).join("、") || "沒有讀到套裝"}。天梯最常見是 ${metaSets.map(setZh).join(" + ")}（${combo.pickRate}%）。`);
  } else if (combo) {
    changes.push(`套裝已經是天梯最常見的 ${metaSets.map(setZh).join(" + ")}。`);
  }
  const owned = roster.ownedArtifacts || [];
  const ownedLadder = ladder.filter((row) => ownsArtifact(owned, row.names?.[0]));
  const top = ladder[0] || null;
  const topName = top?.names?.[0] || null;
  const topZh = artifactZh(catalog, topName);
  let suggestedArtifact = null;
  if (!top) {
    changes.push("神器：這個賽季沒有神器統計。");
  } else if (!owned.length && !rosterHero.artifact) {
    changes.push(`神器：檔案沒有讀到你擁有的神器。天梯最常見是 ${topZh}，不會把它當成你有的。`);
  } else if (ownsArtifact(owned, topName)) {
    suggestedArtifact = topName;
    if (rosterHero.artifact === topName) {
      changes.push(`神器已經是你有的、天梯最常見的 ${topZh}。`);
    } else {
      changes.push(`神器：你現在是 ${haveArtZh || "沒有讀到"}。你有天梯最常見的 ${topZh}（${top.pickRate}%），可以換上。模擬仍用你現在的面板。`);
    }
  } else if (ownedLadder[0]) {
    suggestedArtifact = ownedLadder[0].names[0];
    const altZh = artifactZh(catalog, suggestedArtifact);
    changes.push(`神器：天梯最常見是 ${topZh}（${top.pickRate}%）。你的帳號沒有這件，不會把它算成你的。你有的裡面，清單上最前面的是 ${altZh}（${ownedLadder[0].pickRate}%）。`);
  } else {
    changes.push(`神器：天梯最常見是 ${topZh}（${top.pickRate}%）。你的帳號沒有這件，清單上的其他神器也沒有，所以不建議換神器。`);
  }
  const threshold = def.reference?.median?.speed;
  const warehouse = (roster.gearWarehouse || []).length > 0;
  const pieces = warehouse ? roster.gearWarehouse : (rosterHero.gearPieces || []);
  const reached = reachableSpeed(def.base.speed, rosterHero.speed, pieces, warehouse);
  let speedNote = null;
  if (typeof threshold === "number") {
    const proven = reached.speed;
    if (proven >= threshold) {
      speedNote = `速度：你穿上的是 ${rosterHero.speed}。公開配裝中位數是 ${threshold}，那是別人的面板，不是你的。以讀得到的裝備，這個門檻達得到。沙盤仍用你穿上的 ${rosterHero.speed}。`;
    } else if (reached.incomplete) {
      speedNote = `速度：你穿上的是 ${rosterHero.speed}，低於公開配裝中位數 ${threshold}。未穿裝備的速度沒有數字，不能把 ${threshold} 寫成你達得到的速度，也不會把它當成你的面板。`;
    } else {
      speedNote = `速度：你穿上的是 ${rosterHero.speed}。以你帳號裡的裝備計算，上限約 ${proven}，到不了公開配裝中位數 ${threshold}。那是別人的面板，不會寫成你的速度。`;
    }
    changes.push(speedNote);
  }
  return {
    foreign: false,
    haveSets: haveSets.map(setZh),
    metaSets: metaSets.map(setZh),
    metaSetDetail: combo,
    haveArtifact: haveArtZh || rosterHero.artifact,
    metaArtifact: suggestedArtifact ? artifactZh(catalog, suggestedArtifact) : null,
    suggestedArtifact,
    changes,
    mains: mainLine,
    substatPriority: priority,
    substatAvoid: (editorial.substatAvoid || []).map(translateStat),
    haveSubs: countSubs(rosterHero.gearPieces),
    speed: { threshold: threshold ?? null, reachable: reached.speed, worn: rosterHero.speed, from: reached.from },
    editorialNote: "主屬性與副屬性優先序來自 Epic7Tools 的配裝建議，頁面沒有標賽季。套裝和神器才是 Epic7RTAStats 的賽季統計。神器只建議你帳號裡有的。速度門檻用你讀得到的裝備來比，比不到就直說，不會拿別人的中位數當你的面板。",
    source: def.sources?.rtaGear,
  };
}

function setZh(name, catalog) {
  return catalog?.setZh?.[name] || SET_ZH[name] || name;
}
const SET_ZH = {
  Speed: "速度", Hit: "命中", Critical: "暴擊", Defense: "防禦", Health: "生命", Attack: "攻擊",
  Counter: "反擊", Lifesteal: "吸血", Destruction: "破滅", Resist: "抗性", Unity: "連擊", Rage: "憤怒",
  Immunity: "免疫", Penetration: "穿透", Revenge: "復仇", Injury: "創傷", Protection: "守護",
  Torrent: "激流", Reversal: "逆轉", Riposte: "還擊", Warfare: "開戰", Pursuit: "追擊",
  Weakening: "削弱", Fervor: "熱誠",
};

function shownZh(name, fallback = "沒有中文名") {
  if (!name || /[A-Za-z]/.test(name)) return fallback;
  return name;
}

function artifactZh(catalog, name) {
  if (!name) return null;
  const found = Object.values(catalog.artifactNames || {}).find((a) => a.name === name);
  return shownZh(found?.nameZh || "");
}

function translateStat(text) {
  return String(text)
    .replaceAll("Critical Hit Damage", "暴擊傷害")
    .replaceAll("Critical Hit Chance", "暴擊率")
    .replaceAll("Effect Resistance", "效果抗性")
    .replaceAll("Effectiveness", "效果命中")
    .replaceAll("Health %", "生命%")
    .replaceAll("Defense %", "防禦%")
    .replaceAll("Attack %", "攻擊%")
    .replaceAll("Speed", "速度")
    .replaceAll("Health", "生命")
    .replaceAll("Defense", "防禦")
    .replaceAll("Attack", "攻擊");
}

function translateMains(sentence) {
  if (!sentence) return null;
  return translateStat(sentence)
    .replaceAll("necklace", "項鍊")
    .replaceAll("ring", "戒指")
    .replaceAll("boots", "鞋子")
    .replaceAll("on the", "在")
    .replaceAll("and", "與");
}

function countSubs(pieces) {
  const counts = {};
  for (const piece of pieces || []) {
    for (const sub of piece.substats || []) {
      const type = typeof sub === "string" ? sub : sub.type;
      const label = STAT_ZH[type] || type;
      counts[label] = (counts[label] || 0) + 1;
    }
    if (piece.main) {
      const label = `主屬:${piece.slot || ""} ${STAT_ZH[piece.main] || piece.main}`;
      counts[label] = (counts[label] || 0) + 1;
    }
  }
  return counts;
}

function combinations(list, n) {
  const out = [];
  const cur = [];
  function walk(start) {
    if (cur.length === n) {
      out.push(cur.slice());
      return;
    }
    for (let i = start; i < list.length; i += 1) {
      cur.push(list[i]);
      walk(i + 1);
      cur.pop();
    }
  }
  walk(0);
  return out;
}

export function advise(catalog, roster, options = {}) {
  const prebansEach = options.rank === "below" ? 1 : 2;
  const userFirst = options.firstPick !== false;
  const enhanceMode = options.assumeMaxEnhance ? "max" : "base";
  const trials = options.trials || 8;
  const edges = counterEdges(catalog);
  const byId = Object.fromEntries(catalog.heroes.map((h) => [h.id, h]));
  const owned = roster.heroes.filter((h) => byId[h.id]);
  const gear = owned.map((h) => ({ hero: h, def: byId[h.id], report: buildGearReport(h, byId[h.id], catalog, roster) }));
  if (owned.length < 5) {
    return {
      ok: false,
      reason: `名單裡能模擬的英雄只有 ${owned.length} 名，一場要選 5 名。請補上核心英雄，或先用範例名單。`,
      gear,
      edges,
      unknown: roster.unknown,
    };
  }

  let enemyPre = [...catalog.heroes]
    .sort((a, b) => b.rtaPresence.prebans - a.rtaPresence.prebans)
    .slice(0, prebansEach)
    .map((h) => h.id);
  const userCandidates = [...catalog.heroes]
    .sort((a, b) => b.rtaPresence.prebans - a.rtaPresence.prebans)
    .filter((h) => !enemyPre.includes(h.id))
    .slice(0, prebansEach === 1 ? 4 : 5);
  let userPairs = prebansEach === 1
    ? userCandidates.map((h) => [h.id])
    : combinations(userCandidates.map((h) => h.id), 2);
  const lockedUserPre = options.lockedUserPre || [];
  const taken = new Set([...(options.lockedUser || []), ...(options.lockedEnemy || []), ...lockedUserPre]);
  if (taken.size) {
    const ranked = [...catalog.heroes].sort((a, b) => b.rtaPresence.prebans - a.rtaPresence.prebans).map((h) => h.id);
    const ownedIds = new Set(owned.map((hero) => hero.id));
    const unseen = ranked.filter((id) => !taken.has(id) && !ownedIds.has(id));
    const open = ranked.filter((id) => !taken.has(id));
    enemyPre = (unseen.length >= prebansEach ? unseen : open).slice(0, prebansEach);
  }
  if (lockedUserPre.length) {
    if (lockedUserPre.length > prebansEach || lockedUserPre.some((id) => !byId[id])) {
      return {
        ok: false,
        reason: "預禁對不上這個分段，或是不在賽季模型裡，這步建議無效。",
        gear,
        edges,
        unknown: roster.unknown,
      };
    }
    const ranked = [...catalog.heroes].sort((a, b) => b.rtaPresence.prebans - a.rtaPresence.prebans).map((h) => h.id);
    const rest = prebansEach - lockedUserPre.length;
    const pool = ranked.filter((id) => !taken.has(id) && !enemyPre.includes(id));
    const ownedIds = new Set(owned.map((hero) => hero.id));
    const unowned = pool.filter((id) => !ownedIds.has(id));
    const partners = (unowned.length ? unowned : pool).slice(0, 8);
    const extras = rest === 0 ? [[]] : combinations(partners, rest);
    userPairs = extras.map((extra) => [...lockedUserPre, ...extra]);
  }

  const plans = [
    { id: "s3-burn", order: ["S3", "S2", "S1"], burn: true },
    { id: "s3", order: ["S3", "S2", "S1"], burn: false },
    { id: "s1-burn", order: ["S1", "S3", "S2"], burn: true },
    { id: "s1", order: ["S1", "S3", "S2"], burn: false },
  ];

  let best = null;
  const considered = [];
  let seed = 1;
  for (const userPre of userPairs) {
    const drafted = runDraft({
      catalog, owned, byId, edges, userPre, enemyPre, userFirst,
      lockedUser: options.lockedUser || [],
      lockedEnemy: options.lockedEnemy || [],
    });
    if (!drafted) continue;
    let bestPlan = null;
    for (const plan of plans) {
      let wins = 0;
      let sampleLog = null;
      for (let t = 0; t < trials; t += 1) {
        const fight = fightFromRoster(drafted, roster, catalog, plan, enhanceMode, mulberry32(seed));
        seed += 1;
        if (fight.winner === "user") wins += 1;
        if (!sampleLog || (fight.winner === "user" && sampleLog.winner !== "user")) sampleLog = fight;
      }
      const rate = wins / trials;
      const entry = { plan, rate, log: sampleLog };
      if (!bestPlan || rate > bestPlan.rate) bestPlan = entry;
    }
    const line = {
      userPre,
      enemyPre,
      draft: drafted,
      plan: bestPlan.plan,
      rate: bestPlan.rate,
      log: bestPlan.log,
      reason: explain(drafted, bestPlan, byId, edges),
    };
    considered.push(line);
    if (!best || line.rate > best.rate) best = line;
  }
  considered.sort((a, b) => b.rate - a.rate);
  return {
    ok: Boolean(best),
    best,
    alternatives: considered.slice(0, 3),
    considered,
    gear,
    edges,
    unknown: roster.unknown,
    settings: {
      prebansEach,
      userFirst,
      enhanceMode,
      trials,
      season: catalog.provenance.rtaSeasonLabel,
    },
  };
}

function runDraft({ catalog, owned, byId, edges, userPre, enemyPre, userFirst, lockedUser = [], lockedEnemy = [] }) {
  const banned = new Set([...userPre, ...enemyPre]);
  const ownedIds = new Set(owned.map((h) => h.id));
  const picked = { user: [], enemy: [] };
  const pattern = [1, 2, 2, 2, 2, 1];
  let side = userFirst ? "user" : "enemy";
  const steps = [];
  let userLock = 0;
  let enemyLock = 0;
  for (const n of pattern) {
    for (let i = 0; i < n; i += 1) {
      const locked = side === "user" ? lockedUser[userLock] : lockedEnemy[enemyLock];
      let choiceId;
      if (locked) {
        if (banned.has(locked) || picked.user.includes(locked) || picked.enemy.includes(locked)) return null;
        if (side === "user" && !ownedIds.has(locked)) return null;
        if (side === "enemy" && !byId[locked]) return null;
        choiceId = locked;
        if (side === "user") userLock += 1;
        else enemyLock += 1;
      } else {
        const pool = catalog.heroes.filter((h) => !banned.has(h.id) && !picked.user.includes(h.id) && !picked.enemy.includes(h.id));
        const available = side === "user" ? pool.filter((h) => ownedIds.has(h.id)) : pool;
        const unowned = available.filter((h) => !ownedIds.has(h.id));
        const legal = side === "enemy" && unowned.length ? unowned : available;
        if (!legal.length) return null;
        choiceId = legal
          .map((h) => ({ h, score: pickScore(h, side, picked, edges, byId) }))
          .sort((a, b) => b.score - a.score)[0].h.id;
      }
      picked[side].push(choiceId);
      steps.push({ side, id: choiceId, protected: picked[side].length === 3 });
    }
    side = side === "user" ? "enemy" : "user";
  }
  if (userLock !== lockedUser.length || enemyLock !== lockedEnemy.length) return null;
  const userBan = choosePostban(picked.enemy, picked.user, edges, byId);
  const enemyBan = choosePostban(picked.user, picked.enemy, edges, byId);
  const userFight = picked.user.filter((id) => id !== enemyBan);
  const enemyFight = picked.enemy.filter((id) => id !== userBan);
  if (userFight.length !== 4 || enemyFight.length !== 4) return null;
  return { steps, picked, userBan, enemyBan, userFight, enemyFight, userFirst };
}

function pickScore(hero, side, picked, edges, byId) {
  const played = hero.rtaPresence.wins + hero.rtaPresence.losses;
  let score = Math.log10(played + 10);
  const own = picked[side];
  const opp = picked[side === "user" ? "enemy" : "user"];
  if (own.length === 2) score += uniqueValue(hero);
  for (const id of opp) score += answers(edges, hero.id, id).length * 2.2;
  for (const id of own) score += answers(edges, id, hero.id).length * -0.4;
  for (const id of opp) score += answers(edges, id, hero.id).length * -0.8;
  if (side === "enemy") score += hero.rtaPresence.prebans / 2000000;
  return score;
}

function uniqueValue(hero) {
  const kinds = Object.values(hero.skills).flatMap((s) => (s.effects || []).map((e) => e.kind));
  let n = 0;
  if (kinds.includes("speedCap")) n += 4;
  if (kinds.includes("soulCut")) n += 3;
  if (kinds.includes("crPush") && Object.values(hero.skills).some((s) => (s.effects || []).some((e) => e.atBattleStart))) n += 3;
  if (kinds.includes("revive")) n += 2;
  return n;
}

function choosePostban(opponentPicks, ownPicks, edges, byId) {
  const protectedId = opponentPicks[2];
  let best = null;
  let bestScore = -1;
  for (const id of opponentPicks) {
    if (id === protectedId) continue;
    let score = uniqueValue(byId[id]);
    for (const own of ownPicks) score += answers(edges, id, own).length * 2;
    score += Math.log10((byId[id].rtaPresence.wins + byId[id].rtaPresence.losses) + 10);
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

function explain(draft, bestPlan, byId, edges) {
  const names = (ids) => ids.map((id) => byId[id].nameZh).join("、");
  const protectedUser = byId[draft.picked.user[2]].nameZh;
  const bits = [];
  bits.push(`估計勝率來自 ${bestPlan.log ? "同一套" : ""}沙盤，不是保證。`);
  const link = [];
  for (const id of draft.userFight) {
    for (const enemy of draft.enemyFight) {
      const why = answers(edges, id, enemy)[0];
      if (why) link.push(`${byId[id].nameZh} 對 ${byId[enemy].nameZh}：${why.why}`);
    }
  }
  if (link[0]) bits.push(link[0]);
  bits.push(`第三選是保護位，留下了${protectedUser}。`);
  bits.push(bestPlan.plan.burn ? "技能順序優先大招，並在魂夠且燒魂效果有數字時才燒。" : "這條線不燒魂，勝率較高。");
  if (bestPlan.log?.firstActor) bits.push(`開場第一動是${bestPlan.log.firstActor}。`);
  return { summary: bits[1] || bits[0], lines: bits, names, link };
}

export function simulateFight(draft, plan, byId, enhanceMode, rand) {
  const rosterSide = (ids, side, rosterLookup) => ids.map((id) => {
    const def = byId[id];
    const fromRoster = rosterLookup(id, side);
    const unit = unitFrom(fromRoster, def, enhanceMode);
    unit.side = side;
    return unit;
  });
  // The caller stuffs stats onto draft via closure? We'll pass units instead.
  return simulateUnits(draft.userUnits, draft.enemyUnits, plan, rand);
}

function makeFightUnits(draft, roster, catalog, enhanceMode, enemyMode = "reference") {
  const owned = Object.fromEntries((roster?.heroes || []).map((h) => [h.id, h]));
  const make = (id, side) => {
    const def = fightRecord(catalog, id);
    if (!def) throw new Error(`沒有公開技能倍率：${id}`);
    const own = side === "user" ? owned[id] : null;
    const ref = def.reference?.median;
    const gearNames = def.rtaGear?.setCombos?.[0]?.names || [];
    const stats = (side === "user" && own) ? own : {
      hp: ref?.hp ?? def.base.hp,
      attack: ref?.attack ?? def.base.attack,
      defense: ref?.defense ?? def.base.defense,
      speed: ref?.speed ?? def.base.speed,
      crit: ref?.crit ?? def.base.crit,
      critDamage: ref?.critDamage ?? def.base.critDamage,
      effectiveness: ref?.effectiveness ?? def.base.effectiveness,
      effectResistance: ref?.effectResistance ?? def.base.effectResistance,
      sets: gearNames,
    };
    if (enemyMode === "reference" && side === "enemy") {
      stats.sets = gearNames.length ? gearNames : stats.sets;
    }
    if (draft.rule === "resist") stats.effectResistance = (stats.effectResistance || 0) + 50;
    const unit = unitFrom({
      hp: stats.hp,
      attack: stats.attack,
      defense: stats.defense,
      speed: stats.speed,
      crit: stats.crit,
      critDamage: stats.critDamage,
      effectiveness: stats.effectiveness,
      effectResistance: stats.effectResistance,
      sets: stats.sets || [],
    }, def, side === "enemy" ? "max" : enhanceMode);
    unit.side = side;
    unit.rule = draft.rule || "";
    unit.guidingLightRate = null;
    unit.artifactPool = side === "enemy" ? artifactPool(catalog, def) : [];
    if (def.role === "ranger" && side !== "enemy") {
      const light = (def.rtaGear?.artifacts || []).find((art) => (art.names || [])[0] === "Guiding Light");
      if (light && typeof light.pickRate === "number") unit.guidingLightRate = light.pickRate / 100;
    }
    if (side === "enemy" && opensOnFullCooldown(def) != null) unit.sets = ["Warfare"];
    return unit;
  };
  return {
    user: (draft.userFight || []).map((id) => make(id, "user")),
    enemy: (draft.enemyFight || []).map((id) => make(id, "enemy")),
  };
}

export function fightFromRoster(draft, roster, catalog, plan, enhanceMode, rand, enemyMode = "reference") {
  const made = makeFightUnits(draft, roster, catalog, enhanceMode, enemyMode);
  return simulateUnits(made.user, made.enemy, plan, rand, draft.userFirst !== false);
}

function openPassives(units, rand, log) {
  for (const side of ["user", "enemy"]) {
    const group = units.filter((unit) => unit.side === side);
    const mages = group.filter((unit) => unit.role === "mage");
    if (!group.length || !mages.length) continue;
    const souls = mages.length * 20;
    group[0].purse = { value: souls };
    log.push(`${side === "user" ? "我方" : "對方"}法師${mages.map((unit) => unit.nameZh).join("、")}預設魂書，開場 ${souls} 魂。`);
  }
  for (const unit of units) {
    for (const effect of unit.passives) {
      if (effect.kind === "fixOwnSpeed" || effect.kind === "speedCap") unit.lockedSpeed = unit.baseSpeed;
      if (effect.kind === "crPush" && effect.atBattleStart) {
        unit.cr = Math.min(100, unit.cr + effect.amount);
        log.push(`${unit.nameZh} 開場戰鬥準備度 +${effect.amount}（技能原文）。`);
      }
    }
  }
  applyBattleStart(units, rand, log);
}

function advanceActor(units, userFirst) {
  const living = units.filter((unit) => unit.alive);
  if (!living.length) return null;
  const ready = living.filter((unit) => unit.cr >= 100);
  if (ready.length) return actingOrder(ready, units, userFirst)[0];
  let dt = Infinity;
  for (const unit of living) dt = Math.min(dt, (100 - unit.cr) / effectiveSpeed(unit, units));
  for (const unit of living) unit.cr += effectiveSpeed(unit, units) * dt;
  return actingOrder(living, units, userFirst)[0];
}

function ultWave(catalog, roster, userIds, enemyIds, userFirst, rand) {
  const made = makeFightUnits({ userFight: userIds, enemyFight: enemyIds, userFirst }, roster, catalog, "base");
  const units = [...made.user, ...made.enemy];
  const log = [];
  openPassives(units, rand, log);
  const order = actingOrder(made.enemy.filter((unit) => unit.alive), units, userFirst);
  for (const actor of order) {
    if (!actor.alive || !made.user.some((unit) => unit.alive)) break;
    const parts = splitSkill(actor.skills?.S3);
    takeTurn(actor, units, { order: ["S3"], burn: false }, rand, log);
    if (!parts.damage && made.user.some((unit) => unit.alive)) {
      takeTurn(actor, units, { order: ["S2", "S1"], burn: false }, rand, log);
    }
  }
  const hpById = {};
  for (const unit of made.user) hpById[unit.id] = unit.alive ? Math.max(0, unit.hp) / unit.maxHp : 0;
  const alive = made.user.filter((unit) => unit.alive).length;
  return { chance: made.user.length ? alive / made.user.length : 0, hpById, log };
}

function simulateUnits(userUnits, enemyUnits, plan, rand, userFirst = true) {
  const units = [...userUnits, ...enemyUnits];
  const log = [];
  for (const side of ["user", "enemy"]) {
    const group = units.filter((unit) => unit.side === side);
    const mages = group.filter((unit) => unit.role === "mage");
    if (!group.length || !mages.length) continue;
    const souls = mages.length * 20;
    group[0].purse = { value: souls };
    log.push(`${side === "user" ? "我方" : "對方"}法師${mages.map((unit) => unit.nameZh).join("、")}預設魂書，開場 ${souls} 魂。`);
  }
  for (const unit of units) {
    for (const effect of unit.passives) {
      if (effect.kind === "fixOwnSpeed" || effect.kind === "speedCap") unit.lockedSpeed = unit.baseSpeed;
      if (effect.kind === "crPush" && effect.atBattleStart) {
        unit.cr = Math.min(100, unit.cr + effect.amount);
        log.push(`${unit.nameZh} 開場戰鬥準備度 +${effect.amount}（技能原文）。`);
      }
    }
  }
  applyBattleStart(units, rand, log);
  let firstActor = null;
  let actions = 0;
  let winner = null;
  while (actions < 36 && !winner) {
    const living = units.filter((u) => u.alive);
    const ready = living.filter((u) => u.cr >= 100);
    let actor;
    if (ready.length) {
      actor = actingOrder(ready, units, userFirst)[0];
    } else {
      let dt = Infinity;
      for (const unit of living) dt = Math.min(dt, (100 - unit.cr) / effectiveSpeed(unit, units));
      for (const unit of living) unit.cr += effectiveSpeed(unit, units) * dt;
      actor = actingOrder(living, units, userFirst)[0];
    }
    if (!firstActor) firstActor = actor.nameZh;
    takeTurn(actor, units, plan, rand, log);
    actions += 1;
    winner = winnerOf(userUnits, enemyUnits);
  }
  if (!winner) winner = "draw";
  const hpLeft = (list) => list.map((u) => `${u.nameZh} ${Math.max(0, Math.round(u.hp / u.maxHp * 100))}%`).join("、");
  return {
    winner,
    firstActor,
    actions,
    log: log.slice(0, 28),
    userHp: hpLeft(userUnits),
    enemyHp: hpLeft(enemyUnits),
  };
}

function actingOrder(living, units, userFirst) {
  const lead = userFirst === false ? "enemy" : "user";
  return living.slice().sort((a, b) => b.cr - a.cr || effectiveSpeed(b, units) - effectiveSpeed(a, units) || (b.side === lead) - (a.side === lead));
}

function effectiveSpeed(unit, units) {
  let speed = unit.fixOwn ? unit.lockedSpeed : unit.baseSpeed;
  if (unit.passives.some((e) => e.kind === "fixOwnSpeed")) speed = unit.lockedSpeed;
  for (const other of units) {
    if (!other.alive || other.id === unit.id) continue;
    const cap = other.passives.find((e) => e.kind === "speedCap");
    if (cap) speed = Math.min(speed, other.lockedSpeed * cap.ratio);
  }
  return Math.max(1, speed);
}

function winnerOf(userUnits, enemyUnits) {
  if (enemyUnits.every((u) => !u.alive)) return "user";
  if (userUnits.every((u) => !u.alive)) return "enemy";
  return null;
}

const CAST_KINDS = new Set([
  "heal", "crPush", "crPushback", "dispelBuff", "dispelDebuff", "stun", "fear", "sleep",
  "silence", "provoke", "defDown", "atkDown", "unbuffable", "uncounterable", "extraTurn",
  "barrier", "skillNull", "cutBuffDuration",
]);

const BUFF_KINDS = new Set(["heal", "barrier", "skillNull", "extraTurn", "dispelDebuff", "crPush"]);
const DEBUFF_KINDS = new Set([
  "stun", "fear", "sleep", "silence", "provoke", "defDown", "atkDown",
  "unbuffable", "uncounterable", "crPushback", "dispelBuff", "cutBuffDuration",
]);

function effectHasNumber(effect) {
  if (typeof effect?.amount === "number" || typeof effect?.ratio === "number" || typeof effect?.turns === "number") return true;
  return /\d/.test(String(effect?.source || ""));
}

function effectBucket(effect) {
  if (!effect || effect.simulated === false || effect.kind === "unparsed" || !effectHasNumber(effect)) return "";
  if (effect.kind === "crPush") return String(effect.who || "").includes("enem") ? "debuff" : "buff";
  if (BUFF_KINDS.has(effect.kind)) return "buff";
  if (DEBUFF_KINDS.has(effect.kind)) return "debuff";
  return "";
}

export function splitSkill(skill) {
  if (!skill) return { damage: null, buffs: [], debuffs: [] };
  const scaling = (skill.selfHpScaling || 0) + (skill.selfAtkScaling || 0) + (skill.selfDefScaling || 0) + (skill.selfSpdScaling || 0);
  const listed = typeof skill.rate === "number" && typeof skill.pow === "number" && skill.rate > 0 && skill.pow > 0;
  const damage = listed || scaling > 0
    ? { rate: listed ? skill.rate : 0, pow: listed ? skill.pow : 0, targets: skill.targets || 1, scaling }
    : null;
  const buffs = [];
  const debuffs = [];
  for (const effect of skill.effects || []) {
    const bucket = effectBucket(effect);
    if (bucket === "buff") buffs.push(effect);
    else if (bucket === "debuff") debuffs.push(effect);
  }
  return { damage, buffs, debuffs };
}

function buffReceivers(skill, actor, allies) {
  const text = skill.text || "";
  const exceptCaster = /except for the caster|other than the caster/i.test(text);
  if (!exceptCaster && /to the caster/i.test(text)) return [actor];
  const who = (skill.effects || []).map((effect) => effect.who || "").join(" ");
  if (/\ballies\b/i.test(who) && !exceptCaster) return allies.slice();
  let pool = allies.filter((unit) => unit.id !== actor.id);
  if (!exceptCaster && /\bcaster\b/i.test(who) && !/\btarget\b/i.test(who)) pool = [actor];
  if (!pool.length) pool = allies.slice();
  pool.sort((left, right) => left.baseSpeed - right.baseSpeed || left.nameZh.localeCompare(right.nameZh, "zh"));
  return pool.slice(0, 1);
}

function canCast(skill) {
  if (!skill || skill.passive) return false;
  if ((skill.rate || 0) <= 0 && /^at the start/i.test(skill.text || "") && !skill.cooldown) return false;
  if ((skill.rate || 0) > 0) return true;
  return (skill.effects || []).some((effect) => effect.simulated !== false && CAST_KINDS.has(effect.kind));
}

function takeTurn(actor, units, plan, rand, log) {
  actor.cr = 0;
  for (const slot of ["S1", "S2", "S3"]) {
    if (actor.cdLeft[slot] > 0) actor.cdLeft[slot] -= 1;
  }
  if (!actor.alive) return;
  refreshEnemyArtifact(actor, units, rand, log, "start");
  if (actor.debuffs.some((d) => d.kind === "stun" || d.kind === "fear" || d.kind === "sleep")) {
    log.push(`${actor.nameZh} 無法行動。`);
    tickDebuffs(actor);
    return;
  }
  const forced = actor.debuffs.some((d) => d.kind === "provoke");
  const silenced = actor.debuffs.some((d) => d.kind === "silence");
  const order = forced ? ["S1"] : plan.order;
  let skill = null;
  for (const slot of order) {
    const candidate = actor.skills[slot];
    if (!candidate || candidate.passive) continue;
    if (actor.cdLeft[slot] > 0) continue;
    if (silenced && slot !== "S1") continue;
    if (!canCast(candidate)) continue;
    skill = candidate;
    break;
  }
  if (!skill) {
    log.push(`${actor.nameZh} 沒有可放的技能。`);
    tickDebuffs(actor);
    return;
  }
  const foes = units.filter((u) => u.alive && u.side !== actor.side);
  const allies = units.filter((u) => u.alive && u.side === actor.side);
  if (!foes.length) return;
  const crLocked = units.some((u) => u.passives.some((e) => e.kind === "crLockOnCasterTurn") && u.id === actor.id && actor.passives.some((e) => e.kind === "crLockOnCasterTurn"));
  const purse = units.find((u) => u.side === actor.side);
  if (!purse.purse) purse.purse = { value: 0 };
  const burnFx = (skill.soulburnEffects || []).filter((e) => e.kind !== "unparsed" && e.simulated !== false);
  const doBurn = plan.burn && skill.soulburnCost && purse.purse.value >= skill.soulburnCost && burnFx.length > 0;
  if (doBurn) purse.purse.value -= skill.soulburnCost;
  const skillParts = splitSkill(skill);
  const support = !skillParts.damage && (skillParts.buffs.length > 0 || skillParts.debuffs.length > 0);
  const targets = support && skillParts.buffs.length
    ? buffReceivers(skill, actor, allies)
    : pickTargets(foes, skill.targets || (skill.effects?.length ? foes.length : 1));
  if (!support && !targets.length) {
    log.push(`${actor.nameZh} 單目標打不到隱身的人。`);
    tickDebuffs(actor);
    refreshTurnStealth(actor, rand, log);
    refreshEnemyArtifact(actor, units, rand, log, "end", skill);
    refreshDef(actor);
    return;
  }
  const parts = [];
  for (const target of targets) {
    if (support) {
      applyEffects(skill, actor, target, allies, foes, units, doBurn, burnFx, crLocked, rand, log, true);
      parts.push(target.nameZh);
      continue;
    }
    const relation = elementRelation(actor.attribute, target.attribute);
    const glance = relation === "disadvantage" && rand() < 0.5;
    const cannotCrit = actor.passives.some((e) => e.kind === "cannotCrit") || (skill.effects || []).some((e) => e.kind === "cannotCrit");
    const alwaysCrit = (skill.effects || []).some((e) => e.kind === "alwaysCrit");
    let hitMult = 1;
    if (glance) hitMult = 0.75;
    else if (!cannotCrit && (alwaysCrit || rand() < Math.min(100, actor.crit) / 100)) hitMult = Math.min(3.5, actor.cd / 100);
    if (relation === "advantage") hitMult *= 1.1;
    let damage = skillDamage(actor, target, skill, hitMult);
    if (doBurn && actor.rule === "attack") damage *= 1.15;
    if (target.barrier > 0 && damage > 0) {
      const absorbed = Math.min(target.barrier, damage);
      target.barrier -= absorbed;
      damage -= absorbed;
    }
    if ((target.buffs || []).includes("skillNull") && damage > 0) {
      damage = 0;
      target.buffs = target.buffs.filter((b) => b !== "skillNull");
    }
    target.hp -= damage;
    if (target.hp <= 0) target.alive = false;
    if (!glance) applyEffects(skill, actor, target, allies, foes, units, doBurn, burnFx, crLocked, rand, log, false);
    parts.push(`${target.nameZh}${glance ? "擦傷" : ""}${Math.round(damage)}`);
  }
  if (skill.cooldown) actor.cdLeft[skill.slot] = skill.cooldown;
  else if (skill.slot !== "S1" && skill.cooldownShown == null) actor.cdLeft[skill.slot] = 99;
  const soulCut = foes.some((u) => u.alive && u.passives.some((e) => e.kind === "soulCut" && e.ratio >= 1));
  if (!soulCut) purse.purse.value += skill.soulGain || 0;
  const burnNote = doBurn ? `，燒魂 ${skill.soulburnCost}` : "";
  log.push(`${actor.nameZh} ${skill.name}${burnNote} → ${parts.join("、")}`);
  if ((skill.effects || []).some((e) => e.kind === "extraTurn")) {
    actor.cr = 100;
    log.push(`${actor.nameZh} 獲得再行動。`);
  }
  if (/all stats are doubled/i.test(skill.text || "") && !actor.statsDoubled) {
    actor.statsDoubled = true;
    actor.atk *= 2;
    actor.def *= 2;
    actor.baseDef *= 2;
    actor.maxHp *= 2;
    actor.hp = Math.min(actor.maxHp, actor.hp * 2);
    actor.baseSpeed *= 2;
    actor.speed *= 2;
    actor.lockedSpeed *= 2;
    log.push(`${actor.nameZh} 全能力值變 2 倍（技能原文）。`);
  }
  tickDebuffs(actor);
  refreshTurnStealth(actor, rand, log);
  refreshEnemyArtifact(actor, units, rand, log, "end", skill);
  refreshDef(actor);
}

function pickTargets(foes, count) {
  const aoe = count >= foes.length;
  const pool = aoe ? foes.slice() : foes.filter((unit) => !(unit.buffs || []).includes("stealth"));
  if (!pool.length) return [];
  const sorted = pool.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
  if (aoe || count >= pool.length) return sorted;
  return sorted.slice(0, Math.max(1, count));
}

function applyEffects(skill, actor, target, allies, foes, units, doBurn, burnFx, crLocked, rand, log, support = false) {
  const ignoreRes = doBurn && burnFx.some((e) => e.kind === "ignoreResistance");
  const forcedChance = doBurn ? burnFx.find((e) => e.kind === "effectChance") : null;
  for (const effect of skill.effects || []) {
    if (effect.simulated === false) continue;
    if (effect.kind === "heal") {
      const scaling = (skill.options || []).find((o) => o.selfHpScaling)?.selfHpScaling;
      if (effect.full) {
        for (const ally of allies) ally.hp = ally.maxHp;
      } else if (scaling) {
        const gain = actor.hp * scaling * (actor.rule === "defense" ? 1.3 : 1) * (1 + (skill.enhanceHealingApplied || 0));
        for (const ally of allies) ally.hp = Math.min(ally.maxHp, ally.hp + gain);
      }
    } else if (effect.kind === "crPush" && !crLocked) {
      const amount = effect.amount || 0;
      const who = effect.who || "";
      let receivers = [actor];
      if (who.includes("allies")) receivers = allies;
      else if (who.includes("enem")) receivers = [target];
      else if (support && (who.includes("target") || who === "")) receivers = [target];
      for (const unit of receivers) {
        if (unit.passives?.some((e) => e.kind === "crImmune")) continue;
        unit.cr = Math.min(100, unit.cr + amount);
      }
    } else if (effect.kind === "crPushback") {
      const amount = effect.amount != null
        ? effect.amount
        : effect.amountMin + rand() * ((effect.amountMax || effect.amountMin) - effect.amountMin);
      const group = effect.who === "all enemies" ? foes : [target];
      for (const unit of group) {
        if (unit.passives.some((e) => e.kind === "crImmune")) continue;
        unit.cr = Math.max(0, unit.cr - amount);
      }
    } else if (effect.kind === "dispelBuff") {
      target.buffs = [];
      target.barrier = 0;
    } else if (["stun", "fear", "sleep", "silence", "provoke", "defDown", "atkDown", "unbuffable", "uncounterable"].includes(effect.kind)) {
      let chance = forcedChance ? forcedChance.chance : (effect.chance ?? 1);
      chance = Math.min(1, chance + (skill.enhanceEffectPctApplied || 0));
      if (rand() > chance) continue;
      if (!ignoreRes) {
        const resist = Math.min(100, Math.max(15, target.res - actor.eff)) / 100;
        if (rand() < resist) continue;
      }
      const turns = effect.turns || (doBurn ? burnFx.find((e) => e.kind === "defDownTurns")?.turns : null) || 1;
      target.debuffs.push({ kind: effect.kind, turns, value: effect.value || 0 });
    }
    refreshDef(target);
  }
}

function refreshDef(unit) {
  const down = (unit.debuffs || []).find((d) => d.kind === "defDown" && d.value);
  unit.def = down ? unit.baseDef * (1 - down.value) : unit.baseDef;
}

function tickDebuffs(actor) {
  actor.debuffs = (actor.debuffs || []).filter((d) => {
    d.turns -= 1;
    return d.turns > 0;
  });
  if (actor.stealthTurns > 0) {
    actor.stealthTurns -= 1;
    if (actor.stealthTurns <= 0) actor.buffs = (actor.buffs || []).filter((buff) => buff !== "stealth");
  }
}

export function sourceBasis(catalog) {
  const provenance = catalog?.provenance || {};
  const problems = [];
  if (!provenance.fribbelsCommit) problems.push("沒有 Fribbels 英雄資料庫的版本");
  if (!provenance.gamePatchAssumed) problems.push("沒有標示遊戲版本");
  if (!provenance.rtaSeason || !provenance.rtaSeasonLabel) problems.push("沒有賽季");
  const database = catalog?.database || [];
  if (database.length < 100) problems.push(`英雄資料庫只有 ${database.length} 名`);
  const codes = new Set(database.map((row) => row.code));
  const heroes = catalog?.heroes || [];
  if (heroes.length < 10) problems.push("賽季核心不足，建議無效");
  for (const hero of heroes) {
    if (!codes.has(hero.code)) problems.push(`${hero.nameZh || hero.code} 不在英雄資料庫`);
    for (const slot of ["S1", "S2", "S3"]) {
      const skill = hero.skills?.[slot];
      if (!skill || typeof skill.rate !== "number" || typeof skill.pow !== "number") {
        problems.push(`${hero.nameZh || hero.code} 的 ${slot} 沒有 Fribbels 倍率`);
      }
    }
    if (typeof hero.rtaPresence?.prebans !== "number") problems.push(`${hero.nameZh} 沒有賽季預禁數`);
    if (!hero.rtaGear?.setCombos?.length) problems.push(`${hero.nameZh} 沒有賽季套裝`);
    if (typeof hero.reference?.median?.speed !== "number" && typeof hero.base?.speed !== "number") {
      problems.push(`${hero.nameZh} 沒有可用的速度`);
    }
  }
  if (!catalog?.artifactNames || !Object.keys(catalog.artifactNames).length) problems.push("沒有神器資料");
  return {
    ok: problems.length === 0,
    problems,
    version: versionOf(catalog),
  };
}

export function versionOf(catalog) {
  const provenance = catalog?.provenance || {};
  return {
    fetchedOn: provenance.fetchedOn || null,
    fribbelsCommit: provenance.fribbelsCommit || null,
    fribbelsCommitDate: provenance.fribbelsCommitDate || null,
    patch: provenance.gamePatchAssumed || null,
    patchZh: provenance.gamePatchAssumedZh || provenance.gamePatchAssumed || null,
    season: provenance.rtaSeason || null,
    seasonLabel: provenance.rtaSeasonLabel || null,
    heroCount: catalog?.database?.length || 0,
    metaCount: catalog?.heroes?.length || 0,
    artifactCount: catalog?.artifactNames ? Object.keys(catalog.artifactNames).length : 0,
  };
}

function metaRoster(catalog) {
  return {
    label: "賽季參考面板",
    warning: "沙盤對手用 Fribbels Hero Library 的中位數；沒有中位數時用資料庫裡的滿覺醒基礎值，不另編數字。",
    heroes: catalog.heroes.map((hero) => {
      const median = hero.reference?.median;
      const stats = median || hero.base;
      const combo = hero.rtaGear?.setCombos?.[0];
      const artifact = hero.rtaGear?.artifacts?.[0]?.names?.[0] || null;
      return {
        name: hero.name,
        speed: stats.speed,
        attack: stats.attack,
        hp: stats.hp,
        defense: stats.defense,
        crit: stats.crit,
        critDamage: stats.critDamage,
        effectiveness: stats.effectiveness,
        effectResistance: stats.effectResistance,
        artifact,
        sets: combo?.names || [],
        sample: !median,
      };
    }),
  };
}

function invalid(catalog, title, reason) {
  const summary = reason || title;
  return {
    ok: false,
    reason: { summary, lines: [summary] },
    action: { kind: "blocked", title, detail: summary, burn: null },
    rate: null,
    version: versionOf(catalog),
    basis: sourceBasis(catalog),
  };
}


function presenceOf(catalog, id) {
  const season = (catalog.seasonHeroes || []).find((hero) => hero.id === id);
  if (season?.rtaPresence) return season.rtaPresence;
  return (catalog.heroes || []).find((hero) => hero.id === id)?.rtaPresence || null;
}

function gamesOf(presence) {
  if (!presence) return 0;
  if (typeof presence.games === "number") return presence.games;
  return (presence.wins || 0) + (presence.losses || 0);
}

function takeIds(list, count, skip) {
  const picked = [];
  for (const hero of list) {
    const id = hero.id || hero;
    if (skip.has(id) || picked.includes(id)) continue;
    picked.push(id);
    if (picked.length === count) break;
  }
  return picked;
}

function onePlan(side, id, label, preSource, pickSource, why) {
  const picks = takeIds(pickSource, 5, new Set());
  const prebans = takeIds(preSource, 2, new Set(picks));
  return { id, side, label, prebans, picks, why };
}

function codeIndex(catalog) {
  const index = new Map();
  for (const hero of [...(catalog.seasonHeroes || []), ...(catalog.heroes || [])]) {
    if (hero?.code && hero.id && !index.has(hero.code)) index.set(hero.code, hero.id);
  }
  return index;
}

function picksFromSlots(slots, ownedIds, codes) {
  const picks = [];
  const take = (row) => {
    const id = codes.get(row?.code);
    if (!id || !ownedIds.has(id) || picks.includes(id)) return false;
    picks.push(id);
    return true;
  };
  for (const slot of slots) {
    for (const row of slot || []) {
      if (take(row)) break;
    }
  }
  for (const slot of slots) {
    for (const row of slot || []) {
      if (picks.length === 5) return picks;
      take(row);
    }
  }
  return picks;
}

function prebansFromPairs(pairs, picks, codes) {
  for (const pair of pairs || []) {
    const ids = [];
    for (const code of pair.codes || []) {
      const id = codes.get(code);
      if (id && !ids.includes(id)) ids.push(id);
    }
    if (ids.length < 2) continue;
    if (ids.some((id) => picks.includes(id))) continue;
    return ids.slice(0, 2);
  }
  return [];
}

function commonPlan(catalog, side, ownedIds, byGames) {
  const comps = catalog.seasonComps;
  if (!comps?.prebanPairs || !comps.firstPick || !comps.secondPick) return null;
  const codes = codeIndex(catalog);
  const slots = side === "first"
    ? [comps.firstPick["1"], comps.firstPick["2"], comps.firstPick["3"], comps.firstPick["4+5"]]
    : [comps.secondPick["1+2"], comps.secondPick["3"], comps.secondPick["4"], comps.secondPick["5"]];
  const picks = picksFromSlots(slots, ownedIds, codes);
  for (const hero of byGames) {
    if (picks.length === 5) break;
    if (!picks.includes(hero.id)) picks.push(hero.id);
  }
  let prebans = prebansFromPairs(comps.prebanPairs, picks, codes);
  if (prebans.length < 2) {
    const pool = (catalog.seasonHeroes || []).filter((hero) => hero.rtaPresence);
    prebans = takeIds([...pool].sort((left, right) => (right.rtaPresence.prebans || 0) - (left.rtaPresence.prebans || 0)), 2, new Set(picks));
  }
  const label = side === "first" ? "先手常見組合" : "後手常見組合";
  const why = side === "first"
    ? "預禁用本季最常一起被預禁、而且不是這套要選的組合。選角按本季先手各手的常見人選，從你帳號裡依序取。"
    : "預禁用本季最常一起被預禁、而且不是這套要選的組合。選角按本季後手各手的常見人選，從你帳號裡依序取。";
  return { id: side === "first" ? "first-common" : "second-common", side, label, prebans, picks: picks.slice(0, 5), why };
}

function ownedIdsOf(roster) {
  const ids = new Set();
  for (const hero of roster?.heroes || []) {
    ids.add(hero.id);
    ids.add(canonicalId(hero.id));
    const person = personOf(hero.id);
    if (!person) continue;
    ids.add(person.id);
    for (const also of person.also || []) ids.add(also);
  }
  return ids;
}

function fightRoster(roster, catalog) {
  const modelIds = new Set((catalog.heroes || []).map((hero) => hero.id));
  const heroes = (roster?.heroes || []).map((hero) => ({ ...hero }));
  const byId = new Map(heroes.map((hero) => [hero.id, hero]));
  for (const person of heroLinks.people) {
    if (!modelIds.has(person.id) || byId.has(person.id)) continue;
    const twin = (person.also || []).map((id) => byId.get(id)).find(Boolean);
    if (!twin) continue;
    const copy = { ...twin, id: person.id };
    heroes.push(copy);
    byId.set(person.id, copy);
  }
  return { ...roster, heroes };
}

const SANDBOX_WHY = "選角用沙盤，你的面板對上推估的對手。不用場次當推薦名單。預禁用本季預禁數最高、而且不是這套要選的人。";

function prebanIds(catalog, avoid, count) {
  const pool = (catalog.seasonHeroes || []).filter((hero) => hero.rtaPresence);
  const source = pool.length ? pool : (catalog.heroes || []);
  const ids = [];
  const ranked = [...source].sort((left, right) => (right.rtaPresence?.prebans || 0) - (left.rtaPresence?.prebans || 0));
  for (const hero of ranked) {
    const id = canonicalId(hero.id);
    if (avoid.has(id) || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length === count) break;
  }
  return ids;
}

function draftHero(catalog, id) {
  if (!id) return null;
  return fightRecord(catalog, id) || fightRecord(catalog, canonicalId(id));
}

function heroProfile(hero) {
  if (!hero) return null;
  const skills = ["S1", "S2", "S3"].map((slot) => splitSkill(hero.skills?.[slot]));
  const speed = hero.reference?.median?.speed ?? hero.base?.speed ?? 0;
  return {
    id: hero.id,
    speed: typeof speed === "number" ? speed : 0,
    damage: skills.some((skill) => skill.damage),
    buff: skills.some((skill) => !skill.damage && skill.buffs.length > 0),
    debuff: skills.some((skill) => skill.debuffs.length > 0),
  };
}

function chancePct(chance) {
  return `${Math.round(chance * 100)}%`;
}

function focusHp(hpById, ids) {
  const rows = (ids || []).map((id) => hpById?.[id]).filter((value) => typeof value === "number");
  if (!rows.length) return 0;
  return rows.reduce((sum, value) => sum + value, 0) / rows.length;
}

function survivalChance(catalog, roster, userIds, enemyIds, userFirst, focusIds) {
  const ours = (userIds || []).filter((id) => draftHero(catalog, id));
  const theirs = (enemyIds || []).filter((id) => draftHero(catalog, id));
  if (!ours.length || !theirs.length) return null;
  const focus = (focusIds || ours).filter((id) => ours.includes(id));
  let chance = 0;
  let hp = 0;
  const trials = 4;
  for (let trial = 0; trial < trials; trial += 1) {
    const wave = ultWave(catalog, roster, ours, theirs, userFirst, mulberry32(trial + 1));
    const ratios = focus.map((id) => wave.hpById[id] ?? 0);
    chance += ratios.filter((value) => value > 0).length / (ratios.length || 1);
    hp += focusHp(wave.hpById, focus);
  }
  return { chance: chance / trials, hp: hp / trials };
}

function formNames(text) {
  const names = [];
  for (const match of String(text || "").matchAll(/\(([^)]{1,24})\)/g)) {
    const name = match[1].trim();
    if (!name || /\d/.test(name)) continue;
    if (!names.includes(name)) names.push(name);
  }
  return names.slice(0, 2);
}

function stealthGrants(skills) {
  const grants = [];
  for (const slot of ["S1", "S2", "S3"]) {
    const text = skills?.[slot]?.text || "";
    for (const sentence of text.split(/(?<=\.)\s+/)) {
      if (!/grant(?:s|ed)?(?: \w+){0,6} stealth|be granted stealth/i.test(sentence)) continue;
      const atBattleStart = /at the start of (?:the first )?battle/i.test(sentence);
      const atTurnEnd = /at the end of the turn/i.test(sentence);
      if (!atBattleStart && !atTurnEnd) continue;
      const chanceMatch = sentence.match(/(\d+(?:\.\d+)?)%\s+chance/i);
      const turnsMatch = sentence.match(/for (\d+) turn/i);
      if (!turnsMatch) continue;
      grants.push({
        slot,
        chance: chanceMatch ? Number(chanceMatch[1]) / 100 : null,
        turns: Number(turnsMatch[1]),
        atBattleStart,
        atTurnEnd,
      });
    }
  }
  return grants;
}

function resourceCuts(skills) {
  const lines = [];
  for (const skill of Object.values(skills || {})) {
    const match = `${skill?.text || ""}`.match(/Decreases the amount of resources gained by the enemy by (\d+)%/i);
    if (match && !lines.includes(`敵方獲得的資源減少 ${match[1]}%`)) lines.push(`敵方獲得的資源減少 ${match[1]}%`);
  }
  return lines;
}

function opensOnFullCooldown(hero) {
  const skill = hero?.skills?.S3;
  if (!skill || typeof skill.cooldownShown !== "number") return null;
  if (!/begins the first battle with (?:a )?full (?:skill )?cooldown count/i.test(`${skill.text || ""} ${skill.textBeforeAwaken || ""}`)) return null;
  return Math.max(0, skill.cooldownShown - (writtenEnhance(hero, "S3").cooldown || 0));
}

function grantStealth(unit, turns, log, why) {
  if (!unit.buffs) unit.buffs = [];
  if (!unit.buffs.includes("stealth")) unit.buffs.push("stealth");
  unit.stealthTurns = Math.max(unit.stealthTurns || 0, turns);
  log.push(`${unit.nameZh} 隱身 ${turns} 回合（${why}）。`);
}

const ARTIFACT_MAX = {
  "Guiding Light": {
    openStealth: 1,
    endStealth: { chance: 0.7, turns: 2, every: 2 },
    advice: "對方沒有神器等級，沙盤用技能頁寫出的最大：回合結束 70% 隱身 2 回合，每 2 回合最多一次。",
  },
  "Aubade Orb": {
    openSouls: 10,
    endSouls: { chance: 1, amount: 5, max: 3 },
    advice: "對方沒有神器等級，沙盤用技能頁寫出的最大：開場 10 魂，回合結束 100% 再獲得 5 魂，最多 3 次。",
  },
  "Unseen Observer": {
    afterNonAttack: { cr: 20, souls: 10 },
    advice: "對方沒有神器等級，沙盤用技能頁寫出的最大：放非攻擊技能後拉條 20%，並獲得 10 魂，魂只拿一次。",
  },
  "Wall of Order": {
    perBuffChance: 0.12,
    endStealth: { chance: 1, turns: 1, every: 1 },
    advice: "對方沒有神器等級，沙盤用技能頁寫出的最大：每個敵方強化 12% 給較大強攻 1 回合，回合結束 100% 隱身 1 回合。技能頁沒有寫強攻增加多少攻擊，不改攻擊力。",
  },
};

function artifactEnglish(catalog, label) {
  if (!label) return "";
  const found = Object.values(catalog?.artifactNames || {}).find((art) => art.name === label || art.nameZh === label);
  return found?.name || "";
}

function artifactPool(catalog, hero) {
  const listed = (hero?.rtaGear?.artifacts || []).filter((art) => art?.names?.[0] && typeof art.pickRate === "number");
  if (listed.length) {
    return listed.map((art) => ({ name: art.names[0], rate: art.pickRate / 100, zh: artifactZh(catalog, art.names[0]) }));
  }
  const builds = e7Record(hero?.code)?.建造 || [];
  return builds.filter((build) => typeof build.使用率 === "number").map((build) => ({
    name: artifactEnglish(catalog, build.神器),
    rate: build.使用率,
    zh: shownZh(build.神器 || "", "無神器"),
  })).filter((row) => row.name);
}

function addSouls(unit, units, amount, log, why) {
  const purse = (units || []).find((row) => row.side === unit.side) || unit;
  if (!purse.purse) purse.purse = { value: 0 };
  purse.purse.value += amount;
  log.push(`${unit.nameZh} ${why}，獲得 ${amount} 魂。`);
}

function rollEnemyArtifact(unit, units, rand, log) {
  if (unit.side !== "enemy" || unit.wornArtifact !== undefined) return;
  let roll = rand();
  let chosen = null;
  for (const row of unit.artifactPool || []) {
    roll -= row.rate;
    if (roll < 0) {
      chosen = row;
      break;
    }
  }
  unit.wornArtifact = chosen?.name || "";
  const spec = ARTIFACT_MAX[unit.wornArtifact];
  if (!spec) return;
  const why = `${chosen.zh} 最大強化`;
  if (spec.openStealth) grantStealth(unit, spec.openStealth, log, why);
  if (spec.openSouls) addSouls(unit, units, spec.openSouls, log, why);
}

function refreshEnemyArtifact(actor, units, rand, log, when, skill) {
  const spec = ARTIFACT_MAX[actor.wornArtifact];
  if (!spec || actor.side !== "enemy") return;
  const zh = (actor.artifactPool || []).find((row) => row.name === actor.wornArtifact)?.zh || "神器";
  if (when === "start" && spec.perBuffChance) {
    const buffs = units.filter((unit) => unit.alive && unit.side !== actor.side).reduce((sum, unit) => sum + (unit.buffs || []).length, 0);
    for (let index = 0; index < buffs; index += 1) {
      if (rand() < spec.perBuffChance) {
        log.push(`${actor.nameZh} ${zh} 最大強化：12% 給較大強攻 1 回合。技能頁沒有寫攻擊增加多少，不改攻擊力。`);
        break;
      }
    }
  }
  if (when === "end" && spec.afterNonAttack && skill && !splitSkill(skill).damage) {
    actor.cr = Math.min(100, actor.cr + spec.afterNonAttack.cr);
    log.push(`${actor.nameZh} ${zh} 最大強化，戰鬥準備度 +${spec.afterNonAttack.cr}。`);
    if (!actor.artifactSoulOnce) {
      actor.artifactSoulOnce = true;
      addSouls(actor, units, spec.afterNonAttack.souls, log, `${zh} 最大強化`);
    }
  }
  if (when === "end" && spec.endStealth) {
    const every = spec.endStealth.every || 1;
    if (actor.artifactStealthAt == null) actor.artifactStealthAt = -every;
    actor.artifactTurns = (actor.artifactTurns || 0) + 1;
    if (actor.artifactTurns - actor.artifactStealthAt >= every && rand() < spec.endStealth.chance) {
      actor.artifactStealthAt = actor.artifactTurns;
      grantStealth(actor, spec.endStealth.turns, log, `${zh} 最大強化`);
    }
  }
  if (when === "end" && spec.endSouls && (actor.artifactSoulProcs || 0) < spec.endSouls.max && rand() < spec.endSouls.chance) {
    actor.artifactSoulProcs = (actor.artifactSoulProcs || 0) + 1;
    addSouls(actor, units, spec.endSouls.amount, log, `${zh} 最大強化`);
  }
}

function applyBattleStart(units, rand, log) {
  for (const unit of units) rollEnemyArtifact(unit, units, rand, log);
  for (const unit of units) {
    for (const grant of stealthGrants(unit.skills)) {
      if (!grant.atBattleStart) continue;
      const chance = grant.chance == null ? 1 : grant.chance;
      if (rand() < chance) grantStealth(unit, grant.turns, log, "技能原文");
    }
    if (typeof unit.guidingLightRate === "number" && rand() < unit.guidingLightRate) {
      grantStealth(unit, 1, log, `引導之光出場 ${Math.round(unit.guidingLightRate * 1000) / 10}%`);
    }
  }
}

function refreshTurnStealth(actor, rand, log) {
  for (const grant of stealthGrants(actor.skills)) {
    if (!grant.atTurnEnd) continue;
    const chance = grant.chance == null ? 1 : grant.chance;
    if (rand() < chance) grantStealth(actor, grant.turns, log, "技能原文");
  }
}

const ARTIFACT_NOTES = {
  "Guiding Light": {
    effect: "開場賦予隱身 1 回合。回合結束再隱身，技能頁未滿是 35%、最大是 70%，都是 2 回合，每 2 回合最多一次。",
    answer: "應對：穿上時開場有隱身，單目標打不到，全體攻擊打得到。",
  },
  "Aubade Orb": {
    effect: "開場獲得 10 魂。回合結束再獲得 5 魂，技能頁未滿是 50%、最大是 100%，最多 3 次。",
    answer: "應對：魂比沒穿時多，燒魂仍看當下魂量。",
  },
  "Unseen Observer": {
    effect: "放非攻擊技能後拉條，技能頁未滿是 10%、最大是 20%，並獲得 10 魂，魂只拿一次。",
    answer: "應對：他放非攻擊技之後會拉條。",
  },
  "Wall of Order": {
    effect: "回合結束隱身，技能頁未滿是 50%、最大是 100%，1 回合。回合開始每個敵方強化有機率給較大強攻，未滿是 6%、最大是 12%。這件不是開場隱身。",
    answer: "應對：開場單目標仍打得到，隱身要等回合結束。",
  },
};

function pagePercent(value, digits = 1) {
  if (typeof value !== "number") return "";
  const scale = 10 ** digits;
  return `${Math.round(value * 100 * scale) / scale}%`;
}

function e7Record(code) {
  return e7Rta.英雄?.[code] || null;
}

export function rtaSummary(hero) {
  const row = e7Record(hero?.code);
  if (!row?.有頁) return "沒有世界競技場頁";
  return `勝率 ${pagePercent(row.勝率)}　選擇 ${pagePercent(row.選擇率)}　禁令前 ${pagePercent(row.禁令前)}　場次 ${row.場次 ?? "頁上沒有"}`;
}

function nameByCode(catalog, code) {
  const pools = [catalog?.database || [], catalog?.heroes || [], catalog?.seasonHeroes || []];
  for (const pool of pools) {
    const hero = pool.find((row) => row.code === code);
    if (hero?.nameZh) return hero.nameZh;
  }
  return "沒有中文名";
}

function e7BuildBits(hero) {
  const row = e7Record(hero?.code);
  if (!row?.有頁 || !row.建造?.length) return [];
  return row.建造.map((build) => {
    const sets = (build.套裝 || []).filter(Boolean).join("、") || "頁上沒有套裝";
    const used = typeof build.使用率 === "number" ? `${Math.round(build.使用率 * 100)}%` : "頁上沒有使用率";
    const win = typeof build.勝率 === "number" ? `，勝率 ${pagePercent(build.勝率)}` : "，頁上沒有勝率";
    return `套裝 ${sets}，神器 ${shownZh(build.神器 || "無神器", "無神器")}，使用率 ${used}${win}`;
  });
}

function rtaDetailLines(catalog, hero) {
  const row = e7Record(hero?.code);
  if (!row?.有頁) return ["世界競技場頁：沒有這一頁，不另編。"];
  const lines = [`世界競技場頁，${e7Rta.賽季}，勝率區間 ${e7Rta.勝率區間}：梯隊 ${row.梯隊}，勝率 ${pagePercent(row.勝率)}，選擇率 ${pagePercent(row.選擇率)}，禁令前 ${pagePercent(row.禁令前)}，禁令後 ${pagePercent(row.禁令後)}，場次 ${row.場次 ?? "頁上沒有"}。`];
  lines.push(row.速度
    ? `速度分位：25 ${row.速度["25"]}、50 ${row.速度["50"]}、75 ${row.速度["75"]}、90 ${row.速度["90"]}。`
    : "速度分位：頁上沒有。");
  if (row.能力值) {
    const bits = Object.entries(row.能力值).map(([name, stat]) => `${name} ${stat.範圍}，高峰 ${stat.高峰占比}%`);
    lines.push(`能力值：${bits.join("；")}。`);
  } else {
    lines.push("能力值分布：頁上沒有。");
  }
  const named = (rows, label, field = "分數") => {
    if (!rows?.length) return `${label}：頁上沒有。`;
    return `${label}：${rows.slice(0, 5).map((item) => `${nameByCode(catalog, item.代碼)} ${typeof item[field] === "number" ? item[field] : "頁上沒有分數"}`).join("、")}。`;
  };
  lines.push(named(row.克制, "克制"));
  lines.push(named(row.被克制, "被克制"));
  lines.push(named(row.協同, "協同"));
  lines.push(named((row.最相似 || []).map((item) => ({ 代碼: item.代碼, 分數: item.相似度 })), "最相似"));
  lines.push(row.配對分析?.有預設表
    ? "配對分析：頁上有預設表。"
    : "配對分析：頁上要另外指定對手才有數字，沒有預設表，不另編。");
  return lines;
}

function artifactLines(catalog, hero) {
  if (hero?.role !== "ranger") return [];
  const arts = hero?.rtaGear?.artifacts || [];
  if (!arts.length) return ["弓系沒有公開的神器出場率，不把引導之光算成已穿上。"];
  return arts.filter((art) => art?.names?.[0] && typeof art.pickRate === "number").map((art) => {
    const name = art.names[0];
    const note = ARTIFACT_NOTES[name];
    const title = `神器 ${artifactZh(catalog, name)}，出場 ${art.pickRate}%`;
    if (!note) return `${title}。沒有收進這件的效果文字，不另編效果。`;
    return `${title}。${note.effect}${ARTIFACT_MAX[name]?.advice || ""}${note.answer}`.replace(/。+$/, "");
  });
}

function openingLine(catalog, hero) {
  const gear = hero?.rtaGear;
  const combo = gear?.setCombos?.[0];
  const bits = [];
  const cooldown = opensOnFullCooldown(hero);
  if (cooldown != null) bits.push(`大招冷卻 ${cooldown} 回合，公開文字寫開場冷卻到最大，預設對方穿開戰套`);
  for (const grant of stealthGrants(hero?.skills).filter((row) => row.atBattleStart)) {
    const chance = grant.chance == null ? "技能原文沒有另寫機率，依原文給隱身" : `${Math.round(grant.chance * 1000) / 10}% 機率隱身`;
    bits.push(`開場 ${chance} ${grant.turns} 回合。公開資料沒有另給隱身機率，這段用技能頁`);
  }
  if (combo?.names?.length && typeof combo.pickRate === "number") {
    bits.push(`公開套裝 ${combo.names.map((name) => setZh(name)).join("、")}，出場 ${combo.pickRate}%`);
  }
  const pageBuilds = e7BuildBits(hero);
  const arts = artifactLines(catalog, hero).filter((line) => !(pageBuilds.length && line.includes("沒有公開的神器出場率")));
  bits.push(...arts);
  if (pageBuilds.length) {
    bits.push(`建造來自世界競技場頁。頁上沒有印神器效果，不另編。${pageBuilds.join("。")}`);
    if (!(hero?.rtaGear?.artifacts || []).length) {
      const seen = new Set();
      for (const build of e7Record(hero?.code)?.建造 || []) {
        const english = artifactEnglish(catalog, build.神器);
        if (!english || seen.has(english) || !ARTIFACT_MAX[english]) continue;
        seen.add(english);
        bits.push(ARTIFACT_MAX[english].advice);
      }
    }
  }
  if (!bits.length) return "開戰常見做法：沒有公開的開戰配裝。";
  return `開戰常見做法：${bits.join("。")}。`;
}

function whoZh(raw) {
  const key = String(raw || "").trim().toLowerCase();
  if (!key) return "";
  if (key.includes("dark elemental")) return "暗屬隊友";
  if (key.includes("except")) return "除自己以外的全體隊友";
  if (key.includes("all allies")) return "全體隊友";
  if (key.includes("all enemies")) return "全體敵人";
  if (key.includes("caster")) return "自己";
  if (key.includes("front")) return "前排";
  if (key.includes("enemy")) return "敵人";
  if (/[A-Za-z]/.test(String(raw || ""))) return "這個對象";
  return String(raw || "").trim();
}

function addBit(bits, line) {
  const text = String(line || "").trim();
  if (text && !bits.includes(text)) bits.push(text);
}

function raisedChance(written, value) {
  const extra = Math.round((written?.chance || 0) * 100);
  const base = Number(value);
  if (!extra || !Number.isFinite(base)) return String(value);
  return String(Math.min(100, base + extra));
}

function raisedTurns(written, value) {
  const extra = written?.duration || 0;
  const base = Number(value);
  if (!extra || !Number.isFinite(base)) return String(value);
  return String(base + extra);
}

function clausesFrom(skill, written = {}) {
  const text = `${skill?.text || ""}`;
  const bits = [];
  if (!text.trim()) return bits;
  const souls = (skill.soulGain || 0) + (written.soul || 0);
  if (souls > 0) addBit(bits, written.soul ? `獲得 ${souls} 點靈魂，未強化 ${skill.soulGain || 0}，強化增加 ${written.soul}` : `獲得 ${souls} 點靈魂`);
  const stun = text.match(/(\d+(?:\.\d+)?)% chance to stun(?: for (\d+) turns?)?/i);
  if (stun) addBit(bits, `${raisedChance(written, stun[1])}% 暈眩${stun[2] ? ` ${raisedTurns(written, stun[2])} 回合` : ""}`);
  const provoke = text.match(/(\d+(?:\.\d+)?)% chance to provoke(?: for (\d+) turns?)?/i);
  if (provoke) addBit(bits, `${raisedChance(written, provoke[1])}% 挑釁${provoke[2] ? ` ${raisedTurns(written, provoke[2])} 回合` : ""}`);
  const defDown = text.match(/(\d+(?:\.\d+)?)% chance to decrease Defense for (\d+) turns?/i);
  if (defDown) addBit(bits, `${raisedChance(written, defDown[1])}% 降低防禦 ${raisedTurns(written, defDown[2])} 回合`);
  const atkDown = text.match(/(\d+(?:\.\d+)?)% chance to decrease Attack for (\d+) turns?/i);
  if (atkDown) addBit(bits, `${raisedChance(written, atkDown[1])}% 降低攻擊 ${raisedTurns(written, atkDown[2])} 回合`);
  if (/all stats are doubled/i.test(text)) addBit(bits, "全能力值變 2 倍");
  const field = text.match(/changes the battlefield into the ([^.]+)/i);
  if (field) addBit(bits, /[A-Za-z]/.test(field[1]) ? "戰場改變" : `戰場變成 ${field[1].trim()}`);
  if (/when it is not the caster's turn/i.test(text) && /all enemies/i.test(text)) addBit(bits, "不是自己的回合時改為全體攻擊");
  if (/proportional to the caster's Defense/i.test(text)) addBit(bits, "依自己防禦力等比增加");
  if (/proportional to the caster's max Health/i.test(text)) addBit(bits, "依自己最大生命等比增加");
  if (/proportional to the caster's Attack/i.test(text)) addBit(bits, "依自己攻擊力等比增加");
  if (/proportional to the caster's Speed/i.test(text)) addBit(bits, "依自己速度等比增加");
  if (/Grants an extra turn/i.test(text)) addBit(bits, "再行動一次");
  const evasion = text.match(/Increases Evasion by (\d+(?:\.\d+)?)%/i);
  if (evasion) addBit(bits, `閃避增加 ${evasion[1]}%`);
  const attack = text.match(/increases Attack by (\d+(?:\.\d+)?)%(?:, and can stack up to (\d+) times)?/i);
  if (attack) addBit(bits, attack[2] ? `攻擊增加 ${attack[1]}%，最多 ${attack[2]} 層` : `攻擊增加 ${attack[1]}%`);
  const readiness = text.match(/(increas(?:es|ing)|decreas(?:es|ing)) Combat Readiness of (all allies|all enemies|the caster|the enemy) by (\d+(?:\.\d+)?)%/i);
  if (readiness) {
    const sign = /decreas/i.test(readiness[1]) ? "-" : "+";
    const base = Number(readiness[3]);
    const extra = Math.round((written.readiness || 0) * 100);
    const shown = extra ? base + extra : base;
    const note = extra ? `，未強化 ${base}%，強化增加 ${extra}%` : "";
    let when = "";
    if (/at the start of the turn/i.test(text)) when = "回合開始";
    if (/at the end of the turn/i.test(text)) when = when ? `${when}、回合結束` : "回合結束";
    addBit(bits, `${when}${whoZh(readiness[2])}戰鬥準備度 ${sign}${shown}%${note}`);
  }
  const dispel = text.match(/Dispels (one|two|three|\d+) debuffs? from (all allies|all enemies|the caster)/i);
  if (dispel) {
    const count = { one: "1", two: "2", three: "3" }[dispel[1].toLowerCase()] || dispel[1];
    addBit(bits, `解除${whoZh(dispel[2])} ${count} 個弱化`);
  }
  const granting = text.match(/granting ([a-z][a-z ]+?) to ([a-z][a-z ]+?) for (\d+) turns/i);
  if (granting) {
    const buffs = {
      rampage: "狂暴", stealth: "隱身", barrier: "防護罩", vigor: "氣勢", immunity: "免疫",
      shield: "防護罩", counterattack: "反擊", "skill nullifier": "技能傷害無效",
    };
    const name = buffs[granting[1].trim().toLowerCase()] || "沒有收進中文對照的強化";
    addBit(bits, `${whoZh(granting[2])} ${name} ${raisedTurns(written, granting[3])} 回合`);
  }
  if (/swift attack/i.test(text) && /except for the caster/i.test(text)) addBit(bits, "除自己以外的全體隊友迅擊");
  const resources = text.match(/resources gained by the enemy by (\d+)%/i);
  if (resources) addBit(bits, `敵方獲得的資源減少 ${resources[1]}%`);
  const stealth = text.match(/(\d+)% chance to grant stealth for (\d+) turns?/i);
  if (stealth) addBit(bits, `${raisedChance(written, stealth[1])}% 機率隱身 ${raisedTurns(written, stealth[2])} 回合`);
  else {
    const quiet = text.match(/grant stealth for (\d+) turns?/i);
    if (quiet) addBit(bits, `隱身 ${quiet[1]} 回合`);
  }
  const counter = text.match(/(\d+(?:\.\d+)?)%\s*chance to counter/i);
  if (counter) addBit(bits, `受擊時 ${raisedChance(written, counter[1])}% 反擊`);
  const reduction = text.match(/(\d+(?:\.\d+)?)%\s*damage reduction/i);
  if (reduction) addBit(bits, /single attack/i.test(text) ? `我軍受到單攻時傷害減少 ${reduction[1]}%` : `傷害減少 ${reduction[1]}%`);
  if (/increased Defense to the caster for (\d+) turns/i.test(text)) {
    const turns = text.match(/increased Defense to the caster for (\d+) turns/i);
    addBit(bits, `自己防禦力增加 ${turns[1]} 回合`);
  }
  if (/barrier/i.test(text) && /for (\d+) turns/i.test(text)) {
    const turns = text.match(/barrier[^.]{0,80}for (\d+) turns/i);
    if (turns) addBit(bits, `防護罩 ${turns[1]} 回合`);
  }
  if (skill.soulburnCost) {
    const burn = `${skill.soulburnText || ""}`;
    if (/ignores effect resistance/i.test(burn)) addBit(bits, `燒魂 ${skill.soulburnCost}：無視效果抗性`);
    else if (/effect chance to 100%/i.test(burn)) addBit(bits, `燒魂 ${skill.soulburnCost}：效果發生率變為 100%`);
    else if (/cooldown is decreased by (\d+) turns?/i.test(burn)) {
      const cut = burn.match(/cooldown is decreased by (\d+) turns?/i);
      addBit(bits, `燒魂 ${skill.soulburnCost}：冷卻減少 ${cut[1]} 回合`);
    } else if (/duration of buffs granted by this skill by (\d+) turn/i.test(burn)) {
      const extra = burn.match(/by (\d+) turn/i);
      addBit(bits, `燒魂 ${skill.soulburnCost}：強化再延長 ${extra[1]} 回合`);
    } else if (burn && !/\d/.test(burn)) addBit(bits, `燒魂 ${skill.soulburnCost}：沒有另寫可套用的數字`);
  }
  return bits;
}

function skillBrief(hero, slot, label) {
  const skill = hero?.skills?.[slot];
  if (!skill) return slot === "S3" ? "大招：沒有公開的 3 技能。" : "";
  const facts = screenSkills[hero?.id]?.[slot];
  const written = writtenEnhance(hero, slot);
  const bits = [];
  if (Array.isArray(facts) && facts.length) {
    for (const fact of facts) addBit(bits, fact);
  } else {
    if (!`${skill.text || ""}`.trim()) return `${label}：沒有公開技能文字。`;
    for (const bit of clausesFrom(skill, written)) addBit(bits, bit);
    if (written.healing) addBit(bits, `強化到最大的回復增加 ${Math.round(written.healing * 100)}%`);
    if (written.barrier) addBit(bits, `強化到最大的防護強度增加 ${Math.round(written.barrier * 100)}%。沒有印基礎吸收量，不另編吸收量`);
    if (written.spirit) addBit(bits, `強化到最大少消耗 ${written.spirit} 鬥志`);
    if (written.spiritGain) addBit(bits, `強化到最大多獲得 ${written.spiritGain} 鬥志`);
  }
  if (typeof skill.cooldownShown === "number" && !bits.some((bit) => bit.includes("冷卻"))) {
    const cut = written.cooldown || 0;
    const shown = Math.max(0, skill.cooldownShown - cut);
    bits.unshift(cut ? `冷卻 ${shown} 回合，未強化是 ${skill.cooldownShown} 回合，強化減少 ${cut} 回合` : `冷卻 ${shown} 回合`);
  }
  if (skill.rate > 0 && skill.pow > 0 && !bits.some((bit) => bit.includes("傷害倍率"))) {
    addBit(bits, `公開傷害倍率 ${skill.rate}`);
  }
  if (written.damage > 0 && !bits.some((bit) => bit.includes("強化傷害"))) {
    addBit(bits, `強化到最大的傷害增加 ${Math.round(written.damage * 100)}%`);
  }
  const scales = [];
  if (skill.selfHpScaling) scales.push(`生命 ${skill.selfHpScaling}`);
  if (skill.selfDefScaling) scales.push(`防禦 ${skill.selfDefScaling}`);
  if (skill.selfAtkScaling) scales.push(`攻擊 ${skill.selfAtkScaling}`);
  if (skill.selfSpdScaling) scales.push(`速度 ${skill.selfSpdScaling}`);
  if (scales.length && !bits.some((bit) => bit.includes("公開係數"))) addBit(bits, `公開係數 ${scales.join("、")}`);
  const scaling = (skill.selfHpScaling || 0) + (skill.selfDefScaling || 0) + (skill.selfAtkScaling || 0) + (skill.selfSpdScaling || 0);
  if (skill.passive) {
    if (!bits.some((bit) => bit.includes("被動"))) addBit(bits, "這是被動，沒有攻擊倍率");
  } else if (!(skill.rate > 0) && scaling <= 0) {
    if (!bits.length) addBit(bits, "沒有公開的傷害倍率，也沒有寫出效果");
    else if (!bits.some((bit) => bit.includes("沒有傷害"))) addBit(bits, "這招沒有傷害倍率");
  }
  if (!bits.length) return `${label}：沒有寫出效果。`;
  const head = skill.passive ? `${label}被動` : label;
  return `${head}：${bits.join("。")}。`;
}

function formLine(hero) {
  const found = [];
  for (const slot of ["S1", "S2", "S3"]) {
    const names = formNames(hero?.skills?.[slot]?.text || "");
    const shown = names.map((name) => (/[A-Za-z]/.test(name) ? "另一種形態" : name));
    if (shown.length >= 2) found.push(`${slot} 寫成 ${shown.join("、")}`);
  }
  return found.length ? `技能變化：${found.join("；")}。變身後沒有另一組公開倍率，仍用現有公開倍率。` : "";
}

function passiveNote(hero) {
  const bits = [];
  for (const slot of ["S1", "S2", "S3"]) {
    for (const effect of hero?.skills?.[slot]?.effects || []) {
      if (!effect || effect.simulated === false) continue;
      if (["crImmune", "speedCap", "fixOwnSpeed", "crLockOnCasterTurn", "soulCut", "cannotCrit"].includes(effect.kind)) {
        addBit(bits, effectText(effect));
      }
    }
  }
  return bits.length ? `被動：${bits.join("，")}。` : "";
}

function kitBlock(catalog, hero) {
  if (!hero) return "沒有公開技能資料。";
  return [
    openingLine(catalog, hero),
    skillBrief(hero, "S1", "一技"),
    skillBrief(hero, "S2", "二技"),
    skillBrief(hero, "S3", "大招"),
    passiveNote(hero),
    formLine(hero),
  ].filter(Boolean).join("");
}

const RULE_TEXT = {
  attack: "戰爭規則：進攻。靈魂燃燒技能造成的傷害提升 15%。",
  defense: "戰爭規則：防守。可提升回收量與防護強度 30%。",
  resist: "戰爭規則：抵抗。效果抗性提升 50%。",
  special: "戰爭規則：特別節目。閃避減少 30%。",
  none: "戰爭規則：無規則。",
};

function applyRuleText(text, rule) {
  if (rule !== "special") return text;
  return text.replace(/閃避增加 (\d+(?:\.\d+)?)%/g, (_, raw) => {
    const next = Math.max(0, Number(raw) - 30);
    return `閃避增加 ${next}%（原本 ${raw}%，特別節目減少 30%）`;
  });
}

function unitStat(catalog, roster, id, field) {
  const own = (roster?.heroes || []).find((hero) => hero.id === id);
  if (typeof own?.[field] === "number") return own[field];
  const hero = fightRecord(catalog, id);
  return hero?.reference?.median?.[field] ?? hero?.base?.[field] ?? 0;
}

function topArtifactEnglish(catalog, hero) {
  const build = e7Record(hero?.code)?.建造?.[0];
  return build?.神器 ? artifactEnglish(catalog, build.神器) : "";
}

function threatScore(catalog, hero) {
  if (!hero) return 0;
  const skill = hero.skills?.S3;
  const parts = splitSkill(skill);
  let score = 0;
  if (parts.buffs.length && !parts.damage) score += 30;
  if (parts.damage && (skill?.targets || 1) > 1) score += 20;
  if (parts.debuffs.length) score += 10;
  if (stealthGrants(hero.skills).some((grant) => grant.atBattleStart)) score += 25;
  if (topArtifactEnglish(catalog, hero) === "Guiding Light") score += 25;
  const fast = e7Record(hero.code)?.速度?.["90"];
  if (typeof fast === "number") score += fast / 1000;
  const hp = hero.reference?.median?.hp ?? hero.base?.hp ?? 0;
  if (typeof hp === "number" && hp > 0) score -= hp / 1000000;
  return score;
}

function shortOpening(hero) {
  const bits = [];
  if (opensOnFullCooldown(hero) != null) bits.push("開場大招可用");
  if (stealthGrants(hero?.skills).some((grant) => grant.atBattleStart)) bits.push("開場可能隱身");
  if (!bits.length) return "開戰常見做法：依技能決定，沒有另列配裝。";
  return `開戰常見做法：${bits.join("，")}。`;
}

function shownKit(catalog, hero) {
  if (!hero) return "沒有公開技能資料。";
  return [shortOpening(hero), skillBrief(hero, "S3", "大招"), passiveNote(hero) || "被動：沒有另列被動。"].filter(Boolean).join("");
}

function playAdvice(catalog, hero, rule) {
  const name = hero?.nameZh || "這名";
  const reasons = [];
  const texts = ["S1", "S2", "S3"].map((slot) => hero?.skills?.[slot]?.text || "").join(" ");
  const stealth = texts.match(/(\d+(?:\.\d+)?)% chance to grant stealth/i);
  const quiet = /grant stealth/i.test(texts);
  const art = topArtifactEnglish(catalog, hero);
  if (stealth) reasons.push(`隱身 ${raisedChance(writtenEnhance(hero, "S2"), stealth[1])}%，我方用全體攻擊`);
  else if (quiet || art === "Guiding Light") reasons.push("開場可能隱身，我方用全體攻擊");
  const resources = texts.match(/resources gained by the enemy by (\d+)%/i);
  if (resources) reasons.push(`我方獲得的資源減少 ${resources[1]}%`);
  const skill = hero?.skills?.S3;
  const parts = splitSkill(skill);
  if (parts.buffs.length && !parts.damage) reasons.push("大招是增益，我方先打這名");
  else if (parts.damage && (skill?.targets || 1) > 1) reasons.push("大招打多名，我方優先處理");
  else if (parts.debuffs.length) reasons.push("會上減益，我方先打這名");
  else if (!reasons.length) reasons.push("我方依血量集火");
  if (opensOnFullCooldown(hero) != null) reasons.push("開場大招可用");
  const line = `${name}：${reasons.slice(0, 2).join("。")}。`;
  return applyRuleText(line, rule);
}

function ourOrder(catalog, roster, userFight, enemyFight) {
  const ours = userFight
    .map((id) => ({ id, hero: fightRecord(catalog, id), speed: unitStat(catalog, roster, id, "speed") }))
    .filter((row) => row.hero);
  ours.sort((left, right) => right.speed - left.speed || left.hero.nameZh.localeCompare(right.hero.nameZh, "zh"));
  const actor = ours[0];
  if (!actor) return null;
  const combo = bestCombo(catalog, roster, ours.map((row) => row.hero));
  const active = combo && combo.gives && combo.castable && !combo.passive ? combo : null;
  if (active) {
    const giverSpeed = unitStat(catalog, roster, active.giver.id, "speed");
    const enemyFast = Math.max(0, ...enemyFight.map((id) => unitStat(catalog, roster, id, "speed")));
    const verb = active.slot === "S3" ? "開大" : active.slot === "S2" ? "開二技" : "開一技";
    return {
      title: `我方${active.giver.nameZh}${verb}給${active.receiver.nameZh}`,
      who: `我方${active.giver.nameZh}先幫${active.receiver.nameZh}。`,
      ult: active.slot === "S3" ? "要開大。" : "不開大。",
      hit: `開給我方${active.receiver.nameZh}。`,
      kill: "這是增益，先幫我方輸出。",
      later: enemyFast > giverSpeed,
      combo: active.text,
    };
  }
  let skill = null;
  let slot = "";
  for (const name of ["S3", "S2", "S1"]) {
    const candidate = actor.hero.skills?.[name];
    if (!candidate || candidate.passive || !canCast(candidate)) continue;
    skill = candidate;
    slot = name;
    break;
  }
  const actorName = actor.hero.nameZh;
  const parts = splitSkill(skill);
  const enemyFast = Math.max(0, ...enemyFight.map((id) => unitStat(catalog, roster, id, "speed")));
  const later = enemyFast > actor.speed;
  if (parts.buffs.length && !parts.damage) {
    const selfOnly = /to the caster/i.test(skill?.text || "") && !/allies/i.test(skill?.text || "");
    const ally = ours
      .filter((row) => row.id !== actor.id)
      .sort((left, right) => unitStat(catalog, roster, right.id, "attack") - unitStat(catalog, roster, left.id, "attack"))[0];
    const onto = selfOnly || !ally ? "自己" : `我方${ally.hero.nameZh}`;
    const verb = slot === "S3" ? `開大給${onto}` : `開給${onto}`;
    return {
      title: `我方${actorName}${verb}`,
      who: `我方${actorName}先動。`,
      ult: `${verb}。`,
      hit: `開給${onto}。`,
      kill: "這是增益，先幫我方輸出。",
      later,
      combo: combo && !active ? combo.text : "",
    };
  }
  const foes = enemyFight
    .map((id) => ({ id, hero: fightRecord(catalog, id) }))
    .filter((row) => row.hero)
    .sort((left, right) => threatScore(catalog, right.hero) - threatScore(catalog, left.hero) || left.hero.nameZh.localeCompare(right.hero.nameZh, "zh"));
  const focus = foes[0]?.hero?.nameZh || "對手";
  const many = (skill?.targets || 1) > 1;
  return {
    title: `我方${actorName}先打${focus}`,
    who: `我方${actorName}先打${focus}。`,
    ult: slot === "S3" ? "要開大。" : "不開大。",
    hit: many ? `打到對方多名，先看${focus}。` : `打到${focus}。`,
    kill: `先殺${focus}。`,
    later,
    combo: combo && !active ? combo.text : "",
  };
}

export function heroKit(catalog, id) {
  const pools = [catalog?.heroes || [], catalog?.database || []];
  for (const pool of pools) {
    const hero = pool.find((row) => row.id === id);
    if (hero) return kitBlock(catalog, hero);
  }
  return "";
}

export function matchesPicker(hero, filters = {}) {
  const stars = filters.stars || [];
  const elements = filters.elements || [];
  const roles = filters.roles || [];
  if (stars.length && !stars.includes(hero?.rarity)) return false;
  if (elements.length && !elements.includes(hero?.attribute)) return false;
  if (roles.length && !roles.includes(hero?.role)) return false;
  return true;
}

export function unclearSkills(catalog) {
  const seen = new Set();
  const rows = [];
  for (const hero of [...(catalog?.database || []), ...(catalog?.heroes || [])]) {
    if (!hero?.id || seen.has(hero.id)) continue;
    if (["orte", "hasol", "talaz", "mighty-scout", "wild-angara"].includes(hero.id)) continue;
    seen.add(hero.id);
    const slots = [];
    for (const slot of ["S1", "S2", "S3"]) {
      const skill = hero.skills?.[slot];
      const kinds = [];
      if (!skill || !`${skill.text || ""}`.trim()) {
        kinds.push("沒有技能文字");
      } else if (!screenSkills[hero.id]?.[slot]) {
        const line = skillBrief(hero, slot, slot);
        const scaling = (skill.selfHpScaling || 0) + (skill.selfDefScaling || 0) + (skill.selfAtkScaling || 0) + (skill.selfSpdScaling || 0);
        const attacks = /\battacks\b/i.test(skill.text) && !skill.passive;
        if (attacks && !(skill.rate > 0) && scaling <= 0) kinds.push("缺倍率");
        const source = `${skill.text} ${skill.soulburnText || ""}`;
        const percents = source.match(/\d+(?:\.\d+)?(?=%)/g) || [];
        const turns = [...source.matchAll(/for (\d+) turns?/gi)].map((match) => match[1]);
        if ([...percents, ...turns].some((num) => !line.includes(num))) kinds.push("缺效果");
        if (slot !== "S1" && skill.cooldownShown == null && !skill.passive) kinds.push("沒有冷卻數字，也沒標成被動");
      }
      if (kinds.length) slots.push(`${slot} ${kinds.join("、")}`);
    }
    if (slots.length) rows.push({ name: hero.nameZh || hero.name || hero.id, slots });
  }
  return rows;
}

const BUFF_ZH = { superhumanization: "超人化" };

function skillTextOf(skill) {
  return `${skill?.text || ""}`;
}

function glossaryFor(skill, name) {
  const before = `${skill?.textBeforeAwaken || ""}`;
  if (!before || !name) return "";
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hit = before.match(new RegExp(`(?:^|\\.\\s+)${escaped}\\s+([^.]{0,180})`, "i"));
  return hit ? hit[1] : "";
}

function allyGrants(skill) {
  const found = [];
  const re = /grants ([a-z][a-z' ]{2,40}?) to (the target|an ally|all allies|all other allies|the ally) for (\d+) turns/gi;
  for (const match of skillTextOf(skill).matchAll(re)) {
    const name = match[1].trim().toLowerCase();
    if (["increased attack", "increased defense", "increased speed", "a barrier", "barrier"].includes(name)) continue;
    found.push({ name, turns: Number(match[3]) });
  }
  return found;
}

function barrierSource(phrase) {
  const text = phrase || "";
  if (/target['’]s max Health/i.test(text)) return "依目標最大生命";
  if (/caster['’]s max Health/i.test(text)) return "依自己最大生命";
  if (/caster['’]s Defense/i.test(text)) return "依自己防禦";
  if (/proportional to level/i.test(text)) return "依等級";
  return "";
}

function allyAttackOffer(text) {
  const patterns = [
    /increased Attack[\s\S]{0,160}?to all allies for (\d+) turns/i,
    /increasing Attack of all allies for (\d+) turns/i,
    /to all allies, increasing Attack for (\d+) turns/i,
  ];
  for (const pattern of patterns) {
    const hit = text.match(pattern);
    if (!hit) continue;
    const pct = hit[0].match(/by (\d+(?:\.\d+)?)%/i);
    return { turns: Number(hit[1]), percent: pct ? Number(pct[1]) : null };
  }
  return null;
}

function allyDefenseOffer(text) {
  const patterns = [
    /increased Defense[\s\S]{0,80}?to all allies for (\d+) turns/i,
    /increasing Defense of all allies for (\d+) turns/i,
    /from all allies before granting increased Defense[^.]{0,80}?for (\d+) turns/i,
  ];
  for (const pattern of patterns) {
    const hit = text.match(pattern);
    if (!hit || /to the caster/i.test(hit[0])) continue;
    const pct = hit[0].match(/by (\d+(?:\.\d+)?)%/i);
    return { turns: Number(hit[1]), percent: pct ? Number(pct[1]) : null };
  }
  return null;
}

function readAllyOffer(skill) {
  const text = skillTextOf(skill);
  if (!text.trim()) return null;
  const allyContext = /an ally except for the caster|all allies|all other allies|an ally|the ally/i.test(text);
  const offer = {
    cr: null,
    maxHp: null,
    speedPercent: null,
    speedTurns: null,
    buffZh: "",
    buffTurns: null,
    attack: allyAttackOffer(text),
    defense: allyDefenseOffer(text),
    barrier: null,
    dual: /dual attack from the ally with the highest Attack/i.test(text),
    defBreak: null,
  };
  for (const match of text.matchAll(/(?:increases|increasing) Combat Readiness(?: of (the caster|all allies|all enemies|the enemy|an ally|the ally|the target|all other allies))? by (\d+(?:\.\d+)?)%/gi)) {
    const who = (match[1] || "").toLowerCase();
    if (who === "the caster" || who === "all enemies" || who === "the enemy") continue;
    if (!who && !allyContext) continue;
    offer.cr = Number(match[2]);
  }
  for (const grant of allyGrants(skill)) {
    const effect = glossaryFor(skill, grant.name);
    if (!effect) continue;
    const hp = effect.match(/max Health(?: and Speed)? by (\d+(?:\.\d+)?)%/i);
    const spd = effect.match(/Speed by (\d+(?:\.\d+)?)%/i);
    if (hp) offer.maxHp = Number(hp[1]);
    if (spd) offer.speedPercent = Number(spd[1]);
    offer.buffTurns = grant.turns;
    offer.buffZh = BUFF_ZH[grant.name] || "";
  }
  const speedNamed = text.match(/grant(?:s|ing) increased Speed to all allies for (\d+) turns/i);
  const speedPlain = text.match(/grants increased Speed for (\d+) turns/i);
  if (offer.speedPercent == null && (speedNamed || (speedPlain && allyContext))) {
    offer.speedTurns = Number((speedNamed || speedPlain)[1]);
  }
  if (/an ally|all allies/i.test(text)) {
    const barrier = text.match(/barrier \(([^)]+)\)[^.]{0,100}?for (\d+) turns/i);
    if (barrier && !/to the caster/i.test(barrier[0])) {
      offer.barrier = { turns: Number(barrier[2]), source: barrierSource(barrier[1]) };
    }
  }
  const chanced = text.match(/(\d+(?:\.\d+)?)%\s*chance(?: each)? to (?:inflict )?(?:decreased|decrease) Defense for (\d+) turns?/i);
  const sure = text.match(/(?:inflicts|inflicting) decreased Defense for (\d+) turns/i);
  if (chanced || sure) {
    const amount = text.match(/Decreases Defense by (\d+(?:\.\d+)?)%/i);
    offer.defBreak = {
      chance: chanced ? Number(chanced[1]) : null,
      turns: Number(chanced ? chanced[2] : sure[1]),
      amount: amount ? Number(amount[1]) : null,
    };
  }
  const useful = offer.cr != null || offer.maxHp != null || offer.speedPercent != null || offer.speedTurns
    || offer.attack || offer.defense || offer.barrier || offer.dual || offer.defBreak;
  return useful ? offer : null;
}

function readNeed(hero) {
  const slots = ["S1", "S2", "S3"].map((slot) => hero?.skills?.[slot]).filter(Boolean);
  const text = slots.map((skill) => skill.text || "").join(" ");
  return {
    maxHp: slots.some((skill) => skill.selfHpScaling > 0) || /proportional to the caster['’]s max Health/i.test(text),
    defense: slots.some((skill) => skill.selfDefScaling > 0) || /proportional to the caster['’]s Defense/i.test(text),
    speed: slots.some((skill) => skill.selfSpdScaling > 0) || /proportional to the caster['’]s Speed/i.test(text),
    attack: slots.some((skill) => skill.rate > 0 || skill.selfAtkScaling > 0),
    hpCoef: Math.max(0, ...slots.map((skill) => skill.selfHpScaling || 0)),
  };
}

function linkOffer(offer, need) {
  let score = 0;
  const linked = [];
  if (offer.maxHp != null && need.maxHp) {
    score = Math.max(score, 36);
    linked.push("maxHp");
  }
  if (offer.defense && need.defense) {
    score = Math.max(score, 20);
    linked.push("def");
  }
  if ((offer.speedPercent != null || offer.speedTurns) && need.speed) {
    score = Math.max(score, 20);
    linked.push("spd");
  }
  if (offer.attack && need.attack) {
    score = Math.max(score, 16);
    linked.push("atk");
  }
  if (offer.dual && need.attack) {
    score = Math.max(score, 16);
    linked.push("dual");
  }
  if (offer.defBreak && need.attack) {
    score = Math.max(score, 12);
    linked.push("break");
  }
  if (score === 0 && offer.cr != null && (need.attack || need.maxHp || need.defense || need.speed)) {
    score = 8;
    linked.push("cr");
  }
  if (!score) return null;
  return { score, linked };
}

function comboSentence(giver, receiver, slot, skill, offer, linked) {
  const slotZh = { S3: "大招", S2: "二技", S1: "一技" }[slot] || slot;
  const head = skill.passive ? `${giver.nameZh}${slotZh}是被動，不叫開大` : `${giver.nameZh}${slotZh}`;
  const effects = [];
  if (offer.cr != null) effects.push(`戰鬥準備度 +${offer.cr}%`);
  if (offer.buffTurns && (offer.maxHp != null || offer.speedPercent != null)) {
    const name = offer.buffZh ? `${offer.buffZh} ` : "";
    const stats = [];
    if (offer.maxHp != null) stats.push(`最大生命增加 ${offer.maxHp}%`);
    if (offer.speedPercent != null) stats.push(`速度增加 ${offer.speedPercent}%`);
    effects.push(`${name}${offer.buffTurns} 回合，${stats.join("，")}`);
  }
  if (offer.speedTurns && offer.speedPercent == null) effects.push(`增加速度 ${offer.speedTurns} 回合，頁上沒寫比例`);
  if (offer.attack) {
    const pct = offer.attack.percent != null ? `${offer.attack.percent}%` : "頁上沒寫比例";
    effects.push(`增加攻擊 ${offer.attack.turns} 回合，${pct}`);
  }
  if (offer.defense) {
    const pct = offer.defense.percent != null ? `${offer.defense.percent}%` : "頁上沒寫比例";
    effects.push(`增加防禦 ${offer.defense.turns} 回合，${pct}`);
  }
  if (offer.barrier && linked.some((kind) => kind !== "break")) {
    const src = offer.barrier.source ? `，${offer.barrier.source}` : "";
    effects.push(`防護罩 ${offer.barrier.turns} 回合${src}，沒有印吸收比例，不另編`);
  }
  if (offer.dual && linked.includes("dual")) effects.push("叫攻擊最高的隊友協攻");
  if (offer.defBreak && linked.includes("break")) {
    const chance = offer.defBreak.chance != null ? `${offer.defBreak.chance}% ` : "";
    const amount = offer.defBreak.amount != null ? `，頁上寫防禦減少 ${offer.defBreak.amount}%` : "";
    effects.push(`${chance}降低防禦 ${offer.defBreak.turns} 回合${amount}`);
  }
  const give = linked.length === 1 && linked[0] === "break" ? "先打對方" : "給隊友";
  const benefit = [];
  if (linked.includes("maxHp")) benefit.push(`${receiver.nameZh}的傷害依自己最大生命增加`);
  if (linked.includes("def")) benefit.push(`${receiver.nameZh}的傷害依自己防禦增加`);
  if (linked.includes("spd")) benefit.push(`${receiver.nameZh}的傷害依自己速度增加`);
  if (linked.includes("atk")) benefit.push(`${receiver.nameZh}有公開攻擊倍率`);
  if (linked.includes("dual")) benefit.push(`協攻的是${receiver.nameZh}`);
  if (linked.includes("break")) benefit.push(`${receiver.nameZh}有公開攻擊倍率，吃到降防`);
  if (linked.includes("cr") && !benefit.length) benefit.push(`${receiver.nameZh}被拉條後才能打`);
  return `技能組合：${head}${give}，${effects.join("，")}。${benefit.join("，")}。`;
}

function comboCastable(skill) {
  if (!skill || skill.passive) return false;
  if (typeof skill.cooldownShown === "number") return true;
  return canCast(skill);
}

function comboBetween(catalog, roster, giver, receiver, group) {
  if (!giver || !receiver || giver.id === receiver.id) return null;
  let best = null;
  for (const slot of ["S3", "S2", "S1"]) {
    const skill = giver.skills?.[slot];
    const offer = readAllyOffer(skill);
    if (!offer) continue;
    if (offer.dual) {
      const others = (group || [receiver]).filter((hero) => hero && hero.id !== giver.id);
      const top = others.slice().sort((left, right) => unitStat(catalog, roster, right.id, "attack") - unitStat(catalog, roster, left.id, "attack") || left.nameZh.localeCompare(right.nameZh, "zh"))[0];
      if (!top || top.id !== receiver.id) offer.dual = false;
    }
    const need = readNeed(receiver);
    const linked = linkOffer(offer, need);
    if (!linked) continue;
    const row = {
      score: linked.score,
      text: comboSentence(giver, receiver, slot, skill, offer, linked.linked),
      slot,
      skill,
      passive: !!skill.passive,
      castable: comboCastable(skill),
      giver,
      receiver,
      hpCoef: need.hpCoef || 0,
      gives: linked.linked.some((kind) => kind !== "break"),
    };
    if (!best || row.score > best.score || (row.score === best.score && row.hpCoef > best.hpCoef)) best = row;
  }
  return best;
}

function bestCombo(catalog, roster, heroes) {
  let best = null;
  const group = (heroes || []).filter(Boolean);
  for (const giver of group) {
    for (const receiver of group) {
      const link = comboBetween(catalog, roster, giver, receiver, group);
      if (!link) continue;
      if (!best || link.score > best.score || (link.score === best.score && link.hpCoef > best.hpCoef)) best = link;
    }
  }
  return best;
}

function pairScore(list, code) {
  if (!code) return 0;
  const hit = (list || []).find((item) => item.代碼 === code);
  return typeof hit?.分數 === "number" ? hit.分數 : 0;
}

function answersOf(hero) {
  const slots = ["S1", "S2", "S3"].map((slot) => hero?.skills?.[slot]).filter(Boolean);
  const text = slots.map((skill) => skill.text || "").join(" ");
  return {
    dispel: slots.some((skill) => (skill.effects || []).some((effect) => effect.kind === "dispelBuff")) || /dispels/i.test(text),
    aoe: slots.some((skill) => (skill.targets || 0) > 1 || /all enemies/i.test(skill.text || "")),
  };
}

function compositionRank(catalog, roster, userPicks, enemyPicks, blockedIds) {
  const owned = ownedIdsOf(roster);
  const taken = new Set([...(userPicks || []), ...(enemyPicks || []), ...(blockedIds || [])].filter(Boolean));
  for (const id of [...taken]) taken.add(canonicalId(id));
  const pool = (catalog.heroes || []).filter((hero) => owned.has(hero.id) && !taken.has(hero.id) && draftHero(catalog, hero.id));
  const knownEnemy = (enemyPicks || []).map((id) => draftHero(catalog, id)).filter(Boolean);
  const allies = (userPicks || []).map((id) => draftHero(catalog, id)).filter(Boolean);
  const scored = [];
  for (const hero of pool) {
    const mine = draftHero(catalog, hero.id);
    const row = e7Record(mine?.code);
    const answers = answersOf(mine);
    const notes = [];
    let score = 0;
    if (!knownEnemy.length) {
      scored.push({
        id: hero.id,
        score: 0,
        reason: "對方還沒選。這一格不依對方數據，下一格等對方選完再重算。",
        chance: null,
        hp: null,
        impact: null,
        hpImpact: null,
      });
      continue;
    }
    for (const enemy of knownEnemy) {
      const enemyRow = e7Record(enemy.code);
      const name = enemy.nameZh || "對方";
      const counter = Math.max(pairScore(row?.克制, enemy.code), pairScore(enemyRow?.被克制, mine?.code));
      const countered = Math.max(pairScore(row?.被克制, enemy.code), pairScore(enemyRow?.克制, mine?.code));
      if (counter) {
        score += counter * 20;
        notes.push({ weight: counter * 20, text: `計數器：克制${name}。` });
      }
      if (countered) {
        score -= countered * 20;
        notes.push({ weight: countered * 20, text: `反制：${name}克制這名。` });
      }
      const speed = enemyRow?.速度?.["50"];
      const ownSpeed = row?.速度?.["50"];
      if (typeof speed === "number" && typeof ownSpeed === "number") {
        const edge = ownSpeed >= speed ? 2 : 0;
        score += edge;
        notes.push({ weight: edge || 0.2, text: `速度：${name}中位 ${speed}。` });
      }
      const build = enemyRow?.建造?.[0];
      const sets = (build?.套裝 || []).filter(Boolean);
      if (sets.includes("免疫") && answers.dispel) {
        score += 6;
        notes.push({ weight: 6, text: `建造：${name}常見免疫，這名能解除。` });
      }
      const art = build?.神器 || "";
      if ((art.includes("引導") || /stealth/i.test(`${enemy.skills?.S2?.text || ""} ${enemy.skills?.S3?.text || ""}`)) && answers.aoe) {
        score += 6;
        notes.push({ weight: 6, text: `建造：${name}常有隱身，這名打多名。` });
      } else if (sets.length && !counter && !countered) {
        notes.push({ weight: 0.1, text: `建造：${name}常見${sets.join("、")}。` });
      }
    }
    let combo = null;
    const group = [mine, ...allies];
    for (const ally of allies) {
      const allyRow = e7Record(ally.code);
      const syn = Math.max(pairScore(row?.協同, ally.code), pairScore(allyRow?.協同, mine?.code));
      if (syn) {
        score += syn * 8;
        notes.push({ weight: syn * 8, text: `協同：和已選的${ally.nameZh}。` });
      }
      const similar = (row?.最相似 || []).some((item) => item.代碼 === ally.code)
        || (allyRow?.最相似 || []).some((item) => item.代碼 === mine?.code);
      if (similar) notes.push({ weight: 1, text: `最相似：和已選的${ally.nameZh}定位接近，頁上沒有另寫搭配分數。` });
      for (const link of [comboBetween(catalog, roster, mine, ally, group), comboBetween(catalog, roster, ally, mine, group)]) {
        if (!link) continue;
        if (!combo || link.score > combo.score || (link.score === combo.score && link.hpCoef > combo.hpCoef)) combo = link;
      }
    }
    if (combo) score += combo.score;
    notes.sort((left, right) => right.weight - left.weight);
    const seen = new Set();
    const reason = [];
    if (combo) reason.push(combo.text);
    for (const note of notes) {
      if (seen.has(note.text) || reason.includes(note.text)) continue;
      seen.add(note.text);
      reason.push(note.text);
      if (reason.length === 2) break;
    }
    const enemyNames = knownEnemy.map((enemy) => enemy.nameZh).filter(Boolean).join("、");
    scored.push({
      id: hero.id,
      score,
      reason: reason.length ? reason.join("") : `配對分析：頁上沒有和${enemyNames}的預設表，不另編。計數器、反制、協同也沒有。`,
      chance: null,
      hp: null,
      impact: null,
      hpImpact: null,
    });
  }
  scored.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  return scored;
}

function sandboxRank(catalog, roster, lockedUser, lockedEnemy, userFirst, trials, blockedIds) {
  const model = catalog.heroes || [];
  const modelIds = new Set(model.map((hero) => hero.id));
  const owned = ownedIdsOf(roster);
  const taken = new Set([...(lockedUser || []), ...(lockedEnemy || []), ...(blockedIds || [])].filter((id) => id && id !== "unknown" && id !== "empty"));
  for (const id of [...taken]) taken.add(canonicalId(id));
  const locked = [];
  for (const id of lockedUser || []) {
    const canonical = modelIds.has(id) ? id : canonicalId(id);
    if (!modelIds.has(canonical) || !owned.has(canonical) || locked.includes(canonical)) continue;
    locked.push(canonical);
  }
  const candidates = model.filter((hero) => owned.has(hero.id) && !taken.has(hero.id) && !locked.includes(hero.id));
  const enemyLocked = (lockedEnemy || []).map((id) => (modelIds.has(id) ? id : canonicalId(id))).filter((id) => modelIds.has(id));
  const skill = { id: "s3", order: ["S3", "S2", "S1"], burn: false };
  const view = fightRoster(roster, catalog);
  const n = Math.max(1, Math.min(trials || 1, 2));
  const scored = [];
  for (const hero of candidates) {
    const user = [...locked, hero.id];
    for (const other of candidates) {
      if (user.length === 4) break;
      if (!user.includes(other.id)) user.push(other.id);
    }
    const skip = new Set(user);
    const enemy = [];
    const pools = [
      enemyLocked.filter((id) => !skip.has(id)),
      model.filter((row) => !owned.has(row.id) && !skip.has(row.id) && !taken.has(row.id)).map((row) => row.id),
      model.filter((row) => !skip.has(row.id) && !taken.has(row.id)).map((row) => row.id),
    ];
    for (const pool of pools) {
      for (const id of pool) {
        if (enemy.length === 4) break;
        if (!enemy.includes(id)) enemy.push(id);
      }
      if (enemy.length === 4) break;
    }
    if (user.length < 4 || enemy.length < 4) {
      scored.push({ id: hero.id, rate: null, user: user.slice(0, 4), enemy: enemy.slice(0, 4) });
      continue;
    }
    let wins = 0;
    for (let trial = 0; trial < n; trial += 1) {
      const fight = fightFromRoster(
        { userFight: user.slice(0, 4), enemyFight: enemy.slice(0, 4), userFirst },
        view,
        catalog,
        skill,
        "base",
        mulberry32(trial + 1),
      );
      if (fight.winner === "user") wins += 1;
    }
    scored.push({ id: hero.id, rate: wins / n, user: user.slice(0, 4), enemy: enemy.slice(0, 4) });
  }
  scored.sort((left, right) => (right.rate ?? -1) - (left.rate ?? -1) || left.id.localeCompare(right.id));
  return scored;
}

function draftSeat(userCount, enemyCount, userFirst) {
  const pattern = [1, 2, 2, 2, 2, 1];
  let side = userFirst ? "user" : "enemy";
  let user = 0;
  let enemy = 0;
  for (const count of pattern) {
    for (let index = 0; index < count; index += 1) {
      if (user === userCount && enemy === enemyCount) return { side, count, left: count - index };
      if (side === "user") user += 1;
      else enemy += 1;
    }
    side = side === "user" ? "enemy" : "user";
  }
  return null;
}

const FIRST_RULE = "先手規則：先手 1-2-2，後手 2-2-1。雙方的第 1、2 選和第 4、5 選都是關鍵，第 3 選是保護位，不能被最後禁。";

function slotNote(index) {
  const number = index + 1;
  if (number === 3) return `第 ${number} 選，保護位，不能被最後禁`;
  if (number === 1 || number === 2 || number === 4 || number === 5) return `第 ${number} 選，關鍵位`;
  return `第 ${number} 選`;
}

export function guidedDraft(catalog, roster, state = {}, options = {}) {
  const basis = sourceBasis(catalog);
  if (!basis.ok) return invalid(catalog, "資料還沒齊", basis.problems.slice(0, 4).join("；"));
  if (!roster?.heroes?.length) return invalid(catalog, "先讀入帳號", "還沒有讀入帳號。");
  const rule = FIRST_RULE;
  if (state.userFirst !== true && state.userFirst !== false) {
    return {
      ok: true,
      phase: "ask",
      firstPick: null,
      action: { kind: "ask", title: "先告訴我誰先手", detail: "按「我先手」或「對方先手」。", ids: [] },
      reason: { summary: `先後手由你點選。${rule}`, lines: [rule] },
      rate: null,
      version: basis.version,
      basis,
    };
  }
  const userFirst = state.userFirst === true;
  const userPicks = (state.userPicks || []).filter(Boolean);
  const enemyPicks = (state.enemyPicks || []).filter(Boolean);
  const prebans = (state.prebans || []).filter(Boolean);
  const enemyPre = (state.enemyPrebans || []).filter(Boolean);
  const each = options.rank === "below" ? 1 : 2;
  const who = userFirst ? "我方先手" : "對方先手";
  if (!state.prebansDone) {
    if (!state.enemyPrebansDone || enemyPre.length < each) {
      const left = Math.max(0, each - enemyPre.length);
      const named = enemyPre.map((id) => screenName(catalog, id)).filter(Boolean);
      const title = named.length ? `對方已預禁 ${named.join("、")}，再選 ${left} 名` : `對方預禁了哪 ${each} 名`;
      return {
        ok: true,
        phase: "enemy-preban",
        firstPick: userFirst,
        action: {
          kind: "enemy-preban",
          title,
          detail: `${who}。先選對方預禁的 ${each} 名，再給我方預禁和後面的選角。`,
          ids: enemyPre,
          need: left,
        },
        reason: { summary: `先問對方預禁了哪 ${each} 名。${rule}`, lines: [`先選對方預禁的 ${each} 名。`, rule] },
        rate: null,
        version: basis.version,
        basis,
      };
    }
    const owned = ownedIdsOf(roster);
    const opening = (catalog.heroes || [])
      .filter((hero) => owned.has(hero.id))
      .map((hero) => ({ id: hero.id, speed: heroProfile(draftHero(catalog, hero.id))?.speed || 0 }))
      .sort((left, right) => right.speed - left.speed || left.id.localeCompare(right.id))
      .slice(0, 5)
      .map((hero) => hero.id);
    const ids = prebanIds(catalog, new Set([...opening, ...enemyPre]), each);
    const names = ids.map((id) => screenName(catalog, id)).filter(Boolean);
    const theirs = enemyPre.map((id) => screenName(catalog, id)).filter(Boolean);
    const kits = ids.map((id) => `${screenName(catalog, id)}。${shownKit(catalog, draftHero(catalog, id))}`).join("");
    return {
      ok: true,
      phase: "preban",
      firstPick: userFirst,
      action: { kind: "preban", title: `先禁 ${names.join("、")}`, detail: `${who}。對方已預禁 ${theirs.join("、") || "還沒有"}。我方先禁這 ${names.length} 名，再開始填格子。`, ids },
      reason: { summary: `${who}。對方已預禁 ${theirs.join("、") || "還沒有"}。我方先禁 ${names.join("、")}。${kits}${rule}`, lines: [rule, `對方已預禁 ${theirs.join("、") || "還沒有"}。`, kits] },
      rate: null,
      version: basis.version,
      basis,
    };
  }
  const seat = draftSeat(userPicks.length, enemyPicks.length, userFirst);
  if (!seat && userPicks.length >= 5 && enemyPicks.length >= 5) {
    const protectedId = enemyPicks[2];
    const pool = enemyPicks.map((id, index) => ({ id, index })).filter((row) => row.index !== 2);
    const baseWave = survivalChance(catalog, roster, userPicks, enemyPicks, userFirst);
    let ban = pool[0];
    let bestGain = -Infinity;
    for (const row of pool) {
      const rest = enemyPicks.filter((id) => id !== row.id);
      const wave = survivalChance(catalog, roster, userPicks, rest, userFirst);
      const gain = (wave?.hp ?? 0) - (baseWave?.hp ?? 0);
      if (gain > bestGain) {
        bestGain = gain;
        ban = row;
      }
    }
    if (!ban) return invalid(catalog, "沒有可禁的人", "對方沒有第 3 選以外的人。");
    const protectedName = screenName(catalog, protectedId);
    const banName = screenName(catalog, ban.id);
    const bannedHero = draftHero(catalog, ban.id);
    const gainText = baseWave == null ? "" : bestGain > 0
      ? `禁掉之後，對方大招打下來，我方整組剩下的生命比現在高 ${chancePct(bestGain)}。`
      : "禁掉這名，大招打下來後整組剩下的生命沒有更高。";
    const kit = `${banName}。${shownKit(catalog, bannedHero)}`;
    return {
      ok: true,
      phase: "postban",
      firstPick: userFirst,
      action: {
        kind: "ban",
        title: `最後禁 ${banName}`,
        detail: `禁對方的${slotNote(ban.index)}。對方第 3 選 ${protectedName} 是保護位，不能禁。${gainText}`,
        id: ban.id,
        ids: [ban.id],
      },
      reason: {
        summary: `兩邊都選滿 5 名。最後禁 ${banName}，這是對方的${slotNote(ban.index)}。${kit}${gainText}對方第 3 選 ${protectedName} 是保護位，不能禁。`,
        lines: [rule, kit],
      },
      rate: null,
      version: basis.version,
      basis,
    };
  }
  if (!seat) return invalid(catalog, "人數對不上選角順序", FIRST_RULE);
  const held = [...userPicks, ...enemyPicks, ...prebans].map((id) => screenName(catalog, id)).filter(Boolean);
  if (seat.side === "enemy") {
    const already = seat.count - seat.left;
    const named = (already ? enemyPicks.slice(-already) : []).map((id, offset) => {
      const index = enemyPicks.length - already + offset;
      return `${screenName(catalog, id)}是對方${slotNote(index)}`;
    }).filter((line) => !line.startsWith("是"));
    const upcoming = Array.from({ length: seat.left }, (_, offset) => `對方${slotNote(enemyPicks.length + offset)}`);
    const heard = named.length ? `這手已有 ${named.join("，")}。` : "";
    const kits = enemyPicks.map((id) => `${screenName(catalog, id)}。${shownKit(catalog, draftHero(catalog, id))}`).join("");
    return {
      ok: true,
      phase: "pick",
      firstPick: userFirst,
      action: {
        kind: "report",
        title: seat.left === seat.count ? `告訴我對方這手的 ${seat.count} 名` : `對方這手還有 ${seat.left} 名`,
        detail: `${who}。${FIRST_RULE}這一手剩下${upcoming.join("、")}。${heard}`,
        ids: [],
        need: seat.left,
      },
      reason: { summary: `${who}。${FIRST_RULE}這一手剩下${upcoming.join("、")}。${heard}${kits}`, lines: [FIRST_RULE, ...upcoming, kits].filter(Boolean) },
      rate: null,
      version: basis.version,
      basis,
    };
  }
  const ids = [];
  const notes = [];
  const drafting = [...userPicks];
  const blocked = [...userPicks, ...enemyPicks, ...prebans, ...enemyPre];
  for (let step = 0; step < seat.left; step += 1) {
    const ranked = compositionRank(catalog, roster, drafting, enemyPicks, blocked);
    const next = ranked.find((row) => !drafting.includes(row.id) && !enemyPicks.includes(row.id) && !prebans.includes(row.id) && !enemyPre.includes(row.id));
    if (!next) break;
    ids.push(next.id);
    notes.push(`${screenName(catalog, next.id)}是我方${slotNote(userPicks.length + notes.length)}。${next.reason}`);
    drafting.push(next.id);
  }
  if (!ids.length) return invalid(catalog, "這一手沒有可選的人", "已經選過和已經禁過的人不重選。");
  const names = ids.map((id) => screenName(catalog, id)).filter(Boolean);
  const ourNames = userPicks.map((id) => screenName(catalog, id)).filter(Boolean);
  const theirNames = enemyPicks.map((id) => screenName(catalog, id)).filter(Boolean);
  const board = `這一格依對方已選的人重算。我方已選${ourNames.length ? ourNames.join("、") : "還沒有"}。對方已選${theirNames.length ? theirNames.join("、") : "還沒有"}。${notes.join("")}`;
  return {
    ok: true,
    phase: "pick",
    firstPick: userFirst,
    action: {
      kind: "pick",
      title: `選 ${names.join("、")}`,
      detail: board,
      ids,
    },
    reason: {
      summary: `${who}。${board}選 ${notes.join("，")}。${rule}`,
      lines: [rule, board, ...notes],
    },
    rate: null,
    version: basis.version,
    basis,
  };
}

function skillHasListedHit(skill) {
  return (skill?.rate || 0) > 0 && (skill?.pow || 0) > 0;
}

function skillHasNumberedEffect(skill) {
  return [...(skill?.effects || []), ...(skill?.soulburnEffects || [])].some((effect) => effect && effect.simulated !== false && effect.kind !== "unparsed" && effectHasNumber(effect));
}

function storedHp(catalog, roster, id, side) {
  const def = fightRecord(catalog, id);
  if (side === "user") {
    const own = (roster?.heroes || []).find((hero) => hero.id === id);
    if (typeof own?.hp === "number") return own.hp;
  }
  const hp = def?.reference?.median?.hp ?? def?.base?.hp;
  return typeof hp === "number" ? hp : null;
}

export function battleBrief(catalog, roster, draft) {
  const basis = sourceBasis(catalog);
  if (!basis.ok) return invalid(catalog, "資料還沒齊", basis.problems.slice(0, 4).join("；"));
  const userFight = draft?.userFight || [];
  const enemyFight = draft?.enemyFight || [];
  if (userFight.length !== 4 || enemyFight.length !== 4) {
    return invalid(catalog, "選滿並禁完才有戰況", "兩邊各留下 4 名之後，才寫誰先打誰。");
  }
  const byId = {};
  const missing = [];
  for (const id of [...userFight, ...enemyFight]) {
    const record = fightRecord(catalog, id);
    if (!record) missing.push(id);
    else byId[id] = record;
  }
  if (missing.length) {
    const names = missing.map((id) => screenName(catalog, id) || "這名").join("、");
    return invalid(catalog, "這份戰況不編沒有倍率的人", `${names}沒有技能倍率，不另編傷害。`);
  }
  const fight = fightFromRoster(
    { userFight, enemyFight, userFirst: draft.userFirst !== false, rule: draft.rule },
    roster,
    catalog,
    { id: "s3", order: ["S3", "S2", "S1"], burn: true },
    "max",
    () => 0.5,
  );
  const order = ourOrder(catalog, roster, userFight, enemyFight);
  const who = order?.who || "看不出我方該先動的人。";
  const ult = order?.ult || "沒有讀到開大。";
  const hit = order?.hit || "沒有讀到目標。";
  const kill = order?.kill || "沒有讀到先殺對象。";
  const title = order?.title || "我方照下面做";
  const lines = [];
  if (RULE_TEXT[draft.rule]) lines.push(RULE_TEXT[draft.rule]);
  if (order?.later) lines.push("對方有人比我方這名快。輪到我方時照這一步，目標是讓我方勝率更高。");
  lines.push(
    `誰先打誰：${who}`,
    `要不要開大：${ult}`,
    `打到誰：${hit}`,
    `先殺誰：${kill}`,
  );
  if (order?.combo) lines.push(order.combo);
  const book = (fight.log || []).find((row) => row.includes("魂書")) || "";
  const wave = survivalChance(catalog, roster, userFight, enemyFight, draft.userFirst !== false);
  const survive = wave == null ? "" : `照這樣打，對方大招打下來後，我方還活著的機會是 ${chancePct(wave.chance)}，整組剩下的生命是 ${chancePct(wave.hp)}。`;
  if (survive) lines.push(survive);
  for (const id of enemyFight) lines.push(playAdvice(catalog, byId[id], draft.rule));
  if (book) lines.push(book);
  const summary = lines.join("\n");
  return {
    ok: true,
    phase: "battle",
    firstPick: draft.userFirst === true,
    action: { kind: "brief", title, detail: `${ult}${kill}${survive}` },
    reason: { summary, lines },
    rate: null,
    version: basis.version,
    basis,
    draft: { userFight, enemyFight },
  };
}

export function draftPlans(catalog, roster, options = {}) {
  const scored = sandboxRank(catalog, roster, [], [], true, options.trials || 1);
  const ids = scored.map((row) => row.id);
  const picks = ids.slice(0, 5);
  const alt = ids.length > 5 ? ids.slice(1, 6) : picks;
  const make = (side, id, label, pickIds) => ({
    id,
    side,
    label,
    picks: pickIds,
    prebans: prebanIds(catalog, new Set(pickIds), 2),
    why: SANDBOX_WHY,
  });
  const ready = (plan) => plan.prebans.length > 0 && plan.picks.length > 0;
  return {
    first: [make("first", "first-sandbox", "先手", picks), make("first", "first-sandbox-next", "先手另一套", alt)].filter(ready),
    second: [make("second", "second-sandbox", "後手", picks), make("second", "second-sandbox-next", "後手另一套", alt)].filter(ready),
  };
}

function planDraft(catalog, plan, userFirst, prebansEach) {
  const model = catalog.heroes || [];
  const modelIds = new Set(model.map((hero) => hero.id));
  if (plan.picks.some((id) => !modelIds.has(id)) || plan.prebans.some((id) => !modelIds.has(id))) return null;
  const userPre = plan.prebans.slice(0, prebansEach);
  const banned = new Set(userPre);
  const userPicks = plan.picks.slice(0, 5);
  const enemyPool = [...model]
    .filter((hero) => !banned.has(hero.id) && !userPicks.includes(hero.id))
    .sort((left, right) => gamesOf(presenceOf(catalog, right.id)) - gamesOf(presenceOf(catalog, left.id)));
  const enemyPre = enemyPool.slice(0, prebansEach).map((hero) => hero.id);
  enemyPre.forEach((id) => banned.add(id));
  const enemyPicks = enemyPool.filter((hero) => !banned.has(hero.id)).slice(0, 5).map((hero) => hero.id);
  if (userPicks.length < 5 || enemyPicks.length < 5) return null;
  const score = (id) => presenceOf(catalog, id)?.prebans || 0;
  const highest = (ids) => [...ids].sort((left, right) => score(right) - score(left))[0];
  const userBan = highest(enemyPicks.filter((_, index) => index !== 2));
  const enemyBan = highest(userPicks.filter((_, index) => index !== 2));
  return {
    picked: { user: userPicks, enemy: enemyPicks },
    userBan,
    enemyBan,
    userFight: userPicks.filter((id) => id !== enemyBan),
    enemyFight: enemyPicks.filter((id) => id !== userBan),
    userFirst,
    userPre,
    enemyPre,
  };
}

function ratePlan(catalog, roster, draft, options) {
  if (!draft || draft.userFight.length !== 4 || draft.enemyFight.length !== 4) return null;
  const skill = { id: "s3", order: ["S3", "S2", "S1"], burn: false };
  const trials = options.trials || 4;
  let wins = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    const fight = fightFromRoster(draft, roster, catalog, skill, options.assumeMaxEnhance ? "max" : "base", mulberry32(trial + 1));
    if (fight.winner === "user") wins += 1;
  }
  return wins / trials;
}

function screenRecord(catalog, id) {
  return (catalog.seasonHeroes || []).find((hero) => hero.id === id)
    || (catalog.database || []).find((hero) => hero.id === id)
    || (catalog.heroes || []).find((hero) => hero.id === id)
    || null;
}

function screenName(catalog, id) {
  return screenRecord(catalog, id)?.nameZh || "";
}


export function describePlan(plan) {
  const order = plan.order.map((slot) => ({ S1: "1 技能", S2: "2 技能", S3: "3 技能" }[slot])).join(" → ");
  return {
    order,
    burn: plan.burn ? "魂夠、而且燒魂句子裡有可計算的效果時才燒" : "這條線不燒魂",
  };
}

export { effectText, PIECES, SET_ZH };
