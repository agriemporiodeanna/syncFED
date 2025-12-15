import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

const BMAN_BASE_URL = process.env.BMAN_BASE_URL; 
// https://emporiodeanna.bman.it:3555
const BMAN_API_KEY = process.env.BMAN_API_KEY;

if (!BMAN_BASE_URL || !BMAN_API_KEY) {
  console.error("❌ Variabili ambiente mancanti: BMAN_BASE_URL, BMAN_API_KEY");
}

/* ===========================
   ROOT
   =========================== */
app.get("/", (req, res) => {
  res.json({
    ok: true,
    step: "STEP 2 – filtro Script = DA ELABORARE",
    service: "SyncFED – getAnagraficheV4"
  });
});

/* ===========================
   STEP 2 – IMPORT BMAN
   =========================== */
app.get("/step2/import-bman", async (req, res) => {
  try {
    const filtriScriptSI = `
[
  {
    "chiave": "opzionale11",
    "operatore": "=",
    "valore": "SI"
  }
]
    `.trim();

    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getAnagraficheV4 xmlns="http://cloud.bman.it/">
      <chiave>${BMAN_API_KEY}</chiave>
      <filtri>${filtriScriptSI}</filtri>
      <ordinamentoCampo>ID</ordinamentoCampo>
      <ordinamentoDirezione>1</ordinamentoDirezione>
      <pagina>1</pagina>
      <listaDepositi>[]</listaDepositi>
      <dettaglioVarianti>false</dettaglioVarianti>
    </getAnagraficheV4>
  </soap:Body>
</soap:Envelope>`;

    const response = await fetch(`${BMAN_BASE_URL}/bmanapi.asmx`, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "Accept": "text/xml",
        "SOAPAction": "http://cloud.bman.it/getAnagraficheV4"
      },
      body: soapBody
    });

    const text = await response.text();

    res.json({
      ok: true,
      step: "STEP 2 – Script = SI",
      lunghezzaRisposta: text.length,
      rispostaSOAP: text
    });

  } catch (err) {
    console.error("❌ Errore SOAP STEP 2:", err.message);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

/* ===========================
   START
   =========================== */
app.listen(PORT, () => {
  console.log(`🚀 SyncFED avviato sulla porta ${PORT}`);
});
