import axios from "axios";
import { parseStringPromise } from "xml2js";
import { pool } from "./db.js";
import dotenv from "dotenv";
dotenv.config();

const bmanURL = `https://${process.env.BMAN_DOMAIN}:3555/bmanapi.asmx`;
const https = require("https");
const agent = new https.Agent({ rejectUnauthorized: false });

// 🧠 Estrai solo la descrizione IT
function estraiDescIT(html) {
  if (!html) return "";
  let text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+(>|$)/g, "") // rimuove tutti gli HTML
    .trim();

  // Taglia a IT cancellando FR ES DE
  const patterns = ["FR:", "ES:", "DE:"];
  patterns.forEach(lang => {
    const idx = text.indexOf(lang);
    if (idx !== -1) text = text.substring(0, idx).trim();
  });

  return text;
}

// 🌍 Costruisci multilingua testo puro
function estraiMultilingua(html) {
  if (!html) return "";

  let text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+(>|$)/g, "")
    .trim();

  let out = [];

  const langMap = {
    "IT:": "IT:",
    "FR:": "FR:",
    "ES:": "ES:",
    "DE:": "DE:"
  };

  Object.keys(langMap).forEach(lang => {
    let idx = text.indexOf(lang);
    if (idx !== -1) {
      let sub = text.substring(idx);
      let nextIdx = Object.keys(langMap)
        .map(k => text.indexOf(k))
        .filter(i => i > idx)
        .sort((a, b) => a - b)[0];

      sub = nextIdx ? text.substring(idx, nextIdx) : text.substring(idx);
      out.push(sub.trim());
    }
  });

  return out.join("\n\n");
}

// 💵 Trova prezzo negozio
function trovaPrezzoNegozio(arrSconti) {
  if (!arrSconti) return null;
  for (const s of arrSconti) {
    if (
      s.Etichetta?.toLowerCase().includes("negozio") ||
      s.NomeCompleto?.toLowerCase().includes("negozio")
    ) {
      return Number(s.prezzo).toFixed(2);
    }
  }
  // fallback
  return arrSconti[0]?.prezzo ? Number(arrSconti[0].prezzo).toFixed(2) : null;
}

// 📦 Chiamata SOAP → Bman getAnagrafiche
async function scaricaArticoliBman(pagina = 1) {
  const soapEnvelope = `
  <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                 xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <getAnagrafiche xmlns="http://cloud.bman.it/">
        <chiave>${process.env.BMAN_KEY}</chiave>
        <filtro>
          <chiave>bmanShop</chiave>
          <operatore>=</operatore>
          <valore>true</valore>
        </filtro>
        <pagina>${pagina}</pagina>
      </getAnagrafiche>
    </soap:Body>
  </soap:Envelope>`;

  const response = await axios.post(
    bmanURL,
    soapEnvelope,
    {
      httpsAgent: agent,
      headers: { "Content-Type": "text/xml;charset=UTF-8" }
    }
  );

  const xml = await parseStringPromise(response.data, { explicitArray: false });
  let result = xml["soap:Envelope"]["soap:Body"]["getAnagraficheResponse"]["getAnagraficheResult"];

  try {
    return JSON.parse(result);
  } catch (e) {
    return [];
  }
}

// 💾 Salvataggio nel DB
async function salvaProdottoDB(prod) {
  const [r] = await pool.query(
    `INSERT INTO prodotti
     (id_bman, codice, marca, titolo, descrizione_it, descrizione_html, prezzo, iva, tag, categoria1, categoria2, giacenza, img_link, img_local)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
     marca = VALUES(marca),
     titolo = VALUES(titolo),
     descrizione_it = VALUES(descrizione_it),
     descrizione_html = VALUES(descrizione_html),
     prezzo = VALUES(prezzo),
     iva = VALUES(iva),
     tag = VALUES(tag),
     categoria1 = VALUES(categoria1),
     categoria2 = VALUES(categoria2),
     giacenza = VALUES(giacenza),
     img_link = VALUES(img_link),
     img_local = VALUES(img_local),
     data_sync = CURRENT_TIMESTAMP;`,
    [
      prod.ID,
      prod.codice,
      prod.opzionale1 || "",
      prod.opzionale2 || "",
      estraiDescIT(prod.descrizioneHtml),
      estraiMultilingua(prod.descrizioneHtml),
      trovaPrezzoNegozio(prod.arrSconti),
      prod.iva || 22,
      prod.tags || "",
      prod.categoria1str || "",
      prod.categoria2str || "",
      prod.disponibilita || 0,
      prod.arrFoto?.[0] || "",
      null // img_local riempito poi dal modulo immagini
    ]
  );
  return r;
}

// 🚀 Funzione principale sync
export async function syncBman() {
  console.log("🔁 Avvio sincronizzazione Bman...");

  let pagina = 1;
  let totaleScaricati = 0;

  while (true) {
    const articoli = await scaricaArticoliBman(pagina);
    if (!articoli || articoli.length === 0) break;

    for (const a of articoli) {
      await salvaProdottoDB(a);
      totaleScaricati++;
    }

    pagina++;
  }

  console.log(`🎉 Completato! Articoli sincronizzati: ${totaleScaricati}`);
  return totaleScaricati;
}
