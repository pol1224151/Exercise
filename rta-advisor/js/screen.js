/** Screen reading for the RTA advisor. Matching uses Fribbels portrait signatures shipped in data/portrait-signatures.json. */

export const DEFAULT_REGIONS = {
  user: { x: 0.02, y: 0.16, w: 0.12, h: 0.62, slots: 5, label: "我方" },
  enemy: { x: 0.86, y: 0.16, w: 0.12, h: 0.62, slots: 5, label: "對方" },
  preban: { x: 0.28, y: 0.03, w: 0.44, h: 0.10, slots: 2, label: "預禁" },
  skills: { x: 0.30, y: 0.84, w: 0.40, h: 0.12, slots: 3, label: "技能" },
  actor: { x: 0.02, y: 0.02, w: 0.12, h: 0.12, slots: 1, label: "現在行動" },
};

export const LEAD_BANDS = {
  user: { x: 0.02, y: 0.105, w: 0.12, h: 0.05 },
  enemy: { x: 0.86, y: 0.105, w: 0.12, h: 0.05 },
};

export function liveStateKey(recognition) {
  const slot = (id) => (id && id !== "empty" ? id : "");
  return JSON.stringify({
    user: (recognition?.user || []).map(slot),
    enemy: (recognition?.enemy || []).map(slot),
    prebans: (recognition?.prebans || []).map(slot),
    actor: slot(recognition?.actorId),
  });
}

export function centerDistance(left, right) {
  const center = (values) => {
    const means = [0, 1, 2].map((channel) => {
      let total = 0;
      let count = 0;
      for (let index = channel; index < values.length; index += 3) {
        total += values[index];
        count += 1;
      }
      return total / count;
    });
    return values.map((value, index) => value - means[index % 3]);
  };
  const a = center(left);
  const b = center(right);
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) {
    const delta = a[index] - b[index];
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

function stdev(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function signatureFromRgba(data, imageWidth, originX, originY, width, height) {
  const cells = [];
  for (let gy = 0; gy < 8; gy += 1) {
    for (let gx = 0; gx < 8; gx += 1) {
      const x0 = Math.floor(originX + (gx * width) / 8);
      const x1 = Math.max(x0 + 1, Math.floor(originX + ((gx + 1) * width) / 8));
      const y0 = Math.floor(originY + (gy * height) / 8);
      const y1 = Math.max(y0 + 1, Math.floor(originY + ((gy + 1) * height) / 8));
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const offset = (y * imageWidth + x) * 4;
          red += data[offset];
          green += data[offset + 1];
          blue += data[offset + 2];
          count += 1;
        }
      }
      cells.push(Math.round(red / count), Math.round(green / count), Math.round(blue / count));
    }
  }
  return cells;
}

function spatialStdev(rgb) {
  const lumas = [];
  for (let index = 0; index < rgb.length; index += 3) {
    lumas.push((rgb[index] + rgb[index + 1] + rgb[index + 2]) / 3);
  }
  return stdev(lumas);
}

