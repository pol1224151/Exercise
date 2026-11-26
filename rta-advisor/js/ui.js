import { GEAR_ASK, battleBrief, buildGearReport, clearAccount, counterEdges, effectGapItems, guidedDraft, loadAccount, loadEffectNotes, matchesPicker, parseRoster, readAccountText, rosterReadLine, saveAccount, saveEffectNotes, selectableHeroes, sourceBasis } from "./engine.js";
import { draftType, loadMatches, matchIdentity, rateForType, recordResult, saveMatches } from "./records.js";

const $ = (id) => document.getElementById(id);

let catalog = null;
let roster = null;
let lastAdvice = null;
let openRecord = null;
let pendingSlot = null;
let pickerIds = null;
let manual = blankDraft();
let guideKey = "";

function blankDraft(userFirst = null) {
  return {
    userFirst: userFirst === true || userFirst === false ? userFirst : null,
    userPicks: [],
    enemyPicks: [],
    prebans: [],
    prebansDone: false,
    enemyPrebans: [],
    enemyPrebansDone: false,
    userBanId: null,
    enemyBanId: null,
    steps: [],
    filledNote: "",
    exclusiveNote: "",
    effectNotes: loadEffectNotes(localStorage),
    mode: "quick",
  };
}

async function boot() {
  const [catalogRes, versionRes, seasonRes, compRes] = await Promise.all([
    fetch("./data/catalog.json"),
    fetch("./data/version.json"),
    fetch("./data/season-heroes.json"),
    fetch("./data/season-comps.json"),
  ]);
  catalog = await catalogRes.json();
  if (seasonRes.ok) {
    const season = await seasonRes.json();
    catalog.seasonHeroes = Array.isArray(season.heroes) ? season.heroes : [];
  } else {
    catalog.seasonHeroes = [];
  }
  catalog.seasonComps = compRes.ok ? await compRes.json() : null;
  const version = versionRes.ok ? await versionRes.json() : sourceBasis(catalog).version;
  renderVersion(version);
  renderCounters();
  const params = new URLSearchParams(location.search);
  if (params.get("account") === "example") await loadExample();
  else if (params.get("account") === "sample") await loadSample();
  else restoreAccount();
}

function renderVersion(version) {
  const commit = (version.fribbelsCommit || "").slice(0, 8);
  const text = [
    `資料版本 ${version.fetchedOn || "尚未更新"}`,
    `賽季 ${version.seasonLabel || version.season || "沒有"}（${version.season || "無代號"}）`,
    `遊戲版本 ${version.patchZh || version.patch || "沒有"}`,
    `Fribbels ${commit || "沒有"}（${version.fribbelsCommitDate || "無日期"}）`,
    `英雄資料庫 ${version.heroCount || catalog.database?.length || 0} 名，本季會出現 ${catalog.seasonHeroes?.length || 0} 名，賽季模型 ${version.metaCount || 0} 名，神器 ${version.artifactCount || 0}`,
  ].join("。");
  $("versionLine").textContent = text;
  $("season").textContent = version.seasonLabel || "";
  $("patch").textContent = version.patchZh || version.patch || "";
  $("dataLine").textContent = commit ? `Fribbels ${commit}（${version.fribbelsCommitDate || ""}）` : "";
}

async function loadExample() {
  const res = await fetch("./data/example-fribbels-export.json");
  const data = await res.json();
  $("rosterText").value = JSON.stringify(data, null, 2);
  applyRoster(data);
}

async function loadSample() {
  const res = await fetch("./data/sample-roster.json");
  const data = await res.json();
  $("rosterText").value = JSON.stringify(data, null, 2);
  applyRoster(data);
}

function restoreAccount() {
  let saved = null;
  try {
    saved = loadAccount(localStorage);
  } catch {
    saved = null;
  }
  if (!saved) return;
  $("rosterText").value = JSON.stringify(saved, null, 2);
  applyRoster(saved, "saved");
}

function applyRoster(data, source = "import") {
  roster = parseRoster(data, catalog);
  const bits = [`已讀入 ${roster.heroes.length} 名可對照的英雄`];
  if (roster.label) bits.unshift(roster.label);
  if (roster.warning) bits.push(roster.warning);
  if (roster.unknown.length) bits.push(`這版賽季模型沒有：${roster.unknown.join("、")}`);
  if (source === "saved") {
    bits.push("這是這台瀏覽器上次存的帳號，沒有重新匯入");
  } else {
    try {
      saveAccount(localStorage, data);
      bits.push("已存在這台瀏覽器，下次打開不用再匯入");
    } catch {
      bits.push("這台瀏覽器存不下這份檔，下次還是要再讀一次");
    }
  }
  $("rosterState").textContent = `${bits.map((bit) => bit.replace(/。$/, "")).join("。")}。`;
  renderGear();
  renderEffectGaps();
  guideKey = "";
  lastAdvice = null;
  if (!roster.heroes.length) {
    const missing = roster.unknown.length ? `這版賽季模型沒有：${roster.unknown.slice(0, 4).join("、")}。` : "檔案裡沒有可對照的英雄。";
    showCard({ action: "匯入沒有對上英雄", rate: "尚無勝率", reason: missing, click: "import" });
  } else {
    showReadyCard();
  }
}

