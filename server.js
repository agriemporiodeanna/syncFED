// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import { syncBman } from "./syncfed.js";
import {
  getAllArticoli,
  setOttimizzazioneSi,
  testSheetsConnection,
} from "./googleSheets.js";
import pool from "./db.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

// Static: serve la cartella /public
app.use(express.static(path.join(__dirname, "public")));

// Se hai un dashboard.html, puoi forzare la root lì.
// Altrimenti lascio l'index.html di default.
app.get("/", (req, res) => {
  const dashboardPath = path.join(__dirname, "public", "dashboard.html");
  res.sendFile(dashboardPath, (err) => {
    if (err) {
      // fallback a index.html se dashboard non esiste
      res.sendFile(path.join(__dirname, "public", "index.html"));
    }
  });
});

/**
 * GET /articoli
 * Legge gli articoli da Google Sheet e opzionalmente filtra:
 *  ?approvati=si   → solo ottimizzati
 *  ?approvati=no   → solo NON ottimizzati
 *  (vuoto)         → tutti
 */
app.get("/articoli", async (req, res) => {
  try {
    const approvati = (req.query.approvati || "").toString().toLowerCase();

    const articoli = await getAllArticoli();

    let filtrati = articoli;

    if (approvati === "si") {
      filtrati = articoli.filter(
        (a) => (a.ottimizzazione_approvata || "").toUpperCase() === "SI"
      );
    } else if (approvati === "no") {
      filtrati = articoli.filter(
        (a) =>
          !a.ottimizzazione_approvata ||
          (a.ottimizzazione_approvata || "").toUpperCase() !== "SI"
      );
    }

    res.json(filtrati);
  } catch (err) {
    console.error("❌ ERRORE GET /articoli:", err);
    res.status(500).json({
      error: "Errore nel recupero articoli da Google Sheet.",
      details: err.message,
    });
  }
});

/**
 * POST /articoli/:rowNumber/approva
 * Segna una riga come ottimizzata (ottimizzazione_approvata = "SI").
 * rowNumber = numero riga sul foglio (es. 2, 3, 4,...)
 */
app.post("/articoli/:rowNumber/approva", async (req, res) => {
  const rowNumber = Number(req.params.rowNumber);

  if (!rowNumber || rowNumber < 2) {
    return res.status(400).json({
      error: "rowNumber non valido. Deve essere >= 2 (la riga 1 è l'header).",
    });
  }

  try {
    await setOttimizzazioneSi(rowNumber);
    res.json({ success: true, rowNumber });
  } catch (err) {
    console.error("❌ ERRORE POST /articoli/:rowNumber/approva:", err);
    res.status(500).json({
      error: "Errore nel marcare l'articolo come ottimizzato.",
      details: err.message,
    });
  }
});

/**
 * POST /sync
 * Lancia la sincronizzazione da Bman verso Google Sheet.
 */
app.post("/sync", async (req, res) => {
  try {
    const result = await syncBman();
    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error("❌ ERRORE SYNC /sync:", err);
    res.status(500).json({
      success: false,
      error: "Errore nella sincronizzazione da Bman.",
      details: err.message,
    });
  }
});

/**
 * GET /test-sheet
 * Verifica connessione al Google Sheet.
 */
app.get("/test-sheet", async (req, res) => {
  try {
    const ok = await testSheetsConnection();
    res.json({ success: ok });
  } catch (err) {
    console.error("❌ Test Sheet error:", err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /testdb
 * (Opzionale) test connessione MySQL – rimane per sviluppo locale.
 */
app.get("/testdb", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT 1 AS ok");
    res.json({ success: true, rows });
  } catch (err) {
    console.error("❌ Test DB error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 SyncFED attivo su porta ${PORT}`);
});
