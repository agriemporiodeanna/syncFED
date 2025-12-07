import express from "express";
import mysql from "./db.js";
import { syncBman } from "./syncfed.js";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ====== 🔐 VARIABILI ENV DA RENDER ======
const GITHUB_TOKEN = process.env.token_github;
const GITHUB_REPO = "agriemporiodeanna/SyncFED";

// ====== 🏁 HOME ======
app.get("/", (req, res) => {
  res.send(`<h1>🤖 SyncFED Online</h1><p>Server attivo!</p>`);
});

// ====== 🛠 TEST SCRITTURA SU GITHUB ======
app.get("/testgithub", async (req, res) => {
  try {
    const content = Buffer.from("SyncFED test success " + new Date()).toString("base64");

    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/test_syncfed.txt`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        "Accept": "application/vnd.github+json",
        "User-Agent": "SyncFED"
      },
      body: JSON.stringify({
        message: "Test automatico SyncFED",
        content
      })
    });

    if (!response.ok) throw new Error("GitHub error: " + response.status);
    res.json({ status: "ok", message: "✔ Test completato: file caricato su GitHub." });

  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", message: error.toString() });
  }
});

// ====== ▶ AVVIO SINCRONIZZAZIONE MANUALE ======
app.get("/sync", async (req, res) => {
  try {
    await syncBman();
    res.send("✔ Sincronizzazione completata");
  } catch (error) {
    res.status(500).send("❌ Errore sincronizzazione: " + error.toString());
  }
});

// ====== 📌 API LISTA ARTICOLI (VEDI SOLO NON APPROVATI SE RICHIESTO) ======
app.get("/articoli", async (req, res) => {
  try {
    const show = req.query.type || "all"; // all oppure non-approvati

    let query = "SELECT * FROM articoli";
    if (show === "non-approvati") query += " WHERE ottimizzazione <> 'si'";

    const [rows] = await mysql.query(query);
    res.json(rows);
  } catch (err) {
    res.status(500).send("❌ Errore caricamento articoli");
  }
});

// ====== 🆗 APPROVAZIONE ARTICOLO MANUALE ======
app.post("/approva/:id", async (req, res) => {
  try {
    await mysql.query("UPDATE articoli SET ottimizzazione = 'si' WHERE id = ?", [req.params.id]);
    res.json({ status: "ok", message: "✔ Articolo approvato" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.toString() });
  }
});

// ====== 🚀 START SERVER ======
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🔥 SyncFED server attivo su porta ${PORT} `));



