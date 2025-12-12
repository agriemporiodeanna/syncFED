import { google } from "googleapis";

export class SheetsStore {
  constructor({ clientEmail, privateKey, spreadsheetId, sheetName }) {
    this.clientEmail = clientEmail;
    this.privateKey = privateKey;
    this.spreadsheetId = spreadsheetId;
    this.sheetName = sheetName || "foglio1";

    this.jwt = new google.auth.JWT({
      email: this.clientEmail,
      key: this.privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    this.sheets = google.sheets({
      version: "v4",
      auth: this.jwt,
    });
  }

  /* =========================
     HEADER
  ========================= */
  async getHeaderRow() {
    const range = `${this.sheetName}!1:1`;
    const { data } = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range,
    });
    return (data.values && data.values[0]) || [];
  }

  async setHeaderRow(headers) {
    const range = `${this.sheetName}!1:1`;
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }

  /* =========================
     RESET SHEET
  ========================= */
  async clearAllSheetsCreate(sheetName) {
    const meta = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
    });

    const requests = [];

    for (const sh of meta.data.sheets || []) {
      requests.push({
        deleteSheet: { sheetId: sh.properties.sheetId },
      });
    }

    requests.push({
      addSheet: {
        properties: {
          title: sheetName,
          gridProperties: {
            rowCount: 2000,
            columnCount: 50,
          },
        },
      },
    });

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: { requests },
    });

    this.sheetName = sheetName;
  }

  /* =========================
     READ
  ========================= */
  async readAll() {
    const range = `${this.sheetName}!A2:Z`;
    const { data } = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range,
    });
    return data.values || [];
  }

  /* =========================
     APPROVAL
  ========================= */
  async findRowIndexByCodice(codice) {
    const range = `${this.sheetName}!A2:Z`;
    const { data } = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range,
    });

    const rows = data.values || [];
    const idx = rows.findIndex(
      (r) => String(r[1] || "") === String(codice)
    );

    if (idx === -1) return null;
    return idx + 2; // header + index base 0
  }

  async markApprovedByCodice(codice) {
    const row = await this.findRowIndexByCodice(codice);
    if (!row) return false;

    const now = new Date().toISOString();

    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: [
          {
            range: `${this.sheetName}!H${row}`,
            values: [["SI"]],
          },
          {
            range: `${this.sheetName}!N${row}`,
            values: [[now]],
          },
        ],
      },
    });

    return true;
  }
}

/* =========================
   ENSURE HEADERS
========================= */
export async function ensureHeaders(store, HEADERS) {
  let current = [];
  try {
    current = await store.getHeaderRow();
  } catch (_) {}

  const same =
    current.length === HEADERS.length &&
    current.every((v, i) => String(v).trim() === String(HEADERS[i]).trim());

  if (!same) {
    await store.clearAllSheetsCreate(store.sheetName);
    await store.setHeaderRow(HEADERS);
  }
}
