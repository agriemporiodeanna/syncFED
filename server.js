import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

const { BMAN_BASE_URL, BMAN_API_KEY } = process.env;

if (!BMAN_BASE_URL || !BMAN_API_KEY) {
  console.error("❌ Variabili ambiente mancanti: BMAN_BASE_URL, BMAN_API_KEY");
}

/* ===========================
   ROOT
   =========================== */
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "SyncFED SOAP getAnagraficheV4"
  });
});

/* ===========================
   STEP 2 – GET ANAGRAFICHE V4
   =========================== */
app.get("/step2/import-bman", async (req, res) => {
  try {
    const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
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
        "SOAPAction": "http://tempuri.org/getAnagraficheV4"
      },
      body: soapEnvelope
    });

    const text = await response.text();

    if (text.includes("<soap:Fault>")) {
      return res.json({
        ok: false,
        error: "SOAP Fault restituito da Bman",
        rispostaSOAP: text
      });
    }

    res.json({
      ok: true,
      lunghezzaRisposta: text.length,
      rispostaSOAP: text
    });

  } catch (err) {
    console.error("❌ Errore SOAP:", err.message);
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
