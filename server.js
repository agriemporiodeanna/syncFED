import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

/* ===============================
   CONFIGURAZIONE AMBIENTE
================================ */

const PORT = process.env.PORT || 10000;

const BMAN_BASE_URL = process.env.BMAN_BASE_URL; 
// es: https://tuodominio.bman.it:3555/bmanapi.asmx

const BMAN_API_KEY = process.env.BMAN_API_KEY;
// chiave presa da Utilità → Impostazioni → Integrazione

if (!BMAN_BASE_URL || !BMAN_API_KEY) {
  console.error("❌ Variabili ambiente mancanti: BMAN_BASE_URL, BMAN_API_KEY");
}

/* ===============================
   ROUTE DI TEST
================================ */

app.get("/", (req, res) => {
  res.json({ ok: true, service: "SyncFED SOAP getAnagraficheV4" });
});

/* ===============================
   SOAP getAnagraficheV4
================================ */

app.get("/step2/import-bman", async (req, res) => {
  try {
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">

  <soap:Body>
    <getAnagraficheV4 xmlns="http://tempuri.org/">
      <chiave>${BMAN_API_KEY}</chiave>
      <filtri>[]</filtri>
      <ordinamentoCampo>ID</ordinamentoCampo>
      <ordinamentoDirezione>1</ordinamentoDirezione>
      <pagina>1</pagina>
      <listaDepositi></listaDepositi>
      <dettaglioVarianti>false</dettaglioVarianti>
    </getAnagraficheV4>
  </soap:Body>
</soap:Envelope>`;

    const response = await fetch(BMAN_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": "http://tempuri.org/getAnagraficheV4",
      },
      body: soapBody,
    });

    const text = await response.text();

    // Se Bman risponde HTML → non è SOAP valido
    if (text.trim().startsWith("<!DOCTYPE html")) {
      return res.status(500).json({
        ok: false,
        error: "Bman ha risposto HTML: richiesta non SOAP",
        preview: text.substring(0, 500),
      });
    }

    // SOAP OK
    res.json({
      ok: true,
      lunghezzaRisposta: text.length,
      rispostaSOAP: text,
    });

  } catch (err) {
    console.error("❌ Errore SOAP Bman:", err.message);
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

/* ===============================
   AVVIO SERVER
================================ */

app.listen(PORT, () => {
  console.log(`🚀 SyncFED SOAP getAnagraficheV4 avviato sulla porta ${PORT}`);
});

