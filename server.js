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
// GOOGLE SHEET SETUP (BASE64 + GoogleAuth SAFE)
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
// SCHEMA COLONNE (STEP 1)
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
// STEP 1 – ALLINEAMENTO SCHEMA
// =====================
app.get("/step1/schema", async (req, res) => {
  try {
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    const range = "PRODOTTI_BMAN!1:1";

    const read = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const headersAttuali = read.data.values
      ? read.data.values[0]
      : [];

    if (headersAttuali.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: "RAW",
        requestBody: { values: [CAMPI_BMAN] },
      });

      return res.json({ ok: true, azione: "create", colonne: CAMPI_BMAN });
    }

    const mancanti = CAMPI_BMAN.filter(c => !headersAttuali.includes(c));

    if (mancanti.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: "RAW",
        requestBody: { values: [[...headersAttuali, ...mancanti]] },
      });

      return res.json({ ok: true, azione: "update", aggiunte: mancanti });
    }

    return res.json({ ok: true, azione: "none" });

  } catch (err) {
    console.error("❌ STEP 1 error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================
// STEP 2 – IMPORT DA BMAN
// =====================
app.get("/step2/import-bman", async (req, res) => {
  try {
    const response = await fetch("https://api.bman.it/prodotti", {
      headers: {
        "x-api-key": process.env.BMAN_API_KEY,
        "Content-Type": "application/json"
      }
    });

    const prodotti = await response.json();
    const daImportare = prodotti.filter(p => p.script === "SI");

    if (daImportare.length === 0) {
      return res.json({ ok: true, message: "Nessun prodotto Script = SI" });
    }

    const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    const sheetName = "PRODOTTI_BMAN";

    const read = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A2:ZZ`,
    });

    const rows = read.data.values || [];
    const idxCodice = CAMPI_BMAN.indexOf("Codice");

    const index = {};
    rows.forEach((r, i) => {
      if (r[idxCodice]) index[r[idxCodice]] = i + 2;
    });

    const now = new Date().toISOString();
    const updates = [];
    const appends = [];

    for (const p of daImportare) {
      const row = CAMPI_BMAN.map(c => {
        switch (c) {
          case "Codice": return p.codice;
          case "Tipo": return p.tipo;
          case "TipoCodice": return p.tipo_codice;
          case "Categoria1": return p.categoria_1;
          case "Categoria2": return p.categoria_2;
          case "Brand": return p.brand;
          case "Titolo": return p.titolo;
          case "Script": return p.script;
          case "Tag": return (p.tag || []).join(",");
          case "DescrizioneIT": return p.descrizione?.it || "";
          case "DescrizioneFR": return p.descrizione?.fr || "";
          case "DescrizioneEN": return p.descrizione?.en || "";
          case "DescrizioneES": return p.descrizione?.es || "";
          case "DescrizioneDE": return p.descrizione?.de || "";
          case "DescrizioneHTML": return p.descrizione_html || "";
          case "Immagine1": return p.immagini?.[0] || "";
          case "Immagine2": return p.immagini?.[1] || "";
          case "Immagine3": return p.immagini?.[2] || "";
          case "Immagine4": return p.immagini?.[3] || "";
          case "Immagine5": return p.immagini?.[4] || "";
          case "Stato": return "In lavorazione";
          case "UltimoSync": return now;
          default: return "";
        }
      });

      if (index[p.codice]) {
        updates.push({
          range: `${sheetName}!A${index[p.codice]}:ZZ${index[p.codice]}`,
          values: [row]
        });
      } else {
        appends.push(row);
      }
    }

    for (const u of updates) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: u.range,
        valueInputOption: "RAW",
        requestBody: { values: u.values }
      });
    }

    if (appends.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: appends }
      });
    }

    res.json({
      ok: true,
      importati: daImportare.length,
      aggiornati: updates.length,
      nuovi: appends.length
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
  console.log(`🚀 SyncFED (Google Sheet) avviato sulla porta ${PORT}`);
});

  console.log(`🚀 SyncFED (Google Sheet) avviato sulla porta ${PORT}`);
});

