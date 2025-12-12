import axios from "axios";
import xml2js from "xml2js";
import dotenv from "dotenv";
import { upsertArticoloFromSync } from "./googleSheets.js";

dotenv.config();

const BMAN_URL = process.env.BMAN_URL;
const BMAN_KEY = process.env.BMAN_KEY;

if (!BMAN_URL || !BMAN_KEY) {
  console.warn("⚠️ BMAN_URL o BMAN_KEY non sono impostate nelle variabili ambiente.");
}

const parser = new xml2js.Parser({ explicitArray: false });

async function callBman(pagina = 1) {
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
          <pagina>${pagina}</pagina>
        </getAnagrafiche>
      </soap:Body>
    </soap:Envelope>
  `;

  const response = await axios.post(BMAN_URL, soapBody, {
    headers: {
      "Content-Type": "text/xml;charset=UTF-8",
    },
    timeout: 120000,
  });

  return response.data;
}

async function parseBmanResponse(xml) {
  const result = await parser.parseStringPromise(xml);

  const body = result["soap:Envelope"]?.["soap:Body"];
  if (body?.["soap:Fault"]) {
    const fault = body["soap:Fault"];
    const message = fault.faultstring || "Errore SOAP non specificato";
    throw new Error(`Bman SOAP fault: ${message}`);
  }

  const getAnagraficheResponse =
    body?.getAnagraficheResponse || body?.GetAnagraficheResponse;

  if (!getAnagraficheResponse) {
    throw new Error("Risposta Bman inattesa: manca getAnagraficheResponse");
  }

  const getAnagraficheResult =
    getAnagraficheResponse.getAnagraficheResult ||
    getAnagraficheResponse.GetAnagraficheResult;

  if (!getAnagraficheResult) {
    throw new Error("Risposta Bman inattesa: manca getAnagraficheResult");
  }

  // Il risultato Bman è JSON serializzato in una stringa
  const jsonString = getAnagraficheResult;
  const decoded = JSON.parse(jsonString);

  if (!decoded || !Array.isArray(decoded.anagrafiche)) {
    throw new Error("Struttura anagrafiche non valida nella risposta Bman");
  }

  return decoded;
}

function buildDescrizioni(art) {
  const descrizione_it = (art.descrizione || "").toString().trim();
  return {
    descrizione_it,
  };
}

function buildCategorieString(art) {
  const cat1 = (art.categoria || "").toString().trim();
  const cat2 = (art.categoria2 || "").toString().trim();
  const parts = [];
  if (cat1) parts.push(cat1);
  if (cat2) parts.push(cat2);
  return parts.join(" > ");
}

function calcolaGiacenze(art) {
  const g = Number(art.disponibilita ?? art.giacenza ?? 0);
  if (Number.isNaN(g)) return 0;
  return g;
}

function buildPrezzo(art) {
  const p = Number(art.prezzoVendita ?? art.prezzo ?? 0);
  if (Number.isNaN(p)) return 0;
  return p;
}

function buildTag(art) {
  const parts = [];
  if (art.marca) parts.push(art.marca);
  if (art.categoria) parts.push(art.categoria);
  if (art.categoria2) parts.push(art.categoria2);
  return parts.join(", ");
}

async function salvaArticolo(art) {
  try {
    await upsertArticoloFromSync(art);
  } catch (err) {
    console.error("❌ Errore salvataggio articolo", art.codice, err.message);
    throw err;
  }
}

export async function syncBman() {
  if (!BMAN_URL || !BMAN_KEY) {
    throw new Error("BMAN_URL o BMAN_KEY non configurate");
  }

  console.log("🚚 Avvio sincronizzazione Bman -> Google Sheet...");

  let pagina = 1;
  let totaleImportati = 0;
  let altrePagine = true;

  while (altrePagine) {
    console.log(`📦 Recupero pagina ${pagina} da Bman...`);
    const xml = await callBman(pagina);
    const decoded = await parseBmanResponse(xml);

    const anagrafiche = decoded.anagrafiche || [];
    if (!anagrafiche.length) {
      console.log("✅ Nessuna altra anagrafica trovata, fine paginazione.");
      break;
    }

    for (const art of anagrafiche) {
      const codice = (art.codice || "").toString().trim();
      if (!codice) continue;

      const { descrizione_it } = buildDescrizioni(art);
      const categorieStr = buildCategorieString(art);
      const [categoria, sottocategoria] = categorieStr.split(" > ");
      const prezzo = buildPrezzo(art);
      const quantita = calcolaGiacenze(art);
      const tags = buildTag(art);

      await salvaArticolo({
        id_articolo: codice,
        codice,
        descrizione_it,
        prezzo,
        quantita,
        categoria: categoria || "",
        sottocategoria: sottocategoria || "",
        tags,
      });

      totaleImportati++;
    }

    if (decoded.paginaCorrente >= decoded.totPagine) {
      altrePagine = false;
    } else {
      pagina++;
    }
  }

  console.log(`✅ Sync Bman completata. Articoli importati/aggiornati: ${totaleImportati}`);

  return {
    totali: totaleImportati,
  };
}
