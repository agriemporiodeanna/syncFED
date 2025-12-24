/**
 * SyncFED – Node 16 (Render) – PRODUZIONE
 * Base: IL TUO server.js (quello incollato da te) + implementazione STEP A + STEP B
 *
 * STEP A
 * - Aggiunge colonna PRONTO_PER_VINTED (TRUE/FALSE) e la calcola con regola business:
 *   PRONTO_PER_VINTED = TRUE se:
 *   ✅ Script = Approvato
 *   ✅ Foto_1..Foto_5 presenti
 *   ✅ Descrizione_IT presente
 *   ✅ Titolo_FR presente
 *   ✅ Descrizione_FR presente
 *   ✅ Titolo_ES presente
 *   ✅ Descrizione_ES presente
 *
 * STEP B
 * - Export su Google Sheet includendo articoli con Script = "si" e Script = "Approvato"
 * - 🔒 Blocca export se lo Sheet NON è sincronizzato (header diverso)
 * - 🔁 Delta sync: aggiorna SOLO righe modificate + aggiunge nuove righe
 *
 * NOTE:
 * - Manteniamo la tua HOME (/) con pulsanti, e la tua Dashboard (/dashboard) per Script=Approvato + download TXT.
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

function nowIso() {
  return new Date().toISOString();
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
   STEP 2 – TUTTI GLI ARTICOLI con Script IN {si, approvato} (PAGINATI)
   ========================================================= */
async function getAllArticlesByScriptValues(scriptValues = ["si", "approvato"]) {
  const wanted = new Set(scriptValues.map((x) => normalizeValue(x)));

  const outByCodice = new Map();

  for (const sv of scriptValues) {
    const filtri = [{ chiave: "opzionale11", operatore: "=", valore: sv }];

    let page = 1;

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

      // sicurezza extra: filtro server-side
      for (const a of chunk) {
        const scriptNorm = normalizeValue(a?.opzionale11);
        const codice = String(a?.codice ?? "").trim();
        if (!codice) continue;
        if (!wanted.has(scriptNorm)) continue;

        // dedup per codice (se arrivasse da 2 query, preferiamo "approvato")
        const existing = outByCodice.get(codice);
        if (!existing) {
          outByCodice.set(codice, a);
        } else {
          const ex = normalizeValue(existing?.opzionale11);
          if (ex !== "approvato" && scriptNorm === "approvato") {
            outByCodice.set(codice, a);
          }
        }
      }

      if (chunk.length < 50) break;
      page += 1;
      if (page > 500) break; // safety
    }
  }

  // ritorno ordinato per ID se possibile
  const arr = Array.from(outByCodice.values());
  arr.sort((a, b) => {
    const ida = Number(a?.ID ?? a?.Id ?? 0) || 0;
    const idb = Number(b?.ID ?? b?.Id ?? 0) || 0;
    return ida - idb;
  });
  return arr;
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

async function readRange(sheetsApi, sheetId, range) {
  const resp = await sheetsApi.spreadsheets.values.get({ spreadsheetId: sheetId, range });
  return resp?.data?.values || [];
}

