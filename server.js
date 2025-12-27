/**
 * SyncFED – VERSIONE JS STABILE
 * - Sincronizzazione Delta: Bman -> Google Sheet.
 * - Dashboard: Stato OK basato solo sulle traduzioni (IT, FR, ES).
 * - Google Drive: Generazione file INFO.txt senza vincolo sulle foto.
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import xml2js from "xml2js";
import { google } from "googleapis";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 10000;

/* =========================================================
   CONFIGURAZIONI
   ========================================================= */
const BMAN_ENDPOINT = "https://emporiodeanna.bman.it/bmanapi.asmx";
const BMAN_CHIAVE = String(process.env.BMAN_API_KEY || "").trim();
const SHEET_TAB = (process.env.GOOGLE_SHEET_TAB || "PRODOTTI_BMAN").trim();
const SHEET_HEADERS = ["ID", "Codice", "Titolo", "Brand", "Tag15", "Script", "Descrizione_IT", "Titolo_FR", "Descrizione_FR", "Titolo_ES", "Descrizione_ES", "Titolo_DE", "Descrizione_DE", "Titolo_EN", "Descrizione_EN", "Categoria_Vinted", "Prezzo_Negozio", "Prezzo_Online", "Foto_1", "Foto_2", "Foto_3", "Foto_4", "Foto_5", "PRONTO_PER_VINTED", "UltimoSync"];

/* =========================================================
   HELPERS
   ========================================================= */
function normalizeValue(v) { 
  return v ? String(v).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : ""; 
}

function nowIso() { return new Date().toISOString(); }

async function getGoogleAuth() {
  return new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]
  );
}

async function ensureFolder(drive, folderName, parentId = null) {
  let query = `name = '${folderName.replace(/'/g, "\\")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  if (parentId) query += ` and '${parentId}' in parents`;
  const res = await drive.files.list({ q: query, fields: 'files(id, name)' });
  if (res.data.files && res.data.files.length > 0) return res.data.files[0].id;
  const folder = await drive.files.create({ 
    resource: { name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: parentId ? [parentId] : [] }, 
    fields: 'id' 
  });
  return folder.data.id;
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
  const soapBody = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><getAnagrafiche xmlns="http://cloud.bman.it/"><chiave>${BMAN_CHIAVE}</chiave><filtri><![CDATA[${filtriJson}]]></filtri><ordinamentoCampo>ID</ordinamentoCampo><ordinamentoDirezione>1</ordinamentoDirezione><numeroPagina>${numeroPagina}</numeroPagina><listaDepositi><![CDATA[[]]]></listaDepositi><dettaglioVarianti>false</dettaglioVarianti></getAnagrafiche></soap:Body></soap:Envelope>`;
  const xml = await soapCall("getAnagrafiche", soapBody);
  const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
  const result = parsed?.["soap:Envelope"]?.["soap:Body"]?.getAnagraficheResponse?.getAnagraficheResult ?? "";
  return JSON.parse(result || "[]");
}

/* =========================================================
   ROTTE API
   ========================================================= */

