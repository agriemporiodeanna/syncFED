import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import xml2js from 'xml2js';
import { google } from 'googleapis';
import archiver from 'archiver';

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const PORT = process.env.PORT || 10000;

/* =========================================================
   CONFIG BMAN
   ========================================================= */
const BMAN_ENDPOINT = 'https://emporiodeanna.bman.it/bmanapi.asmx';
const BMAN_CHIAVE = process.env.BMAN_API_KEY || '';

/* =========================================================
   UTIL
   ========================================================= */
function normalize(v) {
  return String(v ?? '').trim().toLowerCase();
}

function safeParse(json) {
  try { return JSON.parse(json); } catch { return []; }
}

/* =========================================================
   SOAP
   ========================================================= */
async function soapCall(action, body) {
  const r = await fetch(BMAN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: action,
    },
    body,
  });
  return r.text();
}

async function getAnagrafiche({ page = 1, filtri = [] }) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getAnagrafiche xmlns="http://cloud.bman.it/">
      <chiave>${BMAN_CHIAVE}</chiave>
      <filtri><![CDATA[${JSON.stringify(filtri)}]]></filtri>
      <ordinamentoCampo>ID</ordinamentoCampo>
      <ordinamentoDirezione>1</ordinamentoDirezione>
      <numeroPagina>${page}</numeroPagina>
      <listaDepositi><![CDATA[]]></listaDepositi>
      <dettaglioVarianti>false</dettaglioVarianti>
    </getAnagrafiche>
  </soap:Body>
</soap:Envelope>`;

  const xml = await soapCall('http://cloud.bman.it/getAnagrafiche', body);
  const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
  const res = parsed?.['soap:Envelope']?.['soap:Body']?.['getAnagraficheResponse']?.['getAnagraficheResult'];
  return safeParse(res);
}

/* =========================================================
   STEP 2 – TUTTI SCRIPT=SI
   ========================================================= */
async function getAllScriptSI() {
  const out = [];
  let page = 1;

  while (true) {
    const chunk = await getAnagrafiche({
      page,
      filtri: [{ chiave: 'opzionale11', operatore: '=', valore: 'si' }],
    });
    if (!chunk.length) break;
    out.push(...chunk.filter(a => normalize(a.opzionale11) === 'si'));
    if (chunk.length < 50) break;
    page++;
  }
  return out;
}

/* =========================================================
   GOOGLE SHEET
   ========================================================= */
function googleCreds() {
  return {
    sheetId: process.env.GOOGLE_SHEET_ID,
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  };
}

async function sheetsClient() {
  const c = googleCreds();
  const auth = new google.auth.JWT({
    email: c.email,
    key: c.key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  await auth.authorize();
  return { sheets: google.sheets({ version: 'v4', auth }), sheetId: c.sheetId };
}

const TAB = 'PRODOTTI_BMAN';

const HEADERS = [
  'ID','Codice','Titolo','Brand','Tag15','Script',
  'Descrizione_IT','Titolo_FR','Descrizione_FR',
  'Titolo_ES','Descrizione_ES',
  'Titolo_DE','Descrizione_DE',
  'Titolo_EN','Descrizione_EN',
  'Foto_1','Foto_2','Foto_3','Foto_4','Foto_5',
  'ProfonditaCM','PesoKG','UnitaMisura',
  'Sottoscorta','RiordinoMinimo','Stato','UltimoSync'
];

function rowFromBman(a) {
  return [
    a.ID, a.codice,
    a.opzionale2, a.opzionale1, '',
    a.opzionale11,
    a.opzionale12,
    a.opzionale6, '',
    a.opzionale8, '',
    a.opzionale9, '',
    a.opzionale7, '',
    ...(a.arrFoto || []).slice(0,5),
    '', '', '', '', '', '', ''
  ];
}

/* =========================================================
   STEP 3 – EXPORT
   ========================================================= */
app.get('/api/step3/export', async (req,res)=>{
  try {
    const articoli = await getAllScriptSI();
    const { sheets, sheetId } = await sheetsClient();

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${TAB}!A1:AA1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    });

    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: `${TAB}!A2:AA`,
    });

    const rows = articoli.map(rowFromBman);
    if (rows.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${TAB}!A2`,
        valueInputOption: 'RAW',
        requestBody: { values: rows },
      });
    }

    res.json({ ok:true, esportati: rows.length });
  } catch(e){
    res.status(500).json({ ok:false, error:e.message });
  }
});

/* =========================================================
   ANALISI VINTED + DOWNLOAD ZIP
   ========================================================= */
app.get('/api/vinted/analyze', async (req,res)=>{
  const codice = String(req.query.codice || '').trim();
  if (!codice) return res.status(400).json({ ok:false });

  const { sheets, sheetId } = await sheetsClient();
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${TAB}!A2:AA`,
  });

  const row = (r.data.values||[]).find(x=>x[1]===codice);
  if (!row) return res.json({ ok:false });

  const foto = row.slice(15,20).filter(Boolean);
  const ok =
    foto.length>0 &&
    row[6] && row[8] && row[10];

  if (!ok) return res.json({ ok:false });

  res.setHeader('Content-Type','application/zip');
  res.setHeader('Content-Disposition',`attachment; filename=${codice}_VINTED.zip`);

  const zip = archiver('zip');
  zip.pipe(res);

  // descrizione.doc
  const doc =
`${row[2]}
${row[6]}

${row[7]}
${row[8]}

${row[9]}
${row[10]}`;
  zip.append(doc,{ name:'descrizione.doc' });

  // foto
  for (let i=0;i<foto.length;i++){
    const img = await fetch(foto[i]).then(r=>r.buffer());
    zip.append(img,{ name:`foto_${i+1}.jpg` });
  }

  zip.finalize();
});

/* =========================================================
   DASHBOARD
   ========================================================= */
app.get('/',(req,res)=>{
res.send(`
<!doctype html>
<html><body style="font-family:Arial;padding:20px">
<h1>SyncFED – Vinted</h1>
<input id="c" placeholder="Codice articolo"/>
<button onclick="go()">Analizza per Vinted</button>
<pre id="o"></pre>
<script>
function go(){
 const c=document.getElementById('c').value;
 fetch('/api/vinted/analyze?codice='+c)
 .then(r=>{
   if(r.headers.get('content-type').includes('zip')) r.blob().then(b=>{
     const a=document.createElement('a');
     a.href=URL.createObjectURL(b);
     a.download=c+'_VINTED.zip';a.click();
   })
   else r.json().then(j=>o.textContent=JSON.stringify(j,null,2));
 });
}
</script>
</body></html>
`);
});

/* =========================================================
   START
   ========================================================= */
app.listen(PORT,()=>console.log('🚀 SyncFED avviato'));
