import axios from "axios";
import { parseStringPromise } from "xml2js";
import { pool } from "./db.js";
import dotenv from "dotenv";

dotenv.config();

const BMAN_URL = "https://emporiodeanna.bman.it:3555/bmanapi.asmx";
const BMAN_KEY = process.env.BMAN_KEY || process.env.Bman_key;

/**
 * Costruisce la envelope SOAP per getAnagrafiche.
 * Usa il parametro <filtri> con JSON come richiesto da BMAN.
 * Filtra per bmanShop = true.
 */
function buildSoapEnvelope(page) {
  if (!BMAN_KEY) {
    throw new Error("BMAN_KEY non definita (manca ENV BMAN_KEY / Bman_key)");
  }

  const filtriJson = JSON.stringify([{
    chiave: "bmanShop",
    operatore: "=",
    valore: "true"
  }]);

  // Escape JSON per metterlo dentro XML
  const filtriXml = filtriJson
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

  return `
    <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                   xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                   xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body>
        <getAnagrafiche xmlns="http://cloud.bman.it/">
          <chiave>${BMAN_KEY}</chiave>
          <filtri>${filtriXml}</filtri>
          <ordinamentoCampo></ordinamentoCampo>
          <ordinamentoDirezione>0</ordinamentoDirezione>
          <nPagina>${page}</nPagina>
          <listaDepositi></listaDepositi>
          <dettaglioVarianti>false</dettaglioVarianti>
        </getAnagrafiche>
      </soap:Body>
    </soap:Envelope>
  `.trim();
}

/**
 * Chiama il WS BMAN e restituisce l'array di articoli + info paginazione.
 */
async function callBman(page = 1) {
  const xmlBody = buildSoapEnvelope(page);

  const response = await axios.post(BMAN_URL, xmlBody, {
    headers: {
      "Content-Type": "text/xml;charset=UTF-8"
    },
    timeout: 120000
  });

  const xml = response.data;
  const json = await parseStringPromise(xml, { explicitArray: false });

  const resultStr =
    json?.["soap:Envelope"]?.["soap:Body"]?.getAnagraficheResponse?.getAnagraficheResult;

  if (!resultStr) {
    throw new Error("Risposta BMAN senza getAnagraficheResult");
  }

  const result = JSON.parse(resultStr);

  const articoli = result.articoli || [];
  const paginaCorrente = result.paginaCorrente || page;
  const pagineTotali = result.pagineTotali || page;

  return { articoli, paginaCorrente, pagineTotali };
}

/**
 * Salva / aggiorna un singolo articolo in tabella prodotti.
 * Se ottimizzazione_approvata = 1, NON aggiorna l'articolo.
 */
async function salvaArticolo(a) {
  const idBman = a.id;
  if (!idBman) return;

  const codice = a.codice || "";
  const marca = a.brand || a.marca || "";
  const titolo = a.titolo || a.descrizione || "";
  const descrizione_it = a.descrizioneIT || a.descrizione_it || "";
  const descrizione_fr = a.descrizioneFR || "";
  const descrizione_es = a.descrizioneES || "";
  const descrizione_de = a.descrizioneDE || "";

  const descrizione_html =
    `<p><strong>IT</strong> ${descrizione_it}</p>` +
    (descrizione_fr ? `<p><strong>FR</strong> ${descrizione_fr}</p>` : "") +
    (descrizione_es ? `<p><strong>ES</strong> ${descrizione_es}</p>` : "") +
    (descrizione_de ? `<p><strong>DE</strong> ${descrizione_de}</p>` : "");

  const prezzo = a.prezzoNegozio || a.prezzo || 0;
  const iva = a.iva || 22;
  const tag = Array.isArray(a.tag) ? a.tag.join(",") : (a.tag || "");
  const categoria1 = a.categoria1 || "";
  const categoria2 = a.categoria2 || "";
  const giacenza = a.giacenza || 0;
  const img_link = a.img_link || a.immagine || "";

  const [rows] = await pool.query(
    "SELECT id, ottimizzazione_approvata FROM prodotti WHERE id_bman = ? LIMIT 1",
    [idBman]
  );

  if (rows.length && rows[0].ottimizzazione_approvata === 1) {
    console.log("⏭  Salto articolo ottimizzato:", idBman, codice);
    return;
  }

  if (rows.length) {
    await pool.query(
      `UPDATE prodotti
       SET codice = ?, marca = ?, titolo = ?, descrizione_it = ?, descrizione_html = ?,
           prezzo = ?, iva = ?, tag = ?, categoria1 = ?, categoria2 = ?,
           giacenza = ?, img_link = ?, data_sync = NOW()
       WHERE id_bman = ?`,
      [
        codice,
        marca,
        titolo,
        descrizione_it,
        descrizione_html,
        prezzo,
        iva,
        tag,
        categoria1,
        categoria2,
        giacenza,
        img_link,
        idBman
      ]
    );
  } else {
    await pool.query(
      `INSERT INTO prodotti
       (id_bman, codice, marca, titolo, descrizione_it, descrizione_html,
        prezzo, iva, tag, categoria1, categoria2, giacenza, img_link,
        img_local, data_sync, ottimizzazione_approvata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NOW(), 0)`,
      [
        idBman,
        codice,
        marca,
        titolo,
        descrizione_it,
        descrizione_html,
        prezzo,
        iva,
        tag,
        categoria1,
        categoria2,
        giacenza,
        img_link
      ]
    );
  }
}

/**
 * Sincronizza tutte le pagine da BMAN verso MySQL.
 */
export async function syncBman() {
  let page = 1;
  let imported = 0;

  console.log("📦 Avvio sincronizzazione BMAN...");
  while (true) {
    console.log(`📦 Sincronizzo pagina ${page}...`);
    const { articoli, paginaCorrente, pagineTotali } = await callBman(page);

    for (const a of articoli) {
      try {
        await salvaArticolo(a);
        imported++;
      } catch (err) {
        console.error("❌ Errore salvataggio articolo:", err?.message || err);
      }
    }

    if (paginaCorrente >= pagineTotali) break;
    page++;
  }

  console.log("✅ Sync completata. Articoli elaborati:", imported);
  return { imported };
}
