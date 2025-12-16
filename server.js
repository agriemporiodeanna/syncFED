import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import xml2js from 'xml2js';
import { google } from 'googleapis';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 10000;

/* =========================================================
   CONFIGURAZIONE BMAN (SOAP)
   ========================================================= */

const BMAN_ENDPOINT = 'https://emporiodeanna.bman.it/bmanapi.asmx';
const BMAN_CHIAVE = process.env.BMAN_API_KEY || '';

if (!BMAN_CHIAVE) {
  console.error('❌ Variabile ambiente mancante: BMAN_API_KEY');
}

/* =========================================================
   NORMALIZZAZIONE
   ========================================================= */

function normalizeValue(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/* =========================================================
   HELPERS SOAP
   ========================================================= */

async function soapCall({ action, bodyXml }) {
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

async function parseSoapJsonResult(xml, responseTag, resultTag) {
  const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
  const result =
    parsed?.['soap:Envelope']?.['soap:Body']?.[responseTag]?.[resultTag];

  if (typeof result === 'string') {
    try {
      return JSON.parse(result || '[]');
    } catch {
      return [];
    }
  }
  return Array.isArray(result) ? result : [];
}

/* =========================================================
   BMAN: getAnagraficheV4
   ========================================================= */

async function getAnagraficheV4({
  numeroPagina = 1,
  listaDepositi = [],
  dettaglioVarianti = false,
  ordinamentoCampo = 'ID',
  ordinamentoDirezione = 1,
  filtri = [],
} = {}) {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getAnagraficheV4 xmlns="http://cloud.bman.it/">
      <chiave>${BMAN_CHIAVE}</chiave>
      <filtri><![CDATA[${JSON.stringify(filtri)}]]></filtri>
      <ordinamentoCampo>${ordinamentoCampo}</ordinamentoCampo>
      <ordinamentoDirezione>${ordinamentoDirezione}</ordinamentoDirezione>
      <numeroPagina>${numeroPagina}</numeroPagina>
      <listaDepositi><![CDATA[${JSON.stringify(listaDepositi)}]]></listaDepositi>
      <dettaglioVarianti>${dettaglioVarianti}</dettaglioVarianti>
    </getAnagraficheV4>
  </soap:Body>
</soap:Envelope>`.trim();

  const xml = await soapCall({
    action: 'http://cloud.bman.it/getAnagraficheV4',
    bodyXml: soapBody,
  });

  return parseSoapJsonResult(xml, 'getAnagraficheV4Response', 'getAnagraficheV4Result');
}

/* =========================================================
   GOOGLE SHEETS
   ========================================================= */

function getGoogleCredentials() {
  const required = ['GOOGLE_SHEET_ID', 'GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY_BASE64'];
  const missing = required.filter((k) => !process.env[k]);

  if (missing.length) {
    const err = new Error(`Variabili ambiente mancanti: ${missing.join(', ')}`);
    err.code = 'MISSING_ENV';
    throw err;
  }

  const privateKey = Buffer.from(
    process.env.GOOGLE_PRIVATE_KEY_BASE64,
    'base64'
  )
    .toString('utf8')
    .replace(/\\n/g, '\n');

  return {
    sheetId: process.env.GOOGLE_SHEET_ID,
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
    privateKey,
  };
}

async function getSheetsClient() {
  const creds = getGoogleCredentials();

  const auth = new google.auth.JWT({
    email: creds.clientEmail,
    key: creds.privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  await auth.authorize();
  return { sheets: google.sheets({ version: 'v4', auth }), sheetId: creds.sheetId };
}

/* =========================================================
   MAPPATURA SHEET
   ========================================================= */

const SHEET_HEADERS = [
  'ID',
  'Codice',
  'Titolo',
  'Tag',
  'DescrizioneHTML',
  'Immagine1',
  'Immagine2',
  'Immagine3',
  'Immagine4',
  'Immagine5',
  'Script',
];

function toRowFromAnagrafica(a) {
  const fotos = Array.isArray(a?.arrFoto) ? a.arrFoto : [];
  return [
    a?.ID ?? '',
    a?.codice ?? '',
    a?.opzionale2 ?? '',
    a?.tags ?? '',
    a?.descrizioneHtml ?? '',
    fotos[0] ?? '',
    fotos[1] ?? '',
    fotos[2] ?? '',
    fotos[3] ?? '',
    fotos[4] ?? '',
    a?.opzionale11 ?? '',
  ];
}

/* =========================================================
   API
   ========================================================= */

app.get('/', (req, res) => {
  res.send('🚀 SyncFED attivo – Bman SOAP + Google Sheet');
});

app.get('/api/step3/export-sheet', async (req, res) => {
  try {
    const articoli = await getAnagraficheV4();
    const filtrati = articoli.filter((a) => normalizeValue(a?.opzionale11) === 'si');
    const rows = filtrati.map(toRowFromAnagrafica);

    const { sheets, sheetId } = await getSheetsClient();
    const range = 'Sheet1!A1';

    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: 'Sheet1',
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: {
        values: [SHEET_HEADERS, ...rows],
      },
    });

    res.json({
      ok: true,
      totale: rows.length,
    });
  } catch (err) {
    console.error('❌ STEP 3:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   START SERVER
   ========================================================= */

app.listen(PORT, () => {
  console.log(`🚀 SyncFED avviato sulla porta ${PORT}`);
  if (BMAN_CHIAVE) console.log('✅ BMAN_API_KEY presente');

  const missingGoogle = ['GOOGLE_SHEET_ID', 'GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY_BASE64']
    .filter((k) => !process.env[k]);

  if (missingGoogle.length) {
    console.log(`ℹ️ Google Sheet non configurato: mancano ${missingGoogle.join(', ')}`);
  } else {
    console.log('✅ Google Sheet env presenti');
  }
});
