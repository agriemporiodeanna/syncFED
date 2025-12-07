// ftp.js
import ftp from "basic-ftp";
import fs from "fs";

export async function uploadImage(localPath, remoteName) {
  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      secure: false
    });

    // Carica nella cartella IMMAGINI/ se non esiste creala
    try {
      await client.ensureDir("IMMAGINI");
    } catch (err) {
      console.log("⚠️ Cartella IMMAGINI già presente");
    }

    await client.uploadFrom(localPath, `IMMAGINI/${remoteName}`);
    console.log(`📤 Caricata immagine: ${remoteName}`);
    return true;

  } catch (err) {
    console.error("❌ Errore FTP:", err);
    return false;

  } finally {
    client.close();
  }
}

