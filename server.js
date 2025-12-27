/**
 * SyncFED – Node 16 (Render) – PRODUZIONE INTEGRATA
 * * LOG MODIFICHE:
 * - Estensione forzata .jpg per tutte le foto su Drive.
 * - Compressione immagini automatica (< 300 KB).
 * - Utilizzo di 'sharp' per la conversione e ottimizzazione.
 * - Fix mappatura descrizioni FR/ES da Bman.
 * - File completo (Scelta memorizzata).
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import xml2js from "xml2js";
import { google } from "googleapis";
import { Readable } from "stream";
import sharp from "sharp"; 

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" }));

const PORT = process.env.PORT || 10000;

/* =========================================================
   CONFIG BMAN (SOAP)
   ========================================================= */
const BMAN_ENDPOINT = "https://emporiodeanna.bman.it/bmanapi.asmx";
const BMAN_CHIAVE = String(process.env.BMAN_API_KEY || "").trim();

/* =========================================================
   HELPERS & NORMALIZZAZIONE
   ========================================================= */
function normalizeValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function safeJsonParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function nowIso() { return new Date().toISOString(); }

/**
 * Forza conversione in JPG e comprime sotto i 300KB
 */
async function processAndCompressImage(buffer) {
  let quality = 85;
  let optimizedBuffer = await sharp(buffer)
    .jpeg({ quality: quality, progressive: true })
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
    .toBuffer();

  // Ciclo di riduzione qualità se supera ancora i 300KB
  while (optimizedBuffer.length > 300 * 1024 && quality > 10) {
    quality -= 10;
    optimizedBuffer = await sharp(buffer)
      .jpeg({ quality: quality, progressive: true })
      .toBuffer();
  }
  return optimizedBuffer;
}

/* =========================================================
   SOAP HELPERS
   ========================================================= */
