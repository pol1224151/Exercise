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

export function recordResult(book, typeKey, result, matchId) {
  if (result !== "win" && result !== "loss") throw new Error("結果只能是贏或輸");
  if (!typeKey) throw new Error("這場還沒有 4 對 4，不能記");
  const matches = (book.matches || []).slice();
  if (matchId) {
    const index = matches.findIndex((row) => row.id === matchId);
    if (index >= 0) {
      matches[index] = { ...matches[index], type: typeKey, result };
      return { matches, id: matchId };
    }
  }
  const id = `${Date.now()}-${matches.length}`;
  matches.push({ id, type: typeKey, result, at: new Date().toISOString() });
  return { matches, id };
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