function renderGear() {
  const root = $("gear");
  if (!roster?.heroes.length) {
    root.innerHTML = "<p>先讀入帳號，才會對照賽季配裝。</p>";
    return;
  }
  const byId = Object.fromEntries([
    ...(catalog.database || []),
    ...(catalog.seasonHeroes || []),
    ...catalog.heroes,
  ].map((hero) => [hero.id, hero]));
  const modeled = roster.heroes.filter((hero) => byId[hero.id]?.rtaGear);
  const rest = roster.heroes.filter((hero) => !byId[hero.id]?.rtaGear);
  const cards = modeled.map((hero) => {
    const def = byId[hero.id];
    const report = buildGearReport(hero, def, catalog, roster);
    if (report.foreign) {
      return `<article class="card">
        <h3>${def.nameZh}</h3>
        <div class="split">
          <div><h4>你現在</h4><p>這不是你的面板。</p></div>
          <div><h4>建議調整</h4>${report.changes.map((line) => `<p>${line}</p>`).join("")}</div>
        </div>
        <p class="note">${report.editorialNote}</p>
      </article>`;
    }
    const have = report.haveSets.join("、") || "沒有讀到";
    const mains = report.mains || "這個來源沒有寫主屬性";
    const subs = report.substatPriority.join(" → ") || "這個來源沒有寫副屬性優先序";
    return `<article class="card">
      <h3>${def.nameZh}</h3>
      <p class="meta">你穿上的速度 ${hero.speed}　攻擊 ${hero.attack}　生命 ${hero.hp}　防禦 ${hero.defense}</p>
      <div class="split">
        <div>
          <h4>你現在</h4>
          <p>套裝：${have}</p>
          <p>神器：${report.haveArtifact || "沒有讀到"}</p>
        </div>
        <div>
          <h4>建議調整</h4>
          ${report.changes.map((line) => `<p>${line}</p>`).join("")}
          <p>主屬性：${mains}</p>
          <p>副屬性優先：${subs}</p>
        </div>
      </div>
      <p class="note">${report.editorialNote} 賽季 ${catalog.provenance.rtaSeasonLabel}。</p>
    </article>`;
  }).join("");
  const extra = rest.length
    ? `<p>帳號裡另有 ${rest.length} 名英雄沒有這一季的配裝統計，不建議裝備，也不編倍率。</p>`
    : "";
  root.innerHTML = cards + extra;
}

function onePickWhy(result) {
  const lines = result?.reason?.lines || [];
  const top = lines.find((row) => /^\d+\.\s/.test(row)) || "";
  const body = top.includes("理由：") ? top.split("理由：").slice(1).join("理由：") : "";
  const sentences = body.split("。").map((part) => part.trim()).filter(Boolean);
  const noisy = /技能|頁上|一技|二技|大招|專武|開場|練度|風險|這一手|我方先|我方後|我方還沒|和已選|效果不確定|烙印|神器 /;
  const preferred = sentences.find((part) => /^(冷卻：|勝場：|對戰：|協同：|替代：|計數器：|反制：)/.test(part) && !noisy.test(part));
  const picked = preferred || sentences.find((part) => !noisy.test(part));
  if (picked) return `${picked}。`;
  if (sentences.some((part) => part.startsWith("對方還沒選"))) return "對方還沒選，先從有配裝的角色裡挑。";
  return "從有配裝的角色裡挑。";
}

function adviceFace(result) {
  const kind = result?.action?.kind;
  const names = (result?.action?.ids || []).map((id) => heroName(id)).filter(Boolean);
  if (kind === "preban") {
    return { action: names.join("、"), reason: "依 e7rtabot 事先禁用率挑。", click: "preban" };
  }
  if (kind === "enemy-preban") {
    return { action: result.action?.title || "選對方的預禁", reason: "請選對方預禁的人。", click: "enemy-preban" };
  }
  if (kind === "pick" && result.action?.report) {
    return { action: names[0] || "不確定", reason: result.action.report, click: "" };
  }
  if (kind === "pick" && result.action?.forecast) {
    const who = names.length ? names.join("、") : "不確定";
    const reason = [result.action.forecast, result.action.forecastReason].filter(Boolean).join("");
    return { action: who, reason, click: "" };
  }
  if (kind === "pick" && Array.isArray(result.action?.plans) && result.action.plans.length) {
    const plans = result.action.plans;
    const action = plans.map((plan) => {
      const planNames = (plan.ids || []).map((id) => heroName(id)).filter(Boolean);
      return `${plan.label}：${planNames.length ? planNames.join("、") : "不確定"}`;
    }).join("\n");
    const reason = plans.map((plan) => (plan.ids?.length ? plan.reason : "")).filter(Boolean).join("\n");
    return { action, reason, click: "" };
  }
  if (kind === "pick") {
    return { action: names.join("、"), reason: onePickWhy(result), click: "" };
  }
  if (kind === "report") {
    const left = result.action?.need || 1;
    return { action: `點對方這手的 ${left} 名`, reason: "", click: "" };
  }
  if (kind === "ban") {
    return { action: result.action?.title || "選要禁的人", reason: "第 3 選不能禁。", click: "" };
  }
  if (kind === "brief" || result?.phase === "battle") {
    return { action: result.action?.title || "照這一步打", reason: result.action?.report || result.reason?.summary || "", click: "" };
  }
  return { action: result?.action?.title || "", reason: "", click: "" };
}

