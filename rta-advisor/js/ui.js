import { adviceStateKey, adviseFromScreen, buildGearReport, clearAccount, counterEdges, loadAccount, orderBasisText, parseRoster, readAccountText, saveAccount, selectableHeroes, sourceBasis } from "./engine.js";
import { draftType, loadMatches, recordResult, saveMatches } from "./records.js";
import { matchHeroName, matchNamedCard, readDraft, refreshCardMemory, rememberCard } from "./screen.js";

const $ = (id) => document.getElementById(id);
const CARD_KEY = "rta-advisor-cards";

let catalog = null;
let book = null;
let roster = null;
let stream = null;
let timer = 0;
let watchHandle = 0;
let videoCallback = 0;
let analyzeQueued = false;
let adviceQueued = false;
let pendingRead = null;
let lastKey = "";
let lastAdvice = null;
let lastRead = null;
let openRecord = null;
let orderLock = null;
let reading = false;
let cardMemory = loadCardMemory();
let namedCards = [];
let ocrQueued = false;
let workerPromise = null;
let pendingFace = null;

async function boot() {
  const [catalogRes, versionRes, portraitRes, seasonRes, compRes] = await Promise.all([
    fetch("./data/catalog.json"),
    fetch("./data/version.json"),
    fetch("./data/portrait-signatures.json"),
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
  book = await portraitRes.json();
  const version = versionRes.ok ? await versionRes.json() : sourceBasis(catalog).version;
  renderVersion(version);
  renderCounters();
  setScreenEnabled(false);
  const params = new URLSearchParams(location.search);
  if (params.get("account") === "example" || params.get("fixture")) await loadExample();
  else if (params.get("account") === "sample") await loadSample();
  else restoreAccount();
  const fixture = params.get("fixture");
  if (fixture) runFixture(fixture);
}

function loadCardMemory() {
  try {
    const saved = JSON.parse(localStorage.getItem(CARD_KEY) || "[]");
    if (Array.isArray(saved)) return saved.filter((row) => row?.id && Array.isArray(row.sig));
  } catch {
    /* start with an empty memory */
  }
  return [];
}

function renderVersion(version) {
  const commit = (version.fribbelsCommit || "").slice(0, 8);
  const text = [
    `資料版本 ${version.fetchedOn || "尚未更新"}`,
    `賽季 ${version.seasonLabel || version.season || "沒有"}（${version.season || "無代號"}）`,
    `遊戲版本 ${version.patchZh || version.patch || "沒有"}`,
    `Fribbels ${commit || "沒有"}（${version.fribbelsCommitDate || "無日期"}）`,
    `英雄資料庫 ${version.heroCount || catalog.database?.length || 0} 名，本季會出現 ${catalog.seasonHeroes?.length || 0} 名，賽季模型 ${version.metaCount || 0} 名，神器 ${version.artifactCount || 0}`,
    `頭像樣本 ${version.portraitCount ?? book?.portraits?.length ?? 0}`,
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
  setScreenEnabled(roster.heroes.length > 0);
  lastKey = "";
  if (!reading && !roster.heroes.length) {
    const missing = roster.unknown.length ? `這版賽季模型沒有：${roster.unknown.slice(0, 4).join("、")}。` : "檔案裡沒有可對照的英雄。";
    showCard({ action: "匯入沒有對上英雄", rate: "尚無勝率", reason: missing, click: "import" });
  } else if (!reading) {
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

function setScreenEnabled(on) {
  $("share").disabled = !on;
  $("read").disabled = !on;
  $("screenLock").hidden = on;
  if (!on) $("captureState").textContent = "畫面判讀還沒開。先讀入帳號。";
  else if (!stream) $("captureState").textContent = "帳號已讀入。等世界競技場開打，再分享遊戲視窗。";
}

function showCard({ action, rate, reason, click }) {
  const button = $("liveAction");
  button.textContent = action || "這一手沒有建議";
  button.disabled = !click;
  button.dataset.click = click || "";
  $("liveRate").textContent = rate || "尚無勝率";
  $("liveReason").textContent = reason || "";
}

function showReadyCard() {
  if (!roster?.heroes.length) {
    showCard({ action: "先讀入帳號", rate: "尚無勝率", reason: "按「匯入帳號」，選 gear.txt 或 Fribbels 的 Save all JSON。", click: "import" });
    return;
  }
  if (!stream) {
    showCard({ action: "分享遊戲視窗", rate: "尚無勝率", reason: "帳號已讀入。競技場開打後再分享遊戲視窗。", click: "share" });
    return;
  }
  if (!reading) {
    showCard({ action: "開始判讀", rate: "尚無勝率", reason: "視窗已接上。開始判讀後，下一步會留在這裡。", click: "read" });
  }
}

function showFrame(on) {
  $("noFrame").hidden = on;
  $("stage").hidden = !on;
}

function renderCounters() {
  const edges = counterEdges(catalog).filter((edge) => edge.kind !== "element").slice(0, 12);
  const byId = Object.fromEntries(catalog.heroes.map((hero) => [hero.id, hero]));
  $("counters").innerHTML = edges.map((edge) => `<li><strong>${byId[edge.from].nameZh}</strong> 對 <strong>${byId[edge.to].nameZh}</strong>：${edge.why}</li>`).join("");
}

function placeBox(box, region) {
  box.style.left = `${region.x * 100}%`;
  box.style.top = `${region.y * 100}%`;
  box.style.width = `${region.w * 100}%`;
  box.style.height = `${region.h * 100}%`;
}

function oneAction(result) {
  const title = result.action?.title || "";
  if (result.action?.kind !== "skill" || !result.action.burn) return title;
  return `${title}，${result.action.burn.yes ? "要燒魂" : "不要燒魂"}`;
}

function currentType() {
  if (lastRead?.phase !== "battle") return null;
  if (typeof lastRead.firstPick !== "boolean") return null;
  return draftType(lastRead.user, lastRead.enemy, lastRead.firstPick);
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

function renderHeard(read) {
  const node = $("heard");
  if (!node) return;
  if (!read) {
    node.textContent = "";
    return;
  }
  const basis = orderBasisText(read, orderLock);
  const cards = read.faces || [];
  const bits = cards.map((card) => {
    const side = card.side === "enemy" ? "對方" : "我方";
    const raw = String(card.text || "").replace(/\s+/g, " ").trim();
    const hero = card.id && card.id !== "unknown" && card.id !== "empty" ? heroName(card.id) : "";
    const heard = raw ? `「${raw}」` : "（還沒讀出字）";
    return hero ? `${side}${heard}對上${hero}` : `${side}${heard}留空`;
  });
  const cardsLine = bits.length ? `這一幀：${bits.join("。")}。` : "";
  node.textContent = [basis, cardsLine].filter(Boolean).join(" ");
}

function paintCards(cards) {
  const root = $("boxes");
  const buttons = [...root.querySelectorAll(".box")];
  if (buttons.length !== cards.length) {
    root.replaceChildren();
    for (const card of cards) root.appendChild(cardButton(card));
    return;
  }
  cards.forEach((card, index) => labelCard(buttons[index], card));
}

function cardButton(card) {
  const box = document.createElement("button");
  box.type = "button";
  box.className = "box";
  box.innerHTML = "<span></span><small></small>";
  labelCard(box, card);
  box.addEventListener("click", () => {
    const face = (lastRead?.faces || []).find((row) => row.side === box.dataset.side && row.index === Number(box.dataset.index));
    if (face) openPicker(face);
  });
  return box;
}

function labelCard(box, card) {
  placeBox(box, card);
  box.dataset.side = card.side;
  box.dataset.index = String(card.index ?? "");
  box.dataset.id = card.id || "unknown";
  const named = card.id && card.id !== "unknown" && card.id !== "empty";
  box.querySelector("span").textContent = named ? heroName(card.id) : "";
  const clean = String(card.text || "").replace(/[^\u4e00-\u9fff]/g, "");
  box.querySelector("small").textContent = named && clean.length >= 2 ? clean : "";
}

function fillPicker(query = "") {
  const needle = query.trim();
  const list = $("pickerList");
  list.replaceChildren();
  const heroes = selectableHeroes(catalog).sort((left, right) => left.nameZh.localeCompare(right.nameZh, "zh-Hant"));
  for (const hero of heroes) {
    const labels = [hero.nameZh, hero.name, hero.id, ...(hero.aliases || [])].map((label) => String(label || ""));
    if (needle && !labels.some((label) => label.toLowerCase().includes(needle.toLowerCase()))) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = hero.listed === false ? `${hero.nameZh}（未收錄）` : hero.nameZh;
    button.addEventListener("click", () => chooseFace(hero.id));
    list.appendChild(button);
  }
}

function openPicker(face) {
  pendingFace = face;
  $("pickerSearch").value = "";
  fillPicker("");
  if (!$("picker").open) $("picker").showModal();
}

function chooseFace(heroId) {
  const face = pendingFace;
  $("picker").close();
  pendingFace = null;
  if (!face || !heroId || !face.signature) return;
  cardMemory = rememberCard(cardMemory, face.signature, heroId, {
    text: face.text || "",
    side: face.side,
    x: face.x,
    y: face.y,
    w: face.w,
    h: face.h,
  });
  localStorage.setItem(CARD_KEY, JSON.stringify(cardMemory));
  namedCards = namedCards.filter((row) => matchNamedCard(face.signature, [row]) === undefined);
  if (!lastRead) return;
  const apply = (row) => {
    if (row.side === face.side && row.key === face.key) row.id = heroId;
  };
  (lastRead.cards || []).forEach(apply);
  (lastRead.faces || []).forEach(apply);
  const user = [];
  const enemy = [];
  for (const row of lastRead.faces) {
    if (row.side === "user") user.push(row.id);
    if (row.side === "enemy") enemy.push(row.id);
  }
  lastRead.user = user;
  lastRead.enemy = enemy;
  lastRead.phase = lastRead.user.length + lastRead.enemy.length > 0 ? "pick" : lastRead.phase;
  paintCards(lastRead.faces);
  lastKey = "";
  if (reading) consider(lastRead);
}

function renderLive(result) {
  if (!result?.ok) {
    const title = result?.action?.title || "這一手沒有建議";
    showCard({
      action: title,
      rate: "尚無勝率",
      reason: oneReason(result),
      click: title === "先讀入帳號" ? "import" : "",
    });
  } else {
    showCard({ action: oneAction(result), rate: rateLine(result), reason: oneReason(result) });
  }
  const type = currentType();
  const canRecord = Boolean(type);
  $("markWin").disabled = !canRecord;
  $("markLoss").disabled = !canRecord;
}

function markMatch(result) {
  const type = currentType();
  if (!type) return;
  if (!openRecord || openRecord.type !== type.key) openRecord = { type: type.key, id: null };
  const saved = recordResult(loadMatches(localStorage), type.key, result, openRecord.id);
  openRecord.id = saved.id;
  saveMatches(localStorage, saved);
  $("recordState").textContent = result === "win" ? "已記下這場勝利。" : "已記下這場落敗。";
  renderLive(lastAdvice);
}

function cutoffFraction() {
  const value = Number($("cutoff").value);
  if (!Number.isFinite(value)) return 0.4;
  return Math.min(100, Math.max(0, value)) / 100;
}

function options() {
  return {
    rank: $("rank").value,
    assumeMaxEnhance: $("maxEnhance").checked,
    trials: 4,
    roster,
    history: loadMatches(localStorage),
    cutoff: cutoffFraction(),
    heldFirstPick: orderLock,
  };
}

function boardIsEmpty(read) {
  const filled = (ids) => (ids || []).some((id) => id && id !== "empty" && id !== "unknown");
  return !filled(read?.user) && !filled(read?.enemy) && !filled(read?.prebans) && !read?.turnSide && !read?.leadSide;
}

function consider(read) {
  try {
    if (boardIsEmpty(read)) orderLock = null;
    lastRead = read;
    const key = stateKey(read);
    if (key === lastKey && lastAdvice) return lastAdvice;
    lastKey = key;
    lastAdvice = adviseFromScreen(catalog, read, options());
    if (lastAdvice?.orderSource === "mismatch") orderLock = null;
    else if (typeof lastAdvice?.firstPick === "boolean" && lastAdvice.orderSource !== "locked" && lastAdvice.orderSource !== "held") {
      orderLock = lastAdvice.firstPick;
    }
    lastRead.firstPick = typeof lastAdvice?.firstPick === "boolean" ? lastAdvice.firstPick : orderLock;
    const type = currentType();
    if (!type || openRecord?.type !== type.key) openRecord = type ? { type: type.key, id: null } : null;
    renderLive(lastAdvice);
    paintCards(read.faces || []);
    renderHeard(read);
    return lastAdvice;
  } catch (error) {
    showCard({ action: "這一手沒有建議", rate: "尚無勝率", reason: error.message || "判讀時發生錯誤。" });
    return null;
  }
}

async function shareWindow() {
  if (!roster?.heroes.length) {
    $("captureState").textContent = "請先讀入帳號，再在競技場開始時分享畫面。";
    return;
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    $("captureState").textContent = "這個瀏覽器沒有畫面分享。請用 Chrome 或 Edge 打開本頁。";
    return;
  }
  stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: false });
  const video = $("game");
  video.srcObject = stream;
  await video.play();
  showFrame(Boolean(video.videoWidth));
  $("captureState").textContent = "已接到視窗。關掉設定後，主畫面顯示這一幀。再按開始判讀。左右大卡上的名字會對上英雄。";
  watchStream();
  if (!reading) showReadyCard();
  stream.getVideoTracks()[0].addEventListener("ended", () => {
    $("captureState").textContent = "分享已停。要繼續的話再按一次分享遊戲視窗。";
    reading = false;
    stopWatch();
    showFrame(false);
    showReadyCard();
  });
}

function stopWatch() {
  clearInterval(timer);
  timer = 0;
  if (watchHandle) cancelAnimationFrame(watchHandle);
  watchHandle = 0;
  const video = $("game");
  if (videoCallback && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(videoCallback);
  videoCallback = 0;
}

function watchStream() {
  stopWatch();
  const video = $("game");
  const pump = () => {
    paintVideoFrame();
    if (!stream) return;
    if (video.requestVideoFrameCallback) videoCallback = video.requestVideoFrameCallback(pump);
    else watchHandle = requestAnimationFrame(pump);
  };
  if (video.requestVideoFrameCallback) videoCallback = video.requestVideoFrameCallback(pump);
  else watchHandle = requestAnimationFrame(pump);
  timer = 1;
  paintVideoFrame();
}

function startReading() {
  if (!roster?.heroes.length) {
    $("captureState").textContent = "請先讀入帳號。";
    showReadyCard();
    return;
  }
  reading = true;
  if (!timer) watchStream();
  else paintVideoFrame();
}

function paintVideoFrame() {
  const video = $("game");
  if (!video.videoWidth) {
    showFrame(false);
    if (reading) showCard({ action: "沒有收到畫面", rate: "尚無勝率", reason: "遊戲視窗還沒畫出來。確認分享的是第七史詩那個視窗。" });
    renderHeard(null);
    return;
  }
  showFrame(true);
  const board = $("board");
  if (board.width !== video.videoWidth || board.height !== video.videoHeight) {
    board.width = video.videoWidth;
    board.height = video.videoHeight;
  }
  board.getContext("2d", { willReadFrequently: true }).drawImage(video, 0, 0);
  if (analyzeQueued) return;
  analyzeQueued = true;
  setTimeout(analyzeFrame, 0);
}

function stateKey(read) {
  return adviceStateKey(read, {
    heldFirstPick: orderLock,
    rank: $("rank").value,
    assumeMaxEnhance: $("maxEnhance").checked,
    cutoff: $("cutoff").value,
  });
}

function analyzeFrame() {
  analyzeQueued = false;
  const board = $("board");
  if (!board.width || !board.height) return;
  const frame = board.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, board.width, board.height);
  const read = readDraft(frame.data, board.width, board.height, cardMemory, namedCards);
  cardMemory = refreshCardMemory(cardMemory, read.cards);
  paintCards(read.faces || []);
  renderHeard(read);
  pendingRead = read;
  scheduleNames(frame.data, board.width, board.height, read);
  if (!reading) {
    lastRead = read;
    return;
  }
  if (stateKey(read) === lastKey && lastAdvice) return;
  if (adviceQueued) return;
  adviceQueued = true;
  setTimeout(() => {
    adviceQueued = false;
    const latest = pendingRead;
    if (!latest || !reading) return;
    if (stateKey(latest) === lastKey && lastAdvice) return;
    consider(latest);
  }, 0);
}

function scheduleNames(data, width, height, read) {
  const pending = (read.cards || []).filter((card) => (card.id === "unknown" || card.remembered) && matchNamedCard(card.signature, namedCards) === undefined);
  if (!pending.length || ocrQueued) return;
  ocrQueued = true;
  const jobs = pending.map((card) => ({ signature: card.signature, canvas: cropCard(data, width, height, card) }));
  setTimeout(async () => {
    try {
      const worker = await ocrWorker();
      for (const job of jobs) {
        if (matchNamedCard(job.signature, namedCards) !== undefined) continue;
        const result = await worker.recognize(job.canvas);
        const text = String(result?.data?.text || "").replace(/\s+/g, " ").trim();
        const pool = selectableHeroes(catalog || {});
        const id = matchHeroName(text, pool);
        const clean = id ? String(text).replace(/[^\u4e00-\u9fff]/g, "") : "";
        namedCards.unshift({ sig: job.signature, id: id || "", text: clean });
        namedCards = namedCards.slice(0, 40);
      }
    } catch {
      for (const job of jobs) {
        if (matchNamedCard(job.signature, namedCards) === undefined) namedCards.unshift({ sig: job.signature, id: "" });
      }
      namedCards = namedCards.slice(0, 40);
    } finally {
      ocrQueued = false;
      const board = $("board");
      if (!board.width) return;
      const latestFrame = board.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, board.width, board.height);
      const latest = readDraft(latestFrame.data, board.width, board.height, cardMemory, namedCards);
      cardMemory = refreshCardMemory(cardMemory, latest.cards);
      pendingRead = latest;
      paintCards(latest.faces || []);
      renderHeard(latest);
      if (!reading) {
        lastRead = latest;
        return;
      }
      if (stateKey(latest) === lastKey && lastAdvice) return;
      consider(latest);
    }
  }, 0);
}

function cropCard(data, width, height, card) {
  const region = card.nameBox || card;
  const x0 = Math.max(0, Math.round(region.x * width));
  const y0 = Math.max(0, Math.round(region.y * height));
  const boxW = Math.max(1, Math.min(width - x0, Math.round(region.w * width)));
  const boxH = Math.max(1, Math.min(height - y0, Math.round(region.h * height)));
  const scale = 3;
  const source = document.createElement("canvas");
  source.width = boxW;
  source.height = boxH;
  const image = source.getContext("2d").createImageData(boxW, boxH);
  for (let y = 0; y < boxH; y += 1) {
    for (let x = 0; x < boxW; x += 1) {
      const from = ((y0 + y) * width + (x0 + x)) * 4;
      const to = (y * boxW + x) * 4;
      image.data[to] = data[from];
      image.data[to + 1] = data[from + 1];
      image.data[to + 2] = data[from + 2];
      image.data[to + 3] = 255;
    }
  }
  source.getContext("2d").putImageData(image, 0, 0);
  const canvas = document.createElement("canvas");
  canvas.width = boxW * scale;
  canvas.height = boxH * scale;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function ocrWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const tesseract = await import("../vendor/tesseract/tesseract.esm.min.js");
      const createWorker = tesseract.createWorker || tesseract.default?.createWorker;
      const base = new URL("../vendor/tesseract/", import.meta.url);
      const worker = await createWorker("chi_tra+eng", 1, {
        workerPath: new URL("worker.min.js", base).href,
        corePath: new URL("tesseract-core-simd-lstm.wasm.js", base).href,
        langPath: base.href,
        workerBlobURL: false,
        gzip: false,
      });
      await worker.setParameters({ tessedit_pageseg_mode: "6" });
      return worker;
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

function paintLevelLabel(data, width, height, cx, cy) {
  const th = Math.max(10, Math.round(height * 0.02));
  const gw = Math.max(4, Math.round(th * 0.7));
  const gap = Math.max(2, Math.round(th * 0.25));
  let x = Math.round(cx - (4 * gw + 3 * gap) / 2);
  const y = Math.round(cy - th / 2);
  for (let letter = 0; letter < 4; letter += 1) {
    for (let yy = y; yy < y + th; yy += 1) {
      for (let xx = x; xx < x + gw; xx += 1) {
        const offset = (yy * width + xx) * 4;
        data[offset] = 230;
        data[offset + 1] = 150;
        data[offset + 2] = 40;
        data[offset + 3] = 255;
      }
    }
    x += gw + gap;
  }
}

function runFixture() {
  const width = 960;
  const height = 540;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 16;
    data[index + 1] = 18;
    data[index + 2] = 28;
    data[index + 3] = 255;
  }
  for (let y = 30; y < 70; y += 1) {
    for (let x = 400; x < 560; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = 40;
      data[offset + 1] = 130;
      data[offset + 2] = 220;
    }
  }
  paintLevelLabel(data, width, height, Math.round(width * 0.28), Math.round(height * 0.34));
  paintLevelLabel(data, width, height, Math.round(width * 0.62), Math.round(height * 0.34));
  const fill = (x, y, bw, bh, color) => {
    for (let yy = y; yy < y + bh; yy += 1) {
      for (let xx = x; xx < x + bw; xx += 1) {
        const offset = (yy * width + xx) * 4;
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
      }
    }
  };
  fill(150, 150, 80, 50, [190, 80, 40]);
  fill(620, 150, 80, 50, [40, 150, 90]);
  for (let index = 0; index < 8; index += 1) {
    const cx = Math.round(width * (0.3 + index * 0.05));
    const cy = Math.round(height * 0.86);
    for (let y = cy - 8; y < cy + 8; y += 1) {
      for (let x = cx - 8; x < cx + 8; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = 180;
        data[offset + 1] = 140;
        data[offset + 2] = 70;
      }
    }
  }
  showFrame(true);
  const board = $("board");
  board.width = width;
  board.height = height;
  board.getContext("2d").putImageData(new ImageData(data, width, height), 0, 0);
  const read = readDraft(data, width, height, cardMemory, namedCards);
  paintCards(read.faces || []);
  $("captureState").textContent = "這張是內建檢查畫面，不是你的遊戲。正式使用請分享遊戲視窗。";
  reading = true;
  consider(read);
}

$("forget").addEventListener("click", () => {
  clearAccount(localStorage);
  roster = null;
  $("rosterText").value = "";
  $("rosterState").textContent = "已忘掉這台瀏覽器裡的帳號。";
  renderGear();
  setScreenEnabled(false);
  lastKey = "";
  lastAdvice = null;
  orderLock = null;
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
    if (lastRead) consider(lastRead);
  });
}
$("openSetup").addEventListener("click", () => {
  $("setup").showModal();
});
$("closeSetup").addEventListener("click", () => {
  $("setup").close();
});
$("closePicker").addEventListener("click", () => $("picker").close());
$("pickerSearch").addEventListener("input", (event) => fillPicker(event.target.value));
$("liveAction").addEventListener("click", () => {
  const click = $("liveAction").dataset.click;
  if (click === "import") {
    $("importFile").click();
  } else if (click === "share") {
    shareWindow().catch((error) => {
      $("captureState").textContent = `沒有接上視窗：${error.message || error}`;
    });
  } else if (click === "read") {
    startReading();
  }
});
$("markWin").addEventListener("click", () => markMatch("win"));
$("markLoss").addEventListener("click", () => markMatch("loss"));
$("share").addEventListener("click", () => shareWindow().catch((error) => {
  $("captureState").textContent = `沒有接上視窗：${error.message || error}`;
}));
$("read").addEventListener("click", startReading);
$("update").addEventListener("click", async () => {
  $("updateState").textContent = "正在跟 Fribbels 和 Epic7RTAStats 重新抓英雄、倍率、神器和賽季。這會花幾分鐘，完成前不要關頁面。";
  try {
    const res = await fetch("/api/update", { method: "POST" });
    const body = await res.json();
    if (!res.ok || !body.ok) {
      $("updateState").textContent = `這次沒有寫進新資料。${body.error || "更新失敗"}。畫面上的建議仍用上一份版本。`;
      return;
    }
    renderVersion(body.version);
    $("updateState").textContent = "更新完成。重新載入頁面後，建議會用新的版本。";
    location.reload();
  } catch (error) {
    $("updateState").textContent = "更新沒有連上。請確認 RtaAdvisor.exe 的視窗還開著。頁面本身不用 Python；要更新英雄、倍率與賽季才需要。沒有 Python 的話，請再下載新的 RtaAdvisor.exe。";
  }
});

showFrame(false);
boot().then(() => {
  if (!reading && !lastAdvice) showReadyCard();
}).catch((error) => {
  showCard({ action: "資料沒載入", rate: "尚無勝率", reason: error.message || String(error) });
});
