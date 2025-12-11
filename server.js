import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import { readSheet, writeSheet } from "./googleSheet.js";
import { syncBman } from "./syncfed.js";

dotenv.config();

// Path handling
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve dashboard static files
app.use(express.static(path.join(__dirname, "public")));

/* ----------------------------------------------------
   🔵 TEST GOOGLE SHEETS
---------------------------------------------------- */
app.get("/test-sheet", async (req, res) => {
  try {
    const rows = await readSheet();

    res.json({
      ok: true,
      message: "Connessione Google Sheet OK",
      rows_read: rows.length,
      sample: rows.slice(0, 5),
    });
  } catch (err) {
    console.error("Errore Google Sheet:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ----------------------------------------------------
   🔵 LISTA ARTICOLI (da Google Sheet)
---------------------------------------------------- */
app.get("/api/articoli", async (req, res) => {
  try {
    const filter = req.query.filter || "non_approvati";

    let rows = await readSheet();

    if (filter === "non_approvati") {
      rows = rows.filter(
        (r) =>
          !r.ottimizzazione_approvata ||
          r.ottimizzazione_approvata.toUpperCase() !== "SI"
      );
    }

    res.json(rows);
  } catch (err) {
    console.error("Errore /api/articoli:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ----------------------------------------------------
   🔵 APPROVA ARTICOLO (modifica Google Sheet)
---------------------------------------------------- */
app.post("/api/articoli/:codice/approva", async (req, res) => {
  try {
    const codice = req.params.codice;
    const rows = await readSheet();

    const index = rows.findIndex((r) => r.codice == codice);

    if (index === -1) {
      return res.status(404).json({ ok: false, error: "Articolo non trovato" });
    }

    rows[index].ottimizzazione_approvata = "SI";

    await writeSheet(rows);

    res.json({ ok: true });
  } catch (err) {
    console.error("Errore approva articolo:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ----------------------------------------------------
   🔵 TRIGGER SYNC DA BMAN
---------------------------------------------------- */
app.post("/api/sync", async (req, res) => {
  try {
    const result = await syncBman();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("Errore sync:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ----------------------------------------------------
   🔵 AVVIO SERVER
---------------------------------------------------- */
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`🚀 SyncFED (Google Sheet Mode) attivo sulla porta ${PORT}`);
});
