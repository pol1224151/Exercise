/** Screen reading for the RTA advisor. Live draft cards are found by the Lv.60 label and named from the text on the card. The portrait grid below is only for the old fixture checks. */

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

function levelOrange(red, green, blue) {
  return red > 200 && green > 100 && green < 200 && blue < 110 && red > green + 15 && green - blue > 30;
}

function draftBlobs(data, imageWidth, imageHeight) {
  const rad = Math.max(1, Math.round(imageHeight / 280));
  const minPts = Math.max(8, Math.floor(0.00003 * imageHeight * imageHeight));
  const visited = new Uint8Array(imageWidth * imageHeight);
  const blobs = [];
  for (let y = 0; y < imageHeight; y += 1) {
    for (let x = 0; x < imageWidth; x += 1) {
      const start = y * imageWidth + x;
      if (visited[start]) continue;
      const origin = start * 4;
      if (!levelOrange(data[origin], data[origin + 1], data[origin + 2])) continue;
      const queue = [x, y];
      visited[start] = 1;
      let head = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let count = 0;
      while (head < queue.length) {
        const cx = queue[head];
        const cy = queue[head + 1];
        head += 2;
        count += 1;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (let dy = -rad; dy <= rad; dy += 1) {
          const ny = cy + dy;
          if (ny < 0 || ny >= imageHeight) continue;
          for (let dx = -rad; dx <= rad; dx += 1) {
            const nx = cx + dx;
            if (nx < 0 || nx >= imageWidth) continue;
            const index = ny * imageWidth + nx;
            if (visited[index]) continue;
            const offset = index * 4;
            if (!levelOrange(data[offset], data[offset + 1], data[offset + 2])) continue;
            visited[index] = 1;
            queue.push(nx, ny);
          }
        }
      }
      if (count < minPts) continue;
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (bh < 0.012 * imageHeight || bh > 0.034 * imageHeight) continue;
      if (bw > 0.045 * imageHeight || bw >= bh * 2.2) continue;
      blobs.push({ x: minX, y: minY, w: bw, h: bh });
    }
  }
  return blobs;
}

