// Modulo FTP semplificato: per ora uploadImage è solo uno stub
// così il resto dell'applicazione non va in errore.

export async function uploadImage(localPath, remoteFileName) {
  console.log("📁 [FAKE FTP] uploadImage", { localPath, remoteFileName });
  // Restituiamo un path simbolico
  return `/img/${remoteFileName}`;
}
