import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { pool } from "./db.js";
import { syncBman } from "./syncfed.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// API: lista articoli
app.get("/api/articoli", async (req, res) => {
  try {
    const filter = req.query.filter || "all";
    let sql = "SELECT * FROM prodotti";
    const params = [];

    if (filter === "not_approved") {
      sql += " WHERE ottimizzazione_approvata = 0";
    }

    sql += " ORDER BY titolo ASC";

    const [rows] = await pool.query(sql, params);
    res.json({ ok: true, articoli: rows });
  } catch (err) {
    console.error("❌ ERRORE GET /api/articoli:", err);
    res.status(500).json({ ok: false, errore: "Errore caricamento articoli" });
  }
});

// API: approva un articolo
app.post("/api/articoli/:id/approva", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ ok: false, errore: "ID non valido" });
    }

    await pool.query(
      "UPDATE prodotti SET ottimizzazione_approvata = 1 WHERE id = ?",
      [id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ ERRORE POST /api/articoli/:id/approva:", err);
    res
      .status(500)
      .json({ ok: false, errore: "Errore durante l'approvazione articolo" });
  }
});

// API: avvia sincronizzazione
app.post("/api/sync", async (req, res) => {
  try {
    const result = await syncBman();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("❌ ERRORE SYNC:", err);
    res.status(500).json({ ok: false, errore: "Errore durante la sync" });
  }
});

// Dashboard
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 SyncFED attivo su porta ${PORT}`);
});
