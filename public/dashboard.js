const filtroSelect = document.getElementById("filtro-articoli");
const btnAggiorna = document.getElementById("btn-aggiorna");
const btnSync = document.getElementById("btn-sync");
const tbody = document.querySelector("#tabella-articoli tbody");

async function caricaArticoli() {
  const filter = filtroSelect.value || "all";
  tbody.innerHTML = `<tr><td colspan="8" class="placeholder">Caricamento articoli...</td></tr>`;

  try {
    const res = await fetch(`/api/articoli?filter=${encodeURIComponent(filter)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.errore || "Errore caricamento");

    const articoli = data.articoli || [];

    if (!articoli.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="placeholder">Nessun articolo trovato.</td></tr>`;
      return;
    }

    tbody.innerHTML = "";
    for (const a of articoli) {
      const tr = document.createElement("tr");

      const prezzo = a.prezzo != null ? Number(a.prezzo).toFixed(2) + " €" : "";
      const ott = a.ottimizzazione_approvata ? "SI" : "NO";

      tr.innerHTML = `
        <td>${a.id}</td>
        <td>${a.codice || ""}</td>
        <td>${a.marca || ""}</td>
        <td>${a.titolo || ""}</td>
        <td>${prezzo}</td>
        <td>${a.giacenza != null ? a.giacenza : ""}</td>
        <td>
          <span class="badge ${a.ottimizzazione_approvata ? "badge-ok" : "badge-no"}">
            ${ott}
          </span>
        </td>
        <td>
          <button class="action-btn" data-id="${a.id}" ${
        a.ottimizzazione_approvata ? "disabled" : ""
      }>
            ✅ Approva
          </button>
        </td>
      `;

      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error(err);
    alert("Errore nel caricamento articoli");
    tbody.innerHTML = `<tr><td colspan="8" class="placeholder">Errore nel caricamento articoli.</td></tr>`;
  }
}

async function approvaArticolo(id) {
  if (!confirm("Segnare questo articolo come OTTIMIZZATO?")) return;
  try {
    const res = await fetch(`/api/articoli/${id}/approva`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.errore || "Errore approvazione");
    await caricaArticoli();
  } catch (err) {
    console.error(err);
    alert("Errore durante l'approvazione articolo");
  }
}

async function avviaSync() {
  if (!confirm("Avviare la sincronizzazione con BMAN?")) return;
  btnSync.disabled = true;
  btnSync.textContent = "⏱ Sync in corso...";

  try {
    const res = await fetch("/api/sync", { method: "POST" });
    const data = await res.json();
    if (!data.ok) throw new Error(data.errore || "Errore sync");
    alert(`Sync completata. Articoli elaborati: ${data.imported}`);
    await caricaArticoli();
  } catch (err) {
    console.error(err);
    alert("Errore durante la sync");
  } finally {
    btnSync.disabled = false;
    btnSync.textContent = "⚙️ Sync";
  }
}

btnAggiorna.addEventListener("click", caricaArticoli);
btnSync.addEventListener("click", avviaSync);
filtroSelect.addEventListener("change", caricaArticoli);

tbody.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button.action-btn");
  if (!btn) return;
  const id = btn.getAttribute("data-id");
  if (id) approvaArticolo(id);
});

caricaArticoli();
