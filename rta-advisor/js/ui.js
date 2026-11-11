import { adviseFromScreen, buildGearReport, counterEdges, parseRoster, sourceBasis } from "./engine.js";
import { DEFAULT_REGIONS, paintFixture, readFrame } from "./screen.js";

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

function applyRoster(data) {
  roster = parseRoster(data, catalog);
  const bits = [`已讀入 ${roster.heroes.length} 名可對照的英雄`];
  if (roster.label) bits.unshift(roster.label);
  if (roster.warning) bits.push(roster.warning);
  if (roster.unknown.length) bits.push(`這版賽季模型沒有：${roster.unknown.join("、")}`);
  $("rosterState").textContent = bits.join("。");
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
    const report = buildGearReport(hero, def, catalog);
    const have = report.haveSets.join("、") || "沒有讀到";
    const meta = report.metaSets.join(" + ") || "這個賽季沒有套裝統計";
    const mains = report.mains || "這個來源沒有寫主屬性";
    const subs = report.substatPriority.join(" → ") || "這個來源沒有寫副屬性優先序";
    return `<article class="card">
      <h3>${def.nameZh}</h3>
      <p class="meta">速度 ${hero.speed}　攻擊 ${hero.attack}　生命 ${hero.hp}　防禦 ${hero.defense}</p>
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

function names(ids) {
  const byId = Object.fromEntries(catalog.heroes.map((hero) => [hero.id, hero]));
  return (ids || []).map((id) => {
    if (!id || id === "empty") return "空";
    if (id === "unknown") return "未辨識";
    return byId[id]?.nameZh || "未收錄";
  }).join("、");
}

function renderLive(result, read) {
  const root = $("live");
  const version = result?.version || sourceBasis(catalog).version;
  const seen = read ? `<p class="meta">我方 ${names(read.user)}。對方 ${names(read.enemy)}。預禁 ${names(read.prebans)}。現在行動 ${names([read.actorId])}。</p>` : "";
  if (!result?.ok) {
    root.innerHTML = `<p class="rate">建議無效</p><p class="warn">${result?.reason || "三項資料還沒齊。"}</p>${seen}${versionBlock(version)}`;
    return;
  }
  const rate = result.rate == null ? "" : `<p class="rate">估計勝率 ${Math.round(result.rate * 100)}%</p><p class="warn">這是沙盤試出來的比例，不是必勝。</p>`;
  const burn = result.action?.burn ? `<p><strong>${result.action.burn.yes ? "要燒魂" : "不要燒魂"}。</strong>${result.action.burn.text}</p>` : "";
  root.innerHTML = `
    <p class="action">${result.action?.title || ""}</p>
    <p>${result.action?.detail || ""}</p>
    ${burn}
    ${rate}
    <p><strong>主要原因：</strong>${result.reason?.summary || ""}</p>
    <ul class="reasons">${(result.reason?.lines || []).map((line) => `<li>${line}</li>`).join("")}</ul>
    ${seen}
    ${versionBlock(version)}
  `;
}

function versionBlock(version) {
  const commit = (version.fribbelsCommit || "").slice(0, 8);
  return `<p class="note">這一則用的資料：${version.fetchedOn || "無日期"} 更新。賽季 ${version.seasonLabel || "沒有"}。遊戲版本 ${version.patchZh || "沒有"}。Fribbels ${commit}（${version.fribbelsCommitDate || ""}）。英雄資料庫 ${version.heroCount} 名，賽季模型 ${version.metaCount} 名，神器 ${version.artifactCount}。</p>`;
}

function options() {
  return {
    firstPick: $("first").value === "first",
    rank: $("rank").value,
    assumeMaxEnhance: $("maxEnhance").checked,
    trials: 4,
    roster,
  };
}

function consider(read) {
  const key = JSON.stringify({ read, first: $("first").value, rank: $("rank").value, enhance: $("maxEnhance").checked });
  if (key === lastKey && lastAdvice) return lastAdvice;
  lastKey = key;
  lastAdvice = adviseFromScreen(catalog, read, options());
  renderLive(lastAdvice, read);
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
    $("updateState").textContent = "更新沒有連上。請在 rta-advisor 資料夾執行 python3 server.py，再用瀏覽器開 http://127.0.0.1:8765/ 。不要只用 python3 -m http.server。";
  }
});

boot().catch((error) => {
  $("live").innerHTML = `<p class="rate">建議無效</p><p class="warn">資料沒載入：${error.message || error}</p>`;
});
