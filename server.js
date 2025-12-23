/**
 * SyncFED – Node 16 (Render)
 * - STEP 2: BMAN SOAP getAnagrafiche (filtri) + endpoint debug
 * - STEP 3: Export su Google Sheet
 * - Dashboard Vinted: lista articoli con Script=Approvato (da Google Sheet) + Download TXT
 *
 * NOTE IMPORTANTE (reale):
 * - Il server NON può scrivere nel “percorso locale” del tuo PC dal browser.
 *   Quello che possiamo fare correttamente è: generare il file .txt sul server e farlo scaricare al browser.
 *   Il percorso lo scegli dal browser (o dalle impostazioni download).
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import xml2js from "xml2js";
import { google } from "googleapis";

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" }));

const PORT = process.env.PORT || 10000;

/* =========================================================
   CONFIG BMAN (SOAP)
   ========================================================= */
const BMAN_ENDPOINT = "https://emporiodeanna.bman.it/bmanapi.asmx";
const BMAN_CHIAVE = String(process.env.BMAN_API_KEY || "").trim();

if (!BMAN_CHIAVE) console.error("❌ Variabile ambiente mancante: BMAN_API_KEY");

/* =========================================================
   NORMALIZZAZIONE
   ========================================================= */
function normalizeValue(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: action,
    },
    body: bodyXml,
  });
  return await resp.text();
}

async function parseSoapResult(xml, responseTag, resultTag) {
  const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
  return parsed?.["soap:Envelope"]?.["soap:Body"]?.[responseTag]?.[resultTag] ?? "";
}

/* =========================================================
   BMAN: getAnagrafiche (CORRETTO, CON FILTRI)
   ========================================================= */
