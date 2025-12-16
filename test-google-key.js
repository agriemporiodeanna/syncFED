import 'dotenv/config';
import { google } from 'googleapis';

async function testGoogleKey() {
  console.log('🔍 Avvio test chiave Google...\n');

  const required = [
    'GOOGLE_CLIENT_EMAIL',
    'GOOGLE_PRIVATE_KEY',
    'GOOGLE_SHEET_ID'
  ];

  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('❌ Variabili ambiente mancanti:', missing.join(', '));
    process.exit(1);
  }

  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL.trim();
  const sheetId = process.env.GOOGLE_SHEET_ID.trim();

  let privateKey;
  try {
    privateKey = process.env.GOOGLE_PRIVATE_KEY
      .replace(/\\n/g, '\n')
      .trim();
  } catch (e) {
    console.error('❌ Errore parsing chiave privata Google');
    throw e;
  }

  try {
    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    await auth.authorize();
    console.log('✅ Autenticazione Google OK');

    const sheets = google.sheets({ version: 'v4', auth });

    const meta = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
    });

    console.log('✅ Accesso al Google Sheet OK');
    console.log('📄 Titolo:', meta.data.properties.title);
    console.log('🧾 Fogli disponibili:');
    meta.data.sheets.forEach(s =>
      console.log(' -', s.properties.title)
    );

    console.log('\n🎉 TEST SUPERATO');
    process.exit(0);

  } catch (err) {
    console.error('\n❌ TEST FALLITO');
    console.error('Motivo:', err.message);
    console.error('Codice:', err.code || 'n/a');
    process.exit(1);
  }
}

testGoogleKey();
