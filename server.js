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

  const xml = await response.text();
  return xml;
}

async function parseSoapJsonResult(xml, responseTag, resultTag) {
  const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
  const result =
    parsed?.['soap:Envelope']?.['soap:Body']?.[responseTag]?.[resultTag] ??
    parsed?.['soap:Envelope']?.['soap:Body']?.[responseTag]?.[`${resultTag}`];

  if (typeof result === 'string') {
    try {
      return JSON.parse(result || '[]');
    } catch {
      return result;
    }
  }
  return result ?? [];
}

/* =========================================================
   BMAN: getAnagraficheV4 (JSON in CDATA)
   ========================================================= */

async function getAnagraficheV4({
  numeroPagina = 1,
  listaDepositi = [],
  dettaglioVarianti = false,
  ordinamentoCampo = 'ID',
  ordinamentoDirezione = 1,
  filtri = [],
} = {}) {
  const filtriJson = JSON.stringify(filtri);
  const depositiJson = JSON.stringify(listaDepositi);

  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getAnagraficheV4 xmlns="http://cloud.bman.it/">
      <chiave>${BMAN_CHIAVE}</chiave>
      <filtri><![CDATA[${filtriJson}]]></filtri>
      <ordinamentoCampo>${ordinamentoCampo}</ordinamentoCampo>
      <ordinamentoDirezione>${ordinamentoDirezione}</ordinamentoDirezione>
      <numeroPagina>${numeroPagina}</numeroPagina>
      <listaDepositi><![CDATA[${depositiJson}]]></listaDepositi>
      <dettaglioVarianti>${dettaglioVarianti ? 'true' : 'false'}</dettaglioVarianti>
    </getAnagraficheV4>
  </soap:Body>
</soap:Envelope>`.trim();

  const xml = await soapCall({
    action: 'http://cloud.bman.it/getAnagraficheV4',
    bodyXml: soapBody,
  });

  const data = await parseSoapJsonResult(xml, 'getAnagraficheV4Response', 'getAnagraficheV4Result');
  return Array.isArray(data) ? data : [];
}

/* =========================================================
   BMAN: getDepositi
   ========================================================= */

async function getDepositi() {
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getDepositi xmlns="http://cloud.bman.it/">
      <chiave>${BMAN_CHIAVE}</chiave>
    </getDepositi>
  </soap:Body>
</soap:Envelope>`.trim();

  const xml = await soapCall({
    action: 'http://cloud.bman.it/getDepositi',
    bodyXml: soapBody,
  });

  const data = await parseSoapJsonResult(xml, 'getDepositiResponse', 'getDepositiResult');
  return Array.isArray(data) ? data : [];
}

/* =========================================================
   GOOGLE SHEETS (STEP 3)
   ========================================================= */

function getRequiredEnv(name) {
  const v = process.env[name];
  return (v ?? '').toString().trim();
}

function getGoogleCredentials() {
  const missing = ['GOOGLE_SHEET_ID', 'GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY_BASE64'].filter(
    (k) => !getRequiredEnv(k),
  );
  if (missing.length) return { ok: false, missing };

  const sheetId = getRequiredEnv('GOOGLE_SHEET_ID');
  const clientEmail = getRequiredEnv('GOOGLE_CLIENT_EMAIL');
  const pkBase64 = getRequiredEnv('GOOGLE_PRIVATE_KEY_BASE64');

  let privateKey = Buffer.from(pkBase64, 'base64').toString('utf8');
  privateKey = privateKey.replace(/\\n/g, '\n').trim(); // normalizzazione automatica

  return { ok: true, sheetId, clientEmail, privateKey };
}

async function getSheetsClient() {
  const creds = getGoogleCredentials();
  if (!creds.ok) {
    const err = new Error(`Variabili ambiente mancanti: ${creds.missing.join(', ')}`);
    err.code = 'MISSING_ENV';
    throw err;
  }

  const auth = new google.auth.JWT({
    email: creds.clientEmail,
    key: creds.privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  await auth.authorize();
  return { sheets: google.sheets({ version: 'v4', auth }), sheetId: creds.sheetId };
}

async function resolveSheetTitle(sheetsApi, sheetId) {
  const wanted = (process.env.GOOGLE_SHEET_TAB || '').trim();
  const meta = await sheetsApi.spreadsheets.get({ spreadsheetId: sheetId });
  const all = meta?.data?.sheets || [];

  if (!all.length) return 'Sheet1';

  if (wanted) {
    const found = all.find((s) => s?.properties?.title === wanted);
    if (found) return wanted;
  }
  return all[0]?.properties?.title || 'Sheet1';
}

async function readHeaderRow(sheetsApi, sheetId, sheetTitle) {
  const range = `${sheetTitle}!1:1`;
  const resp = await sheetsApi.spreadsheets.values.get({ spreadsheetId: sheetId, range });
  const row = resp?.data?.values?.[0] || [];
  return row.map((x) => String(x ?? '').trim());
}

function headersEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (String(a[i] ?? '').trim() !== String(b[i] ?? '').trim()) return false;
  }
  return true;
}

