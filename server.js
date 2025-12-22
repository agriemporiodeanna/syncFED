import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

/* =========================================================
   GOOGLE SHEETS
   ========================================================= */

function getEnv(name) {
  return String(process.env[name] || '').trim();
}

function getGoogleClient() {
  const auth = new google.auth.JWT({
    email: getEnv('GOOGLE_CLIENT_EMAIL'),
    key: getEnv('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  return {
    sheets: google.sheets({ version: 'v4', auth }),
    sheetId: getEnv('GOOGLE_SHEET_ID'),
    sheetTab: getEnv('GOOGLE_SHEET_TAB') || 'PRODOTTI_BMAN',
  };
}

async function readSheet() {
  const { sheets, sheetId, sheetTab } = getGoogleClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${sheetTab}!A1:Z`,
  });

  const [headers, ...rows] = res.data.values;
  return rows.map(r => {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = r[i] || ''));
    return obj;
  });
}

/* =========================================================
   DASHBOARD
   ========================================================= */

app.get('/dashboard', async (req, res) => {
  res.send(`<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8"/>
<title>Dashboard Vinted</title>
<style>
body{font-family:Arial;background:#0b0f17;color:#e8eefc;padding:20px}
table{width:100%;border-collapse:collapse}
th,td{padding:10px;border-bottom:1px solid #333}
button{padding:8px 12px;font-weight:bold;border-radius:8px;border:0;cursor:pointer}
.ok{background:#1fda85}
input{padding:8px;border-radius:6px;border:1px solid #444;background:#111;color:#fff}
</style>
</head>
<body>

<h1>🧵 Articoli Script = Approvato</h1>

<div>
Percorso base (Render usa /tmp):<br/>
<input id="path" value="/tmp/vinted" style="width:300px"/>
</div>

<table>
<thead>
<tr>
<th>Codice</th>
<th>Descrizione IT</th>
<th>Azione</th>
</tr>
</thead>
<tbody id="rows"></tbody>
</table>

<pre id="log"></pre>

<script>
async function load(){
  const r = await fetch('/api/vinted/list');
  const j = await r.json();
  const tb = document.getElementById('rows');
  tb.innerHTML = j.map(a=>\`
    <tr>
      <td><b>\${a.Codice}</b></td>
      <td>\${a.Descrizione_IT}</td>
      <td>
        <button class="ok" onclick="ready('\${a.Codice}')">
          PRONTO PER VINTED
        </button>
      </td>
    </tr>
  \`).join('');
}

async function ready(codice){
  const basePath = document.getElementById('path').value;
  const r = await fetch('/api/vinted/ready', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ codice, basePath })
  });
  const j = await r.json();
  document.getElementById('log').textContent = JSON.stringify(j,null,2);
}

load();
</script>

</body>
</html>`);
});

/* =========================================================
   API: LISTA SCRIPT = APPROVATO
   ========================================================= */

app.get('/api/vinted/list', async (req, res) => {
  const rows = await readSheet();
  const approved = rows.filter(r =>
    r.Script.toLowerCase() === 'approvato'
  );
  res.json(approved);
});

/* =========================================================
   API: PRONTO PER VINTED
   ========================================================= */

app.post('/api/vinted/ready', async (req, res) => {
  const { codice, basePath } = req.body;
  if (!codice || !basePath) {
    return res.status(400).json({ ok:false, error:'Parametri mancanti' });
  }

  const rows = await readSheet();
  const a = rows.find(r => r.Codice === codice);
  if (!a) return res.status(404).json({ ok:false, error:'Articolo non trovato' });

  const required = [
    'Titolo','Descrizione_IT',
    'Titolo_FR','Descrizione_FR',
    'Titolo_ES','Descrizione_ES'
  ];
  for (const k of required) {
    if (!a[k]) {
      return res.status(400).json({ ok:false, error:`Campo mancante: ${k}` });
    }
  }

  const dir = path.join(basePath, codice);
  fs.mkdirSync(dir, { recursive: true });

  const content = `
CODICE: ${codice}

=== ITALIANO ===
Titolo: ${a.Titolo}
Descrizione:
${a.Descrizione_IT}

=== FRANCESE ===
Titre: ${a.Titolo_FR}
Description:
${a.Descrizione_FR}

=== SPAGNOLO ===
Título: ${a.Titolo_ES}
Descripción:
${a.Descrizione_ES}

=== PREZZI ===
Prezzo listino negozio: ${a.Prezzo_Negozio || 'n.d.'} €
Prezzo listino online: ${a.Prezzo_Online || 'n.d.'} €
`.trim();

  fs.writeFileSync(path.join(dir, `${codice}.txt`), content, 'utf8');

  res.json({ ok:true, status:'PRONTO PER VINTED', path: dir });
});

/* =========================================================
   START
   ========================================================= */

app.listen(PORT, () => {
  console.log('🚀 SyncFED avviato su porta', PORT);
});