async function appendRows(sheetsApi, sheetId, rangeA1, values) {
  // rangeA1 es: "TAB!A2"
  await sheetsApi.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: rangeA1,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

/* =========================================================
   SHEET: TAB + HEADERS (con i tuoi nuovi campi) + PRONTO_PER_VINTED
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
  "Titolo_FR", // opzionale6
  "Descrizione_FR",
  "Titolo_ES", // opzionale8
  "Descrizione_ES",
  "Titolo_DE", // opzionale9
  "Descrizione_DE",
  "Titolo_EN", // opzionale7
  "Descrizione_EN",
  "Categoria_Vinted", // opzionale10 (non obbligatoria)
  "Prezzo_Negozio",
  "Prezzo_Online",
  "Foto_1",
  "Foto_2",
  "Foto_3",
  "Foto_4",
  "Foto_5",
  "PRONTO_PER_VINTED", // ✅ NUOVA COLONNA (STEP A)
  "UltimoSync",
];

// Converte indice (0-based) in lettera colonna (A..Z..AA..)
function colToA1(colIndex0) {
  let n = colIndex0 + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function toSheetRowFromBman(a) {
  const titoloIT = a?.opzionale2 ?? a?.Titolo ?? "";
  const brand = a?.opzionale1 ?? "";
  const script = a?.opzionale11 ?? "";
  const descIT = (a?.opzionale12 ?? a?.descrizioneHtml ?? "").toString().trim();

  const titoloFR = a?.opzionale6 ?? "";
  const titoloEN = a?.opzionale7 ?? "";
  const titoloES = a?.opzionale8 ?? "";
  const titoloDE = a?.opzionale9 ?? "";
  const catVinted = a?.opzionale10 ?? "";

  const prezzoNegozio = a?.prza ?? "";
  const prezzoOnline = a?.przb ?? "";

  // Le descrizioni FR/ES/DE/EN e le foto sono curate a parte nello sheet (manuale o step successivo)
  // Qui NON le sovrascriviamo se già presenti (delta sync le manterrà se non modifichiamo quel campo)
  // Quindi le mettiamo vuote SOLO per nuove righe.
  const baseRow = [
    a?.ID ?? "",
    a?.codice ?? "",
    titoloIT ?? "",
    brand ?? "",
    "", // Tag15
    script ?? "",
    descIT ?? "",
    titoloFR ?? "",
    "", // Descrizione_FR
    titoloES ?? "",
    "", // Descrizione_ES
    titoloDE ?? "",
    "", // Descrizione_DE
    titoloEN ?? "",
    "", // Descrizione_EN
    catVinted ?? "",
    prezzoNegozio ?? "",
    prezzoOnline ?? "",
    "", // Foto_1
    "", // Foto_2
    "", // Foto_3
    "", // Foto_4
    "", // Foto_5
    "FALSE", // PRONTO_PER_VINTED (verrà ricalcolato dopo)
    nowIso(),
  ];

  return baseRow;
}

/* =========================================================
   STEP A – BUSINESS RULE PRONTO_PER_VINTED
   ========================================================= */
function isTruthyCell(v) {
  return String(v ?? "").trim() !== "";
}

function calcProntoPerVintedFromRowObj(rowObj) {
  // Regola BUSINESS (importantissima)
  // TRUE se Script=Approvato + Foto_1..5 + Descr_IT + Titolo/Descr FR + Titolo/Descr ES
  const scriptOk = normalizeValue(rowObj.Script) === "approvato";

  const fotoOk =
    isTruthyCell(rowObj.Foto_1) &&
    isTruthyCell(rowObj.Foto_2) &&
    isTruthyCell(rowObj.Foto_3) &&
    isTruthyCell(rowObj.Foto_4) &&
    isTruthyCell(rowObj.Foto_5);

  const itOk = isTruthyCell(rowObj.Descrizione_IT);

  const frOk = isTruthyCell(rowObj.Titolo_FR) && isTruthyCell(rowObj.Descrizione_FR);

  const esOk = isTruthyCell(rowObj.Titolo_ES) && isTruthyCell(rowObj.Descrizione_ES);

  return scriptOk && fotoOk && itOk && frOk && esOk;
}

/* =========================================================
   SHEET UTIL – header/indice
   ========================================================= */
function headersEqualStrict(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (String(a[i] ?? "").trim() !== String(b[i] ?? "").trim()) return false;
  }
  return true;
}

function idxOf(header, colName) {
  return header.findIndex((h) => String(h).trim() === colName);
}

async function getSheetAllValues(sheetsApi, sheetId, tab) {
  // leggiamo un range ampio: fino a AD (più che sufficiente)
  const endCol = colToA1(SHEET_HEADERS.length - 1);
  const values = await readRange(sheetsApi, sheetId, `${tab}!A1:${endCol}`);
  const header = values[0] || [];
  const rows = values.slice(1);
  return { header, rows, endCol };
}

function rowToObj(header, row) {
  const obj = {};
  for (let i = 0; i < header.length; i += 1) {
    const k = String(header[i] ?? "").trim();
    if (!k) continue;
    obj[k] = String(row?.[i] ?? "").trim();
  }
  return obj;
}

/* =========================================================
   STEP B – EXPORT + DELTA SYNC + BLOCCO SE SHEET NON SYNC
   ========================================================= */
