import { google } from "googleapis";

export async function getSheetClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({ version: "v4", auth });
}

export async function readProducts() {
  const sheets = await getSheetClient();
  const sheetId = process.env.GOOGLE_SHEET_ID;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Prodotti!A2:N9999" // ← colonne complete
  });

  return response.data.values || [];
}

export async function writeProduct(rowValues) {
  const sheets = await getSheetClient();
  const sheetId = process.env.GOOGLE_SHEET_ID;

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "Prodotti!A2",
    valueInputOption: "RAW",
    requestBody: {
      values: [rowValues]
    }
  });

  return true;
}