function showCard({ action, rate, reason, click }) {
  const button = $("liveAction");
  button.textContent = action || "這一手沒有建議";
  button.disabled = !click;
  button.dataset.click = click || "";
  $("liveRate").textContent = rate || "";
  const node = $("liveReason");
  node.replaceChildren();
  node.textContent = reason || "";
}

function renderEffectGaps(force = false) {
  const root = $("effectGaps");
  const list = $("effectGapList");
  if (!root || !list) return;
  if (!roster?.heroes?.length || !catalog) {
    root.hidden = true;
    root.dataset.signature = "";
    list.replaceChildren();
    return;
  }
  const items = effectGapItems(catalog, roster, manual.effectNotes || {}, manual.exclusiveNote || "");
  const signature = items.map((item) => item.key).join("|");
  if (!items.length) {
    root.hidden = true;
    root.dataset.signature = "";
    list.replaceChildren();
    return;
  }
  if (!force && root.dataset.signature === signature) return;
  root.hidden = false;
  root.dataset.signature = signature;
  list.replaceChildren();
  for (const item of items) {
    const article = document.createElement("article");
    const title = document.createElement("p");
    const what = item.kind === "ee" ? "專武" : `神器 ${item.itemZh}`;
    title.textContent = `${item.heroes.join("、")}的${what}：效果不確定。請貼這項的截圖。`;
    const file = document.createElement("input");
    file.type = "file";
    file.accept = "image/*";
    const caption = document.createElement("label");
    caption.append("截圖上印出的效果");
    const area = document.createElement("textarea");
    area.placeholder = "只寫截圖上印出來的效果，沒印的數字不要補";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "寫進資料庫";
    button.disabled = true;
    let picked = false;
    const refresh = () => {
      button.disabled = !(picked && area.value.trim());
    };
    file.addEventListener("change", () => {
      picked = Boolean(file.files?.length);
      refresh();
    });
    area.addEventListener("input", refresh);
    button.addEventListener("click", () => {
      const effect = area.value.trim();
      if (!picked || !effect) return;
      manual.effectNotes = {
        ...(manual.effectNotes || {}),
        [item.key]: { effect, source: "使用者截圖" },
      };
      saveEffectNotes(localStorage, manual.effectNotes);
      guideKey = "";
      renderEffectGaps(true);
      if (roster?.heroes?.length) renderGuide();
    });
    caption.append(area);
    article.append(title, file, caption, button);
    list.append(article);
  }
}

function showReadyCard() {
  if (!roster?.heroes.length) {
    showCard({ action: GEAR_ASK, rate: "", reason: "", click: "import" });
    paintBoard();
    if ($("draftStatus")) $("draftStatus").textContent = "";
    return;
  }
  renderGuide();
}

function draftedFight() {
  if (manual.userPicks.length < 5 || manual.enemyPicks.length < 5) return null;
  if (!manual.userBanId || !manual.enemyBanId) return null;
  if (manual.userPicks[2] === manual.enemyBanId || manual.enemyPicks[2] === manual.userBanId) return null;
  const userFight = manual.userPicks.filter((id) => id !== manual.enemyBanId);
  const enemyFight = manual.enemyPicks.filter((id) => id !== manual.userBanId);
  if (userFight.length !== 4 || enemyFight.length !== 4) return null;
  return { userFight, enemyFight, userFirst: manual.userFirst === true, rule: manual.rule || "", exclusiveNote: manual.exclusiveNote || "", effectNotes: manual.effectNotes || {} };
}

function draftTaken() {
  return new Set([...(manual.userPicks || []), ...(manual.enemyPicks || []), ...(manual.prebans || []), ...(manual.enemyPrebans || [])].filter(Boolean));
}

function draftKey() {
  return [manual.rule || "", manual.userFirst, manual.mode || "", manual.exclusiveNote || "", JSON.stringify(manual.effectNotes || {}), manual.enemyPrebansDone, (manual.enemyPrebans || []).join(","), manual.prebansDone, (manual.prebans || []).join(","), manual.userPicks.join(","), manual.enemyPicks.join(","), manual.userBanId || "", manual.enemyBanId || "", $("rank")?.value || ""].join("|");
}

