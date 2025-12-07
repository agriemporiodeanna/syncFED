import { Client } from "basic-ftp";
import dotenv from "dotenv";
dotenv.config();

export async function uploadToFTP(buffer, remoteName) {
  const client = new Client();
  try {
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      secure: false,
      port: 21
    });

    // Crea cartella se non esiste
    await client.ensureDir(process.env.FTP_DIR);
    await client.uploadFrom(buffer, `${process.env.FTP_DIR}/${remoteName}`);

    return `${process.env.FTP_HTTP}/${remoteName}`;
  } catch (err) {
    console.error("❌ Errore upload FTP:", err);
    throw err;
  } finally {
    client.close();
  }
}