async function writeSheet(sheetsApi, sheetId, sheetTitle, headers, rows) {
  const existing = await readHeaderRow(sheetsApi, sheetId, sheetTitle);

  if (!headersEqual(existing, headers)) {
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${sheetTitle}!1:1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }

  await sheetsApi.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: `${sheetTitle}!2:100000`,
  });

  if (rows.length) {
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${sheetTitle}!2`,
      valueInputOption: 'RAW',
      requestBody: { values: rows },
    });
  }

  return { headersWritten: !headersEqual(existing, headers), rowsWritten: rows.length };
}

/* =========================================================
   MAPPATURA COLONNE (BMAN -> GOOGLE SHEET)
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
  const tagValue = a?.tags ?? a?.tag ?? '';
  return [
    a?.ID ?? '',
    a?.codice ?? '',
    a?.opzionale2 ?? a?.Titolo ?? '',
    tagValue ?? '',
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

app.get('/api/debug/depositi', async (req, res) => {
  try {
    const depositi = await getDepositi();
    res.json({ ok: true, totale: depositi.length, depositi });
  } catch (err) {
    console.error('❌ Errore getDepositi:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/step2/script-si', async (req, res) => {
  try {
    const depParam = (req.query.depositi || '').toString().trim();
    const depositi = depParam
      ? depParam
          .split(',')
          .map((x) => parseInt(x.trim(), 10))
          .filter((n) => Number.isFinite(n))
      : [];

    const articoli = await getAnagraficheV4({
      numeroPagina: 1,
      listaDepositi: depositi,
      dettaglioVarianti: false,
      ordinamentoCampo: 'ID',
      ordinamentoDirezione: 1,
      filtri: [],
    });

    const filtrati = articoli.filter((a) => normalizeValue(a?.opzionale11) === 'si');

    console.log(`📦 Articoli totali (pagina 1): ${articoli.length}`);
    console.log(`✅ Articoli Script=SI: ${filtrati.length}`);

    res.json({
      ok: true,
      step: 'STEP 2 – Script = SI',
      totale: filtrati.length,
      articoli: filtrati,
    });
  } catch (err) {
    console.error('❌ Errore STEP 2:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/debug/anagrafiche-raw', async (req, res) => {
  try {
    const articoli = await getAnagraficheV4({
      numeroPagina: 1,
      listaDepositi: [],
      dettaglioVarianti: false,
      ordinamentoCampo: 'ID',
      ordinamentoDirezione: 1,
      filtri: [],
    });

    res.json({
      ok: true,
      totale: articoli.length,
      sample: articoli.slice(0, 5),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   STEP 3 – scriviamo su Google Sheet
   ========================================================= */

app.get('/api/step3/export-sheet', async (req, res) => {
  try {
    const depParam = (req.query.depositi || '').toString().trim();
    const depositi = depParam
      ? depParam
          .split(',')
          .map((x) => parseInt(x.trim(), 10))
          .filter((n) => Number.isFinite(n))
      : [];

    const articoli = await getAnagraficheV4({
      numeroPagina: 1,
      listaDepositi: depositi,
      dettaglioVarianti: false,
      ordinamentoCampo: 'ID',
      ordinamentoDirezione: 1,
      filtri: [],
    });

    const filtrati = articoli.filter((a) => normalizeValue(a?.opzionale11) === 'si');
    const rows = filtrati.map(toRowFromAnagrafica);

    const { sheets, sheetId } = await getSheetsClient();
    const sheetTitle = await resolveSheetTitle(sheets, sheetId);

    const result = await writeSheet(sheets, sheetId, sheetTitle, SHEET_HEADERS, rows);

    res.json({
      ok: true,
      step: 'STEP 3 – Scrittura Google Sheet',
      sheetTitle,
      totaleLetti: articoli.length,
      totaleScriptSi: filtrati.length,
      headers: SHEET_HEADERS,
      ...result,
    });
  } catch (err) {
    console.error('❌ Errore STEP 3:', err);
    if (err?.code === 'MISSING_ENV') {
      return res.status(500).json({ ok: false, error: err.message });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   START SERVER
   ========================================================= */

app.listen(PORT, () => {
  console.log(`🚀 SyncFED avviato sulla porta ${PORT}`);
  if (BMAN_CHIAVE) console.log('✅ BMAN_API_KEY presente');

  const missingGoogle = ['GOOGLE_SHEET_ID', 'GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY_BASE64'].filter(
    (k) => !process.env[k]),
  );

  if (missingGoogle.length) {
    console.log(`ℹ️ Google Sheet non configurato: mancano ${missingGoogle.join(', ')}`);
  } else {
    console.log('✅ Google Sheet env presenti');
  }
});
