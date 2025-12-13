import { GoogleSpreadsheet } from "google-spreadsheet";
import { CAMPI_BMAN } from "./campi_bman.js";
import creds from "./credenziali.json" assert { type: "json" };

async function allineaIntestazioni() {
  const doc = new GoogleSpreadsheet(process.env.SHEET_ID);

  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle["PRODOTTI_BMAN"];

  if (!sheet) {
    throw new Error("Foglio 'PRODOTTI_BMAN' non trovato");
  }

  const headersAttuali = sheet.headerValues || [];

  // Foglio senza intestazioni
  if (headersAttuali.length === 0) {
    await sheet.setHeaderRow(CAMPI_BMAN);
    console.log("✔ Intestazioni create");
    return;
  }

  // Controllo colonne mancanti
  const mancanti = CAMPI_BMAN.filter(
    campo => !headersAttuali.includes(campo)
  );

  if (mancanti.length > 0) {
    const nuoveIntestazioni = [...headersAttuali, ...mancanti];
    await sheet.setHeaderRow(nuoveIntestazioni);
    console.log("➕ Colonne aggiunte:", mancanti);
  } else {
    console.log("✔ Intestazioni già allineate");
  }
}

allineaIntestazioni().catch(err => {
  console.error("❌ Errore STEP 1:", err.message);
});
