import express from 'express';
import fetch from 'node-fetch';
import bodyParser from 'body-parser';
import xml2js from 'xml2js';
import { google } from 'googleapis';

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;

/* =========================================================
   LOG AMBIENTE
   ========================================================= */
console.log('NODE VERSION =', process.version);
console.log('OPENSSL VERSION =', process.versions.openssl);

/* =========================================================
   CONFIGURAZIONE BMAN
   ========================================================= */

const BMAN_ENDPOINT = 'https://emporiodeanna.bman.it/bmanapi.asmx';
const BMAN_CHIAVE = process.env.BMAN_API_KEY;

if (!BMAN_CHIAVE) {
  console.error('❌ Variabile ambiente mancante: BMAN_API_KEY');
}

/* =========================================================
   NORMALIZZAZIONE ROBUSTA
   ========================================================= */

function normalizeValue(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/* =========================================================
   SOAP getAnagrafiche (BASE STABILE)
   ========================================================= */

async function getAnagrafiche() {
  const filtri = [
    { chiave: 'opzionale11', operatore: '=', valore: 'si' }
  ];

  const soapBody = `
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getAnagrafiche xmlns="http://cloud.bman.it/">
      <chiave>${BMAN_CHIAVE}</chiave>
      <filtri><![CDATA[${JSON.stringify(filtri)}]]></filtri>
      <ordinamentoCampo>ID</ordinamentoCampo>
      <ordinamentoDirezione>1</ordinamentoDirezione>
      <numeroPagina>1</numeroPagina>
      <listaDepositi><![CDATA[[1]]]></listaDepositi>
      <dettaglioVarianti>false</dettaglioVarianti>
    </getAnagrafiche>
  </soap:Body>
</soap:Envelope>`.trim();

  const response = await fetch(BMAN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'http://cloud.bman.it/getAnagrafiche'
    },
    body: soapBody
  });

  const xml = await response.text();
  const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });

  const result =
    parsed?.['soap:Envelope']?.['soap:Body']?.['getAnagraficheResponse']?.['getAnagraficheResult'];

  return JSON.parse(result || '[]');
}

/* =========================================================
   STEP 2 – SCRIPT = SI (OK)
   ========================================================= */

app.get('/api/step2/script-si', async (req, res) => {
  try {
    const articoli = await getAnagrafiche();

    const filtrati = articoli.filter(a =>
      normalizeValue(a.opzionale11) === 'si'
    );

    console.log(`📦 Articoli ricevuti: ${articoli.length}`);
    console.log(`✅ Articoli Script=SI: ${filtrati.length}`);

    res.json({
      ok: true,
      step: 'STEP 2 – Script = SI',
      totale: filtrati.length,
      articoli: filtrati
    });

  } catch (err) {
    console.error('❌ Errore STEP 2:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   TEST GOOGLE KEY – DA BROWSER
   ========================================================= */

app.get('/api/test/google-key', async (req, res) => {
  try {
    const email = process.env.GOOGLE_CLIENT_EMAIL;
    const keyRaw = process.env.GOOGLE_PRIVATE_KEY;

    if (!email || !keyRaw) {
      return res.status(500).json({
        ok: false,
        error: 'Variabili ambiente mancanti',
        missing: [
          !email ? 'GOOGLE_CLIENT_EMAIL' : null,
          !keyRaw ? 'GOOGLE_PRIVATE_KEY' : null
        ].filter(Boolean)
      });
    }

    // NORMALIZZAZIONE RAW (OBBLIGATORIA)
    const privateKey = keyRaw.replace(/\\n/g, '\n');

    const auth = new google.auth.JWT({
      email,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });

    await auth.authorize();

    res.json({
      ok: true,
      message: 'Chiave Google valida – JWT firmato correttamente',
      node: process.version
    });

  } catch (err) {
    console.error('❌ Errore Google test:', err);
    res.status(500).json({
      ok: false,
      error: err.message,
      code: err.code || 'UNKNOWN'
    });
  }
});

/* =========================================================
   DEBUG RAW
   ========================================================= */

app.get('/api/debug/anagrafiche-raw', async (req, res) => {
  try {
    const articoli = await getAnagrafiche();
    res.json({
      ok: true,
      totale: articoli.length,
      sample: articoli.slice(0, 5)
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* =========================================================
   ROOT / HEALTH
   ========================================================= */

app.get('/', (req, res) => {
  res.send('🚀 SyncFED attivo – STEP 2 OK – Google Test disponibile');
});

/* =========================================================
   START SERVER
   ========================================================= */

app.listen(PORT, () => {
  console.log(`🚀 SyncFED avviato sulla porta ${PORT}`);
});
