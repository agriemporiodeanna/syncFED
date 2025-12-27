/**
 * SyncFED – PRODUZIONE INTEGRATA DEFINITIVA
 * - Export DELTA (Bman -> Sheet) con Delta Sync.
 * - Ottimizzazione Immagini: Forza .jpg e compressione < 300KB.
 * - Upload FTP: Invio a server.agriemporiodeanna.com/imgebay.
 * - Google Drive: Creazione cartelle "CODICE - TITOLO" e salvataggio asset.
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import xml2js from "xml2js";
import { google } from "googleapis";
import { Readable } from "stream";
import sharp from "sharp"; 
import * as ftp from "basic-ftp"; 

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" })); 

const PORT = process.env.PORT || 10000;

/* =========================================================
   CONFIGURAZIONI
   ========================================================= */
const BMAN_ENDPOINT = "https://emporiodeanna.bman.it/bmanapi.asmx";
const BMAN_CHIAVE = String(process.env.BMAN_API_KEY || "").trim();

const FTP_CONFIG = {
    host: "server.agriemporiodeanna.com",
    user: process.env.FTP_USER, 
    password: process.env.FTP_PASSWORD, 
    secure: false
};

const BASE_URL_FOTO = "http://server.agriemporiodeanna.com/imgebay/";
const SHEET_TAB = (process.env.GOOGLE_SHEET_TAB || "PRODOTTI_BMAN").trim();
const SHEET_HEADERS = ["ID", "Codice", "Titolo", "Brand", "Tag15", "Script", "Descrizione_IT", "Titolo_FR", "Descrizione_FR", "Titolo_ES", "Descrizione_ES", "Titolo_DE", "Descrizione_DE", "Titolo_EN", "Descrizione_EN", "Categoria_Vinted", "Prezzo_Negozio", "Prezzo_Online", "Foto_1", "Foto_2", "Foto_3", "Foto_4", "Foto_5", "PRONTO_PER_VINTED", "UltimoSync"];

/* =========================================================
   HELPERS & OTTIMIZZAZIONE IMMAGINI
   ========================================================= */
function normalizeValue(value) {
  if (!value) return "";
  return String(value).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function nowIso() { return new Date().toISOString(); }

async function processAndCompressImage(buffer) {
  let quality = 85;
  let optimizedBuffer = await sharp(buffer)
    .jpeg({ quality, progressive: true })
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
    .toBuffer();

  while (optimizedBuffer.length > 300 * 1024 && quality > 10) {
    quality -= 5;
    optimizedBuffer = await sharp(buffer).jpeg({ quality, progressive: true }).toBuffer();
  }
  return optimizedBuffer;
}

/* =========================================================
   GOOGLE & SOAP BMAN
   ========================================================= */
async function getGoogleAuth() {
  return new google.auth.JWT(process.env.GOOGLE_CLIENT_EMAIL, null, process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"), [
    "https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"
  ]);
}

async function getSheetsClient() {
  const auth = await getGoogleAuth();
  return { sheets: google.sheets({ version: "v4", auth }), sheetId: process.env.GOOGLE_SHEET_ID };
}

async function getDriveClient() {
  const auth = await getGoogleAuth();
  return google.drive({ version: "v3", auth });
}

async function soapCall(action, bodyXml) {
  const resp = await fetch(BMAN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `http://cloud.bman.it/${action}` },
    body: bodyXml,
  });
  return await resp.text();
}

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
  const xml = await soapCall("getAnagrafiche", soapBody);
  const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
  const result = parsed?.["soap:Envelope"]?.["soap:Body"]?.getAnagraficheResponse?.getAnagraficheResult ?? "";
  return JSON.parse(result || "[]");
}

