console.log('NODE VERSION =', process.version);
console.log('OPENSSL VERSION =', process.versions.openssl);
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import xml2js from 'xml2js';
import fetch from 'node-fetch';
import { google } from 'googleapis';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

/* =========================================================
   LOG DI AVVIO
   ========================================================= */
console.log('NODE VERSION =', process.version);
console.log('OPENSSL VERSION =', process.versions.openssl);

/* =========================================================
   CONFIGURAZIONE BMAN
   ========================================================= */
const BMAN_ENDPOINT = 'https://emporiodeanna.bman.it/bmanapi.asmx';
const BMAN_CHIAVE = process.env.BMAN_API_KEY || '';

if (!BMAN_CHIAVE) {
  console.error('❌ BMAN_API_KEY mancante');
}

/* =========================================================
   NORMALIZZAZIONE
   ========================================================= */
function normalize(value) {
  if (!value) return '';
  return String(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/* =========================================================
   SOAP HELPER
   ========================================================= */
async function soapCall(action, body) {
  const res = await fetch(BMAN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: action,
    },
    body,
  });
  return res.text();
}

async function parseSoapResult(xml, responseTag, resultTag) {
  const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
  const result =
    parsed?.['soap:Envelope']?.['soap:Body']?.[responseTag]?.[resultTag];
  try {
    return JSON.parse(result || '[]');
  } catch {
    return [];
  }
}

/* =========================================================
   BMAN – getAnagrafiche (VERSIONE STABILE)
   ========================================================= */
async function getAnagrafiche() {
  const filtri = JSON.stringify([]);
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getAnagrafiche xmlns="http://cloud.bman.it/">
      <chiave>${BMAN_CHIAVE}</chiave>
      <filtri><![CDATA[${filtri}]]></filtri>
      <ordinamentoCampo>ID</ordinamentoCampo>
      <ordinamentoDirezione>1</ordinamentoDirezione>
      <numeroPagina>1</numeroPagina>
      <listaDepositi><![CDATA[]]></listaDepositi>
      <dettaglioVarianti>false</dettaglioVarianti>
    </getAnagrafiche>
  </soap:Body>
</soap:Envelope>`;

  const xml = await soapCall(
    'http://cloud.bman.it/getAnagrafiche',
    soapBody
  );

  return parseSoapResult(
    xml,
    'getAnagraficheResponse',
    'getAnagraficheResult'
  );
}

/* =========================================================
   STEP 2 – Script = SI (FUNZIONANTE)
   ========================================================= */
app.get('/api/step2/script-si', async (req, res) => {
  try {
    const articoli = await getAnagrafiche();

    const filtrati = articoli.filter(
      (a) => normalize(a?.opzionale11) === 'si'
    );

    console.log(
      `STEP2 → Totali: ${articoli.length} | Script=SI: ${filtrati.length}`
    );

    res.json({
      ok: true,
      step: 'STEP 2 – Script = SI',
      totale: filtrati.length,
      articoli: filtrati,
    });
  } catch (err) {
    console.error('❌ STEP 2 ERROR', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   GOOGLE SHEET – SETUP
   ========================================================= */
function getGoogleConfig() {
  const {
    GOOGLE_SHEET_ID,
    GOOGLE_CLIENT_EMAIL,
    GOOGLE_PRIVATE_KEY_BASE64,
  } = process.env;

  if (!GOOGLE_SHEET_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY_BASE64) {
    return null;
  }

  const privateKey = Buffer.from(
    GOOGLE_PRIVATE_KEY_BASE64,
    'base64'
  ).toString('utf8').replace(/\\n/g, '\n');

  return {
    sheetId: GOOGLE_SHEET_ID,
    clientEmail: GOOGLE_CLIENT_EMAIL,
    privateKey,
  };
}

async function getSheetsClient() {
  const cfg = getGoogleConfig();
  if (!cfg) throw new Error('Google Sheet non configurato');

  const auth = new google.auth.JWT({
    email: cfg.clientEmail,
    key: cfg.privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  await auth.authorize();

  return {
    sheets: google.sheets({ version: 'v4', auth }),
    sheetId: cfg.sheetId,
  };
}

/* =========================================================
   STEP 3 – SCRITTURA GOOGLE SHEET
   ========================================================= */
app.get('/api/step3/export-sheet', async (req, res) => {
  try {
    const articoli = await getAnagrafiche();
    const filtrati = articoli.filter(
      (a) => normalize(a?.opzionale11) === 'si'
    );

    const rows = filtrati.map((a) => [
      a?.ID || '',
      a?.codice || '',
      a?.opzionale2 || '',
      a?.opzionale11 || '',
    ]);

    const headers = ['ID', 'Codice', 'Titolo', 'Script'];

    const { sheets, sheetId } = await getSheetsClient();
    const sheetName = 'Sheet1';

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${sheetName}!1:1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });

    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: `${sheetName}!2:1000`,
    });

    if (rows.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${sheetName}!2`,
        valueInputOption: 'RAW',
        requestBody: { values: rows },
      });
    }

    res.json({
      ok: true,
      step: 'STEP 3 – Google Sheet',
      scritti: rows.length,
    });
  } catch (err) {
    console.error('❌ STEP 3 ERROR', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   ROOT
   ========================================================= */
app.get('/', (req, res) => {
  res.send('🚀 SyncFED attivo – STEP 2 OK – STEP 3 pronto');
});

/* =========================================================
   START
   ========================================================= */
app.listen(PORT, () => {
  console.log(`🚀 SyncFED avviato sulla porta ${PORT}`);
});
