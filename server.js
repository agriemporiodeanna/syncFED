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
   SOAP – getAnagrafiche (VERSIONE FUNZIONANTE)
   ========================================================= */

async function getAnagrafiche() {
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
      <listaDepositi><![CDATA[[1]]]></listaDepositi>
      <dettaglioVarianti>false</dettaglioVarianti>
    </getAnagrafiche>
  </soap:Body>
</soap:Envelope>`.trim();

  const response = await fetch(BMAN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: 'http://cloud.bman.it/getAnagrafiche'
    },
    body: soapBody
  });

  const xml = await response.text();
  const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });

  const result =
    parsed?.['soap:Envelope']?.['soap:Body']?.['getAnagraficheResponse']?.['getAnagraficheResult'];

  return JSON.parse(result || '[]');
}

/* =========================================================
   STEP 2 – Script = SI (INVARIATO)
   ========================================================= */

app.get('/api/step2/script-si', async (req, res) => {
  try {
    const articoli = await getAnagrafiche();

    const filtrati = articoli.filter(a =>
      normalizeValue(a.opzionale11) === 'si'
    );

    console.log(`📦 Articoli ricevuti: ${articoli.length}`);
    console.log(`✅ Articoli Script=SI: ${filtrati.length}`);

    res.json({
      ok: true,
      step: 'STEP 2 – Script = SI',
      totale: filtrati.length,
      articoli: filtrati
    });

  } catch (err) {
    console.error('❌ Errore STEP 2:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   TEST GOOGLE KEY (SOLO VERIFICA)
   ========================================================= */

app.get('/api/test/google', async (req, res) => {
  try {
    const required = [
      'GOOGLE_CLIENT_EMAIL',
      'GOOGLE_PRIVATE_KEY',
      'GOOGLE_SHEET_ID'
    ];

    const missing = required.filter(k => !process.env[k]);
    if (missing.length) {
      return res.status(500).json({
        ok: false,
        error: `Variabili ambiente mancanti: ${missing.join(', ')}`
      });
    }

    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL.trim();
    const sheetId = process.env.GOOGLE_SHEET_ID.trim();

    const privateKey = process.env.GOOGLE_PRIVATE_KEY
      .replace(/\\n/g, '\n')
      .trim();

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    await auth.authorize();

    const sheets = google.sheets({ version: 'v4', auth });
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });

    res.json({
      ok: true,
      message: 'Chiave Google valida',
      spreadsheetTitle: meta.data.properties.title,
      sheets: meta.data.sheets.map(s => s.properties.title)
    });

  } catch (err) {
    console.error('❌ Errore Google test:', err);
    res.status(500).json({
      ok: false,
      error: err.message,
      code: err.code || 'n/a'
    });
  }
});

/* =========================================================
   HEALTH CHECK
   ========================================================= */

app.get('/', (req, res) => {
  res.send('🚀 SyncFED attivo – STEP 2 stabile – Google test pronto');
});

/* =========================================================
   START SERVER
   ========================================================= */

app.listen(PORT, () => {
  console.log(`🚀 SyncFED avviato sulla porta ${PORT}`);
});
