import axios from "axios";
import { parseStringPromise } from "xml2js";
import { pool } from "./db.js";
import dotenv from "dotenv";

dotenv.config();

const BMAN_URL = process.env.BMAN_URL;
const BMAN_KEY = process.env.BMAN_KEY;

function buildGetAnagraficheEnvelope(page) {
  const filtri = JSON.stringify([
    {
      chiave: "bmanShop",
      operatore: "=",
      valore: "True",
    },
  ]);

  const xml = `
    <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                   xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                   xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body>
        <getAnagrafiche xmlns="http://cloud.bman.it/">
          <chiave>${BMAN_KEY}</chiave>
          <filtri>${filtri}</filtri>
          <ordinamentoCampo>ID</ordinamentoCampo>
          <ordinamentoDirezione>1</ordinamentoDirezione>
          <numeroPagina>${page}</numeroPagina>
          <listaDepositi></listaDepositi>
          <dettaglioVarianti>false</dettaglioVarianti>
        </getAnagrafiche>
      </soap:Body>
    </soap:Envelope>
  `.trim();

  return xml;
}

async function callBmanPage(page) {
  const xml = buildGetAnagraficheEnvelope(page);

  const response = await axios.post(BMAN_URL, xml, {
    headers: { "Content-Type": "text/xml;charset=UTF-8" },
    timeout: 60000,
  });

  const parsed = await parseStringPromise(response.data, { explicitArray: false });
  const body = parsed["soap:Envelope"]?.["soap:Body"];
  const result = body?.getAnagraficheResponse?.getAnagraficheResult;

  if (!result) {
    console.log("⚠ Nessun result in SOAP per pagina", page);
    return [];
  }

  let articoli;
  try {
    articoli = JSON.parse(result);
  } catch (err) {
    console.error("❌ Errore parse JSON getAnagraficheResult pagina", page, err.message);
    return [];
  }

  if (!Array.isArray(articoli)) return [];
  return articoli;
}

function estraiPrezzoNegozio(arrSconti, fallback) {
  if (!Array.isArray(arrSconti) || arrSconti.length === 0) return fallback;
  // cerca etichetta/descrizione che contiene "Negozio"
  const negozio = arrSconti.find(
    (l) =>
      (l.Etichetta && l.Etichetta.toLowerCase().includes("negozio")) ||
      (l.NomeCompleto && l.NomeCompleto.toLowerCase().includes("negozio"))
  );
  if (negozio && typeof negozio.prezzo === "number") return negozio.prezzo;
  return typeof fallback === "number" ? fallback : null;
}

function buildCategorieString(art) {
  const cats = [];
  for (let i = 1; i <= 10; i++) {
    const key = `categoria${i}str`;
    if (art[key]) cats.push(art[key]);
  }
  return cats.join(" > ");
}

function buildDescrizioni(art) {
  const descrizione_it = art.opzionale12 || art.opzionale2 || "";
  const descrizione_fr = art.opzionale13 || "";
  const descrizione_es = art.opzionale15 || "";
  const descrizione_de = art.opzionale16 || "";

  const blocchi = [];
  if (descrizione_it) blocchi.push(`IT: ${descrizione_it}`);
  if (descrizione_fr) blocchi.push(`FR: ${descrizione_fr}`);
  if (descrizione_es) blocchi.push(`ES: ${descrizione_es}`);
  if (descrizione_de) blocchi.push(`DE: ${descrizione_de}`);

  const descrizione_html = blocchi.join("\n\n");

  return {
    descrizione_it,
    descrizione_fr,
    descrizione_es,
    descrizione_de,
    descrizione_html,
  };
}

async function articoloApprovato(codice) {
  const [rows] = await pool.query(
    "SELECT ottimizzazione_approvata FROM articoli_syncfed WHERE codice = ?",
    [codice]
  );
  if (!rows.length) return false;
  const val = rows[0].ottimizzazione_approvata;
  return val && String(val).toUpperCase() === "SI";
}

async function salvaArticolo(art) {
  const codice = art.codice;
  if (!codice) return;

  // se ottimizzazione approvata, non toccare il record
  if (await articoloApprovato(codice)) {
    console.log(`⏭ Skip ${codice} (ottimizzazione_approvata = SI)`);
    return;
  }

  const marca = art.opzionale1 || null;
  const titolo = art.opzionale2 || null;

  const {
    descrizione_it,
    descrizione_fr,
    descrizione_es,
    descrizione_de,
    descrizione_html,
  } = buildDescrizioni(art);

  const prezzo = estraiPrezzoNegozio(art.arrSconti, art.przc);
  const iva = art.iva ?? null;
  const tag = art.tags || "";
  const categorie = buildCategorieString(art);
  const giacenze = art.disponibilita ?? art.giacenza ?? 0;
  const foto_principale =
    (Array.isArray(art.arrFoto) && art.arrFoto.length > 0 && art.arrFoto[0]) || null;

  const sql = `
    INSERT INTO articoli_syncfed
    (
      codice,
      marca,
      titolo,
      descrizione_it,
      descrizione_fr,
      descrizione_es,
      descrizione_de,
      descrizione_html,
      prezzo,
      iva,
      tag,
      categorie,
      giacenze,
      foto_principale
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      marca = VALUES(marca),
      titolo = VALUES(titolo),
      descrizione_it = VALUES(descrizione_it),
      descrizione_fr = VALUES(descrizione_fr),
      descrizione_es = VALUES(descrizione_es),
      descrizione_de = VALUES(descrizione_de),
      descrizione_html = VALUES(descrizione_html),
      prezzo = VALUES(prezzo),
      iva = VALUES(iva),
      tag = VALUES(tag),
      categorie = VALUES(categorie),
      giacenze = VALUES(giacenze),
      foto_principale = VALUES(foto_principale)
  `;

  try {
    await pool.query(sql, [
      codice,
      marca,
      titolo,
      descrizione_it,
      descrizione_fr,
      descrizione_es,
      descrizione_de,
      descrizione_html,
      prezzo,
      iva,
      tag,
      categorie,
      giacenze,
      foto_principale,
    ]);
  } catch (err) {
    console.error("❌ Errore salvataggio articolo", codice, err.message);
  }
}

export async function syncBman() {
  console.log("🚀 Avvio sync Bman -> MySQL...");

  let page = 1;
  const maxPages = 200;
  let totale = 0;

  while (page <= maxPages) {
    console.log(`🔎 Leggo pagina ${page}...`);
    let articoli;
    try {
      articoli = await callBmanPage(page);
    } catch (err) {
      console.error("❌ Errore chiamata Bman pagina", page, err.message);
      break;
    }

    if (!articoli.length) {
      console.log("✅ Nessun articolo sulla pagina", page, "- fine.");
      break;
    }

    for (const art of articoli) {
      await salvaArticolo(art);
      totale++;
    }

    console.log(`📦 Pagina ${page} sincronizzata (${articoli.length} articoli)`);
    page++;
  }

  console.log(`🏁 Sync completata. Articoli processati: ${totale}`);
  return { totale };
}
