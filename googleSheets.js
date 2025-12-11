// googleSheets.js
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || "Articoli";

if (!SHEET_ID) {
  console.error("❌ GOOGLE_SHEET_ID non impostata nelle variabili di ambiente.");
}

function getServiceAccountConfig() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT non impostata nelle variabili di ambiente.");
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error("❌ Errore nel parse di GOOGLE_SERVICE_ACCOUNT:", err.message);
    throw new Error("GOOGLE_SERVICE_ACCOUNT non è un JSON valido.");
  }
}

function getSheetsClient() {
  const sa = getServiceAccountConfig();

  const auth = new google.auth.JWT(
    sa.client_email,
    null,
    sa.private_key,
    SCOPES
  );

  const sheets = google.sheets({ version: "v4", auth });
  return sheets;
}

// Utilità: indice colonna (0-based) → lettera (A, B, C, ...).
function columnIndexToLetter(index) {
  let temp = index + 1;
  let letter = "";
  while (temp > 0) {
    const rem = (temp - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    temp = Math.floor((temp - 1) / 26);
  }
  return letter;
}

/**
 * Test veloce per verificare che lo Sheet sia raggiungibile.
 */
export async function testSheetsConnection() {
  if (!SHEET_ID) {
    throw new Error("GOOGLE_SHEET_ID non impostata.");
  }

  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A1:A1`,
  });

  return res.data.values && res.data.values.length > 0;
}

/**
 * Legge TUTTI gli articoli dal foglio.
 * Struttura attesa delle colonne (da A in poi):
 *  A: id_bman
 *  B: codice
 *  C: descrizione
 *  D: categoria1
 *  E: categoria2
 *  F: categoria3
 *  G: prezzo
 *  H: giacenza
 *  I: attivo
 *  J: url_immagine
 *  K: ottimizzazione_approvata
 *  L: tag
 *  M: descrizione_fr
 *  N: descrizione_es
 *  O: descrizione_en
 *  P: descrizione_de
 */
export async function getAllArticoli() {
  if (!SHEET_ID) {
    throw new Error("GOOGLE_SHEET_ID non impostata.");
  }

  const sheets = getSheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A1:P10000`,
  });

  const values = res.data.values || [];
  if (values.length < 2) {
    return []; // solo header o vuoto
  }

  const header = values[0];
  const rows = values.slice(1);

  return rows.map((row, i) => ({
    rowNumber: i + 2, // Excel row (1-based), +1 per header
    id_bman: row[0] || "",
    codice: row[1] || "",
    descrizione: row[2] || "",
    categoria1: row[3] || "",
    categoria2: row[4] || "",
    categoria3: row[5] || "",
    prezzo: row[6] ? Number(row[6]) : null,
    giacenza: row[7] ? Number(row[7]) : null,
    attivo: row[8] ?? "",
    url_immagine: row[9] || "",
    ottimizzazione_approvata: row[10] || "",
    tag: row[11] || "",
    descrizione_fr: row[12] || "",
    descrizione_es: row[13] || "",
    descrizione_en: row[14] || "",
    descrizione_de: row[15] || "",
  }));
}

/**
 * Imposta "SI" nella colonna ottimizzazione_approvata
 * per una determinata riga (rowNumber = numero riga sul foglio).
 */
