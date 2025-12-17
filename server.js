import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import xml2js from 'xml2js';
import { google } from 'googleapis';
import ftp from 'basic-ftp';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

const PORT = process.env.PORT || 10000;

/* =========================================================
   INFO RUNTIME (utile in Render)
   ========================================================= */
console.log('NODE VERSION =', process.version);
console.log('OPENSSL VERSION =', process.versions.openssl);

/* =========================================================
   CONFIGURAZIONE BMAN (SOAP)
   ========================================================= */
const BMAN_ENDPOINT = 'https://emporiodeanna.bman.it/bmanapi.asmx';
const BMAN_CHIAVE = (process.env.BMAN_API_KEY || '').trim();

if (!BMAN_CHIAVE) console.error('❌ Variabile ambiente mancante: BMAN_API_KEY');

/* =========================================================
   NORMALIZZAZIONE (ROBUSTA)
   ========================================================= */
function normalizeValue(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function safeJsonParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

/* =========================================================
   SOAP HELPERS
   ========================================================= */
async function soapCall({ action, bodyXml }) {
  const resp = await fetch(BMAN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: action,
    },
    body: bodyXml,
  });

  const text = await resp.text();
  return text;
}

async function parseSoapResult(xml, responseTag, resultTag) {
  const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
  const result = parsed?.['soap:Envelope']?.['soap:Body']?.[responseTag]?.[resultTag];
  return result ?? '';
}

/* =========================================================
   BMAN: getAnagrafiche (METODO CORRETTO, CON FILTRI)
   ========================================================= */