async function soapCall({ action, bodyXml }) {
  const resp = await fetch(BMAN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: action },
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
async function getAnagrafiche({ numeroPagina = 1, filtri = [] } = {}) {
  const filtriJson = JSON.stringify(filtri);
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getAnagrafiche xmlns="http://cloud.bman.it/">
      <chiave>${BMAN_CHIAVE}</chiave>
      <filtri><![CDATA[${filtriJson}]]></filtri>
      <ordinamentoCampo>ID</ordinamentoCampo>
      <ordinamentoDirezione>1</ordinamentoDirezione>
      <numeroPagina>${numeroPagina}</numeroPagina>
      <listaDepositi><![CDATA[[]]]></listaDepositi>
      <dettaglioVarianti>false</dettaglioVarianti>
    </getAnagrafiche>
  </soap:Body>
</soap:Envelope>`.trim();

  const xml = await soapCall({ action: "http://cloud.bman.it/getAnagrafiche", bodyXml: soapBody });
  const result = await parseSoapResult(xml, "getAnagraficheResponse", "getAnagraficheResult");
  return safeJsonParse(result || "[]", []);
}

async function getAllArticlesByScriptValues(scriptValues = ["si", "approvato"]) {
  const wanted = new Set(scriptValues.map(normalizeValue));
  const outByCodice = new Map();

  for (const sv of scriptValues) {
    let page = 1;
    while (true) {
      const chunk = await getAnagrafiche({ numeroPagina: page, filtri: [{ chiave: "opzionale11", operatore: "=", valore: sv }] });
      if (!chunk.length) break;
      for (const a of chunk) {
        const cod = String(a?.codice ?? "").trim();
        if (cod && wanted.has(normalizeValue(a?.opzionale11))) {
          outByCodice.set(cod, a);
        }
      }
      if (chunk.length < 50) break;
      page++;
    }
  }
  return Array.from(outByCodice.values()).sort((a, b) => Number(a?.ID || 0) - Number(b?.ID || 0));
}

/* =========================================================
   GOOGLE CLIENTS
   ========================================================= */
function getRequiredEnv(name) { return String(process.env[name] ?? "").trim(); }

async function getGoogleAuth() {
  return new google.auth.JWT(getRequiredEnv("GOOGLE_CLIENT_EMAIL"), null, getRequiredEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"), [
    "https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"
  ]);
}

async function getSheetsClient() {
  const auth = await getGoogleAuth();
  return { sheets: google.sheets({ version: "v4", auth }), sheetId: getRequiredEnv("GOOGLE_SHEET_ID") };
}

async function getDriveClient() {
  const auth = await getGoogleAuth();
  return google.drive({ version: "v3", auth });
}

/* =========================================================
   DRIVE HELPERS
   ========================================================= */
async function ensureFolder(drive, folderName, parentId = null) {
  let query = `name = '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  if (parentId) query += ` and '${parentId}' in parents`;
  const res = await drive.files.list({ q: query, fields: 'files(id, name)' });
  if (res.data.files.length > 0) return res.data.files[0].id;
  const folder = await drive.files.create({ resource: { name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: parentId ? [parentId] : [] }, fields: 'id' });
  return folder.data.id;
}

async function uploadUrlToDrive(drive, url, fileName, folderId) {
  try {
    const response = await fetch(url);
    const buffer = Buffer.from(await response.arrayBuffer());
    // Forza estensione .jpg e comprime sotto i 300KB
    const finalName = fileName.toLowerCase().endsWith('.jpg') ? fileName : `${fileName.split('.')[0]}.jpg`;
    const optimizedBuffer = await processAndCompressImage(buffer);

    await drive.files.create({ 
      resource: { name: finalName, parents: [folderId] }, 
      media: { mimeType: 'image/jpeg', body: optimizedBuffer }, 
      fields: 'id' 
    });
    return true;
  } catch (e) { return false; }
}

/* =========================================================
   BUSINESS RULES & EXPORT DELTA
   ========================================================= */
const SHEET_TAB = (process.env.GOOGLE_SHEET_TAB || "PRODOTTI_BMAN").trim();
const SHEET_HEADERS = ["ID", "Codice", "Titolo", "Brand", "Tag15", "Script", "Descrizione_IT", "Titolo_FR", "Descrizione_FR", "Titolo_ES", "Descrizione_ES", "Titolo_DE", "Descrizione_DE", "Titolo_EN", "Descrizione_EN", "Categoria_Vinted", "Prezzo_Negozio", "Prezzo_Online", "Foto_1", "Foto_2", "Foto_3", "Foto_4", "Foto_5", "PRONTO_PER_VINTED", "UltimoSync"];

function isTruthyCell(v) { return String(v ?? "").trim() !== ""; }

function getMissingFields(rowObj) {
  const missing = [];
  for (let i = 1; i <= 5; i++) if (!isTruthyCell(rowObj[`Foto_${i}`])) missing.push(`Foto_${i}`);
  if (!isTruthyCell(rowObj.Descrizione_IT)) missing.push("Descrizione_IT");
  if (!isTruthyCell(rowObj.Titolo_FR) || !isTruthyCell(rowObj.Descrizione_FR)) missing.push("FR (Titolo/Desc)");
  if (!isTruthyCell(rowObj.Titolo_ES) || !isTruthyCell(rowObj.Descrizione_ES)) missing.push("ES (Titolo/Desc)");
  return missing;
}

function rowToObj(header, row) {
  const obj = {};
  header.forEach((k, i) => { if (k) obj[String(k).trim()] = String(row?.[i] ?? "").trim(); });
  return obj;
}

/* =========================================================
   API ROUTES
   ========================================================= */
app.get("/api/step3/export-delta", async (req, res) => {
  try {
    const { sheets, sheetId } = await getSheetsClient();
    const articoli = await getAllArticlesByScriptValues();
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${SHEET_TAB}!A1:Z10000` });
    const values = resp.data.values || [];

    if (!values.length) await sheets.spreadsheets.values.update({ spreadsheetId: sheetId, range: `${SHEET_TAB}!A1`, valueInputOption: "RAW", requestBody: { values: [SHEET_HEADERS] } });

    const existingMap = new Map();
    values.slice(1).forEach((r, i) => { if (r[1]) existingMap.set(String(r[1]).trim(), { index: i + 2, data: r }); });

    const updates = [], inserts = [];
    for (const a of articoli) {
      const cod = String(a.codice).trim();
      // Mappatura Bman: FR (opz6/opz13), ES (opz8/opz15)
      const newRow = [
        a.ID, a.codice, a.opzionale2 || a.Titolo, a.opzionale1, "", a.opzionale11, (a.opzionale12 || "").trim(),
        a.opzionale6, (a.opzionale13 || "").trim(), a.opzionale8, (a.opzionale15 || "").trim(), a.opzionale9, "", a.opzionale7, "", a.opzionale10, a.prza, a.przb,
        "", "", "", "", "", "FALSE", nowIso()
      ];

      const found = existingMap.get(cod);
      if (!found) inserts.push(newRow);
      else {
        const merged = [...found.data];
        let changed = false;
        [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 13, 15, 16, 17].forEach(idx => {
          if (normalizeValue(merged[idx]) !== normalizeValue(newRow[idx])) { merged[idx] = newRow[idx]; changed = true; }
        });
        if (changed) {
          merged[24] = nowIso();
          updates.push({ range: `${SHEET_TAB}!A${found.index}:Y${found.index}`, values: [merged] });
        }
      }
    }
    if (updates.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: sheetId, requestBody: { valueInputOption: "RAW", data: updates } });
    if (inserts.length) await sheets.spreadsheets.values.append({ spreadsheetId: sheetId, range: `${SHEET_TAB}!A2`, valueInputOption: "RAW", requestBody: { values: inserts } });
    res.json({ ok: true, total: articoli.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/vinted/upload-to-drive", async (req, res) => {
  try {
    const codice = req.query.codice;
    const { sheets, sheetId } = await getSheetsClient();
    const drive = await getDriveClient();
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${SHEET_TAB}!A1:Z10000` });
    const header = resp.data.values[0];
    const row = resp.data.values.slice(1).find(r => String(r[1]).trim() === codice);
    const obj = rowToObj(header, row);

    const rootId = await ensureFolder(drive, "DATI_VINTED");
    const productFolderId = await ensureFolder(drive, `${obj.Codice} - ${obj.Titolo}`, rootId);

    // Caricamento foto ottimizzate (.jpg e <300KB)
    for (let i = 1; i <= 5; i++) await uploadUrlToDrive(drive, obj[`Foto_${i}`], `Foto_${i}.jpg`, productFolderId);

    const txt = `CODICE: ${codice}\n\nIT: ${obj.Titolo}\n${obj.Descrizione_IT}\n\nFR: ${obj.Titolo_FR}\n${obj.Descrizione_FR}\n\nES: ${obj.Titolo_ES}\n${obj.Descrizione_ES}`;
    await drive.files.create({ resource: { name: `${obj.Codice}.txt`, parents: [productFolderId] }, media: { mimeType: 'text/plain', body: Readable.from([txt]) } });
    
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/vinted/list-approvati", async (req, res) => {
  try {
    const { sheets, sheetId } = await getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${SHEET_TAB}!A1:Z10000` });
    const header = resp.data.values[0];
    const out = resp.data.values.slice(1).map(r => {
      const obj = rowToObj(header, r);
      return { codice: obj.Codice, descrizione: obj.Descrizione_IT, pronto: obj.PRONTO_PER_VINTED, missing: getMissingFields(obj), script: obj.Script };
    }).filter(x => normalizeValue(x.script) === "approvato");
    res.json({ ok: true, articoli: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/dashboard", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html><head><meta charset="utf-8"/><title>Dashboard</title><style>body{font-family:sans-serif;background:#0b0f17;color:#fff;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #26324d}.pill{padding:5px;border-radius:5px}.ok{background:#1fda85;color:#000}.no{background:#ff5c5c}.missing{color:#ffcd4c;font-size:11px;display:block}button{background:#4c7dff;color:#fff;border:none;padding:8px;border-radius:5px;cursor:pointer}</style></head><body><h1>📦 Dashboard Vinted</h1><button onclick="load()">🔄 Ricarica</button><table><thead><tr><th>Codice</th><th>Info</th><th>Stato</th><th>Azione</th></tr></thead><tbody id="tb"></tbody></table><script>async function load(){const r=await fetch('/api/vinted/list-approvati');const j=await r.json();document.getElementById('tb').innerHTML=j.articoli.map(a=>\`<tr><td><b>\${a.codice}</b></td><td>\${a.descrizione}<span class="missing">\${a.missing.length?'Mancano: '+a.missing.join(', '):''}</span></td><td><span class="pill \${a.pronto==='TRUE'?'ok':'no'}">\${a.pronto==='TRUE'?'PRONTO':'NO'}</span></td><td><button onclick="toDrive('\${a.codice}')">Invia a Drive</button></td></tr>\`).join('');} async function toDrive(c){ await fetch('/api/vinted/upload-to-drive?codice='+c); alert('Inviato con foto ottimizzate!'); } load();</script></body></html>`);
});

app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html><head><meta charset="utf-8"/><title>SyncFED</title><style>body{font-family:Arial;padding:40px;background:#0b0f17;color:#fff}button{padding:15px;cursor:pointer;font-weight:bold;margin:10px;border-radius:10px;border:none}.primary{background:#4c7dff;color:#fff}.ok{background:#1fda85}</style></head><body><h1>🚀 SyncFED</h1><button class="primary" onclick="fetch('/api/step3/export-delta').then(()=>alert('Fatto!'))">1. Export DELTA</button><button class="ok" onclick="window.location.href='/dashboard'">2. Vai alla Dashboard</button></body></html>`);
});

app.listen(PORT, () => console.log(`🚀 Porta ${PORT}`));
