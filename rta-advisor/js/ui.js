import { advise, counterEdges, describePlan, parseRoster } from "./engine.js";

const $ = (id) => document.getElementById(id);

let catalog = null;
let roster = null;

async function boot() {
  const res = await fetch("./data/catalog.json");
  catalog = await res.json();
  $("season").textContent = catalog.provenance.rtaSeasonLabel;
  $("patch").textContent = catalog.provenance.gamePatchAssumed;
  $("dataLine").textContent = `Fribbels ${catalog.provenance.fribbelsCommit.slice(0, 8)}（${catalog.provenance.fribbelsCommitDate}）`;
  const params = new URLSearchParams(location.search);
  if (params.get("example") === "fribbels") await loadExampleExport();
  else await loadSample();
  if (params.has("run")) $("run").click();
}

async function loadSample() {
  const res = await fetch("./data/sample-roster.json");
  const data = await res.json();
  $("rosterText").value = JSON.stringify(data, null, 2);
  applyRoster(data);
}

async function loadExampleExport() {
  const res = await fetch("./data/example-fribbels-export.json");
  const data = await res.json();
  $("rosterText").value = JSON.stringify(data, null, 2);
  applyRoster(data);
}

function readForm() {
  try {
    return JSON.parse($("rosterText").value);
  } catch (err) {
    throw new Error("名單不是合法的 JSON");
  }
}

function applyRoster(data) {
  roster = parseRoster(data, catalog);
  $("rosterState").textContent = roster.label
    ? `${roster.label}：${roster.heroes.length} 名可模擬英雄`
    : `已讀取 ${roster.heroes.length} 名可模擬英雄`;
  if (roster.warning) $("rosterState").textContent += `。${roster.warning}`;
  if (roster.unknown.length) {
    $("rosterState").textContent += `。這版核心沒有：${roster.unknown.join("、")}`;
  }
  renderGear();
  renderCounters();
}

function renderGear() {
  const root = $("gear");
  root.innerHTML = "";
  if (!roster) return;
  const byId = Object.fromEntries(catalog.heroes.map((h) => [h.id, h]));
  for (const hero of roster.heroes) {
    const def = byId[hero.id];
    const card = document.createElement("article");
    card.className = "card";
    const combo = def.rtaGear.setCombos?.[0];
    const art = def.rtaGear.artifacts?.[0];
    const metaSets = (combo?.names || []).map((n) => catalog.setZh[n] || n).join(" + ");
    const haveSets = (hero.sets || []).map((n) => catalog.setZh[n] || n).join("、") || "沒有讀到";
    const metaArt = artName(art?.names?.[0]);
    const haveArt = artName(hero.artifact) || "沒有讀到";
    const sameSet = combo && combo.names.every((n) => hero.sets.includes(n)) && hero.sets.every((n) => combo.names.includes(n));
    const sameArt = art && hero.artifact === art.names[0];
    const subs = (def.editorialGear.substatPriority || []).map(translateStat).join(" → ") || "這個來源沒有寫副屬性優先序";
    const mains = translateMains(def.editorialGear.mainsSentence) || "這個來源沒有寫主屬性";
    card.innerHTML = `
      <h3>${def.nameZh}</h3>
      <p class="meta">速度 ${hero.speed}　攻擊 ${hero.attack}　生命 ${hero.hp}　防禦 ${hero.defense}</p>
      <div class="split">
        <div>
          <h4>你現在</h4>
          <p>套裝：${haveSets}</p>
          <p>神器：${haveArt}</p>
          <p>暴擊 ${hero.crit} / 暴傷 ${hero.critDamage}　命中 ${hero.effectiveness}　抗性 ${hero.effectResistance}</p>
        </div>
        <div>
          <h4>建議調整</h4>
          <p>套裝：${sameSet ? "維持" : `改成 ${metaSets}`}（${combo ? combo.pickRate + "% 場次" : "無"}）</p>
          <p>神器：${sameArt ? "維持" : metaArt}（${art ? art.pickRate + "%" : "無"}）</p>
          <p>主屬性：${mains}</p>
          <p>副屬性優先：${subs}</p>
        </div>
      </div>
      <p class="note">套裝與神器是 ${catalog.provenance.rtaSeasonLabel}，頁面更新 ${def.rtaGear.updated || "見來源"}。<a href="${def.sources.rtaGear}">Epic7RTAStats</a></p>
      <p class="note">主屬性與副屬性是 Epic7Tools 的建議，不是賽季頻率。<a href="${def.sources.skillText}">技能與配裝頁</a></p>
    `;
    root.appendChild(card);
  }
}

function renderCounters() {
  const root = $("counters");
  const edges = counterEdges(catalog).filter((e) => e.kind !== "element").slice(0, 12);
  const byId = Object.fromEntries(catalog.heroes.map((h) => [h.id, h]));
  root.innerHTML = edges.map((e) => `<li><strong>${byId[e.from].nameZh}</strong> 對 <strong>${byId[e.to].nameZh}</strong>：${e.why}</li>`).join("");
}