function paintRule() {
  for (const button of document.querySelectorAll("#ruleRow button")) {
    button.classList.toggle("primary", button.dataset.rule === manual.rule);
  }
  const node = $("ruleText");
  if (node) node.textContent = manual.rule ? "" : "先選戰爭規則，再點先後手。";
  $("modeQuick")?.classList.toggle("primary", manual.mode !== "deep");
  $("modeDeep")?.classList.toggle("primary", manual.mode === "deep");
}

function renderGuide() {
  paintRule();
  if (!catalog || !roster?.heroes?.length) {
    paintBoard();
    return;
  }
  if (!manual.rule || manual.userFirst == null) {
    guideKey = "";
    paintBoard();
    const line = rosterReadLine(roster);
    showCard({ action: line, rate: "", reason: "", click: "" });
    $("draftStatus").textContent = line;
    $("weFirst")?.classList.toggle("primary", manual.userFirst === true);
    $("theyFirst")?.classList.toggle("primary", manual.userFirst === false);
    return;
  }
  if (draftKey() === guideKey && lastAdvice) {
    paintBoard();
    $("draftStatus").textContent = draftStatusText(lastAdvice);
    $("weFirst")?.classList.toggle("primary", manual.userFirst === true);
    $("theyFirst")?.classList.toggle("primary", manual.userFirst === false);
    return;
  }
  let result = guidedDraft(catalog, roster, manual, { rank: $("rank").value, trials: 1, memory: loadMatches(localStorage) });
  const fight = draftedFight();
  if (fight && !manual.rule) {
    guideKey = draftKey();
    lastAdvice = result;
    renderLive(result);
    paintBoard();
    $("draftStatus").textContent = "先選戰爭規則，再算戰況。";
    $("weFirst")?.classList.toggle("primary", manual.userFirst === true);
    $("theyFirst")?.classList.toggle("primary", manual.userFirst === false);
    return;
  }
  if (fight) result = battleBrief(catalog, roster, fight);
  guideKey = draftKey();
  lastAdvice = result;
  renderLive(result);
  paintBoard();
  $("draftStatus").textContent = draftStatusText(result);
  $("weFirst")?.classList.toggle("primary", manual.userFirst === true);
  $("theyFirst")?.classList.toggle("primary", manual.userFirst === false);
}

function draftStatusText(result) {
  if (!manual.rule || manual.userFirst == null) return "";
  if (result?.action?.kind === "preban") return "";
  if (result?.action?.kind === "enemy-preban") return "";
  if (result?.action?.kind === "pick" || result?.action?.kind === "report") return "";
  if (manual.userPicks.length >= 5 && manual.enemyPicks.length >= 5) {
    if (!manual.userBanId || !manual.enemyBanId) return "點禁位。第 3 選不能打叉。";
    return "";
  }
  return "";
}

function setOrder(userFirst) {
  pendingSlot = null;
  if ($("slotChoices")) $("slotChoices").hidden = true;
  const rule = manual.rule || "";
  const exclusiveNote = manual.exclusiveNote || "";
  const effectNotes = manual.effectNotes || {};
  const mode = manual.mode || "quick";
  manual = blankDraft(userFirst);
  manual.rule = rule;
  manual.exclusiveNote = exclusiveNote;
  manual.effectNotes = effectNotes;
  manual.mode = mode;
  guideKey = "";
  openRecord = null;
  const record = $("liveRecord");
  if (record) record.textContent = "";
  renderGuide();
}

function slotTag(index) {
  return index === 2 ? "保護" : "關鍵";
}

function paintBoard() {
  paintSide("userCells", "user", manual.userPicks, manual.enemyBanId);
  paintSide("enemyCells", "enemy", manual.enemyPicks, manual.userBanId);
  paintBan($("ourBan"), "我禁對方", manual.userBanId);
  paintBan($("theirBan"), "對方禁我", manual.enemyBanId);
}

function paintSide(rootId, side, picks, banId) {
  const root = $(rootId);
  if (!root) return;
  root.replaceChildren();
  const full = manual.userPicks.length >= 5 && manual.enemyPicks.length >= 5;
  for (let index = 0; index < 5; index += 1) {
    const button = document.createElement("button");
    button.type = "button";
    const id = picks[index] || "";
    const active = !full && index === picks.length && (
      (side === "enemy" && lastAdvice?.action?.kind === "report")
      || (side === "user" && lastAdvice?.action?.kind === "pick")
    );
    const editing = pendingSlot && pendingSlot.kind === side && pendingSlot.index === index;
    button.className = ["cell", index === 2 ? "protect" : "key", id ? "filled" : "", id && id === banId ? "banned" : "", active ? "active" : "", editing ? "active" : ""].filter(Boolean).join(" ");
    const small = document.createElement("small");
    small.textContent = `第 ${index + 1} 選・${slotTag(index)}`;
    const strong = document.createElement("strong");
    strong.textContent = id ? heroName(id) : "";
    const mark = document.createElement("em");
    mark.className = "x";
    mark.textContent = "✕";
    button.append(small, strong, mark);
    button.addEventListener("click", () => onCell(side, index));
    root.appendChild(button);
  }
}

