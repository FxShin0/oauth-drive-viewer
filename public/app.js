const $ = (id) => document.getElementById(id);
let allFiles = [];
let flowStep = 0;

function showView(id) {
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.toggle("active", v.id === id));
  document
    .querySelectorAll(".navbtn")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === id));
}
document
  .querySelectorAll(".navbtn")
  .forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));

function showAlert(message) {
  const alert = $("alert");
  if (!message) {
    alert.classList.add("hidden");
    alert.textContent = "";
    return;
  }
  alert.textContent = message;
  alert.classList.remove("hidden");
}
function iconFor(mime) {
  if (mime === "application/vnd.google-apps.folder") return "📁";
  if (mime?.includes("spreadsheet")) return "📊";
  if (mime?.includes("presentation")) return "📽️";
  if (mime?.includes("document") || mime?.includes("text")) return "📝";
  if (mime?.includes("image")) return "🖼️";
  if (mime?.includes("pdf")) return "📕";
  return "📄";
}
function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "—"
    : new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" }).format(d);
}
function renderFiles() {
  const query = $("search").value.trim().toLocaleLowerCase("es");
  const files = allFiles.filter((f) =>
    `${f.name || ""} ${f.mimeType || ""}`
      .toLocaleLowerCase("es")
      .includes(query),
  );
  $("files").replaceChildren();
  for (const file of files) {
    const tr = document.createElement("tr");
    const nameCell = document.createElement("td");
    const nameWrap = document.createElement("div");
    nameWrap.className = "file-name";
    const icon = document.createElement("span");
    icon.className = "fileicon";
    icon.textContent = iconFor(file.mimeType);
    nameWrap.append(icon);
    if (file.webViewLink) {
      const a = document.createElement("a");
      a.href = file.webViewLink;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = file.name || "(sin nombre)";
      nameWrap.append(a);
    } else {
      const name = document.createElement("span");
      name.textContent = file.name || "(sin nombre)";
      nameWrap.append(name);
    }
    nameCell.append(nameWrap);
    const type = document.createElement("td");
    type.textContent =
      (file.mimeType || "").replace(
        "application/vnd.google-apps.",
        "Google ",
      ) || "Archivo";
    const date = document.createElement("td");
    date.textContent = formatDate(file.modifiedTime);
    const action = document.createElement("td");
    if (file.webViewLink) {
      const a = document.createElement("a");
      a.href = file.webViewLink;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "pill";
      a.textContent = "Abrir";
      action.append(a);
    }
    tr.append(nameCell, type, date, action);
    $("files").append(tr);
  }
  $("fileCount").textContent = String(files.length);
  $("noFiles").classList.toggle("hidden", files.length !== 0);
}
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || `Error HTTP ${response.status}`);
  return data;
}
async function loadFiles() {
  $("loading").classList.remove("hidden");
  $("noFiles").classList.add("hidden");
  try {
    const data = await api("/api/drive/files");
    allFiles = data.files || [];
    renderFiles();
  } catch (e) {
    allFiles = [];
    renderFiles();
    showAlert(`No se pudieron cargar los archivos: ${e.message}`);
  } finally {
    $("loading").classList.add("hidden");
  }
}
async function loadProfile() {
  try {
    const data = await api("/api/me");
    if (!data.authenticated) {
      showView("home");
      return;
    }
    const p = data.profile;
    $("profileName").textContent = p.name || "Usuario de Google";
    $("profileEmail").textContent = p.email || "";
    $("detailName").textContent = p.name || "—";
    $("detailEmail").textContent = p.email || "—";
    $("detailSub").textContent = p.sub || "—";
    $("avatarFallback").textContent = (p.name || "G").slice(0, 1).toUpperCase();
    if (p.picture) {
      $("avatar").src = p.picture;
      $("avatar").classList.remove("hidden");
      $("avatarFallback").classList.add("hidden");
    }
    $("navDrive").classList.remove("hidden");
    showView("dashboard");
    await loadFiles();
  } catch (e) {
    showAlert(`No se pudo recuperar la sesión: ${e.message}`);
  }
}
$("search").addEventListener("input", renderFiles);
$("refresh").addEventListener("click", loadFiles);
$("logout").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
  } catch (e) {
    showAlert(`No se pudo cerrar la sesión: ${e.message}`);
    return;
  }
  allFiles = [];
  $("navDrive").classList.add("hidden");
  $("search").value = "";
  showAlert("");
  showView("home");
});
const steps = [
  {
    log: "01 · Cliente → Google Authorization Endpoint\nGET /o/oauth2/v2/auth\nresponse_type=code · client_id · redirect_uri · scope · state",
    r: "Solicitud preparada",
    c: "Pendiente",
    t: "No emitido",
    a: "Sin llamada",
  },
  {
    log: "02 · Google → Navegador del usuario\nGoogle autentica al usuario y presenta la pantalla de consentimiento para los scopes solicitados.",
    r: "Redirigido a Google",
    c: "Pendiente",
    t: "No emitido",
    a: "Sin llamada",
  },
  {
    log: "03 · Google → URI de redirección del cliente\nGET /oauth/callback?code=…&state=…\nEl servidor valida state antes de usar el código.",
    r: "Callback recibido",
    c: "Código recibido (servidor)",
    t: "No emitido",
    a: "Sin llamada",
  },
  {
    log: "04 · Cliente (servidor) → Google Token Endpoint\nPOST /token con el código, redirect_uri y credenciales del cliente confidencial.\nGoogle responde con access token y, si corresponde, refresh token. Los secretos no se muestran en la GUI.",
    r: "Callback validado",
    c: "Código canjeado",
    t: "Token almacenado en servidor",
    a: "Sin llamada",
  },
  {
    log: "05 · Cliente → Google Drive API\nGET /drive/v3/files?fields=files(id,name,mimeType,modifiedTime,…)\nAuthorization: Bearer [token guardado en servidor]\nLa API devuelve metadatos autorizados para la cuenta.",
    r: "Completada",
    c: "Canjeado",
    t: "En servidor",
    a: "Respuesta de API",
  },
];
function paintFlow() {
  if (!flowStep) {
    $("log").textContent =
      "Esperando inicio del flujo. Presioná “Siguiente paso” para recorrer el intercambio.";
    $("redirectStatus").textContent = "Pendiente";
    $("codeStatus").textContent = "No recibido";
    $("tokenStatus").textContent = "No emitido";
    $("apiStatus").textContent = "Sin llamada";
    $("nextStep").textContent = "Siguiente paso →";
    return;
  }
  const s = steps[flowStep - 1];
  $("log").textContent = s.log;
  $("redirectStatus").textContent = s.r;
  $("codeStatus").textContent = s.c;
  $("tokenStatus").textContent = s.t;
  $("apiStatus").textContent = s.a;
  $("nextStep").textContent =
    flowStep === steps.length ? "Volver al inicio ↺" : "Siguiente paso →";
}
$("nextStep").addEventListener("click", () => {
  flowStep = flowStep >= steps.length ? 0 : flowStep + 1;
  paintFlow();
});
$("resetFlow").addEventListener("click", () => {
  flowStep = 0;
  paintFlow();
});

const error = new URLSearchParams(location.search).get("error");
if (error) {
  showAlert(error);
  history.replaceState({}, "", "/");
}
paintFlow();
loadProfile();
