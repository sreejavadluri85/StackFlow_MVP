
require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

// Validate required environment variables
const requiredEnv = [
  "DB_HOST",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
  "JWT_SECRET"
];

const missingEnv = requiredEnv.filter(
  (key) => !process.env[key]
);

if (missingEnv.length > 0) {
  console.error(
    "Missing environment variables:",
    missingEnv.join(", ")
  );
  process.exit(1);
}

// MySQL connection pool for Aiven
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    ca: fs.readFileSync(
      path.join(__dirname, "ca.pem"),
      "utf8"
    ),
    rejectUnauthorized: true
  },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Health check
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      status: "ok",
      database: "connected"
    });
  } catch (error) {
    console.error("MYSQL HEALTH CHECK ERROR:", {
      message: error.message,
      code: error.code
    });

    res.status(500).json({
      status: "error",
      message: "Database connection failed",
      code: error.code || "UNKNOWN"
    });
  }
});

// Register organization and first user
app.post("/api/auth/register", async (req, res) => {
  const {
    name,
    email,
    password,
    organizationName
  } = req.body;

  if (!name || !email || !password || !organizationName) {
    return res.status(400).json({
      message:
        "Name, email, password and organizationName are required"
    });
  }

  if (String(password).length < 8) {
    return res.status(400).json({
      message: "Password must contain at least 8 characters"
    });
  }

  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [orgResult] = await connection.execute(
      "INSERT INTO organizations (name) VALUES (?)",
      [String(organizationName).trim()]
    );

    const passwordHash = await bcrypt.hash(
      String(password),
      10
    );

    const normalizedEmail = String(email)
      .trim()
      .toLowerCase();

    const [userResult] = await connection.execute(
      `INSERT INTO users
       (organization_id, name, email, password_hash)
       VALUES (?, ?, ?, ?)`,
      [
        orgResult.insertId,
        String(name).trim(),
        normalizedEmail,
        passwordHash
      ]
    );

    await connection.commit();

    const token = jwt.sign(
      {
        userId: userResult.insertId,
        organizationId: orgResult.insertId
      },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    return res.status(201).json({
      message: "Registration successful",
      token,
      user: {
        id: userResult.insertId,
        name: String(name).trim(),
        email: normalizedEmail,
        organizationId: orgResult.insertId,
        organizationName: String(organizationName).trim()
      }
    });
  } catch (error) {
    if (connection) {
      await connection.rollback().catch(() => {});
    }

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "This email is already registered"
      });
    }

    console.error("REGISTRATION ERROR:", {
      message: error.message,
      code: error.code
    });

    return res.status(500).json({
      message: "Registration failed",
      code: error.code || "UNKNOWN"
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// Login
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      message: "Email and password are required"
    });
  }

  try {
    const normalizedEmail = String(email)
      .trim()
      .toLowerCase();

    const [users] = await pool.execute(
      `SELECT id, organization_id, name, email, password_hash
       FROM users
       WHERE email = ?
       LIMIT 1`,
      [normalizedEmail]
    );

    if (users.length === 0) {
      return res.status(401).json({
        message: "Invalid email or password"
      });
    }

    const user = users[0];

    const passwordMatches = await bcrypt.compare(
      String(password),
      user.password_hash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Invalid email or password"
      });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        organizationId: user.organization_id
      },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    return res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        organizationId: user.organization_id
      }
    });
  } catch (error) {
    console.error("LOGIN ERROR:", {
      message: error.message,
      code: error.code,
      sqlMessage: error.sqlMessage
    });

    return res.status(500).json({
      message: "Login failed",
      code: error.code || "UNKNOWN"
    });
  }
});

// Authentication middleware
function authenticateToken(req, res, next) {
  const header = req.headers.authorization;

  const token =
    header && header.startsWith("Bearer ")
      ? header.slice(7)
      : null;

  if (!token) {
    return res.status(401).json({
      message: "Authentication token required"
    });
  }

  try {
    req.user = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    next();
  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired token"
    });
  }
}

// Get products for the logged-in user's organization
app.get("/api/products", authenticateToken, async (req, res) => {
  try {
    const [products] = await pool.execute(
      `SELECT id, name, sku, quantity, price,
              low_stock_threshold, created_at, updated_at
       FROM products
       WHERE organization_id = ?
       ORDER BY id DESC`,
      [req.user.organizationId]
    );

    return res.json(products);
  } catch (error) {
    console.error("FETCH PRODUCTS ERROR:", {
      message: error.message,
      code: error.code
    });

    return res.status(500).json({
      message: "Could not fetch products"
    });
  }
});