export function patternDistance(left, right) {
  const normalize = (values) => {
    const stats = [0, 1, 2].map((channel) => {
      const samples = [];
      for (let index = channel; index < values.length; index += 3) samples.push(values[index]);
      const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
      const deviation = stdev(samples) || 1;
      return { mean, deviation };
    });
    return values.map((value, index) => (value - stats[index % 3].mean) / stats[index % 3].deviation);
  };
  const a = normalize(left);
  const b = normalize(right);
  let sum = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const delta = a[index] - b[index];
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

const CROP_INSETS = [0, 0.02, 0.04, 0.06, 0.08, 0.1, 0.12, 0.14, 0.16, 0.18, 0.2, 0.22, 0.24, 0.26, 0.28, 0.3, 0.32, 0.34, 0.36];
const CROP_PHASES = [0, 0.25];
const FULL_LIMIT = 4;
const INNER_LIMIT = 0.9;
const ACCEPT_RATIO = 2;
const CORRECTION_LIMIT = 4.8;

function maskedDistance(left, right, margin) {
  if (!margin) return patternDistance(left, right);
  const a = [];
  const b = [];
  for (let y = margin; y < 8 - margin; y += 1) {
    for (let x = margin; x < 8 - margin; x += 1) {
      const index = (y * 8 + x) * 3;
      a.push(left[index], left[index + 1], left[index + 2]);
      b.push(right[index], right[index + 1], right[index + 2]);
    }
  }
  return patternDistance(a, b);
}

function rankSignature(rgb, book, margin, limit) {
  let best = null;
  let second = null;
  for (const portrait of book.portraits) {
    const distance = maskedDistance(rgb, portrait.rgb, margin);
    const row = { id: portrait.id, distance };
    if (!best || distance < best.distance) {
      second = best;
      best = row;
    } else if (!second || distance < second.distance) {
      second = row;
    }
  }
  if (!best) return null;
  const ratio = second && best.distance > 0 ? second.distance / best.distance : Infinity;
  return {
    id: best.id,
    distance: best.distance,
    ratio,
    accepted: best.distance <= limit && ratio >= ACCEPT_RATIO,
  };
}

function nearestCorrection(rgb, corrections) {
  let best = null;
  for (const row of corrections || []) {
    if (!row?.id || !row.rgb) continue;
    const distance = patternDistance(rgb, row.rgb);
    if (!best || distance < best.distance) best = { id: row.id, distance };
  }
  return best;
}

export function rememberCorrection(list, rgb, id) {
  const next = (list || []).filter((row) => !row?.rgb || patternDistance(row.rgb, rgb) > 1.2);
  next.push({ id, rgb: [...rgb] });
  return next.slice(-40);
}

export function matchPortrait(rgb, book) {
  if (spatialStdev(rgb) < (book.emptyStdevBelow ?? 18)) return "empty";
  const picks = [rankSignature(rgb, book, 0, FULL_LIMIT), rankSignature(rgb, book, 2, INNER_LIMIT)].filter((row) => row?.accepted);
  if (!picks.length) return "unknown";
  picks.sort((left, right) => left.distance - right.distance);
  if (picks.length > 1 && picks[0].id !== picks[1].id && picks[1].distance < picks[0].distance * 1.5) return "unknown";
  return picks[0].id;
}

function signatureShifted(data, imageWidth, originX, originY, width, height, phase) {
  if (!phase) return signatureFromRgba(data, imageWidth, originX, originY, width, height);
  const cells = [];
  const xEnd = Math.floor(originX + width);
  const yEnd = Math.floor(originY + height);
  for (let gy = 0; gy < 8; gy += 1) {
    for (let gx = 0; gx < 8; gx += 1) {
      const x0 = Math.floor(originX + (gx + phase) * width / 8);
      const x1 = Math.max(x0 + 1, Math.floor(originX + (gx + 1 + phase) * width / 8));
      const y0 = Math.floor(originY + (gy + phase) * height / 8);
      const y1 = Math.max(y0 + 1, Math.floor(originY + (gy + 1 + phase) * height / 8));
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      for (let y = Math.max(y0, Math.floor(originY)); y < y1 && y < yEnd; y += 1) {
        for (let x = Math.max(x0, Math.floor(originX)); x < x1 && x < xEnd; x += 1) {
          const offset = (y * imageWidth + x) * 4;
          red += data[offset];
          green += data[offset + 1];
          blue += data[offset + 2];
          count += 1;
        }
      }
      cells.push(count ? Math.round(red / count) : 0, count ? Math.round(green / count) : 0, count ? Math.round(blue / count) : 0);
    }
  }
  return cells;
}

function cropSignature(data, imageWidth, box, insetX, insetY, phase) {
  const dx = box.w * insetX;
  const dy = box.h * insetY;
  return signatureShifted(
    data,
    imageWidth,
    box.x + dx,
    box.y + dy,
    Math.max(8, box.w - dx * 2),
    Math.max(8, box.h - dy * 2),
    phase,
  );
}

function judgeCrop(rgb, book, corrections, margin, limit) {
  const ranked = rankSignature(rgb, book, margin, limit);
  const correction = nearestCorrection(rgb, corrections);
  if (correction && correction.distance <= CORRECTION_LIMIT && (!ranked?.accepted || correction.distance <= ranked.distance)) {
    return { id: correction.id, distance: correction.distance, source: "correction" };
  }
  if (ranked?.accepted) return { id: ranked.id, distance: ranked.distance, source: "catalog" };
  return null;
}

function matchBox(data, imageWidth, box, book, corrections) {
  const full = signatureFromRgba(data, imageWidth, box.x, box.y, box.w, box.h);
  if (spatialStdev(full) < (book.emptyStdevBelow ?? 18)) return { id: "empty", rgb: full };
  const remembered = nearestCorrection(full, corrections);
  if (remembered && remembered.distance <= CORRECTION_LIMIT) return { id: remembered.id, rgb: full };
  let best = null;
  let rival = null;
  const offer = (found) => {
    if (!found) return false;
    if (found.source === "correction") {
      if (!best || found.distance <= best.distance) best = found;
      return found.distance <= 0.35;
    }
    if (best?.source === "correction" && best.distance <= found.distance) return false;
    if (!best || found.distance < best.distance) {
      if (best && best.id !== found.id) rival = best;
      best = found;
    } else if (found.id !== best.id && (!rival || found.distance < rival.distance)) {
      rival = found;
    }
    return found.distance <= 0.35;
  };
  for (const inset of CROP_INSETS) {
    let settled = false;
    for (const phase of CROP_PHASES) {
      settled = offer(judgeCrop(cropSignature(data, imageWidth, box, inset, inset, phase), book, corrections, 0, FULL_LIMIT));
      if (settled) break;
    }
    if (settled) break;
    if (!inset) continue;
    if (offer(judgeCrop(cropSignature(data, imageWidth, box, inset, 0, 0), book, corrections, 0, FULL_LIMIT))) break;
    if (offer(judgeCrop(cropSignature(data, imageWidth, box, 0, inset, 0), book, corrections, 0, FULL_LIMIT))) break;
  }
  if (!(best && best.distance <= 0.35)) offer(judgeCrop(full, book, corrections, 2, INNER_LIMIT));
  if (best?.source === "catalog" && rival && rival.distance < best.distance * 1.5) return { id: "unknown", rgb: full };
  return { id: best?.id || "unknown", rgb: full };
}

function slotBox(region, index, imageWidth, imageHeight) {
  const slotHeight = region.h / region.slots;
  return {
    x: Math.round(region.x * imageWidth),
    y: Math.round((region.y + slotHeight * index) * imageHeight),
    w: Math.max(8, Math.round(region.w * imageWidth)),
    h: Math.max(8, Math.round(slotHeight * imageHeight)),
  };
}

function readSlots(data, imageWidth, imageHeight, region, book, corrections) {
  const found = [];
  for (let index = 0; index < region.slots; index += 1) {
    const box = slotBox(region, index, imageWidth, imageHeight);
    found.push(matchBox(data, imageWidth, box, book, corrections));
  }
  return found;
}

function skillReady(data, imageWidth, imageHeight, region) {
  const ready = [];
  for (let index = 0; index < region.slots; index += 1) {
    const box = slotBox(region, index, imageWidth, imageHeight);
    const rgb = signatureFromRgba(data, imageWidth, box.x, box.y, box.w, box.h);
    const mean = rgb.reduce((sum, value) => sum + value, 0) / rgb.length;
    ready.push(mean > 140);
  }
  return ready;
}

function filledCount(ids) {
  return (ids || []).filter((id) => id && id !== "empty").length;
}

export function inferPhase(read) {
  const userN = filledCount(read.user);
  const enemyN = filledCount(read.enemy);
  const actorKnown = read.actorId && read.actorId !== "empty" && read.actorId !== "unknown";
  const skillsLit = (read.skillsReady || []).some(Boolean);
  if (userN === 4 && enemyN === 4 && (actorKnown || skillsLit)) return "battle";
  if (skillsLit && actorKnown && userN >= 1 && enemyN >= 1) return "battle";
  if (userN + enemyN >= 10) return "postban";
  if (userN + enemyN > 0) return "pick";
  if ((read.prebans || []).some((id) => id && id !== "empty")) return "preban";
  return "unknown";
}

function boxMean(data, imageWidth, box) {
  let sum = 0;
  let count = 0;
  const x1 = Math.min(imageWidth, box.x + box.w);
  const y1 = box.y + box.h;
  for (let y = box.y; y < y1; y += 2) {
    for (let x = box.x; x < x1; x += 2) {
      const offset = (y * imageWidth + x) * 4;
      sum += data[offset] + data[offset + 1] + data[offset + 2];
      count += 3;
    }
  }
  return count ? sum / count : 0;
}

function firstEmptyIndex(ids, slots) {
  for (let index = 0; index < slots; index += 1) {
    if (!ids[index] || ids[index] === "empty") return index;
  }
  return -1;
}

export function readTurnSide(data, imageWidth, imageHeight, regions, userIds, enemyIds) {
  const userIndex = firstEmptyIndex(userIds, regions.user.slots);
  const enemyIndex = firstEmptyIndex(enemyIds, regions.enemy.slots);
  if (userIndex < 0 || enemyIndex < 0) return null;
  const userMean = boxMean(data, imageWidth, slotBox(regions.user, userIndex, imageWidth, imageHeight));
  const enemyMean = boxMean(data, imageWidth, slotBox(regions.enemy, enemyIndex, imageWidth, imageHeight));
  if (userMean >= enemyMean + 28 && userMean >= 70) return "user";
  if (enemyMean >= userMean + 28 && enemyMean >= 70) return "enemy";
  return null;
}

function goldFraction(data, imageWidth, imageHeight, rect) {
  const x0 = Math.round(rect.x * imageWidth);
  const y0 = Math.round(rect.y * imageHeight);
  const x1 = Math.round((rect.x + rect.w) * imageWidth);
  const y1 = Math.round((rect.y + rect.h) * imageHeight);
  let gold = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const offset = (y * imageWidth + x) * 4;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      count += 1;
      if (red > 180 && green > 140 && blue < 110 && red + green > blue * 3) gold += 1;
    }
  }
  return count ? gold / count : 0;
}

