import mysql from "mysql2/promise";

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: {
    rejectUnauthorized: false
  }
});

// Test immediato di connessione all'avvio server
db.query("SELECT 1")
  .then(() => console.log("🟢 Connessione MySQL OK"))
  .catch((err) => console.error("❌ ERRORE CONNESSIONE MYSQL:", err));

export default db;
