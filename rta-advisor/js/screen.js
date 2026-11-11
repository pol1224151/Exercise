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

export function matchPortrait(rgb, book) {
  if (spatialStdev(rgb) < (book.emptyStdevBelow ?? 18)) return "empty";
  let best = null;
  let second = null;
  for (const portrait of book.portraits) {
    const distance = centerDistance(rgb, portrait.rgb);
    const row = { id: portrait.id, distance };
    if (!best || distance < best.distance) {
      second = best;
      best = row;
    } else if (!second || distance < second.distance) {
      second = row;
    }
  }
  if (!best || best.distance > book.maxDistance) return "unknown";
  if (second && second.distance < best.distance * 1.2) return "unknown";
  return best.id;
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

function readSlots(data, imageWidth, imageHeight, region, book) {
  const found = [];
  for (let index = 0; index < region.slots; index += 1) {
    const box = slotBox(region, index, imageWidth, imageHeight);
    const rgb = signatureFromRgba(data, imageWidth, box.x, box.y, box.w, box.h);
    found.push(matchPortrait(rgb, book));
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

export function readFrame(data, imageWidth, imageHeight, regions, book) {
  const user = readSlots(data, imageWidth, imageHeight, regions.user, book);
  const enemy = readSlots(data, imageWidth, imageHeight, regions.enemy, book);
  const prebans = readSlots(data, imageWidth, imageHeight, regions.preban, book);
  const actor = readSlots(data, imageWidth, imageHeight, regions.actor, book)[0];
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
      fillSlot(data, imageWidth, box, (gx, gy) => {
        const offset = (gy * 8 + gx) * 3;
        return [0, 1, 2].map((channel) => Math.max(0, Math.min(255, Math.round(portrait.rgb[offset + channel] * scale))));
      });
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
