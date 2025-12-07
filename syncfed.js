// =====================
// 📌 SYNCFED - BMAN SYNC
// =====================

require('dotenv').config();
const axios = require("axios");
const xml2js = require("xml2js");
const db = require("./db");
const https = require("https");

// ===============
// 🔐 ENVIRONMENT
// ===============
const BMAN_DOMAIN = process.env.BMAN_DOMAIN; // es: emporiodeanna.bman.it
const BMAN_KEY = process.env.BMAN_KEY;       // chiave API Bman
const SERVER_TIMEOUT = parseInt(process.env.SERVER_TIMEOUT || "200000");

// =====================
// 🔌 HTTPS AGENT (NO SSL VALIDATION)
// =====================
const agent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: false,
});

// =======================================================
// 🧱 COSTRUZIONE DELLA RICHIESTA SOAP PER getAnagrafiche
// =======================================================
function soapGetPage(page) {
  const filterJson = `[{"chiave":"bmanShop","operatore":"=","valore":"true"}]`;

  return `
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
}

// =======================
// 🔄 CHIAMATA A BMAN SOAP
// =======================
async function getPage(page = 1) {
  const xmlReq = soapGetPage(page);

  const { data } = await axios.post(
    `https://${BMAN_DOMAIN}:3555/bmanapi.asmx`,
    xmlReq,
    {
      httpsAgent: agent,
      timeout: SERVER_TIMEOUT,
      headers: {
        "Content-Type": "text/xml;charset=UTF-8",
      },
      responseType: "text",
    }
  );

  // Parse XML to JSON
  return await xml2js.parseStringPromise(data, { explicitArray: false });
}

// ===========================
// 📥 SALVA NEL DATABASE MYSQL
// ===========================
async function saveProducts(arr) {
  for (const p of arr) {
    try {
      await db.query(
        `INSERT INTO prodotti
        (codice, marca, titolo, descrizione_it, descrizione_html, prezzo, iva, categoria1, categoria2, giacenza, img_link, data_sync)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE 
          marca=VALUES(marca),
          titolo=VALUES(titolo),
          descrizione_it=VALUES(descrizione_it),
          descrizione_html=VALUES(descrizione_html),
          prezzo=VALUES(prezzo),
          iva=VALUES(iva),
          categoria1=VALUES(categoria1),
          categoria2=VALUES(categoria2),
          giacenza=VALUES(giacenza),
          img_link=VALUES(img_link),
          data_sync=NOW()`,
        [
          p.codice,
          p.marca,
          p.titolo,
          p.descrizione_it,
          p.descrizione_html,
          p.prezzo,
          p.iva,
          p.cat1,
          p.cat2,
          p.giacenza,
          p.img,
        ]
      );
    } catch (err) {
      console.error("❌ Errore salvataggio:", err.message);
    }
  }
}

// ==================================
// 🧠 MAPPA I DATI BMAN → DB MySQL
// ==================================
function mapArticles(arr) {
  return arr.map(a => ({
    codice: a.codice,
    marca: a.opzionale1 || "",
    titolo: a.opzionale2 || "",
    descrizione_it: a.opzionale12 || a.opzionale2 || "",
    descrizione_html: `${a.opzionale12 || ""}${a.opzionale13 || ""}${a.opzionale14 || ""}${a.opzionale15 || ""}${a.opzionale16 || ""}`,
    prezzo: a.arrSconti?.[0]?.prezzo || 0,
    iva: a.iva || 22,
    cat1: a.categoria1str || "",
    cat2: a.categoria2str || "",
    giacenza: a.giacenza || 0,
    img: a.arrFoto?.[0] || "",
  }));
}

// ==========================
// ▶ MAIN SYNC FUNCTION
// ==========================
async function syncAll() {
  try {
    console.log("🔄 Avvio sincronizzazione da Bman...");

    let page = 1;
    let total = 0;

    while (true) {
      const json = await getPage(page);
      const items = JSON.parse(json["soap:Envelope"]["soap:Body"]["getAnagraficheResponse"]["getAnagraficheResult"]);

      if (!items || items.length === 0) break;

      const mapped = mapArticles(items);
      await saveProducts(mapped);

      total += items.length;
      console.log(`📦 Pagina ${page} sincronizzata (${items.length} articoli)`);
      page++;
    }

    console.log(`🎉 SYNC COMPLETATA: ${total} articoli.`);
    return { ok: true, articoli: total };
  } catch (err) {
    console.error("❌ ERRORE SYNC:", err);
    return { ok: false, errore: err.message };
  }
}

module.exports = { syncAll };


