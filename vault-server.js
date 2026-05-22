const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const DB_FILE = path.join(__dirname, "vault-data.json");
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.VAULT_ADMIN_KEY || "prime";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://primewebhub.netlify.app";

// Locks for preventing race conditions
const pendingGenerations = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function ensureDbFile() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ codes: {} }, null, 2), "utf8");
    console.log("DB file created:", DB_FILE);
  }
}

function readDb() {
  ensureDbFile();
  const raw = fs.readFileSync(DB_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    // Migrate legacy `tokens` structure to `codes` if necessary
    if (parsed.tokens && !parsed.codes) {
      parsed.codes = {};
      for (const k of Object.keys(parsed.tokens)) {
        const t = parsed.tokens[k];
        parsed.codes[k] = {
          reward: t.reward || null,
          opened: !!t.opened,
          used: !!t.used,
          clientName: t.clientName || "",
          createdAt: t.createdAt || new Date().toISOString()
        };
      }
      // remove legacy key
      delete parsed.tokens;
      fs.writeFileSync(DB_FILE, JSON.stringify(parsed, null, 2), "utf8");
      console.log("Migrated legacy tokens -> codes in DB file");
    }
    if (!parsed.codes || typeof parsed.codes !== "object") parsed.codes = {};
    return parsed;
  } catch (err) {
    console.error("Failed to parse DB file, resetting:", err);
    const empty = { codes: {} };
    fs.writeFileSync(DB_FILE, JSON.stringify(empty, null, 2), "utf8");
    return empty;
  }
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function insertCode(codeObj) {
  console.log("Saving code:", codeObj.code || codeObj.key || "(unknown)");
  console.log("DB file:", DB_FILE);
  const db = readDb();
  const key = codeObj.code || codeObj.key;
  if (!key) throw new Error("Missing code key");
  if (db.codes[key]) throw new Error("Code already exists");
  db.codes[key] = {
    reward: codeObj.reward || null,
    opened: !!codeObj.opened,
    used: !!codeObj.used,
    clientName: codeObj.clientName || "",
    createdAt: codeObj.createdAt || new Date().toISOString()
  };
  writeDb(db);
  const verify = readDb();
  if (!verify.codes || !verify.codes[key]) {
    throw new Error(`Code failed to persist: ${key}`);
  }
}

function updateCode(key, updates) {
  const db = readDb();
  if (!db.codes[key]) throw new Error(`Code not found: ${key}`);
  db.codes[key] = Object.assign({}, db.codes[key], updates);
  writeDb(db);
  const verify = readDb();
  if (!verify.codes[key]) throw new Error(`Code failed to persist on update: ${key}`);
}

function findCode(key) {
  const db = readDb();
  const entry = db.codes[key];
  if (!entry) return null;
  return Object.assign({ code: key }, entry);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });
  });
}

function cleanText(value) {
  return String(value || "").trim().slice(0, 120);
}

function isAdminAuthorized(req) {
  const adminKey = req.headers["x-admin-key"] || "";
  const isAuthorized = adminKey === ADMIN_KEY;
  if (!isAuthorized && adminKey) {
    console.warn(`[AUTH] Invalid admin key attempt: ${adminKey.substring(0, 1)}***`);
  }
  return isAuthorized;
}

// Legacy token-based functions removed. Using code-based manual system instead.

