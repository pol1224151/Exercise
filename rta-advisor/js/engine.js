/**
 * RTA draft and fight sandbox.
 * Multipliers and effect numbers come from catalog.json.
 * Win rate is the share of simulated trials, not a promise.
 */

import { chooseComposition } from "./records.js";

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

export function heroListed(hero) {
  if (!hero) return false;
  if (typeof hero.listed === "boolean") return hero.listed;
  const skills = hero.skills || {};
  return ["S1", "S2", "S3"].some((slot) => {
    const skill = skills[slot];
    return typeof skill?.rate === "number" && typeof skill?.pow === "number" && skill.rate > 0 && skill.pow > 0;
  });
}

function heroByName(catalog, name) {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return null;
  const pools = [catalog.heroes || [], catalog.seasonHeroes || [], catalog.database || []];
  for (const pool of pools) {
    const found = pool.find((hero) => hero.name?.toLowerCase() === key || hero.nameZh === name || hero.id === key);
    if (found) return normalizeHeroDef(found);
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

function preparedSkill(heroDef, slot, enhanceMode) {
  const skill = heroDef.skills[slot];
  const copy = { ...skill, slot };
  const maxed = enhanceMode === "max";
  if (maxed) {
    copy.enhanceDamagePctApplied = skill.enhanceDamagePct || 0;
    copy.enhanceEffectPctApplied = skill.enhanceEffectPct || 0;
    if (skill.cooldownShown != null) {
      copy.cooldown = Math.max(0, skill.cooldownShown - (skill.enhanceCooldownCut || 0));
    } else {
      copy.cooldown = 0;
    }
  } else {
    copy.enhanceDamagePctApplied = 0;
    copy.enhanceEffectPctApplied = 0;
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
      return effect.ratio != null ? `防禦穿透 ${Math.round(effect.ratio * 100)}%` : "防禦穿透（倍率用 Fribbels）";
    case "extraAttack":
      return "額外攻擊（沒有獨立倍率，傷害不計算）";
    case "heal":
      return effect.full ? "完全回復生命" : "回復生命";
    case "extraTurn":
      return "再行動一次";
    default:
      return effect.kind;
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

function artifactZh(catalog, name) {
  if (!name) return null;
  const found = Object.values(catalog.artifactNames || {}).find((a) => a.name === name);
  return found?.nameZh || name;
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
        reason: "畫面上的預禁對不上這個分段，或是不在賽季模型裡，這步建議無效。",
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

export function fightFromRoster(draft, roster, catalog, plan, enhanceMode, rand, enemyMode = "reference") {
  const byId = Object.fromEntries(catalog.heroes.map((h) => [h.id, h]));
  const owned = Object.fromEntries(roster.heroes.map((h) => [h.id, h]));
  const make = (id, side) => {
    const def = byId[id];
    const own = side === "user" ? owned[id] : null;
    const ref = def.reference?.median;
    const stats = (side === "user" && own) ? own : {
      hp: ref?.hp ?? def.base.hp,
      attack: ref?.attack ?? def.base.attack,
      defense: ref?.defense ?? def.base.defense,
      speed: ref?.speed ?? def.base.speed,
      crit: ref?.crit ?? def.base.crit,
      critDamage: ref?.critDamage ?? def.base.critDamage,
      effectiveness: ref?.effectiveness ?? def.base.effectiveness,
      effectResistance: ref?.effectResistance ?? def.base.effectResistance,
      sets: (def.rtaGear.setCombos?.[0]?.names) || [],
    };
    if (enemyMode === "reference" && side === "enemy") {
      stats.sets = (def.rtaGear.setCombos?.[0]?.names) || stats.sets;
    }
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
    }, def, enhanceMode);
    unit.side = side;
    return unit;
  };
  const userUnits = draft.userFight.map((id) => make(id, "user"));
  const enemyUnits = draft.enemyFight.map((id) => make(id, "enemy"));
  return simulateUnits(userUnits, enemyUnits, plan, rand);
}

function simulateUnits(userUnits, enemyUnits, plan, rand) {
  const units = [...userUnits, ...enemyUnits];
  const log = [];
  for (const unit of units) {
    for (const effect of unit.passives) {
      if (effect.kind === "fixOwnSpeed" || effect.kind === "speedCap") unit.lockedSpeed = unit.baseSpeed;
      if (effect.kind === "crPush" && effect.atBattleStart) {
        unit.cr = Math.min(100, unit.cr + effect.amount);
        log.push(`${unit.nameZh} 開場戰鬥準備度 +${effect.amount}（技能原文）。`);
      }
    }
  }
  let firstActor = null;
  let actions = 0;
  let winner = null;
  while (actions < 36 && !winner) {
    const living = units.filter((u) => u.alive);
    const ready = living.filter((u) => u.cr >= 100);
    let actor;
    if (ready.length) {
      actor = ready.sort((a, b) => b.cr - a.cr || effectiveSpeed(b, units) - effectiveSpeed(a, units))[0];
    } else {
      let dt = Infinity;
      for (const unit of living) dt = Math.min(dt, (100 - unit.cr) / effectiveSpeed(unit, units));
      for (const unit of living) unit.cr += effectiveSpeed(unit, units) * dt;
      actor = living.slice().sort((a, b) => b.cr - a.cr || effectiveSpeed(b, units) - effectiveSpeed(a, units))[0];
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
  const targets = pickTargets(foes, skill.targets || (skill.effects?.length ? foes.length : 1));
  const parts = [];
  for (const target of targets) {
    const relation = elementRelation(actor.attribute, target.attribute);
    const glance = relation === "disadvantage" && rand() < 0.5;
    const cannotCrit = actor.passives.some((e) => e.kind === "cannotCrit") || (skill.effects || []).some((e) => e.kind === "cannotCrit");
    const alwaysCrit = (skill.effects || []).some((e) => e.kind === "alwaysCrit");
    let hitMult = 1;
    if (glance) hitMult = 0.75;
    else if (!cannotCrit && (alwaysCrit || rand() < Math.min(100, actor.crit) / 100)) hitMult = Math.min(3.5, actor.cd / 100);
    if (relation === "advantage") hitMult *= 1.1;
    let damage = skillDamage(actor, target, skill, hitMult);
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
    if (!glance) applyEffects(skill, actor, target, allies, foes, units, doBurn, burnFx, crLocked, rand, log);
    parts.push(`${target.nameZh}${glance ? "擦傷" : ""}${Math.round(damage)}`);
  }
  if (skill.cooldown) actor.cdLeft[skill.slot] = skill.cooldown;
  const soulCut = foes.some((u) => u.alive && u.passives.some((e) => e.kind === "soulCut" && e.ratio >= 1));
  if (!soulCut) purse.purse.value += skill.soulGain || 0;
  const burnNote = doBurn ? `，燒魂 ${skill.soulburnCost}` : "";
  log.push(`${actor.nameZh} ${skill.name}${burnNote} → ${parts.join("、")}`);
  if ((skill.effects || []).some((e) => e.kind === "extraTurn")) {
    actor.cr = 100;
    log.push(`${actor.nameZh} 獲得再行動。`);
  }
  tickDebuffs(actor);
  refreshDef(actor);
}

function pickTargets(foes, count) {
  const sorted = foes.slice().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
  if (count >= foes.length) return sorted;
  return sorted.slice(0, Math.max(1, count));
}

function applyEffects(skill, actor, target, allies, foes, units, doBurn, burnFx, crLocked, rand, log) {
  const ignoreRes = doBurn && burnFx.some((e) => e.kind === "ignoreResistance");
  const forcedChance = doBurn ? burnFx.find((e) => e.kind === "effectChance") : null;
  for (const effect of skill.effects || []) {
    if (effect.simulated === false) continue;
    if (effect.kind === "heal") {
      const scaling = (skill.options || []).find((o) => o.selfHpScaling)?.selfHpScaling;
      if (effect.full) {
        for (const ally of allies) ally.hp = ally.maxHp;
      } else if (scaling) {
        for (const ally of allies) ally.hp = Math.min(ally.maxHp, ally.hp + actor.hp * scaling);
      }
    } else if (effect.kind === "crPush" && !crLocked) {
      const amount = effect.amount || 0;
      const who = effect.who || "";
      const group = who.includes("allies") ? allies : who.includes("enemy") || who.includes("target") ? [target] : [actor];
      if (!who || who.includes("caster") || who.includes("target") && !who.includes("enemy")) {
        // "the target" on a self-timed sentence still means the caster when it is not an attack rider.
      }
      const receivers = who.includes("enem") ? [target] : who.includes("allies") ? allies : [actor];
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
    warning: "畫面上看不到裝備數字。沙盤用 Fribbels Hero Library 的中位數；沒有中位數時用資料庫裡的滿覺醒基礎值，不另編數字。",
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

function countsArePrefix(userCount, enemyCount, userFirst) {
  if (userCount === 0 && enemyCount === 0) return true;
  const pattern = [1, 2, 2, 2, 2, 1];
  let side = userFirst ? "user" : "enemy";
  let user = 0;
  let enemy = 0;
  for (const count of pattern) {
    for (let i = 0; i < count; i += 1) {
      if (side === "user") user += 1;
      else enemy += 1;
      if (user === userCount && enemy === enemyCount) return true;
      if ((side === "user" && user > userCount) || (side === "enemy" && enemy > enemyCount)) return false;
    }
    side = side === "user" ? "enemy" : "user";
  }
  return user === userCount && enemy === enemyCount;
}

function nextSide(userCount, enemyCount, userFirst) {
  const pattern = [1, 2, 2, 2, 2, 1];
  let side = userFirst ? "user" : "enemy";
  let user = 0;
  let enemy = 0;
  for (const count of pattern) {
    for (let i = 0; i < count; i += 1) {
      if (user === userCount && enemy === enemyCount) return side;
      if (side === "user") user += 1;
      else enemy += 1;
    }
    side = side === "user" ? "enemy" : "user";
  }
  return null;
}

function burnDecision(skill, plan) {
  const effects = skill?.soulburnEffects || [];
  const usable = effects.some((effect) => effect.simulated !== false && effect.kind !== "unparsed");
  if (!plan?.burn || !skill?.soulburnCost || !usable) {
    return { yes: false, cost: null, text: "不要燒魂。這條沙盤沒有可計算的燒魂效果，或燒了勝率更低。" };
  }
  return { yes: true, cost: skill.soulburnCost, text: `要燒魂，消耗 ${skill.soulburnCost}。` };
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

export function detectFirstPick(userCount, enemyCount, turnSide, leadSide) {
  const asUser = countsArePrefix(userCount, enemyCount, true);
  const asEnemy = countsArePrefix(userCount, enemyCount, false);
  if (asUser && !asEnemy) return { firstPick: true, source: "counts" };
  if (asEnemy && !asUser) return { firstPick: false, source: "counts" };
  if (!asUser && !asEnemy) return { firstPick: null, source: "mismatch" };
  if (userCount === 5 && enemyCount === 5) return { firstPick: true, source: "locked" };
  if (leadSide === "user") return { firstPick: true, source: "lead" };
  if (leadSide === "enemy") return { firstPick: false, source: "lead" };
  return { firstPick: null, source: "unseen", turnSide: turnSide || null };
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

export function draftPlans(catalog, roster) {
  const season = (catalog.seasonHeroes || []).filter((hero) => hero.rtaPresence);
  const pool = season.length ? season : (catalog.heroes || []);
  const owned = (roster?.heroes || []).filter((hero) => presenceOf(catalog, hero.id) && heroListed(
    pool.find((row) => row.id === hero.id) || (catalog.heroes || []).find((row) => row.id === hero.id) || hero,
  ));
  const byGames = [...owned].sort((left, right) => gamesOf(presenceOf(catalog, right.id)) - gamesOf(presenceOf(catalog, left.id)));
  const byWin = [...owned].sort((left, right) => {
    const leftPresence = presenceOf(catalog, left.id);
    const rightPresence = presenceOf(catalog, right.id);
    const leftRate = leftPresence.wins / Math.max(1, leftPresence.wins + leftPresence.losses);
    const rightRate = rightPresence.wins / Math.max(1, rightPresence.wins + rightPresence.losses);
    return rightRate - leftRate || gamesOf(rightPresence) - gamesOf(leftPresence);
  });
  const byPreban = [...pool].sort((left, right) => (right.rtaPresence.prebans || 0) - (left.rtaPresence.prebans || 0));
  const bySeasonGames = [...pool].sort((left, right) => gamesOf(right.rtaPresence) - gamesOf(left.rtaPresence));
  const first = [
    onePlan("first", "first-preban", "先手", byPreban, byGames, "預禁用本季預禁數最高、而且不是這套要選的人。選角用你帳號裡本季場次最多的五名。"),
    onePlan("first", "first-win", "先手另一套", byPreban.slice(2), byWin, "預禁改看本季預禁數接著的兩名。選角改用你帳號裡勝率較高的五名。"),
  ];
  const second = [
    onePlan("second", "second-games", "後手", bySeasonGames, byWin, "預禁用本季場次最高、而且不是這套要選的人。選角用你帳號裡勝率較高的五名。"),
    onePlan("second", "second-preban", "後手另一套", byPreban, byGames, "預禁用本季預禁數最高的兩名。選角用你帳號裡本季場次最多的五名。"),
  ];
  const ready = (plan) => plan.prebans.length > 0 && plan.picks.length > 0;
  return { first: first.filter(ready), second: second.filter(ready) };
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

export function adviseFromScreen(catalog, recognition, options = {}) {
  const basis = sourceBasis(catalog);
  if (!basis.ok) {
    return invalid(catalog, "資料還沒齊", basis.problems.slice(0, 4).join("；"));
  }
  const byId = Object.fromEntries(catalog.heroes.map((hero) => [hero.id, hero]));
  const known = (id) => id && id !== "unknown" && id !== "empty" && byId[id];
  const slots = [...(recognition.user || []), ...(recognition.enemy || []), ...(recognition.prebans || [])];
  const phase = recognition.phase;
  if (slots.includes("unknown") || (phase === "battle" && recognition.actorId === "unknown")) {
    return invalid(catalog, "點這張卡選英雄", "這張卡上的名字讀不到，不會猜一個接近的人。");
  }
  const named = (id) => id && id !== "empty" && id !== "unknown";
  const unlisted = slots.filter((id) => named(id) && screenRecord(catalog, id) && !heroListed(screenRecord(catalog, id)));
  if (unlisted.length || (phase === "battle" && named(recognition.actorId) && screenRecord(catalog, recognition.actorId) && !heroListed(screenRecord(catalog, recognition.actorId)))) {
    const names = unlisted.map((id) => screenName(catalog, id)).filter(Boolean).join("、");
    return invalid(catalog, "這個英雄未收錄", `${names || "這名英雄"}沒有技能倍率，這一步不給建議。`);
  }
  const outside = slots.filter((id) => named(id) && !screenRecord(catalog, id));
  const actorOutside = phase === "battle" && named(recognition.actorId) && !screenRecord(catalog, recognition.actorId);
  if (outside.length || actorOutside) {
    return invalid(catalog, "這個英雄不在資料庫裡", "資料庫沒有這名英雄，這一步不給建議。");
  }
  const roster = options.roster;
  if (!roster?.heroes?.length) {
    return invalid(catalog, "先讀入帳號", "還沒有讀入帳號。");
  }
  const ownedIds = new Set(roster.heroes.map((hero) => hero.id));
  const missingOwn = (recognition.user || []).filter((id) => named(id) && screenRecord(catalog, id) && !ownedIds.has(id));
  if (missingOwn.length) {
    const names = missingOwn.map((id) => screenName(catalog, id) || byId[id]?.nameZh).join("、");
    return invalid(catalog, "帳號裡沒有這名英雄", `帳號裡沒有${names}，不會拿參考面板冒充你的裝備。`);
  }
  if (phase === "battle") {
    const user = (recognition.user || []).filter(known);
    const enemy = (recognition.enemy || []).filter(known);
    if (user.length !== 4 || enemy.length !== 4) {
      return invalid(catalog, "戰鬥還沒認滿", "戰鬥畫面沒有認滿兩邊各 4 名。");
    }
    if (!recognition.yourTurn) {
      return {
        ok: true,
        phase,
        action: {
          kind: "wait",
          title: "現在不是你的回合",
          detail: "技能列是暗的，先不要按。",
          burn: null,
        },
        rate: null,
        reason: { summary: "技能列是暗的，先不要按。", lines: ["技能鍵沒有亮，所以不建議放技能或燒魂。"] },
        version: basis.version,
        basis,
      };
    }
    if (!known(recognition.actorId) || !user.includes(recognition.actorId)) {
      return invalid(catalog, "看不出是誰在動", "看不出現在是你的哪一名在動。");
    }
    const draft = {
      steps: [],
      picked: { user, enemy },
      userBan: null,
      enemyBan: null,
      userFight: user,
      enemyFight: enemy,
      userFirst: true,
    };
    const plans = [
      { id: "s3-burn", order: ["S3", "S2", "S1"], burn: true },
      { id: "s3", order: ["S3", "S2", "S1"], burn: false },
      { id: "s1-burn", order: ["S1", "S3", "S2"], burn: true },
      { id: "s1", order: ["S1", "S3", "S2"], burn: false },
    ];
    const trials = options.trials || 4;
    let best = null;
    let seed = 1;
    const enhanceMode = options.assumeMaxEnhance ? "max" : "base";
    for (const plan of plans) {
      let wins = 0;
      let sampleLog = null;
      for (let trial = 0; trial < trials; trial += 1) {
        const fight = fightFromRoster(draft, roster, catalog, plan, enhanceMode, mulberry32(seed));
        seed += 1;
        if (fight.winner === "user") wins += 1;
        if (!sampleLog || (fight.winner === "user" && sampleLog.winner !== "user")) sampleLog = fight;
      }
      const rate = wins / trials;
      if (!best || rate > best.rate) best = { plan, rate, log: sampleLog };
    }
    const actor = byId[recognition.actorId];
    const ready = recognition.skillsReady || [true, true, true];
    const index = { S1: 0, S2: 1, S3: 2 };
    const slot = best.plan.order.find((name) => ready[index[name]] && actor.skills[name] && !actor.skills[name].passive);
    if (!slot) return invalid(catalog, "這一動沒有能放的技能", "亮著的技能不在資料裡，或是被動。");
    const skill = actor.skills[slot];
    const burn = burnDecision(skill, best.plan);
    const label = { S1: "1 技能", S2: "2 技能", S3: "3 技能" }[slot];
    return {
      ok: true,
      phase,
      action: {
        kind: "skill",
        title: `${actor.nameZh} 放${label}`,
        detail: skill.name ? `技能名稱沿用資料原文：${skill.name}` : label,
        burn,
        slot,
      },
      rate: best.rate,
      reason: {
        summary: `${actor.nameZh}這一動用${label}。${burn.text}`,
        lines: [
          "估計勝率來自沙盤，不是保證。",
          "你的面板用這次讀入的帳號。對手用 Fribbels 參考中位數，不是畫面上的裝備。",
          burn.text,
        ],
      },
      version: basis.version,
      basis,
      draft,
    };
  }

  const userPicks = (recognition.user || []).filter(named);
  const enemyPicks = (recognition.enemy || []).filter(named);
  const lockedPre = (recognition.prebans || []).filter(named);
  const nothingOnBoard = userPicks.length === 0 && enemyPicks.length === 0 && lockedPre.length === 0;
  if (nothingOnBoard && phase !== "preban" && !recognition.turnSide && !recognition.leadSide) {
    return invalid(catalog, "畫面上還沒有選角", "左右大卡出現英雄後，下一步會出現。");
  }
  const detected = detectFirstPick(userPicks.length, enemyPicks.length, recognition.turnSide, recognition.leadSide);
  let userFirst = detected.firstPick;
  let orderSource = detected.source;
  if (userFirst == null && detected.source === "unseen" && typeof options.heldFirstPick === "boolean") {
    userFirst = options.heldFirstPick;
    orderSource = "held";
  }
  if (userFirst == null) {
    return detected.source === "mismatch"
      ? invalid(catalog, "人數對不上選角順序", "兩邊已選的人數對不上選角順序，先不給禁選。")
      : invalid(catalog, "還看不出先後手", "先後手還沒分出來，先不給禁選。");
  }
  const plans = draftPlans(catalog, roster);
  const sidePlans = userFirst ? plans.first : plans.second;
  if (!sidePlans.length) return invalid(catalog, "這一手排不出來", "帳號裡沒有足夠的本季英雄可排一套打法。");
  const prebansEach = options.rank === "below" ? 1 : 2;
  const lines = sidePlans.map((plan) => {
    const draft = planDraft(catalog, plan, userFirst, prebansEach);
    const rate = ratePlan(catalog, roster, draft, options);
    return {
      ...plan,
      draft,
      rate,
      userPre: plan.prebans,
      reason: {
        summary: `${userFirst ? "先手" : "後手"}這套：${plan.why}`,
        lines: [
          plan.why,
          "數字用 Epic7RTAStats 這一季的預禁數和場次，沒有另編克制。",
          rate == null ? "這套裡有英雄沒有沙盤用的技能效果，不估算勝率，也不編倍率。" : "估計勝率來自這套打法的沙盤，不是保證。",
        ],
      },
    };
  });
  const cutoff = typeof options.cutoff === "number" ? options.cutoff : null;
  const choice = cutoff == null
    ? null
    : chooseComposition(lines, options.history || { matches: [] }, cutoff, userFirst);
  const best = choice?.line || lines[0];
  const history = choice ? {
    key: choice.key,
    wins: choice.stats.wins,
    losses: choice.stats.losses,
    total: choice.stats.total,
    rate: choice.stats.rate,
    switched: choice.switched,
    stuck: choice.stuck,
    cutoff,
    replaced: choice.replaced ? {
      rate: choice.replaced.stats.rate,
      wins: choice.replaced.stats.wins,
      losses: choice.replaced.stats.losses,
      total: choice.replaced.stats.total,
    } : null,
  } : null;
  const taken = new Set([...userPicks, ...enemyPicks, ...lockedPre]);
  const side = nextSide(userPicks.length, enemyPicks.length, userFirst);
  const orderLine = orderSource === "held" ? "沿用剛才分出的先後手。" : (userFirst ? "這一幀是先手。" : "這一幀是後手。");
  let action;
  if (userPicks.length === 0 && enemyPicks.length === 0) {
    const next = best.prebans.find((id) => !taken.has(id));
    const presence = next ? presenceOf(catalog, next) : null;
    action = next
      ? { kind: "preban", title: `預禁 ${screenName(catalog, next)}`, detail: `${best.label}。本季預禁數 ${presence?.prebans ?? "沒有"}。`, burn: null, id: next }
      : { kind: "wait", title: "預禁已經選完", detail: "等選角開始。", burn: null };
  } else if (!side && userPicks.length >= 5 && enemyPicks.length >= 5) {
    const protectedId = enemyPicks[2];
    const ban = [...enemyPicks].filter((id) => id !== protectedId).sort((left, right) => (presenceOf(catalog, right)?.prebans || 0) - (presenceOf(catalog, left)?.prebans || 0))[0];
    if (!ban) return invalid(catalog, "這一手沒有可禁的人", "對方沒有能禁、而且不是第 3 選的人。");
    action = { kind: "ban", title: `最後禁 ${screenName(catalog, ban)}`, detail: "不能禁對方的第 3 選。在其餘的人裡用本季預禁數較高的那位。", burn: null, id: ban };
  } else {
    const next = best.picks.find((id) => !taken.has(id));
    if (!next) return invalid(catalog, "這一手沒有可選的人", "這套打法裡還沒被選走的人已經沒有。");
    if (side === "enemy") {
      action = { kind: "pick", title: `下一手選 ${screenName(catalog, next)}`, detail: "現在是對手在選。", burn: null, id: next };
    } else {
      action = { kind: "pick", title: `選 ${screenName(catalog, next)}`, detail: best.why, burn: null, id: next };
    }
  }
  if (!action?.title) return invalid(catalog, "這一手沒有建議", "這套打法沒有排出下一步。");
  best.reason.lines = [orderLine, ...best.reason.lines];
  best.reason.summary = `${orderLine}${best.reason.summary}`;
  return {
    ok: true,
    phase: phase || (side ? "pick" : "postban"),
    action,
    rate: best.rate,
    reason: best.reason,
    history,
    firstPick: userFirst,
    orderSource,
    planId: best.id,
    version: basis.version,
    basis,
    best,
  };
}

export function describePlan(plan) {
  const order = plan.order.map((slot) => ({ S1: "1 技能", S2: "2 技能", S3: "3 技能" }[slot])).join(" → ");
  return {
    order,
    burn: plan.burn ? "魂夠、而且燒魂句子裡有可計算的效果時才燒" : "這條線不燒魂",
  };
}

export { effectText, PIECES, SET_ZH };
