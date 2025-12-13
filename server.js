import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

/* ===============================
   VARIABILI AMBIENTE OBBLIGATORIE
================================ */
const {
  BMAN_BASE_URL,     // es: https://dominio.bman.it:3555
  BMAN_API_KEY,      // chiave integrazione Bman
  BMAN_SCRIPT_FIELD  // es: opzionale11
} = process.env;

if (!BMAN_BASE_URL || !BMAN_API_KEY || !BMAN_SCRIPT_FIELD) {
  console.warn(
    "❌ Variabili ambiente mancanti:",
    { BMAN_BASE_URL, BMAN_API_KEY, BMAN_SCRIPT_FIELD }
  );
}

/* ===============================
   STEP 2 – IMPORT DA BMAN (SOAP PURO)
================================ */
app.get("/step2/import-bman", async (req, res) => {
  try {
    if (!BMAN_BASE_URL || !BMAN_API_KEY || !BMAN_SCRIPT_FIELD) {
      return res.json({
        ok: false,
        error: "Configurazione Bman incompleta"
      });
    }

    // JSON FILTRI MINIFICATO (obbligatorio)
    const filtriJson =
      `[{"chiave":"${BMAN_SCRIPT_FIELD}","operatore":"=","valore":"si"}]`;

    // SOAP ENVELOPE CLASSICO ASMX
    const soapBody =
`<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
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
          "SOAPAction": "http://tempuri.org/getAnagrafiche",
          "Content-Length": Buffer.byteLength(soapBody).toString()
        },
        body: soapBody
      }
    );

    const text = await response.text();

    // Se ASP.NET risponde HTML → SOAP non riconosciuto
    if (text.startsWith("<!DOCTYPE html>")) {
      throw new Error("Bman non ha riconosciuto la richiesta come SOAP");
    }

    // Qui siamo finalmente dentro la risposta SOAP
    res.json({
      ok: true,
      lunghezzaRisposta: text.length,
      anteprima: text.substring(0, 800)
    });

  } catch (err) {
    console.error("❌ SOAP Bman error:", err.message);
    res.json({
      ok: false,
      error: err.message
    });
  }
});

/* ===============================
   ROOT
================================ */
app.get("/", (req, res) => {
  res.send("✅ SyncFED – SOAP Bman attivo");
});

/* ===============================
   START
================================ */
app.listen(PORT, () => {
  console.log(`🚀 SyncFED avviato sulla porta ${PORT}`);
});
