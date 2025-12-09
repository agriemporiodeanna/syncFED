# SyncFED

Servizio Node.js che:

1. Legge gli articoli da BMAN (solo `bmanShop = true`) tramite `getAnagrafiche`.
2. Li salva nella tabella MySQL `prodotti`.
3. Espone una dashboard web per vedere gli articoli e segnare l'ottimizzazione.

Quando un articolo ha `ottimizzazione_approvata = 1` viene **saltato** negli aggiornamenti successivi.

## Variabili d'ambiente

- `PORT` (opzionale, default 3000)
- `BMAN_KEY` oppure `Bman_key` → chiave API BMAN
- `DB_HOST` (default `31.11.39.115`)
- `DB_USER` (default `Sql1777937`)
- `DB_PASSWORD` (default `Patatone22$$`)
- `DB_NAME` (default `Sql1777937_3`)

## Avvio locale

```bash
npm install
npm start
```

Apri poi: `http://localhost:3000`
