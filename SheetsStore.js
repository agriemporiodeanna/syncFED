import { google } from "googleapis";

export class SheetsStore {
  constructor({ clientEmail, privateKey, spreadsheetId, sheetName }) {
    if (!clientEmail || !privateKey || !spreadsheetId) {
      throw new Error(
        "Variabili Google Sheet mancanti: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEETS_ID"
      );
    }

    // 🔑 FIX CRITICO: normalizzazione chiave privata
    const normalizedPrivateKey = privateKey
      .replace(/\\n/g, "\n")
      .replace(/"/g, "");

    this.clientEmail = clientEmail;
    this.privateKey = normalizedPrivateKey;
    this.spreadsheetId = spreadsheetId;
    this.sheetName = sheetName || "foglio1";

    this.jwt = new google.auth.JWT({
      email: this.clientEmail,
      key: this.privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    this.sheets = google.sheets({ version: "v4", auth: this.jwt });
  }

  // ✅ CHECK AUTOMATICO DI VALIDITÀ (da chiamare all’avvio)
  async testAuth() {
    try {
      await this.jwt.authorize();
      console.log("✅ Google Sheet auth OK");
      return true;
    } catch (err) {
      console.error("❌ Errore autenticazione Google Sheet:", err.message);
      throw err;
    }
  }

  async getHeaderRow() {
    const range = `${this.sheetName}!1:1`;
    const { data } = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range,
      majorDimension: "ROWS",
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

  async clearAllSheetsCreate(sheetName) {
    const { data } = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
    });

    const requests = [];

    for (const sh of data.sheets || []) {
      requests.push({
        deleteSheet: { sheetId: sh.properties.sheetId },
      });
    }

    requests.push({
      addSheet: {
        properties: {
          title: sheetName,
          gridProperties: { rowCount: 2000, columnCount: 50 },
        },
      },
    });

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: { requests },
    });

    this.sheetName = sheetName;
  }

  async readAll() {
    const range = `${this.sheetName}!A2:Z`;
    const { data } = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range,
      majorDimension: "ROWS",
    });
    return data.values || [];
  }

  async findRowIndexByCodice(codice) {
    const range = `${this.sheetName}!A2:Z`;
    const { data } = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range,
      majorDimension: "ROWS",
    });

    const rows = data.values || [];
    const idx = rows.findIndex(
      (r) => (r[1] || "").toString() === codice.toString()
    );

    if (idx === -1) return null;
    return idx + 2;
  }

  async markApprovedByCodice(codice) {
    const rowNumber = await this.findRowIndexByCodice(codice);
    if (!rowNumber) return false;

    const range = `${this.sheetName}!H${rowNumber}:H${rowNumber}`;
    const dateRange = `${this.sheetName}!N${rowNumber}:N${rowNumber}`;
    const nowISO = new Date().toISOString();

    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: [
          { range, values: [["SI"]] },
          { range: dateRange, values: [[nowISO]] },
        ],
      },
    });

    return true;
  }
}

export async function ensureHeaders(store, HEADERS) {
  const current = await store.getHeaderRow().catch(() => []);

  const equal =
    current.length === HEADERS.length &&
    current.every(
      (v, i) => String(v).trim() === String(HEADERS[i]).trim()
    );

  if (!equal) {
    await store.clearAllSheetsCreate(store.sheetName);
    await store.setHeaderRow(HEADERS);
  }
}
