import { uploadFileToGitHub } from "./github.js";
import fs from "fs";

async function runTest() {
  const testFile = "test_syncfed.txt";
  const message = "Test upload file da SyncFED 🚀";

  // Scrive un file di test localmente
  fs.writeFileSync(testFile, "Questo è un test automatico di upload su GitHub tramite SyncFED BOT.", "utf-8");

  try {
    console.log("🔄 Invio file di test a GitHub...");
    await uploadFileToGitHub(testFile, testFile, message);
    console.log("🎉 Test completato con successo!");
  } catch (err) {
    console.error("❌ Test fallito:", err.message);
  }
}

runTest();