async function exportDeltaScriptSiAndApprovato({ dryRun = false } = {}) {
  const articoli = await getAllArticlesByScriptValues(["si", "Approvato"]);

  const { sheets, sheetId } = await getSheetsClient();
  await ensureSheet(sheets, sheetId, SHEET_TAB);

  const { header: existingHeader, rows: existingRows, endCol } = await getSheetAllValues(
    sheets,
    sheetId,
    SHEET_TAB
  );

  // se sheet vuoto => inizializziamo header (non è "non sincronizzato", è prima installazione)
  const sheetIsEmpty = (existingHeader || []).length === 0;

  if (sheetIsEmpty) {
    if (!dryRun) {
      await writeRange(sheets, sheetId, `${SHEET_TAB}!A1:${endCol}1`, [SHEET_HEADERS]);
    }
    return {
      ok: true,
      mode: "init",
      writtenHeader: true,
      updated: 0,
      inserted: articoli.length,
      blocked: false,
      note: "Sheet inizializzato: header scritto. Ora riesegui export per popolare (delta).",
    };
  }

  // 🔒 BLOCCO EXPORT SE HEADER DIVERSO
  if (!headersEqualStrict(existingHeader, SHEET_HEADERS)) {
    return {
      ok: false,
      blocked: true,
      error: "🔒 Export bloccato: lo Sheet NON è sincronizzato (header diverso).",
      expectedHeader: SHEET_HEADERS,
      currentHeader: existingHeader,
      hint:
        "Allinea manualmente le intestazioni (prima riga) allo schema atteso, oppure svuota il foglio e lascia che SyncFED lo inizializzi.",
    };
  }

  // map codice -> {rowIndex1Based, rowArray}
  const iCod = idxOf(existingHeader, "Codice");
  if (iCod < 0) {
    return { ok: false, blocked: true, error: "Header non valido: manca colonna Codice" };
  }

  const existingMap = new Map();
  for (let i = 0; i < existingRows.length; i += 1) {
    const r = existingRows[i] || [];
    const codice = String(r[iCod] ?? "").trim();
    if (!codice) continue;
    existingMap.set(codice, { rowIndex1Based: i + 2, row: r });
  }

  // colonne principali che arrivano da BMAN e che vogliamo tenere sincronizzate
  const syncCols = [
    "ID",
    "Codice",
    "Titolo",
    "Brand",
    "Script",
    "Descrizione_IT",
    "Titolo_FR",
    "Descrizione_FR",
    "Titolo_ES",
    "Descrizione_ES",
    "Titolo_DE",
    "Titolo_EN",
    "Categoria_Vinted",
    "Prezzo_Negozio",
    "Prezzo_Online",
    // NB: Tag15, descrizioni lingue, foto NON le sovrascriviamo qui (restano manuali/step successivo)
  ];

  const idx = {};
  for (const c of SHEET_HEADERS) idx[c] = idxOf(existingHeader, c);

  const updates = []; // {range, values:[[...]]}
  const inserts = []; // array di row complete (nuove righe)

  let updatedCount = 0;
  let insertedCount = 0;

  for (const a of articoli) {
    const newBaseRow = toSheetRowFromBman(a);
    const codice = String(a?.codice ?? "").trim();
    if (!codice) continue;

    const found = existingMap.get(codice);

    if (!found) {
      // Nuova riga: inseriamo completa.
      // PRONTO_PER_VINTED rimarrà FALSE perché mancano foto/descrizioni FR/ES.
      inserts.push(newBaseRow);
      insertedCount += 1;
      continue;
    }

    // esistente: costruiamo una riga "merged" partendo dall'esistente e aggiornando SOLO syncCols + UltimoSync
    const existingRow = found.row.slice(); // clone
    const existingObj = rowToObj(existingHeader, existingRow);

    // ricaviamo i valori "nuovi" per i campi che sincronizziamo
    const newObj = rowToObj(SHEET_HEADERS, newBaseRow);

    let changed = false;

    for (const colName of syncCols) {
      const i = idx[colName];
      if (i < 0) continue;

      const oldV = String(existingRow[i] ?? "").trim();
      const newV = String(newObj[colName] ?? "").trim();

      if (oldV !== newV) {
        existingRow[i] = newV;
        changed = true;
      }
    }

    // UltimoSync sempre aggiornato se c'è cambiamento (o anche sempre? qui solo se cambia qualcosa)
    const iUlt = idx["UltimoSync"];
    if (iUlt >= 0 && changed) {
      existingRow[iUlt] = nowIso();
    }

    // STEP A: ricalcolo PRONTO_PER_VINTED (sempre, perché magari l'operatore ha aggiunto foto/descrizioni)
    const iPronto = idx["PRONTO_PER_VINTED"];
    if (iPronto >= 0) {
      const mergedObj = rowToObj(existingHeader, existingRow);
      const pronto = calcProntoPerVintedFromRowObj(mergedObj) ? "TRUE" : "FALSE";
      const oldP = String(existingRow[iPronto] ?? "").trim();
      if (oldP !== pronto) {
        existingRow[iPronto] = pronto;
        changed = true; // perché dobbiamo scrivere anche questo
        if (iUlt >= 0) existingRow[iUlt] = nowIso();
      }
    }

    if (!changed) continue;

    // range intera riga A..endCol
    const rowIndex = found.rowIndex1Based;
    const range = `${SHEET_TAB}!A${rowIndex}:${endCol}${rowIndex}`;

    updates.push({ range, values: [existingRow] });
    updatedCount += 1;
  }

  if (dryRun) {
    return {
      ok: true,
      mode: "dryRun",
      blocked: false,
      totalFromBman: articoli.length,
      updated: updatedCount,
      inserted: insertedCount,
    };
  }

  // Eseguo update in batch (values.batchUpdate)
  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: updates,
      },
    });
  }

  // Append nuove righe
  if (inserts.length) {
    await appendRows(sheets, sheetId, `${SHEET_TAB}!A2`, inserts);
  }

  return {
    ok: true,
    mode: "delta",
    blocked: false,
    totalFromBman: articoli.length,
    updated: updatedCount,
    inserted: insertedCount,
  };
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
      <button class="primary" onclick="callApi('/api/step3/export-delta')">Export DELTA (Script=SI + Approvato)</button>
      <button class="ok" onclick="openDash()">Apri Dashboard Vinted</button>
      <button class="warn" onclick="callApi('/api/test/google-key')">Test Google Key</button>
      <a class="small" href="/api/step2/script-si-approvato-all" target="_blank">STEP2 (debug JSON)</a>
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
    const ct = (r.headers.get('content-type')||'').toLowerCase();
    if(ct.includes('application/json')){
      const j = await r.json();
      out.textContent = JSON.stringify(j,null,2);
    }else{
      const t = await r.text();
      out.textContent = t;
    }
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
   API: STEP 2 – lista completa Script=SI + Script=Approvato (BMAN)
   ========================================================= */
