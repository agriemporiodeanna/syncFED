/**
 * SyncFED – PRODUZIONE 2025 – SOLO GENERAZIONE TXT SU DRIVE
 * - Export DELTA (Bman -> Sheet) completo.
 * - Rimozione caricamento foto.
 * - Salvataggio file TXT con i dettagli dell'articolo in cartelle dedicate su Drive.
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import xml2js from "xml2js";
import { google } from "googleapis";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" })); 

const PORT = process.env.PORT || 10000;

/* =========================================================
   CONFIGURAZIONI & HELPERS
   ========================================================= */
const BMAN_ENDPOINT = "https://emporiodeanna.bman.it/bmanapi.asmx";
const SHEET_TAB = (process.env.GOOGLE_SHEET_TAB || "PRODOTTI_BMAN").trim();

function normalizeValue(v) { return v ? String(v).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : ""; }

async function getGoogleAuth() {
  return new google.auth.JWT(process.env.GOOGLE_CLIENT_EMAIL, null, process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"), [
    "https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"
  ]);
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

/* =========================================================
   ROTTE API
   ========================================================= */

// GENERAZIONE SOLO FILE TXT SU DRIVE
app.post("/api/vinted/generate-txt-drive", async (req, res) => {
    const { codice } = req.body; 
    
    try {
        const auth = await getGoogleAuth();
        const drive = google.drive({ version: "v3", auth });
        const sheets = google.sheets({ version: "v4", auth });
        
        // Recupero dati completi dallo Sheet
        const resp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${SHEET_TAB}!A1:Z10000` });
        const values = resp.data.values || [];
        const header = values[0] || [];
        const rowArr = values.slice(1).find(r => String(r[header.indexOf("Codice")]).trim() === codice);

        if (!rowArr) return res.status(404).json({ ok: false, error: "Codice non trovato nello Sheet." });

        // Creazione oggetto per mappare i dati
        const d = {};
        header.forEach((k, i) => d[k] = rowArr[i] || "");

        const titolo = d.Titolo || "Senza_Titolo";
        const rootId = await ensureFolder(drive, "DATI_VINTED");
        const productFolderId = await ensureFolder(drive, `${codice} - ${titolo}`, rootId);

        // Composizione del contenuto del file TXT
        const txtContent = `
=== SCHEDA PRODOTTO: ${codice} ===
TITOLO IT: ${d.Titolo}
DESCRIZIONE IT:
${d.Descrizione_IT}

----------------------------------
TITOLO FR: ${d.Titolo_FR}
DESCRIZIONE FR:
${d.Descrizione_FR}

----------------------------------
TITOLO ES: ${d.Titolo_ES}
DESCRIZIONE ES:
${d.Descrizione_ES}

----------------------------------
PREZZO NEGOZIO: ${d.Prezzo_Negozio}
PREZZO ONLINE: ${d.Prezzo_Online}
BRAND: ${d.Brand}
CATEGORIA VINTED: ${d.Categoria_Vinted}
TAGS: ${d.Tag15}
`.trim();

        // Salvataggio file TXT su Drive
        await drive.files.create({ 
            resource: { name: `INFO_${codice}.txt`, parents: [productFolderId] }, 
            media: { mimeType: 'text/plain', body: txtContent },
            fields: 'id'
        });

        res.json({ ok: true, message: "File TXT generato con successo su Drive!" });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get("/api/vinted/list-approvati", async (req, res) => {
  try {
    const auth = await getGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `${SHEET_TAB}!A1:Z10000` });
    const values = resp.data.values || [];
    const header = values[0] || [];
    const out = values.slice(1).map(r => {
      const obj = {}; header.forEach((k, i) => obj[k] = r[i]);
      return { 
        codice: obj.Codice, 
        descrizione: obj.Descrizione_IT, 
        pronto: obj.PRONTO_PER_VINTED, 
        script: obj.Script 
      };
    }).filter(x => normalizeValue(x.script) === "approvato");
    res.json({ ok: true, articoli: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* =========================================================
   UI DASHBOARD AGGIORNATA
   ========================================================= */
app.get("/dashboard", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html><head><meta charset="utf-8"/><title>Dashboard</title>
  <style>
    body{font-family:sans-serif;background:#0b0f17;color:#fff;padding:20px}
    table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #26324d;text-align:left}
    button{background:#4c7dff;color:#fff;border:none;padding:8px;border-radius:5px;cursor:pointer;font-weight:bold}
    .btn-txt{background:#ff9800;color:#fff}
  </style></head>
  <body>
    <h1>📦 Generatore Schede Vinted</h1>
    <button onclick="window.location.href='/'">⬅ Home</button> <button onclick="load()">🔄 Ricarica</button>
    <div id="st" style="margin:10px 0"></div>
    <table><thead><tr><th>Codice</th><th>Descrizione</th><th>Azione</th></tr></thead><tbody id="tb"></tbody></table>
    <script>
      async function load(){
        document.getElementById('st').innerText = "⏳ Caricamento...";
        const r = await fetch('/api/vinted/list-approvati');
        const j = await r.json();
        document.getElementById('st').innerText = "✅ Seleziona un articolo per creare il file TXT su Drive";
        document.getElementById('tb').innerHTML = j.articoli.map(a => \`
          <tr>
            <td><b>\${a.codice}</b></td>
            <td>\${a.descrizione || '---'}</td>
            <td><button onclick="creaTxt('\${a.codice}')" class="btn-txt">📄 Genera TXT su Drive</button></td>
          </tr>\`).join('');
      }
      async function creaTxt(c){
        const btn = event.target;
        btn.innerText = "⏳..."; btn.disabled = true;
        const res = await fetch('/api/vinted/generate-txt-drive', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ codice: c })
        });
        const result = await res.json();
        btn.innerText = "📄 Genera TXT su Drive"; btn.disabled = false;
        alert(result.ok ? result.message : "❌ Errore: " + result.error);
      }
      load();
    </script></body></html>`);
});

app.get("/", (req, res) => {
  res.send(\`<!doctype html><html><body style="background:#0b0f17;color:#fff;font-family:sans-serif;padding:50px;">
    <h1>🚀 SyncFED</h1>
    <button style="padding:15px;cursor:pointer;" onclick="window.location.href='/dashboard'">Vai alla Dashboard TXT</button>
  </body></html>\`);
});

app.listen(PORT, () => console.log(\`🚀 SyncFED porta \${PORT}\`));
