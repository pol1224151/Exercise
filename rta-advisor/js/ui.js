import { adviseFromScreen, buildGearReport, clearAccount, counterEdges, loadAccount, parseRoster, saveAccount, sourceBasis } from "./engine.js";
import { draftType, loadMatches, rateForType, recordResult, saveMatches } from "./records.js";
import { DEFAULT_REGIONS, liveStateKey, paintFixture, readFrame } from "./screen.js";

const $ = (id) => document.getElementById(id);
const REGION_KEY = "rta-advisor-regions";

let catalog = null;
let book = null;
let roster = null;
let regions = loadRegions();
let stream = null;
let timer = 0;
let lastKey = "";
let lastAdvice = null;
let lastRead = null;
let openRecord = null;

async function boot() {
  const [catalogRes, versionRes, portraitRes] = await Promise.all([
    fetch("./data/catalog.json"),
    fetch("./data/version.json"),
    fetch("./data/portrait-signatures.json"),
  ]);
  catalog = await catalogRes.json();
  book = await portraitRes.json();
  const version = versionRes.ok ? await versionRes.json() : sourceBasis(catalog).version;
  renderVersion(version);
  renderCounters();
  mountBoxes();
  setScreenEnabled(false);
  const params = new URLSearchParams(location.search);
  if (params.get("account") === "example" || params.get("fixture")) await loadExample();
  else if (params.get("account") === "sample") await loadSample();
  else restoreAccount();
  const fixture = params.get("fixture");
  if (fixture) runFixture(fixture);
}

function loadRegions() {
  try {
    const saved = JSON.parse(localStorage.getItem(REGION_KEY) || "null");
    if (saved?.user && saved?.enemy && saved?.preban && saved?.skills && saved?.actor) return saved;
  } catch {
    /* use the defaults */
  }
  return structuredClone(DEFAULT_REGIONS);
}

