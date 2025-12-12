import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { SheetsStore, ensureHeaders } from "./googleSheets.js";
import axios from "axios";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REQUIRED_ENV = ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY", "GOOGLE_SHEETS_ID"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k] || String(process.env[k]).trim() === "");
if (missing.length) {
  console.error(`❌ Errore inizializzazione Google Sheet: Variabili ambiente mancanti: ${missing.join(", ")}`);
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---- Google Sheets store ----
const store = new SheetsStore({
  clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "",
  privateKey: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  spreadsheetId: process.env.GOOGLE_SHEETS_ID || "",
  sheetName: process.env.GOOGLE_SHEET_NAME || "foglio1",
});

// Columns mapping
export const HEADERS = [
  "id_articolo",
  "codice",
  "descrizione_it",
  "prezzo",
  "quantita",
  "categoria",
  "sottocategoria",
  "ottimizzazione_approvata",
  "tags",
  "descrizione_fr",
  "descrizione_es",
  "descrizione_de",
  "descrizione_en",
  "data_ultimo_aggiornamento",
];

// Ensure headers on boot
app.get("/healthz", (_req, res) => res.json({ ok: true }));

(async () => {
  try {
    await ensureHeaders(store, HEADERS);
    console.log("✅ Foglio pronto con intestazioni corrette.");
  } catch (e) {
    console.error("⚠️ Impossibile verificare/creare intestazioni:", e?.message);
  }
})();

// ---- API ----

// GET /api/articoli?filter=tutti|non_approvati  (default: non_approvati)
app.get("/api/articoli", async (req, res) => {
  try {
    const filter = (req.query.filter || "non_approvati").toString().toLowerCase();
    const rows = await store.readAll();
    // Map rows to objects
    const data = rows.map((r) => {
      const obj = {};
      HEADERS.forEach((h, i) => (obj[h] = r[i] ?? ""));
      return obj;
    });

    const filtered =
      filter === "tutti"
        ? data
        : data.filter((r) => (r.ottimizzazione_approvata || "").toString().toUpperCase() != "SI");

    res.json(filtered);
  } catch (err) {
    console.error("❌ ERRORE GET /api/articoli:", err);
    res.status(500).json({ error: err.message || "Errore lettura articoli" });
  }
});

// POST /api/articoli/:codice/approva  -> set ottimizzazione_approvata='SI'
app.post("/api/articoli/:codice/approva", async (req, res) => {
  const { codice } = req.params;
  try {
    const updated = await store.markApprovedByCodice(codice);
    if (!updated) return res.status(404).json({ ok: false, error: "Articolo non trovato" });
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ ERRORE approvazione:", err);
    res.status(500).json({ ok: false, error: err.message || "Errore approvazione" });
  }
});

// POST /api/sync  -> placeholder per futura integrazione Bman (scrittura su Sheet)
app.post("/api/sync", async (_req, res) => {
  try {
    res.json({ ok: true, message: "Sync placeholder (Bman non configurato)" });
  } catch (err) {
    console.error("❌ ERRORE /api/sync:", err);
    res.status(500).json({ ok: false, error: err.message || "Errore sync" });
  }
});

// Root -> dashboard
app.get("/", (_req, res) => {
  const filePath = path.join(__dirname, "public", "dashboard.html");
  res.sendFile(filePath);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 SyncFED (Google Sheet) avviato sulla porta ${PORT}`);
});
