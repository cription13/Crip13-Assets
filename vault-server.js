const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const DB_PATH = path.join(ROOT_DIR, "vault-db.json");
const ADMIN_KEY = process.env.VAULT_ADMIN_KEY || "prime";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

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

function defaultDb() {
  return {
    vaults: []
  };
}

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    const db = defaultDb();
    saveDb(db);
    return db;
  }

  try {
    const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    return {
      vaults: db.vaults || []
    };
  } catch (error) {
    console.error("DB Load Error:", error);
    return defaultDb();
  }
}

function saveDb(db) {
  try {
    fs.writeFileSync(DB_PATH, `${JSON.stringify(db, null, 2)}\n`, "utf8");
    // Verify write succeeded
    const verification = fs.readFileSync(DB_PATH, "utf8");
    JSON.parse(verification); // Validate JSON
    console.log(`[DB] Saved ${db.vaults.length} vaults`);
    return true;
  } catch (error) {
    console.error("DB Save Error:", error);
    throw new Error("Failed to save database");
  }
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

function findVaultByToken(db, token) {
  return db.vaults.find((v) => v.token === token);
}

function findVaultByCode(db, code) {
  return db.vaults.find((v) => v.code === code);
}

function generateVault(orderId = "", clientName = "", clientEmail = "") {
  const db = loadDb();
  
  let token;
  let attempts = 0;
  do {
    token = generateToken();
    attempts++;
    if (attempts > 1000) {
      throw new Error("Could not generate unique token");
    }
  } while (db.vaults.some((v) => v.token === token));

  let code;
  attempts = 0;
  do {
    code = generateAccessCode();
    attempts++;
    if (attempts > 1000) {
      throw new Error("Could not generate unique code");
    }
  } while (db.vaults.some((v) => v.code === code));

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

  db.vaults.push(vault);
  saveDb(db);

  // Verify token was actually saved
  const verifyDb = loadDb();
  const savedVault = findVaultByToken(verifyDb, token);
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

function verifyCode(db, token, code) {
  const vault = findVaultByToken(db, token);

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

function revealVaultReward(db, token) {
  const vault = findVaultByToken(db, token);

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
    saveDb(db);
    console.log(`[REVEAL] Reward revealed: ${token} → ${reward} (Code: ${rewardCode})`);
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
  const db = loadDb();
  const vault = findVaultByToken(db, token);

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
  const db = loadDb();
  const vault = db.vaults.find((v) => v.rewardCode === rewardCode);

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
      const isAdmin = isAdminAuthorized(req);
      const body = await readRequestBody(req);
      const { orderId, clientName, clientEmail } = body;

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

      const db = loadDb();
      const vaults = db.vaults
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map((v) => ({
          token: v.token,
          code: v.code,
          used: v.used,
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

      const db = loadDb();
      const result = verifyCode(db, token, code);

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

      const db = loadDb();
      const result = revealVaultReward(db, token);

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
