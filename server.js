/**
 * SyncFED – Node 16 (Render) – PRODUZIONE AGGIORNATA
 * - Esportazione Foto 1-5 obbligatoria
 * - Descrizioni FR/ES obbligatorie
 * - Dashboard con elenco campi mancanti inline
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
   BMAN: getAnagrafiche
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

      for (const a of chunk) {
        const scriptNorm = normalizeValue(a?.opzionale11);
        const codice = String(a?.codice ?? "").trim();
        if (!codice) continue;
        if (!wanted.has(scriptNorm)) continue;

        const existing = outByCodice.get(codice);
        if (!existing || (normalizeValue(existing?.opzionale11) !== "approvato" && scriptNorm === "approvato")) {
          outByCodice.set(codice, a);
        }
      }
      if (chunk.length < 50) break;
      page += 1;
      if (page > 500) break;
    }
  }
  const arr = Array.from(outByCodice.values());
  arr.sort((a, b) => (Number(a?.ID || 0) - Number(b?.ID || 0)));
  return arr;
}

/* =========================================================
   GOOGLE SHEETS
   ========================================================= */
function getRequiredEnv(name) {
  return String(process.env[name] ?? "").trim();
}

function getGoogleCredsRaw() {
  const missing = ["GOOGLE_SHEET_ID", "GOOGLE_CLIENT_EMAIL", "GOOGLE_PRIVATE_KEY"].filter((k) => !getRequiredEnv(k));
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    sheetId: getRequiredEnv("GOOGLE_SHEET_ID"),
    clientEmail: getRequiredEnv("GOOGLE_CLIENT_EMAIL"),
    privateKey: getRequiredEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n").trim(),
  };
}

async function getSheetsClient() {
  const creds = getGoogleCredsRaw();
  if (!creds.ok) throw new Error("Variabili ambiente mancanti: " + creds.missing.join(", "));
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
  if (!exists) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetTitle } } }] },
    });
  }
}

async function writeRange(sheetsApi, sheetId, range, values) {
  await sheetsApi.spreadsheets.values.update({ spreadsheetId: sheetId, range, valueInputOption: "RAW", requestBody: { values } });
}

async function readRange(sheetsApi, sheetId, range) {
  const resp = await sheetsApi.spreadsheets.values.get({ spreadsheetId: sheetId, range });
  return resp?.data?.values || [];
}

async function appendRows(sheetsApi, sheetId, rangeA1, values) {
  await sheetsApi.spreadsheets.values.append({ spreadsheetId: sheetId, range: rangeA1, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values } });
}

/* =========================================================
   SHEET CONFIG
   ========================================================= */
const SHEET_TAB = (process.env.GOOGLE_SHEET_TAB || "PRODOTTI_BMAN").trim();
const SHEET_HEADERS = [
  "ID", "Codice", "Titolo", "Brand", "Tag15", "Script", "Descrizione_IT",
  "Titolo_FR", "Descrizione_FR", "Titolo_ES", "Descrizione_ES",
  "Titolo_DE", "Descrizione_DE", "Titolo_EN", "Descrizione_EN",
  "Categoria_Vinted", "Prezzo_Negozio", "Prezzo_Online",
  "Foto_1", "Foto_2", "Foto_3", "Foto_4", "Foto_5", "PRONTO_PER_VINTED", "UltimoSync"
];

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
  return [
    a?.ID ?? "", a?.codice ?? "", a?.opzionale2 ?? a?.Titolo ?? "", a?.opzionale1 ?? "", "", a?.opzionale11 ?? "", (a?.opzionale12 ?? a?.descrizioneHtml ?? "").toString().trim(),
    a?.opzionale6 ?? "", "", a?.opzionale8 ?? "", "", a?.opzionale9 ?? "", "", a?.opzionale7 ?? "", "", a?.opzionale10 ?? "", a?.prza ?? "", a?.przb ?? "",
    "", "", "", "", "", "FALSE", nowIso()
  ];
}

/* =========================================================
   BUSINESS RULES & SYNC
   ========================================================= */
function isTruthyCell(v) { return String(v ?? "").trim() !== ""; }

function getMissingFields(rowObj) {
  const missing = [];
  if (!isTruthyCell(rowObj.Foto_1)) missing.push("Foto_1");
  if (!isTruthyCell(rowObj.Foto_2)) missing.push("Foto_2");
  if (!isTruthyCell(rowObj.Foto_3)) missing.push("Foto_3");
  if (!isTruthyCell(rowObj.Foto_4)) missing.push("Foto_4");
  if (!isTruthyCell(rowObj.Foto_5)) missing.push("Foto_5");
  if (!isTruthyCell(rowObj.Descrizione_IT)) missing.push("Descrizione_IT");
  if (!isTruthyCell(rowObj.Titolo_FR) || !isTruthyCell(rowObj.Descrizione_FR)) missing.push("FR (Titolo/Desc)");
  if (!isTruthyCell(rowObj.Titolo_ES) || !isTruthyCell(rowObj.Descrizione_ES)) missing.push("ES (Titolo/Desc)");
  return missing;
}

