// =====================
// 🚀 SERVER API SYNCFED
// =====================

import express from "express";
import cors from "cors";
import { syncAll } from "./syncfed.js";

const app = express();
app.use(cors());
app.use(express.json());

// ===================
// 🌍 HOME TEST
// ===================
app.get("/", (req, res) => {
  res.send("SyncFED API attivo 🚀");
});

// ===================
// 🔄 AVVIO SINCRONIZZAZIONE
// ===================
app.get("/sync", async (req, res) => {
  try {
    const result = await syncAll();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, errore: err.message });
  }
});

// ===================
// 🚪 AVVIO SERVER HTTP
// ===================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 SyncFED attivo sulla porta ${PORT}`);
});
