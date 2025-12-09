import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const DB_HOST = process.env.DB_HOST || "31.11.39.115";
const DB_USER = process.env.DB_USER || "Sql1777937";
const DB_PASSWORD = process.env.DB_PASSWORD || "Patatone22$$";
const DB_NAME = process.env.DB_NAME || "Sql1777937_3";

export const pool = mysql.createPool({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test connessione all'avvio (solo log, per debug)
try {
  await pool.query("SELECT 1");
  console.log("✅ Connessione MySQL OK");
} catch (err) {
  console.error("❌ ERRORE CONNESSIONE MYSQL:", err);
}
