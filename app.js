/* Manifiesto de ruta — versión que usa GitHub Issues como base de datos.
   La llave de acceso (token) se guarda SOLO en este navegador (localStorage),
   nunca en el código. Se configura una vez por dispositivo. */

const API = "https://api.github.com";
const root = document.getElementById("app");

const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const timeLabel = (iso) => new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
const timeAgo = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "justo ahora";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
};
const slug = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "op";
const normalize = (s) => (s || "").toString().trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const MESES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v !== ""));
}

function matchesToday(fechaRaw) {
  const d = new Date();
  const day = String(d.getDate());
  const month = MESES_ES[d.getMonth()];
  const norm = normalize(fechaRaw);
  return norm.includes(day) && norm.includes(month);
}

async function fetchSheetData() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("La hoja de Sheets respondió con un error (status " + res.status + ")");
  const rows = parseCSV(await res.text());
  if (!rows.length) return { col: {}, rows: [] };
  const header = rows[0].map(normalize);
  const idx = (name) => header.indexOf(normalize(name));
  const col = { fecha: idx("FECHA"), pedido: idx("pedido"), jaula: idx("Jaula"), colonia: idx("COLONIA") };
  const dataRows = rows.slice(1).filter((r) => col.pedido >= 0 && (r[col.pedido] || "").trim());
  return { col, rows: dataRows };
}

/* ---------- elegir jaula (pedidos automáticos desde Sheets) ---------- */
let showJaulaPicker = false;
let jaulaData = {};
let sheetCol = {};
let jaulaLoading = false;

async function loadJaulaOptions() {
  jaulaLoading = true; showJaulaPicker = true; render();
  try {
    const { col, rows } = await fetchSheetData();
    sheetCol = col;
    const todays = rows.filter((r) => matchesToday(r[col.fecha]));
    const byJaula = {};
    todays.forEach((r) => {
      const j = (r[col.jaula] || "").trim();
      if (!j) return;
      if (!byJaula[j]) byJaula[j] = [];
      byJaula[j].push(r);
    });
    jaulaData = byJaula;
  } catch (err) {
    renderError("No se pudo leer la hoja de rutas: " + err.message, loadJaulaOptions);
    return;
  } finally {
    jaulaLoading = false;
  }
  render();
}

async function chooseJaula(jaulaKey) {
  const rows = jaulaData[jaulaKey] || [];
  try {
    issue = await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title: `Ruta — ${name} — ${todayISO()}`,
        body: "",
        labels: ["ruta", `op-${opSlug}`, `date-${todayISO()}`, `jaula-${slug(jaulaKey)}`],
      }),
    });
    pedidos = rows.map((r) => ({
      id: newId(),
      text: r[sheetCol.pedido].trim() + (sheetCol.colonia >= 0 && r[sheetCol.colonia] ? ` — ${r[sheetCol.colonia].trim()}` : ""),
      done: false,
    }));
    showJaulaPicker = false;
    mode = "build";
    await persistPedidos();
    render();
  } catch (err) {
    renderError("No se pudo crear tu ruta: " + err.message, () => chooseJaula(jaulaKey));
  }
}

async function skipJaulaManual() {
  try {
    issue = await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title: `Ruta — ${name} — ${todayISO()}`,
        body: "",
        labels: ["ruta", `op-${opSlug}`, `date-${todayISO()}`],
      }),
    });
    pedidos = []; showJaulaPicker = false; mode = "build";
    render();
  } catch (err) {
    renderError("No se pudo crear tu ruta: " + err.message, skipJaulaManual);
  }
}


