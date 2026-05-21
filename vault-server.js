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
    fs.writeFileSync(DB_FILE, JSON.stringify({ tokens: {} }, null, 2), "utf8");
    console.log("DB file created:", DB_FILE);
  }
}

function readDb() {
  ensureDbFile();
  const raw = fs.readFileSync(DB_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.tokens || typeof parsed.tokens !== "object") parsed.tokens = {};
    return parsed;
  } catch (err) {
    console.error("Failed to parse DB file, resetting:", err);
    const empty = { tokens: {} };
    fs.writeFileSync(DB_FILE, JSON.stringify(empty, null, 2), "utf8");
    return empty;
  }
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function insertVault(vault) {
  console.log("Saving token:", vault.token);
  console.log("DB file:", DB_FILE);
  const db = readDb();
  db.tokens[vault.token] = {
    token: vault.token,
    reward: vault.reward,
    code: vault.rewardCode,
    opened: !!vault.used,
    createdAt: vault.createdAt,
    claimedAt: vault.claimedAt || null,
    clientName: vault.clientName || "",
    clientEmail: vault.clientEmail || "",
    orderId: vault.orderId || ""
  };
  writeDb(db);
  const verify = readDb();
  if (!verify.tokens || !verify.tokens[vault.token]) {
    throw new Error(`Token failed to persist: ${vault.token}`);
  }
}

function updateVault(vault) {
  const db = readDb();
  if (!db.tokens[vault.token]) {
    throw new Error(`Token not found for update: ${vault.token}`);
  }
  db.tokens[vault.token] = {
    token: vault.token,
    reward: vault.reward,
    code: vault.rewardCode,
    opened: !!vault.used,
    createdAt: vault.createdAt,
    claimedAt: vault.claimedAt || null,
    clientName: vault.clientName || "",
    clientEmail: vault.clientEmail || "",
    orderId: vault.orderId || ""
  };
  writeDb(db);
  const verify = readDb();
  if (!verify.tokens[vault.token]) {
    throw new Error(`Token failed to persist on update: ${vault.token}`);
  }
}

function findVaultByToken(token) {
  const db = readDb();
  const t = db.tokens[token];
  if (!t) return null;
  return {
    token: t.token,
    reward: t.reward,
    rewardCode: t.code,
    used: !!t.opened,
    createdAt: t.createdAt,
    claimedAt: t.claimedAt || null,
    clientName: t.clientName || "",
    clientEmail: t.clientEmail || "",
    orderId: t.orderId || ""
  };
}

function findVaultByCode(code) {
  const db = readDb();
  for (const k of Object.keys(db.tokens)) {
    const t = db.tokens[k];
    if (t.code === code) {
      return {
        token: t.token,
        reward: t.reward,
        rewardCode: t.code,
        used: !!t.opened,
        createdAt: t.createdAt,
        claimedAt: t.claimedAt || null,
        clientName: t.clientName || "",
        clientEmail: t.clientEmail || "",
        orderId: t.orderId || ""
      };
    }
  }
  return null;
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

function generateToken() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let token = "VG";
  for (let i = 0; i < 6; i++) {
    token += chars[crypto.randomInt(0, chars.length)];
  }
  return token;
}

function generateAccessCode() {
  const num = crypto.randomInt(1000, 10000);
  return `VG-${num}`;
}

function generateRewardCode(reward) {
  if (reward === "50") {
    throw new Error("50% Golden Ticket cannot be generated");
  }
  const num = crypto.randomInt(1000, 10000);
  const rewardNum = reward.replace("%", "");
  return `VG-${rewardNum}-${num}`;
}

function pickReward() {
  const roll = crypto.randomInt(1, 101);
  if (roll <= 70) {
    return "5%";
  }
  if (roll <= 95) {
    return "10%";
  }
  return "20%";
}

function findVaultByToken(token) {
  const row = DB.prepare("SELECT * FROM vaults WHERE token = ?").get(token);
  if (!row) {
    return null;
  }
  return { ...row, used: row.used === 1 };
}

