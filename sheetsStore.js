import { google } from "googleapis";

export class SheetsStore {
  constructor({ clientEmail, privateKey, spreadsheetId, sheetName }) {
    this.spreadsheetId = spreadsheetId;
    this.sheetName = sheetName;
    this.jwt = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    this.sheets = google.sheets({ version: "v4", auth: this.jwt });
  }
}

export async function ensureHeaders(store, headers) {
  const range = `${store.sheetName}!1:1`;
  const { data } = await store.sheets.spreadsheets.values.get({
    spreadsheetId: store.spreadsheetId,
    range,
  });
  const current = (data.values && data.values[0]) || [];
  if (current.join() !== headers.join()) {
    await store.sheets.spreadsheets.values.update({
      spreadsheetId: store.spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }
}
