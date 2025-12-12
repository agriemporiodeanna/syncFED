import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import { SheetsStore, ensureHeaders } from "./sheetsStore.js";

dotenv.config();

/* =========================
   PATH SETUP
========================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================
   EXPRESS APP
========================= */
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   ENV CHECK
========================= */
const REQUIRED_ENV = [
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "GOOGLE_SHEETS_ID",
];

for (const v of REQUIRED_ENV) {
  if (!process.env[v]) {
    console.error(`❌ Variabile ambiente mancante: ${v}`);
    process.exit(1);
  }
}

/* =========================
   GOOGLE SHEET SETUP
========================= */
const HEADERS = [
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

const sheetStore = new SheetsStore({
  clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  privateKey: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  spreadsheetId: process.env.GOOGLE_SHEETS_ID,
  sheetName: "foglio1",
});

async function initGoogleSheet() {
  await ensureHeaders(sheetStore, HEADERS);
  console.log("✅ Google Sheet pronto e verificato");
}

/* =========================
   ROUTES
========================= */

// Health check
app.get("/test", (req, res) => {
  res.json({ ok: true, service: "SyncFED Google Sheet" });
});

// ✅ TEST SCRITTURA GOOGLE SHEET (GET, da browser)
app.get("/api/test-sheet", async (req, res) => {
  try {
    const now = new Date().toISOString();

    await sheetStore.sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: "foglio1!A:Z",
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          "TEST",
          "CODICE_TEST",
          "Descrizione di prova",
          "9.99",
          "1",
          "Categoria",
          "Sottocategoria",
          "",
          "test,google,syncfed",
          "FR test",
          "ES test",
          "DE test",
          "EN test",
          now,
        ]],
      },
    });

    res.json({ ok: true, message: "Riga di test scritta su Google Sheet" });
  } catch (err) {
    console.error("❌ Errore test sheet:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================
   SERVER START (RENDER SAFE)
========================= */
const PORT = process.env.PORT || 10000;

async function startServer() {
  try {
    await initGoogleSheet();

    const server = app.listen(PORT, () => {
      console.log(`🚀 SyncFED (Google Sheet) avviato sulla porta ${PORT}`);
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error("❌ Porta già in uso (Render restart in corso)");
      } else {
        console.error("❌ Errore server:", err.message);
      }
      process.exit(1);
    });
  } catch (err) {
    console.error("❌ Errore inizializzazione:", err.message);
    process.exit(1);
  }
}

startServer();