function paintBan(button, label, id) {
  if (!button) return;
  button.classList.toggle("banned", Boolean(id));
  button.replaceChildren();
  const mark = document.createElement("em");
  mark.textContent = "✕";
  const name = document.createElement("strong");
  name.textContent = id ? heroName(id) : "";
  const small = document.createElement("small");
  small.textContent = label;
  button.append(mark, name, small);
}

function onCell(side, index) {
  if (!manual.rule || manual.userFirst == null) {
    $("draftStatus").textContent = roster?.heroes?.length ? rosterReadLine(roster) : GEAR_ASK;
    return;
  }
  if (!manual.prebansDone || !manual.enemyPrebansDone) {
    $("draftStatus").textContent = "先完成雙方預禁，再選角。";
    return;
  }
  const full = manual.userPicks.length >= 5 && manual.enemyPicks.length >= 5;
  if (!full) {
    const picks = side === "enemy" ? manual.enemyPicks : manual.userPicks;
    if (index < picks.length && picks[index]) {
      pendingSlot = { kind: side, index, replace: true };
      openSlotChoices();
      return;
    }
    if (side === "enemy") {
      if (lastAdvice?.action?.kind !== "report" || index !== manual.enemyPicks.length) {
        $("draftStatus").textContent = lastAdvice?.action?.kind === "pick"
          ? "這一手是我方。點我方下一格，從有配裝的角色選。"
          : `先點對方第 ${manual.enemyPicks.length + 1} 格。`;
        return;
      }
      pendingSlot = { kind: "enemy", index, replace: false };
      openSlotChoices();
      return;
    }
    if (lastAdvice?.action?.kind !== "pick" || index !== manual.userPicks.length) {
      $("draftStatus").textContent = `先點對方第 ${manual.enemyPicks.length + 1} 格。`;
      return;
    }
    pendingSlot = { kind: "user", index, replace: false };
    openSlotChoices();
    return;
  }
  if (index === 2) {
    $("draftStatus").textContent = "第 3 選是保護位，不能打叉。";
    return;
  }
  const picks = side === "enemy" ? manual.enemyPicks : manual.userPicks;
  const id = picks[index];
  if (!id) return;
  if (side === "enemy") manual.userBanId = manual.userBanId === id ? null : id;
  else manual.enemyBanId = manual.enemyBanId === id ? null : id;
  renderGuide();
}

function onBan(which) {
  if (manual.userPicks.length < 5 || manual.enemyPicks.length < 5) {
    $("draftStatus").textContent = "兩邊都選滿 5 名，才能點禁位打叉。";
    return;
  }
  const picks = which === "enemy" ? manual.enemyPicks : manual.userPicks;
  pickerIds = picks.filter((_, index) => index !== 2);
  pendingSlot = { kind: which === "enemy" ? "ban-enemy" : "ban-user" };
  openDraftPicker(which === "enemy" ? "我禁對方哪一名" : "對方禁了我方哪一名");
}

function openSlotChoices() {
  const box = $("slotChoices");
  const slot = pendingSlot;
  if (!box || !slot || (slot.kind !== "user" && slot.kind !== "enemy")) {
    if (box) box.hidden = true;
    return;
  }
  box.hidden = false;
  const side = slot.kind === "user" ? "我方" : "對方";
  $("slotChoicesTitle").textContent = slot.replace
    ? `${side}第 ${slot.index + 1} 格，點一名換掉`
    : `${side}第 ${slot.index + 1} 格，點一名填進去`;
  $("slotSearch").value = "";
  fillSlotChoices("");
  paintBoard();
  $("draftStatus").textContent = slot.kind === "user"
    ? "有配裝的角色點一下就填進這一格。再點這一格可以換。已經選上和預禁過的不會出現。"
    : "輸入名字，點一下就填進這一格。再點這一格可以換。已經選上和預禁過的不會出現。";
}

function fillSlotChoices(query = "") {
  const list = $("slotList");
  const slot = pendingSlot;
  if (!list || !slot) return;
  list.replaceChildren();
  const needle = query.trim().toLowerCase();
  if (slot.kind === "enemy" && !needle) return;
  const taken = draftTaken();
  let heroes = selectableHeroes(catalog).sort((left, right) => left.nameZh.localeCompare(right.nameZh, "zh-Hant"));
  heroes = heroes.filter((hero) => !taken.has(hero.id));
  if (slot.kind === "user") {
    const geared = new Set((roster?.heroes || []).filter((hero) => hero.geared).map((hero) => hero.id));
    heroes = heroes.filter((hero) => geared.has(hero.id));
  }
  for (const hero of heroes) {
    const labels = [hero.nameZh, hero.name, hero.id, ...(hero.aliases || [])].map((label) => String(label || "").toLowerCase());
    if (needle && !labels.some((label) => label.includes(needle))) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = hero.nameZh;
    button.addEventListener("click", () => {
      const chosen = pendingSlot;
      pendingSlot = null;
      $("slotChoices").hidden = true;
      if (chosen) applyDraftChoice(chosen, hero.id);
    });
    list.appendChild(button);
  }
}

