import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool, testConnection } from "./db.js";
import { syncBman } from "./syncfed.js";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Static dashboard
app.use(express.static(path.join(__dirname, "public")));

app.get("/test", async (req, res) => {
  try {
    await testConnection();
    res.json({ ok: true, message: "Connessione MySQL OK" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Lista articoli per dashboard
app.get("/api/articoli", async (req, res) => {
  try {
    const filter = req.query.filter || "non_approvati";

    let whereClause = "";
    if (filter === "non_approvati") {
      whereClause = "WHERE ottimizzazione_approvata IS NULL OR UPPER(ottimizzazione_approvata) <> 'SI'";
    }

    const [rows] = await pool.query(
      `
      SELECT
        codice,
        marca,
        titolo,
        prezzo,
        iva,
        giacenze,
        categorie,
        tag,
        ottimizzazione_approvata
      FROM articoli_syncfed
      ${whereClause}
      ORDER BY codice ASC
      LIMIT 500
    `
    );

    res.json(rows);
  } catch (err) {
    console.error("Errore /api/articoli:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Approva singolo articolo
app.post("/api/articoli/:codice/approva", async (req, res) => {
  const { codice } = req.params;
  try {
    await pool.query(
      "UPDATE articoli_syncfed SET ottimizzazione_approvata = 'SI' WHERE codice = ?",
      [codice]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Errore approvazione articolo", codice, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Trigger sync manuale
app.post("/api/sync", async (req, res) => {
  try {
    const result = await syncBman();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("Errore sync:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`✅ Server avviato sulla porta ${PORT}`);
});