function calcProntoPerVintedFromRowObj(rowObj) {
  const scriptOk = normalizeValue(rowObj.Script) === "approvato";
  return scriptOk && getMissingFields(rowObj).length === 0;
}

function headersEqualStrict(a, b) {
  if (a.length !== b.length) return false;
  return a.every((val, i) => String(val ?? "").trim() === String(b[i] ?? "").trim());
}

function idxOf(header, colName) { return header.findIndex((h) => String(h).trim() === colName); }

async function getSheetAllValues(sheetsApi, sheetId, tab) {
  const endCol = colToA1(SHEET_HEADERS.length - 1);
  const values = await readRange(sheetsApi, sheetId, `${tab}!A1:${endCol}`);
  return { header: values[0] || [], rows: values.slice(1), endCol };
}

function rowToObj(header, row) {
  const obj = {};
  header.forEach((k, i) => { if (k) obj[String(k).trim()] = String(row?.[i] ?? "").trim(); });
  return obj;
}

async function exportDeltaScriptSiAndApprovato({ dryRun = false } = {}) {
  const articoli = await getAllArticlesByScriptValues(["si", "Approvato"]);
  const { sheets, sheetId } = await getSheetsClient();
  await ensureSheet(sheets, sheetId, SHEET_TAB);
  const { header: existingHeader, rows: existingRows, endCol } = await getSheetAllValues(sheets, sheetId, SHEET_TAB);

  if (!existingHeader.length) {
    if (!dryRun) await writeRange(sheets, sheetId, `${SHEET_TAB}!A1:${endCol}1`, [SHEET_HEADERS]);
    return { ok: true, mode: "init", inserted: articoli.length };
  }

  if (!headersEqualStrict(existingHeader, SHEET_HEADERS)) {
    return { ok: false, blocked: true, error: "Header non sincronizzato." };
  }

  const iCod = idxOf(existingHeader, "Codice");
  const existingMap = new Map();
  existingRows.forEach((r, i) => { if (r[iCod]) existingMap.set(String(r[iCod]).trim(), { rowIndex1Based: i + 2, row: r }); });

  const syncCols = ["ID", "Codice", "Titolo", "Brand", "Script", "Descrizione_IT", "Titolo_FR", "Titolo_ES", "Titolo_DE", "Titolo_EN", "Categoria_Vinted", "Prezzo_Negozio", "Prezzo_Online"];
  const idx = {}; SHEET_HEADERS.forEach(c => idx[c] = idxOf(existingHeader, c));

  const updates = [], inserts = [];
  let updatedCount = 0, insertedCount = 0;

  for (const a of articoli) {
    const newBaseRow = toSheetRowFromBman(a);
    const codice = String(a?.codice ?? "").trim();
    const found = existingMap.get(codice);

    if (!found) { inserts.push(newBaseRow); insertedCount++; continue; }

    const existingRow = [...found.row];
    const newObj = rowToObj(SHEET_HEADERS, newBaseRow);
    let changed = false;

    syncCols.forEach(col => {
      const i = idx[col];
      if (i >= 0 && String(existingRow[i] ?? "").trim() !== String(newObj[col] ?? "").trim()) {
        existingRow[i] = newObj[col]; changed = true;
      }
    });

    const pronto = calcProntoPerVintedFromRowObj(rowToObj(existingHeader, existingRow)) ? "TRUE" : "FALSE";
    if (existingRow[idx["PRONTO_PER_VINTED"]] !== pronto) { existingRow[idx["PRONTO_PER_VINTED"]] = pronto; changed = true; }

    if (changed) {
      existingRow[idx["UltimoSync"]] = nowIso();
      updates.push({ range: `${SHEET_TAB}!A${found.rowIndex1Based}:${endCol}${found.rowIndex1Based}`, values: [existingRow] });
      updatedCount++;
    }
  }

  if (!dryRun) {
    if (updates.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: sheetId, requestBody: { valueInputOption: "RAW", data: updates } });
    if (inserts.length) await appendRows(sheets, sheetId, `${SHEET_TAB}!A2`, inserts);
  }
  return { ok: true, updated: updatedCount, inserted: insertedCount };
}

