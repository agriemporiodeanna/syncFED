import express from 'express';
import fetch from 'node-fetch';
import bodyParser from 'body-parser';
import xml2js from 'xml2js';

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;

/* =========================================================
   CONFIGURAZIONE BMAN
   ========================================================= */

const BMAN_ENDPOINT = 'https://emporiodeanna.bman.it/bmanapi.asmx';
const BMAN_CHIAVE = process.env.BMAN_API_KEY; // obbligatoria

if (!BMAN_CHIAVE) {
  console.error('❌ Variabile ambiente mancante: BMAN_API_KEY');
}

/* =========================================================
   NORMALIZZAZIONE DEFINITIVA
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
   SOAP getAnagraficheV4 (RAW, SENZA FILTRI)
   ========================================================= */

async function getAnagraficheV4Raw() {
  const soapBody = `
<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getAnagraficheV4 xmlns="http://cloud.bman.it/">
      <chiave>${BMAN_CHIAVE}</chiave>
      <filtri></filtri>
      <ordinamentoCampo>ID</ordinamentoCampo>
      <ordinamentoDirezione>1</ordinamentoDirezione>
      <numeroPagina>1</numeroPagina>
      <listaDepositi></listaDepositi>
      <dettaglioVarianti>false</dettaglioVarianti>
    </getAnagraficheV4>
  </soap:Body>
</soap:Envelope>`.trim();

  const response = await fetch(BMAN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'http://cloud.bman.it/getAnagraficheV4'
    },
    body: soapBody
  });

  const xml = await response.text();

  const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
  const result =
    parsed?.['soap:Envelope']?.['soap:Body']?.['getAnagraficheV4Response']?.['getAnagraficheV4Result'];

  return JSON.parse(result || '[]');
}

/* =========================================================
   API STEP 2 – SOLO Script = SI
   ========================================================= */

app.get('/api/step2/script-si', async (req, res) => {
  try {
    const articoli = await getAnagraficheV4Raw();

    const filtrati = articoli.filter(a => {
      const script = normalizeValue(a.opzionale11);
      return script === 'si';
    });

    console.log(`📦 Articoli totali: ${articoli.length}`);
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
   HEALTH CHECK
   ========================================================= */

app.get('/', (req, res) => {
  res.send('🚀 SyncFED attivo – SOAP Bman OK – Normalizzazione ON');
});

/* =========================================================
   START SERVER
   ========================================================= */

app.listen(PORT, () => {
  console.log(`🚀 SyncFED avviato sulla porta ${PORT}`);
});
