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
  if (value === null || value === undefined) return '';
  return String(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/* =========================================================
   SOAP HELPERS
   ========================================================= */

async function soapCall(action, bodyXml) {
  const response = await fetch(BMAN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: action,
    },
    body: bodyXml,
  });

  return response.text();
}

async function parseSoapJson(xml, responseTag, resultTag) {
  const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
  const result =
    parsed?.['soap:Envelope']?.['soap:Body']?.[responseTag]?.[resultTag];

  if (!result) return [];
  if (typeof result === 'string') return JSON.parse(result);
  return result;
}

/* =========================================================
   BMAN – getAnagrafiche (STANDARD)
   ========================================================= */

async function getAnagrafiche({
  pagina = 1,
  depositi = [],
  filtri = [],
} = {}) {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getAnagrafiche xmlns="http://cloud.bman.it/">
      <chiave>${BMAN_CHIAVE}</chiave>
      <filtri><![CDATA[${JSON.stringify(filtri)}]]></filtri>
      <ordinamentoCampo>ID</ordinamentoCampo>
      <ordinamentoDirezione>1</ordinamentoDirezione>
      <numeroPagina>${pagina}</numeroPagina>
      <listaDepositi><![CDATA[${JSON.stringify(depositi)}]]></listaDepositi>
      <dettaglioVarianti>false</dettaglioVarianti>
    </getAnagrafiche>
  </soap:Body>
</soap:Envelope>`.trim();

  const xml = await soapCall(
    'http://cloud.bman.it/getAnagrafiche',
    soapBody
  );

  return parseSoapJson(
    xml,
    'getAnagraficheResponse',
    'getAnagraficheResult'
  );
}

/* =========================================================
   GOOGLE SHEETS
   ========================================================= */

function getGoogleClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

/* =========================================================
   API – STEP 2 (Script = SI)
   ========================================================= */

app.get('/api/step2/script-si', async (req, res) => {
  try {
    const articoli = await getAnagrafiche();

    const filtrati = articoli.filter(
      (a) => normalize(a?.opzionale11) === 'si'
    );

    res.json({
      ok: true,
      totale: filtrati.length,
      articoli: filtrati,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   API – STEP 3 (TEST Google Sheet)
   ========================================================= */

app.get('/api/step3/export-sheet', async (req, res) => {
  try {
    const sheets = getGoogleClient();
    const sheetId = process.env.GOOGLE_SHEET_ID;

    const headers = ['TEST', 'DATA', 'NOTE'];
    const rows = [
      ['OK', new Date().toISOString(), 'Scrittura di test riuscita'],
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Sheet1!A1',
      valueInputOption: 'RAW',
      requestBody: { values: [headers, ...rows] },
    });

    res.json({
      ok: true,
      message: 'Scrittura di TEST su Google Sheet completata',
    });
  } catch (err) {
    console.error('❌ Google Sheet error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   HEALTH CHECK
   ========================================================= */

app.get('/', (req, res) => {
  res.send('🚀 SyncFED attivo – getAnagrafiche + Google Sheet TEST');
});

/* =========================================================
   START SERVER
   ========================================================= */

app.listen(PORT, () => {
  console.log(`🚀 SyncFED avviato sulla porta ${PORT}`);
});