function openDraftPicker(title) {
  const heading = $("picker").querySelector("h2");
  if (heading) heading.textContent = title;
  $("pickerSearch").value = "";
  fillPicker("");
  if (!$("picker").open) $("picker").showModal();
}


function renderCounters() {
  const edges = counterEdges(catalog).filter((edge) => edge.kind !== "element").slice(0, 12);
  const byId = Object.fromEntries(catalog.heroes.map((hero) => [hero.id, hero]));
  $("counters").innerHTML = edges.map((edge) => `<li><strong>${byId[edge.from].nameZh}</strong> 對 <strong>${byId[edge.to].nameZh}</strong>：${edge.why}</li>`).join("");
}


function currentType() {
  const fight = draftedFight();
  if (!fight) return null;
  return draftType(fight.userFight, fight.enemyFight, fight.userFirst);
}

function currentIdentity() {
  if (!manual.prebansDone || !manual.enemyPrebansDone) return null;
  return matchIdentity({
    userFirst: manual.userFirst === true,
    prebans: manual.prebans,
    enemyPrebans: manual.enemyPrebans,
    userPicks: manual.userPicks,
    enemyPicks: manual.enemyPicks,
  });
}

function rateLine(result) {
  const sandbox = result?.rate == null ? "尚無勝率" : `沙盤估計 ${Math.round(result.rate * 100)}%`;
  const history = result?.history;
  if (!history) return sandbox;
  if (history.rate == null) return `${sandbox}　實戰尚無`;
  return `${sandbox}　實戰 ${Math.round(history.rate * 100)}%`;
}

function heroName(id) {
  const pools = [catalog.heroes || [], catalog.seasonHeroes || [], catalog.database || []];
  for (const pool of pools) {
    const hero = pool.find((row) => row.id === id);
    if (hero?.nameZh) return hero.nameZh;
  }
  return "";
}


function pickerChoice(name) {
  return [...document.querySelectorAll(`#pickerFilters [data-${name}][aria-pressed="true"]`)].map((button) => button.dataset[name]);
}

function fillPicker(query = "") {
  const needle = query.trim();
  const list = $("pickerList");
  list.replaceChildren();
  const filters = {
    stars: pickerChoice("star").map(Number),
    elements: pickerChoice("element"),
    roles: pickerChoice("role"),
  };
  let heroes = selectableHeroes(catalog).sort((left, right) => left.nameZh.localeCompare(right.nameZh, "zh-Hant"));
  if (pickerIds) {
    const allow = new Set(pickerIds);
    heroes = heroes.filter((hero) => allow.has(hero.id));
  } else {
    const taken = draftTaken();
    heroes = heroes.filter((hero) => !taken.has(hero.id));
  }
  if (pendingSlot?.kind === "user") {
    const geared = new Set((roster?.heroes || []).filter((hero) => hero.geared).map((hero) => hero.id));
    heroes = heroes.filter((hero) => geared.has(hero.id));
  }
  heroes = heroes.filter((hero) => matchesPicker(hero, filters));
  for (const hero of heroes) {
    const labels = [hero.nameZh, hero.name, hero.id, ...(hero.aliases || [])].map((label) => String(label || ""));
    if (needle && !labels.some((label) => label.toLowerCase().includes(needle.toLowerCase()))) continue;
    const button = document.createElement("button");
    button.type = "button";
    const name = document.createElement("span");
    name.textContent = hero.listed === false ? `${hero.nameZh}（未收錄）` : hero.nameZh;
    if (hero.code) {
      const face = document.createElement("img");
      face.alt = "";
      face.src = `./data/faces/${hero.code}.webp`;
      face.addEventListener("error", () => face.remove());
      button.append(face);
    }
    button.append(name);
    button.addEventListener("click", () => chooseFace(hero.id));
    list.appendChild(button);
  }
}


function chooseFace(heroId) {
  const slot = pendingSlot;
  $("picker").close();
  pendingSlot = null;
  pickerIds = null;
  if (slot) applyDraftChoice(slot, heroId);
}

