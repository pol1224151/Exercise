import { GEAR_ASK, battleBrief, buildGearReport, clearAccount, counterEdges, effectGapItems, guidedDraft, loadAccount, loadEffectNotes, matchesPicker, parseRoster, readAccountText, rosterReadLine, saveAccount, saveEffectNotes, selectableHeroes, sourceBasis } from "./engine.js";
import { draftType, loadMatches, rateForType, recordResult, saveMatches } from "./records.js";

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

function showCard({ action, rate, reason, lines, click }) {
  const button = $("liveAction");
  button.textContent = action || "這一手沒有建議";
  button.disabled = !click;
  button.dataset.click = click || "";
  $("liveRate").textContent = rate == null ? "尚無勝率" : rate;
  const node = $("liveReason");
  node.replaceChildren();
  if (Array.isArray(lines) && lines.length) {
    const list = document.createElement("ul");
    list.className = "advice-lines";
    for (const row of lines) {
      if (!row) continue;
      const item = document.createElement("li");
      item.textContent = row;
      list.appendChild(item);
    }
    node.appendChild(list);
    return;
  }
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
  return [manual.rule || "", manual.userFirst, manual.exclusiveNote || "", JSON.stringify(manual.effectNotes || {}), manual.enemyPrebansDone, (manual.enemyPrebans || []).join(","), manual.prebansDone, (manual.prebans || []).join(","), manual.userPicks.join(","), manual.enemyPicks.join(","), manual.userBanId || "", manual.enemyBanId || "", $("rank")?.value || ""].join("|");
}

