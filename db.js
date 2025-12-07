// db.js
import mysql from "mysql2/promise";

// esportiamo pool come NAMED EXPORT
export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test connessione
try {
  await pool.query("SELECT 1");
  console.log("📌 MySQL Connesso con successo!");
} catch (err) {
  console.error("❌ ERRORE CONNESSIONE MYSQL:", err);
}