async function getAnagrafiche({ numeroPagina = 1, filtri = [], ordinamentoCampo = 'ID', ordinamentoDirezione = 1, listaDepositi = [], dettaglioVarianti = false } = {}) {
  const filtriJson = JSON.stringify(filtri);
  const depositiJson = JSON.stringify(listaDepositi);

  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getAnagrafiche xmlns="http://cloud.bman.it/">
      <chiave>${BMAN_CHIAVE}</chiave>
      <filtri><![CDATA[${filtriJson}]]></filtri>
      <ordinamentoCampo>${ordinamentoCampo}</ordinamentoCampo>
      <ordinamentoDirezione>${ordinamentoDirezione}</ordinamentoDirezione>
      <numeroPagina>${numeroPagina}</numeroPagina>
      <listaDepositi><![CDATA[${depositiJson}]]></listaDepositi>
      <dettaglioVarianti>${dettaglioVarianti ? 'true' : 'false'}</dettaglioVarianti>
    </getAnagrafiche>
  </soap:Body>
</soap:Envelope>`.trim();

  const xml = await soapCall({
    action: 'http://cloud.bman.it/getAnagrafiche',
    bodyXml: soapBody,
  });

  const result = await parseSoapResult(xml, 'getAnagraficheResponse', 'getAnagraficheResult');
  const data = safeJsonParse(result || '[]', []);
  return Array.isArray(data) ? data : [];
}

/* =========================================================
   STEP 2 – TUTTI GLI ARTICOLI Script=SI (PAGINATI)
   ========================================================= */
async function getAllScriptSiArticles() {
  const filtri = [{ chiave: 'opzionale11', operatore: '=', valore: 'si' }];

  let page = 1;
  const out = [];

  while (true) {
    const chunk = await getAnagrafiche({
      numeroPagina: page,
      filtri,
      ordinamentoCampo: 'ID',
      ordinamentoDirezione: 1,
      listaDepositi: [], // se vuoi vincolare: metti ID deposito qui
      dettaglioVarianti: false,
    });

    if (!chunk.length) break;

    // sicurezza extra
    const filtrati = chunk.filter((a) => normalizeValue(a?.opzionale11) === 'si');
    out.push(...filtrati);

    // max 50 per pagina, se torna meno è finita
    if (chunk.length < 50) break;
    page += 1;

    // safety hard-stop (evita loop infinito)
    if (page > 200) break;
  }

  return out;
}

/* =========================================================
   GOOGLE SHEETS
   ========================================================= */
function getRequiredEnv(name) {
  return String(process.env[name] ?? '').trim();
}

function getGoogleCredsRaw() {
  const missing = ['GOOGLE_SHEET_ID', 'GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY'].filter((k) => !getRequiredEnv(k));
  if (missing.length) return { ok: false, missing };

  const sheetId = getRequiredEnv('GOOGLE_SHEET_ID');
  const clientEmail = getRequiredEnv('GOOGLE_CLIENT_EMAIL');

  // RAW key in Render: deve contenere \n, noi li trasformiamo
  const privateKey = getRequiredEnv('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n').trim();

  return { ok: true, sheetId, clientEmail, privateKey };
}

async function getSheetsClient() {
  const creds = getGoogleCredsRaw();
  if (!creds.ok) {
    const err = new Error('Variabili ambiente mancanti');
    err.code = 'MISSING_ENV';
    err.missing = creds.missing;
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

async function ensureSheet(sheetsApi, sheetId, sheetTitle) {
  const meta = await sheetsApi.spreadsheets.get({ spreadsheetId: sheetId });
  const exists = (meta?.data?.sheets || []).some((s) => s?.properties?.title === sheetTitle);
  if (exists) return;

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: sheetTitle } } }],
    },
  });
}

async function writeRange(sheetsApi, sheetId, range, values) {
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values },
  });
}

async function clearRange(sheetsApi, sheetId, range) {
  await sheetsApi.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range,
  });
}

async function readRange(sheetsApi, sheetId, range) {
  const resp = await sheetsApi.spreadsheets.values.get({ spreadsheetId: sheetId, range });
  return resp?.data?.values || [];
}

/* =========================================================
   SHEET SCHEMA (dashboard-ready)
   ========================================================= */
const SHEET_TAB = (process.env.GOOGLE_SHEET_TAB || 'PRODOTTI_BMAN').trim();

const SHEET_HEADERS = [
  'ID',
  'Codice',
  'Titolo',
  'Brand',
  'Tag15',
  'Script',
  'Descrizione_IT',
  'Titolo_FR',
  'Descrizione_FR',
  'Titolo_ES',
  'Descrizione_ES',
  'Titolo_DE',
  'Descrizione_DE',
  'Titolo_EN',
  'Descrizione_EN',
  'Foto_1',
  'Foto_2',
  'Foto_3',
  'Foto_4',
  'Foto_5',
];

function toSheetRow(a) {
  return [
    a?.ID ?? '',
    a?.codice ?? '',
    a?.opzionale2 ?? a?.Titolo ?? '',
    a?.opzionale1 ?? '',                 // Brand (da tua mappatura)
    '',                                   // Tag15 (lo generiamo)
    a?.opzionale11 ?? '',                 // Script
    a?.opzionale12 ?? '',                 // Desc IT (da tua mappatura)
    '', '', '', '', '', '', '', '',       // lingue (generate)
    '', '', '', '', '',                   // 5 foto scelte (links)
  ];
}

/* =========================================================
   GENERATORI (ITA / Traduzioni / Tag)
   ========================================================= */
function optimizeItalianDescription(a) {
  const codice = (a?.codice ?? '').toString().trim();
  const titolo = (a?.opzionale2 ?? a?.Titolo ?? '').toString().trim();
  const brand = (a?.opzionale1 ?? '').toString().trim();

  // Base: se già esiste testo, lo rifiniamo “senza inventare”
  const base = (a?.opzionale12 ?? a?.descrizioneHtml ?? '').toString().trim();

  const righe = [];
  if (titolo) righe.push(`${titolo}${brand ? ` – ${brand}` : ''}.`);
  if (base) righe.push(base.replace(/\s+/g, ' ').trim());

  righe.push('Ideale per vendita online: descrizione chiara, vantaggi concreti, uso consigliato e parole chiave coerenti.');
  if (codice) righe.push(`Codice articolo: ${codice}.`);

  return righe.join('\n');
}

// Traduzioni “fallback” (semplici). Se vuoi traduzioni perfette: metti OPENAI_API_KEY e useremo l’LLM.
function translateFallback(lang, titleIt, descIt) {
  const prefix = {
    FR: 'FR',
    ES: 'ES',
    DE: 'DE',
    EN: 'EN',
  }[lang] || lang;

  return {
    title: `[${prefix}] ${titleIt}`,
    desc: `[${prefix}] ${descIt}`,
  };
}

function make15Tags(titoloIt, descIt) {
  // Struttura fissa: 5 prodotto, 3 categoria, 2 beneficio/qualità, 5 locali/brand
  // Regole: separati da virgola SENZA spazi, sostituire #NegozioLocale -> #NegozioVicinato
  const t = normalizeValue(titoloIt);
  const d = normalizeValue(descIt);

  // euristica rapida keyword
  const has = (w) => t.includes(w) || d.includes(w);

  const prodotto = [];
  if (has('scopa')) prodotto.push('#Scopa');
  if (has('saggina')) prodotto.push('#Saggina');
  if (has('fiore')) prodotto.push('#Fiori');
  if (has('regalo')) prodotto.push('#Regalo');
  if (prodotto.length < 5) prodotto.push('#Casa', '#Giardino', '#Pulizia', '#ArticoliCasa', '#Oggettistica').slice(0, 5);

  const categoria = ['#EmporioDeanna', '#BmanShop', '#EcommerceItalia'];

  const beneficio = ['#Qualita', '#Convenienza'];

  const locali = ['#Buti', '#Valdera', '#Pisa', '#NegozioVicinato', '#Toscana'];

  const out = [...prodotto.slice(0, 5), ...categoria, ...beneficio, ...locali].slice(0, 15);
  return out.join(',');
}

/* =========================================================
   FOTO: UNSPLASH / PIXABAY / PEXELS
   ========================================================= */
function requireEnv(name) {
  const v = getRequiredEnv(name);
  if (!v) {
    const e = new Error(`Variabile ambiente mancante: ${name}`);
    e.code = 'MISSING_ENV';
    e.missing = [name];
    throw e;
  }
  return v;
}

async function searchUnsplash(query, perPage = 4) {
  const key = getRequiredEnv('UNSPLASH_ACCESS_KEY');
  if (!key) return [];
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}`;
  const r = await fetch(url, { headers: { Authorization: `Client-ID ${key}` } });
  const j = await r.json();
  const items = (j?.results || []).map((x) => ({
    source: 'unsplash',
    page: x?.links?.html || '',
    url: x?.urls?.regular || '',
    author: x?.user?.name || '',
  }));
  return items.filter((x) => x.url);
}

