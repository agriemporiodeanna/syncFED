import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
import bodyParser from 'body-parser';
import xml2js from 'xml2js';
import { google } from 'googleapis';

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;

/* =========================================================
   CONFIGURAZIONE BMAN
   ========================================================= */

const BMAN_ENDPOINT = 'https://emporiodeanna.bman.it/bmanapi.asmx';
const BMAN_CHIAVE = process.env.BMAN_API_KEY;

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
   SOAP getAnagrafiche (STABILE)
   ========================================================= */

async function getAnagraficheScriptSI() {
  const filtri = [
    { chiave: 'opzionale11', operatore: '=', valore: 'si' }
  ];

  const soapBody = `
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getAnagrafiche xmlns="http://cloud.bman.it/">
      <chiave>${BMAN_CHIAVE}</chiave>
      <filtri><![CDATA[${JSON.stringify(filtri)}]]></filtri>
      <ordinamentoCampo>ID</ordinamentoCampo>
      <ordinamentoDirezione>1</ordinamentoDirezione>
      <numeroPagina>1</numeroPagina>
      <listaDepositi><![CDATA[]]></listaDepositi>
      <dettaglioVarianti>false</dettaglioVarianti>
    </getAnagrafiche>
  </soap:Body>
</soap:Envelope>`.trim();

  const response = await fetch(BMAN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'http://cloud.bman.it/getAnagrafiche'
    },
    body: soapBody
  });

  const xml = await response.text();
  const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });

  const result =
    parsed?.['soap:Envelope']?.['soap:Body']?.['getAnagraficheResponse']?.['getAnagraficheResult'];

  const articoli = JSON.parse(result || '[]');

  return articoli.filter(a => normalizeValue(a.opzionale11) === 'si');
}

/* =========================================================
   GOOGLE SHEETS – CLIENT
   ========================================================= */

async function getSheetsClient() {
  const required = ['GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_SHEET_ID'];
  const missing = required.filter(k => !process.env[k]);

  if (missing.length) {
    throw new Error(`Variabili ambiente mancanti: ${missing.join(', ')}`);
  }

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  await auth.authorize();

  return {
    sheets: google.sheets({ version: 'v4', auth }),
    sheetId: process.env.GOOGLE_SHEET_ID,
  };
}

/* =========================================================
   API – STEP 2
   ========================================================= */

app.get('/api/step2/script-si', async (req, res) => {
  try {
    const articoli = await getAnagraficheScriptSI();

    res.json({
      ok: true,
      step: 'STEP 2 – Script = SI',
      totale: articoli.length,
      articoli,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   API – STEP 3 (TEST SCRITTURA GOOGLE SHEET)
   ========================================================= */

app.get('/api/step3/export-sheet', async (req, res) => {
  try {
    const articoli = await getAnagraficheScriptSI();
    const primo = articoli[0];

    if (!primo) {
      return res.json({ ok: false, error: 'Nessun articolo da scrivere' });
    }

    const { sheets, sheetId } = await getSheetsClient();

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'Sheet1!A1:D2',
      valueInputOption: 'RAW',
      requestBody: {
        values: [
          ['ID', 'Codice', 'Titolo', 'Script'],
          [
            primo.ID,
            primo.codice,
            primo.opzionale2 || '',
            primo.opzionale11
          ]
        ]
      }
    });

    res.json({
      ok: true,
      step: 'STEP 3 – Google Sheet',
      scritto: true,
      articoloTest: {
        ID: primo.ID,
        codice: primo.codice
      }
    });

  } catch (err) {
    console.error('❌ Errore STEP 3:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   HEALTH
   ========================================================= */

app.get('/', (req, res) => {
  res.send('🚀 SyncFED attivo – STEP 2 OK – STEP 3 pronto');
});

/* =========================================================
   START
   ========================================================= */

app.listen(PORT, () => {
  console.log(`🚀 SyncFED avviato sulla porta ${PORT}`);
  console.log(`Node: ${process.version}`);
});
