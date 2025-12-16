console.log('NODE VERSION =', process.version);
console.log('OPENSSL VERSION =', process.versions.openssl);
import express from 'express';
import fetch from 'node-fetch';
import xml2js from 'xml2js';

const app = express();
const PORT = process.env.PORT || 10000;

/* =========================================================
   LOG AMBIENTE (verifica Node + OpenSSL)
   ========================================================= */
console.log('NODE VERSION =', process.version);
console.log('OPENSSL VERSION =', process.versions.openssl);

/* =========================================================
   CONFIG BMAN
   ========================================================= */
const BMAN_ENDPOINT = 'https://emporiodeanna.bman.it/bmanapi.asmx';
const BMAN_CHIAVE = process.env.BMAN_API_KEY;

if (!BMAN_CHIAVE) {
  console.error('❌ BMAN_API_KEY mancante');
}

/* =========================================================
   NORMALIZZAZIONE
   ========================================================= */
function normalize(v) {
  return (v ?? '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/* =========================================================
   SOAP HELPER
   ========================================================= */
async function soapCall(action, body) {
  const res = await fetch(BMAN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: action,
    },
    body,
  });

  return res.text();
}

async function parseSoapResult(xml, responseTag, resultTag) {
  const parsed = await xml2js.parseStringPromise(xml, {
    explicitArray: false,
  });

  const json =
    parsed?.['soap:Envelope']?.['soap:Body']?.[responseTag]?.[resultTag];

  if (!json) return [];
  return JSON.parse(json);
}

/* =========================================================
   getAnagrafiche (NON v4)
   ========================================================= */
async function getAnagrafiche({ filtri = [], listaDepositi = [] } = {}) {
  const filtriJson = JSON.stringify(filtri);
  const depositiJson = JSON.stringify(listaDepositi);

  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getAnagrafiche xmlns="http://cloud.bman.it/">
      <chiave>${BMAN_CHIAVE}</chiave>
      <filtri><![CDATA[${filtriJson}]]></filtri>
      <ordinamentoCampo>ID</ordinamentoCampo>
      <ordinamentoDirezione>1</ordinamentoDirezione>
      <numeroPagina>1</numeroPagina>
      <listaDepositi><![CDATA[${depositiJson}]]></listaDepositi>
      <dettaglioVarianti>false</dettaglioVarianti>
    </getAnagrafiche>
  </soap:Body>
</soap:Envelope>`;

  const xml = await soapCall(
    'http://cloud.bman.it/getAnagrafiche',
    body
  );

  return parseSoapResult(
    xml,
    'getAnagraficheResponse',
    'getAnagraficheResult'
  );
}

/* =========================================================
   STEP 2 – Script = SI
   ========================================================= */
app.get('/api/step2/script-si', async (req, res) => {
  try {
    const articoli = await getAnagrafiche({
      filtri: [],          // NESSUN filtro lato BMAN
      listaDepositi: [1],  // deposito NEGOZIO
    });

    const filtrati = articoli.filter(
      (a) => normalize(a.opzionale11) === 'si'
    );

    console.log('Totale articoli BMAN:', articoli.length);
    console.log('Script = SI:', filtrati.length);

    res.json({
      ok: true,
      step: 'STEP 2 – Script = SI',
      totale: filtrati.length,
      articoli: filtrati,
    });
  } catch (err) {
    console.error('❌ STEP 2 errore:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   DEBUG RAW
   ========================================================= */
app.get('/api/debug/anagrafiche-raw', async (req, res) => {
  try {
    const data = await getAnagrafiche({ listaDepositi: [1] });
    res.json({
      ok: true,
      totale: data.length,
      sample: data.slice(0, 5),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   ROOT
   ========================================================= */
app.get('/', (req, res) => {
  res.send('🚀 SyncFED – STEP 2 OK – Node 16');
});

/* =========================================================
   START
   ========================================================= */
app.listen(PORT, () => {
  console.log(`🚀 Server avviato sulla porta ${PORT}`);
});
