import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

const BMAN_BASE_URL = process.env.BMAN_BASE_URL; // es: https://cloud.bman.it
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
    service: "SyncFED – SOAP getAnagraficheV4"
  });
});

/* ===========================
   GET ANAGRAFICHE V4
   =========================== */
app.get("/test/getAnagraficheV4", async (req, res) => {
  try {
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getAnagraficheV4 xmlns="http://tempuri.org/">
      <chiave>${BMAN_API_KEY}</chiave>
      <filtri>[]</filtri>
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
        "SOAPAction": "http://tempuri.org/getAnagraficheV4"
      },
      body: soapBody
    });

    const text = await response.text();

    res.json({
      ok: true,
      lunghezzaRisposta: text.length,
      rispostaSOAP: text
    });

  } catch (err) {
    console.error("❌ Errore SOAP:", err.message);
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