export function readLeadSide(data, imageWidth, imageHeight) {
  const user = goldFraction(data, imageWidth, imageHeight, LEAD_BANDS.user);
  const enemy = goldFraction(data, imageWidth, imageHeight, LEAD_BANDS.enemy);
  if (user >= 0.12 && user >= enemy * 2.5) return "user";
  if (enemy >= 0.12 && enemy >= user * 2.5) return "enemy";
  return null;
}

function faceFrom(side, slots, region, imageWidth, imageHeight) {
  return slots.flatMap((slot, index) => {
    if (!slot?.id || slot.id === "empty") return [];
    const box = slotBox(region, index, imageWidth, imageHeight);
    return [{
      side,
      index,
      id: slot.id,
      rgb: slot.rgb,
      x: box.x / imageWidth,
      y: box.y / imageHeight,
      w: box.w / imageWidth,
      h: box.h / imageHeight,
    }];
  });
}

export function readFrame(data, imageWidth, imageHeight, regions, book, corrections = []) {
  const userSlots = readSlots(data, imageWidth, imageHeight, regions.user, book, corrections);
  const enemySlots = readSlots(data, imageWidth, imageHeight, regions.enemy, book, corrections);
  const prebanSlots = readSlots(data, imageWidth, imageHeight, regions.preban, book, corrections);
  const actorSlot = readSlots(data, imageWidth, imageHeight, regions.actor, book, corrections)[0];
  const user = userSlots.map((slot) => slot.id);
  const enemy = enemySlots.map((slot) => slot.id);
  const prebans = prebanSlots.map((slot) => slot.id);
  const actor = actorSlot?.id;
  const skillsReady = skillReady(data, imageWidth, imageHeight, regions.skills);
  const read = {
    user,
    enemy,
    prebans,
    actorId: actor,
    skillsReady,
    yourTurn: skillsReady.some(Boolean) && actor && actor !== "empty" && actor !== "unknown",
    turnSide: readTurnSide(data, imageWidth, imageHeight, regions, user, enemy),
    leadSide: readLeadSide(data, imageWidth, imageHeight),
    faces: [
      ...faceFrom("user", userSlots, regions.user, imageWidth, imageHeight),
      ...faceFrom("enemy", enemySlots, regions.enemy, imageWidth, imageHeight),
      ...faceFrom("preban", prebanSlots, regions.preban, imageWidth, imageHeight),
      ...faceFrom("actor", actorSlot ? [actorSlot] : [], regions.actor, imageWidth, imageHeight),
    ],
  };
  read.phase = inferPhase(read);
  return read;
}

