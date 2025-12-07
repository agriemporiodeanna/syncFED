import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import https from "https";
import { syncBman } from "./syncfed.js";
import { uploadToFTP } from "./ftp.js";
import { pool } from "./db.js";
import { parseStringPromise } from "xml2js";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// ⏱ Timeout dinamico
const serverTimeout = parseInt(process.env.SERVER_TIMEOUT || "200000");
app.use((req, res, next) => {
  req.setTimeout(serverTimeout);
  res.setTimeout(serverTimeout);
  next();
});

// 🔐 Fix https per Bman
const agent = new https.Agent({ rejectUnauthorized: false });

// 🧠 Sync manuale
app.get("/sync", async (req, res) => {
  try {
    const tot = await syncBman();
    res.json({ ok: true, messaggio: "Sync completata", articoli: tot });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, errore: err.message });
  }
});

// 📸 Ricerca immagini
app.get("/image-search/:codice/:titolo/:marca", async (req, res) => {
  const { titolo, marca } = req.params;
  const query = `${marca} ${titolo}`.trim();

  const urls = [
    `https://pixabay.com/api/?key=${process.env.PIXABAY_KEY}&q=${encodeURIComponent(query)}&image_type=photo`,
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}`,
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&client_id=${process.env.UNSPLASH_KEY}`
  ];

  try {
    const results = {};

    const px = await axios.get(urls[0]);
    results.pixabay = px.data.hits?.map(h => h.largeImageURL) || [];

    const pex = await axios.get(urls[1], { headers: { Authorization: process.env.PEXELS_KEY }});
    results.pexels = pex.data.photos?.map(p => p.src.large) || [];

    const un = await axios.get(urls[2]);
    results.unsplash = un.data.results?.map(p => p.urls.regular) || [];

    res.json({ ok: true, query, results });
  } catch (err) {
    res.status(500).json({ ok: false, errore: err.message });
  }
});

// 📤 Upload immagine
app.post("/upload-image", async (req, res) => {
  try {
    const { imageURL, codice, id_bman } = req.body;
    const imgBuffer = (await axios.get(imageURL, { responseType: "arraybuffer" })).data;

    const fileName = `${codice}_${Date.now()}.jpg`;
    const urlFTP = await uploadToFTP(imgBuffer, fileName);

    await pool.query(
      `INSERT INTO immagini_prodotto (id_bman, codice, url_originale, url_ftp, sorgente, licenza, predefinita)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id_bman, codice, imageURL, urlFTP, "stock", "commerciale", 0]
    );

    const bmanXML = `
    <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                   xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                   xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body>
        <InsertFotoAnagrafica xmlns="http://cloud.bman.it/">
          <chiave>${process.env.BMAN_KEY}</chiave>
          <IDAnagrafica>${id_bman}</IDAnagrafica>
          <url>${urlFTP}</url>
        </InsertFotoAnagrafica>
      </soap:Body>
    </soap:Envelope>`;

    await axios.post(
      `https://${process.env.BMAN_DOMAIN}:3555/bmanapi.asmx`,
      bmanXML,
      { headers: { "Content-Type": "text/xml;charset=UTF-8" }, httpsAgent: agent }
    );

    res.json({ ok: true, nuovoFile: urlFTP });
  } catch (err) {
    console.error("⚠️ ERRORE upload:", err);
    res.status(500).json({ ok: false, errore: err.message });
  }
});

// Pagina test
app.get("/", (req, res) => {
  res.send("SyncFED API attivo 🚀");
});

// 🚦 Avvio server con timeout globale
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () =>
  console.log(`🚀 SyncFED attivo sulla porta ${PORT}`)
);
server.timeout = serverTimeout;
