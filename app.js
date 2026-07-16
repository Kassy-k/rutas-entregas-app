/* Manifiesto de ruta — versión que usa GitHub Issues como base de datos.
   La llave de acceso (token) se guarda SOLO en este navegador (localStorage),
   nunca en el código. Se configura una vez por dispositivo. */

const API = "https://api.github.com";
const root = document.getElementById("app");

const todayISO = () => new Date().toISOString().slice(0, 10);
const timeLabel = (iso) => new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
const timeAgo = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "justo ahora";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
};
const slug = (s) => (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "op";
const escapeHtml = (str) => (str ?? "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------- token: solo en este navegador ---------- */
function getToken() { return localStorage.getItem("rutas_gh_token") || ""; }
function setToken(t) { localStorage.setItem("rutas_gh_token", t.trim()); }
function clearToken() { localStorage.removeItem("rutas_gh_token"); }

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
let adminSelected = null;
let adminSelectedComments = [];
let adminSelectedPedidos = [];

/* ---------- parseo del checklist en el body del issue ---------- */
function parseBody(body) {
  return (body || "").split("\n").filter((l) => l.trim().startsWith("- ["))
    .map((l) => ({ done: /^- \[x\]/i.test(l.trim()), text: l.replace(/^- \[[ xX]\]\s*/, "").trim() }));
}
function buildBody(list) {
  return list.map((p) => `- [${p.done ? "x" : " "}] ${p.text}`).join("\n");
}

/* ---------- operador: cargar/crear el issue de hoy ---------- */
async function loadTodayIssue() {
  const q = `repo:${GITHUB_OWNER}/${GITHUB_REPO} label:"op-${opSlug}" label:"date-${todayISO()}" type:issue`;
  const found = await gh(`/search/issues?q=${encodeURIComponent(q)}`);
  if (found.items && found.items.length) {
    issue = found.items[0];
  } else {
    issue = await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title: `Ruta — ${name} — ${todayISO()}`,
        body: "",
        labels: ["ruta", `op-${opSlug}`, `date-${todayISO()}`],
      }),
    });
  }
  pedidos = parseBody(issue.body);
  mode = pedidos.length ? "deliver" : "build";
  render();
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
  pedidos.push({ text: text.trim(), done: false });
  render();
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
function startDeliveries() {
  if (!pedidos.length) return;
  mode = "deliver";
  persistPedidos();
  render();
}

