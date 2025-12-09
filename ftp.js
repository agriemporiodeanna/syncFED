import ftp from "basic-ftp";
import dotenv from "dotenv";

dotenv.config();

// Funzione placeholder: per ora non carica realmente i file,
// ma è pronta per essere estesa in futuro.
export async function uploadImage(localInfo, remoteFileName) {
  console.log("📁 FTP upload non attivo (placeholder):", remoteFileName);
  return null;
}
