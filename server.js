// server.js
import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

/* ===========================
   VARIABILI AMBIENTE OBBLIGATORIE
   =========================== */
const {
  BMAN_BASE_URL,     // es: https://cloud.bman.it:3555
  BMAN_API_KEY       // chiave integrazione Bman
} = process.env;

if (!BMAN_BASE_URL || !BMAN_API_KEY) {
  console.error("❌ Variabili ambiente mancanti: BMAN_BASE_URL, BMAN_API_KEY");
}

/* ===========================
   ROUTE ROOT (TEST)
   =========================== */
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "SyncFED SOAP getAnagraficheV4"
  });
});

/* ===========================
   STEP 2 - IMPORT BMAN
   =========================== */
app.get("/step2/import-bman", async (req, res) => {
  try {
    const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getAnagraficheV4 xmlns="https://cloud.bman.it/">
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
        "SOAPAction": "\"https://cloud.bman.it/getAnagraficheV4\""
      },
      body: soapEnvelope
    });

    const text = await response.text();

    // Bman ha risposto HTML → non SOAP
    if (text.trim().startsWith("<!DOCTYPE html")) {
      return res.json({
        ok: false,
        error: "Bman ha risposto HTML: richiesta non SOAP",
        anteprima: text.substring(0, 500)
      });
    }

    // SOAP Fault
    if (text.includes("<soap:Fault>")) {
      return res.json({
        ok: false,
        error: "SOAP Fault restituito da Bman",
        rispostaSOAP: text
      });
    }

    // OK
    res.json({
      ok: true,
      lunghezzaRisposta: text.length,
      rispostaSOAP: text
    });

  } catch (err) {
    console.error("❌ Errore SOAP Bman:", err.message);
    res.json({
      ok: false,
      error: err.message
    });
  }
});

/* ===========================
   AVVIO SERVER
   =========================== */
app.listen(PORT, () => {
  console.log(`🚀 SyncFED avviato sulla porta ${PORT}`);
});
