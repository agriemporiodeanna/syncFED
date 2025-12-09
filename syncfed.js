import axios from "axios";
import xml2js from "xml2js";
import https from "https";
import { pool } from "./db.js";

const BMAN_ENDPOINT =
  process.env.BMAN_ENDPOINT ||
  "https://emporiodeanna.bman.it:3555/bmanapi.asmx";
const BMAN_KEY = process.env.BMAN_KEY;

const parser = new xml2js.Parser({ explicitArray: false });

async function callBman(page) {
  const soapBody = `
    <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                   xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                   xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body>
        <getAnagrafiche xmlns="http://cloud.bman.it/">
          <chiave>${BMAN_KEY}</chiave>
          <filtro>
            <chiave>bmanShop</chiave>
            <operatore>=</operatore>
            <valore>true</valore>
          </filtro>
          <pagina>${page}</pagina>
        </getAnagrafiche>
      </soap:Body>
    </soap:Envelope>`;

  const { data } = await axios.post(BMAN_ENDPOINT, soapBody, {
    headers: { "Content-Type": "text/xml;charset=UTF-8" },
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    timeout: 120000,
  });

  const js = await parser.parseStringPromise(data);
  const result =
    js["soap:Envelope"]["soap:Body"]["getAnagraficheResponse"][
      "getAnagraficheResult"
    ];

  if (!result) return [];

  const items = JSON.parse(result);
  return items;
}

function mapArticle(item) {
  const idAnagrafica = item.ID;
  const codice = item.codice;
  const marca = item.opzionale1 || "";
  const titolo = item.opzionale2 || item.descrizione || "";

  const descr_it = item.opzionale2 || "";
  const descr_fr = item.opzionale13 || "";
  const descr_es = item.opzionale15 || "";
  const descr_de = item.opzionale16 || "";

  const descr_html_parts = [];
  if (descr_it) descr_html_parts.push(`<p>${descr_it}</p>`);
  if (descr_fr) descr_html_parts.push(`<p><strong>FR:</strong> ${descr_fr}</p>`);
  if (descr_es) descr_html_parts.push(`<p><strong>ES:</strong> ${descr_es}</p>`);
  if (descr_de) descr_html_parts.push(`<p><strong>DE:</strong> ${descr_de}</p>`);
  const descrizione_html = descr_html_parts.join("");

  const listinoNegozio = (item.arrSconti || []).find(
    (s) => s.Etichetta === "Viridex/Negozio" || s.IDListino === 9
  );
  const prezzo = listinoNegozio ? Number(listinoNegozio.prezzo) : null;
  const iva = item.iva ?? null;

  const tags = item.tags || "";
  const categorie = [
    item.categoria1str,
    item.categoria2str,
    item.categoria3str,
    item.categoria4str,
    item.categoria5str,
  ]
    .filter(Boolean)
    .join(" > ");

  const giacenze = item.giacenza ?? 0;
  const foto = (item.arrFoto && item.arrFoto[0]) || "";

  return {
    idAnagrafica,
    codice,
    marca,
    titolo,
    descr_it,
    descr_fr,
    descr_es,
    descr_de,
    descrizione_html,
    prezzo,
    iva,
    tags,
    categorie,
    giacenze,
    foto,
  };
}

export async function syncBman() {
  if (!BMAN_KEY) {
    throw new Error("BMAN_KEY non impostata nell'env");
  }

  let page = 1;
  let total = 0;
  let done = false;

  while (!done) {
    console.log(`📦 Sincronizzo pagina ${page}...`);
    const items = await callBman(page);

    if (!items || items.length === 0) {
      done = true;
      break;
    }

    for (const item of items) {
      const mapped = mapArticle(item);

      const [existingRows] = await pool.query(
        "SELECT id, ottimizzazione_approvata FROM articoli_bman WHERE id_anagrafica = ?",
        [mapped.idAnagrafica]
      );
      const existing = existingRows[0];

      if (existing && existing.ottimizzazione_approvata === "SI") {
        continue;
      }

      if (existing) {
        await pool.query(
          `UPDATE articoli_bman
           SET codice = ?, marca = ?, titolo = ?, descrizione_it = ?,
               descrizione_fr = ?, descrizione_es = ?, descrizione_de = ?,
               descrizione_html = ?, prezzo = ?, iva = ?, tags = ?,
               categorie = ?, giacenze = ?, foto = ?
           WHERE id_anagrafica = ?`,
          [
            mapped.codice,
            mapped.marca,
            mapped.titolo,
            mapped.descr_it,
            mapped.descr_fr,
            mapped.descr_es,
            mapped.descr_de,
            mapped.descrizione_html,
            mapped.prezzo,
            mapped.iva,
            mapped.tags,
            mapped.categorie,
            mapped.giacenze,
            mapped.foto,
            mapped.idAnagrafica,
          ]
        );
      } else {
        await pool.query(
          `INSERT INTO articoli_bman
           (id_anagrafica, codice, marca, titolo,
            descrizione_it, descrizione_fr, descrizione_es, descrizione_de,
            descrizione_html, prezzo, iva, tags, categorie, giacenze, foto)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            mapped.idAnagrafica,
            mapped.codice,
            mapped.marca,
            mapped.titolo,
            mapped.descr_it,
            mapped.descr_fr,
            mapped.descr_es,
            mapped.descr_de,
            mapped.descrizione_html,
            mapped.prezzo,
            mapped.iva,
            mapped.tags,
            mapped.categorie,
            mapped.giacenze,
            mapped.foto,
          ]
        );
      }

      total++;
    }

    page++;
  }

  console.log(`✅ Sync completata. Articoli elaborati: ${total}`);
  return { ok: true, elaborati: total };
}