async function searchPixabay(query, perPage = 3) {
  const key = getRequiredEnv('PIXABAY_KEY');
  if (!key) return [];
  const url = `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&per_page=${perPage}&image_type=photo&safesearch=true`;
  const r = await fetch(url);
  const j = await r.json();
  const items = (j?.hits || []).map((x) => ({
    source: 'pixabay',
    page: x?.pageURL || '',
    url: x?.largeImageURL || x?.webformatURL || '',
    author: x?.user || '',
  }));
  return items.filter((x) => x.url);
}

async function searchPexels(query, perPage = 3) {
  const key = getRequiredEnv('PEXELS_API_KEY');
  if (!key) return [];
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}`;
  const r = await fetch(url, { headers: { Authorization: key } });
  const j = await r.json();
  const items = (j?.photos || []).map((x) => ({
    source: 'pexels',
    page: x?.url || '',
    url: x?.src?.large || x?.src?.medium || '',
    author: x?.photographer || '',
  }));
  return items.filter((x) => x.url);
}

async function suggestPhotos10({ codice, titolo }) {
  const q = `${titolo} product`;
  const [u, p, x] = await Promise.all([searchUnsplash(q, 4), searchPixabay(q, 3), searchPexels(q, 3)]);
  const all = [...u, ...p, ...x].slice(0, 10);
  return all;
}

/* =========================================================
   FTP UPLOAD (5 foto scelte)
   ========================================================= */
async function uploadToFtp({ codice, selectedUrls }) {
  const host = requireEnv('FTP_HOST');          // ftp.agriemporiodeanna.com
  const user = requireEnv('FTP_USER');
  const pass = requireEnv('FTP_PASS');
  const dir = (process.env.FTP_DIR || '/imgebay').trim();
  const secure = (process.env.FTP_SECURE || 'false').toLowerCase() === 'true';

  const client = new ftp.Client(30000);
  client.ftp.verbose = false;

  try {
    await client.access({ host, user, password: pass, secure });
    await client.ensureDir(dir);

    const uploaded = [];

    for (let i = 0; i < selectedUrls.length; i += 1) {
      const url = selectedUrls[i];
      const idx = i + 1;

      const extGuess = path.extname(new URL(url).pathname) || '.jpg';
      const filename = `${codice}_${idx}${extGuess}`;

      const r = await fetch(url);
      if (!r.ok) throw new Error(`Download fallito: ${url} (${r.status})`);
      const buf = await r.buffer();

      await client.uploadFrom(Buffer.from(buf), filename);

      // URL pubblico (assunzione: http(s) sulla stessa root host)
      // Se hai una base URL diversa, metti FTP_PUBLIC_BASE es: https://ftp.agriemporiodeanna.com/imgebay
      const base = (process.env.FTP_PUBLIC_BASE || `https://${host}${dir}`).replace(/\/+$/, '');
      const publicUrl = `${base}/${filename}`;
      uploaded.push(publicUrl);
    }

    return uploaded;
  } finally {
    client.close();
  }
}