function findVaultByCode(code) {
  const row = DB.prepare("SELECT * FROM vaults WHERE code = ?").get(code);
  if (!row) {
    return null;
  }
  return { ...row, used: row.used === 1 };
}

function generateVault(orderId = "", clientName = "", clientEmail = "") {
  let token;
  let attempts = 0;
  do {
    token = generateToken();
    attempts++;
    if (attempts > 1000) {
      throw new Error("Could not generate unique token");
    }
  } while (findVaultByToken(token));

  let code;
  attempts = 0;
  do {
    code = generateAccessCode();
    attempts++;
    if (attempts > 1000) {
      throw new Error("Could not generate unique code");
    }
  } while (findVaultByCode(code));

  const vault = {
    orderId: cleanText(orderId) || `ADMIN-${new Date().getTime()}`,
    clientName: cleanText(clientName) || "Admin Generated",
    clientEmail: cleanText(clientEmail) || "",
    token,
    code,
    reward: null,
    rewardCode: null,
    used: false,
    createdAt: new Date().toISOString(),
    claimedAt: null
  };

  console.log("Saving token:", token);
  insertVault(vault);

  const savedVault = findVaultByToken(token);
  if (!savedVault) {
    console.error(`[TOKEN] Failed to verify token ${token} was saved`);
    throw new Error("Token was not properly saved to database");
  }

  console.log(`[TOKEN] Generated: ${token} (Code: ${code})`);

  return {
    token,
    code,
    vaultUrl: `${FRONTEND_URL}/vault?token=${encodeURIComponent(token)}`
  };
}

function verifyCode(token, code) {
  const vault = findVaultByToken(token);

  if (!vault) {
    return { valid: false, message: "Invalid token" };
  }

  if (vault.code !== code) {
    return { valid: false, message: "Invalid code for this token" };
  }

  if (vault.used) {
    return { valid: false, message: "Vault already used" };
  }

  return { valid: true, vault };
}

function revealVaultReward(token) {
  const vault = findVaultByToken(token);

  if (!vault) {
    console.warn(`[REVEAL] Token not found: ${token}`);
    return { success: false, message: "Invalid token" };
  }

  if (vault.used) {
    console.warn(`[REVEAL] Token already used: ${token}`);
    return {
      success: false,
      message: "Reward already claimed",
      reward: vault.reward,
      rewardCode: vault.rewardCode
    };
  }

  const reward = pickReward();
  const rewardCode = generateRewardCode(reward);

  vault.reward = reward;
  vault.rewardCode = rewardCode;
  vault.used = true;
  vault.claimedAt = new Date().toISOString();
  
  try {
    updateVault(vault);
    console.log(`[REVEAL] Reward revealed: ${token} → ${reward} (Code: ${rewardCode})`);
    const saved = findVaultByToken(token);
    console.log("Saved vault after reveal:", saved ? { token: saved.token, used: saved.used, reward: saved.reward, rewardCode: saved.rewardCode } : null);
  } catch (error) {
    console.error(`[REVEAL] Failed to save reward for token ${token}:`, error);
    return { success: false, message: "Failed to save reward" };
  }

  return {
    success: true,
    reward,
    rewardCode
  };
}

function getVaultResult(token) {
  const vault = findVaultByToken(token);

  if (!vault) {
    return { success: false, message: "Invalid token" };
  }

  if (!vault.used) {
    return { success: false, message: "Vault not yet opened" };
  }

  return {
    success: true,
    reward: vault.reward,
    rewardCode: vault.rewardCode,
    used: true
  };
}

function verifyRewardCode(rewardCode) {
  const vault = findVaultByCode(rewardCode);

  if (!vault) {
    return { valid: false };
  }

  return {
    valid: true,
    reward: vault.reward,
    used: vault.used,
    claimedAt: vault.claimedAt
  };
}

