import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { SheetsStore, ensureHeaders } from "./sheetsStore.js";

dotenv.config();

function requireEnv(name) {
  if (!process.env[name]) {
    throw new Error(`Variabile ambiente mancante: ${name}`);
  }
  return process.env[name];
}

// 🔐 ENV obbligatorie
const GOOGLE_SERVICE_ACCOUNT_EMAIL = requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
const GOOGLE_PRIVATE_KEY = requireEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
const GOOGLE_SHEETS_ID = requireEnv("GOOGLE_SHEETS_ID");

// 📄 Colonne definitive
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
  "data_ultimo_aggiornamento"
];

let store;

async function initSheets() {
  store = new SheetsStore({
    clientEmail: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: GOOGLE_PRIVATE_KEY,
    spreadsheetId: GOOGLE_SHEETS_ID,
    sheetName: "foglio1"
  });

  // 🔎 test auth
  await store.jwt.authorize();
  console.log("✅ Google Sheet auth OK");

  await ensureHeaders(store, HEADERS);
  console.log("✅ Foglio Google pronto");
}

const app = express();
app.use(cors());
app.use(express.json());

// health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "SyncFED Google Sheet" });
});

// ✅ test scrittura da browser
app.get("/api/test-sheet", async (req, res) => {
  try {
    const now = new Date().toISOString();
    await store.sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range: "foglio1!A:Z",
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          Date.now(),
          "TEST-CODICE",
          "Prodotto di test",
          "9.99",
          "1",
          "Test",
          "Test",
          "",
          "test",
          "",
          "",
          "",
          "",
          now
        ]]
      }
    });

    res.json({ ok: true, message: "Riga di test scritta correttamente" });
  } catch (err) {
    console.error("❌ Test Sheet error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 🚀 Avvio server
const PORT = process.env.PORT || 10000;

initSheets()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 SyncFED avviato su porta ${PORT}`);
    });
  })
  .catch(err => {
    console.error("❌ Errore inizializzazione:", err.message);
    process.exit(1);
  });
