import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import { syncBman } from "./syncfed.js";
import { pool } from "./db.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/status", (req, res) => {
  res.json({ ok: true, message: "SyncFED attivo" });
});

app.post("/sync", async (req, res) => {
  try {
    const result = await syncBman();
    res.json(result);
  } catch (err) {
    console.error("❌ ERRORE SYNC:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/articoli", async (req, res) => {
  try {
    const filtro = req.query.filtro || "non_approvati";
    let where = "";

    if (filtro === "non_approvati") {
      where =
        "WHERE ottimizzazione_approvata <> 'SI' OR ottimizzazione_approvata IS NULL";
    }

    const [rows] = await pool.query(
      `SELECT * FROM articoli_bman ${where} ORDER BY id DESC LIMIT 500`
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ ERRORE GET /articoli:", err);
    res.status(500).json({ error: "Errore lettura articoli" });
  }
});

app.post("/articoli/:id/approva", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      "UPDATE articoli_bman SET ottimizzazione_approvata = 'SI', data_approvazione = NOW() WHERE id = ?",
      [id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ ERRORE POST /articoli/:id/approva:", err);
    res.status(500).json({ error: "Errore aggiornamento articolo" });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Server attivo su porta ${PORT}`);
});
