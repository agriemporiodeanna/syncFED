// syncfed.js
import axios from "axios";
import { parseStringPromise } from "xml2js";
import { upsertArticoliFromBman } from "./googleSheets.js";

const BMAN_URL =
  process.env.BMAN_URL || "https://emporiodeanna.bman.it:3555/bmanapi.asmx";
const BMAN_KEY = process.env.BMAN_KEY;

if (!BMAN_KEY) {
  console.warn("⚠️ BMAN_KEY non impostata nelle variabili di ambiente.");
}

async function callBman(page = 1) {
  if (!BMAN_KEY) {
    throw new Error("BMAN_KEY non impostata.");
  }

  // Bman si aspetta un parametro "filtri" in formato JSON (stringa)
  const filtriJson = JSON.stringify([
    {
      chiave: "bmanShop",
      operatore: "=",
      valore: "true",
    },
  ]);

  const soapEnvelope = `
    <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                   xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                   xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body>
        <getAnagrafiche xmlns="http://cloud.bman.it/">
          <chiave>${BMAN_KEY}</chiave>
          <filtri>${filtriJson}</filtri>
          <ordinamentoCampo>codice</ordinamentoCampo>
          <ordinamentoDirezione>1</ordinamentoDirezione>
          <nPagina>${page}</nPagina>
          <listaDepositi></listaDepositi>
          <dettaglioVarianti>false</dettaglioVarianti>
        </getAnagrafiche>
      </soap:Body>
    </soap:Envelope>
  `.trim();

  const response = await axios.post(BMAN_URL, soapEnvelope, {
    headers: {
      "Content-Type": "text/xml;charset=UTF-8",
    },
    timeout: 120000,
  });

  const xml = response.data;

  const parsed = await parseStringPromise(xml, {
    explicitArray: true,
    ignoreAttrs: true,
  });

  const envelope = parsed["soap:Envelope"] || parsed["SOAP-ENV:Envelope"];
  const body = envelope?.["soap:Body"]?.[0] || envelope?.["SOAP-ENV:Body"]?.[0];

  const responseNode =
    body?.getAnagraficheResponse?.[0] ||
    body?.["getAnagraficheResponse"]?.[0];

  const resultString =
    responseNode?.getAnagraficheResult?.[0] ||
    responseNode?.["getAnagraficheResult"]?.[0];

  if (!resultString) {
    console.error("❌ Risposta Bman inattesa:", JSON.stringify(parsed, null, 2));
    throw new Error("Struttura SOAP Bman inattesa (getAnagraficheResult mancante).");
  }

  let payload;
  try {
    payload = JSON.parse(resultString);
  } catch (err) {
    console.error("❌ Impossibile fare JSON.parse del risultato Bman:", err.message);
    throw new Error("Risultato Bman non è JSON valido.");
  }

  const totPagine =
    Number(payload.TotPagine || payload.totPagine || payload.tot_pagine || 1) ||
    1;

  const rawItems = payload.Articoli || payload.articoli || payload.items || [];

  const articoli = rawItems.map((a) => {
    const id =
      a.Id ||
      a.ID ||
      a.idArticolo ||
      a.id_articolo ||
      a.id ||
      a.Codice ||
      a.codice;

    return {
      id_bman: id ? String(id) : "",
      codice: a.Codice || a.codice || "",
      descrizione: a.Descrizione || a.descrizione || "",
      categoria1: a.Categoria1 || a.categoria1 || "",
      categoria2: a.Categoria2 || a.categoria2 || "",
      categoria3: a.Categoria3 || a.categoria3 || "",
      prezzo:
        a.Prezzo != null
          ? Number(a.Prezzo)
          : a.prezzo != null
          ? Number(a.prezzo)
          : null,
      giacenza:
        a.Giacenza != null
          ? Number(a.Giacenza)
          : a.giacenza != null
          ? Number(a.giacenza)
          : null,
      attivo: a.Attivo ?? a.attivo ?? "",
      url_immagine:
        a.UrlImmagine || a.urlImmagine || a.Immagine || a.immagine || "",
    };
  });

  return {
    totPagine,
    articoli,
  };
}

/**
 * Sincronizza TUTTE le pagine da Bman → Google Sheet.
 * - gestisce più pagine
 * - rispetta la colonna "ottimizzazione_approvata" (non sovrascrive i SI)
 */
export async function syncBman() {
  console.log("🔄 Avvio sync da Bman verso Google Sheet...");

  let pagina = 1;
  let totPagine = 1;
  let totaleArticoli = 0;

  let inseriti = 0;
  let aggiornati = 0;
  let ignorati = 0;

  while (pagina <= totPagine) {
    console.log(`📦 Scarico pagina ${pagina}...`);
    const { totPagine: tp, articoli } = await callBman(pagina);

    totPagine = tp;
    totaleArticoli += articoli.length;

    console.log(
      `➡️  Pagina ${pagina}/${totPagine} ricevuta, articoli: ${articoli.length}`
    );

    const result = await upsertArticoliFromBman(articoli);
    inseriti += result.inserted;
    aggiornati += result.updated;
    ignorati += result.skipped;

    pagina++;
  }

  console.log(
    `✅ Sync Bman completata. Articoli totali ricevuti=${totaleArticoli}, inseriti=${inseriti}, aggiornati=${aggiornati}, ignorati (già ottimizzati)=${ignorati}`
  );

  return {
    totaleArticoli,
    inseriti,
    aggiornati,
    ignorati,
    totPagine,
  };
}