function applyDraftChoice(slot, heroId) {
  if (!heroId) return;
  if (slot.kind === "enemy-preban") {
    const taken = draftTaken();
    if (taken.has(heroId)) {
      $("draftStatus").textContent = `${heroName(heroId)}已經選過或預禁過。`;
      return;
    }
    manual.enemyPrebans.push(heroId);
    const geared = (roster?.heroes || []).filter((hero) => hero.geared).length;
    const rankEach = $("rank")?.value === "below" ? 1 : 2;
    const each = Math.min(rankEach, geared);
    if (manual.enemyPrebans.length >= each) manual.enemyPrebansDone = true;
    renderGuide();
    return;
  }
  if (slot.kind === "user") {
    const geared = new Set((roster?.heroes || []).filter((hero) => hero.geared).map((hero) => hero.id));
    if (!geared.has(heroId)) {
      $("draftStatus").textContent = `${heroName(heroId)}沒有配裝，預設不推薦。`;
      return;
    }
    if (slot.replace) {
      if (slot.index >= manual.userPicks.length) return;
      manual.userPicks[slot.index] = heroId;
    } else {
      if (manual.userPicks.length !== slot.index) return;
      manual.userPicks.push(heroId);
      manual.steps.push({ side: "user", ids: [heroId] });
    }
  }
  if (slot.kind === "enemy") {
    const taken = draftTaken();
    if (!slot.replace && taken.has(heroId)) {
      $("draftStatus").textContent = `${heroName(heroId)}已經選過或預禁過。`;
      return;
    }
    if (slot.replace) {
      if (slot.index >= manual.enemyPicks.length) return;
      manual.enemyPicks[slot.index] = heroId;
    } else {
      if (manual.enemyPicks.length !== slot.index) return;
      manual.enemyPicks.push(heroId);
      manual.steps.push({ side: "enemy", ids: [heroId] });
    }
  }
  if (slot.kind === "ban-enemy") {
    const index = manual.enemyPicks.indexOf(heroId);
    if (index < 0 || index === 2) {
      $("draftStatus").textContent = "第 3 選是保護位，不能打叉。";
      return;
    }
    manual.userBanId = heroId;
  }
  if (slot.kind === "ban-user") {
    const index = manual.userPicks.indexOf(heroId);
    if (index < 0 || index === 2) {
      $("draftStatus").textContent = "第 3 選是保護位，不能打叉。";
      return;
    }
    manual.enemyBanId = heroId;
  }
  renderGuide();
}

function withRecord(result) {
  const identity = currentIdentity();
  const type = currentType();
  if ((!identity && !type) || !result) return result;
  const stats = rateForType(loadMatches(localStorage), identity?.key || type.key);
  if (!stats.total) return result;
  return {
    ...result,
    history: {
      ...(result.history || {}),
      rate: stats.rate,
      wins: stats.wins,
      losses: stats.losses,
      total: stats.total,
    },
  };
}

function renderLive(result) {
  result = withRecord(result);
  if (result?.phase === "ask" || result?.action?.kind === "ask") {
    showCard({ action: result.action?.title || GEAR_ASK, rate: "", reason: "", click: result.action?.title === GEAR_ASK ? "import" : "" });
    return;
  }
  if (!result?.ok) {
    const title = result?.action?.title || "這一手沒有建議";
    showCard({
      action: title,
      rate: "",
      reason: "",
      click: title === "先讀入帳號" ? "import" : "",
    });
  } else {
    const face = adviceFace(result);
    const rated = result.rate == null ? "" : rateLine(result);
    showCard({
      action: face.action,
      rate: rated.startsWith("尚無") ? "" : rated,
      reason: face.reason,
      click: face.click,
    });
  }
  const type = currentIdentity();
  const canRecord = Boolean(type);
  $("markWin").disabled = !canRecord;
  $("markLoss").disabled = !canRecord;
  const liveWin = $("liveWin");
  const liveLoss = $("liveLoss");
  if (liveWin) liveWin.disabled = !canRecord;
  if (liveLoss) liveLoss.disabled = !canRecord;
}

function markMatch(result) {
  const identity = currentIdentity();
  if (!identity) return;
  const book = loadMatches(localStorage);
  const existing = book.matches.find((row) => row.key === identity.key);
  const saved = recordResult(book, identity.key, result, existing?.id || null, identity);
  openRecord = { type: identity.key, id: saved.id };
  saveMatches(localStorage, saved);
  const text = saved.replaced
    ? (result === "win" ? "已改成這場勝利，沒有多加一場。" : "已改成這場落敗，沒有多加一場。")
    : (result === "win" ? "已記下這場勝利。" : "已記下這場落敗。");
  $("recordState").textContent = text;
  const live = $("liveRecord");
  if (live) live.textContent = text;
  guideKey = "";
  renderGuide();
}