function draftLines(blobs, imageHeight) {
  const pending = [...blobs].sort((left, right) => left.y - right.y || left.x - right.x);
  const used = new Array(pending.length).fill(false);
  const yTol = 0.012 * imageHeight;
  const gap = 0.03 * imageHeight;
  const lines = [];
  for (let index = 0; index < pending.length; index += 1) {
    if (used[index]) continue;
    const line = [pending[index]];
    used[index] = true;
    let grew = true;
    while (grew) {
      grew = false;
      const mid = line.reduce((sum, blob) => sum + blob.y + blob.h / 2, 0) / line.length;
      const x0 = Math.min(...line.map((blob) => blob.x));
      const x1 = Math.max(...line.map((blob) => blob.x + blob.w));
      for (let other = 0; other < pending.length; other += 1) {
        if (used[other]) continue;
        const blob = pending[other];
        if (Math.abs(blob.y + blob.h / 2 - mid) > yTol) continue;
        if (blob.x > x1 + gap || blob.x + blob.w < x0 - gap) continue;
        used[other] = true;
        line.push(blob);
        grew = true;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function findDraftCards(data, imageWidth, imageHeight) {
  const lines = draftLines(draftBlobs(data, imageWidth, imageHeight), imageHeight);
  const cards = [];
  for (const line of lines) {
    const x0 = Math.min(...line.map((blob) => blob.x));
    const x1 = Math.max(...line.map((blob) => blob.x + blob.w));
    const y0 = Math.min(...line.map((blob) => blob.y));
    const y1 = Math.max(...line.map((blob) => blob.y + blob.h));
    const tw = x1 - x0;
    const th = Math.max(1, y1 - y0);
    if (line.length < 3 || line.length > 5) continue;
    if (tw < 0.048 * imageHeight || tw > 0.1 * imageHeight) continue;
    if (th < 0.015 * imageHeight || tw / th >= 6.5) continue;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    if (cx < 0.12 * imageWidth || cx > 0.8 * imageWidth) continue;
    const side = cx < imageWidth * 0.5 ? "user" : "enemy";
    const left = side === "user" ? cx - th * 12 : cx - th * 3.2;
    const top = cy - th * 2.6;
    const boxW = th * 15.2;
    const boxH = th * 6.2;
    const x = Math.max(0, left / imageWidth);
    const y = Math.max(0, top / imageHeight);
    const right = Math.min(1, (left + boxW) / imageWidth);
    const bottom = Math.min(1, (top + boxH) / imageHeight);
    cards.push({ side, x, y, w: Math.max(0.02, right - x), h: Math.max(0.02, bottom - y), letters: line.length });
  }
  cards.sort((left, right) => left.y - right.y || left.x - right.x);
  const kept = [];
  for (const card of cards) {
    const near = kept.find((other) => Math.abs(other.y - card.y) < 0.04 && Math.abs(other.x - card.x) < 0.08);
    if (!near) kept.push(card);
  }
  return kept;
}

export function cardSignature(data, imageWidth, imageHeight, card) {
  const cols = 12;
  const rows = 8;
  const x0 = Math.max(0, Math.round(card.x * imageWidth));
  const y0 = Math.max(0, Math.round(card.y * imageHeight));
  const width = Math.max(1, Math.round(card.w * imageWidth));
  const height = Math.max(1, Math.round(card.h * imageHeight));
  const values = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const left = x0 + Math.floor((col * width) / cols);
      const right = Math.max(left + 1, x0 + Math.floor(((col + 1) * width) / cols));
      const top = y0 + Math.floor((row * height) / rows);
      const bottom = Math.max(top + 1, y0 + Math.floor(((row + 1) * height) / rows));
      let sum = 0;
      let count = 0;
      for (let y = top; y < bottom && y < imageHeight; y += 1) {
        for (let x = left; x < right && x < imageWidth; x += 1) {
          const offset = (y * imageWidth + x) * 4;
          sum += (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
          count += 1;
        }
      }
      values.push(count ? Math.round(sum / count) : 0);
    }
  }
  return values;
}

export function signatureKey(signature) {
  return signature.map((value) => Math.round(value / 12)).join(".");
}

function signatureDistance(left, right) {
  if (!left || !right || left.length !== right.length) return Infinity;
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += Math.abs(left[index] - right[index]);
  return sum / left.length;
}

export function matchCardMemory(signature, memories) {
  let best = null;
  let bestDistance = 16;
  for (const row of memories || []) {
    const distance = signatureDistance(signature, row?.sig);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = row.id;
    }
  }
  return best;
}

let memorySerial = 0;

export function rememberCard(memories, signature, id, place = {}) {
  const next = (memories || []).filter((row) => signatureDistance(signature, row?.sig) > 14);
  memorySerial += 1;
  const token = place.token || `card-${memorySerial}`;
  next.unshift({
    id,
    sig: [...signature],
    text: place.text || "",
    side: place.side || "",
    x: place.x,
    y: place.y,
    w: place.w,
    h: place.h,
    token,
  });
  return next.slice(0, 40);
}

function centerDistance(left, right) {
  if (![left?.x, left?.y, left?.w, left?.h, right?.x, right?.y, right?.w, right?.h].every((value) => typeof value === "number")) return Infinity;
  const dx = (left.x + left.w / 2) - (right.x + right.w / 2);
  const dy = (left.y + left.h / 2) - (right.y + right.h / 2);
  return Math.hypot(dx, dy);
}

export function bindRememberedCards(cards, memories) {
  const pool = (memories || []).map((row) => ({ ...row, used: false }));
  const bound = (cards || []).map((card) => ({ ...card, remembered: false, memoryToken: "" }));
  for (const card of bound) {
    let best = null;
    let bestDistance = 16;
    for (const row of pool) {
      if (row.used) continue;
      const distance = signatureDistance(card.signature, row.sig);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = row;
      }
    }
    if (!best) continue;
    best.used = true;
    card.id = best.id;
    card.text = card.text || best.text || "";
    card.remembered = true;
    card.memoryToken = best.token || "";
  }
  for (const card of bound) {
    if (card.remembered) continue;
    let best = null;
    let bestCenter = 0.08;
    for (const row of pool) {
      if (row.used || (row.side && row.side !== card.side)) continue;
      const center = centerDistance(card, row);
      const distance = signatureDistance(card.signature, row.sig);
      if (center < bestCenter && distance < 48) {
        bestCenter = center;
        best = row;
      }
    }
    if (!best) continue;
    best.used = true;
    card.id = best.id;
    card.text = card.text || best.text || "";
    card.remembered = true;
    card.memoryToken = best.token || "";
  }
  return bound;
}

export function refreshCardMemory(memories, cards) {
  const next = (memories || []).map((row) => ({ ...row, sig: Array.isArray(row.sig) ? [...row.sig] : row.sig }));
  for (const card of cards || []) {
    if (!card?.memoryToken || !card.remembered) continue;
    const row = next.find((item) => item.token === card.memoryToken);
    if (!row || !Array.isArray(card.signature)) continue;
    row.sig = [...card.signature];
    row.text = card.text || row.text || "";
    row.side = card.side || row.side;
    row.x = card.x;
    row.y = card.y;
    row.w = card.w;
    row.h = card.h;
  }
  return next;
}

export function namedReading(signature, rows) {
  let best = null;
  let bestDistance = 16;
  for (const row of rows || []) {
    const distance = signatureDistance(signature, row?.sig);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = row;
    }
  }
  return best;
}