async function handleApi(req, res, url) {
  try {
    // POST /api/vault/generate-code (admin only)
    if (req.method === "POST" && url.pathname === "/api/vault/generate-code") {
      if (!isAdminAuthorized(req)) {
        console.warn(`[API] Unauthorized generate-code attempt`);
        sendJson(res, 401, { success: false, message: "Unauthorized" });
        return true;
      }

      const body = await readRequestBody(req);
      const { code, reward, clientName } = body;

      if (!code || !reward) {
        sendJson(res, 400, { success: false, message: "Missing required fields: code, reward" });
        return true;
      }

      try {
        insertCode({ code, reward, clientName, opened: false, used: false });
        console.log(`[API] Code generated: ${code} → ${reward}`);
        sendJson(res, 200, { success: true, code, reward });
      } catch (err) {
        console.error(`[API] Failed to create code:`, err);
        sendJson(res, 400, { success: false, message: err.message });
      }

      return true;
    }

    // GET /api/vault/list (admin only)
    if (req.method === "GET" && url.pathname === "/api/vault/list") {
      if (!isAdminAuthorized(req)) {
        console.warn(`[API] Unauthorized list attempt`);
        sendJson(res, 401, { success: false, message: "Unauthorized" });
        return true;
      }

      const db = readDb();
      const vaults = Object.entries(db.codes)
        .map(([k, v]) => ({ code: k, ...v }))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map((v) => ({
          code: v.code,
          used: !!v.opened,
          reward: v.reward,
          createdAt: v.createdAt,
          clientName: v.clientName
        }))
        .slice(0, 50);

      console.log(`[API] List retrieved: ${vaults.length} vaults`);
      sendJson(res, 200, { success: true, vaults });
      return true;
    }

    // POST /api/vault/redeem-code
    if (req.method === "POST" && url.pathname === "/api/vault/redeem-code") {
      const body = await readRequestBody(req);
      const { code } = body;

      if (!code) {
        sendJson(res, 400, { success: false, message: "Missing required field: code" });
        return true;
      }

      const entry = findCode(code);
      if (!entry) {
        sendJson(res, 404, { success: false, message: "Invalid code" });
        return true;
      }

      if (entry.used) {
        sendJson(res, 200, { success: false, message: "Code already used", used: true, reward: entry.reward });
        return true;
      }

      try {
        updateCode(code, { used: true, opened: true, claimedAt: new Date().toISOString() });
        const saved = findCode(code);
        sendJson(res, 200, { success: true, reward: saved.reward });
      } catch (err) {
        console.error("Redeem error:", err);
        sendJson(res, 500, { success: false, message: "Failed to redeem code" });
      }

      return true;
    }

    // GET /api/vault/code-status/:code
    if (req.method === "GET" && url.pathname.startsWith("/api/vault/code-status/")) {
      const code = decodeURIComponent(url.pathname.replace("/api/vault/code-status/", ""));
      if (!code) {
        sendJson(res, 400, { success: false, message: "Missing code" });
        return true;
      }
      const entry = findCode(code);
      if (!entry) {
        sendJson(res, 404, { success: false, message: "Invalid code" });
        return true;
      }
      sendJson(res, 200, { success: true, code: entry.code, reward: entry.reward, used: !!entry.used, opened: !!entry.opened, clientName: entry.clientName, createdAt: entry.createdAt });
      return true;
    }

    if (url.pathname.startsWith("/api/")) {
      sendJson(res, 404, { success: false, message: "API route not found" });
      return true;
    }

    return false;
  } catch (error) {
    console.error("API Error:", error);
    sendJson(res, 500, { success: false, message: error.message || "Server error" });
    return true;
  }
}

function serveStatic(req, res, url) {
  let requestedPath = decodeURIComponent(url.pathname);

  if (requestedPath === "/") {
    requestedPath = "/index.html";
  }

  if (requestedPath === "/vault") {
    requestedPath = "/easter-egg.html";
  }

  if (requestedPath === "/admin" || requestedPath === "/admin/") {
    requestedPath = "/admin-vault-control.html";
  }

  const filePath = path.normalize(path.join(ROOT_DIR, requestedPath));

  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const mimeType = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mimeType });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  // Global CORS headers (required for Netlify frontend)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key");

  // Handle preflight requests quickly
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // Lightweight health endpoint to keep Render awake
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("OK");
    return;
  }

  const handled = await handleApi(req, res, url);

  if (!handled) {
    serveStatic(req, res, url);
  }
});

server.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`Velvet Vault System Running`);
  console.log(`========================================`);
  console.log(`Main Server: http://localhost:${PORT}`);
  console.log(`Vault Page:  http://localhost:${PORT}/vault`);
  console.log(`Admin Panel: http://localhost:${PORT}/admin`);
  console.log(`Admin Key:   ${ADMIN_KEY}`);
  console.log(`========================================\n`);
});
