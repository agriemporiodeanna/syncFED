console.log('NODE_OPTIONS =', process.env.NODE_OPTIONS);
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
   CONFIGURAZIONE BMAN
   ========================================================= */

const BMAN_ENDPOINT = 'https://emporiodeanna.bman.it/bmanapi.asmx';
const BMAN_CHIAVE = process.env.BMAN_API_KEY || '';

if (!BMAN_CHIAVE) {
  console.error('❌ Variabile ambiente mancante: BMAN_API_KEY');
}

/* =========================================================
   NORMALIZZAZIONE
   ========================================================= */

function normalizeValue(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/* =========================================================
   SOAP HELPERS
   ========================================================= */

async function soapCall(action, bodyXml) {
  const res = await fetch(BMAN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: action,
    },
    body: bodyXml,
  });
  return await res.text();
}

async function parseSoapJson(xml, responseTag, resultTag) {
  const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
  const raw =
    parsed?.['soap:Envelope']?.['soap:Body']?.[responseTag]?.[resultTag];

  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/* =========================================================
   BMAN – getAnagrafiche (FILTRO SCRIPT = SI)
   ========================================================= */

async function getAnagrafiche({ numeroPagina = 1, listaDepositi = [] } = {}) {
  const filtri = [
    {
      chiave: 'opzionale11',
      operatore: '=',
      valore: 'SI',
    },
  ];

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
      <numeroPagina>${numeroPagina}</numeroPagina>
      <listaDepositi><![CDATA[${JSON.stringify(listaDepositi)}]]></listaDepositi>
      <dettaglioVarianti>false</dettaglioVarianti>
    </getAnagrafiche>
  </soap:Body>
</soap:Envelope>`.trim();

  const xml = await soapCall(
    'http://cloud.bman.it/getAnagrafiche',
    soapBody
  );

  return await parseSoapJson(
    xml,
    'getAnagraficheResponse',
    'getAnagraficheResult'
  );
}

/* =========================================================
   GOOGLE SHEETS
   ========================================================= */

function getGoogleCreds() {
  const missing = ['GOOGLE_SHEET_ID', 'GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY_BASE64']
    .filter(k => !process.env[k]);

  if (missing.length) {
    throw new Error(`Variabili ambiente mancanti: ${missing.join(', ')}`);
  }

  let privateKey = Buffer
    .from(process.env.GOOGLE_PRIVATE_KEY_BASE64, 'base64')
    .toString('utf8')
    .replace(/\\n/g, '\n')
    .trim();

  return {
    sheetId: process.env.GOOGLE_SHEET_ID,
    clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
    privateKey,
  };
}

async function getSheetsClient() {
  const { clientEmail, privateKey, sheetId } = getGoogleCreds();

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  await auth.authorize();
  return { sheets: google.sheets({ version: 'v4', auth }), sheetId };
}

/* =========================================================
   MAPPATURA GOOGLE SHEET
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

function toRow(a) {
  const foto = Array.isArray(a.arrFoto) ? a.arrFoto : [];
  return [
    a.ID ?? '',
    a.codice ?? '',
    a.opzionale2 ?? '',
    a.tag ?? '',
    a.descrizioneHtml ?? '',
    foto[0] ?? '',
    foto[1] ?? '',
    foto[2] ?? '',
    foto[3] ?? '',
    foto[4] ?? '',
    a.opzionale11 ?? '',
  ];
}

/* =========================================================
   API
   ========================================================= */

app.get('/', (req, res) => {
  res.send('🚀 SyncFED attivo – STEP 2 + STEP 3 pronti');
});

/* STEP 2 */
app.get('/api/step2/script-si', async (req, res) => {
  try {
    const articoli = await getAnagrafiche({ numeroPagina: 1 });

    res.json({
      ok: true,
      totale: articoli.length,
      articoli,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* STEP 3 */
app.get('/api/step3/export-sheet', async (req, res) => {
  try {
    const articoli = await getAnagrafiche({ numeroPagina: 1 });
    const rows = articoli.map(toRow);

    const { sheets, sheetId } = await getSheetsClient();
    const sheetTitle = 'Sheet1';

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${sheetTitle}!1:1`,
      valueInputOption: 'RAW',
      requestBody: { values: [SHEET_HEADERS] },
    });

    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: `${sheetTitle}!2:100000`,
    });

    if (rows.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${sheetTitle}!2`,
        valueInputOption: 'RAW',
        requestBody: { values: rows },
      });
    }

    res.json({
      ok: true,
      scritti: rows.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   START
   ========================================================= */

app.listen(PORT, () => {
  console.log(`🚀 SyncFED avviato sulla porta ${PORT}`);
});
