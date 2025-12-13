import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { google } from "googleapis";
import { parseStringPromise } from "xml2js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

// =====================
// ENV CHECK
// =====================
const REQUIRED_ENV = [
  "GOOGLE_SERVICE_ACCOUNT_BASE64",
  "GOOGLE_SHEETS_ID",
  "BMAN_BASE_URL",
  "BMAN_API_KEY",
  "BMAN_SCRIPT_FIELD"
];

const missing = REQUIRED_ENV.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error("❌ Variabili ambiente mancanti:", missing.join(", "));
}

// =====================
// GOOGLE SHEET AUTH
// =====================
let sheets;
try {
  const credentials = JSON.parse(
    Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8")
  );

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  sheets = google.sheets({ version: "v4", auth });
  console.log("✅ Google Sheet auth OK");
} catch (err) {
  console.error("❌ Google auth error:", err.message);
}

// =====================
// SOAP BUILDER
// =====================
function buildGetAnagraficheSOAP() {
  return `
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getAnagrafiche xmlns="http://tempuri.org/">
      <chiave>${process.env.BMAN_API_KEY}</chiave>
      <filtri>
        <Filtro>
          <chiave>${process.env.BMAN_SCRIPT_FIELD}</chiave>
          <operatore>=</operatore>
          <valore>SI</valore>
        </Filtro>
      </filtri>
      <ordinamentoCampo>ID</ordinamentoCampo>
      <ordinamentoDirezione>1</ordinamentoDirezione>
      <numeroPagina>1</numeroPagina>
      <listaDepositi></listaDepositi>
      <dettaglioVarianti>false</dettaglioVarianti>
    </getAnagrafiche>
  </soap:Body>
</soap:Envelope>`;
}

// =====================
// STEP 2 – SOAP CALL BMAN
// =====================
app.get("/step2/import-bman", async (req, res) => {
  try {
    const soapXML = buildGetAnagraficheSOAP();

    const response = await fetch(
      `${process.env.BMAN_BASE_URL}/getAnagrafiche`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "SOAPAction": "http://tempuri.org/getAnagrafiche"
        },
        body: soapXML
      }
    );

    const xml = await response.text();

    const parsed = await parseStringPromise(xml, { explicitArray: false });

    const result =
      parsed["soap:Envelope"]["soap:Body"]["getAnagraficheResponse"]["getAnagraficheResult"];

    // ⚠️ Bman restituisce JSON *dentro* XML
    const data = JSON.parse(result);

    res.json({
      ok: true,
      prodottiRicevuti: data.length,
      esempio: data[0] || null
    });

  } catch (err) {
    console.error("❌ SOAP Bman error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// =====================
// ROOT
// =====================
app.get("/", (req, res) => {
  res.send("✅ SyncFED attivo (Bman SOAP)");
});

// =====================
// START
// =====================
app.listen(PORT, () => {
  console.log(`🚀 SyncFED avviato sulla porta ${PORT}`);
});