let pendingIndex = null;
function openCamera(i) { pendingIndex = i; document.getElementById("photo-input").click(); }
async function onPhotosChosen(files) {
  if (!files.length || pendingIndex === null) return;
  const i = pendingIndex;
  uploading = true; render();
  try {
    const stamp = Date.now();
    const paths = [];
    for (let n = 0; n < files.length; n++) {
      const b64 = await compressImage(files[n]);
      const path = `evidence/${opSlug}/${todayISO()}/${stamp}-${n}.jpg`;
      await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`, {
        method: "PUT",
        body: JSON.stringify({ message: `Evidencia: ${pedidos[i].text}`, content: b64 }),
      });
      paths.push(path);
    }
    pedidos[i].done = true;
    await persistPedidos();
    const time = timeLabel(new Date().toISOString());
    await addComment(`📦 ${pedidos[i].text} — entregado ${time}\nFotos: ${paths.join(", ")}`);
    render();
  } catch (err) {
    alert("No se pudo subir la evidencia: " + err.message);
  } finally {
    uploading = false; render();
  }
}

/* ---------- admin ---------- */
async function loadAdmin() {
  adminIssues = await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues?labels=ruta,date-${todayISO()}&state=all&per_page=100`);
  render();
}
async function openAdminIssue(iss) {
  adminSelected = iss;
  adminSelectedPedidos = parseBody(iss.body);
  adminSelectedComments = await gh(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues/${iss.number}/comments`);
  render();
  hydrateAdminPhotos();
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
          img.src = URL.createObjectURL(blob);
        } catch { /* foto no disponible */ }
      }
    }
  }
}

/* ================= RENDER ================= */
function render() {
  if (!getToken()) return renderSetup();
  if (!name) return renderNamePrompt();
  return currentRole === "operador" ? renderOperator() : renderAdmin();
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
    renderCenter();
    await loadTodayIssue();
  };
  document.getElementById("enter-btn").onclick = go;
  document.getElementById("name-input").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  document.getElementById("admin-link").onclick = async () => {
    name = "Administrador"; currentRole = "admin";
    renderCenter();
    await loadAdmin();
  };
}

function renderCenter() { root.innerHTML = `<div class="center"><div class="spinner"></div></div>`; }

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
      ${pedidos.length ? `<button class="btn-primary" id="start-route" style="width:100%;margin-top:18px;padding:13px 0;font-size:15px;">Iniciar ruta (${pedidos.length} pedidos)</button>` : ""}
    `;
  } else {
    const pct = pedidos.length ? Math.round((delivered / pedidos.length) * 100) : 0;
    body = `
      <div class="progress-wrap">
        <div class="progress-labels"><span class="mono">${delivered}/${pedidos.length} entregados</span><span class="mono">${pct}%</span></div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="hint">↕ Puedes reordenar tus pedidos pendientes cuando haga falta.</div>
      ${pedidos.map((p, i) => `
        <div class="stop-row deliver">
          ${p.done ? `<div class="stamp">ENTREGADO</div>` : ""}
          <div style="display:flex;align-items:center;gap:10px;width:100%;">
            <div class="stop-badge ${p.done ? "done" : ""}">${i + 1}</div>
            <div class="stop-address">${escapeHtml(p.text)}</div>
            ${!p.done ? `
              <button class="btn-icon" data-move="${i}:-1" ${i === 0 ? "disabled" : ""}>↑</button>
              <button class="btn-icon" data-move="${i}:1" ${i === pedidos.length - 1 ? "disabled" : ""}>↓</button>` : ""}
          </div>
          ${!p.done ? `<button class="btn-secondary" data-deliver="${i}">📷 Marcar entregado + fotos</button>` : `<div class="mono" style="font-size:12px;color:var(--route);">✓ registrado</div>`}
        </div>`).join("")}
      ${delivered === pedidos.length && pedidos.length > 0 ? `<div class="done-msg">Ruta completa. Buen trabajo.</div>` : ""}
    `;
  }

  root.innerHTML = `
    <input type="file" accept="image/*" capture="environment" multiple id="photo-input" style="display:none" />
    ${headerHtml({ title: name, subtitle: mode === "build" ? "Armando ruta" : `${delivered}/${pedidos.length} entregados`, rightHtml: right })}
    <div class="container">${body}</div>`;

  bindOperatorEvents();
}

function bindOperatorEvents() {
  document.getElementById("sign-out").onclick = () => { name = ""; issue = null; pedidos = []; mode = "build"; render(); };
  const addBtn = document.getElementById("add-pedido");
  if (addBtn) addBtn.onclick = () => { const inp = document.getElementById("pedido-input"); addPedido(inp.value); inp.value = ""; };
  const inp = document.getElementById("pedido-input");
  if (inp) inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { addPedido(inp.value); inp.value = ""; } });
  const startBtn = document.getElementById("start-route");
  if (startBtn) startBtn.onclick = startDeliveries;
  root.querySelectorAll("[data-move]").forEach((b) => { b.onclick = () => { const [i, d] = b.dataset.move.split(":"); movePedido(Number(i), Number(d)); }; });
  root.querySelectorAll("[data-remove]").forEach((b) => { b.onclick = () => removePedido(Number(b.dataset.remove)); });
  root.querySelectorAll("[data-deliver]").forEach((b) => { b.onclick = () => openCamera(Number(b.dataset.deliver)); });
  document.getElementById("photo-input").onchange = (e) => onPhotosChosen(Array.from(e.target.files));
}

function renderAdmin() {
  if (adminSelected) return renderAdminDetail();
  const right = `<div class="header-right">
    <button class="icon" id="refresh-btn">⟳</button>
    <button class="icon" id="sign-out">⎋</button>
  </div>`;
  const rows = adminIssues.map((iss) => {
    const list = parseBody(iss.body);
    const done = list.filter((p) => p.done).length;
    const opName = iss.title.replace(/^Ruta\s*—\s*/, "").split("—")[0].trim();
    return `
      <button class="stop-row clickable" data-open="${iss.number}">
        <div class="stop-badge ${done === list.length && list.length > 0 ? "done" : ""}">👤</div>
        <div style="flex:1;text-align:left;">
          <div style="font-size:14px;font-weight:600;">${escapeHtml(opName)}</div>
          <div class="mono" style="font-size:11.5px;color:#94A3B8;">${done}/${list.length} entregados</div>
        </div>
      </button>`;
  }).join("");

  root.innerHTML = `
    ${headerHtml({ title: "Panel del día", subtitle: todayISO(), rightHtml: right })}
    <div class="container">${!adminIssues.length ? `<div class="empty">Ningún operador ha iniciado ruta hoy.</div>` : rows}</div>`;

  document.getElementById("refresh-btn").onclick = loadAdmin;
  document.getElementById("sign-out").onclick = () => { name = ""; render(); };
  root.querySelectorAll("[data-open]").forEach((b) => { b.onclick = () => openAdminIssue(adminIssues.find((i) => String(i.number) === b.dataset.open)); });
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
        <div class="progress-labels"><span class="mono">${done}/${total} entregados</span><span class="mono">${pct}%</span></div>
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
    </div>`;

  document.getElementById("back-btn").onclick = () => { adminSelected = null; render(); };
}

render();