async function getAnagrafiche({
  numeroPagina = 1,
  filtri = [],
  ordinamentoCampo = "ID",
  ordinamentoDirezione = 1,
  listaDepositi = [],
  dettaglioVarianti = false,
} = {}) {
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
      <dettaglioVarianti>${dettaglioVarianti ? "true" : "false"}</dettaglioVarianti>
    </getAnagrafiche>
  </soap:Body>
</soap:Envelope>`.trim();

  const xml = await soapCall({
    action: "http://cloud.bman.it/getAnagrafiche",
    bodyXml: soapBody,
  });

  const result = await parseSoapResult(xml, "getAnagraficheResponse", "getAnagraficheResult");
  const data = safeJsonParse(result || "[]", []);
  return Array.isArray(data) ? data : [];
}

/* =========================================================
   STEP 2 – TUTTI GLI ARTICOLI Script=SI (PAGINATI)
   ========================================================= */
async function getAllScriptSiArticles() {
  const filtri = [{ chiave: "opzionale11", operatore: "=", valore: "si" }];

  let page = 1;
  const out = [];

  while (true) {
    const chunk = await getAnagrafiche({
      numeroPagina: page,
      filtri,
      ordinamentoCampo: "ID",
      ordinamentoDirezione: 1,
      listaDepositi: [],
      dettaglioVarianti: false,
    });

    if (!chunk.length) break;

    const filtrati = chunk.filter((a) => normalizeValue(a?.opzionale11) === "si");
    out.push(...filtrati);

    if (chunk.length < 50) break;
    page += 1;
    if (page > 500) break; // safety
  }

  return out;
}

/* =========================================================
   GOOGLE SHEETS (RAW KEY)
   ========================================================= */
function getRequiredEnv(name) {
  return String(process.env[name] ?? "").trim();
}

function getGoogleCredsRaw() {
  const missing = ["GOOGLE_SHEET_ID", "GOOGLE_CLIENT_EMAIL", "GOOGLE_PRIVATE_KEY"].filter(
    (k) => !getRequiredEnv(k)
  );
  if (missing.length) return { ok: false, missing };

  const sheetId = getRequiredEnv("GOOGLE_SHEET_ID");
  const clientEmail = getRequiredEnv("GOOGLE_CLIENT_EMAIL");
  const privateKey = getRequiredEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n").trim();

  return { ok: true, sheetId, clientEmail, privateKey };
}

async function getSheetsClient() {
  const creds = getGoogleCredsRaw();
  if (!creds.ok) {
    const err = new Error("Variabili ambiente mancanti");
    err.code = "MISSING_ENV";
    err.missing = creds.missing;
    throw err;
  }

  const auth = new google.auth.JWT({
    email: creds.clientEmail,
    key: creds.privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  await auth.authorize();
  return { sheets: google.sheets({ version: "v4", auth }), sheetId: creds.sheetId };
}

async function ensureSheet(sheetsApi, sheetId, sheetTitle) {
  const meta = await sheetsApi.spreadsheets.get({ spreadsheetId: sheetId });
  const exists = (meta?.data?.sheets || []).some((s) => s?.properties?.title === sheetTitle);
  if (exists) return;

  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: sheetTitle } } }] },
  });
}

async function writeRange(sheetsApi, sheetId, range, values) {
  await sheetsApi.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}

async function clearRange(sheetsApi, sheetId, range) {
  await sheetsApi.spreadsheets.values.clear({ spreadsheetId: sheetId, range });
}

async function readRange(sheetsApi, sheetId, range) {
  const resp = await sheetsApi.spreadsheets.values.get({ spreadsheetId: sheetId, range });
  return resp?.data?.values || [];
}

/* =========================================================
   SHEET: TAB + HEADERS (con i tuoi nuovi campi)
   ========================================================= */
const SHEET_TAB = (process.env.GOOGLE_SHEET_TAB || "PRODOTTI_BMAN").trim();

const SHEET_HEADERS = [
  "ID",
  "Codice",
  "Titolo",
  "Brand",
  "Tag15",
  "Script",
  "Descrizione_IT",
  "Titolo_FR",         // opzionale6
  "Descrizione_FR",
  "Titolo_ES",         // opzionale8
  "Descrizione_ES",
  "Titolo_DE",         // opzionale9
  "Descrizione_DE",
  "Titolo_EN",         // opzionale7
  "Descrizione_EN",
  "Categoria_Vinted",  // opzionale10 (non obbligatoria)
  "Prezzo_Negozio",
  "Prezzo_Online",
  "Foto_1",
  "Foto_2",
  "Foto_3",
  "Foto_4",
  "Foto_5",
  "UltimoSync",
];

function nowIso() {
  return new Date().toISOString();
}

function toSheetRow(a) {
  const titoloIT = a?.opzionale2 ?? a?.Titolo ?? "";
  const brand = a?.opzionale1 ?? "";
  const script = a?.opzionale11 ?? "";
  const descIT = (a?.opzionale12 ?? a?.descrizioneHtml ?? "").toString().trim();

  const titoloFR = a?.opzionale6 ?? "";
  const titoloEN = a?.opzionale7 ?? "";
  const titoloES = a?.opzionale8 ?? "";
  const titoloDE = a?.opzionale9 ?? "";
  const catVinted = a?.opzionale10 ?? "";

  // prezzi: se BMAN li passa, li mettiamo (altrimenti vuoto)
  const prezzoNegozio = a?.prza ?? "";
  const prezzoOnline = a?.przb ?? "";

  // foto: se BMAN ha array arrFoto o campi singoli, qui lasciamo vuoto (le gestisci dopo)
  return [
    a?.ID ?? "",
    a?.codice ?? "",
    titoloIT ?? "",
    brand ?? "",
    "",                 // Tag15 (lo generi tu o step successivo)
    script ?? "",
    descIT ?? "",
    titoloFR ?? "",
    "",                 // Descrizione_FR (se la metti tu)
    titoloES ?? "",
    "",                 // Descrizione_ES
    titoloDE ?? "",
    "",                 // Descrizione_DE
    titoloEN ?? "",
    "",                 // Descrizione_EN
    catVinted ?? "",
    prezzoNegozio ?? "",
    prezzoOnline ?? "",
    "", "", "", "", "", // Foto_1..Foto_5
    nowIso(),
  ];
}

/* =========================================================
   UTIL: trova riga (da Google Sheet) per CODICE
   ========================================================= */
async function getSheetRowsWithHeader(sheetsApi, sheetId, tab) {
  const values = await readRange(sheetsApi, sheetId, `${tab}!A1:Z`);
  const header = values[0] || [];
  const rows = values.slice(1);
  return { header, rows };
}

function idxOf(header, colName) {
  const i = header.findIndex((h) => String(h).trim() === colName);
  return i;
}

async function findRowIndexByCodice(sheetsApi, sheetId, tab, codice) {
  const { header, rows } = await getSheetRowsWithHeader(sheetsApi, sheetId, tab);
  const idxCodice = idxOf(header, "Codice");
  if (idxCodice < 0) return null;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || [];
    if (String(row[idxCodice] ?? "").trim() === String(codice).trim()) {
      return { rowIndex1Based: i + 2, header, row };
    }
  }
  return null;
}

/* =========================================================
   HOME UI (root /) – pulsanti per funzioni
   ========================================================= */
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>SyncFED – Controllo Operativo</title>
  <style>
    body{font-family:Arial,Helvetica,sans-serif;padding:18px;background:#0b0f17;color:#e8eefc}
    h1{margin:0 0 12px}
    .row{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0;align-items:center}
    button{padding:10px 12px;border:0;border-radius:10px;cursor:pointer;font-weight:700}
    .primary{background:#4c7dff;color:#fff}
    .ok{background:#1fda85;color:#06110b}
    .warn{background:#ffcd4c;color:#1d1400}
    a{color:#9db8ff}
    pre{white-space:pre-wrap;background:#111a2b;border:1px solid #26324d;border-radius:12px;padding:12px}
    .card{background:#111a2b;border:1px solid #26324d;border-radius:14px;padding:12px;margin-top:10px}
    .small{font-size:12px;opacity:.85}
  </style>
</head>
<body>
  <h1>🚀 SyncFED – Controllo Operativo</h1>

  <div class="card">
    <div class="row">
      <button class="primary" onclick="callApi('/api/step3/export-all-script-si')">Export Script=SI su Google Sheet</button>
      <button class="ok" onclick="openDash()">Apri Dashboard Vinted</button>
      <button class="warn" onclick="callApi('/api/test/google-key')">Test Google Key</button>
      <a class="small" href="/api/step2/script-si-all" target="_blank">STEP2 (debug JSON)</a>
    </div>
    <div class="small">Risultato:</div>
    <pre id="out">{}</pre>
  </div>

<script>
async function callApi(path){
  const out = document.getElementById('out');
  out.textContent = "⏳ chiamata in corso: " + path;
  try{
    const r = await fetch(path);
    const j = await r.json();
    out.textContent = JSON.stringify(j,null,2);
  }catch(e){
    out.textContent = "❌ errore: " + (e && e.message ? e.message : String(e));
  }
}
function openDash(){ window.location.href = "/dashboard"; }
</script>

</body>
</html>`);
});

