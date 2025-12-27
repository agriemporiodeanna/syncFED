/**
 * SyncFED – VERSIONE DOWNLOAD LOCALE (CON PREZZI NEGOZIO/ONLINE)
 * - Sincronizzazione Bman -> Sheet.
 * - Generazione TXT: Download diretto "codice_titolo.txt".
 * - Formattazione: Testo, prezzi e nome file in minuscolo.
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
    ["https://www.googleapis.com/auth/spreadsheets"]
  );
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
    if (!values.length) await sheets.spreadsheets.values.update({ spreadsheetId: sheetId, range: `${SHEET_TAB}!A1`, valueInputOption: "RAW", requestBody: { values: [SHEET_HEADERS] } });
    const existingMap = new Map();
    values.slice(1).forEach((r, i) => { if (r[1]) existingMap.set(String(r[1]).trim(), { index: i + 2, data: r }); });
    const updates = [], inserts = [];
    for (const a of articoli) {
      const cod = String(a.codice).trim();
      let fotoUrls = [];
      if (a.foto && Array.isArray(a.foto)) fotoUrls = a.foto.map(f => typeof f === 'string' ? f : (f.url || f.link || ""));
      const newRow = [a.ID, a.codice, a.opzionale2 || a.Titolo, a.opzionale1 || "", "", a.opzionale11 || "", (a.opzionale12 || "").trim(), a.opzionale6 || "", (a.opzionale13 || "").trim(), a.opzionale8 || "", (a.opzionale15 || "").trim(), a.opzionale9 || "", "", a.opzionale7 || "", "", a.opzionale10 || "", a.prza || "", a.przb || "", fotoUrls[0] || "", fotoUrls[1] || "", fotoUrls[2] || "", fotoUrls[3] || "", fotoUrls[4] || "", "FALSE", nowIso()];
      const found = existingMap.get(cod);
      if (!found) inserts.push(newRow);
      else {
        const merged = [...found.data];
        let changed = false;
        [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 20, 21, 22].forEach(idx => { if (normalizeValue(merged[idx]) !== normalizeValue(newRow[idx])) { merged[idx] = newRow[idx]; changed = true; } });
        if (changed) { merged[24] = nowIso(); updates.push({ range: `${SHEET_TAB}!A${found.index}:Y${found.index}`, values: [merged] }); }
      }
    }
    if (updates.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: sheetId, requestBody: { valueInputOption: "RAW", data: updates } });
    if (inserts.length) await sheets.spreadsheets.values.append({ spreadsheetId: sheetId, range: `${SHEET_TAB}!A2`, valueInputOption: "RAW", requestBody: { values: inserts } });
    res.json({ ok: true, total: articoli.length });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get("/api/vinted/download-txt", async (req, res) => {
  const { codice } = req.query;
  try {
    const auth = await getGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${SHEET_TAB}!A1:Z10000` });
    const values = resp.data.values || [];
    const header = values[0] || [];
    const row = values.slice(1).find(r => String(r[header.indexOf("Codice")]).trim() === codice);
    if (!row) return res.status(404).send("Articolo non trovato");
    
    const d = {}; header.forEach((k, i) => d[k] = row[i] || "");

    const content = `codice: ${codice}

descrizione it:
${String(d.Descrizione_IT).toLowerCase()}

titolo fr:
${String(d.Titolo_FR).toLowerCase()}

descrizione fr:
${String(d.Descrizione_FR).toLowerCase()}

titolo es:
${String(d.Titolo_ES).toLowerCase()}

descrizione es:
${String(d.Descrizione_ES).toLowerCase()}

----------------------------------
prezzo negozio: ${String(d.Prezzo_Negozio).toLowerCase()}
prezzo online: ${String(d.Prezzo_Online).toLowerCase()}
brand: ${String(d.Brand).toLowerCase()}`;

    // NOME FILE DINAMICO
    const safeTitolo = normalizeValue(d.Titolo).replace(/\s+/g, '_');
    const fileName = `${codice}_${safeTitolo}.txt`;

    res.setHeader('Content-disposition', `attachment; filename=${fileName}`);
    res.setHeader('Content-type', 'text/plain');
    res.send(content);
  } catch (e) { res.status(500).send(e.message); }
});

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
      if (!String(obj.Descrizione_IT).trim()) missing.push("IT");
      if (!String(obj.Titolo_FR).trim() || !String(obj.Descrizione_FR).trim()) missing.push("FR");
      if (!String(obj.Titolo_ES).trim() || !String(obj.Descrizione_ES).trim()) missing.push("ES");
      return { codice: obj.Codice, titolo: obj.Titolo, pronto: (missing.length === 0) ? "TRUE" : "FALSE", script: obj.Script, missing };
    }).filter(x => normalizeValue(x.script) === "approvato");
    res.json({ ok: true, articoli: out });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* =========================================================
   UI
   ========================================================= */
app.get("/dashboard", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html><head><meta charset="utf-8"/><title>Dashboard</title><style>body{font-family:sans-serif;background:#0b0f17;color:#fff;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:12px;border-bottom:1px solid #26324d;text-align:left}.missing{color:#ffcd4c;font-size:11px;display:block}button{background:#4c7dff;color:#fff;border:none;padding:8px 12px;border-radius:5px;cursor:pointer;font-weight:bold}</style></head><body><h1>📦 Dashboard Vinted</h1><button onclick="load()">🔄 Ricarica</button><div id="st"></div><table><thead><tr><th>Codice</th><th>Titolo</th><th>Stato</th><th>Azione</th></tr></thead><tbody id="tb"></tbody></table><script>async function load(){document.getElementById('st').innerText='⏳...';try{const r=await fetch('/api/vinted/list');const j=await r.json();document.getElementById('st').innerText='';document.getElementById('tb').innerHTML=j.articoli.map(a=>'<tr><td><b>'+a.codice+'</b></td><td>'+a.titolo+'<span class="missing">'+(a.missing.length?"Mancano: "+a.missing.join(", "):"")+'</span></td><td>'+(a.pronto==="TRUE"?"✅":"❌")+'</td><td><button onclick="window.location.href=\\'/api/vinted/download-txt?codice='+a.codice+'\\'">📄 Crea TXT</button></td></tr>').join('');}catch(e){document.getElementById('st').innerText='Errore caricamento dati';}}load();</script></body></html>`);
});

app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html><head><meta charset="utf-8"/><title>SyncFED</title><style>body{font-family:Arial;padding:40px;background:#0b0f17;color:#fff}button{padding:15px 25px;border-radius:10px;border:0;cursor:pointer;font-weight:bold;margin:10px;background:#1fda85;color:#000}</style></head><body><h1>🚀 SyncFED Operativo</h1><button onclick="fetch('/api/step3/export-delta').then(r=>r.json()).then(j=>alert('Sync OK'))">1. Esegui Export Delta</button><button style="background:#4c7dff;color:#fff" onclick="window.location.href='/dashboard'">2. Dashboard Vinted</button></body></html>`);
});

app.listen(PORT, () => console.log(\`🚀 Server porta \${PORT}\`));