function paintRule() {
  const text = {
    attack: "攻擊：靈魂燃燒技能的傷害量增加 15%。燒魂傷害提高，燃燒技能強的角色與魂量充足的配置更有價值。",
    defense: "防禦：恢復量和防護罩效果量增加 30%。治療與護盾角色更強，持續回復的隊伍更難被消耗。",
    resist: "抵抗：效果抗性增加 50%。控場與減益的成功率下降，依賴暈眩、封印、減益的角色價值降低。",
    special: "特殊：迴避減少 30%。迴避變低，依賴迴避的角色與機制價值降低。",
    none: "無規則：沒有額外效果。",
  };
  for (const button of document.querySelectorAll("#ruleRow button")) {
    button.classList.toggle("primary", button.dataset.rule === manual.rule);
  }
  const node = $("ruleText");
  if (node) node.textContent = manual.rule ? text[manual.rule] : "先選戰爭規則，再點先後手。";
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
  let result = guidedDraft(catalog, roster, manual, { rank: $("rank").value, trials: 1 });
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

function slotWords(index) {
  const number = index + 1;
  return number === 3 ? `第 ${number} 選，保護` : `第 ${number} 選，關鍵`;
}

function draftStatusText(result) {
  const side = manual.userFirst ? "我方先手。" : "對方先手。";
  const rule = "選角是先手 1、後手 2、先手 2、後手 2、先手 2、後手 1。第 3 選是保護位核心。";
  if (manual.userPicks.length >= 5 && manual.enemyPicks.length >= 5) {
    if (!manual.userBanId || !manual.enemyBanId) {
      const suggest = result?.action?.kind === "ban" ? `${result.action.title}。` : "";
      return `${side}${rule}五選完成。${suggest}點對方格子或「我禁對方」，再點我方格子或「對方禁我」。第 3 選不能打叉。`;
    }
    return `${side}禁完了。下面是戰鬥建議。`;
  }
  if (result?.action?.kind === "preban") {
    return `${side}${rule}先採用我方預禁。點上面那句就用建議的人。預禁完才進選角。`;
  }
  if (result?.action?.kind === "enemy-preban") {
    return `${side}${rule}點上面那句，選對方的預禁。兩邊預禁都定了才進選角。`;
  }
  if (result?.action?.kind === "report") {
    const index = manual.enemyPicks.length;
    return `${side}${rule}點對方第 ${index + 1} 格，這是對方${slotWords(index)}。`;
  }
  if (result?.action?.kind === "pick") {
    const index = manual.userPicks.length;
    return `${side}${rule}點我方第 ${index + 1} 格，只從有配裝的角色選。這是我方${slotWords(index)}。`;
  }
  return `${side}${rule}`;
}

function setOrder(userFirst) {
  const rule = manual.rule || "";
  const exclusiveNote = manual.exclusiveNote || "";
  const effectNotes = manual.effectNotes || {};
  manual = blankDraft(userFirst);
  manual.rule = rule;
  manual.exclusiveNote = exclusiveNote;
  manual.effectNotes = effectNotes;
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
    button.className = ["cell", index === 2 ? "protect" : "key", id ? "filled" : "", id && id === banId ? "banned" : "", active ? "active" : ""].filter(Boolean).join(" ");
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
    if (side === "enemy") {
      if (lastAdvice?.action?.kind !== "report" || index !== manual.enemyPicks.length) {
        $("draftStatus").textContent = lastAdvice?.action?.kind === "pick"
          ? "這一手是我方。點我方下一格，從有配裝的角色選。"
          : `先點對方第 ${manual.enemyPicks.length + 1} 格。`;
        return;
      }
      pendingSlot = { kind: "enemy", index };
      pickerIds = null;
      openDraftPicker(`對方第 ${index + 1} 格`);
      return;
    }
    if (lastAdvice?.action?.kind !== "pick" || index !== manual.userPicks.length) {
      $("draftStatus").textContent = `先點對方第 ${manual.enemyPicks.length + 1} 格。`;
      return;
    }
    pendingSlot = { kind: "user", index };
    pickerIds = null;
    openDraftPicker(`我方第 ${index + 1} 格`);
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


function oneAction(result) {
  const title = result.action?.title || "";
  if (result.action?.kind !== "skill" || !result.action.burn) return title;
  return `${title}，${result.action.burn.yes ? "要燒魂" : "不要燒魂"}`;
}

function currentType() {
  const fight = draftedFight();
  if (!fight) return null;
  return draftType(fight.userFight, fight.enemyFight, fight.userFirst);
}

function oneReason(result) {
  if (!result?.ok) return result?.reason?.summary || result?.action?.detail || "這一手沒有建議。";
  if (result.history?.switched) {
    const was = Math.round(result.history.replaced.rate * 100);
    const cutoff = Math.round(result.history.cutoff * 100);
    return `原本那組實戰 ${was}%，低於門檻 ${cutoff}%，所以改這一組。`;
  }
  if (result.history?.stuck) return "這一組實戰低於門檻，沙盤沒有另一組達標，仍用這一組。";
  return result.reason?.summary || result.action?.detail || "";
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
    const each = $("rank")?.value === "below" ? 1 : 2;
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
    if (manual.userPicks.length !== slot.index) return;
    manual.userPicks.push(heroId);
    manual.steps.push({ side: "user", ids: [heroId] });
  }
  if (slot.kind === "enemy") {
    const taken = draftTaken();
    if (taken.has(heroId)) {
      $("draftStatus").textContent = `${heroName(heroId)}已經選過或預禁過。`;
      return;
    }
    if (manual.enemyPicks.length !== slot.index) return;
    manual.enemyPicks.push(heroId);
    manual.steps.push({ side: "enemy", ids: [heroId] });
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

function battleLines(result) {
  if (result?.phase !== "battle" || !result.reason?.lines?.length) return null;
  const lines = [...result.reason.lines];
  if (result.history?.switched) {
    const was = Math.round(result.history.replaced.rate * 100);
    const cutoff = Math.round(result.history.cutoff * 100);
    lines.unshift(`原本那組實戰 ${was}%，低於門檻 ${cutoff}%，所以改這一組。`);
  }
  return lines;
}

function withRecord(result) {
  const type = currentType();
  if (!type || !result) return result;
  const stats = rateForType(loadMatches(localStorage), type.key);
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
      rate: "尚無勝率",
      reason: oneReason(result),
      click: title === "先讀入帳號" ? "import" : "",
    });
  } else {
    showCard({
      action: oneAction(result),
      rate: rateLine(result),
      reason: oneReason(result),
      lines: result.phase === "battle" ? battleLines(result) : result.reason?.lines,
      click: result.action?.kind === "preban" ? "preban" : result.action?.kind === "enemy-preban" ? "enemy-preban" : "",
    });
  }
  const type = currentType();
  const canRecord = Boolean(type);
  $("markWin").disabled = !canRecord;
  $("markLoss").disabled = !canRecord;
  const liveWin = $("liveWin");
  const liveLoss = $("liveLoss");
  if (liveWin) liveWin.disabled = !canRecord;
  if (liveLoss) liveLoss.disabled = !canRecord;
}

function markMatch(result) {
  const type = currentType();
  if (!type) return;
  if (!openRecord || openRecord.type !== type.key) openRecord = { type: type.key, id: null };
  const updating = Boolean(openRecord.id);
  const saved = recordResult(loadMatches(localStorage), type.key, result, openRecord.id);
  openRecord.id = saved.id;
  saveMatches(localStorage, saved);
  const text = updating
    ? (result === "win" ? "已改成這場勝利，沒有多加一場。" : "已改成這場落敗，沒有多加一場。")
    : (result === "win" ? "已記下這場勝利。" : "已記下這場落敗。");
  $("recordState").textContent = text;
  const live = $("liveRecord");
  if (live) live.textContent = text;
  renderLive(lastAdvice);
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
