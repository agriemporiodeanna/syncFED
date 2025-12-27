/**
 * SyncFED – Node 16 (Render) – PRODUZIONE INTEGRATA
 * * LOG MODIFICHE:
 * - Fix: Mappatura descrizioni FR ed ES da Bman a Google Sheet.
 * - Delta Sync: Logica Update/Insert completa.
 * - Google Drive: Caricamento 5 foto + TXT nella cartella del prodotto.
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import xml2js from "xml2js";
import { google } from "googleapis";
import { Readable } from "stream";

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
   NORMALIZZAZIONE & HELPERS
   ========================================================= */
function normalizeValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function safeJsonParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function nowIso() { return new Date().toISOString(); }

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

  const xml = await soapCall({ action: "http://cloud.bman.it/getAnagrafiche", bodyXml: soapBody });
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
      const chunk = await getAnagrafiche({ numeroPagina: page, filtri });
      if (!chunk.length) break;
      for (const a of chunk) {
        const scriptNorm = normalizeValue(a?.opzionale11);
        const codice = String(a?.codice ?? "").trim();
        if (!codice || !wanted.has(scriptNorm)) continue;
        const existing = outByCodice.get(codice);
        if (!existing || (normalizeValue(existing?.opzionale11) !== "approvato" && scriptNorm === "approvato")) {
          outByCodice.set(codice, a);
        }
      }
      if (chunk.length < 50) break;
      page += 1;
    }
  }
  return Array.from(outByCodice.values()).sort((a, b) => Number(a?.ID || 0) - Number(b?.ID || 0));
}

/* =========================================================
   GOOGLE CLIENTS (SHEETS & DRIVE)
   ========================================================= */
function getRequiredEnv(name) { return String(process.env[name] ?? "").trim(); }

