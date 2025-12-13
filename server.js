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
  "GOOGLE_SERVICE_ACCOUNT_BASE64",
  "GOOGLE_SHEETS_ID",
  "BMAN_API_KEY"
];

const missing = REQUIRED_ENV.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error("❌ Variabili ambiente mancanti:", missing.join(", "));
}

// =====================
// GOOGLE SHEET SETUP (BASE64 + GoogleAuth)
// =====================
let sheets;

try {
  const credentials = JSON.parse(
    Buffer.from(
      process.env.GOOGLE_SERVICE_ACCOUNT_BASE64,
      "base64"
    ).toString("utf8")
  );

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  sheets = google.sheets({ version: "v4", auth });
  console.log("✅ Google Sheet auth OK (BASE64 + GoogleAuth)");
} catch (err) {
  console.error("❌ Errore inizializzazione Google Sheet:", err.message);
}

// =====================
// SCHEMA COLONNE
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
  "Immagine1",
  "Immagine2",
  "Immagine3",
  "Immagine4",
  "Immagine5",
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
// STEP 1 – SCHEMA
// =====================
app.get("/step1/schema", async (req, res) => {
  try {
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    const range = "PRODOTTI_BMAN!1:1";

    const read = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const headers = read.data.values ? read.data.values[0] : [];

    if (headers.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: "RAW",
        requestBody: { values: [CAMPI_BMAN] }
      });

      return res.json({ ok: true, azione: "create" });
    }

    const mancanti = CAMPI_BMAN.filter(c => !headers.includes(c));

    if (mancanti.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: "RAW",
        requestBody: { values: [[...headers, ...mancanti]] }
      });

      return res.json({ ok: true, azione: "update", aggiunte: mancanti });
    }

    res.json({ ok: true, azione: "none" });

  } catch (err) {
    console.error("❌ STEP 1 error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================
// STEP 2 – IMPORT BMAN (ROBUSTO)
// =====================
app.get("/step2/import-bman", async (req, res) => {
  try {
    const response = await fetch("https://api.bman.it/prodotti", {
      headers: {
        "x-api-key": process.env.BMAN_API_KEY,
        "Accept": "application/json"
      }
    });

    const bodyText = await response.text();

    if (!response.ok) {
      console.error("❌ Bman HTTP error:", response.status);
      console.error(bodyText.substring(0, 300));
      return res.status(500).json({
        ok: false,
        error: `Errore Bman HTTP ${response.status}`
      });
    }

    let prodotti;
    try {
      prodotti = JSON.parse(bodyText);
    } catch (e) {
      console.error("❌ Bman NON restituisce JSON");
      console.error(bodyText.substring(0, 300));
      return res.status(500).json({
        ok: false,
        error: "Risposta Bman non in formato JSON"
      });
    }

    const daImportare = prodotti.filter(p => p.script === "SI");

    // ⚠️ Per ora ci fermiamo qui (solo test lettura)
    return res.json({
      ok: true,
      prodottiTotali: prodotti.length,
      scriptSI: daImportare.length
    });

  } catch (err) {
    console.error("❌ STEP 2 error:", err.message);
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
  console.log(`🚀 SyncFED avviato sulla porta ${PORT}`);
});