function artName(name) {
  if (!name) return "";
  const found = Object.values(catalog.artifactNames).find((a) => a.name === name);
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
  if (!sentence || sentence === "None") return "";
  const phrases = sentence
    .replaceAll(", as the healing follows it", "（治療跟著這項）")
    .replaceAll(", as the damage follows it", "（傷害跟著這項）")
    .replaceAll(", as healing and barrier follow it", "（治療和護盾跟著這項）")
    .replaceAll(", as the damage and barrier follow it", "（傷害和護盾跟著這項）")
    .replaceAll(", as every landed hit crits", "（命中都會暴擊）")
    .replaceAll(", as everything follows it", "（各項都跟著這項）")
    .replaceAll(", as Elvira never crits", "（她不會暴擊）")
    .replaceAll(" for the barrier", "（護盾用）")
    .replaceAll("To stay up while the offering ally takes the damage", "要撐住，因為獻祭的隊友會吃下傷害")
    .replaceAll(": Speed is not needed in PvP", "。競技場不需要速度")
    .replaceAll("Health elsewhere", "其他部位放生命")
    .replaceAll("on the necklace and ring", "放在項鍊和戒指")
    .replaceAll("on the ring and boots", "放在戒指和鞋子")
    .replaceAll("on the necklace", "放在項鍊")
    .replaceAll("on the ring", "放在戒指")
    .replaceAll("on the boots", "放在鞋子")
    .replaceAll("boots", "鞋子")
    .replaceAll(" and ", "、");
  return translateStat(phrases)
    .replaceAll("Crit Damage", "暴擊傷害")
    .replaceAll("Crit Chance", "暴擊率");
}

function renderAdvice(result) {
  const root = $("advice");
  if (!result.ok) {
    root.innerHTML = `<p class="warn">${result.reason}</p>`;
    return;
  }
  const byId = Object.fromEntries(catalog.heroes.map((h) => [h.id, h]));
  const best = result.best;
  const pct = Math.round(best.rate * 100);
  const plan = describePlan(best.plan);
  const steps = best.draft.steps.map((step, index) => {
    const hero = byId[step.id].nameZh;
    const who = step.side === "user" ? "你" : "對手";
    const mark = step.protected ? "（保護，不能被最後禁）" : "";
    return `<li>${index + 1}. ${who}選 ${hero}${mark}</li>`;
  }).join("");
  const fight = best.draft.userFight.map((id) => byId[id].nameZh).join("、");
  const enemy = best.draft.enemyFight.map((id) => byId[id].nameZh).join("、");
  const log = (best.log?.log || []).map((line) => `<li>${line}</li>`).join("");
  root.innerHTML = `
    <p class="rate">估計勝率 ${pct}%</p>
    <p class="warn">這是沙盤試出來的比例，不是必勝。換一批亂數或對手面板，數字會動。</p>
    <p><strong>主要原因：</strong>${best.reason.summary}</p>
    <ul class="reasons">${best.reason.lines.map((line) => `<li>${line}</li>`).join("")}</ul>
    <h3>預禁</h3>
    <p>你禁 ${best.userPre.map((id) => byId[id].nameZh).join("、")}。對手參考預禁 ${best.enemyPre.map((id) => byId[id].nameZh).join("、")}。</p>
    <h3>選角順序</h3>
    <ol>${steps}</ol>
    <p>最後你禁 ${byId[best.draft.userBan].nameZh}，對手禁 ${byId[best.draft.enemyBan].nameZh}。</p>
    <p>上場：你 ${fight}。對手 ${enemy}。</p>
    <h3>技能與燒魂</h3>
    <p>順序：${plan.order}</p>
    <p>燒魂：${plan.burn}</p>
    <h3>一場沙盤</h3>
    <p>結果：${best.log.winner === "user" ? "你這場沙盤打下" : best.log.winner === "enemy" ? "這場沙盤你落下" : "這場在回合上限內沒有分出勝負"}。第一動是 ${best.log.firstActor}。</p>
    <p>結束時生命：你方 ${best.log.userHp}。對方 ${best.log.enemyHp}。</p>
    <ol class="log">${log}</ol>
  `;
}

$("loadSample").addEventListener("click", () => loadSample().catch(showError));
$("loadExample").addEventListener("click", () => loadExampleExport().catch(showError));
$("file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  $("rosterText").value = await file.text();
  try {
    applyRoster(readForm());
  } catch (err) {
    showError(err);
  }
});
$("applyText").addEventListener("click", () => {
  try {
    applyRoster(readForm());
  } catch (err) {
    showError(err);
  }
});
$("run").addEventListener("click", () => {
  try {
    if (!roster) applyRoster(readForm());
    $("advice").innerHTML = "<p>正在跑選角和戰鬥沙盤…</p>";
    const result = advise(catalog, roster, {
      rank: $("rank").value,
      firstPick: $("first").value === "first",
      assumeMaxEnhance: $("maxEnhance").checked,
      trials: 6,
    });
    renderAdvice(result);
  } catch (err) {
    showError(err);
  }
});

function showError(err) {
  $("advice").innerHTML = `<p class="warn">${err.message || err}</p>`;
}

boot().catch(showError);