$("forget").addEventListener("click", () => {
  clearAccount(localStorage);
  roster = null;
  $("rosterText").value = "";
  $("rosterState").textContent = "已忘掉這台瀏覽器裡的帳號。";
  renderGear();
  guideKey = "";
  lastAdvice = null;
  manual = blankDraft();
  renderEffectGaps(true);
  showReadyCard();
});
$("loadExample").addEventListener("click", () => loadExample().catch(showError));
$("loadSample").addEventListener("click", () => loadSample().catch(showError));
$("applyText").addEventListener("click", () => {
  try {
    applyRoster(readAccountText($("rosterText").value));
  } catch (error) {
    showError(error);
  }
});
async function importAccountFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const data = readAccountText(text);
    $("rosterText").value = JSON.stringify(data, null, 2);
    applyRoster(data);
  } catch (error) {
    showError(error);
    showCard({ action: "匯入沒有成功", rate: "尚無勝率", reason: error.message || "這個檔讀不了。", click: "import" });
  }
}

$("file").addEventListener("change", (event) => {
  importAccountFile(event.target.files?.[0]).finally(() => {
    event.target.value = "";
  });
});
$("importFile").addEventListener("change", (event) => {
  importAccountFile(event.target.files?.[0]).finally(() => {
    event.target.value = "";
  });
});

function showError(error) {
  $("rosterState").textContent = error.message || String(error);
}

for (const id of ["cutoff", "rank", "maxEnhance"]) {
  $(id).addEventListener("change", () => {
    guideKey = "";
    if (roster?.heroes?.length) renderGuide();
  });
}
$("openSetup").addEventListener("click", () => {
  $("setup").showModal();
});
$("closeSetup").addEventListener("click", () => {
  $("setup").close();
});
$("closePicker").addEventListener("click", () => {
  pendingSlot = null;
  pickerIds = null;
  $("picker").close();
});
$("pickerSearch").addEventListener("input", (event) => fillPicker(event.target.value));
$("slotSearch").addEventListener("input", (event) => fillSlotChoices(event.target.value));
for (const button of document.querySelectorAll("#pickerFilters button")) {
  button.addEventListener("click", () => {
    button.setAttribute("aria-pressed", button.getAttribute("aria-pressed") === "true" ? "false" : "true");
    fillPicker($("pickerSearch").value);
  });
}
for (const button of document.querySelectorAll("#ruleRow button")) {
  button.addEventListener("click", () => {
    manual.rule = button.dataset.rule;
    guideKey = "";
    renderGuide();
  });
}
$("modeQuick")?.addEventListener("click", () => {
  manual.mode = "quick";
  guideKey = "";
  renderGuide();
});
$("modeDeep")?.addEventListener("click", () => {
  manual.mode = "deep";
  guideKey = "";
  renderGuide();
});
$("weFirst").addEventListener("click", () => setOrder(true));
$("theyFirst").addEventListener("click", () => setOrder(false));
$("resetDraft").addEventListener("click", () => setOrder(null));
$("exclusiveNote").addEventListener("input", (event) => {
  manual.exclusiveNote = event.target.value;
  guideKey = "";
  renderEffectGaps();
  if (roster?.heroes?.length) renderGuide();
});
$("ourBan").addEventListener("click", () => onBan("enemy"));
$("theirBan").addEventListener("click", () => onBan("user"));
$("liveAction").addEventListener("click", () => {
  const click = $("liveAction").dataset.click;
  if (click === "enemy-preban") {
    pendingSlot = { kind: "enemy-preban" };
    pickerIds = null;
    openDraftPicker("對方預禁了哪一名");
    return;
  }
  if (click === "preban") {
    manual.prebans = [...(lastAdvice?.action?.ids || [])];
    manual.prebansDone = true;
    guideKey = "";
    renderGuide();
    return;
  }
  if (click === "import") $("importFile").click();
});
$("markWin").addEventListener("click", () => markMatch("win"));
$("markLoss").addEventListener("click", () => markMatch("loss"));
$("liveWin").addEventListener("click", () => markMatch("win"));
$("liveLoss").addEventListener("click", () => markMatch("loss"));
$("update").addEventListener("click", async () => {
  $("updateState").textContent = "正在跟 Fribbels 和 Epic7RTAStats 重新抓英雄、倍率、神器和賽季。這會花幾分鐘，完成前不要關頁面。";
  try {
    const res = await fetch("/api/update", { method: "POST" });
    const body = await res.json();
    if (!res.ok || !body.ok) {
      $("updateState").textContent = `這次沒有寫進新資料。${body.error || "更新失敗"}。建議仍用上一份版本。`;
      return;
    }
    renderVersion(body.version);
    $("updateState").textContent = "更新完成。重新載入頁面後，建議會用新的版本。";
    location.reload();
  } catch (error) {
    $("updateState").textContent = "更新沒有連上。請確認 RtaAdvisor.exe 的視窗還開著。頁面本身不用 Python；要更新英雄、倍率與賽季才需要。沒有 Python 的話，請再下載新的 RtaAdvisor.exe。";
  }
});

boot().then(() => {
  if (!lastAdvice) showReadyCard();
}).catch((error) => {
  showCard({ action: "資料沒載入", rate: "尚無勝率", reason: error.message || String(error) });
});
