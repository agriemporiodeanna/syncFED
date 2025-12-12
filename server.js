import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import { getArticoli, approvaArticolo, initSheet } from "./googleSheets.js";
import { syncBman } from "./syncfed.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Static assets (dashboard)
app.use(express.static(path.join(__dirname, "public")));

// Inizializza intestazioni dello Sheet all'avvio
initSheet().catch((err) => {
  console.error("❌ Errore inizializzazione Google Sheet:", err.message);
});

// Endpoint di health-check
app.get("/health", (req, res) => {
  res.json({ ok: true, message: "SyncFED attivo (Google Sheet)" });
});

// Lista articoli per dashboard
app.get("/api/articoli", async (req, res) => {
  try {
    const filter = req.query.filter === "tutti" ? "tutti" : "non_approvati";
    const articoli = await getArticoli(filter);

    const mapped = articoli.map((a) => ({
      codice: a.codice,
      descrizione_it: a.descrizione_it,
      prezzo: a.prezzo,
      quantita: a.quantita,
      categoria: a.categoria,
      sottocategoria: a.sottocategoria,
      tags: a.tags,
      ottimizzazione_approvata: a.ottimizzazione_approvata,
    }));

    res.json(mapped);
  } catch (err) {
    console.error("Errore /api/articoli:", err);
    res.status(500).json({ error: err.message || "Errore nel recupero articoli" });
  }
});

// Approva singolo articolo
app.post("/api/articoli/:codice/approva", async (req, res) => {
  const { codice } = req.params;
  try {
    await approvaArticolo(codice);
    res.json({ ok: true });
  } catch (err) {
    console.error("Errore approvazione articolo", codice, err);
    res.status(500).json({ ok: false, error: err.message || "Errore approvazione articolo" });
  }
});

// Trigger sync manuale da Bman -> Google Sheet
app.post("/api/sync", async (req, res) => {
  try {
    const result = await syncBman();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("Errore sync:", err);
    res.status(500).json({ ok: false, error: err.message || "Errore sincronizzazione" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 SyncFED (Google Sheet) avviato sulla porta ${PORT}`);
});
