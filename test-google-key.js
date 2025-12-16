const { google } = require('googleapis');

(async () => {
  console.log('🔍 Test chiave Google – Node 16\n');

  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const keyRaw = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !keyRaw) {
    console.error('❌ Variabili ambiente mancanti');
    process.exit(1);
  }

  const privateKey = keyRaw.replace(/\\n/g, '\n');

  try {
    const auth = new google.auth.JWT({
      email,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });

    await auth.authorize();

    console.log('✅ FIRMA JWT OK');
    console.log('✅ Chiave privata VALIDA');
    console.log('🎉 TEST SUPERATO');
    process.exit(0);

  } catch (err) {
    console.error('❌ TEST FALLITO');
    console.error('Messaggio:', err.message);
    console.error('Codice:', err.code);
    process.exit(1);
  }
})();