export async function setOttimizzazioneSi(rowNumber) {
  if (!SHEET_ID) {
    throw new Error("GOOGLE_SHEET_ID non impostata.");
  }

  const sheets = getSheetsClient();

  // Leggo solo l'header per sapere in che colonna è "ottimizzazione_approvata"
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!1:1`,
  });

  const header = (headerRes.data.values && headerRes.data.values[0]) || [];
  const idxOpt = header.indexOf("ottimizzazione_approvata");

  if (idxOpt === -1) {
    throw new Error(
      'Colonna "ottimizzazione_approvata" non trovata nella prima riga del foglio.'
    );
  }

  const colLetter = columnIndexToLetter(idxOpt);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!${colLetter}${rowNumber}:${colLetter}${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [["SI"]],
    },
  });

  return true;
}

/**
 * Upsert degli articoli provenienti da Bman:
 * - Se id_bman esiste già e ottimizzazione_approvata è "SI" → NON tocca la riga
 * - Se id_bman esiste ed è ancora modificabile → aggiorna i campi base (codice, descrizione, prezzi, ecc.)
 * - Se id_bman non esiste → aggiunge una nuova riga in fondo
 *
 * articoliBman = array di oggetti tipo:
 * {
 *   id_bman, codice, descrizione, categoria1, categoria2, categoria3,
 *   prezzo, giacenza, attivo, url_immagine
 * }
 */
export async function upsertArticoliFromBman(articoliBman) {
  if (!SHEET_ID) {
    throw new Error("GOOGLE_SHEET_ID non impostata.");
  }

  if (!Array.isArray(articoliBman) || articoliBman.length === 0) {
    return { inserted: 0, updated: 0, skipped: 0 };
  }

  const sheets = getSheetsClient();

  // Leggo tutto il foglio
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A1:P10000`,
  });

  const values = res.data.values || [];
  const header = values[0] || [];
  const rows = values.slice(1);

  const idxId = header.indexOf("id_bman");
  const idxCodice = header.indexOf("codice");
  const idxDescrizione = header.indexOf("descrizione");
  const idxCat1 = header.indexOf("categoria1");
  const idxCat2 = header.indexOf("categoria2");
  const idxCat3 = header.indexOf("categoria3");
  const idxPrezzo = header.indexOf("prezzo");
  const idxGiacenza = header.indexOf("giacenza");
  const idxAttivo = header.indexOf("attivo");
  const idxUrlImg = header.indexOf("url_immagine");
  const idxOpt = header.indexOf("ottimizzazione_approvata");

  if (idxId === -1 || idxCodice === -1 || idxDescrizione === -1) {
    throw new Error(
      'Header non valido: servono almeno le colonne "id_bman", "codice", "descrizione" nella prima riga.'
    );
  }

  // Mappa id_bman → { rowNumber, rowValues }
  const mappaEsistenti = new Map();
  rows.forEach((row, i) => {
    const id = row[idxId];
    if (id) {
      mappaEsistenti.set(String(id), {
        rowNumber: i + 2, // +1 per header, +1 per 1-based
        row,
      });
    }
  });

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const art of articoliBman) {
    const id = String(art.id_bman || "").trim();
    if (!id) continue;

    const esistente = mappaEsistenti.get(id);

    if (esistente) {
      const { rowNumber, row } = esistente;

      const ottim = idxOpt >= 0 ? (row[idxOpt] || "").toUpperCase() : "";
      if (ottim === "SI") {
        // l'articolo è stato già ottimizzato → non lo tocco
        skipped++;
        continue;
      }

      // Aggiorno SOLO i campi base, lasciando invariati tag/descrizioni multi-lingua
      const newRow = [...row];

      if (idxCodice >= 0) newRow[idxCodice] = art.codice || "";
      if (idxDescrizione >= 0) newRow[idxDescrizione] = art.descrizione || "";
      if (idxCat1 >= 0) newRow[idxCat1] = art.categoria1 || "";
      if (idxCat2 >= 0) newRow[idxCat2] = art.categoria2 || "";
      if (idxCat3 >= 0) newRow[idxCat3] = art.categoria3 || "";
      if (idxPrezzo >= 0)
        newRow[idxPrezzo] =
          art.prezzo != null && art.prezzo !== "" ? String(art.prezzo) : "";
      if (idxGiacenza >= 0)
        newRow[idxGiacenza] =
          art.giacenza != null && art.giacenza !== ""
            ? String(art.giacenza)
            : "";
      if (idxAttivo >= 0)
        newRow[idxAttivo] = art.attivo != null ? String(art.attivo) : "";
      if (idxUrlImg >= 0)
        newRow[idxUrlImg] = art.url_immagine || art.url || "";

      const range = `${SHEET_NAME}!A${rowNumber}:P${rowNumber}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range,
        valueInputOption: "RAW",
        requestBody: {
          values: [newRow],
        },
      });

      updated++;
    } else {
      // Nuova riga
      const newRow = new Array(header.length).fill("");

      newRow[idxId] = id;
      if (idxCodice >= 0) newRow[idxCodice] = art.codice || "";
      if (idxDescrizione >= 0) newRow[idxDescrizione] = art.descrizione || "";
      if (idxCat1 >= 0) newRow[idxCat1] = art.categoria1 || "";
      if (idxCat2 >= 0) newRow[idxCat2] = art.categoria2 || "";
      if (idxCat3 >= 0) newRow[idxCat3] = art.categoria3 || "";
      if (idxPrezzo >= 0)
        newRow[idxPrezzo] =
          art.prezzo != null && art.prezzo !== "" ? String(art.prezzo) : "";
      if (idxGiacenza >= 0)
        newRow[idxGiacenza] =
          art.giacenza != null && art.giacenza !== ""
            ? String(art.giacenza)
            : "";
      if (idxAttivo >= 0)
        newRow[idxAttivo] = art.attivo != null ? String(art.attivo) : "";
      if (idxUrlImg >= 0)
        newRow[idxUrlImg] = art.url_immagine || art.url || "";
      // ottimizzazione_approvata, tag e descrizioni multilingua restano vuoti

      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A1`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: [newRow],
        },
      });

      inserted++;
    }
  }

  console.log(
    `✅ Upsert Sheet completato: inseriti=${inserted}, aggiornati=${updated}, ignorati (già ottimizzati)=${skipped}`
  );

  return { inserted, updated, skipped };
}

