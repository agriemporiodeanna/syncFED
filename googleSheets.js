import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

function getAuth() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY || "";
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

  if (!clientEmail || !privateKey || !spreadsheetId) {
    throw new Error("Variabili ambiente mancanti: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEETS_ID");
  }

  // Render / env vars spesso hanno le newline escape-ate
  privateKey = privateKey.replace(/\\n/g, "\n");

  return new google.auth.JWT(clientEmail, null, privateKey, SCOPES);
}

const sheets = google.sheets("v4");

const SHEET_NAME = process.env.GOOGLE_SHEETS_SHEET || "Foglio1";

const HEADER = [
  "id_articolo",
  "codice",
  "descrizione_it",
  "prezzo",
  "quantita",
  "categoria",
  "sottocategoria",
  "ottimizzazione_approvata",
  "tags",
  "descrizione_fr",
  "descrizione_es",
  "descrizione_de",
  "descrizione_en",
  "data_ultimo_aggiornamento",
];

function colLetter(idx) {
  // idx 0-based
  let n = idx + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export async function initSheet() {
  const auth = getAuth();

  const headerRange = `${SHEET_NAME}!A1:${colLetter(HEADER.length - 1)}1`;
  await sheets.spreadsheets.values.update({
    auth,
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: headerRange,
    valueInputOption: "RAW",
    requestBody: {
      values: [HEADER],
    },
  });
  console.log("✅ Header Google Sheet inizializzato");
}

async function readAllRows() {
  const auth = getAuth();
  const range = `${SHEET_NAME}!A2:N`;

  const res = await sheets.spreadsheets.values.get({
    auth,
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range,
  });

  const rows = res.data.values || [];
  const articoli = rows.map((row, idx) => {
    const obj = {};
    HEADER.forEach((key, i) => {
      obj[key] = row[i] ?? "";
    });
    obj._rowNumber = idx + 2; // per aggiornare
    return obj;
  });

  return articoli;
}

export async function getArticoli(filter = "non_approvati") {
  const articoli = await readAllRows();

  if (filter === "tutti") return articoli;

  // default: solo non approvati
  return articoli.filter((a) => {
    const v = (a.ottimizzazione_approvata || "").toString().trim().toUpperCase();
    return !v || v !== "SI";
  });
}

export async function approvaArticolo(codice) {
  const auth = getAuth();
  const articoli = await readAllRows();
  const target = articoli.find((a) => a.codice === codice);

  if (!target) {
    throw new Error(`Articolo con codice ${codice} non trovato nel Google Sheet`);
  }

  const row = target._rowNumber;
  const nowIso = new Date().toISOString();

  // Colonna H = ottimizzazione_approvata (8a colonna -> H)
  await sheets.spreadsheets.values.update({
    auth,
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: `${SHEET_NAME}!H${row}:H${row}`,
    valueInputOption: "RAW",
    requestBody: { values: [["SI"]] },
  });

  // Colonna N = data_ultimo_aggiornamento (14a colonna -> N)
  await sheets.spreadsheets.values.update({
    auth,
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    range: `${SHEET_NAME}!N${row}:N${row}`,
    valueInputOption: "RAW",
    requestBody: { values: [[nowIso]] },
  });

  console.log(`✅ Articolo ${codice} approvato sul Google Sheet (riga ${row})`);
  return true;
}

export async function upsertArticoloFromSync(art) {
  const auth = getAuth();
  const articoli = await readAllRows();
  const existing = articoli.find((a) => a.codice === art.codice);
  const nowIso = new Date().toISOString();

  const rowValues = [
    art.id_articolo || (existing && existing.id_articolo) || art.codice || "",
    art.codice || (existing && existing.codice) || "",
    art.descrizione_it || (existing && existing.descrizione_it) || "",
    art.prezzo ?? (existing && existing.prezzo) ?? "",
    art.quantita ?? (existing && existing.quantita) ?? "",
    art.categoria || (existing && existing.categoria) || "",
    art.sottocategoria || (existing && existing.sottocategoria) || "",
    existing && existing.ottimizzazione_approvata ? existing.ottimizzazione_approvata : "",
    art.tags || (existing && existing.tags) || "",
    existing && existing.descrizione_fr ? existing.descrizione_fr : "",
    existing && existing.descrizione_es ? existing.descrizione_es : "",
    existing && existing.descrizione_de ? existing.descrizione_de : "",
    existing && existing.descrizione_en ? existing.descrizione_en : "",
    nowIso,
  ];

  if (existing) {
    const row = existing._rowNumber;
    await sheets.spreadsheets.values.update({
      auth,
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: `${SHEET_NAME}!A${row}:N${row}`,
      valueInputOption: "RAW",
      requestBody: { values: [rowValues] },
    });
    console.log(`🔁 Articolo ${art.codice} aggiornato sul Google Sheet (riga ${row})`);
  } else {
    await sheets.spreadsheets.values.append({
      auth,
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: `${SHEET_NAME}!A:N`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowValues] },
    });
    console.log(`➕ Articolo ${art.codice} inserito nel Google Sheet`);
  }
}