export function matchNamedCard(signature, rows) {
  const row = namedReading(signature, rows);
  if (!row) return undefined;
  return row.id || "";
}

export function matchHeroName(text, heroes) {
  const compact = String(text || "").replace(/[\s.。·・,，:：|/\\]/g, "");
  if (compact.length < 2) return null;
  const lower = compact.toLowerCase();
  const hits = [];
  for (const hero of heroes || []) {
    const zh = String(hero.nameZh || "").replace(/\s/g, "");
    const en = String(hero.name || "").replace(/\s/g, "");
    const zhHit = zh.length >= 2 && compact.includes(zh);
    const enHit = en.length >= 4 && lower.includes(en.toLowerCase());
    if (zhHit || enHit) hits.push(hero.id);
  }
  const unique = [...new Set(hits)];
  return unique.length === 1 ? unique[0] : null;
}

function bandFraction(data, imageWidth, imageHeight, rect, pred) {
  const x0 = Math.max(0, Math.round(rect.x * imageWidth));
  const y0 = Math.max(0, Math.round(rect.y * imageHeight));
  const x1 = Math.min(imageWidth, Math.round((rect.x + rect.w) * imageWidth));
  const y1 = Math.min(imageHeight, Math.round((rect.y + rect.h) * imageHeight));
  let hit = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const offset = (y * imageWidth + x) * 4;
      count += 1;
      if (pred(data[offset], data[offset + 1], data[offset + 2])) hit += 1;
    }
  }
  return count ? hit / count : 0;
}

function blueText(red, green, blue) {
  return blue > red + 35 && blue > 90 && green > 40 && blue > green;
}

function redText(red, green, blue) {
  return red > 170 && red > blue + 50 && green < 140;
}

function goldText(red, green, blue) {
  return red > 180 && green > 140 && blue < 120 && red + green > blue * 3;
}

export function readDraftTurn(data, imageWidth, imageHeight) {
  const band = { x: 0.28, y: 0.02, w: 0.44, h: 0.2 };
  const blue = bandFraction(data, imageWidth, imageHeight, band, blueText);
  const red = bandFraction(data, imageWidth, imageHeight, band, redText);
  if (blue >= 0.008 && blue > red * 1.5) return "user";
  if (red >= 0.008 && red > blue * 1.5) return "enemy";
  return null;
}

export function readDraftLead(data, imageWidth, imageHeight) {
  const left = bandFraction(data, imageWidth, imageHeight, { x: 0.04, y: 0.0, w: 0.28, h: 0.12 }, goldText);
  const right = bandFraction(data, imageWidth, imageHeight, { x: 0.68, y: 0.0, w: 0.28, h: 0.12 }, goldText);
  if (left >= 0.02 && left >= right * 2.5) return "user";
  if (right >= 0.02 && right >= left * 2.5) return "enemy";
  return null;
}

export function readDraft(data, imageWidth, imageHeight, memories = [], names = []) {
  const found = findDraftCards(data, imageWidth, imageHeight);
  const signed = found.map((card) => {
    const signature = cardSignature(data, imageWidth, imageHeight, card);
    return { ...card, signature, key: signatureKey(signature), id: "unknown", text: "" };
  });
  const cards = bindRememberedCards(signed, memories).map((card) => {
    const reading = namedReading(card.signature, names);
    if (card.remembered) return { ...card, text: reading?.text || card.text || "" };
    return { ...card, id: reading?.id || "unknown", text: reading?.text || "" };
  });
  const userCards = cards.filter((card) => card.side === "user");
  const enemyCards = cards.filter((card) => card.side === "enemy");
  const face = (card, index) => ({
    side: card.side,
    index,
    id: card.id,
    text: card.text || "",
    signature: card.signature,
    key: card.key,
    x: card.x,
    y: card.y,
    w: card.w,
    h: card.h,
  });
  const read = {
    user: userCards.map((card) => card.id),
    enemy: enemyCards.map((card) => card.id),
    prebans: [],
    actorId: "empty",
    skillsReady: [false, false, false],
    yourTurn: false,
    turnSide: readDraftTurn(data, imageWidth, imageHeight),
    leadSide: readDraftLead(data, imageWidth, imageHeight),
    cards,
    faces: [
      ...userCards.map((card, index) => face(card, index)),
      ...enemyCards.map((card, index) => face(card, index)),
    ],
  };
  read.phase = inferPhase(read);
  return read;
}