async function handleApi(req, res, url) {
  try {
    // POST /api/vault/generate
    if (req.method === "POST" && url.pathname === "/api/vault/generate") {
      const adminKey = req.headers["x-admin-key"];
      console.log("Received admin key:", adminKey);
      const isAdmin = isAdminAuthorized(req);
      const body = await readRequestBody(req);
      const { orderId, clientName, clientEmail } = body;

      if (adminKey && adminKey !== ADMIN_KEY) {
        console.warn(`[API] Invalid admin key received: ${adminKey}`);
        sendJson(res, 401, {
          success: false,
          message: "Unauthorized"
        });
        return true;
      }

      // If admin, allow generation without fields
      if (isAdmin) {
        console.log(`[API] Admin token generation requested`);
        const result = generateVault(orderId, clientName, clientEmail);
        sendJson(res, 200, { success: true, ...result });
        return true;
      }

      // If not admin, require all fields for client usage
      if (!orderId || !clientName || !clientEmail) {
        console.warn(`[API] Non-admin generation attempted without required fields`);
        sendJson(res, 401, {
          success: false,
          message: "Unauthorized: admin key required or all fields must be provided"
        });
        return true;
      }

      const result = generateVault(orderId, clientName, clientEmail);
      sendJson(res, 200, { success: true, ...result });
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
      const vaults = Object.values(db.tokens)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map((v) => ({
          token: v.token,
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

    // POST /api/vault/verify
    if (req.method === "POST" && url.pathname === "/api/vault/verify") {
      const body = await readRequestBody(req);
      const { token, code } = body;

      if (!token || !code) {
        console.warn(`[VERIFY] Missing required fields`);
        sendJson(res, 400, {
          success: false,
          message: "Missing required fields: token, code"
        });
        return true;
      }

      const result = verifyCode(token, code);

      if (!result.valid) {
        console.warn(`[VERIFY] Invalid code for token: ${token}`);
        sendJson(res, 400, { success: false, message: result.message });
        return true;
      }

      console.log(`[VERIFY] Code verified for token: ${token}`);
      sendJson(res, 200, { success: true, vaultAccess: true });
      return true;
    }

    // POST /api/vault/reveal
    if (req.method === "POST" && url.pathname === "/api/vault/reveal") {
      const body = await readRequestBody(req);
      const { token } = body;

      if (!token) {
        console.warn(`[REVEAL] Missing token parameter`);
        sendJson(res, 400, {
          success: false,
          message: "Missing required field: token"
        });
        return true;
      }

      const result = revealVaultReward(token);

      if (!result.success) {
        const statusCode = result.message === "Reward already claimed" ? 200 : 400;
        sendJson(res, statusCode, result);
        return true;
      }

      sendJson(res, 200, result);
      return true;
    }

    // GET /api/vault/result/:token
    if (req.method === "GET" && url.pathname.startsWith("/api/vault/result/")) {
      const token = url.pathname.replace("/api/vault/result/", "");

      if (!token) {
        console.warn(`[RESULT] Missing token parameter`);
        sendJson(res, 400, { success: false, message: "Missing token" });
        return true;
      }

      const result = getVaultResult(token);
      const statusCode = result.success ? 200 : 404;
      if (!result.success) {
        console.log(`[RESULT] Token not found or not yet opened: ${token}`);
      }
      sendJson(res, statusCode, result);
      return true;
    }

    // POST /api/vault/admin/verify-reward
    if (req.method === "POST" && url.pathname === "/api/vault/admin/verify-reward") {
      const body = await readRequestBody(req);
      const { rewardCode } = body;

      if (!rewardCode) {
        console.warn(`[REWARD-VERIFY] Missing rewardCode parameter`);
        sendJson(res, 400, { valid: false, message: "Missing rewardCode" });
        return true;
      }

      const result = verifyRewardCode(rewardCode);
      console.log(`[REWARD-VERIFY] Reward code check: ${rewardCode} → ${result.valid ? "Valid" : "Invalid"}`);
      sendJson(res, result.valid ? 200 : 404, result);
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