async function getGoogleAuth() {
  const clientEmail = getRequiredEnv("GOOGLE_CLIENT_EMAIL");
  const privateKey = getRequiredEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n").trim();
  if (!clientEmail || !privateKey) throw new Error("Credenziali Google mancanti");
  return new google.auth.JWT(clientEmail, null, privateKey, [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
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
   GOOGLE DRIVE HELPERS
   ========================================================= */
async function ensureFolder(drive, folderName, parentId = null) {
  let query = `name = '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  if (parentId) query += ` and '${parentId}' in parents`;
  const res = await drive.files.list({ q: query, fields: 'files(id, name)' });
  if (res.data.files.length > 0) return res.data.files[0].id;
  const fileMetadata = { name: folderName, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) fileMetadata.parents = [parentId];
  const folder = await drive.files.create({ resource: fileMetadata, fields: 'id' });
  return folder.data.id;
}

async function uploadUrlToDrive(drive, url, fileName, folderId) {
  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const fileMetadata = { name: fileName, parents: [folderId] };
    const media = { mimeType: 'image/jpeg', body: Buffer.from(buffer) };
    await drive.files.create({ resource: fileMetadata, media: media, fields: 'id' });
    return true;
  } catch (e) {
    console.error(`Errore upload foto ${fileName}:`, e.message);
    return false;
  }
}

async function uploadTextToDrive(drive, text, fileName, folderId) {
  try {
    const fileMetadata = { name: fileName, parents: [folderId] };
    const media = { mimeType: 'text/plain', body: Readable.from([text]) };
    await drive.files.create({ resource: fileMetadata, media: media, fields: 'id' });
    return true;
  } catch (e) {
    console.error(`Errore upload file testo ${fileName}:`, e.message);
    return false;
  }
}

/* =========================================================
   BUSINESS RULES & EXPORT DELTA
   ========================================================= */
const SHEET_TAB = (process.env.GOOGLE_SHEET_TAB || "PRODOTTI_BMAN").trim();
const SHEET_HEADERS = ["ID", "Codice", "Titolo", "Brand", "Tag15", "Script", "Descrizione_IT", "Titolo_FR", "Descrizione_FR", "Titolo_ES", "Descrizione_ES", "Titolo_DE", "Descrizione_DE", "Titolo_EN", "Descrizione_EN", "Categoria_Vinted", "Prezzo_Negozio", "Prezzo_Online", "Foto_1", "Foto_2", "Foto_3", "Foto_4", "Foto_5", "PRONTO_PER_VINTED", "UltimoSync"];

function isTruthyCell(v) { return String(v ?? "").trim() !== ""; }

function getMissingFields(rowObj) {
  const missing = [];
  for (let i = 1; i <= 5; i++) {
    if (!isTruthyCell(rowObj[`Foto_${i}`])) missing.push(`Foto_${i}`);
  }
  if (!isTruthyCell(rowObj.Descrizione_IT)) missing.push("Descrizione_IT");
  if (!isTruthyCell(rowObj.Titolo_FR) || !isTruthyCell(rowObj.Descrizione_FR)) missing.push("FR (Titolo/Desc)");
  if (!isTruthyCell(rowObj.Titolo_ES) || !isTruthyCell(rowObj.Descrizione_ES)) missing.push("ES (Titolo/Desc)");
  return missing;
}

function calcProntoPerVintedFromRowObj(rowObj) {
  const scriptOk = normalizeValue(rowObj.Script) === "approvato";
  const missing = getMissingFields(rowObj);
  return scriptOk && missing.length === 0;
}

function idxOf(header, colName) { return header.findIndex((h) => String(h).trim() === colName); }

function rowToObj(header, row) {
  const obj = {};
  header.forEach((k, i) => { if (k) obj[String(k).trim()] = String(row?.[i] ?? "").trim(); });
  return obj;
}

function colToA1(colIndex0) {
  let n = colIndex0 + 1, s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/* =========================================================
   API ROUTES
   ========================================================= */
app.get("/api/test/google-key", async (req, res) => {
  try {
    const { sheets, sheetId } = await getSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    res.json({ ok: true, message: "Connessione Google OK", title: meta.data.properties.title });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get("/api/step3/export-delta", async (req, res) => {
  try {
    const { sheets, sheetId } = await getSheetsClient();
    const articoli = await getAllArticlesByScriptValues(["si", "approvato"]);
    
    const endCol = colToA1(SHEET_HEADERS.length - 1);
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${SHEET_TAB}!A1:${endCol}10000` });
    const values = resp.data.values || [];
    const existingHeader = values[0] || [];

    if (existingHeader.length > 0) {
       const match = SHEET_HEADERS.every((h, i) => normalizeValue(h) === normalizeValue(existingHeader[i]));
       if (!match) return res.status(400).json({ ok: false, error: "🔒 Export bloccato: lo Sheet NON è sincronizzato (header diverso)." });
    } else {
       await sheets.spreadsheets.values.update({ spreadsheetId: sheetId, range: `${SHEET_TAB}!A1`, valueInputOption: "RAW", requestBody: { values: [SHEET_HEADERS] } });
    }

    const iCod = SHEET_HEADERS.indexOf("Codice");
    const existingRows = values.slice(1);
    const existingMap = new Map();
    existingRows.forEach((r, i) => { if (r[iCod]) existingMap.set(String(r[iCod]).trim(), { index: i + 2, data: r }); });

    const updates = [], inserts = [];
    let updated = 0, inserted = 0;

    for (const a of articoli) {
      const cod = String(a.codice).trim();
      const found = existingMap.get(cod);
      
      // MAPPATURA CORRETTA:
      // opzionale6 = Titolo FR | opzionale13 = Desc FR
      // opzionale8 = Titolo ES | opzionale15 = Desc ES
      const newRow = [
        a.ID, a.codice, a.opzionale2 || a.Titolo, a.opzionale1, "", a.opzionale11, (a.opzionale12 || "").trim(),
        a.opzionale6, (a.opzionale13 || "").trim(), a.opzionale8, (a.opzionale15 || "").trim(), a.opzionale9, "", a.opzionale7, "", a.opzionale10, a.prza, a.przb,
        "", "", "", "", "", "FALSE", nowIso()
      ];

      if (!found) {
        inserts.push(newRow); inserted++;
      } else {
        const merged = [...found.data];
        let changed = false;
        
        // Sincronizziamo Titoli e Descrizioni se presenti in Bman
        // Indici: 7 (Titolo FR), 8 (Desc FR), 9 (Titolo ES), 10 (Desc ES)
        [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 13, 15, 16, 17].forEach(idx => {
          if (normalizeValue(merged[idx]) !== normalizeValue(newRow[idx])) { 
            merged[idx] = newRow[idx]; 
            changed = true; 
          }
        });
        
        const objForPronto = rowToObj(SHEET_HEADERS, merged);
        const pronto = calcProntoPerVintedFromRowObj(objForPronto) ? "TRUE" : "FALSE";
        if (merged[23] !== pronto) { merged[23] = pronto; changed = true; }

        if (changed) {
          merged[24] = nowIso();
          updates.push({ range: `${SHEET_TAB}!A${found.index}:${endCol}${found.index}`, values: [merged] });
          updated++;
        }
      }
    }

    if (updates.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: sheetId, requestBody: { valueInputOption: "RAW", data: updates } });
    if (inserts.length) await sheets.spreadsheets.values.append({ spreadsheetId: sheetId, range: `${SHEET_TAB}!A2`, valueInputOption: "RAW", requestBody: { values: inserts } });

    res.json({ ok: true, total: articoli.length, updated, inserted });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get("/api/vinted/upload-to-drive", async (req, res) => {
  try {
    const codice = String(req.query.codice || "").trim();
    const { sheets, sheetId } = await getSheetsClient();
    const drive = await getDriveClient();
    
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${SHEET_TAB}!A1:Z10000` });
    const values = resp.data.values || [];
    const header = values[0];
    const row = values.slice(1).find(r => String(r[idxOf(header, "Codice")]).trim() === codice);
    
    if (!row) return res.status(404).json({ ok: false, error: "Articolo non trovato nello sheet" });
    const obj = rowToObj(header, row);
    const missing = getMissingFields(obj);
    if (missing.length) return res.status(400).json({ ok: false, missing });

    const rootId = await ensureFolder(drive, "DATI_VINTED");
    const productFolderName = `${obj.Codice} - ${obj.Titolo}`;
    const productFolderId = await ensureFolder(drive, productFolderName, rootId);

    for (let i = 1; i <= 5; i++) {
      const url = obj[`Foto_${i}`];
      await uploadUrlToDrive(drive, url, `Foto_${i}.jpg`, productFolderId);
    }

    const txtContent = `CODICE: ${codice}\n\n=== IT ===\n${obj.Titolo}\n${obj.Descrizione_IT}\n\n=== FR ===\n${obj.Titolo_FR}\n${obj.Descrizione_FR}\n\n=== ES ===\n${obj.Titolo_ES}\n${obj.Descrizione_ES}\n\nPREZZO ONLINE: ${obj.Prezzo_Online}`;
    await uploadTextToDrive(drive, txtContent, `${obj.Codice}.txt`, productFolderId);
    
    res.json({ ok: true, message: "Asset caricati su Drive", folder: productFolderName });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get("/api/vinted/list-approvati", async (req, res) => {
  try {
    const { sheets, sheetId } = await getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${SHEET_TAB}!A1:Z10000` });
    const values = resp.data.values || [];
    const header = values[0];
    const out = values.slice(1).map(r => {
      const obj = rowToObj(header, r);
      return {
        codice: obj.Codice,
        descrizione: obj.Descrizione_IT,
        pronto: obj.PRONTO_PER_VINTED,
        missing: getMissingFields(obj),
        script: obj.Script
      };
    }).filter(x => normalizeValue(x.script) === "approvato");
    res.json({ ok: true, articoli: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/dashboard", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="it"><head><meta charset="utf-8"/><title>SyncFED Dashboard</title>
  <style>
    body{font-family:sans-serif;background:#0b0f17;color:#e8eefc;padding:20px}
    table{width:100%;border-collapse:collapse;margin-top:20px}
    th,td{padding:12px;border-bottom:1px solid #26324d;text-align:left}
    .pill{padding:5px 10px;border-radius:8px;font-size:12px;font-weight:bold}
    .pill-ok{background:#1fda85;color:#000}
    .pill-no{background:#ff5c5c;color:#fff}
    .missing-box{color:#ffcd4c;font-size:11px;margin-top:5px;font-style:italic}
    button{padding:8px 12px;border-radius:8px;border:0;cursor:pointer;background:#4c7dff;color:#fff}
    button:disabled{background:#555;cursor:not-allowed}
  </style></head>
  <body>
    <h1>📦 Dashboard Operativa Vinted</h1>
    <div><button onclick="window.location.href='/'">⬅ Home</button> <button onclick="load()">🔄 Ricarica</button></div>
    <div id="status"></div>
    <table>
      <thead><tr><th>Codice</th><th>Info & Mancanti</th><th>Stato</th><th>Azione Drive</th></tr></thead>
      <tbody id="tbody"></tbody>
    </table>
    <script>
      async function load(){
        const r = await fetch('/api/vinted/list-approvati');
        const j = await r.json();
        const tb = document.getElementById('tbody');
        tb.innerHTML = j.articoli.map(a => {
          const isPronto = a.pronto === 'TRUE';
          return \`<tr>
            <td><b>\${a.codice}</b></td>
            <td>\${a.descrizione || '---'}\${a.missing.length ? '<div class="missing-box">Mancano: ' + a.missing.join(', ') + '</div>' : ''}</td>
            <td><span class="pill \${isPronto?'pill-ok':'pill-no'}">\${isPronto?'PRONTO':'INCOMPLETO'}</span></td>
            <td><button id="btn-\${a.codice}" onclick="toDrive('\${a.codice}')">\${isPronto?'Invia a Drive':'Incompleto'}</button></td>
          </tr>\`;
        }).join('');
      }
      async function toDrive(c){
        const btn = document.getElementById('btn-'+c);
        btn.disabled = true; btn.innerText = "⏳...";
        const r = await fetch('/api/vinted/upload-to-drive?codice=' + c);
        const j = await r.json();
        if(j.ok){ alert("✅ Caricato!"); btn.innerText = "✅ OK"; btn.style.background = "#1fda85"; }
        else { alert("❌ Errore: " + (j.missing ? j.missing.join(', ') : j.error)); btn.disabled = false; btn.innerText = "Riprova"; }
      }
      load();
    </script></body></html>`);
});

app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="it"><head><meta charset="utf-8"/><title>SyncFED</title>
  <style>body{font-family:Arial;padding:40px;background:#0b0f17;color:#fff} .card{background:#111a2b;padding:30px;border-radius:15px;border:1px solid #26324d} button{padding:15px 25px;border-radius:10px;border:0;cursor:pointer;font-weight:bold;margin:10px} .primary{background:#4c7dff;color:#fff} .ok{background:#1fda85;color:#000} pre{background:#0b0f17;padding:20px;border:1px solid #26324d;margin-top:20px;border-radius:10px}</style></head>
  <body>
    <div class="card">
      <h1>🚀 SyncFED - Controllo Operativo</h1>
      <button class="primary" onclick="call('/api/step3/export-delta')">1. Export DELTA</button>
      <button class="ok" onclick="window.location.href='/dashboard'">2. Vai alla Dashboard</button>
      <button style="background:#ffcd4c" onclick="call('/api/test/google-key')">Test Google Key</button>
      <pre id="out">In attesa...</pre>
    </div>
    <script>async function call(p){ const out=document.getElementById('out'); const r=await fetch(p); const j=await r.json(); out.innerText=JSON.stringify(j,null,2); }</script>
  </body></html>`);
});

app.listen(PORT, () => console.log(`🚀 SyncFED su porta ${PORT}`));