const escapeHtml = (str) => (str ?? "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------- token: solo en este navegador ---------- */
function getToken() { try { return localStorage.getItem("rutas_gh_token") || ""; } catch { return ""; } }
function setToken(t) { try { localStorage.setItem("rutas_gh_token", t.trim()); } catch { /* algunos navegadores bloquean el guardado local */ } }
function clearToken() { try { localStorage.removeItem("rutas_gh_token"); } catch { /* ignorar */ } }

/* ---------- cuántos "finalizados" ya vio el admin, por ruta ---------- */
function getSeenCounts() {
  try { return JSON.parse(localStorage.getItem("rutas_admin_seen_counts") || "{}"); } catch { return {}; }
}
function markRouteSeen(issueNumber, count) {
  try {
    const seen = getSeenCounts();
    seen[issueNumber] = count;
    localStorage.setItem("rutas_admin_seen_counts", JSON.stringify(seen));
  } catch { /* ignorar */ }
}

/* ---------- llamadas a GitHub ---------- */
async function gh(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      "Authorization": `Bearer ${getToken()}`,
      "Accept": "application/vnd.github+json",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}
async function ghRaw(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Authorization": `Bearer ${getToken()}`, "Accept": "application/vnd.github.raw" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return res.blob();
}

async function verifyToken() {
  await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}`);
}

/* ---------- compresión de imágenes ---------- */
async function compressImage(file, maxW = 900, quality = 0.6) {
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
  });
  const img = await new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl;
  });
  const scale = Math.min(1, maxW / img.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  const dataUrlOut = canvas.toDataURL("image/jpeg", quality);
  return dataUrlOut.split(",")[1]; // base64 puro, listo para subir
}

/* ---------- historial del navegador: para que "atrás" funcione bien ---------- */
function pushView(view, extra = {}) {
  history.pushState({ view, ...extra }, "", location.pathname);
}
function applyPopState(state) {
  const s = state || { view: getToken() ? "name" : "setup" };
  switch (s.view) {
    case "setup":
      break;
    case "name":
      name = ""; issue = null; pedidos = []; mode = "build";
      adminSelected = null; showActivity = false;
      break;
    case "operator":
      currentRole = "operador"; adminSelected = null; showActivity = false;
      break;
    case "admin-list":
      currentRole = "admin"; adminSelected = null; showActivity = false;
      break;
    case "admin-detail":
      currentRole = "admin"; showActivity = false;
      adminSelected = s.issue; adminSelectedPedidos = s.pedidos; adminSelectedComments = s.comments;
      break;
    case "activity":
      currentRole = "admin"; showActivity = true; adminSelected = null;
      break;
  }
}
window.addEventListener("popstate", (e) => { applyPopState(e.state); render(); });

/* ---------- estado ---------- */
let name = "";
let opSlug = "";
let issue = null;
let pedidos = []; // {text, done}
let mode = "build";
let saving = false;
let uploading = false;
let currentRole = "operador";

let adminIssues = [];
let adminDate = todayISO();
let adminSelected = null;
let adminSelectedComments = [];
let adminSelectedPedidos = [];
let activityFeed = [];
let unreadCount = 0;
let showActivity = false;

/* ---------- visor de fotos en grande ---------- */
function showLightbox(src) {
  let lb = document.getElementById("lightbox-overlay");
  if (!lb) {
    lb = document.createElement("div");
    lb.id = "lightbox-overlay";
    lb.className = "lightbox";
    document.body.appendChild(lb);
  }
  lb.innerHTML = `<button class="lightbox-close" id="lightbox-close">✕</button><img src="${src}" />`;
  lb.style.display = "flex";
  lb.onclick = (e) => { if (e.target === lb || e.target.id === "lightbox-close") lb.style.display = "none"; };
}

/* ---------- parseo del checklist en el body del issue ---------- */
function newId() { return `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
function parseBody(body) {
  return (body || "").split("\n").filter((l) => l.trim().startsWith("- ["))
    .map((l) => ({ id: newId(), done: /^- \[x\]/i.test(l.trim()), text: l.replace(/^- \[[ xX]\]\s*/, "").trim() }));
}
function buildBody(list) {
  return list.map((p) => `- [${p.done ? "x" : " "}] ${p.text}`).join("\n");
}

/* ---------- operador: cargar/crear el issue de hoy ---------- */
async function loadTodayIssue() {
  try {
    const list = await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues?labels=op-${opSlug},date-${todayISO()}&state=all`);
    if (list && list.length) {
      issue = list[0];
      pedidos = parseBody(issue.body);
      const labelNames = (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name));
      mode = labelNames.includes("confirmada") ? "deliver" : "build";
      render();
    } else {
      await loadJaulaOptions();
    }
  } catch (err) {
    renderError("No se pudo cargar tu ruta de hoy: " + err.message, loadTodayIssue);
  }
}

async function persistPedidos() {
  saving = true; render();
  await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issue.number}`, {
    method: "PATCH", body: JSON.stringify({ body: buildBody(pedidos) }),
  });
  saving = false; render();
}
async function addComment(message) {
  await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issue.number}/comments`, {
    method: "POST", body: JSON.stringify({ body: message }),
  });
}

function addPedido(text) {
  if (!text.trim()) return;
  pedidos.push({ id: newId(), text: text.trim(), done: false });
  render();
  if (mode === "deliver") {
    persistPedidos();
    addComment(`➕ ${name} agregó un nuevo pedido a su ruta: ${text.trim()}`);
  }
}
function removePedido(i) { pedidos.splice(i, 1); render(); }
function movePedido(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= pedidos.length) return;
  [pedidos[i], pedidos[j]] = [pedidos[j], pedidos[i]];
  render();
  if (mode === "deliver") {
    persistPedidos();
    addComment(`↕️ ${name} cambió el orden de su ruta`);
  }
}
async function startDeliveries() {
  if (!pedidos.length) return;
  mode = "deliver";
  persistPedidos();
  render();
  try {
    const labelNames = (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name));
    if (!labelNames.includes("confirmada")) {
      issue = await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${issue.number}`, {
        method: "PATCH", body: JSON.stringify({ labels: [...labelNames, "confirmada"] }),
      });
      addComment(`✅ ${name} confirmó su ruta (${pedidos.length} pedidos)`);
    }
  } catch { /* no bloquear al operador si esto falla, ya está en modo entrega de cualquier forma */ }
}

