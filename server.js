console.log('NODE VERSION =', process.version);
console.log('OPENSSL VERSION =', process.versions.openssl);
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import xml2js from 'xml2js';
import { google } from 'googleapis';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

/* =========================================================
   CONFIG BMAN
   ========================================================= */

const BMAN_ENDPOINT = 'https://emporiodeanna.bman.it/bmanapi.asmx';
const BMAN_CHIAVE = process.env.BMAN_API_KEY;

if (!BMAN_CHIAVE) {
  console.error('❌ BMAN_API_KEY mancante');
}

/* =========================================================
   NORMALIZZAZIONE
   ========================================================= */

function norm(v) {
  return (v ?? '')
    .toString()
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
  const json =
    parsed?.['soap:Envelope']?.['soap:Body']?.[responseTag]?.[resultTag];
  try {
    return JSON.parse(json || '[]');
  } catch {
    return [];
  }
}

/* =========================================================
   BMAN – getAnagrafiche (VERSIONE STABILE)
   ========================================================= */

async function getAnagrafiche() {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getAnagrafiche xmlns="http://cloud.bman.it/">
      <chiave>${BMAN_CHIAVE}</chiave>
      <filtri><![CDATA[[]]]></filtri>
      <ordinamentoCampo>ID</ordinamentoCampo>
      <ordinamentoDirezione>1</ordinamentoDirezione>
      <numeroPagina>1</numeroPagina>
      <listaDepositi><![CDATA[[1]]]></listaDepositi>
      <dettaglioVarianti>false</dettaglioVarianti>
    </getAnagrafiche>
  </soap:Body>
</soap:Envelope>`;

  const xml = await soapCall(
    'http://cloud.bman.it/getAnagrafiche',
    body
  );

  return parseSoapResult(
    xml,
    'getAnagraficheResponse',
    'getAnagraficheResult'
  );
}

/* =========================================================
   STEP 2 – Script = SI  ✅ FUNZIONANTE
   ========================================================= */

app.get('/api/step2/script-si', async (req, res) => {
  try {
    const articoli = await getAnagrafiche();

    const filtrati = articoli.filter(
      a => norm(a?.opzionale11) === 'si'
    );

    res.json({
      ok: true,
      totale: filtrati.length,
      articoli: filtrati,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* =========================================================
   GOOGLE SHEETS – AUTH
   ========================================================= */

async function getSheetsClient() {
  const {
    GOOGLE_SHEET_ID,
    GOOGLE_CLIENT_EMAIL,
    GOOGLE_PRIVATE_KEY,
  } = process.env;

  if (!GOOGLE_SHEET_ID || !GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new Error('Variabili Google Sheet mancanti');
  }

  const auth = new google.auth.JWT({
    email: GOOGLE_CLIENT_EMAIL,
    key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  await auth.authorize();

  return {
    sheets: google.sheets({ version: 'v4', auth }),
    sheetId: GOOGLE_SHEET_ID,
  };
}

/* =========================================================
   STEP 3 – SCRITTURA GOOGLE SHEET ✅
   ========================================================= */

app.get('/api/step3/export-sheet', async (req, res) => {
  try {
    // stessi dati dello STEP 2
    const articoli = await getAnagrafiche();
    const filtrati = articoli.filter(
      a => norm(a?.opzionale11) === 'si'
    );

    const rows = filtrati.map(a => [
      a.ID || '',
      a.codice || '',
      a.opzionale2 || '',     // Titolo
      a.tag || '',
      a.descrizioneHtml || '',
      a.opzionale11 || '',
    ]);

    const headers = [
      'ID',
      'Codice',
      'Titolo',
      'Tag',
      'DescrizioneHTML',
      'Script',
    ];

    const { sheets, sheetId } = await getSheetsClient();
    const sheetName = 'Sheet1';

    // header
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });

    // clear + write
    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: `${sheetName}!A2:Z`,
    });

    if (rows.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${sheetName}!A2`,
        valueInputOption: 'RAW',
        requestBody: { values: rows },
      });
    }

    res.json({
      ok: true,
      step: 'STEP 3 – Export Google Sheet',
      scritti: rows.length,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* =========================================================
   DEBUG
   ========================================================= */

app.get('/api/debug/anagrafiche-raw', async (req, res) => {
  const a = await getAnagrafiche();
  res.json({ ok: true, totale: a.length, sample: a.slice(0, 5) });
});

/* =========================================================
   START
   ========================================================= */

app.listen(PORT, () => {
  console.log(`🚀 SyncFED avviato sulla porta ${PORT}`);
});