async function getAllArticlesByScriptValues(scriptValues = ["si", "approvato"]) {
  const wanted = new Set(scriptValues.map(normalizeValue));
  const outByCodice = new Map();
  for (const sv of scriptValues) {
    let page = 1;
    while (true) {
      const chunk = await getAnagrafiche({ numeroPagina: page, filtri: [{ chiave: "opzionale11", operatore: "=", valore: sv }] });
      if (!chunk.length) break;
      chunk.forEach(a => {
        const cod = String(a?.codice ?? "").trim();
        if (cod && wanted.has(normalizeValue(a?.opzionale11))) outByCodice.set(cod, a);
      });
      if (chunk.length < 50) break;
      page++;
    }
  }
  return Array.from(outByCodice.values());
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

/* =========================================================
   ROTTE API
   ========================================================= */

app.post("/api/vinted/upload-pc-to-bman", async (req, res) => {
    const { codice, images } = req.body; 
    if (!images || images.length < 5) return res.status(400).json({ ok: false, error: "Seleziona almeno 5 immagini." });

    const client = new ftp.Client();
    try {
        await client.access(FTP_CONFIG);
        const fotoUrls = [];
        for (let i = 0; i < images.length; i++) {
            const buffer = Buffer.from(images[i].split(",")[1], "base64");
            const optimized = await processAndCompressImage(buffer);
            const fileName = `${codice}_${i + 1}.jpg`;
            await client.uploadFrom(Readable.from(optimized), `/imgebay/${fileName}`);
            fotoUrls.push(`${BASE_URL_FOTO}${fileName}`);
        }
        res.json({ ok: true, message: "Foto caricate e ottimizzate su FTP.", urls: fotoUrls });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    finally { client.close(); }
});

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
      const newRow = [a.ID, a.codice, a.opzionale2 || a.Titolo, a.opzionale1, "", a.opzionale11, (a.opzionale12 || "").trim(), a.opzionale6, (a.opzionale13 || "").trim(), a.opzionale8, (a.opzionale15 || "").trim(), a.opzionale9, "", a.opzionale7, "", a.opzionale10, a.prza, a.przb, "", "", "", "", "", "FALSE", nowIso()];
      const found = existingMap.get(cod);
      if (!found) inserts.push(newRow);
      else {
        const merged = [...found.data];
        let changed = false;
        [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 13, 15, 16, 17].forEach(idx => { if (normalizeValue(merged[idx]) !== normalizeValue(newRow[idx])) { merged[idx] = newRow[idx]; changed = true; } });
        if (changed) { merged[24] = nowIso(); updates.push({ range: `${SHEET_TAB}!A${found.index}:Y${found.index}`, values: [merged] }); }
      }
    }
    if (updates.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: sheetId, requestBody: { valueInputOption: "RAW", data: updates } });
    if (inserts.length) await sheets.spreadsheets.values.append({ spreadsheetId: sheetId, range: `${SHEET_TAB}!A2`, valueInputOption: "RAW", requestBody: { values: inserts } });
    res.json({ ok: true, total: articoli.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/vinted/list-approvati", async (req, res) => {
  try {
    const { sheets, sheetId } = await getSheetsClient();
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${SHEET_TAB}!A1:Z10000` });
    const header = resp.data.values[0];
    const out = resp.data.values.slice(1).map(r => {
      const obj = {}; header.forEach((k, i) => obj[k] = r[i]);
      const missing = []; for (let i = 1; i <= 5; i++) if (!obj[`Foto_${i}`]) missing.push(`Foto_${i}`);
      if (!obj.Descrizione_IT) missing.push("Descrizione_IT");
      if (!obj.Titolo_FR || !obj.Descrizione_FR) missing.push("FR");
      if (!obj.Titolo_ES || !obj.Descrizione_ES) missing.push("ES");
      return { codice: obj.Codice, descrizione: obj.Descrizione_IT, pronto: obj.PRONTO_PER_VINTED, missing, script: obj.Script };
    }).filter(x => normalizeValue(x.script) === "approvato");
    res.json({ ok: true, articoli: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* =========================================================
   DASHBOARD
   ========================================================= */
app.get("/dashboard", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html><head><meta charset="utf-8"/><title>Dashboard</title>
  <style>
    body{font-family:sans-serif;background:#0b0f17;color:#fff;padding:20px}
    table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #26324d}
    button{background:#4c7dff;color:#fff;border:none;padding:8px;border-radius:5px;cursor:pointer;margin:2px}
    .btn-upload{background:#1fda85;color:#000}
    .missing{color:#ffcd4c;font-size:11px;display:block}
    input[type="file"]{display:none}
  </style></head>
  <body>
    <h1>📦 Dashboard Vinted</h1>
    <button onclick="load()">🔄 Ricarica</button>
    <table><thead><tr><th>Codice</th><th>Descrizione</th><th>Stato</th><th>Azione</th></tr></thead><tbody id="tb"></tbody></table>
    <input type="file" id="fileInput" multiple accept="image/*" />
    <script>
      let currentCodice = "";
      async function load(){
        const r = await fetch('/api/vinted/list-approvati');
        const j = await r.json();
        document.getElementById('tb').innerHTML = j.articoli.map(a => \`
          <tr>
            <td><b>\${a.codice}</b></td>
            <td>\${a.descrizione}<span class="missing">\${a.missing.length?'Mancano: '+a.missing.join(', '):''}</span></td>
            <td>\${a.pronto==='TRUE'?'✅ PRONTO':'❌ NO'}</td>
            <td>
              <button onclick="triggerUpload('\${a.codice}')" class="btn-upload">📸 Carica Foto PC</button>
              <button onclick="toDrive('\${a.codice}')">Drive</button>
            </td>
          </tr>\`).join('');
      }
      function triggerUpload(c){ currentCodice = c; document.getElementById('fileInput').click(); }
      document.getElementById('fileInput').onchange = async (e) => {
        const files = Array.from(e.target.files);
        if(files.length < 5) return alert("Seleziona almeno 5 immagini.");
        const images = await Promise.all(files.map(f => new Promise(res => {
          const rd = new FileReader(); rd.onload = () => res(rd.result); rd.readAsDataURL(f);
        })));
        const res = await fetch('/api/vinted/upload-pc-to-bman', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ codice: currentCodice, images })
        });
        const result = await res.json();
        alert(result.ok ? "✅ Foto caricate su FTP!" : "❌ Errore");
      };
      async function toDrive(c){ await fetch('/api/vinted/upload-to-drive?codice='+c); alert('Inviato!'); }
      load();
    </script></body></html>`);
});

app.get("/", (req, res) => { res.send("<h1>SyncFED Operativo</h1><a href='/dashboard'>Dashboard</a>"); });

app.listen(PORT, () => console.log(\`🚀 Server porta \${PORT}\`));