// 1. EXPORT DELTA
app.get("/api/step3/export-delta", async (req, res) => {
  try {
    const auth = await getGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const sheetId = process.env.GOOGLE_SHEET_ID;

    const scriptValues = ["si", "approvato"];
    const articoliSet = new Map();
    for (const sv of scriptValues) {
      let page = 1;
      while (true) {
        const chunk = await getAnagrafiche({ numeroPagina: page, filtri: [{ chiave: "opzionale11", operatore: "=", valore: sv }] });
        if (!chunk || chunk.length === 0) break;
        chunk.forEach(a => { if(a.codice) articoliSet.set(String(a.codice).trim(), a); });
        if (chunk.length < 50) break;
        page++;
      }
    }
    
    const articoli = Array.from(articoliSet.values());
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${SHEET_TAB}!A1:Z10000` });
    const values = resp.data.values || [];
    
    if (!values.length) {
      await sheets.spreadsheets.values.update({ spreadsheetId: sheetId, range: `${SHEET_TAB}!A1`, valueInputOption: "RAW", requestBody: { values: [SHEET_HEADERS] } });
    }

    const existingMap = new Map();
    values.slice(1).forEach((r, i) => { if (r[1]) existingMap.set(String(r[1]).trim(), { index: i + 2, data: r }); });

    const updates = [], inserts = [];
    for (const a of articoli) {
      const cod = String(a.codice).trim();
      let fotoUrls = [];
      if (a.foto && Array.isArray(a.foto)) {
        fotoUrls = a.foto.map(f => typeof f === 'string' ? f : (f.url || f.link || ""));
      }

      const newRow = [
        a.ID, a.codice, a.opzionale2 || a.Titolo, a.opzionale1 || "", "", a.opzionale11 || "", 
        (a.opzionale12 || "").trim(), a.opzionale6 || "", (a.opzionale13 || "").trim(), 
        a.opzionale8 || "", (a.opzionale15 || "").trim(), a.opzionale9 || "", "", 
        a.opzionale7 || "", "", a.opzionale10 || "", a.prza || "", a.przb || "", 
        fotoUrls[0] || "", fotoUrls[1] || "", fotoUrls[2] || "", fotoUrls[3] || "", fotoUrls[4] || "", 
        "FALSE", nowIso()
      ];
      
      const found = existingMap.get(cod);
      if (!found) inserts.push(newRow);
      else {
        const merged = [...found.data];
        let changed = false;
        const columnsToCheck = [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 20, 21, 22];
        columnsToCheck.forEach(idx => { 
          if (normalizeValue(merged[idx]) !== normalizeValue(newRow[idx])) { 
            merged[idx] = newRow[idx]; 
            changed = true; 
          } 
        });
        if (changed) { 
          merged[24] = nowIso(); 
          updates.push({ range: `${SHEET_TAB}!A${found.index}:Y${found.index}`, values: [merged] }); 
        }
      }
    }

    if (updates.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: sheetId, requestBody: { valueInputOption: "RAW", data: updates } });
    if (inserts.length) await sheets.spreadsheets.values.append({ spreadsheetId: sheetId, range: `${SHEET_TAB}!A2`, valueInputOption: "RAW", requestBody: { values: inserts } });
    
    res.json({ ok: true, total: articoli.length, updated: updates.length, inserted: inserts.length });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 2. GENERAZIONE TXT (SENZA CONTROLLO FOTO)
app.get("/api/vinted/generate-txt", async (req, res) => {
  const { codice } = req.query;
  try {
    const auth = await getGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const drive = google.drive({ version: "v3", auth });
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${SHEET_TAB}!A1:Z10000` });
    const values = resp.data.values || [];
    const header = values[0] || [];
    const row = values.slice(1).find(r => String(r[header.indexOf("Codice")]).trim() === codice);
    if (!row) throw new Error("Articolo non trovato");
    const d = {}; header.forEach((k, i) => d[k] = row[i] || "");
    
    const rootId = await ensureFolder(drive, "DATI_VINTED");
    const prodFolderId = await ensureFolder(drive, `${codice} - ${d.Titolo}`, rootId);
    
    const content = `CODICE: ${codice}\n\nIT: ${d.Titolo}\n${d.Descrizione_IT}\n\nFR: ${d.Titolo_FR}\n${d.Descrizione_FR}\n\nES: ${d.Titolo_ES}\n${d.Descrizione_ES}\n\nPREZZO: ${d.Prezzo_Online}\nBRAND: ${d.Brand}`;
    
    await drive.files.create({ resource: { name: `INFO_${codice}.txt`, parents: [prodFolderId] }, media: { mimeType: 'text/plain', body: content } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 3. LISTA DASHBOARD (STATO OK SOLO SU TRADUZIONI)
app.get("/api/vinted/list", async (req, res) => {
  try {
    const auth = await getGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${SHEET_TAB}!A1:Z10000` });
    const values = resp.data.values || [];
    const header = values[0] || [];
    const out = values.slice(1).map(r => {
      const obj = {}; header.forEach((k, i) => obj[k] = r[i]);
      const missing = [];
      if (!obj.Descrizione_IT) missing.push("IT");
      if (!obj.Titolo_FR || !obj.Descrizione_FR) missing.push("FR");
      if (!obj.Titolo_ES || !obj.Descrizione_ES) missing.push("ES");
      
      // L'articolo è considerato pronto se non mancano traduzioni
      const isOk = missing.length === 0;
      
      return { codice: obj.Codice, titolo: obj.Titolo, pronto: isOk ? "TRUE" : "FALSE", script: obj.Script, missing };
    }).filter(x => normalizeValue(x.script) === "approvato");
    res.json({ ok: true, articoli: out });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* =========================================================
   UI
   ========================================================= */
app.get("/dashboard", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html><head><meta charset="utf-8"/><title>Dashboard</title><style>body{font-family:sans-serif;background:#0b0f17;color:#fff;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:12px;border-bottom:1px solid #26324d;text-align:left}.missing{color:#ffcd4c;font-size:11px;display:block}button{background:#4c7dff;color:#fff;border:none;padding:8px 12px;border-radius:5px;cursor:pointer;font-weight:bold}</style></head><body><h1>📦 Dashboard Vinted</h1><button onclick="load()">🔄 Ricarica</button><div id="st"></div><table><thead><tr><th>Codice</th><th>Titolo</th><th>Stato</th><th>Azione</th></tr></thead><tbody id="tb"></tbody></table><script>async function load(){document.getElementById('st').innerText='⏳...';const r=await fetch('/api/vinted/list');const j=await r.json();document.getElementById('st').innerText='';document.getElementById('tb').innerHTML=j.articoli.map(a=>'<tr><td><b>'+a.codice+'</b></td><td>'+a.titolo+'<span class="missing">'+(a.missing.length?"Mancano: "+a.missing.join(", "):"")+'</span></td><td>'+(a.pronto==="TRUE"?"✅":"❌")+'</td><td><button onclick="gen(\\''+a.codice+'\\')">📄 Crea TXT su Drive</button></td></tr>').join('');}async function gen(c){const r=await fetch('/api/vinted/generate-txt?codice='+c);const j=await r.json();alert(j.ok?'✅ File INFO generato su Drive!':'❌ Errore');}load();</script></body></html>`);
});

app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html><head><meta charset="utf-8"/><title>SyncFED</title><style>body{font-family:Arial;padding:40px;background:#0b0f17;color:#fff}button{padding:15px 25px;border-radius:10px;border:0;cursor:pointer;font-weight:bold;margin:10px;background:#1fda85;color:#000}</style></head><body><h1>🚀 SyncFED Operativo</h1><button onclick="fetch('/api/step3/export-delta').then(r=>r.json()).then(j=>alert('Sync OK: '+j.total))">1. Esegui Export Delta</button><button style="background:#4c7dff;color:#fff" onclick="window.location.href='/dashboard'">2. Dashboard Vinted</button></body></html>`);
});

app.listen(PORT, () => console.log(`🚀 Server porta ${PORT}`));
