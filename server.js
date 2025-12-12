import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import { SheetsStore, ensureHeaders } from "./SheetsStore.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// =======================
// CONFIG
// =======================
const PORT = process.env.PORT || 10000;

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

// =======================
// GOOGLE SHEET INIT
// =======================
let sheetStore;

async function initGoogleSheet() {
  try {
    sheetStore = new SheetsStore({
      clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      privateKey: process.env.GOOGLE_PRIVATE_KEY,
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      sheetName: "foglio1",
    });

    // 🔍 verifica chiave
    await sheetStore.testAuth();

    // 📑 verifica / crea intestazioni
    await ensureHeaders(sheetStore, HEADERS);

    console.log("✅ Google Sheet pronto");
  } catch (err) {
    console.error("❌ Errore inizializzazione Google Sheet:", err.message);
  }
}

// =======================
// ROUTES
// =======================

// Health check
app.get("/test", (req, res) => {
  res.json({ ok: true, service: "SyncFED Google Sheet", time: new Date() });
});

// ✅ TEST SCRITTURA GOOGLE SHEET (GET da browser)
app.get("/api/test-sheet", async (req, res) => {
  try {
    const now = new Date().toISOString();

    const testRow = [
      `TEST-${Date.now()}`,
      "CODICE-TEST",
      "Descrizione IT test",
      "9.99",
      "1",
      "Categoria test",
      "Sottocategoria test",
      "",
      "tag1,tag2",
      "Description FR test",
      "Descripción ES test",
      "Beschreibung DE test",
      "Description EN test",
      now,
    ];

    await sheetStore.sheets.spreadsheets.values.append({
      spreadsheetId: sheetStore.spreadsheetId,
      range: "foglio1!A:N",
      valueInputOption: "RAW",
      requestBody: {
        values: [testRow],
      },
    });

    res.json({
      ok: true,
      message: "Riga di test scritta correttamente",
      data: testRow,
    });
  } catch (err) {
    console.error("❌ Test Sheet error:", err.message);
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

// =======================
// START SERVER
// =======================
app.listen(PORT, async () => {
  console.log(`🚀 SyncFED (Google Sheet) avviato sulla porta ${PORT}`);
  await initGoogleSheet();
});

app.listen(PORT, () => {
  console.log(`🚀 SyncFED (Google Sheet) avviato sulla porta ${PORT}`);
});
