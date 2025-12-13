import { GoogleSpreadsheet } from "google-spreadsheet";
import creds from "../credenziali.json" assert { type: "json" };
import { CAMPI_BMAN } from "../campi_bman.js";

export async function step1Schema(req, res) {
  try {
    const doc = new GoogleSpreadsheet(process.env.SHEET_ID);
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();

    const sheet = doc.sheetsByTitle["PRODOTTI_BMAN"];
    if (!sheet) {
      return res.status(404).json({
        ok: false,
        message: "Foglio PRODOTTI_BMAN non trovato"
      });
    }

    const headers = sheet.headerValues || [];

    // Caso: foglio vuoto
    if (headers.length === 0) {
      await sheet.setHeaderRow(CAMPI_BMAN);
      return res.json({
        ok: true,
        azione: "create",
        colonne: CAMPI_BMAN
      });
    }

    // Caso: colonne mancanti
    const mancanti = CAMPI_BMAN.filter(c => !headers.includes(c));

    if (mancanti.length > 0) {
      await sheet.setHeaderRow([...headers, ...mancanti]);
      return res.json({
        ok: true,
        azione: "update",
        aggiunte: mancanti
      });
    }

    // Caso: già allineato
    return res.json({
      ok: true,
      azione: "none",
      message: "Intestazioni già allineate"
    });

  } catch (err) {
    console.error("STEP 1 ERROR:", err);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
}
