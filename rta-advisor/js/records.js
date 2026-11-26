/** Finished RTA results, kept apart from the sandbox. */

export const MATCH_KEY = "rta-advisor-matches";

export function draftType(userIds, enemyIds, firstPick) {
  const clean = (ids) => [...new Set((ids || []).filter((id) => id && id !== "empty" && id !== "unknown"))].sort();
  const user = clean(userIds);
  const enemy = clean(enemyIds);
  if (user.length !== 4 || enemy.length !== 4) return null;
  return {
    key: `${firstPick ? "first" : "second"}|${user.join(",")}|${enemy.join(",")}`,
    user,
    enemy,
    firstPick: Boolean(firstPick),
  };
}

export function loadMatches(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(MATCH_KEY) || "null");
    const matches = Array.isArray(parsed?.matches) ? parsed.matches : [];
    return {
      matches: matches.filter((row) => row && row.type && (row.result === "win" || row.result === "loss")),
    };
  } catch {
    return { matches: [] };
  }
}

export function saveMatches(storage, book) {
  storage.setItem(MATCH_KEY, JSON.stringify({ matches: book.matches || [] }));
}

export function matchIdentity(draft) {
  const clean = (ids) => (ids || []).filter((id) => id && id !== "empty" && id !== "unknown");
  const prebans = clean(draft?.prebans).slice().sort();
  const enemyPrebans = clean(draft?.enemyPrebans).slice().sort();
  const userPicks = clean(draft?.userPicks);
  const enemyPicks = clean(draft?.enemyPicks);
  if (!prebans.length || !enemyPrebans.length || userPicks.length !== 5 || enemyPicks.length !== 5) return null;
  if (draft?.userFirst !== true && draft?.userFirst !== false) return null;
  return {
    key: `${draft.userFirst ? "first" : "second"}|pre:${prebans.join(",")}|epre:${enemyPrebans.join(",")}|u:${userPicks.join(">")}|e:${enemyPicks.join(">")}`,
    prebans,
    enemyPrebans,
    userPicks,
    enemyPicks,
    userFirst: draft.userFirst === true,
  };
}

export function recordResult(book, typeKey, result, matchId, detail) {
  if (result !== "win" && result !== "loss") throw new Error("結果只能是贏或輸");
  if (!typeKey) throw new Error("這場還沒有 4 對 4，不能記");
  const matches = (book.matches || []).slice();
  const key = detail?.key || "";
  let index = matchId ? matches.findIndex((row) => row.id === matchId) : -1;
  if (index < 0 && key) index = matches.findIndex((row) => row.key === key);
  const fields = detail ? {
    key,
    prebans: detail.prebans || [],
    enemyPrebans: detail.enemyPrebans || [],
    userPicks: detail.userPicks || [],
    enemyPicks: detail.enemyPicks || [],
    userFirst: detail.userFirst === true,
  } : {};
  if (index >= 0) {
    matches[index] = { ...matches[index], ...fields, type: typeKey, result };
    return { matches, id: matches[index].id, replaced: true };
  }
  const id = `${Date.now()}-${matches.length}`;
  matches.push({ id, type: typeKey, result, at: new Date().toISOString(), ...fields });
  return { matches, id, replaced: false };
}

export function rateForType(book, typeKey) {
  const rows = (book.matches || []).filter((row) => row.type === typeKey);
  const wins = rows.filter((row) => row.result === "win").length;
  const losses = rows.filter((row) => row.result === "loss").length;
  const total = wins + losses;
  return { wins, losses, total, rate: total ? wins / total : null };
}

export function chooseComposition(lines, book, cutoff, firstPick) {
  const scored = (lines || []).map((line) => {
    const key = draftType(line.draft?.userFight, line.draft?.enemyFight, firstPick)?.key || null;
    const stats = rateForType(book, key);
    return { line, key, stats, below: stats.rate != null && stats.rate < cutoff };
  });
  const best = scored[0];
  if (!best) return null;
  if (!best.below) return { ...best, switched: false, stuck: false, replaced: null };
  const next = scored.find((row) => !row.below);
  if (!next) return { ...best, switched: false, stuck: true, replaced: null };
  return { ...next, switched: true, stuck: false, replaced: best };
}
