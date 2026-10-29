import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 3000);
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/oauth/callback`;
const SESSION_SECRET = process.env.SESSION_SECRET || "";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";
const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
].join(" ");

const sessions = new Map();
const pendingStates = new Map();

function configProblem() {
  const missing = [];
  if (!CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
  if (!CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  if (!SESSION_SECRET || SESSION_SECRET.length < 32)
    missing.push("SESSION_SECRET (mínimo 32 caracteres)");
  return missing;
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(body));
}
function redirect(res, location, headers = {}) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end();
}
function parseCookies(req) {
  const result = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx > -1)
      result[part.slice(0, idx).trim()] = decodeURIComponent(
        part.slice(idx + 1).trim(),
      );
  }
  return result;
}
function sign(value) {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(value)
    .digest("base64url");
}
function safeEqual(a, b) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function createSession(res, data) {
  const id = crypto.randomBytes(32).toString("base64url");
  sessions.set(id, { ...data, createdAt: Date.now() });
  const value = `${id}.${sign(id)}`;
  const cookieSecure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `dv_session=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600${cookieSecure}`,
  );
  return id;
}
function getSession(req) {
  const raw = parseCookies(req).dv_session;
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 1) return null;
  const id = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  if (!safeEqual(signature, sign(id))) return null;
  const session = sessions.get(id);
  if (!session) return null;
  if (Date.now() - session.createdAt > 60 * 60 * 1000) {
    sessions.delete(id);
    return null;
  }
  return { id, ...session };
}
function clearSession(req, res) {
  const current = getSession(req);
  if (current) sessions.delete(current.id);
  res.setHeader(
    "Set-Cookie",
    "dv_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
  );
}
async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("Cuerpo demasiado grande");
  }
  return new URLSearchParams(body);
}
async function googleJson(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { raw };
  }
  if (!response.ok) {
    const message =
      data?.error_description ||
      data?.error?.message ||
      data?.error ||
      `HTTP ${response.status}`;
    throw new Error(`Google respondió ${response.status}: ${message}`);
  }
  return data;
}
async function serveStatic(res, pathname) {
  const routes = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/styles.css": ["styles.css", "text/css; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  };
  const route = routes[pathname];
  if (!route) return false;
  try {
    const content = await fs.readFile(path.join(PUBLIC_DIR, route[0]));
    res.writeHead(200, {
      "Content-Type": route[1],
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'",
    });
    res.end(content);
  } catch {
    res.writeHead(500);
    res.end("No se pudo cargar el archivo.");
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && (await serveStatic(res, url.pathname))) return;

    if (req.method === "GET" && url.pathname === "/api/config") {
      return send(res, 200, {
        configured: configProblem().length === 0,
        missing: configProblem(),
      });
    }

    if (req.method === "GET" && url.pathname === "/auth/google") {
      const missing = configProblem();
      if (missing.length)
        return redirect(
          res,
          `/?error=${encodeURIComponent("Configurá las variables de entorno: " + missing.join(", "))}`,
        );
      const state = crypto.randomBytes(32).toString("base64url");
      pendingStates.set(state, Date.now());
      const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        scope: SCOPES,
        state,
        access_type: "offline",
        include_granted_scopes: "true",
        prompt: "consent",
      });
      return redirect(res, `${AUTH_ENDPOINT}?${params.toString()}`);
    }

    if (req.method === "GET" && url.pathname === "/oauth/callback") {
      const providerError = url.searchParams.get("error");
      if (providerError)
        return redirect(
          res,
          `/?error=${encodeURIComponent("Google canceló o rechazó la autorización: " + providerError)}`,
        );
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const issuedAt = state && pendingStates.get(state);
      if (
        !code ||
        !state ||
        !issuedAt ||
        Date.now() - issuedAt > 10 * 60 * 1000
      ) {
        if (state) pendingStates.delete(state);
        return redirect(
          res,
          `/?error=${encodeURIComponent("El parámetro state no es válido o expiró. Intentá iniciar sesión nuevamente.")}`,
        );
      }
      pendingStates.delete(state);
      const tokens = await googleJson(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code",
        }),
      });
      if (!tokens.access_token)
        throw new Error("Google no devolvió un access token.");
      const profile = await googleJson(USERINFO_ENDPOINT, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (!profile.sub || !profile.email)
        throw new Error("No se pudo validar el perfil recibido de Google.");
      createSession(res, {
        profile: {
          sub: profile.sub,
          name: profile.name || profile.email,
          email: profile.email,
          picture: profile.picture || "",
        },
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
      });
      return redirect(res, "/");
    }

    if (req.method === "GET" && url.pathname === "/api/me") {
      const session = getSession(req);
      if (!session) return send(res, 401, { authenticated: false });
      return send(res, 200, { authenticated: true, profile: session.profile });
    }

    if (req.method === "GET" && url.pathname === "/api/drive/files") {
      const session = getSession(req);
      if (!session)
        return send(res, 401, { error: "Iniciá sesión con Google primero." });
      if (Date.now() >= session.expiresAt) {
        return send(res, 401, {
          error:
            "El access token expiró. Cerrá sesión e iniciá sesión de nuevo en esta versión MVP.",
        });
      }
      const params = new URLSearchParams({
        pageSize: "100",
        orderBy: "modifiedTime desc",
        fields:
          "files(id,name,mimeType,modifiedTime,size,webViewLink,owners(displayName,emailAddress)),nextPageToken",
      });
      const data = await googleJson(`${DRIVE_FILES_ENDPOINT}?${params}`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      return send(res, 200, { files: data.files || [] });
    }

    if (req.method === "POST" && url.pathname === "/api/logout") {
      clearSession(req, res);
      return send(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/health")
      return send(res, 200, { ok: true });
    return send(res, 404, { error: "Ruta no encontrada." });
  } catch (error) {
    console.error("[app]", error);
    if (url.pathname === "/oauth/callback")
      return redirect(
        res,
        `/?error=${encodeURIComponent("No se pudo completar OAuth. Revisá la consola del servidor y la configuración de Google.")}`,
      );
    return send(res, 500, { error: error.message || "Error interno." });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Drive Viewer escuchando en el puerto ${PORT}`);

  if (configProblem().length) {
    console.log("Configuración pendiente:", configProblem().join(", "));
  }
});
