/** Screen reading for the RTA advisor. A slot is shrunk to the hero-library grid, then compared by face shape and color blocks. */

// Fractions of the captured 16:9 frame, measured on the STOVE draft.
// Slots in a row share one height and split the width, so resizing the window stays on the portraits.
export const DEFAULT_REGIONS = {
  user: { x: 0.319, y: 0.714, w: 0.255, h: 0.091, slots: 5, axis: "row", label: "我方" },
  enemy: { x: 0.574, y: 0.714, w: 0.255, h: 0.091, slots: 5, axis: "row", label: "對方" },
  preban: { x: 0.312, y: 0.889, w: 0.102, h: 0.091, slots: 2, axis: "row", label: "預禁" },
  skills: { x: 0.56, y: 0.90, w: 0.18, h: 0.08, slots: 3, axis: "row", label: "技能" },
  actor: { x: 0.48, y: 0.889, w: 0.051, h: 0.091, slots: 1, axis: "row", label: "現在行動" },
};

export const LEAD_BANDS = {
  user: { x: 0.319, y: 0.672, w: 0.255, h: 0.04 },
  enemy: { x: 0.574, y: 0.672, w: 0.255, h: 0.04 },
};

export function slotFrame(region, index) {
  const count = Math.max(1, region?.slots || 1);
  if (region?.axis === "row") {
    const width = region.w / count;
    return { x: region.x + width * index, y: region.y, w: width, h: region.h };
  }
  const height = region.h / count;
  return { x: region.x, y: region.y + height * index, w: region.w, h: height };
}

export function liveStateKey(recognition) {
  const slot = (id) => (id && id !== "empty" ? id : "");
  return JSON.stringify({
    user: (recognition?.user || []).map(slot),
    enemy: (recognition?.enemy || []).map(slot),
    prebans: (recognition?.prebans || []).map(slot),
    actor: slot(recognition?.actorId),
  });
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

function vectorDistance(left, right) {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    const delta = left[index] - right[index];
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

function faceFeatures(rgb) {
  const values = [];
  for (let y = 2; y < 6; y += 1) {
    for (let x = 2; x < 6; x += 1) {
      const index = (y * 8 + x) * 3;
      values.push((rgb[index] + rgb[index + 1] + rgb[index + 2]) / 3);
    }
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const deviation = stdev(values) || 1;
  return values.map((value) => (value - mean) / deviation);
}

function colorBlocks(rgb) {
  const blocks = [];
  for (let blockY = 0; blockY < 2; blockY += 1) {
    for (let blockX = 0; blockX < 2; blockX += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let y = 2 + blockY * 2; y < 4 + blockY * 2; y += 1) {
        for (let x = 2 + blockX * 2; x < 4 + blockX * 2; x += 1) {
          const index = (y * 8 + x) * 3;
          red += rgb[index];
          green += rgb[index + 1];
          blue += rgb[index + 2];
        }
      }
      const sum = red + green + blue || 1;
      blocks.push(red / sum, green / sum, blue / sum);
    }
  }
  return blocks;
}

function portraitView(rgb) {
  return { face: faceFeatures(rgb), color: colorBlocks(rgb) };
}

function libraryViews(book) {
  if (book.featureViews) return book;
  const views = book.portraits.map((portrait) => ({ id: portrait.id, ...portraitView(portrait.rgb) }));
  let faceGap = Infinity;
  let colorGap = Infinity;
  for (let left = 0; left < views.length; left += 1) {
    for (let right = left + 1; right < views.length; right += 1) {
      faceGap = Math.min(faceGap, vectorDistance(views[left].face, views[right].face));
      colorGap = Math.min(colorGap, vectorDistance(views[left].color, views[right].color));
    }
  }
  book.featureViews = views;
  book.faceGap = faceGap;
  book.colorGap = colorGap;
  return book;
}

function rankViews(view, rows) {
  let best = null;
  let second = null;
  for (const row of rows) {
    const score = {
      id: row.id,
      face: vectorDistance(view.face, row.face),
      color: vectorDistance(view.color, row.color),
    };
    if (!best || score.face < best.face) {
      second = best;
      best = score;
    } else if (!second || score.face < second.face) {
      second = score;
    }
  }
  return { best, second };
}

function clearName(ranked, book) {
  if (!ranked.best) return null;
  const faceLimit = book.faceGap * 0.5;
  if (ranked.best.face >= faceLimit) return null;
  if (ranked.second && ranked.second.face < Math.max(faceLimit, ranked.best.face * 2)) return null;
  if (ranked.second && ranked.best.color > ranked.second.color) return null;
  return ranked.best.id;
}

function identify(rgb, book, corrections) {
  const view = portraitView(rgb);
  const prepared = libraryViews(book);
  const memory = (corrections || []).filter((row) => row?.id && row?.rgb).map((row) => ({ id: row.id, ...portraitView(row.rgb) }));
  const remembered = clearName(rankViews(view, memory), prepared);
  if (remembered) return remembered;
  return clearName(rankViews(view, prepared.featureViews), prepared) || "unknown";
}

export function rememberCorrection(list, rgb, id) {
  const face = faceFeatures(rgb);
  const next = (list || []).filter((row) => !row?.rgb || vectorDistance(face, faceFeatures(row.rgb)) > 0.2);
  next.push({ id, rgb: [...rgb] });
  return next.slice(-40);
}

export function matchPortrait(rgb, book) {
  if (spatialStdev(rgb) < (book.emptyStdevBelow ?? 18)) return "empty";
  return identify(rgb, book, []);
}

function matchBox(data, imageWidth, box, book, corrections) {
  const full = signatureFromRgba(data, imageWidth, box.x, box.y, box.w, box.h);
  if (spatialStdev(full) < (book.emptyStdevBelow ?? 18)) return { id: "empty", rgb: full };
  return { id: identify(full, book, corrections), rgb: full };
}

function slotBox(region, index, imageWidth, imageHeight) {
  const frame = slotFrame(region, index);
  return {
    x: Math.round(frame.x * imageWidth),
    y: Math.round(frame.y * imageHeight),
    w: Math.max(1, Math.round(frame.w * imageWidth)),
    h: Math.max(1, Math.round(frame.h * imageHeight)),
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
  return slots.map((slot, index) => {
    const box = slotBox(region, index, imageWidth, imageHeight);
    return {
      side,
      index,
      id: slot.id,
      rgb: slot.rgb,
      x: box.x / imageWidth,
      y: box.y / imageHeight,
      w: box.w / imageWidth,
      h: box.h / imageHeight,
    };
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