let pendingPhotos = {}; // pedidoId -> [{file, previewUrl}]
let pendingCameraTarget = null;

function openCamera(pedidoId) { pendingCameraTarget = pedidoId; document.getElementById("photo-input").click(); }

function onPhotosChosen(files) {
  if (!files.length || !pendingCameraTarget) return;
  const id = pendingCameraTarget;
  if (!pendingPhotos[id]) pendingPhotos[id] = [];
  files.forEach((file) => pendingPhotos[id].push({ file, previewUrl: URL.createObjectURL(file) }));
  render();
}
function removePendingPhoto(pedidoId, idx) {
  pendingPhotos[pedidoId]?.splice(idx, 1);
  render();
}

let finalizingIds = new Set();

async function finalizarPedido(pedidoId) {
  if (finalizingIds.has(pedidoId)) return; // ya se está subiendo esta evidencia, ignorar el toque repetido
  const staged = pendingPhotos[pedidoId] || [];
  if (!staged.length) { alert("Agrega al menos una foto antes de finalizar."); return; }
  const pedido = pedidos.find((p) => p.id === pedidoId);
  finalizingIds.add(pedidoId);
  uploading = true; render();
  try {
    const stamp = Date.now();
    const paths = [];
    for (let n = 0; n < staged.length; n++) {
      const b64 = await compressImage(staged[n].file);
      const path = `evidence/${opSlug}/${todayISO()}/${stamp}-${n}.jpg`;
      await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`, {
        method: "PUT",
        body: JSON.stringify({ message: `Evidencia: ${pedido.text}`, content: b64 }),
      });
      paths.push(path);
    }
    pedido.done = true;
    await persistPedidos();
    const time = timeLabel(new Date().toISOString());
    await addComment(`📦 ${pedido.text} — finalizado ${time}\nFotos: ${paths.join(", ")}`);
    delete pendingPhotos[pedidoId];
    render();
  } catch (err) {
    alert("No se pudo subir la evidencia: " + err.message);
  } finally {
    finalizingIds.delete(pedidoId);
    uploading = false; render();
  }
}

/* ---------- admin ---------- */
let adminPollTimer = null;
function startAdminPolling() {
  stopAdminPolling();
  adminPollTimer = setInterval(silentRefreshAdmin, 20000);
}
function stopAdminPolling() {
  if (adminPollTimer) { clearInterval(adminPollTimer); adminPollTimer = null; }
}
async function silentRefreshAdmin() {
  if (currentRole !== "admin" || adminSelected || showActivity) return;
  try {
    adminIssues = await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues?labels=ruta,date-${adminDate}&state=open&per_page=100`);
    await loadActivity();
    if (currentRole === "admin" && !adminSelected && !showActivity) render();
  } catch { /* falla silenciosa: no interrumpir al admin con errores de fondo */ }
}

async function loadAdmin() {
  try {
    adminIssues = await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues?labels=ruta,date-${adminDate}&state=open&per_page=100`);
    render();
    await loadActivity();
    render();
    startAdminPolling();
  } catch (err) {
    renderError("No se pudo cargar el panel del " + adminDate + ": " + err.message, loadAdmin);
  }
}

async function loadActivity() {
  const all = [];
  for (const iss of adminIssues) {
    try {
      const comments = await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${iss.number}/comments?per_page=50`);
      const opName = iss.title.replace(/^Ruta\s*—\s*/, "").split("—")[0].trim();
      comments.forEach((c) => {
        if (c.body.startsWith("📦") || c.body.startsWith("↕️") || c.body.startsWith("➕") || c.body.startsWith("✅")) {
          all.push({ id: c.id, message: c.body.split("\n")[0], created_at: c.created_at });
        }
      });
    } catch { /* si un issue falla, seguimos con los demás */ }
  }
  all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  activityFeed = all.slice(0, 50);
  let lastSeen = 0;
  try { lastSeen = Number(localStorage.getItem("rutas_admin_last_seen") || 0); } catch { /* ignorar */ }
  unreadCount = activityFeed.filter((e) => new Date(e.created_at).getTime() > lastSeen).length;
}