/* =========================================================
   UTIL: trova riga in sheet per CODICE
   ========================================================= */
async function findRowByCodice(sheetsApi, sheetId, sheetTitle, codice) {
  const rows = await readRange(sheetsApi, sheetId, `${sheetTitle}!A2:T`);
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const codiceCell = String(row[1] ?? '').trim();
    if (codiceCell === String(codice).trim()) {
      return { rowIndex1Based: i + 2, row };
    }
  }
  return null;
}

/* =========================================================
   API: HEALTH
   ========================================================= */
app.get('/', (req, res) => {
  res.send('🚀 SyncFED attivo – STEP2 getAnagrafiche + STEP3 GoogleSheet + Dashboard');
});

/* =========================================================
   API: TEST GOOGLE KEY (da browser)
   ========================================================= */
app.get('/api/test/google-key', async (req, res) => {
  try {
    const { sheets, sheetId } = await getSheetsClient();
    const sheetTitle = await resolveSheetTitle(sheets, sheetId);

    // semplice chiamata che prova accesso metadata
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });

    res.json({
      ok: true,
      message: 'Chiave Google valida – JWT firmato correttamente',
      node: process.version,
      sheetDetected: sheetTitle,
      spreadsheetTitle: meta?.data?.properties?.title || '',
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
      code: err.code || 'n/a',
      missing: err.missing || undefined,
    });
  }
});

/* =========================================================
   API: STEP 2 – lista completa script=SI (paginata)
   ========================================================= */
