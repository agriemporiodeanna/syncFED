// syncfed.js
import axios from "axios";
import xml2js from "xml2js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { pool } from "./db.js";
import { uploadImage } from "./ftp.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== CONFIG AMBIENTE ======
const BMAN_URL = process.env.BMAN_URL || "https://emporiodeanna.bman.it:3555/bmanapi.asmx";
const BMAN_KEY = process.env.BMAN_KEY || "UC54Q19JJS4ZATDLEG0OFW07A884AV";

// cartella immagini locale (se vuoi salvarle)
const IMAGE_FOLDER = process.env.IMAGE_FOLDER || path.join(__dirname, "images");

// assicuro cartella immagini
if (!fs.existsSync(IMAGE_FOLDER)) {
  fs.mkdirSync(IMAGE_FOLDER, { recursive: true });
}

// =============== SOAP: GET ANAGRAFICHE DA BMAN ===============
async function getBmanPage(page) {
  // Filtro: prendi solo articoli per Bman Shop (puoi cambiare il filtro in futuro)
  const filtri = [
    {
      chiave: "bmanShop",
      operatore: "=",
      valore: "true",
    },
  ];

  const filterJson = JSON.stringify(filtri);

  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <getAnagrafiche xmlns="http://cloud.bman.it/">
        <chiave>${BMAN_KEY}</chiave>
        <filtri>${filterJson}</filtri>
        <pagina>${page}</pagina>
      </getAnagrafiche>
    </soap:Body>
  </soap:Envelope>`;

  console.log(`🔎 Richiedo pagina ${page} da Bman...`);

  const response = await axios.post(BMAN_URL, soapEnvelope, {
    headers: {
      "Content-Type": "text/xml;charset=UTF-8",
    },
    httpsAgent: new (await import("https")).Agent({
      rejectUnauthorized: false, // Bman usa certificato self-signed
    }),
  });

  const xml = response.data;

  const parsed = await xml2js.parseStringPromise(xml, {
    explicitArray: false,
    ignoreAttrs: false,
  });

  const body = parsed["soap:Envelope"]["soap:Body"];
  const resultRaw = body?.getAnagraficheResponse?.getAnagraficheResult;

  if (!resultRaw) {
    console.warn("⚠ Nessun getAnagraficheResult nella risposta SOAP.");
    return { articoli: [], total: 0 };
  }

  let articoli;
  try {
    articoli = JSON.parse(resultRaw);
  } catch (err) {
    console.error("❌ Errore parsing JSON da getAnagraficheResult:", err);
    throw err;
  }

  if (!Array.isArray(articoli)) {
    console.warn("⚠ Risultato non è un array, ritorno vuoto.");
    return { articoli: [], total: 0 };
  }

  return {
    articoli,
    total: articoli.length,
  };
}

// =============== MAPPATURA CAMPI DA BMAN → MySQL ===============
function mapBmanToProdotto(a) {
  // Marca
  const marca = a.opzionale1 || "";

  // Titolo (italiano corto)
  const titolo = (a.opzionale2 || "").trim().slice(0, 255);

  // Descrizione IT
  // opzionale2 di solito è la descrizione principale IT
  // opzionale12 a volte contiene dettaglio IT
  const descrizioneItParts = [];
  if (a.opzionale2) descrizioneItParts.push(a.opzionale2);
  if (a.opzionale12) descrizioneItParts.push(a.opzionale12);
  const descrizione_it = descrizioneItParts.join(" ").trim();

  // FR / ES / DE dalle opzionali
  const descrizione_fr = (a.opzionale13 || "").trim();
  const descrizione_es = (a.opzionale15 || "").trim();
  const descrizione_de = (a.opzionale16 || "").trim();

  // descrizione_html = IT + FR + ES + DE in HTML (solo blocchi, niente <html> o <body>)
  let descrizione_html = "";
  if (descrizione_it) {
    descrizione_html += `<p><strong>IT:</strong> ${descrizione_it}</p>\n`;
  }
  if (descrizione_fr) {
    descrizione_html += `<p><strong>FR:</strong> ${descrizione_fr}</p>\n`;
  }
  if (descrizione_es) {
    descrizione_html += `<p><strong>ES:</strong> ${descrizione_es}</p>\n`;
  }
  if (descrizione_de) {
    descrizione_html += `<p><strong>DE:</strong> ${descrizione_de}</p>\n`;
  }

  // Prezzo: usa listino "Negozio" se presente, altrimenti il primo
  let prezzo = 0;
  if (Array.isArray(a.arrSconti) && a.arrSconti.length > 0) {
    const negozio = a.arrSconti.find(
      (s) =>
        s.NomeCompleto?.toLowerCase().includes("negozio") ||
        s.Etichetta?.toLowerCase().includes("negozio")
    );
    const scelto = negozio || a.arrSconti[0];
    prezzo = Number(scelto.prezzo || 0);
  }

  // IVA
  const iva = Number(a.iva || 22);

  // Tags (stringa già pronta da Bman)
  const tags = a.tags || "";

  // Categorie (combinate)
  const categorieParts = [];
  if (a.categoria1str) categorieParts.push(a.categoria1str);
  if (a.categoria2str) categorieParts.push(a.categoria2str);
  if (a.categoria3str) categorieParts.push(a.categoria3str);
  const categorie = categorieParts.filter(Boolean).join(" > ");

  // Giacenza
  const giacenza = Number(a.giacenza || 0);

  // Foto principale (solo link, il download/FTP è gestibile a parte se vorrai)
  let foto = "";
  if (Array.isArray(a.arrFoto) && a.arrFoto.length > 0) {
    foto = a.arrFoto[0];
  }

  return {
    codice: a.codice,
    marca,
    titolo,
    descrizione_it,
    descrizione_html,
    prezzo,
    iva,
    categorie,
    tags,
    giacenza,
    foto,
  };
}

// =============== SALVATAGGIO SU MYSQL, CON SALTO SE APPROVATO ===============
async function saveOrUpdateProdotto(p) {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      "SELECT id, ottimizzazione_approvata FROM prodotti WHERE codice = ?",
      [p.codice]
    );

    if (rows.length === 0) {
      // 🔹 Inserimento nuovo
      const [result] = await conn.query(
        `INSERT INTO prodotti 
         (codice, marca, titolo, descrizione_it, descrizione_html, prezzo, iva, categorie, tags, giacenza, foto, ottimizzazione_approvata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'no')`,
        [
          p.codice,
          p.marca,
          p.titolo,
          p.descrizione_it,
          p.descrizione_html,
          p.prezzo,
          p.iva,
          p.categorie,
          p.tags,
          p.giacenza,
          p.foto,
        ]
      );
      console.log(`➕ Inserito nuovo articolo ${p.codice} (id=${result.insertId})`);
      return { action: "insert", id: result.insertId };
    } else {
      const row = rows[0];

      if (row.ottimizzazione_approvata === "si") {
        // 🔒 NON aggiornare un articolo che hai già ottimizzato e approvato
        console.log(
          `🔒 Skip articolo ${p.codice}: ottimizzazione_approvata = 'si' (non aggiornato)`
        );
        return { action: "skipped_approvato", id: row.id };
      }

      // 🔄 Aggiornamento normale
      await conn.query(
        `UPDATE prodotti
         SET 
           marca = ?,
           titolo = ?,
           descrizione_it = ?,
           descrizione_html = ?,
           prezzo = ?,
           iva = ?,
           categorie = ?,
           tags = ?,
           giacenza = ?,
           foto = ?
         WHERE id = ?`,
        [
          p.marca,
          p.titolo,
          p.descrizione_it,
          p.descrizione_html,
          p.prezzo,
          p.iva,
          p.categorie,
          p.tags,
          p.giacenza,
          p.foto,
          row.id,
        ]
      );
      console.log(`♻ Aggiornato articolo ${p.codice} (id=${row.id})`);
      return { action: "update", id: row.id };
    }
  } catch (err) {
    console.error(`❌ Errore salvataggio articolo ${p.codice}:`, err);
    throw err;
  } finally {
    conn.release();
  }
}

// =============== FUNZIONE PRINCIPALE DI SYNC ===============
export async function syncBman() {
  let page = 1;
  let totali = {
    letti: 0,
    inseriti: 0,
    aggiornati: 0,
    saltati_approvati: 0,
  };

  while (true) {
    const { articoli, total } = await getBmanPage(page);

    if (!articoli || articoli.length === 0) {
      console.log(`✅ Nessun articolo nella pagina ${page}, fine sync.`);
      break;
    }

    console.log(`📦 Pagina ${page}: ${articoli.length} articoli ricevuti.`);

    for (const a of articoli) {
      totali.letti++;
      const prodotto = mapBmanToProdotto(a);

      try {
        const res = await saveOrUpdateProdotto(prodotto);
        if (res.action === "insert") totali.inseriti++;
        if (res.action === "update") totali.aggiornati++;
        if (res.action === "skipped_approvato") totali.saltati_approvati++;
      } catch (err) {
        console.error("❌ Errore durante saveOrUpdateProdotto:", err);
      }
    }

    if (total === 0 || articoli.length === 0) {
      break;
    }

    page++;
  }

  console.log("🔚 Sync Bman → MySQL terminata. Totali:", totali);
  return totali;
}

