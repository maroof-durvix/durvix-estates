// DURVIX Estates — Express + MySQL Server (server.js)
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
let mysql;

try {
  mysql = require("mysql2/promise");
} catch {
  try {
    mysql = require("mysql2").promise;
  } catch {
    mysql = null;
  }
}

require("dotenv").config();

const PORT = process.env.PORT || 5000;
const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "50mb" }));

// Security & Password Helpers (scrypt + HMAC token)
const SECRET = process.env.AUTH_SECRET || "durvix-secret-key-2026-pakistan-luxury";

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const buf = crypto.scryptSync(password, salt, 64);
  return `${salt}:${buf.toString("hex")}`;
}

function verifyPassword(password, stored) {
  const [salt, keyHex] = stored.split(":");
  if (!salt || !keyHex) return false;
  const key = Buffer.from(keyHex, "hex");
  const derived = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(key, derived);
}

function signToken(payload) {
  const str = JSON.stringify(payload);
  const sig = crypto.createHmac("sha256", SECRET).update(str).digest("hex");
  return Buffer.from(str).toString("base64url") + "." + sig;
}

function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [strB64, sig] = parts;
  const str = Buffer.from(strB64, "base64url").toString("utf8");
  const expected = crypto.createHmac("sha256", SECRET).update(str).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

// Layer 1: PII Masking Helpers
function maskPhone(phone) {
  if (!phone) return "+92-3**-*******";
  const clean = phone.replace(/\s+/g, "");
  if (clean.length < 6) return "+92-3**-*******";
  return clean.slice(0, 5) + "*".repeat(Math.max(3, clean.length - 7)) + clean.slice(-2);
}

function maskEmail(email) {
  if (!email || !email.includes("@")) return "a***@durvix.com";
  const [local, domain] = email.split("@");
  if (local.length <= 2) return `${local.charAt(0)}*@${domain}`;
  return `${local.charAt(0)}${"*".repeat(local.length - 2)}${local.slice(-1)}@${domain}`;
}

// Database Connection & Auto DDL / Seeding
let pool = null;
let memoryDb = null; // In-memory fallback if MySQL server is not locally running