function openActivityScreen() {
  showActivity = true;
  try { localStorage.setItem("rutas_admin_last_seen", String(Date.now())); } catch { /* ignorar */ }
  unreadCount = 0;
  pushView("activity");
  render();
}
async function openAdminIssue(iss) {
  try {
    adminSelected = iss;
    adminSelectedPedidos = parseBody(iss.body);
    adminSelectedComments = await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${iss.number}/comments`);
    markRouteSeen(iss.number, adminSelectedPedidos.filter((p) => p.done).length);
    pushView("admin-detail", { issue: iss, pedidos: adminSelectedPedidos, comments: adminSelectedComments });
    render();
    hydrateAdminPhotos();
  } catch (err) {
    renderError("No se pudo abrir esta ruta: " + err.message, () => openAdminIssue(iss));
  }
}

async function archiveRoute(iss) {
  const opName = iss.title.replace(/^Ruta\s*—\s*/, "").split("—")[0].trim();
  if (!confirm(`¿Archivar la ruta de ${opName}? Se oculta del panel, pero la evidencia y el historial quedan a salvo — la puedes volver a ver en cualquier momento directo en GitHub.`)) return;
  try {
    await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${iss.number}`, {
      method: "PATCH", body: JSON.stringify({ state: "closed" }),
    });
    adminSelected = null;
    pushView("admin-list");
    await loadAdmin();
  } catch (err) {
    alert("No se pudo archivar la ruta: " + err.message);
  }
}
async function hydrateAdminPhotos() {
  for (const c of adminSelectedComments) {
    const m = c.body.match(/Fotos:\s*(.+)/);
    if (!m) continue;
    const paths = m[1].split(",").map((p) => p.trim());
    for (const p of paths) {
      const img = document.querySelector(`img[data-path="${CSS.escape(p)}"]`);
      if (img && !img.src) {
        try {
          const blob = await ghRaw(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${p}`);
          const url = URL.createObjectURL(blob);
          img.src = url;
          img.onclick = () => showLightbox(url);
        } catch { /* foto no disponible */ }
      }
    }
  }
}

/* ================= RENDER ================= */
function render() {
  if (!getToken()) return renderSetup();
  if (!name) return renderNamePrompt();
  if (currentRole === "operador" && showJaulaPicker) return renderJaulaPicker();
  return currentRole === "operador" ? renderOperator() : renderAdmin();
}

function renderJaulaPicker() {
  const right = `<div class="header-right"><button class="icon" id="sign-out" title="Salir">⎋</button></div>`;
  const keys = Object.keys(jaulaData).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  let body = "";
  if (jaulaLoading) {
    body = `<div class="center small"><div class="spinner"></div></div>`;
  } else if (!keys.length) {
    body = `
      <div class="empty">No encontré pedidos de hoy en la hoja de rutas.</div>
      <button class="btn-primary" id="skip-manual" style="width:100%;margin-top:12px;padding:13px 0;font-size:15px;">Armar mi ruta a mano</button>
    `;
  } else {
    body = `
      <div class="hint">Elige la jaula que te asignaron hoy — tu ruta se arma sola con esos pedidos.</div>
      ${keys.map((k) => `
        <button class="stop-row clickable" data-jaula="${escapeHtml(k)}">
          <div class="stop-badge">${escapeHtml(k)}</div>
          <div style="flex:1;text-align:left;">
            <div style="font-size:14px;font-weight:600;">Jaula ${escapeHtml(k)}</div>
            <div class="mono" style="font-size:11.5px;color:#94A3B8;">${jaulaData[k].length} pedido${jaulaData[k].length > 1 ? "s" : ""}</div>
          </div>
        </button>`).join("")}
      <button class="btn-link" id="skip-manual" style="width:100%;margin-top:10px;">Mi jaula no aparece / armar a mano</button>
    `;
  }
  root.innerHTML = `${headerHtml({ title: name, subtitle: "Elige tu jaula", rightHtml: right })}<div class="container">${body}</div>`;
  document.getElementById("sign-out").onclick = () => { name = ""; showJaulaPicker = false; pushView("name"); render(); };
  const skip = document.getElementById("skip-manual");
  if (skip) skip.onclick = skipJaulaManual;
  root.querySelectorAll("[data-jaula]").forEach((b) => { b.onclick = () => chooseJaula(b.dataset.jaula); });
}

function renderSetup() {
  root.innerHTML = `
    <div class="landing">
      <div class="brand">
        <div class="brand-icon">🔧</div>
        <div><div class="brand-name">Configuración inicial</div><div class="brand-sub">Solo una vez por dispositivo</div></div>
      </div>
      <div class="setup-box">
        <p>Pega aquí la llave de acceso que te compartió tu administrador. Se guarda solo en este dispositivo — nunca se sube a ningún lado.</p>
        <textarea id="token-input" rows="3" placeholder="github_pat_..."></textarea>
        <button class="btn-primary" id="save-token">Guardar y continuar</button>
        <div id="setup-msg"></div>
      </div>
    </div>`;
  document.getElementById("save-token").onclick = async () => {
    const val = document.getElementById("token-input").value.trim();
    const msg = document.getElementById("setup-msg");
    if (!val) return;
    setToken(val);
    msg.innerHTML = `<div style="text-align:center;font-size:12.5px;">Verificando...</div>`;
    try {
      await verifyToken();
      render();
    } catch (err) {
      clearToken();
      msg.innerHTML = `<div class="error-msg">No se pudo conectar: ${escapeHtml(err.message)}. Revisa la llave con tu administrador.</div>`;
    }
  };
}

function renderNamePrompt() {
  root.innerHTML = `
    <div class="landing">
      <div class="brand">
        <div class="brand-icon">🚚</div>
        <div><div class="brand-name">Manifiesto de ruta</div><div class="brand-sub">¿Cómo te llamas?</div></div>
      </div>
      <div class="row-input">
        <input type="text" id="name-input" placeholder="Nombre del operador" style="flex:1" />
        <button class="btn-primary" id="enter-btn">Entrar</button>
      </div>
      <button class="btn-link" id="admin-link">Soy administrador</button>
    </div>`;
  const go = async () => {
    const val = document.getElementById("name-input").value.trim();
    if (!val) return;
    name = val; opSlug = slug(val); currentRole = "operador";
    pushView("operator");
    renderCenter();
    await loadTodayIssue();
  };
  document.getElementById("enter-btn").onclick = go;
  document.getElementById("name-input").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  document.getElementById("admin-link").onclick = async () => {
    name = "Administrador"; currentRole = "admin"; adminDate = todayISO();
    pushView("admin-list");
    renderCenter();
    await loadAdmin();
  };
}

function renderCenter() { root.innerHTML = `<div class="center"><div class="spinner"></div></div>`; }

function renderError(message, retryFn) {
  root.innerHTML = `
    <div class="landing">
      <div class="brand">
        <div class="brand-icon">⚠️</div>
        <div><div class="brand-name">Algo falló al cargar</div><div class="brand-sub">Puede ser un bache momentáneo de conexión</div></div>
      </div>
      <div class="setup-box">
        <p>${escapeHtml(message)}</p>
        <button class="btn-primary" id="retry-btn">Reintentar</button>
        <button class="btn-link" id="back-to-name">Volver al inicio</button>
      </div>
    </div>`;
  document.getElementById("retry-btn").onclick = retryFn;
  document.getElementById("back-to-name").onclick = () => {
    name = ""; issue = null; pedidos = []; adminSelected = null; showActivity = false;
    pushView("name"); render();
  };
}

function headerHtml({ title, subtitle, back, rightHtml }) {
  return `
    <div class="header">
      ${back ? `<button class="icon" id="back-btn">←</button>` : ""}
      <div class="titles"><div class="title">${escapeHtml(title)}</div><div class="subtitle">${escapeHtml(subtitle)}</div></div>
      ${rightHtml || ""}
    </div>`;
}

function renderOperator() {
  const delivered = pedidos.filter((p) => p.done).length;
  const right = `<div class="header-right">
    ${saving || uploading ? `<div class="spinner" style="width:14px;height:14px;border-width:2px"></div>` : ""}
    <button class="icon" id="sign-out" title="Salir">⎋</button>
  </div>`;

  let body = "";
  if (mode === "build") {
    body = `
      <div class="row-input" style="max-width:none;margin-bottom:16px;">
        <input type="text" id="pedido-input" placeholder="Número o nombre de pedido" style="flex:1" />
        <button class="btn-primary" id="add-pedido">+</button>
      </div>
      ${!pedidos.length ? `<div class="empty">Agrega los pedidos en el orden en que entregarás.</div>` : ""}
      ${pedidos.map((p, i) => `
        <div class="stop-row">
          <div class="stop-badge">${i + 1}</div>
          <div class="stop-address">${escapeHtml(p.text)}</div>
          <button class="btn-icon" data-move="${i}:-1" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="btn-icon" data-move="${i}:1" ${i === pedidos.length - 1 ? "disabled" : ""}>↓</button>
          <button class="btn-icon" style="color:var(--danger)" data-remove="${i}">✕</button>
        </div>`).join("")}
      ${pedidos.length ? `<button class="btn-primary" id="start-route" style="width:100%;margin-top:18px;padding:13px 0;font-size:15px;">✅ Confirmar ruta (${pedidos.length} pedidos)</button>` : ""}
    `;
  } else {
    const pct = pedidos.length ? Math.round((delivered / pedidos.length) * 100) : 0;
    body = `
      <div class="progress-wrap">
        <div class="progress-labels"><span class="mono">${delivered}/${pedidos.length} finalizados</span><span class="mono">${pct}%</span></div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="hint">↕ Puedes reordenar tus pedidos pendientes cuando haga falta.</div>
      ${pedidos.map((p, i) => {
        const staged = pendingPhotos[p.id] || [];
        return `
        <div class="stop-row deliver">
          ${p.done ? `<div class="stamp">FINALIZADO</div>` : ""}
          <div style="display:flex;align-items:center;gap:10px;width:100%;">
            <div class="stop-badge ${p.done ? "done" : ""}">${i + 1}</div>
            <div class="stop-address">${escapeHtml(p.text)}</div>
            ${!p.done ? `
              <button class="btn-icon" data-move="${i}:-1" ${i === 0 ? "disabled" : ""}>↑</button>
              <button class="btn-icon" data-move="${i}:1" ${i === pedidos.length - 1 ? "disabled" : ""}>↓</button>` : ""}
          </div>
          ${p.done ? `<div class="mono" style="font-size:12px;color:var(--route);">✓ finalizado</div>` : `
            ${staged.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${staged.map((s, sIdx) => `
                <div style="position:relative;">
                  <img src="${s.previewUrl}" style="width:64px;height:64px;object-fit:cover;border-radius:6px;border:1px solid var(--line);" />
                  <button data-remove-photo="${p.id}:${sIdx}" style="position:absolute;top:-6px;right:-6px;background:var(--danger);color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:11px;cursor:pointer;">✕</button>
                </div>`).join("")}
            </div>` : ""}
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn-secondary" data-addphoto="${p.id}">📷 Agregar foto</button>
              ${staged.length ? (finalizingIds.has(p.id)
                ? `<button class="btn-primary" disabled style="padding:9px 14px;font-size:12.5px;opacity:0.6;">Subiendo…</button>`
                : `<button class="btn-primary" style="padding:9px 14px;font-size:12.5px;" data-finalize="${p.id}">✅ Finalizar (${staged.length} foto${staged.length > 1 ? "s" : ""})</button>`
              ) : ""}
            </div>
          `}
        </div>`;
      }).join("")}
      <div class="row-input" style="max-width:none;margin-top:14px;">
        <input type="text" id="pedido-extra-input" placeholder="Agregar otro pedido a la ruta" style="flex:1" />
        <button class="btn-primary" id="add-pedido-extra" style="padding:0 14px;">+</button>
      </div>
      ${delivered === pedidos.length && pedidos.length > 0 ? `<div class="done-msg">Ruta completa. Buen trabajo.</div>` : ""}
    `;
  }

  root.innerHTML = `
    <input type="file" accept="image/*" capture="environment" multiple id="photo-input" style="display:none" />
    ${headerHtml({ title: name, subtitle: mode === "build" ? "Armando ruta" : `${delivered}/${pedidos.length} finalizados`, rightHtml: right })}
    <div class="container">${body}</div>`;

  bindOperatorEvents();
}

function bindOperatorEvents() {
  document.getElementById("sign-out").onclick = () => { name = ""; issue = null; pedidos = []; mode = "build"; pendingPhotos = {}; pushView("name"); render(); };
  const addBtn = document.getElementById("add-pedido");
  if (addBtn) addBtn.onclick = () => { const inp = document.getElementById("pedido-input"); addPedido(inp.value); inp.value = ""; };
  const inp = document.getElementById("pedido-input");
  if (inp) inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { addPedido(inp.value); inp.value = ""; } });
  const extraBtn = document.getElementById("add-pedido-extra");
  if (extraBtn) extraBtn.onclick = () => { const i = document.getElementById("pedido-extra-input"); addPedido(i.value); i.value = ""; };
  const extraInp = document.getElementById("pedido-extra-input");
  if (extraInp) extraInp.addEventListener("keydown", (e) => { if (e.key === "Enter") { addPedido(extraInp.value); extraInp.value = ""; } });
  const startBtn = document.getElementById("start-route");
  if (startBtn) startBtn.onclick = startDeliveries;
  root.querySelectorAll("[data-move]").forEach((b) => { b.onclick = () => { const [i, d] = b.dataset.move.split(":"); movePedido(Number(i), Number(d)); }; });
  root.querySelectorAll("[data-remove]").forEach((b) => { b.onclick = () => removePedido(Number(b.dataset.remove)); });
  root.querySelectorAll("[data-addphoto]").forEach((b) => { b.onclick = () => openCamera(b.dataset.addphoto); });
  root.querySelectorAll("[data-remove-photo]").forEach((b) => { b.onclick = () => { const [pid, idx] = b.dataset.removePhoto.split(":"); removePendingPhoto(pid, Number(idx)); }; });
  root.querySelectorAll("[data-finalize]").forEach((b) => { b.onclick = () => finalizarPedido(b.dataset.finalize); });
  document.getElementById("photo-input").onchange = (e) => onPhotosChosen(Array.from(e.target.files));
}

function renderAdmin() {
  if (adminSelected) return renderAdminDetail();
  if (showActivity) return renderActivity();
  const right = `<div class="header-right">
    <button class="icon" id="bell-btn" style="position:relative;">🔔${unreadCount > 0 ? `<span class="badge-dot">${unreadCount}</span>` : ""}</button>
    <button class="icon" id="refresh-btn">⟳</button>
    <button class="icon" id="sign-out">⎋</button>
  </div>`;
  const seenCounts = getSeenCounts();
  const rows = adminIssues.map((iss) => {
    const list = parseBody(iss.body);
    const done = list.filter((p) => p.done).length;
    const unseen = Math.max(0, done - (seenCounts[iss.number] || 0));
    const opName = iss.title.replace(/^Ruta\s*—\s*/, "").split("—")[0].trim();
    const isConfirmed = (iss.labels || []).some((l) => (typeof l === "string" ? l : l.name) === "confirmada");
    return `
      <button class="stop-row clickable" data-open="${iss.number}" style="position:relative;">
        ${unseen > 0 ? `<div class="route-count-badge">${unseen}</div>` : ""}
        <div class="stop-badge ${done === list.length && list.length > 0 ? "done" : ""}">👤</div>
        <div style="flex:1;text-align:left;">
          <div style="display:flex;align-items:center;gap:6px;">
            <div style="font-size:14px;font-weight:600;">${escapeHtml(opName)}</div>
            ${isConfirmed
              ? `<span style="font-size:10px;font-weight:700;color:#16A34A;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:5px;padding:1px 6px;">✅ Confirmada</span>`
              : `<span style="font-size:10px;font-weight:700;color:#92400E;background:#FFFBEB;border:1px solid #FDE68A;border-radius:5px;padding:1px 6px;">⏳ Acomodando</span>`}
          </div>
          <div class="mono" style="font-size:11.5px;color:#94A3B8;">${done}/${list.length} finalizados</div>
        </div>
      </button>`;
  }).join("");

  root.innerHTML = `
    ${headerHtml({ title: "Panel de rutas", subtitle: adminDate === todayISO() ? "Hoy" : adminDate, rightHtml: right })}
    <div class="container">
      <div class="row-input" style="max-width:none;margin-bottom:16px;">
        <input type="date" id="admin-date" value="${adminDate}" max="${todayISO()}" style="flex:1;" />
      </div>
      ${!adminIssues.length ? `<div class="empty">Ningún operador registró ruta este día.</div>` : rows}
    </div>`;

  document.getElementById("admin-date").onchange = (e) => { adminDate = e.target.value; loadAdmin(); };
  document.getElementById("bell-btn").onclick = openActivityScreen;
  document.getElementById("refresh-btn").onclick = loadAdmin;
  document.getElementById("sign-out").onclick = () => { name = ""; stopAdminPolling(); pushView("name"); render(); };
  root.querySelectorAll("[data-open]").forEach((b) => { b.onclick = () => openAdminIssue(adminIssues.find((i) => String(i.number) === b.dataset.open)); });
}

function renderActivity() {
  root.innerHTML = `
    ${headerHtml({ title: "Notificaciones", subtitle: "Cambios de orden y evidencia reportada", back: true })}
    <div class="container">
      ${!activityFeed.length ? `<div class="empty">Aún no hay actividad registrada hoy.</div>` : activityFeed.map((e) => `
        <div class="stop-row" style="align-items:flex-start;">
          <div class="stop-badge" style="background:${e.message.startsWith("📦") ? "var(--route)" : e.message.startsWith("➕") ? "#2563EB" : e.message.startsWith("✅") ? "#16A34A" : "var(--amber)"};">
            ${e.message.startsWith("📦") ? "📷" : e.message.startsWith("➕") ? "➕" : e.message.startsWith("✅") ? "✅" : "↕"}
          </div>
          <div style="flex:1;">
            <div style="font-size:13.5px;">${escapeHtml(e.message)}</div>
            <div class="mono" style="font-size:11px;color:#94A3B8;margin-top:2px;">${timeAgo(e.created_at)}</div>
          </div>
        </div>`).join("")}
    </div>`;
  document.getElementById("back-btn").onclick = () => history.back();
}

function renderAdminDetail() {
  const total = adminSelectedPedidos.length;
  const done = adminSelectedPedidos.filter((p) => p.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const evidenceComments = adminSelectedComments.filter((c) => c.body.includes("Fotos:"));

  root.innerHTML = `
    ${headerHtml({ title: adminSelected.title.replace(/^Ruta\s*—\s*/, "").split("—")[0].trim(), subtitle: "Detalle de ruta", back: true })}
    <div class="container">
      <div class="progress-wrap">
        <div class="progress-labels"><span class="mono">${done}/${total} finalizados</span><span class="mono">${pct}%</span></div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
      ${adminSelectedPedidos.map((p, i) => `
        <div class="stop-row">
          <div class="stop-badge ${p.done ? "done" : ""}">${i + 1}</div>
          <div class="stop-address">${escapeHtml(p.text)}</div>
        </div>`).join("")}
      <div style="margin:18px 0 8px;font-size:12.5px;font-weight:700;color:#64748B;">EVIDENCIA</div>
      ${!evidenceComments.length ? `<div class="empty">Aún sin evidencia.</div>` : evidenceComments.map((c) => {
        const m = c.body.match(/Fotos:\s*(.+)/);
        const paths = m ? m[1].split(",").map((p) => p.trim()) : [];
        const label = c.body.split("\n")[0];
        return `
          <div class="stop-row deliver">
            <div style="font-size:13.5px;">${escapeHtml(label)}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${paths.map((p) => `<img class="evidence-photo" style="max-width:120px;" data-path="${escapeHtml(p)}" />`).join("")}
            </div>
          </div>`;
      }).join("")}
      <button class="btn-link" id="archive-btn" style="width:100%;margin-top:22px;color:var(--danger);">🗄️ Archivar esta ruta</button>
    </div>`;

  document.getElementById("back-btn").onclick = () => history.back();
  document.getElementById("archive-btn").onclick = () => archiveRoute(adminSelected);
  hydrateAdminPhotos();
}

/* ---------- red de seguridad: mostrar cualquier error en pantalla ---------- */
window.addEventListener("error", (e) => {
  root.innerHTML = `<div class="landing"><div class="setup-box">
    <p style="color:var(--danger);font-weight:700;">Error inesperado (mándale captura de esto a soporte):</p>
    <p style="font-family:monospace;font-size:11px;word-break:break-all;">${escapeHtml(e.message)} — ${escapeHtml(String(e.filename || ""))}:${e.lineno || ""}</p>
    <button class="btn-primary" onclick="location.reload()">Recargar</button>
  </div></div>`;
});
window.addEventListener("unhandledrejection", (e) => {
  root.innerHTML = `<div class="landing"><div class="setup-box">
    <p style="color:var(--danger);font-weight:700;">Error inesperado (mándale captura de esto a soporte):</p>
    <p style="font-family:monospace;font-size:11px;word-break:break-all;">${escapeHtml(e.reason?.message || String(e.reason))}</p>
    <button class="btn-primary" onclick="location.reload()">Recargar</button>
  </div></div>`;
});

if (!history.state) history.replaceState({ view: getToken() ? "name" : "setup" }, "", location.pathname);
render();
