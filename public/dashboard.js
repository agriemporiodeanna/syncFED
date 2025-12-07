// public/dashboard.js

async function caricaArticoli() {
  const tbody = document.getElementById("tbodyArticoli");
  tbody.innerHTML = "<tr><td colspan='11'>Caricamento...</td></tr>";

  try {
    const res = await fetch("/api/articoli");
    const data = await res.json();

    if (!data.ok) {
      tbody.innerHTML = `<tr><td colspan='11'>Errore: ${data.message}</td></tr>`;
      return;
    }

    const articoli = data.articoli;
    if (!articoli || articoli.length === 0) {
      tbody.innerHTML = "<tr><td colspan='11'>Nessun articolo trovato</td></tr>";
      return;
    }

    tbody.innerHTML = "";

    for (const art of articoli) {
      const tr = document.createElement("tr");

      const pillClass =
        art.ottimizzazione_approvata === "si" ? "pill pill-si" : "pill pill-no";
      const pillText = art.ottimizzazione_approvata === "si" ? "SI" : "NO";

      tr.innerHTML = `
        <td>${art.id}</td>
        <td>${art.codice || ""}</td>
        <td>${art.marca || ""}</td>
        <td>${art.titolo || ""}</td>
        <td>${art.prezzo != null ? art.prezzo.toFixed(2) : ""}</td>
        <td>${art.iva != null ? art.iva : ""}</td>
        <td>${art.categorie || ""}</td>
        <td>${art.tags || ""}</td>
        <td>${art.giacenza != null ? art.giacenza : ""}</td>
        <td><span class="${pillClass}">${pillText}</span></td>
        <td>
          <button class="btn-approva" data-id="${art.id}" ${
        art.ottimizzazione_approvata === "si" ? "disabled" : ""
      }>
            ✅ Approva ottimizzazione
          </button>
        </td>
      `;

      tbody.appendChild(tr);
    }

    // Associa eventi ai pulsanti
    document.querySelectorAll(".btn-approva").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const id = e.currentTarget.getAttribute("data-id");
        await approvaOttimizzazione(id);
      });
    });
  } catch (err) {
    console.error("Errore caricando articoli:", err);
    tbody.innerHTML =
      "<tr><td colspan='11'>Errore caricando gli articoli</td></tr>";
  }
}

async function approvaOttimizzazione(id) {
  if (!confirm("Confermi l'approvazione dell'ottimizzazione per questo articolo?")) {
    return;
  }

  try {
    const res = await fetch(`/api/articoli/${id}/approva`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const data = await res.json();
    if (!data.ok) {
      alert("Errore: " + (data.message || "Impossibile approvare"));
      return;
    }

    // Ricarica la tabella
    await caricaArticoli();
  } catch (err) {
    console.error("Errore approvando ottimizzazione:", err);
    alert("Errore di rete durante l'approvazione");
  }
}

async function eseguiSync() {
  const status = document.getElementById("syncStatus");
  status.textContent = "⏳ Sincronizzazione in corso...";

  try {
    const res = await fetch("/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const data = await res.json();
    if (!data.ok) {
      status.textContent = "❌ Errore sync: " + (data.message || "Errore");
      return;
    }

    const r = data.result || {};
    status.textContent = `✅ Sync completata - letti: ${r.letti || 0}, inseriti: ${
      r.inseriti || 0
    }, aggiornati: ${r.aggiornati || 0}, saltati (approvati): ${
      r.saltati_approvati || 0
    }`;

    // Dopo la sync, aggiorna la tabella
    await caricaArticoli();
  } catch (err) {
    console.error("Errore sync:", err);
    status.textContent = "❌ Errore di rete nella sync";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnSync").addEventListener("click", eseguiSync);
  caricaArticoli();
});
