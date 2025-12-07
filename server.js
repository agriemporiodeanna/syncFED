// server.js
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import { syncBman } from "./syncfed.js";
import { pool } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static (dashboard)
app.use(express.static(path.join(__dirname, "public")));

// Test base
app.get("/test", (req, res) => {
  res.send("✅ SyncFED attivo");
});

// 🔄 Sync manuale Bman → MySQL
app.post("/sync", async (req, res) => {
  try {
    console.log("▶ Avvio sincronizzazione Bman → MySQL (richiesta manuale)...");
    const result = await syncBman();
    console.log("✅ Sincronizzazione completata:", result);

    res.json({
      ok: true,
      message: "Sincronizzazione completata",
      result,
    });
  } catch (err) {
    console.error("❌ Errore nella sincronizzazione:", err);
    res.status(500).json({
      ok: false,
      message: "Errore nella sincronizzazione",
      error: err.message || String(err),
    });
  }
});

// 📋 Elenco articoli per dashboard
app.get("/api/articoli", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
         id,
         codice,
         marca,
         titolo,
         prezzo,
         iva,
         categorie,
         tags,
         giacenza,
         ottimizzazione_approvata
       FROM prodotti
       ORDER BY id DESC
       LIMIT 500`
    );

    res.json({ ok: true, articoli: rows });
  } catch (err) {
    console.error("❌ Errore lettura articoli:", err);
    res.status(500).json({
      ok: false,
      message: "Errore lettura articoli",
      error: err.message || String(err),
    });
  }
});

// ✅ Pulsante "Approva ottimizzazione" (articolo per articolo)
app.post("/api/articoli/:id/approva", async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.query(
      `UPDATE prodotti 
       SET ottimizzazione_approvata = 'si'
       WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        ok: false,
        message: "Articolo non trovato",
      });
    }

    res.json({
      ok: true,
      message: "Ottimizzazione approvata per questo articolo",
    });
  } catch (err) {
    console.error("❌ Errore aggiornando ottimizzazione_approvata:", err);
    res.status(500).json({
      ok: false,
      message: "Errore aggiornando l'articolo",
      error: err.message || String(err),
    });
  }
});

// Dashboard di default
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Server avviato su porta ${PORT}`);
});

