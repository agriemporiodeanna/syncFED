import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const GITHUB_TOKEN = process.env.token_github;  // <-- nome che hai scelto tu!
const GITHUB_REPO = process.env.GITHUB_REPO || "agriemporiodeanna/SyncFED";
const GITHUB_USER = process.env.GITHUB_USER || "SyncFED BOT";

if (!GITHUB_TOKEN) {
  console.error("❌ ERRORE: token_github non presente. Aggiungilo in Render Environment!");
}

async function uploadFileToGitHub(localPath, remotePath, commitMessage = "SyncFED update") {
  try {
    const content = fs.readFileSync(localPath, { encoding: "base64" });

    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${remotePath}`;

    // Verifica se già esiste
    let sha = null;
    try {
      const check = await axios.get(url, {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}` }
      });
      sha = check.data.sha;
    } catch (err) {
      // Se 404, il file non esiste e va creato
    }

    const res = await axios.put(
      url,
      {
        message: commitMessage,
        content,
        sha
      },
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log(`📌 File inviato su GitHub: ${remotePath}`);
    return res.data;
  } catch (error) {
    console.error("❌ ERRORE upload GitHub:", error.response?.data || error.message);
    throw error;
  }
}

export { uploadFileToGitHub };
