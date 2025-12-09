import express from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import db from "./db.js";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🌍 HOST BMAN
const BMAN_KEY = process.env.Bman_key;

// 🧠 SOAP CALL PER BMAN
async function callBman(page = 1) {
  const xml = `
    <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                   xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                   xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body>
        <getAnagrafiche xmlns="http://cloud.bman.it/">
          <chiave>${BMAN_KEY}</chiave>
          <filtro>
            <chiave>bmanShop</chiave>
            <operatore>=</operatore>
            <valore>true</valore>
          </filtro>
          <pagina>${page}</pagina>
        </getAnagrafiche>
      </soap:Body>
    </soap:Envelope>
  `;

  try {
    const response = await axios.post(
      "https://emporiodeanna.bman.it:3555/bmanapi.asmx",
      xml,
      {
        headers: { "Content-Type": "text/xml;charset=UTF-8" },
        timeout: 120000,
        httpsAgent: new (require("https").Agent)({ rejectUnauthorized: false }),
      }
    );
    return response.data;
  } catch (err) {
    console.error("❌ ERRORE SYNC:", err);
    throw err;
  }
}

// 📌 ROTTA SYNC
app.post("/sync", async (req, res) => {
  try {
    let page = 1;
    console.log(`📦 Sincronizzo pagina ${page}...`);
    await callBman(page);
    res.send("✔ Sincronizzazione richiesta avviata!");
  } catch {
    res.status(500).send("❌ Errore durante sincronizzazione");
  }
});

// 📌 LISTA ARTICOLI CON FILTRO APPROVAZIONE
// /articoli?filter=all | approved | pending
app.get("/articoli", async (req, res) => {
  const filter = req.query.filter;
  let sql = "SELECT * FROM articoli";

  if (filter === "approved") sql += " WHERE ottimizzazione_approvata = 'si'";
  if (filter === "pending") sql += " WHERE ottimizzazione_approvata IS NULL OR ottimizzazione_approvata = ''";

  try {
    const [rows] = await db.query(sql);
    res.json(rows);
  } catch (err) {
    console.error("❌ ERRORE GET /articoli:", err);
    res.status(500).send("Errore caricamento articoli");
  }
});

// 📌 APPROVAZIONE SINGOLO ARTICOLO
app.post("/approve/:codice", async (req, res) => {
  try {
    await db.query(
      "UPDATE articoli SET ottimizzazione_approvata = 'si' WHERE codice = ?",
      [req.params.codice]
    );
    res.send("✔ Articolo approvato!");
  } catch (err) {
    console.error("❌ ERRORE APPROVAZIONE:", err);
    res.status(500).send("Errore update articolo");
  }
});

// 📌 TEST CONNESSIONE DATABASE
app.get("/testdb", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT NOW() AS time");
    res.send(`🟢 Connessione MySQL OK! Ora server data: ${rows[0].time}`);
  } catch (err) {
    console.error("❌ Test DB error:", err);
    res.status(500).send("🔴 Errore connessione DB: " + err.message);
  }
});

// 🌐 SERVE FRONTEND
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "dashboard.html"))
);

// 🚀 AVVIO SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 SyncFED attivo su porta ${PORT}`));
