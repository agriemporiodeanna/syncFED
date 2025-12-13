import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

// =====================
// VALIDAZIONE ENV
// =====================
const REQUIRED_ENV = [
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "GOOGLE_SHEETS_ID",
];

const missing = REQUIRED_ENV.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error("❌ Variabili ambiente mancanti:", missing.join(", "));
}

// =====================
// GOOGLE SHEET SETUP
// =====================
let sheets;

try {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  sheets = google.sheets({ version: "v4", auth });
  console.log("✅ Google Sheet auth OK");
} catch (err) {
  console.error("❌ Errore inizializzazione Google Sheet:", err.message);
}

// =====================
// STEP 1 – SCHEMA COLONNE
// =====================
const CAMPI_BMAN = [
  "Tipo",
  "Codice",
  "TipoCodice",
  "Categoria1",
  "Categoria2",
  "Brand",
  "Titolo",
  "Etichetta",
  "Vintage",
  "Script",
  "Magazzino",
  "Tag",
  "DescrizioneIT",
  "DescrizioneFR",
  "DescrizioneEN",
  "DescrizioneES",
  "DescrizioneDE",
  "DescrizioneHTML",
  "ImmaginePrincipale",
  "ImmaginiExtra",
  "AltezzaCM",
  "LarghezzaCM",
  "ProfonditaCM",
  "PesoKG",
  "UnitaMisura",
  "Sottoscorta",
  "RiordinoMinimo",
  "Stato",
  "UltimoSync"
];

// =====================
// STEP 1 – ENDPOINT BROWSER
// =====================
app.get("/step1/schema", async (req, res) => {
  try {
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    const range = "PRODOTTI_BMAN!1:1";

    // Legge intestazioni attuali
    const read = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const headersAttuali = read.data.values
      ? read.data.values[0]
      : [];

    // Caso: foglio vuoto
    if (headersAttuali.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: "RAW",
        requestBody: {
          values: [CAMPI_BMAN],
        },
      });

      return res.json({
        ok: true,
        azione: "create",
        colonne: CAMPI_BMAN,
      });
    }

    // Colonne mancanti
    const mancanti = CAMPI_BMAN.filter(
      c => !headersAttuali.includes(c)
    );

    if (mancanti.length > 0) {
      const nuove = [...headersAttuali, ...mancanti];

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: "RAW",
        requestBody: {
          values: [nuove],
        },
      });

      return res.json({
        ok: true,
        azione: "update",
        aggiunte: mancanti,
      });
    }

    // Già allineato
    return res.json({
      ok: true,
      azione: "none",
      message: "Intestazioni già allineate",
    });

  } catch (err) {
    console.error("❌ STEP 1 schema error:", err.message);
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

// =====================
// GET TEST (browser)
// =====================
app.get("/api/test-sheet", async (req, res) => {
  try {
    const now = new Date().toISOString();

    const row = [
      "TEST-GET",
      "ARTICOLO TEST GET",
      "Descrizione IT via GET",
      5.99,
      1,
      "Categoria Test",
      "Sottocategoria Test",
      "",
      "test,get",
      "Description FR GET",
      "Description ES GET",
      "Description DE GET",
      "Description EN GET",
      now
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: "Foglio1!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [row],
      },
    });

    res.json({
      ok: true,
      message: "Riga di test GET scritta su Google Sheet",
    });
  } catch (err) {
    console.error("❌ GET test-sheet error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================
// POST TEST (programmatico)
// =====================
app.post("/api/test-sheet", async (req, res) => {
  try {
    const now = new Date().toISOString();

    const row = [
      "TEST-POST",
      "ARTICOLO TEST POST",
      "Descrizione IT via POST",
      9.99,
      1,
      "Categoria Test",
      "Sottocategoria Test",
      "",
      "test,post",
      "Description FR POST",
      "Description ES POST",
      "Description DE POST",
      "Description EN POST",
      now
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: "Foglio1!A1",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [row],
      },
    });

    res.json({
      ok: true,
      message: "Riga di test POST scritta su Google Sheet",
    });
  } catch (err) {
    console.error("❌ POST test-sheet error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================
// ROOT
// =====================
app.get("/", (req, res) => {
  res.send("✅ SyncFED Google Sheet attivo");
});

// =====================
// START SERVER
// =====================
app.listen(PORT, () => {
  console.log(`🚀 SyncFED (Google Sheet) avviato sulla porta ${PORT}`);
});