/* =========================================================
   ROUTES
   ========================================================= */
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="it"><head><meta charset="utf-8"/><title>SyncFED</title><style>body{font-family:Arial;padding:20px;background:#0b0f17;color:#fff}button{padding:10px;margin:5px;cursor:pointer;border-radius:5px;border:none;font-weight:bold}.primary{background:#4c7dff;color:#fff}.ok{background:#1fda85}pre{background:#111a2b;padding:10px;border-radius:5px}</style></head><body><h1>🚀 SyncFED Control</h1><button class="primary" onclick="call('/api/step3/export-delta')">Export DELTA</button><button class="ok" onclick="window.location.href='/dashboard'">Vinted Dashboard</button><pre id="out">{}</pre><script>async function call(p){document.getElementById('out').textContent='...';const r=await fetch(p);const j=await r.json();document.getElementById('out').textContent=JSON.stringify(j,null,2);}</script></body></html>`);
});

app.get("/api/step3/export-delta", async (req, res) => {
  try { const r = await exportDeltaScriptSiAndApprovato(); res.json(r); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/vinted/list-approvati", async (req, res) => {
  try {
    const { sheets, sheetId } = await getSheetsClient();
    const { header, rows } = await getSheetAllValues(sheets, sheetId, SHEET_TAB);
    const iCod = idxOf(header, "Codice"), iScript = idxOf(header, "Script");
    const out = rows.map(r => {
      const obj = rowToObj(header, r);
      return { codice: obj.Codice, descrizione_it: obj.Descrizione_IT, script: obj.Script, pronto_per_vinted: obj.PRONTO_PER_VINTED, missing: getMissingFields(obj) };
    }).filter(x => normalizeValue(x.script) === "approvato");
    res.json({ ok: true, articoli: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/vinted/download-txt", async (req, res) => {
  try {
    const codice = String(req.query.codice || "").trim();
    const { sheets, sheetId } = await getSheetsClient();
    const { header, rows } = await getSheetAllValues(sheets, sheetId, SHEET_TAB);
    const iCod = idxOf(header, "Codice");
    const foundRow = rows.find(r => String(r[iCod] || "").trim() === codice);
    if (!foundRow) return res.status(404).send("Non trovato");

    const obj = rowToObj(header, foundRow);
    const missing = getMissingFields(obj);
    if (missing.length) return res.status(400).json({ ok: false, missing });

    const txt = `CODICE: ${codice}\n\n=== IT ===\n${obj.Titolo}\n${obj.Descrizione_IT}\n\n=== FR ===\n${obj.Titolo_FR}\n${obj.Descrizione_FR}\n\n=== ES ===\n${obj.Titolo_ES}\n${obj.Descrizione_ES}\n\nPREZZO: ${obj.Prezzo_Online}`;
    res.setHeader("Content-Disposition", `attachment; filename="${codice}.txt"`);
    res.send(txt);
  } catch (e) { res.status(500).send(e.message); }
});

app.get("/dashboard", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="it"><head><meta charset="utf-8"/><title>Vinted Dashboard</title><style>body{font-family:sans-serif;background:#0b0f17;color:#e8eefc;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:12px;border-bottom:1px solid #26324d}tr:hover{background:#161f30}.pill{padding:4px 8px;border-radius:5px;font-size:11px;font-weight:bold}.ok{background:#1fda85;color:#000}.no{background:#ff5c5c}.missing{color:#ffcd4c;font-size:11px;margin-top:5px}button{background:#4c7dff;color:#fff;border:none;padding:8px;border-radius:5px;cursor:pointer}</style></head>
  <body><h1>📦 Vinted Dashboard</h1><button onclick="load()">🔄 Ricarica Dati</button><table><thead><tr><th>Codice</th><th>Info</th><th>Stato</th><th>Azione</th></tr></thead><tbody id="tb"></tbody></table>
  <script>async function load(){const r=await fetch('/api/vinted/list-approvati');const j=await r.json();document.getElementById('tb').innerHTML=j.articoli.map(a=>\`<tr><td><b>\${a.codice}</b></td><td>\${a.descrizione_it||'-'}<div class="missing">\${a.missing.length?'Mancano: '+a.missing.join(', '):''}</div></td><td><span class="pill \${a.pronto_per_vinted==='TRUE'?'ok':'no'}">\${a.pronto_per_vinted==='TRUE'?'PRONTO':'INCOMPLETO'}</span></td><td><button onclick="dl('\${a.codice}')">Scarica TXT</button></td></tr>\`).join('');}
  async function dl(c){const r=await fetch('/api/vinted/download-txt?codice='+c);if(!r.ok){const err=await r.json();alert('Mancano: '+err.missing.join(', '));}else{window.location.href='/api/vinted/download-txt?codice='+c;}}load();</script></body></html>`);
});

app.listen(PORT, () => console.log(`🚀 Porta: ${PORT}`));
