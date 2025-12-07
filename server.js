// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { syncBman } from "./syncfed.js";
import { pool } from "./db.js";
import fetch from "node-fetch";

// Carica variabili .env
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// 📌 Home API
app.get("/", (req, res) => {
  res.send("🛒 SyncFED API attiva!");
});

// ▶️ Avvia sincronizzazione manualmente
app.get("/sync", async (req, res) => {
  try {
    await syncBman();
    res.json({ message: "Sincronizzazione completata!" });
  } catch (err) {
    console.error("❌ Errore sync:", err);
    res.status(500).json({ error: "Errore durante sincronizzazione" });
  }
});

// ⚡ Approva ottimizzazione di un articolo
app.post("/approve/:codice", async (req, res) => {
  try {
    const { codice } = req.params;

    await pool.query(
      `UPDATE articoli SET ottimizzazione_approvata = 'SI' WHERE codice = ?`,
      [codice]
    );

    res.json({ message: `Articolo ${codice} approvato!` });
  } catch (err) {
    console.error("❌ Errore approvazione:", err);
    res.status(500).json({ error: "Errore durante approvazione articolo" });
  }
});

// 📌 Lista articoli con filtro approvati o meno
app.get("/articoli", async (req, res) => {
  try {
    const filtro = req.query.filtro; // all / non_approvati

    let query = "SELECT * FROM articoli";
    if (filtro === "non_approvati") {
      query += " WHERE ottimizzazione_approvata IS NULL OR ottimizzazione_approvata <> 'SI'";
    }

    const [rows] = await pool.query(query);
    res.json(rows);
  } catch (err) {
    console.error("❌ Errore recupero articoli:", err);
    res.status(500).json({ error: "Errore query articoli" });
  }
});

// 🚀 Avvia server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server attivo su porta ${PORT}`));