// Add product
app.post("/api/products", authenticateToken, async (req, res) => {
  const {
    name,
    sku,
    quantity = 0,
    price = 0,
    low_stock_threshold = 5
  } = req.body;

  if (!name || !sku) {
    return res.status(400).json({
      message: "Product name and SKU are required"
    });
  }

  if (
    !Number.isInteger(Number(quantity)) ||
    Number(quantity) < 0 ||
    !Number.isFinite(Number(price)) ||
    Number(price) < 0 ||
    !Number.isInteger(Number(low_stock_threshold)) ||
    Number(low_stock_threshold) < 0
  ) {
    return res.status(400).json({
      message:
        "Quantity, price and threshold must be valid non-negative numbers"
    });
  }

  try {
    const [result] = await pool.execute(
      `INSERT INTO products
       (organization_id, name, sku, quantity, price, low_stock_threshold)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.user.organizationId,
        String(name).trim(),
        String(sku).trim(),
        Number(quantity),
        Number(price),
        Number(low_stock_threshold)
      ]
    );

    return res.status(201).json({
      message: "Product created successfully",
      id: result.insertId
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "That SKU already exists in your organization"
      });
    }

    console.error("CREATE PRODUCT ERROR:", {
      message: error.message,
      code: error.code
    });

    return res.status(500).json({
      message: "Could not create product"
    });
  }
});

// Update product
app.put("/api/products/:id", authenticateToken, async (req, res) => {
  const {
    name,
    sku,
    quantity,
    price,
    low_stock_threshold
  } = req.body;

  if (
    !name ||
    !sku ||
    !Number.isInteger(Number(quantity)) ||
    Number(quantity) < 0 ||
    !Number.isFinite(Number(price)) ||
    Number(price) < 0 ||
    !Number.isInteger(Number(low_stock_threshold)) ||
    Number(low_stock_threshold) < 0
  ) {
    return res.status(400).json({
      message:
        "Provide valid name, SKU, quantity, price and low-stock threshold"
    });
  }

  try {
    const [result] = await pool.execute(
      `UPDATE products
       SET name = ?, sku = ?, quantity = ?, price = ?,
           low_stock_threshold = ?
       WHERE id = ? AND organization_id = ?`,
      [
        String(name).trim(),
        String(sku).trim(),
        Number(quantity),
        Number(price),
        Number(low_stock_threshold),
        req.params.id,
        req.user.organizationId
      ]
    );

    if (result.affectedRows === 0) {
      const [rows] = await pool.execute(
        `SELECT id FROM products
         WHERE id = ? AND organization_id = ?`,
        [req.params.id, req.user.organizationId]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          message: "Product not found"
        });
      }
    }

    return res.json({
      message: "Product updated successfully"
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "That SKU already exists in your organization"
      });
    }

    console.error("UPDATE PRODUCT ERROR:", {
      message: error.message,
      code: error.code
    });

    return res.status(500).json({
      message: "Could not update product"
    });
  }
});

// Delete product
app.delete("/api/products/:id", authenticateToken, async (req, res) => {
  try {
    const [result] = await pool.execute(
      `DELETE FROM products
       WHERE id = ? AND organization_id = ?`,
      [
        req.params.id,
        req.user.organizationId
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Product not found"
      });
    }

    return res.json({
      message: "Product deleted successfully"
    });
  } catch (error) {
    console.error("DELETE PRODUCT ERROR:", {
      message: error.message,
      code: error.code
    });

    return res.status(500).json({
      message: "Could not delete product"
    });
  }
});

// Dashboard totals and low-stock products
app.get("/api/dashboard", authenticateToken, async (req, res) => {
  try {
    const [totals] = await pool.execute(
      `SELECT
         COUNT(*) AS totalProducts,
         COALESCE(SUM(quantity), 0) AS totalUnits,
         COALESCE(SUM(quantity * price), 0) AS inventoryValue,
         COALESCE(
           SUM(
             CASE
               WHEN quantity <= low_stock_threshold THEN 1
               ELSE 0
             END
           ), 0
         ) AS lowStockCount
       FROM products
       WHERE organization_id = ?`,
      [req.user.organizationId]
    );

    const [lowStockProducts] = await pool.execute(
      `SELECT id, name, sku, quantity, low_stock_threshold
       FROM products
       WHERE organization_id = ?
         AND quantity <= low_stock_threshold
       ORDER BY quantity ASC`,
      [req.user.organizationId]
    );

    return res.json({
      ...totals[0],
      lowStockProducts
    });
  } catch (error) {
    console.error("DASHBOARD ERROR:", {
      message: error.message,
      code: error.code
    });

    return res.status(500).json({
      message: "Could not load dashboard"
    });
  }
});

// Handle unknown API routes
app.use("/api", (req, res) => {
  res.status(404).json({
    message: "API endpoint not found"
  });
});

// Start server
const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`StockFlow server running on port ${PORT}`);
});
