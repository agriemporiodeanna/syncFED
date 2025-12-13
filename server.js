import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

/* ===============================
   VARIABILI AMBIENTE
================================ */
const {
  BMAN_BASE_URL,      // es: https://dominio.bman.it:3555
  BMAN_API_KEY,       // chiave integrazione
  BMAN_SCRIPT_FIELD   // es: opzionale11
} = process.env;

if (!BMAN_BASE_URL || !BMAN_API_KEY || !BMAN_SCRIPT_FIELD) {
  console.warn("❌ Variabili ambiente mancanti", {
    BMAN_BASE_URL,
    BMAN_API_KEY,
    BMAN_SCRIPT_FIELD
  });
}

/* ===============================
   STEP 2 – IMPORT BMAN (SOAP ASMX PURO)
================================ */
app.get("/step2/import-bman", async (req, res) => {
  try {
    if (!BMAN_BASE_URL || !BMAN_API_KEY || !BMAN_SCRIPT_FIELD) {
      return res.json({ ok: false, error: "Configurazione Bman incompleta" });
    }

    // JSON MINIFICATO (obbligatorio)
    const filtriJson =
      `[{"chiave":"${BMAN_SCRIPT_FIELD}","operatore":"=","valore":"si"}]`;

    // SOAP ENVELOPE ASMX STANDARD
    const soapBody =
`<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <getAnagrafiche xmlns="http://tempuri.org/">
      <chiave>${BMAN_API_KEY}</chiave>
      <filtri><![CDATA[${filtriJson}]]></filtri>
      <ordinamentoCampo>ID</ordinamentoCampo>
      <ordinamentoDirezione>1</ordinamentoDirezione>
      <numeroPagina>1</numeroPagina>
      <listaDepositi><![CDATA[]]></listaDepositi>
      <dettaglioVarianti>false</dettaglioVarianti>
    </getAnagrafiche>
  </soap:Body>
</soap:Envelope>`;

    const response = await fetch(
      `${BMAN_BASE_URL}/bmanapi.asmx`,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "SOAPAction": "\"http://tempuri.org/getAnagrafiche\""
        },
        body: soapBody
      }
    );

    const text = await response.text();

    // Se torna HTML → SOAP non riconosciuto
    if (text.startsWith("<!DOCTYPE html>")) {
      throw new Error("Bman ha risposto HTML: richiesta non SOAP");
    }

    // SUCCESSO: risposta SOAP XML
    res.json({
      ok: true,
      lunghezzaRisposta: text.length,
      anteprima: text.substring(0, 900)
    });

  } catch (err) {
    console.error("❌ SOAP Bman error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

/* ===============================
   ROOT
================================ */
app.get("/", (req, res) => {
  res.send("✅ SyncFED – SOAP ASMX Bman attivo");
});

/* ===============================
   START
================================ */
app.listen(PORT, () => {
  console.log(`🚀 SyncFED avviato sulla porta ${PORT}`);
});