app.get("/api/step2/script-si-approvato-all", async (req, res) => {
  try {
    const articoli = await getAllArticlesByScriptValues(["si", "Approvato"]);
    res.json({
      ok: true,
      step: "STEP 2 – Script in {SI, Approvato} (ALL)",
      totale: articoli.length,
      articoli,
    });
  } catch (err) {
    console.error("❌ STEP2 error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   API: STEP 3 – EXPORT DELTA (Script=SI + Approvato) + STEP A (PRONTO_PER_VINTED)
   ========================================================= */
app.get("/api/step3/export-delta", async (req, res) => {
  try {
    const result = await exportDeltaScriptSiAndApprovato({ dryRun: false });
    if (!result.ok) return res.status(409).json(result);
    res.json({ ok: true, step: "STEP 3 – Export DELTA + PRONTO_PER_VINTED", sheet: SHEET_TAB, ...result });
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
   API: STEP 3 – DRY RUN (vedi quante righe cambierebbero)
   ========================================================= */
app.get("/api/step3/export-delta-dryrun", async (req, res) => {
  try {
    const result = await exportDeltaScriptSiAndApprovato({ dryRun: true });
    if (!result.ok) return res.status(409).json(result);
    res.json({ ok: true, step: "STEP 3 – DryRun", sheet: SHEET_TAB, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, code: err.code || "n/a" });
  }
});

/* =========================================================
   VINTED: LISTA APPROVATI (da Google Sheet)
   - include PRONTO_PER_VINTED
   ========================================================= */
app.get("/api/vinted/list-approvati", async (req, res) => {
  try {
    const { sheets, sheetId } = await getSheetsClient();
    await ensureSheet(sheets, sheetId, SHEET_TAB);

    const { header, rows } = await getSheetAllValues(sheets, sheetId, SHEET_TAB);

    const iCod = idxOf(header, "Codice");
    const iDescIt = idxOf(header, "Descrizione_IT");
    const iScript = idxOf(header, "Script");
    const iPronto = idxOf(header, "PRONTO_PER_VINTED");

    if (iCod < 0 || iDescIt < 0 || iScript < 0) {
      return res.status(500).json({
        ok: false,
        error:
          "Header non valido sullo sheet. Mancano colonne richieste (Codice/Descrizione_IT/Script).",
      });
    }

    const out = rows
      .map((r) => ({
        codice: String(r[iCod] ?? "").trim(),
        descrizione_it: String(r[iDescIt] ?? "").trim(),
        script: String(r[iScript] ?? "").trim(),
        pronto_per_vinted: iPronto >= 0 ? String(r[iPronto] ?? "").trim() : "",
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
   - Foto_1..Foto_5
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

    const { header, rows } = await getSheetAllValues(sheets, sheetId, SHEET_TAB);
    const iCod = idxOf(header, "Codice");
    if (iCod < 0) return res.status(500).send("Header non valido: manca Codice");

    let foundRow = null;
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i] || [];
      if (String(r[iCod] ?? "").trim() === codice) {
        foundRow = r;
        break;
      }
    }
    if (!foundRow) return res.status(404).send("codice non trovato sullo sheet");

    const get = (name) => {
      const i = idxOf(header, name);
      return i >= 0 ? String(foundRow[i] ?? "").trim() : "";
    };

    const titoloIT = get("Titolo");
    const descIT = get("Descrizione_IT");
    const titoloFR = get("Titolo_FR");
    const descFR = get("Descrizione_FR");
    const titoloES = get("Titolo_ES");
    const descES = get("Descrizione_ES");

    const foto1 = get("Foto_1");
    const foto2 = get("Foto_2");
    const foto3 = get("Foto_3");
    const foto4 = get("Foto_4");
    const foto5 = get("Foto_5");

    const prezzoNegozio = get("Prezzo_Negozio");
    const prezzoOnline = get("Prezzo_Online");

    const missing = [];
    if (!foto1) missing.push("Foto_1");
    if (!foto2) missing.push("Foto_2");
    if (!foto3) missing.push("Foto_3");
    if (!foto4) missing.push("Foto_4");
    if (!foto5) missing.push("Foto_5");
    if (!descIT) missing.push("Descrizione_IT");
    if (!titoloFR) missing.push("Titolo_FR");
    if (!descFR) missing.push("Descrizione_FR");
    if (!titoloES) missing.push("Titolo_ES");
    if (!descES) missing.push("Descrizione_ES");

    if (missing.length) {
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
   DASHBOARD – Script=Approvato + pulsante PRONTO PER VINTED
   (se pronto scarica TXT, se non pronto mostra dettagli)
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
    .pill{padding:6px 10px;border-radius:10px;display:inline-block;font-weight:800}
    .pill-ok{background:#1fda85;color:#06110b}
    .pill-no{background:#ff5c5c;color:#fff}
    .pill-warn{background:#ffcd4c;color:#1d1400}
  </style>
</head>
<body>
  <h1>📦 SyncFED – Vinted Dashboard</h1>

  <div class="card">
    <div class="row">
      <button class="primary" onclick="goHome()">⬅ Torna alla Home</button>
      <button class="ok" onclick="load()">Ricarica (Script=Approvato)</button>
      <a class="small" href="/api/test/google-key" target="_blank">Test Google Key</a>
      <a class="small" href="/api/step3/export-delta" target="_blank">Esegui Export DELTA</a>
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
          <th>Stato</th>
          <th>TXT</th>
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
    const pronto = String(a.pronto_per_vinted||'').toUpperCase().trim()==='TRUE';

    const pill = pronto
      ? '<span class="pill pill-ok">PRONTO</span>'
      : '<span class="pill pill-warn">NON PRONTO</span>';

    return \`
      <tr>
        <td><b>\${codice}</b></td>
        <td>\${desc || '<span class="small">—</span>'}</td>
        <td>
          <div class="pill pill-ok">APPROVATO</div>
          <div style="margin-top:6px">\${pill}</div>
        </td>
        <td>
          <button class="primary" onclick="downloadTxt('\${codice}')">PRONTO PER VINTED</button>
          <div class="small">Scarica .txt (se mancano campi ti avvisa)</div>
        </td>
      </tr>\`;
  }).join('');
}

async function downloadTxt(codice){
  setStatus('⏳ Verifica + download per ' + codice);

  const url = '/api/vinted/download-txt?codice=' + encodeURIComponent(codice);

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