/* =========================================================
   API: TEST GOOGLE KEY (da browser)
   ========================================================= */
app.get("/api/test/google-key", async (req, res) => {
  try {
    const { sheets, sheetId } = await getSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });

    res.json({
      ok: true,
      message: "Chiave Google valida – JWT firmato correttamente",
      node: process.version,
      spreadsheetTitle: meta?.data?.properties?.title || "",
      tabDefault: SHEET_TAB,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
      code: err.code || "n/a",
      missing: err.missing || undefined,
    });
  }
});

/* =========================================================
   API: STEP 2 – lista completa Script=SI (BMAN)
   ========================================================= */
app.get("/api/step2/script-si-all", async (req, res) => {
  try {
    const articoli = await getAllScriptSiArticles();
    res.json({ ok: true, step: "STEP 2 – Script=SI (ALL)", totale: articoli.length, articoli });
  } catch (err) {
    console.error("❌ STEP2 error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   API: STEP 3 – EXPORT ALL Script=SI su Google Sheet
   ========================================================= */
app.get("/api/step3/export-all-script-si", async (req, res) => {
  try {
    const articoli = await getAllScriptSiArticles();

    const { sheets, sheetId } = await getSheetsClient();
    await ensureSheet(sheets, sheetId, SHEET_TAB);

    // header + clear + write
    const colEnd = String.fromCharCode("A".charCodeAt(0) + (SHEET_HEADERS.length - 1)); // A..?
    await writeRange(sheets, sheetId, `${SHEET_TAB}!A1:${colEnd}1`, [SHEET_HEADERS]);
    await clearRange(sheets, sheetId, `${SHEET_TAB}!A2:${colEnd}`);

    const rows = articoli.map(toSheetRow);
    if (rows.length) {
      await writeRange(sheets, sheetId, `${SHEET_TAB}!A2`, rows);
    }

    res.json({
      ok: true,
      step: "STEP 3 – Google Sheet (export ALL Script=SI)",
      sheet: SHEET_TAB,
      letti: articoli.length,
      scritto: true,
    });
  } catch (err) {
    console.error("❌ STEP3 export error:", err);
    res.status(500).json({
      ok: false,
      error: err.message,
      code: err.code || "n/a",
      missing: err.missing || undefined,
    });
  }
});

/* =========================================================
   VINTED: LISTA APPROVATI (da Google Sheet)
   Script = "Approvato" (case-insensitive)
   ========================================================= */
app.get("/api/vinted/list-approvati", async (req, res) => {
  try {
    const { sheets, sheetId } = await getSheetsClient();
    await ensureSheet(sheets, sheetId, SHEET_TAB);

    const { header, rows } = await getSheetRowsWithHeader(sheets, sheetId, SHEET_TAB);

    const iCod = idxOf(header, "Codice");
    const iDescIt = idxOf(header, "Descrizione_IT");
    const iScript = idxOf(header, "Script");

    if (iCod < 0 || iDescIt < 0 || iScript < 0) {
      return res.status(500).json({
        ok: false,
        error: "Header non valido sullo sheet. Mancano colonne richieste (Codice/Descrizione_IT/Script).",
      });
    }

    const out = rows
      .map((r) => ({
        codice: String(r[iCod] ?? "").trim(),
        descrizione_it: String(r[iDescIt] ?? "").trim(),
        script: String(r[iScript] ?? "").trim(),
      }))
      .filter((x) => x.codice && normalizeValue(x.script) === "approvato");

    res.json({ ok: true, totale: out.length, articoli: out });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, code: err.code || "n/a" });
  }
});

/* =========================================================
   VINTED: CHECK + DOWNLOAD TXT (da Google Sheet)
   Requisiti "PRONTO PER VINTED":
   - almeno 1 foto (Foto_1)
   - Descrizione_IT
   - Titolo_FR + Descrizione_FR
   - Titolo_ES + Descrizione_ES
   (Categoria_Vinted NON obbligatoria)
   ========================================================= */
app.get("/api/vinted/download-txt", async (req, res) => {
  try {
    const codice = String(req.query?.codice ?? "").trim();
    if (!codice) return res.status(400).send("codice mancante");

    const { sheets, sheetId } = await getSheetsClient();
    await ensureSheet(sheets, sheetId, SHEET_TAB);

    const found = await findRowIndexByCodice(sheets, sheetId, SHEET_TAB, codice);
    if (!found) return res.status(404).send("codice non trovato sullo sheet");

    const { header, row } = found;

    const get = (name) => {
      const i = idxOf(header, name);
      return i >= 0 ? String(row[i] ?? "").trim() : "";
    };

    const titoloIT = get("Titolo");
    const descIT = get("Descrizione_IT");
    const titoloFR = get("Titolo_FR");
    const descFR = get("Descrizione_FR");
    const titoloES = get("Titolo_ES");
    const descES = get("Descrizione_ES");

    const foto1 = get("Foto_1");
    const prezzoNegozio = get("Prezzo_Negozio");
    const prezzoOnline = get("Prezzo_Online");

    const missing = [];
    if (!foto1) missing.push("Foto_1");
    if (!descIT) missing.push("Descrizione_IT");
    if (!titoloFR) missing.push("Titolo_FR");
    if (!descFR) missing.push("Descrizione_FR");
    if (!titoloES) missing.push("Titolo_ES");
    if (!descES) missing.push("Descrizione_ES");

    if (missing.length) {
      // Non pronto => niente download
      res.status(400).json({
        ok: false,
        pronto: false,
        error: "NON PRONTO PER VINTED: campi mancanti",
        missing,
        codice,
      });
      return;
    }

    const txt = [
      `CODICE: ${codice}`,
      "",
      "=== ITALIANO ===",
      "TITOLO:",
      titoloIT || "",
      "",
      "DESCRIZIONE:",
      descIT || "",
      "",
      "=== FRANÇAIS ===",
      "TITRE:",
      titoloFR || "",
      "",
      "DESCRIPTION:",
      descFR || "",
      "",
      "=== ESPAÑOL ===",
      "TÍTULO:",
      titoloES || "",
      "",
      "DESCRIPCIÓN:",
      descES || "",
      "",
      "PREZZO LISTINO NEGOZIO:",
      prezzoNegozio || "",
      "",
      "PREZZO LISTINO ONLINE:",
      prezzoOnline || "",
      "",
    ].join("\n");

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${codice}.txt"`);
    res.send(txt);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/* =========================================================
   DASHBOARD – mostra solo Script=Approvato + pulsante PRONTO PER VINTED
   ========================================================= */
app.get("/dashboard", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>SyncFED – Vinted Dashboard</title>
  <style>
    body{font-family:Arial,Helvetica,sans-serif;padding:18px;background:#0b0f17;color:#e8eefc}
    h1{margin:0 0 12px}
    .row{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0;align-items:center}
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
    a{color:#9db8ff}
    pre{white-space:pre-wrap;background:#0b0f17;border:1px solid #26324d;border-radius:12px;padding:10px}
  </style>
</head>
<body>
  <h1>📦 SyncFED – Vinted Dashboard</h1>

  <div class="card">
    <div class="row">
      <button class="primary" onclick="goHome()">⬅ Torna alla Home</button>
      <button class="ok" onclick="load()">Ricarica (Script=Approvato)</button>
      <a class="small" href="/api/test/google-key" target="_blank">Test Google Key</a>
    </div>
    <div class="row">
      <div>
        <div class="small">Filtro (codice o testo descrizione)</div>
        <input id="q" placeholder="es: 8050 / spray / presa..." oninput="render()" />
      </div>
    </div>
    <div class="small" id="status"></div>
    <pre id="detail" style="display:none"></pre>
  </div>

  <div class="card">
    <table>
      <thead>
        <tr>
          <th>Codice</th>
          <th>Descrizione IT</th>
          <th>Vinted</th>
          <th>Download</th>
        </tr>
      </thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>

<script>
let DATA = [];

function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]))}
function setStatus(t){ document.getElementById('status').textContent = t; }
function showDetail(obj){
  const pre = document.getElementById('detail');
  pre.style.display = 'block';
  pre.textContent = JSON.stringify(obj,null,2);
}

function goHome(){ window.location.href = "/"; }

async function load(){
  setStatus('⏳ Carico articoli con Script=Approvato dal Google Sheet...');
  const r = await fetch('/api/vinted/list-approvati');
  const j = await r.json();
  if(!j.ok){ setStatus('❌ ' + (j.error||'errore')); showDetail(j); return; }
  DATA = j.articoli || [];
  setStatus('✅ Articoli trovati: ' + DATA.length);
  render();
}

function render(){
  const q = (document.getElementById('q').value||'').toLowerCase().trim();
  const rows = q
    ? DATA.filter(a=>{
        const c=(a.codice||'').toLowerCase();
        const d=(a.descrizione_it||'').toLowerCase();
        return c.includes(q) || d.includes(q);
      })
    : DATA;

  const tb = document.getElementById('tbody');
  tb.innerHTML = rows.map(a=>{
    const codice = esc(a.codice||'');
    const desc = esc(a.descrizione_it||'');
    return \`
      <tr>
        <td><b>\${codice}</b></td>
        <td>\${desc || '<span class="small">—</span>'}</td>
        <td><span class="ok" style="padding:6px 10px;border-radius:10px;display:inline-block">APPROVATO</span></td>
        <td>
          <button class="primary" onclick="downloadTxt('\${codice}')">PRONTO PER VINTED</button>
          <div class="small">Scarica il file .txt (se mancano campi ti avvisa)</div>
        </td>
      </tr>\`;
  }).join('');
}

async function downloadTxt(codice){
  setStatus('⏳ Verifica + download per ' + codice);

  // proviamo prima a chiamare l'endpoint: se NON pronto ritorna JSON 400
  const url = '/api/vinted/download-txt?codice=' + encodeURIComponent(codice);

  // fetch per intercettare eventuale JSON errore
  const r = await fetch(url);
  const ct = (r.headers.get('content-type')||'').toLowerCase();

  if(!r.ok){
    if(ct.includes('application/json')){
      const j = await r.json();
      setStatus('❌ NON pronto per Vinted: campi mancanti');
      showDetail(j);
      alert('NON PRONTO PER VINTED. Vedi dettagli nel riquadro.');
      return;
    }
    const t = await r.text();
    setStatus('❌ Errore: ' + t);
    alert('Errore: ' + t);
    return;
  }

  // OK => è un file txt in attachment: per sicurezza lo scarichiamo via link
  setStatus('✅ PRONTO PER VINTED. Download in corso...');
  window.location.href = url;
}

load();
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
