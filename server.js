import express from "express";
import fetch from "node-fetch";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

/* ===============================
   VARIABILI AMBIENTE
================================ */
const ENV = {
  GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID,
  GOOGLE_CLIENT_EMAIL: process.env.GOOGLE_CLIENT_EMAIL,
  GOOGLE_PRIVATE_KEY_BASE64: process.env.GOOGLE_PRIVATE_KEY_BASE64,
  BMAN_BASE_URL: process.env.BMAN_BASE_URL, // es: https://dominio.bman.it:3555
  BMAN_API_KEY: process.env.BMAN_API_KEY,
  BMAN_SCRIPT_FIELD: process.env.BMAN_SCRIPT_FIELD
};

const missing = Object.entries(ENV)
  .filter(([_, v]) => !v)
  .map(([k]) => k);

if (missing.length) {
  console.warn("❌ Variabili ambiente mancanti:", missing.join(", "));
}

/* ===============================
   GOOGLE SHEET (SAFE INIT)
================================ */
let sheets = null;

if (
  ENV.GOOGLE_SHEET_ID &&
  ENV.GOOGLE_CLIENT_EMAIL &&
  ENV.GOOGLE_PRIVATE_KEY_BASE64
) {
  try {
    const auth = new google.auth.JWT(
      ENV.GOOGLE_CLIENT_EMAIL,
      null,
      Buffer.from(ENV.GOOGLE_PRIVATE_KEY_BASE64, "base64")
        .toString("utf8")
        .replace(/\\n/g, "\n"),
      ["https://www.googleapis.com/auth/spreadsheets"]
    );

    sheets = google.sheets({ version: "v4", auth });
    console.log("✅ Google Sheet auth OK");
  } catch (err) {
    console.error("❌ Google Sheet init error:", err.message);
  }
}

/* ===============================
   STEP 2 – IMPORT DA BMAN (URL FIX)
================================ */
app.get("/step2/import-bman", async (req, res) => {
  if (!ENV.BMAN_BASE_URL || !ENV.BMAN_API_KEY || !ENV.BMAN_SCRIPT_FIELD) {
    return res.json({
      ok: false,
      error: "Configurazione Bman incompleta"
    });
  }

  try {
    const filtriJson =
      `[{"chiave":"${ENV.BMAN_SCRIPT_FIELD}","operatore":"=","valore":"si"}]`;

    const soapBody =
`<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getAnagrafiche xmlns="http://tempuri.org/">
      <chiave>${ENV.BMAN_API_KEY}</chiave>
      <filtri><![CDATA[${filtriJson}]]></filtri>
      <ordinamentoCampo>ID</ordinamentoCampo>
      <ordinamentoDirezione>1</ordinamentoDirezione>
      <numeroPagina>1</numeroPagina>
      <listaDepositi><![CDATA[]]></listaDepositi>
      <dettaglioVarianti>false</dettaglioVarianti>
    </getAnagrafiche>
  </soap:Body>
</soap:Envelope>`;

    const response = await fetch(
      `${ENV.BMAN_BASE_URL}/bmanapi.asmx?op=getAnagrafiche`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: "http://tempuri.org/getAnagrafiche"
        },
        body: soapBody
      }
    );

    const text = await response.text();

    if (text.includes("Request format is unrecognized")) {
      throw new Error("Endpoint SOAP errato (manca ?op=)");
    }

    res.json({
      ok: true,
      lunghezzaRisposta: text.length,
      anteprima: text.substring(0, 800)
    });
  } catch (err) {
    console.error("❌ SOAP Bman error:", err.message);
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
   START
================================ */
app.listen(PORT, () => {
  console.log(`🚀 SyncFED avviato sulla porta ${PORT}`);
});