app.get('/api/step2/script-si-all', async (req, res) => {
  try {
    const articoli = await getAllScriptSiArticles();
    res.json({ ok: true, step: 'STEP 2 – Script=SI (ALL)', totale: articoli.length, articoli });
  } catch (err) {
    console.error('❌ STEP2 error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   API: STEP 3 – EXPORT ALL Script=SI su Google Sheet
   ========================================================= */
app.get('/api/step3/export-all-script-si', async (req, res) => {
  try {
    const articoli = await getAllScriptSiArticles();

    const { sheets, sheetId } = await getSheetsClient();

    // garantisco la tab corretta
    await ensureSheet(sheets, sheetId, SHEET_TAB);

    // header + clear + write
    await writeRange(sheets, sheetId, `${SHEET_TAB}!A1:T1`, [SHEET_HEADERS]);
    await clearRange(sheets, sheetId, `${SHEET_TAB}!A2:T`);

    const rows = articoli.map(toSheetRow);
    if (rows.length) {
      await writeRange(sheets, sheetId, `${SHEET_TAB}!A2`, rows);
    }

    res.json({
      ok: true,
      step: 'STEP 3 – Google Sheet (export ALL Script=SI)',
      sheet: SHEET_TAB,
      letti: articoli.length,
      scritto: true,
    });
  } catch (err) {
    console.error('❌ STEP3 export error:', err);
    res.status(500).json({
      ok: false,
      error: err.message,
      code: err.code || 'n/a',
      missing: err.missing || undefined,
    });
  }
});

/* =========================================================
   API: OTTIMIZZA ITA (scrive su sheet)
   ========================================================= */
app.post('/api/action/ottimizza-ita', async (req, res) => {
  try {
    const codice = String(req.body?.codice ?? '').trim();
    if (!codice) return res.status(400).json({ ok: false, error: 'codice mancante' });

    const articoli = await getAllScriptSiArticles();
    const a = articoli.find((x) => String(x?.codice ?? '').trim() === codice);
    if (!a) return res.status(404).json({ ok: false, error: 'articolo non trovato in Script=SI' });

    const descIt = optimizeItalianDescription(a);
    const titoloIt = (a?.opzionale2 ?? a?.Titolo ?? '').toString().trim();

    const { sheets, sheetId } = await getSheetsClient();
    await ensureSheet(sheets, sheetId, SHEET_TAB);

    const found = await findRowByCodice(sheets, sheetId, SHEET_TAB, codice);
    if (!found) return res.status(404).json({ ok: false, error: 'codice non trovato sullo sheet (fai export prima)' });

    // Colonna G = Descrizione_IT
    await writeRange(sheets, sheetId, `${SHEET_TAB}!G${found.rowIndex1Based}:G${found.rowIndex1Based}`, [[descIt]]);

    res.json({ ok: true, codice, titoloIt, scritto: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   API: TRADUCI (scrive su sheet FR/ES/DE/EN)
   ========================================================= */
app.post('/api/action/traduci', async (req, res) => {
  try {
    const codice = String(req.body?.codice ?? '').trim();
    if (!codice) return res.status(400).json({ ok: false, error: 'codice mancante' });

    const { sheets, sheetId } = await getSheetsClient();
    await ensureSheet(sheets, sheetId, SHEET_TAB);

    const found = await findRowByCodice(sheets, sheetId, SHEET_TAB, codice);
    if (!found) return res.status(404).json({ ok: false, error: 'codice non trovato sullo sheet (fai export prima)' });

    const row = found.row;
    const titoloIt = String(row[2] ?? '').trim();
    const descIt = String(row[6] ?? '').trim();
    if (!titoloIt || !descIt) return res.status(400).json({ ok: false, error: 'manca Titolo o Descrizione_IT (prima Ottimizza ITA)' });

    const fr = translateFallback('FR', titoloIt, descIt);
    const es = translateFallback('ES', titoloIt, descIt);
    const de = translateFallback('DE', titoloIt, descIt);
    const en = translateFallback('EN', titoloIt, descIt);

    // H..O = Titoli/Descrizioni lingue
    const values = [[
      fr.title, fr.desc,
      es.title, es.desc,
      de.title, de.desc,
      en.title, en.desc,
    ]];

    await writeRange(sheets, sheetId, `${SHEET_TAB}!H${found.rowIndex1Based}:O${found.rowIndex1Based}`, values);

    res.json({ ok: true, codice, scritto: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   API: GENERA TAG 15 (scrive su sheet)
   ========================================================= */
app.post('/api/action/genera-tag', async (req, res) => {
  try {
    const codice = String(req.body?.codice ?? '').trim();
    if (!codice) return res.status(400).json({ ok: false, error: 'codice mancante' });

    const { sheets, sheetId } = await getSheetsClient();
    await ensureSheet(sheets, sheetId, SHEET_TAB);

    const found = await findRowByCodice(sheets, sheetId, SHEET_TAB, codice);
    if (!found) return res.status(404).json({ ok: false, error: 'codice non trovato sullo sheet (fai export prima)' });

    const titoloIt = String(found.row[2] ?? '').trim();
    const descIt = String(found.row[6] ?? '').trim();
    const tag15 = make15Tags(titoloIt, descIt);

    // Colonna E = Tag15
    await writeRange(sheets, sheetId, `${SHEET_TAB}!E${found.rowIndex1Based}:E${found.rowIndex1Based}`, [[tag15]]);

    res.json({ ok: true, codice, tag15, scritto: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   API: FOTO – suggerisci 10
   ========================================================= */
app.get('/api/photos/suggest', async (req, res) => {
  try {
    const codice = String(req.query?.codice ?? '').trim();
    const titolo = String(req.query?.titolo ?? '').trim();
    if (!codice || !titolo) return res.status(400).json({ ok: false, error: 'codice e titolo obbligatori' });

    const items = await suggestPhotos10({ codice, titolo });
    res.json({ ok: true, codice, totale: items.length, foto: items });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, code: err.code || 'n/a' });
  }
});

/* =========================================================
   API: FOTO – scegli 5, upload FTP, scrive 5 link su sheet
   ========================================================= */
app.post('/api/photos/upload5', async (req, res) => {
  try {
    const codice = String(req.body?.codice ?? '').trim();
    const selected = Array.isArray(req.body?.selectedUrls) ? req.body.selectedUrls : [];

    if (!codice) return res.status(400).json({ ok: false, error: 'codice mancante' });
    if (selected.length !== 5) return res.status(400).json({ ok: false, error: 'devi selezionare ESATTAMENTE 5 foto' });

    const uploadedLinks = await uploadToFtp({ codice, selectedUrls: selected });

    const { sheets, sheetId } = await getSheetsClient();
    await ensureSheet(sheets, sheetId, SHEET_TAB);

    const found = await findRowByCodice(sheets, sheetId, SHEET_TAB, codice);
    if (!found) return res.status(404).json({ ok: false, error: 'codice non trovato sullo sheet (fai export prima)' });

    // Foto_1..Foto_5 = colonne P..T
    await writeRange(sheets, sheetId, `${SHEET_TAB}!P${found.rowIndex1Based}:T${found.rowIndex1Based}`, [[
      uploadedLinks[0] || '',
      uploadedLinks[1] || '',
      uploadedLinks[2] || '',
      uploadedLinks[3] || '',
      uploadedLinks[4] || '',
    ]]);

    res.json({ ok: true, codice, uploadedLinks, scritto: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, code: err.code || 'n/a', missing: err.missing || undefined });
  }
});

/* =========================================================
   DASHBOARD
   ========================================================= */
app.get('/dashboard', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>SyncFED Dashboard</title>
  <style>
    body{font-family:Arial,Helvetica,sans-serif;padding:18px;background:#0b0f17;color:#e8eefc}
    h1{margin:0 0 12px}
    .row{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}
    button{padding:10px 12px;border:0;border-radius:10px;cursor:pointer;font-weight:700}
    .primary{background:#4c7dff;color:#fff}
    .ok{background:#1fda85;color:#06110b}
    .warn{background:#ffcd4c;color:#1d1400}
    .danger{background:#ff5c5c;color:#fff}
    input{padding:10px;border-radius:10px;border:1px solid #2b3550;background:#111a2b;color:#e8eefc}
    table{width:100%;border-collapse:collapse;margin-top:12px}
    th,td{border-bottom:1px solid #26324d;padding:10px;vertical-align:top}
    th{position:sticky;top:0;background:#0b0f17}
    .small{font-size:12px;opacity:.85}
    .card{background:#111a2b;border:1px solid #26324d;border-radius:14px;padding:12px;margin-top:10px}
    .grid{display:grid;grid-template-columns:1fr;gap:10px}
    .links a{color:#9db8ff}
  </style>
</head>
<body>
  <h1>🚀 SyncFED Dashboard</h1>
  <div class="row">
    <button class="primary" onclick="exportAll()">STEP 3: Export ALL Script=SI su Sheet</button>
    <button class="ok" onclick="loadAll()">Ricarica lista articoli (Script=SI)</button>
    <a class="links small" href="/api/test/google-key" target="_blank">Test Google Key</a>
  </div>

  <div class="card">
    <div class="row">
      <div>
        <div class="small">Filtro titolo/codice</div>
        <input id="q" placeholder="es: scopa / 12345" oninput="render()" />
      </div>
    </div>
    <div id="status" class="small"></div>
  </div>

  <div class="card">
    <table>
      <thead>
        <tr>
          <th>Codice</th>
          <th>Titolo</th>
          <th>Azioni</th>
        </tr>
      </thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>

  <div id="photoModal" class="card" style="display:none"></div>

<script>
let DATA = [];

function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]))}

async function exportAll(){
  setStatus('⏳ Export in corso...');
  const r = await fetch('/api/step3/export-all-script-si');
  const j = await r.json();
  setStatus(JSON.stringify(j,null,2));
}

async function loadAll(){
  setStatus('⏳ Carico articoli Script=SI...');
  const r = await fetch('/api/step2/script-si-all');
  const j = await r.json();
  if(!j.ok){ setStatus(JSON.stringify(j,null,2)); return; }
  DATA = j.articoli || [];
  setStatus('✅ Articoli Script=SI: ' + DATA.length);
  render();
}

function render(){
  const q = (document.getElementById('q').value||'').toLowerCase().trim();
  const rows = (q?DATA.filter(a=>{
    const c=(a.codice||'').toLowerCase();
    const t=((a.opzionale2||a.Titolo||'')+'').toLowerCase();
    return c.includes(q)||t.includes(q);
  }):DATA);

  const tb = document.getElementById('tbody');
  tb.innerHTML = rows.map(a=>{
    const codice = esc(a.codice||'');
    const titolo = esc(a.opzionale2||a.Titolo||'');
    return \`
      <tr>
        <td><b>\${codice}</b></td>
        <td>\${titolo}<div class="small">ID: \${esc(a.ID||a.Id||a.id||'')}</div></td>
        <td>
          <div class="row">
            <button class="ok" onclick="ottimizza('\${codice}')">Ottimizza ITA</button>
            <button class="primary" onclick="traduci('\${codice}')">Traduci</button>
            <button class="warn" onclick="tag('\${codice}')">Genera Tag</button>
            <button class="danger" onclick="foto('\${codice}','\${titolo}')">Foto</button>
          </div>
        </td>
      </tr>
    \`;
  }).join('');
}

function setStatus(msg){
  document.getElementById('status').textContent = msg;
}

async function ottimizza(codice){
  setStatus('⏳ Ottimizzo ITA per ' + codice);
  const r = await fetch('/api/action/ottimizza-ita', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({codice})});
  const j = await r.json();
  setStatus(JSON.stringify(j,null,2));
}

async function traduci(codice){
  setStatus('⏳ Traduco per ' + codice);
  const r = await fetch('/api/action/traduci', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({codice})});
  const j = await r.json();
  setStatus(JSON.stringify(j,null,2));
}

async function tag(codice){
  setStatus('⏳ Genero tag per ' + codice);
  const r = await fetch('/api/action/genera-tag', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({codice})});
  const j = await r.json();
  setStatus(JSON.stringify(j,null,2));
}

async function foto(codice,titolo){
  setStatus('⏳ Cerco 10 foto per ' + codice);
  const r = await fetch('/api/photos/suggest?codice='+encodeURIComponent(codice)+'&titolo='+encodeURIComponent(titolo));
  const j = await r.json();
  if(!j.ok){ setStatus(JSON.stringify(j,null,2)); return; }

  const modal = document.getElementById('photoModal');
  modal.style.display='block';

  modal.innerHTML = \`
    <h2>Foto suggerite (seleziona 5)</h2>
    <div class="small">Codice: <b>\${esc(codice)}</b></div>
    <div class="grid" id="grid"></div>
    <div class="row">
      <button class="primary" onclick="upload5('\${esc(codice)}')">Carica 5 su FTP + salva su Sheet</button>
      <button onclick="closePhotos()">Chiudi</button>
    </div>
    <div class="small" id="selCount"></div>
  \`;

  const grid = modal.querySelector('#grid');
  grid.innerHTML = (j.foto||[]).map((x,idx)=>\`
    <label style="display:flex;gap:10px;align-items:center;border:1px solid #26324d;border-radius:12px;padding:10px">
      <input type="checkbox" class="chk" data-url="\${esc(x.url)}" onchange="countSel()" />
      <div style="flex:1">
        <div><b>\${esc(x.source)}</b> – <span class="small">\${esc(x.author||'')}</span></div>
        <div class="small"><a href="\${esc(x.page||x.url)}" target="_blank" style="color:#9db8ff">apri</a></div>
        <div class="small">\${esc(x.url)}</div>
      </div>
    </label>
  \`).join('');

  countSel();
  setStatus('✅ Foto trovate: ' + (j.foto||[]).length);
}

function closePhotos(){
  const modal = document.getElementById('photoModal');
  modal.style.display='none';
  modal.innerHTML='';
}

function countSel(){
  const modal = document.getElementById('photoModal');
  const chks = Array.from(modal.querySelectorAll('.chk'));
  const sel = chks.filter(c=>c.checked);
  modal.querySelector('#selCount').textContent = 'Selezionate: ' + sel.length + ' / 5';
  // blocco oltre 5
  if(sel.length>5){
    sel.slice(5).forEach(c=>c.checked=false);
    modal.querySelector('#selCount').textContent = 'Selezionate: 5 / 5';
  }
}

async function upload5(codice){
  const modal = document.getElementById('photoModal');
  const chks = Array.from(modal.querySelectorAll('.chk')).filter(c=>c.checked);
  if(chks.length!==5){ alert('Devi selezionare ESATTAMENTE 5 foto'); return; }

  const selectedUrls = chks.map(c=>c.dataset.url);
  setStatus('⏳ Upload FTP + scrittura Sheet per ' + codice);

  const r = await fetch('/api/photos/upload5', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({codice, selectedUrls})});
  const j = await r.json();
  setStatus(JSON.stringify(j,null,2));
  if(j.ok) closePhotos();
}

loadAll();
</script>

</body>
</html>`);
});

/* =========================================================
   START
   ========================================================= */
app.listen(PORT, () => {
  console.log(`🚀 SyncFED avviato sulla porta ${PORT}`);
});