function fillSlot(data, imageWidth, box, paint) {
  const width = Math.max(1, Math.round(box.w));
  const height = Math.max(1, Math.round(box.h));
  const originX = Math.round(box.x);
  const originY = Math.round(box.y);
  for (let gy = 0; gy < 8; gy += 1) {
    for (let gx = 0; gx < 8; gx += 1) {
      const color = paint(gx, gy);
      const x0 = Math.floor(originX + (gx * width) / 8);
      const x1 = Math.max(x0 + 1, Math.floor(originX + ((gx + 1) * width) / 8));
      const y0 = Math.floor(originY + (gy * height) / 8);
      const y1 = Math.max(y0 + 1, Math.floor(originY + ((gy + 1) * height) / 8));
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const offset = (y * imageWidth + x) * 4;
          data[offset] = color[0];
          data[offset + 1] = color[1];
          data[offset + 2] = color[2];
          data[offset + 3] = 255;
        }
      }
    }
  }
}

export function paintFixture(imageWidth, imageHeight, regions, book, assignment) {
  const data = new Uint8ClampedArray(imageWidth * imageHeight * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 14;
    data[index + 1] = 12;
    data[index + 2] = 16;
    data[index + 3] = 255;
  }
  const byId = Object.fromEntries(book.portraits.map((portrait) => [portrait.id, portrait]));
  const paintIds = (region, ids = []) => {
    for (let index = 0; index < region.slots; index += 1) {
      const id = ids[index];
      if (!id) continue;
      const box = slotBox(region, index, imageWidth, imageHeight);
      if (id === "bright") {
        fillSlot(data, imageWidth, box, () => [226, 214, 190]);
        continue;
      }
      if (id === "noise") {
        fillSlot(data, imageWidth, box, (gx, gy) => [(gx * 40) % 255, (gy * 70) % 255, (gx * gy * 15) % 255]);
        continue;
      }
      const portrait = byId[id];
      if (!portrait) continue;
      const scale = assignment.scale || 1;
      const paintPortrait = (target) => {
        fillSlot(data, imageWidth, target, (gx, gy) => {
          const offset = (gy * 8 + gx) * 3;
          return [0, 1, 2].map((channel) => Math.max(0, Math.min(255, Math.round(portrait.rgb[offset + channel] * scale))));
        });
      };
      if (assignment.fit) {
        const frame = assignment.fit;
        for (let y = Math.round(box.y); y < Math.round(box.y + box.h); y += 1) {
          for (let x = Math.round(box.x); x < Math.round(box.x + box.w); x += 1) {
            const offset = (y * imageWidth + x) * 4;
            data[offset] = 212;
            data[offset + 1] = 170;
            data[offset + 2] = 60;
            data[offset + 3] = 255;
          }
        }
        paintPortrait({
          x: box.x + box.w * frame,
          y: box.y + box.h * frame,
          w: box.w * (1 - frame * 2),
          h: box.h * (1 - frame * 2),
        });
        continue;
      }
      paintPortrait(box);
      if (assignment.border) {
        const x0 = Math.round(box.x);
        const y0 = Math.round(box.y);
        const x1 = Math.round(box.x + box.w);
        const y1 = Math.round(box.y + box.h);
        const mx = Math.round(box.w * 0.22);
        const my = Math.round(box.h * 0.22);
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            if (x < x0 + mx || x >= x1 - mx || y < y0 + my || y >= y1 - my) {
              const offset = (y * imageWidth + x) * 4;
              data[offset] = 12;
              data[offset + 1] = 10;
              data[offset + 2] = 16;
              data[offset + 3] = 255;
            }
          }
        }
      }
    }
  };
  const fillRect = (rect, color) => {
    const x0 = Math.round(rect.x * imageWidth);
    const y0 = Math.round(rect.y * imageHeight);
    const x1 = Math.round((rect.x + rect.w) * imageWidth);
    const y1 = Math.round((rect.y + rect.h) * imageHeight);
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const offset = (y * imageWidth + x) * 4;
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
        data[offset + 3] = 255;
      }
    }
  };
  if (assignment.lead === "user" || assignment.lead === "enemy") fillRect(LEAD_BANDS[assignment.lead], [212, 170, 60]);
  paintIds(regions.user, assignment.user);
  paintIds(regions.enemy, assignment.enemy);
  paintIds(regions.preban, assignment.prebans);
  paintIds(regions.actor, assignment.actor ? [assignment.actor] : []);
  paintIds(regions.skills, assignment.skills);
  if (assignment.turn === "user" || assignment.turn === "enemy") {
    const region = regions[assignment.turn];
    const ids = assignment[assignment.turn] || [];
    let index = 0;
    while (ids[index]) index += 1;
    if (index < region.slots) {
      fillSlot(data, imageWidth, slotBox(region, index, imageWidth, imageHeight), () => [236, 222, 170]);
    }
  }
  return data;
}
