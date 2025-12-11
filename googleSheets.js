// googleSheets.js
import { google } from "googleapis";

export async function getSheetClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({ version: "v4", auth });
}

export async function readAllProducts() {
  const sheets = await getSheetClient();
  const sheetId = process.env.GOOGLE_SHEET_ID;

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Prodotti!A2:N9999"
  });

  return res.data.values || [];
}

export async function appendProduct(row) {
  const sheets = await getSheetClient();
  const sheetId = process.env.GOOGLE_SHEET_ID;

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "Prodotti!A2",
    valueInputOption: "RAW",
    requestBody: {
      values: [row]
    }
  });

  return true;
}

export async function updateProduct(rowNumber, rowData) {
  const sheets = await getSheetClient();
  const sheetId = process.env.GOOGLE_SHEET_ID;

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `Prodotti!A${rowNumber}:N${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [rowData]
    }
  });

  return true;
}
