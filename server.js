import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { SheetsStore, ensureHeaders } from "./sheetsStore.js";
import { syncBman } from "./syncfed.js";

dotenv.config();

function requiredEnv(name) {
  if (!process.env[name]) {
    throw new Error(`Variabile ambiente mancante: ${name}`);
  }
  return process.env[name];
}

const app = express();
app.use(cors());
app.use(express.json());

const GOOGLE_SERVICE_ACCOUNT_EMAIL = requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
const GOOGLE_PRIVATE_KEY = requiredEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
const GOOGLE_SHEETS_ID = requiredEnv("GOOGLE_SHEETS_ID");

const store = new SheetsStore({
  clientEmail: GOOGLE_SERVICE_ACCOUNT_EMAIL,
  privateKey: GOOGLE_PRIVATE_KEY,
  spreadsheetId: GOOGLE_SHEETS_ID,
  sheetName: "foglio1",
});

const HEADERS = [
  "id_articolo","codice","descrizione_it","prezzo","quantita","categoria",
  "sottocategoria","ottimizzazione_approvata","tags",
  "descrizione_fr","descrizione_es","descrizione_de","descrizione_en",
  "data_ultimo_aggiornamento"
];

(async () => {
  await store.jwt.authorize();
  console.log("✅ Google Sheet auth OK");
  await ensureHeaders(store, HEADERS);
})();

app.get("/api/test-sheet", async (req, res) => {
  const now = new Date().toISOString();
  await store.sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: "foglio1!A1",
    valueInputOption: "RAW",
    requestBody: { values: [[
      "TEST","TEST-"+Date.now(),"Scrittura OK",0,0,"","",
      "","","","","","",now
    ]]}
  });
  res.json({ ok: true });
});

app.post("/api/sync", async (req, res) => {
  const result = await syncBman(store);
  res.json({ ok: true, result });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 SyncFED avviato su porta ${PORT}`));
