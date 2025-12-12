// server.js (Google Sheet only, with key validation)
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleAuth } from "google-auth-library";
import { google } from "googleapis";

dotenv.config();

const REQUIRED_ENV = [
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "GOOGLE_SHEETS_ID"
];

function checkEnv() {
  const missing = REQUIRED_ENV.filter(k => !process.env[k]);
  if (missing.length) {
    throw new Error("Variabili ambiente mancanti: " + missing.join(", "));
  }
}

function parsePrivateKey(key) {
  return key.replace(/\\n/g, "\n");
}

async function testGoogleAuth() {
  const auth = new GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: parsePrivateKey(process.env.GOOGLE_PRIVATE_KEY),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  await auth.getClient();
}

const app = express();
app.use(cors());
app.use(express.json());

try {
  checkEnv();
  await testGoogleAuth();
  console.log("✅ Google Sheet auth OK");
} catch (err) {
  console.error("❌ Errore inizializzazione Google Sheet:", err.message);
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 SyncFED (Google Sheet) avviato sulla porta ${PORT}`);
});
