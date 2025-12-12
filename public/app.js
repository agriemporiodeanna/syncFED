const $ = (s) => document.querySelector(s);

async function loadArticoli() {
  const filter = document.querySelector("#filterSelect").value;
  const res = await fetch(`/api/articoli?filter=${encodeURIComponent(filter)}`);
  const data = await res.json();
  const tbody = document.querySelector("#articoliTable tbody");
  tbody.innerHTML = "";
  data.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.codice || ""}</td>
      <td>${r.descrizione_it || ""}</td>
      <td>${r.prezzo || ""}</td>
      <td>${r.quantita || ""}</td>
      <td>${r.categoria || ""}</td>
      <td>${r.sottocategoria || ""}</td>
      <td>${r.tags || ""}</td>
      <td>${(r.ottimizzazione_approvata || "").toUpperCase() === "SI" ? "✅ SI" : "❌ NO"}</td>
      <td>${r.data_ultimo_aggiornamento || ""}</td>
      <td>
        <button class="approve" data-codice="${r.codice}">Approva</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("button.approve");
  if (!btn) return;
  const codice = btn.getAttribute("data-codice");
  btn.disabled = true;
  try {
    const res = await fetch(`/api/articoli/${encodeURIComponent(codice)}/approva`, {
      method: "POST",
    });
    if (!res.ok) throw new Error("Errore approvazione");
    await loadArticoli();
  } catch (err) {
    alert(err.message || "Errore");
  } finally {
    btn.disabled = false;
  }
});

document.querySelector("#refreshBtn").addEventListener("click", loadArticoli);
document.querySelector("#filterSelect").addEventListener("change", loadArticoli);
document.querySelector("#syncBtn").addEventListener("click", async () => {
  const btn = document.querySelector("#syncBtn");
  btn.disabled = true;
  try {
    const res = await fetch("/api/sync", { method: "POST" });
    const j = await res.json();
    alert(j.message || (j.ok ? "Sync ok" : "Sync fallito"));
  } catch (e) {
    alert("Errore sync");
  } finally {
    btn.disabled = false;
  }
});

loadArticoli();