async function initDB() {
  const dbHost = process.env.DB_HOST || "localhost";
  const dbUser = process.env.DB_USER || "root";
  const dbPassword = process.env.DB_PASSWORD || "";
  const dbName = process.env.DB_NAME || "durvix_estates";
  const dbPort = Number(process.env.DB_PORT) || 3306;

  try {
    if (!mysql || !mysql.createConnection) {
      throw new Error("mysql2 driver not available");
    }
    // 1. Ensure database exists
    const rootConn = await mysql.createConnection({
      host: dbHost,
      user: dbUser,
      password: dbPassword,
      port: dbPort,
    });
    await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
    await rootConn.end();

    // 2. Connect pool
    pool = mysql.createPool({
      host: dbHost,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      port: dbPort,
      waitForConnections: true,
      connectionLimit: 10,
    });

    console.log(`[MySQL] Connected successfully to database: ${dbName}`);

    // 3. Create tables DDL
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(64) NOT NULL,
        role VARCHAR(32) DEFAULT 'USER',
        isBlocked BOOLEAN DEFAULT FALSE,
        isApproved BOOLEAN DEFAULT TRUE,
        agency VARCHAR(255),
        bio TEXT,
        avatar VARCHAR(512),
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS properties (
        id VARCHAR(64) PRIMARY KEY,
        agentId VARCHAR(64) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        price INT NOT NULL,
        rentPrice INT,
        type VARCHAR(32) DEFAULT 'BUY',
        city VARCHAR(64) NOT NULL,
        address VARCHAR(255) NOT NULL,
        area VARCHAR(128) NOT NULL,
        lat FLOAT NOT NULL,
        lng FLOAT NOT NULL,
        bedrooms INT NOT NULL,
        bathrooms INT NOT NULL,
        sizeSqft INT NOT NULL,
        images TEXT NOT NULL,
        featured BOOLEAN DEFAULT FALSE,
        status VARCHAR(32) DEFAULT 'ACTIVE',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (agentId) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id VARCHAR(64) PRIMARY KEY,
        userId VARCHAR(64) NOT NULL,
        propertyId VARCHAR(64) NOT NULL,
        agentId VARCHAR(64) NOT NULL,
        status VARCHAR(32) DEFAULT 'PENDING_TOKEN',
        tokenAmount INT DEFAULT 5000,
        tokenPaidAt DATETIME,
        visitDate VARCHAR(64),
        notes TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (propertyId) REFERENCES properties(id) ON DELETE CASCADE,
        FOREIGN KEY (agentId) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(64) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        resolved BOOLEAN DEFAULT FALSE,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Auto-seed if empty
    const [userRows] = await pool.query("SELECT COUNT(*) as count FROM users");
    if (userRows[0].count === 0) {
      await seedFromJSON();
    }
  } catch (err) {
    console.warn(`[DB Warning] Local MySQL connection failed (${err.message}). Using high-performance in-memory DB fallback.`);
    setupInMemoryFallback();
  }
}

// In-Memory Fallback Engine (guarantees server runs anywhere even without local MySQL)
function setupInMemoryFallback() {
  memoryDb = {
    users: [],
    properties: [],
    bookings: [],
    contact_messages: [],
  };

  const seedPath = path.join(__dirname, "seed_data.json");
  if (fs.existsSync(seedPath)) {
    const raw = fs.readFileSync(seedPath, "utf-8");
    const data = JSON.parse(raw);

    for (const u of data.users) {
      memoryDb.users.push({
        id: "usr_" + Math.random().toString(36).slice(2, 9),
        email: u.email,
        password: hashPassword(u.password),
        name: u.name,
        phone: u.phone,
        role: u.role,
        isBlocked: false,
        isApproved: u.isApproved ?? true,
        agency: u.agency || null,
        bio: u.bio || null,
        avatar: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    const agentMap = new Map();
    memoryDb.users.filter(u => u.role === 'AGENT').forEach(a => agentMap.set(a.email, a.id));

    for (const p of data.properties) {
      const agentId = agentMap.get(p.agentEmail) || memoryDb.users[0].id;
      memoryDb.properties.push({
        id: "prop_" + Math.random().toString(36).slice(2, 9),
        agentId,
        title: p.title,
        description: p.description,
        price: p.price,
        rentPrice: p.rentPrice,
        type: p.type,
        city: p.city,
        address: p.address,
        area: p.area,
        lat: p.lat,
        lng: p.lng,
        bedrooms: p.bedrooms,
        bathrooms: p.bathrooms,
        sizeSqft: p.sizeSqft,
        images: JSON.stringify(p.images),
        featured: p.featured,
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    console.log(`[InMemory DB] Seeded ${memoryDb.users.length} users and ${memoryDb.properties.length} properties.`);
  }
}

async function seedFromJSON() {
  const seedPath = path.join(__dirname, "seed_data.json");
  if (!fs.existsSync(seedPath)) return;
  console.log("[DB] Auto-seeding from seed_data.json...");
  const raw = fs.readFileSync(seedPath, "utf-8");
  const data = JSON.parse(raw);

  const agentMap = new Map();

  for (const u of data.users) {
    const id = "usr_" + Math.random().toString(36).slice(2, 9);
    await pool.query(
      `INSERT INTO users (id, email, password, name, phone, role, isApproved, agency, bio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, u.email, hashPassword(u.password), u.name, u.phone, u.role, u.isApproved ?? true, u.agency || null, u.bio || null]
    );
    if (u.role === "AGENT") agentMap.set(u.email, id);
  }

  for (const p of data.properties) {
    const id = "prop_" + Math.random().toString(36).slice(2, 9);
    const agentId = agentMap.get(p.agentEmail);
    if (!agentId) continue;
    await pool.query(
      `INSERT INTO properties (id, agentId, title, description, price, rentPrice, type, city, address, area, lat, lng, bedrooms, bathrooms, sizeSqft, images, featured, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [id, agentId, p.title, p.description, p.price, p.rentPrice, p.type, p.city, p.address, p.area, p.lat, p.lng, p.bedrooms, p.bathrooms, p.sizeSqft, JSON.stringify(p.images), p.featured]
    );
  }
  console.log("[DB] Seeding completed!");
}

// Middleware: Extract Auth User
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    if (decoded) req.user = decoded;
  }
  next();
}

app.use(authMiddleware);

// --- REST API ENDPOINTS ---

// 1. Auth: Register
app.post("/api/auth/register", async (req, res) => {
  const { email, password, name, phone, role = "USER", agency, bio } = req.body;
  if (!email || !password || !name || !phone) {
    return res.status(400).json({ error: "INVALID_INPUT", message: "All fields are required." });
  }

  if (memoryDb) {
    if (memoryDb.users.some((u) => u.email === email)) {
      return res.status(409).json({ error: "EMAIL_TAKEN", message: "Email already registered." });
    }
    const newUser = {
      id: "usr_" + Math.random().toString(36).slice(2, 9),
      email,
      password: hashPassword(password),
      name,
      phone,
      role: role === "AGENT" ? "AGENT" : "USER",
      isBlocked: false,
      isApproved: role !== "AGENT",
      agency: agency || null,
      bio: bio || null,
      avatar: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memoryDb.users.push(newUser);
    const token = signToken({ id: newUser.id, email: newUser.email, role: newUser.role });
    const { password: _, ...pub } = newUser;
    return res.json({ token, user: pub });
  }

  try {
    const [existing] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length > 0) {
      return res.status(409).json({ error: "EMAIL_TAKEN", message: "Email already registered." });
    }

    const id = "usr_" + Math.random().toString(36).slice(2, 9);
    const isApproved = role !== "AGENT";
    const hashed = hashPassword(password);

    await pool.query(
      "INSERT INTO users (id, email, password, name, phone, role, isApproved, agency, bio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, email, hashed, name, phone, role, isApproved, agency || null, bio || null]
    );

    const token = signToken({ id, email, role });
    res.json({
      token,
      user: { id, email, name, phone, role, isBlocked: false, isApproved, agency: agency || null, bio: bio || null },
    });
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

// 2. Auth: Login
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "INVALID_INPUT", message: "Email and password required." });
  }

  if (memoryDb) {
    const user = memoryDb.users.find((u) => u.email === email);
    if (!user || !verifyPassword(password, user.password)) {
      return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid email or password." });
    }
    if (user.isBlocked) {
      return res.status(403).json({ error: "AGENT_BLOCKED", message: "Your account is blocked by admin." });
    }
    const token = signToken({ id: user.id, email: user.email, role: user.role });
    const { password: _, ...pub } = user;
    return res.json({ token, user: pub });
  }

  try {
    const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    if (rows.length === 0) {
      return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid email or password." });
    }
    const user = rows[0];
    if (!verifyPassword(password, user.password)) {
      return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Invalid email or password." });
    }
    if (user.isBlocked) {
      return res.status(403).json({ error: "AGENT_BLOCKED", message: "Your account has been blocked." });
    }

    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        isBlocked: !!user.isBlocked,
        isApproved: !!user.isApproved,
        agency: user.agency,
        bio: user.bio,
        avatar: user.avatar,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

// 3. Auth: Me
app.get("/api/auth/me", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "UNAUTHORIZED" });
  if (memoryDb) {
    const u = memoryDb.users.find((x) => x.id === req.user.id);
    if (!u) return res.status(404).json({ error: "NOT_FOUND" });
    const { password: _, ...pub } = u;
    return res.json({ user: pub });
  }
  try {
    const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: "NOT_FOUND" });
    const u = rows[0];
    res.json({
      user: {
        id: u.id,
        email: u.email,
        name: u.name,
        phone: u.phone,
        role: u.role,
        isBlocked: !!u.isBlocked,
        isApproved: !!u.isApproved,
        agency: u.agency,
        bio: u.bio,
        avatar: u.avatar,
      },
    });
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

// 4. Properties: List (with Layer 1 PII masking & Layer 3 Agent Block filter)
app.get("/api/properties", async (req, res) => {
  const { city, type, bedrooms, q, featured } = req.query;

  if (memoryDb) {
    let list = memoryDb.properties.filter((p) => p.status === "ACTIVE");
    // Layer 3 filter: filter out blocked agents
    const blockedAgentIds = new Set(memoryDb.users.filter((u) => u.isBlocked).map((u) => u.id));
    list = list.filter((p) => !blockedAgentIds.has(p.agentId));

    if (city) list = list.filter((p) => p.city.toLowerCase() === String(city).toLowerCase());
    if (type) list = list.filter((p) => p.type === type);
    if (bedrooms) list = list.filter((p) => p.bedrooms >= Number(bedrooms));
    if (featured === "true") list = list.filter((p) => p.featured);
    if (q) {
      const term = String(q).toLowerCase();
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(term) ||
          p.description.toLowerCase().includes(term) ||
          p.area.toLowerCase().includes(term)
      );
    }

    const publicList = list.map((p) => {
      const agent = memoryDb.users.find((u) => u.id === p.agentId) || { name: "DURVIX Partner", phone: "", email: "" };
      let images = [];
      try {
        images = typeof p.images === "string" ? JSON.parse(p.images) : p.images;
      } catch {
        images = [];
      }
      return {
        ...p,
        images,
        agent: {
          id: agent.id,
          name: agent.name,
          agency: agent.agency,
          phoneMasked: maskPhone(agent.phone),
          emailMasked: maskEmail(agent.email),
        },
      };
    });

    return res.json({ properties: publicList });
  }

  try {
    let sql = `
      SELECT p.*, u.name as agentName, u.agency as agentAgency, u.phone as agentPhone, u.email as agentEmail, u.isBlocked as agentBlocked
      FROM properties p
      JOIN users u ON p.agentId = u.id
      WHERE p.status = 'ACTIVE' AND u.isBlocked = FALSE
    `;
    const params = [];

    if (city) {
      sql += " AND p.city = ?";
      params.push(city);
    }
    if (type) {
      sql += " AND p.type = ?";
      params.push(type);
    }
    if (bedrooms) {
      sql += " AND p.bedrooms >= ?";
      params.push(Number(bedrooms));
    }
    if (featured === "true") {
      sql += " AND p.featured = TRUE";
    }
    if (q) {
      sql += " AND (LOWER(p.title) LIKE ? OR LOWER(p.description) LIKE ? OR LOWER(p.area) LIKE ?)";
      const term = `%${String(q).toLowerCase()}%`;
      params.push(term, term, term);
    }

    sql += " ORDER BY p.createdAt DESC";

    const [rows] = await pool.query(sql, params);
    const properties = rows.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      title: r.title,
      description: r.description,
      price: r.price,
      rentPrice: r.rentPrice,
      type: r.type,
      city: r.city,
      address: r.address,
      area: r.area,
      lat: r.lat,
      lng: r.lng,
      bedrooms: r.bedrooms,
      bathrooms: r.bathrooms,
      sizeSqft: r.sizeSqft,
      images: JSON.parse(r.images || "[]"),
      featured: !!r.featured,
      status: r.status,
      createdAt: r.createdAt,
      agent: {
        id: r.agentId,
        name: r.agentName,
        agency: r.agentAgency,
        phoneMasked: maskPhone(r.agentPhone),
        emailMasked: maskEmail(r.agentEmail),
      },
    }));

    res.json({ properties });
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

// 5. Properties: Get Single
app.get("/api/properties/:id", async (req, res) => {
  const { id } = req.params;

  if (memoryDb) {
    const p = memoryDb.properties.find((x) => x.id === id);
    if (!p) return res.status(404).json({ error: "NOT_FOUND" });
    const agent = memoryDb.users.find((u) => u.id === p.agentId) || { name: "Agent", phone: "", email: "" };
    let images = [];
    try {
      images = typeof p.images === "string" ? JSON.parse(p.images) : p.images;
    } catch {
      images = [];
    }
    return res.json({
      property: {
        ...p,
        images,
        agent: {
          id: agent.id,
          name: agent.name,
          agency: agent.agency,
          phoneMasked: maskPhone(agent.phone),
          emailMasked: maskEmail(agent.email),
        },
      },
    });
  }

  try {
    const [rows] = await pool.query(
      `SELECT p.*, u.name as agentName, u.agency as agentAgency, u.phone as agentPhone, u.email as agentEmail
       FROM properties p JOIN users u ON p.agentId = u.id WHERE p.id = ?`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "NOT_FOUND" });
    const r = rows[0];
    res.json({
      property: {
        id: r.id,
        agentId: r.agentId,
        title: r.title,
        description: r.description,
        price: r.price,
        rentPrice: r.rentPrice,
        type: r.type,
        city: r.city,
        address: r.address,
        area: r.area,
        lat: r.lat,
        lng: r.lng,
        bedrooms: r.bedrooms,
        bathrooms: r.bathrooms,
        sizeSqft: r.sizeSqft,
        images: JSON.parse(r.images || "[]"),
        featured: !!r.featured,
        status: r.status,
        agent: {
          id: r.agentId,
          name: r.agentName,
          agency: r.agentAgency,
          phoneMasked: maskPhone(r.agentPhone),
          emailMasked: maskEmail(r.agentEmail),
        },
      },
    });
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

// 6. Properties: Create (Agent only)
app.post("/api/properties", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "UNAUTHORIZED" });
  const { title, description, price, rentPrice, type, city, address, area, lat, lng, bedrooms, bathrooms, sizeSqft, images } = req.body;

  if (memoryDb) {
    const newProp = {
      id: "prop_" + Math.random().toString(36).slice(2, 9),
      agentId: req.user.id,
      title,
      description,
      price: Number(price) || 0,
      rentPrice: rentPrice ? Number(rentPrice) : null,
      type: type || "BUY",
      city,
      address,
      area,
      lat: Number(lat),
      lng: Number(lng),
      bedrooms: Number(bedrooms),
      bathrooms: Number(bathrooms),
      sizeSqft: Number(sizeSqft),
      images: JSON.stringify(images || []),
      featured: false,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memoryDb.properties.push(newProp);
    return res.json({ property: newProp });
  }

  try {
    const id = "prop_" + Math.random().toString(36).slice(2, 9);
    await pool.query(
      `INSERT INTO properties (id, agentId, title, description, price, rentPrice, type, city, address, area, lat, lng, bedrooms, bathrooms, sizeSqft, images, featured, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, 'ACTIVE')`,
      [id, req.user.id, title, description, Number(price) || 0, rentPrice ? Number(rentPrice) : null, type || "BUY", city, address, area, Number(lat), Number(lng), Number(bedrooms), Number(bathrooms), Number(sizeSqft), JSON.stringify(images || [])]
    );
    res.json({ property: { id, title, city, area } });
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

// 7. Bookings: List
app.get("/api/bookings", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "UNAUTHORIZED" });

  if (memoryDb) {
    let list = [];
    if (req.user.role === "ADMIN") {
      list = [...memoryDb.bookings];
    } else if (req.user.role === "AGENT") {
      list = memoryDb.bookings.filter((b) => b.agentId === req.user.id);
    } else {
      list = memoryDb.bookings.filter((b) => b.userId === req.user.id);
    }

    const resList = list.map((b) => {
      const p = memoryDb.properties.find((x) => x.id === b.propertyId) || { title: "Property", images: "[]", city: "", area: "" };
      const agent = memoryDb.users.find((u) => u.id === b.agentId) || { name: "", phone: "", email: "" };
      const buyer = memoryDb.users.find((u) => u.id === b.userId) || { name: "", phone: "", email: "" };

      let images = [];
      try {
        images = typeof p.images === "string" ? JSON.parse(p.images) : p.images;
      } catch {
        images = [];
      }

      const isConfirmed = b.status === "CONFIRMED";
      return {
        ...b,
        property: { id: p.id, title: p.title, images, city: p.city, area: p.area },
        agent: {
          name: agent.name,
          phoneMasked: maskPhone(agent.phone),
          emailMasked: maskEmail(agent.email),
          phoneRaw: isConfirmed ? agent.phone : undefined,
          emailRaw: isConfirmed ? agent.email : undefined,
        },
        buyer: isConfirmed ? { name: buyer.name, phone: buyer.phone, email: buyer.email } : undefined,
      };
    });

    return res.json({ bookings: resList });
  }

  try {
    let sql = `
      SELECT b.*, p.title as propTitle, p.images as propImages, p.city as propCity, p.area as propArea,
             a.name as agentName, a.phone as agentPhone, a.email as agentEmail,
             u.name as buyerName, u.phone as buyerPhone, u.email as buyerEmail
      FROM bookings b
      JOIN properties p ON b.propertyId = p.id
      JOIN users a ON b.agentId = a.id
      JOIN users u ON b.userId = u.id
    `;
    const params = [];
    if (req.user.role === "AGENT") {
      sql += " WHERE b.agentId = ?";
      params.push(req.user.id);
    } else if (req.user.role !== "ADMIN") {
      sql += " WHERE b.userId = ?";
      params.push(req.user.id);
    }
    sql += " ORDER BY b.createdAt DESC";

    const [rows] = await pool.query(sql, params);
    const bookings = rows.map((r) => {
      const isConfirmed = r.status === "CONFIRMED";
      return {
        id: r.id,
        userId: r.userId,
        propertyId: r.propertyId,
        agentId: r.agentId,
        status: r.status,
        tokenAmount: r.tokenAmount,
        tokenPaidAt: r.tokenPaidAt,
        visitDate: r.visitDate,
        notes: r.notes,
        createdAt: r.createdAt,
        property: {
          id: r.propertyId,
          title: r.propTitle,
          images: JSON.parse(r.propImages || "[]"),
          city: r.propCity,
          area: r.propArea,
        },
        agent: {
          name: r.agentName,
          phoneMasked: maskPhone(r.agentPhone),
          emailMasked: maskEmail(r.agentEmail),
          phoneRaw: isConfirmed ? r.agentPhone : undefined,
          emailRaw: isConfirmed ? r.agentEmail : undefined,
        },
        buyer: isConfirmed ? { name: r.buyerName, phone: r.buyerPhone, email: r.buyerEmail } : undefined,
      };
    });

    res.json({ bookings });
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

// 8. Bookings: Create Request (Status: PENDING_TOKEN)
app.post("/api/bookings", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "UNAUTHORIZED" });
  const { propertyId, visitDate, notes } = req.body;

  let agentId = null;

  if (memoryDb) {
    const prop = memoryDb.properties.find((p) => p.id === propertyId);
    if (!prop) return res.status(404).json({ error: "PROPERTY_NOT_FOUND" });
    agentId = prop.agentId;

    const newBooking = {
      id: "book_" + Math.random().toString(36).slice(2, 9),
      userId: req.user.id,
      propertyId,
      agentId,
      status: "PENDING_TOKEN",
      tokenAmount: 5000,
      tokenPaidAt: null,
      visitDate: visitDate || null,
      notes: notes || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memoryDb.bookings.push(newBooking);
    return res.json({ booking: newBooking });
  }

  try {
    const [pRows] = await pool.query("SELECT agentId FROM properties WHERE id = ?", [propertyId]);
    if (pRows.length === 0) return res.status(404).json({ error: "PROPERTY_NOT_FOUND" });
    agentId = pRows[0].agentId;

    const id = "book_" + Math.random().toString(36).slice(2, 9);
    await pool.query(
      "INSERT INTO bookings (id, userId, propertyId, agentId, status, tokenAmount, visitDate, notes) VALUES (?, ?, ?, ?, 'PENDING_TOKEN', 5000, ?, ?)",
      [id, req.user.id, propertyId, agentId, visitDate || null, notes || null]
    );

    res.json({ booking: { id, status: "PENDING_TOKEN", tokenAmount: 5000 } });
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

// 9. Bookings: Pay Token (Layer 2 Simulator Confirmation -> CONFIRMED)
const payTokenHandler = async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "UNAUTHORIZED" });
  const bookingId = req.params.id || req.body.bookingId;
  if (!bookingId) return res.status(400).json({ error: "INVALID_INPUT" });
  const now = new Date().toISOString();

  if (memoryDb) {
    const b = memoryDb.bookings.find((x) => x.id === bookingId);
    if (!b) return res.status(404).json({ error: "NOT_FOUND" });
    b.status = "CONFIRMED";
    b.tokenPaidAt = now;

    const agent = memoryDb.users.find((u) => u.id === b.agentId);
    return res.json({
      booking: {
        ...b,
        status: "CONFIRMED",
        agent: {
          name: agent?.name,
          phoneRaw: agent?.phone,
          emailRaw: agent?.email,
          phoneMasked: maskPhone(agent?.phone),
          emailMasked: maskEmail(agent?.email),
        },
      },
    });
  }

  try {
    await pool.query("UPDATE bookings SET status = 'CONFIRMED', tokenPaidAt = NOW() WHERE id = ?", [bookingId]);
    const [rows] = await pool.query(
      `SELECT b.*, a.name as agentName, a.phone as agentPhone, a.email as agentEmail
       FROM bookings b JOIN users a ON b.agentId = a.id WHERE b.id = ?`,
      [bookingId]
    );
    if (rows.length === 0) return res.status(404).json({ error: "NOT_FOUND" });
    const r = rows[0];

    res.json({
      booking: {
        id: r.id,
        status: "CONFIRMED",
        tokenPaidAt: r.tokenPaidAt,
        agent: {
          name: r.agentName,
          phoneRaw: r.agentPhone,
          emailRaw: r.agentEmail,
          phoneMasked: maskPhone(r.agentPhone),
          emailMasked: maskEmail(r.agentEmail),
        },
      },
    });
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
};

app.post("/api/bookings/pay-token", payTokenHandler);
app.post("/api/bookings/:id/token", payTokenHandler);

// 10. Agents: Public Directory
app.get("/api/agents", async (req, res) => {
  if (memoryDb) {
    const agents = memoryDb.users.filter((u) => u.role === "AGENT" && u.isApproved && !u.isBlocked);
    const result = agents.map((a) => {
      const propertyCount = memoryDb.properties.filter((p) => p.agentId === a.id && p.status === "ACTIVE").length;
      return {
        id: a.id,
        name: a.name,
        agency: a.agency,
        bio: a.bio,
        phoneMasked: maskPhone(a.phone),
        emailMasked: maskEmail(a.email),
        propertyCount,
      };
    });
    return res.json({ agents: result });
  }

  try {
    const [rows] = await pool.query(`
      SELECT u.id, u.name, u.agency, u.bio, u.phone, u.email, COUNT(p.id) as propertyCount
      FROM users u
      LEFT JOIN properties p ON u.id = p.agentId AND p.status = 'ACTIVE'
      WHERE u.role = 'AGENT' AND u.isApproved = TRUE AND u.isBlocked = FALSE
      GROUP BY u.id
    `);

    const agents = rows.map((r) => ({
      id: r.id,
      name: r.name,
      agency: r.agency,
      bio: r.bio,
      phoneMasked: maskPhone(r.phone),
      emailMasked: maskEmail(r.email),
      propertyCount: Number(r.propertyCount),
    }));

    res.json({ agents });
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

// 11. Admin: Stats & Overview
app.get("/api/admin/stats", async (req, res) => {
  if (!req.user || req.user.role !== "ADMIN") return res.status(403).json({ error: "FORBIDDEN" });

  if (memoryDb) {
    const confirmedBookings = memoryDb.bookings.filter((b) => b.status === "CONFIRMED");
    const revenue = confirmedBookings.reduce((s, b) => s + b.tokenAmount, 0);

    return res.json({
      revenue,
      counts: {
        users: memoryDb.users.filter((u) => u.role === "USER").length,
        agents: memoryDb.users.filter((u) => u.role === "AGENT").length,
        blockedAgents: memoryDb.users.filter((u) => u.role === "AGENT" && u.isBlocked).length,
        pendingAgents: memoryDb.users.filter((u) => u.role === "AGENT" && !u.isApproved),
        properties: memoryDb.properties.length,
        bookings: memoryDb.bookings.length,
        confirmedBookings: confirmedBookings.length,
        contactMessages: memoryDb.contact_messages.length,
      },
      recentBookings: memoryDb.bookings.slice(-5).map((b) => {
        const p = memoryDb.properties.find((x) => x.id === b.propertyId);
        const buyer = memoryDb.users.find((u) => u.id === b.userId);
        const agent = memoryDb.users.find((u) => u.id === b.agentId);
        return {
          id: b.id,
          status: b.status,
          tokenAmount: b.tokenAmount,
          createdAt: b.createdAt,
          propertyTitle: p ? p.title : "Property",
          buyerName: buyer ? buyer.name : "Buyer",
          agentName: agent ? agent.name : "Agent",
        };
      }),
    });
  }

  try {
    const [revRows] = await pool.query("SELECT SUM(tokenAmount) as rev FROM bookings WHERE status = 'CONFIRMED'");
    const [userCount] = await pool.query("SELECT COUNT(*) as c FROM users WHERE role = 'USER'");
    const [agentCount] = await pool.query("SELECT COUNT(*) as c FROM users WHERE role = 'AGENT'");
    const [blockedCount] = await pool.query("SELECT COUNT(*) as c FROM users WHERE role = 'AGENT' AND isBlocked = TRUE");
    const [pendingAgents] = await pool.query("SELECT id, email, name, agency FROM users WHERE role = 'AGENT' AND isApproved = FALSE");
    const [propCount] = await pool.query("SELECT COUNT(*) as c FROM properties");
    const [bookCount] = await pool.query("SELECT COUNT(*) as c FROM bookings");
    const [confCount] = await pool.query("SELECT COUNT(*) as c FROM bookings WHERE status = 'CONFIRMED'");

    const [recent] = await pool.query(`
      SELECT b.id, b.status, b.tokenAmount, b.createdAt, p.title as propertyTitle, u.name as buyerName, a.name as agentName
      FROM bookings b
      JOIN properties p ON b.propertyId = p.id
      JOIN users u ON b.userId = u.id
      JOIN users a ON b.agentId = a.id
      ORDER BY b.createdAt DESC LIMIT 5
    `);

    res.json({
      revenue: Number(revRows[0].rev || 0),
      counts: {
        users: userCount[0].c,
        agents: agentCount[0].c,
        blockedAgents: blockedCount[0].c,
        pendingAgents,
        properties: propCount[0].c,
        bookings: bookCount[0].c,
        confirmedBookings: confCount[0].c,
        contactMessages: 0,
      },
      recentBookings: recent,
    });
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

// 12. Admin: List All Agents (with Ban & Approve Status)
app.get("/api/admin/agents", async (req, res) => {
  if (!req.user || req.user.role !== "ADMIN") return res.status(403).json({ error: "FORBIDDEN" });

  if (memoryDb) {
    const list = memoryDb.users.filter((u) => u.role === "AGENT").map((a) => {
      const propertyCount = memoryDb.properties.filter((p) => p.agentId === a.id).length;
      return {
        id: a.id,
        name: a.name,
        email: a.email,
        phone: a.phone,
        agency: a.agency,
        isBlocked: !!a.isBlocked,
        isApproved: !!a.isApproved,
        propertyCount,
      };
    });
    return res.json({ agents: list });
  }

  try {
    const [rows] = await pool.query(`
      SELECT u.id, u.name, u.email, u.phone, u.agency, u.isBlocked, u.isApproved, COUNT(p.id) as propertyCount
      FROM users u LEFT JOIN properties p ON u.id = p.agentId
      WHERE u.role = 'AGENT'
      GROUP BY u.id
    `);

    res.json({
      agents: rows.map((r) => ({
        ...r,
        isBlocked: !!r.isBlocked,
        isApproved: !!r.isApproved,
        propertyCount: Number(r.propertyCount),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

// 13. Layer 3 Admin Action: One-Click Ban Toggle
const banHandler = async (req, res) => {
  if (!req.user || req.user.role !== "ADMIN") return res.status(403).json({ error: "FORBIDDEN" });
  const agentId = req.params.id || req.body.agentId;

  if (memoryDb) {
    const agent = memoryDb.users.find((u) => u.id === agentId);
    if (!agent) return res.status(404).json({ error: "NOT_FOUND" });
    agent.isBlocked = true;
    return res.json({ user: { id: agent.id, isBlocked: true }, agent: { id: agent.id, isBlocked: true } });
  }

  try {
    await pool.query("UPDATE users SET isBlocked = TRUE WHERE id = ?", [agentId]);
    res.json({ user: { id: agentId, isBlocked: true }, agent: { id: agentId, isBlocked: true } });
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
};

const unbanHandler = async (req, res) => {
  if (!req.user || req.user.role !== "ADMIN") return res.status(403).json({ error: "FORBIDDEN" });
  const agentId = req.params.id || req.body.agentId;

  if (memoryDb) {
    const agent = memoryDb.users.find((u) => u.id === agentId);
    if (!agent) return res.status(404).json({ error: "NOT_FOUND" });
    agent.isBlocked = false;
    agent.isApproved = true;
    return res.json({ user: { id: agent.id, isBlocked: false, isApproved: true }, agent: { id: agent.id, isBlocked: false, isApproved: true } });
  }

  try {
    await pool.query("UPDATE users SET isBlocked = FALSE, isApproved = TRUE WHERE id = ?", [agentId]);
    res.json({ user: { id: agentId, isBlocked: false, isApproved: true }, agent: { id: agentId, isBlocked: false, isApproved: true } });
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
};

app.post("/api/agents/ban", banHandler);
app.post("/api/agents/:id/ban", banHandler);
app.post("/api/agents/unban", unbanHandler);
app.post("/api/agents/:id/unban", unbanHandler);

// 14. Admin Action: Approve Agent
const approveHandler = async (req, res) => {
  if (!req.user || req.user.role !== "ADMIN") return res.status(403).json({ error: "FORBIDDEN" });
  const agentId = req.params.id || req.body.agentId;

  if (memoryDb) {
    const agent = memoryDb.users.find((u) => u.id === agentId);
    if (!agent) return res.status(404).json({ error: "NOT_FOUND" });
    agent.isApproved = true;
    agent.isBlocked = false;
    return res.json({ user: { id: agent.id, isApproved: true, isBlocked: false }, agent: { id: agent.id, isApproved: true, isBlocked: false } });
  }

  try {
    await pool.query("UPDATE users SET isApproved = TRUE, isBlocked = FALSE WHERE id = ?", [agentId]);
    res.json({ user: { id: agentId, isApproved: true, isBlocked: false }, agent: { id: agentId, isApproved: true, isBlocked: false } });
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
};

app.post("/api/agents/approve", approveHandler);
app.post("/api/agents/:id/approve", approveHandler);

// 15. Contact Concierge
app.post("/api/contact", async (req, res) => {
  const { name, email, phone, subject, message } = req.body;
  if (!name || !email || !phone || !subject || !message) {
    return res.status(400).json({ error: "INVALID_INPUT", message: "All fields are required." });
  }

  if (memoryDb) {
    const msg = { id: "msg_" + Math.random().toString(36).slice(2, 9), name, email, phone, subject, message, resolved: false, createdAt: new Date().toISOString() };
    memoryDb.contact_messages.push(msg);
    return res.json({ success: true, id: msg.id });
  }

  try {
    const id = "msg_" + Math.random().toString(36).slice(2, 9);
    await pool.query(
      "INSERT INTO contact_messages (id, name, email, phone, subject, message) VALUES (?, ?, ?, ?, ?, ?)",
      [id, name, email, phone, subject, message]
    );
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
});

// Start Server
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`[DURVIX Server] Express API running on http://localhost:${PORT}`);
  });
});