// =========================
// 🗃️ DATABASE MYSQL POOL
// =========================

const mysql = require("mysql2/promise");
require("dotenv").config();

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASS,
  database: process.env.MYSQL_DB,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: {
    rejectUnauthorized: false // ✔ Aruba compatibile
  }
});

async function query(sql, params) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

module.exports = { pool, query };
