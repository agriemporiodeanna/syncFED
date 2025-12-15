import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

const BMAN_BASE_URL = process.env.BMAN_BASE_URL; 
// es: https://emporiodeanna.bman.it:3555
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
    service: "SyncFED – getNomeCampoOpzionale",
    info: "Usa /debug/opzionali per vedere i nomi dei campi"
  });
});

/* ===========================
   DEBUG – NOMI CAMPI OPZIONALI
   =========================== */
app.get("/debug/opzionali", async (req, res) => {
  try {
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">

  <soap:Body>
    <getNomeCampoOpzionale xmlns="http://cloud.bman.it/">
      <chiave>${BMAN_API_KEY}</chiave>
      <indiceCampo>0</indiceCampo>
      <tipoArticoli>0</tipoArticoli>
    </getNomeCampoOpzionale>
  </soap:Body>

</soap:Envelope>`;

    const response = await fetch(`${BMAN_BASE_URL}/bmanapi.asmx`, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "Accept": "text/xml",
        "SOAPAction": "http://cloud.bman.it/getNomeCampoOpzionale"
      },
      body: soapBody
    });

    const text = await response.text();

    res.json({
      ok: true,
      descrizione: "Elenco campi opzionali in ordine (opzionale1 → opzionale25)",
      rispostaSOAP: text
    });

  } catch (err) {
    console.error("❌ Errore SOAP getNomeCampoOpzionale:", err.message);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

/* ===========================
   START SERVER
   =========================== */
app.listen(PORT, () => {
  console.log(`🚀 SyncFED (debug opzionali) avviato sulla porta ${PORT}`);
});
