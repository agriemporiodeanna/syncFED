import express from "express";
import fetch from "node-fetch";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

/* ===============================
   CONTROLLI VARIABILI AMBIENTE
================================ */
const REQUIRED_ENV = [
  "GOOGLE_SHEET_ID",
  "GOOGLE_CLIENT_EMAIL",
  "GOOGLE_PRIVATE_KEY_BASE64",
  "BMAN_BASE_URL",
  "BMAN_API_KEY",
  "BMAN_SCRIPT_FIELD"
];

const missing = REQUIRED_ENV.filter(v => !process.env[v]);
if (missing.length) {
  console.error("❌ Variabili ambiente mancanti:", missing.join(", "));
}

/* ===============================
   GOOGLE SHEET AUTH
================================ */
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  Buffer.from(process.env.GOOGLE_PRIVATE_KEY_BASE64, "base64")
    .toString("utf8")
    .replace(/\\n/g, "\n"),
  ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });

console.log("✅ Google Sheet auth OK");

/* ===============================
   SCHEMA COLONNE (STEP 1)
================================ */
const SHEET_COLUMNS = [
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

/* ===============================
   STEP 1 – CREA / ALLINEA SCHEMA
================================ */
app.get("/step1/schema", async (req, res) => {
  try {
    const range = "A1:ZZ1";
    const current = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range
    });

    const existing = current.data.values?.[0] || [];

    if (JSON.stringify(existing) === JSON.stringify(SHEET_COLUMNS)) {
      return res.json({ ok: true, azione: "none", colonne: existing });
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "A1",
      valueInputOption: "RAW",
      requestBody: {
        values: [SHEET_COLUMNS]
      }
    });

    res.json({ ok: true, azione: "create", colonne: SHEET_COLUMNS });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

/* ===============================
   STEP 2 – IMPORT DA BMAN
================================ */
app.get("/step2/import-bman", async (req, res) => {
  try {
    const filtri = [
      {
        chiave: process.env.BMAN_SCRIPT_FIELD, // es: opzionale11
        operatore: "=",
        valore: "si"
      }
    ];

    const soapBody = `
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getAnagrafiche xmlns="http://tempuri.org/">
      <chiave>${process.env.BMAN_API_KEY}</chiave>
      <filtri><![CDATA[
        ${JSON.stringify(filtri)}
      ]]></filtri>
      <ordinamentoCampo>ID</ordinamentoCampo>
      <ordinamentoDirezione>1</ordinamentoDirezione>
      <numeroPagina>1</numeroPagina>
      <listaDepositi><![CDATA[]]></listaDepositi>
      <dettaglioVarianti>false</dettaglioVarianti>
    </getAnagrafiche>
  </soap:Body>
</soap:Envelope>
`;

    const response = await fetch(
      `${process.env.BMAN_BASE_URL}/bmanapi.asmx`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "SOAPAction": "http://tempuri.org/getAnagrafiche"
        },
        body: soapBody
      }
    );

    const text = await response.text();

    res.json({
      ok: true,
      rawLength: text.length,
      preview: text.substring(0, 500)
    });

  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

/* ===============================
   ROOT
================================ */
app.get("/", (req, res) => {
  res.send("✅ SyncFED Google Sheet attivo");
});

/* ===============================
   START SERVER
================================ */
app.listen(PORT, () => {
  console.log(`🚀 SyncFED avviato sulla porta ${PORT}`);
});