function renderVersion(version) {
  const commit = (version.fribbelsCommit || "").slice(0, 8);
  const text = [
    `資料版本 ${version.fetchedOn || "尚未更新"}`,
    `賽季 ${version.seasonLabel || version.season || "沒有"}（${version.season || "無代號"}）`,
    `遊戲版本 ${version.patchZh || version.patch || "沒有"}`,
    `Fribbels ${commit || "沒有"}（${version.fribbelsCommitDate || "無日期"}）`,
    `英雄資料庫 ${version.heroCount || 0} 名，賽季模型 ${version.metaCount || 0} 名，神器 ${version.artifactCount || 0}`,
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
}

function renderGear() {
  const root = $("gear");
  if (!roster?.heroes.length) {
    root.innerHTML = "<p>先讀入帳號，才會對照賽季配裝。</p>";
    return;
  }
  const byId = Object.fromEntries(catalog.heroes.map((hero) => [hero.id, hero]));
  root.innerHTML = roster.heroes.map((hero) => {
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
}

function setScreenEnabled(on) {
  $("share").disabled = !on;
  $("read").disabled = !on;
  $("screenLock").hidden = on;
  if (!on) {
    $("captureState").textContent = "畫面判讀還沒開。先讀入帳號。";
    $("live").innerHTML = "<p>競技場開始、而且帳號已經讀入之後，下一步才會出現在這裡。</p>";
  } else if (!stream) {
    $("captureState").textContent = "帳號已讀入。等世界競技場開打，再分享遊戲視窗。";
  }
}

function renderCounters() {
  const edges = counterEdges(catalog).filter((edge) => edge.kind !== "element").slice(0, 12);
  const byId = Object.fromEntries(catalog.heroes.map((hero) => [hero.id, hero]));
  $("counters").innerHTML = edges.map((edge) => `<li><strong>${byId[edge.from].nameZh}</strong> 對 <strong>${byId[edge.to].nameZh}</strong>：${edge.why}</li>`).join("");
}

function mountBoxes() {
  const root = $("boxes");
  root.innerHTML = "";
  for (const [key, region] of Object.entries(regions)) {
    const box = document.createElement("div");
    box.className = "box";
    box.dataset.key = key;
    placeBox(box, region);
    box.innerHTML = `<span>${region.label}</span><i data-resize="1"></i>`;
    root.appendChild(box);
    box.addEventListener("pointerdown", (event) => startDrag(event, key));
  }
}

function placeBox(box, region) {
  box.style.left = `${region.x * 100}%`;
  box.style.top = `${region.y * 100}%`;
  box.style.width = `${region.w * 100}%`;
  box.style.height = `${region.h * 100}%`;
}

function startDrag(event, key) {
  const stage = $("stage").getBoundingClientRect();
  const region = regions[key];
  const resize = event.target.dataset.resize === "1";
  const origin = { px: event.clientX, py: event.clientY, x: region.x, y: region.y, w: region.w, h: region.h };
  const move = (ev) => {
    const dx = (ev.clientX - origin.px) / stage.width;
    const dy = (ev.clientY - origin.py) / stage.height;
    if (resize) {
      region.w = Math.min(0.8, Math.max(0.04, origin.w + dx));
      region.h = Math.min(0.8, Math.max(0.04, origin.h + dy));
    } else {
      region.x = Math.min(0.95, Math.max(0, origin.x + dx));
      region.y = Math.min(0.95, Math.max(0, origin.y + dy));
    }
    placeBox(event.currentTarget, region);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function oneAction(result) {
  const title = result.action?.title || "";
  if (result.action?.kind !== "skill" || !result.action.burn) return title;
  return `${title}，${result.action.burn.yes ? "要燒魂" : "不要燒魂"}`;
}

function oneReason(result) {
  if (!result?.ok) return result?.reason || "三項資料還沒齊。";
  return result.reason?.summary || result.action?.detail || "";
}

function currentType() {
  if (lastRead?.phase !== "battle") return null;
  return draftType(lastRead.user, lastRead.enemy, $("first").value === "first");
}

function historyLine(history) {
  const cutoff = Math.round(history.cutoff * 100);
  const own = history.rate == null
    ? "這一組還沒有實戰記錄。"
    : `這一組實戰 ${history.wins} 勝 ${history.losses} 負，勝率 ${Math.round(history.rate * 100)}%（${history.total} 場）。`;
  if (history.switched) {
    const was = Math.round(history.replaced.rate * 100);
    return `<p class="record">原本那組實戰 ${was}%，低於門檻 ${cutoff}%，已改推薦另一組。${own}旁邊仍是沙盤估計。</p>`;
  }
  if (history.stuck) {
    return `<p class="record">這一組實戰低於門檻 ${cutoff}%，沙盤沒有另一組達標，這一手仍是沙盤第一組。${own}</p>`;
  }
  return `<p class="record">同類型實戰：${own}門檻 ${cutoff}%。沒有低於門檻，人選照沙盤。</p>`;
}

function recordedLine(result) {
  if (result?.history) return historyLine(result.history);
  const type = currentType();
  if (!type) return `<p class="record">同類型實戰要等這場打成 4 對 4。選角時若低於門檻，會改推薦另一組。</p>`;
  const stats = rateForType(loadMatches(localStorage), type.key);
  const cutoff = Math.round(cutoffFraction() * 100);
  if (stats.rate == null) return `<p class="record">同類型實戰：這組 4 對 4 還沒有記錄。打完按贏或輸。門檻 ${cutoff}%。</p>`;
  const percent = Math.round(stats.rate * 100);
  const low = stats.rate < cutoffFraction() ? `低於門檻 ${cutoff}%。人已經在場上，技能仍照沙盤。` : `沒有低於門檻 ${cutoff}%。`;
  return `<p class="record">同類型實戰 ${stats.wins} 勝 ${stats.losses} 負，勝率 ${percent}%（${stats.total} 場）。${low}</p>`;
}

function recordButtons() {
  if (!currentType()) return "";
  return `<div class="row"><button type="button" id="markWin">這場我贏了</button><button type="button" id="markLoss">這場我輸了</button></div>`;
}

function renderLive(result) {
  const root = $("live");
  const rates = `<div class="rates">${result?.rate == null ? "" : `<p class="rate">沙盤估計 ${Math.round(result.rate * 100)}%（不是必勝）</p>`}${recordedLine(result)}</div>${recordButtons()}`;
  if (!result?.ok) {
    root.innerHTML = `<p class="action">建議無效</p>${rates}<p>${oneReason(result)}</p>`;
  } else {
    root.innerHTML = `<p class="action">${oneAction(result)}</p>${rates}<p>${oneReason(result)}</p>`;
  }
  $("markWin")?.addEventListener("click", () => markMatch("win"));
  $("markLoss")?.addEventListener("click", () => markMatch("loss"));
}

function markMatch(result) {
  const type = currentType();
  if (!type) return;
  if (!openRecord || openRecord.type !== type.key) openRecord = { type: type.key, id: null };
  const saved = recordResult(loadMatches(localStorage), type.key, result, openRecord.id);
  openRecord.id = saved.id;
  saveMatches(localStorage, saved);
  renderLive(lastAdvice);
}

function cutoffFraction() {
  const value = Number($("cutoff").value);
  if (!Number.isFinite(value)) return 0.4;
  return Math.min(100, Math.max(0, value)) / 100;
}

function options() {
  return {
    firstPick: $("first").value === "first",
    rank: $("rank").value,
    assumeMaxEnhance: $("maxEnhance").checked,
    trials: 4,
    roster,
    history: loadMatches(localStorage),
    cutoff: cutoffFraction(),
  };
}

function consider(read) {
  lastRead = read;
  const type = currentType();
  if (!type || openRecord?.type !== type.key) openRecord = type ? { type: type.key, id: null } : null;
  const key = JSON.stringify({
    board: liveStateKey(read),
    first: $("first").value,
    rank: $("rank").value,
    enhance: $("maxEnhance").checked,
    cutoff: $("cutoff").value,
  });
  if (key === lastKey && lastAdvice) return lastAdvice;
  lastKey = key;
  lastAdvice = adviseFromScreen(catalog, read, options());
  renderLive(lastAdvice);
  return lastAdvice;
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
  stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 8 }, audio: false });
  const video = $("game");
  video.srcObject = stream;
  video.hidden = false;
  $("board").hidden = true;
  await video.play();
  $("captureState").textContent = "已接到視窗。把色框拖到頭像和技能上，按記住框線，再按開始判讀。";
  stream.getVideoTracks()[0].addEventListener("ended", () => {
    $("captureState").textContent = "分享已停。要繼續的話再按一次分享遊戲視窗。";
    clearInterval(timer);
  });
}

function rememberRegions() {
  localStorage.setItem(REGION_KEY, JSON.stringify(regions));
  $("captureState").textContent = "框線已記在這台瀏覽器。之後還是要先分享遊戲視窗。";
}

function startReading() {
  if (!roster?.heroes.length) {
    $("captureState").textContent = "請先讀入帳號。";
    return;
  }
  clearInterval(timer);
  timer = setInterval(sampleVideo, 700);
  sampleVideo();
}

function sampleVideo() {
  const video = $("game");
  if (!video.videoWidth) return;
  const board = $("board");
  board.width = video.videoWidth;
  board.height = video.videoHeight;
  const ctx = board.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0);
  const frame = ctx.getImageData(0, 0, board.width, board.height);
  const read = readFrame(frame.data, board.width, board.height, regions, book);
  consider(read);
}

function runFixture(name) {
  const owned = new Set((roster?.heroes || []).map((hero) => hero.id));
  const ids = catalog.heroes.map((hero) => hero.id).filter((id) => !owned.size || owned.has(id));
  const assignment = {
    user: [],
    enemy: [],
    prebans: [],
    actor: null,
    skills: [],
    scale: 1,
  };
  if (name === "draft") {
    assignment.prebans = [ids[0]];
    assignment.user = [ids[3]];
    assignment.enemy = [ids[1], ids[2]];
  } else if (name === "battle") {
    assignment.user = ids.slice(0, 4);
    assignment.enemy = ids.slice(4, 8);
    assignment.actor = ids[0];
    assignment.skills = ["bright", "bright", "bright"];
  } else if (name === "scaled") {
    assignment.user = [ids[9]];
    assignment.scale = 1.15;
  } else {
    assignment.user = ["noise"];
  }
  const width = 960;
  const height = 540;
  const data = paintFixture(width, height, DEFAULT_REGIONS, book, assignment);
  const board = $("board");
  board.hidden = false;
  board.width = width;
  board.height = height;
  const ctx = board.getContext("2d");
  ctx.putImageData(new ImageData(data, width, height), 0, 0);
  $("game").hidden = true;
  const read = readFrame(data, width, height, DEFAULT_REGIONS, book);
  $("captureState").textContent = "這張是內建檢查畫面，不是你的遊戲。正式使用請分享遊戲視窗。";
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
});
$("loadExample").addEventListener("click", () => loadExample().catch(showError));
$("loadSample").addEventListener("click", () => loadSample().catch(showError));
$("applyText").addEventListener("click", () => {
  try {
    applyRoster(JSON.parse($("rosterText").value));
  } catch (error) {
    showError(error);
  }
});
$("file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    $("rosterText").value = text;
    applyRoster(JSON.parse(text));
  } catch (error) {
    showError(error);
  }
});

function showError(error) {
  $("rosterState").textContent = error.message || String(error);
}

for (const id of ["cutoff", "first", "rank", "maxEnhance"]) {
  $(id).addEventListener("change", () => {
    if (lastRead) consider(lastRead);
  });
}
$("share").addEventListener("click", () => shareWindow().catch((error) => {
  $("captureState").textContent = `沒有接上視窗：${error.message || error}`;
}));
$("remember").addEventListener("click", rememberRegions);
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

boot().catch((error) => {
  $("live").innerHTML = `<p class="rate">建議無效</p><p class="warn">資料沒載入：${error.message || error}</p>`;
});
