/**
 * Page de revue interne (servie par le worker, protégée par REVIEW_SECRET).
 * Liste la file des soumissions + signalements, avec liens de preuve,
 * rejet avec motif, acceptation → PR GitHub préremplie, publication.
 */
export function reviewPageHtml(): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Revue — Marques engagées (interne)</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#1a1c1c;line-height:1.5}
  h1{font-size:1.4rem} h2{font-size:1.1rem;margin-top:2rem}
  table{border-collapse:collapse;width:100%} td,th{border:1px solid #e0e0e0;padding:.45rem;vertical-align:top;font-size:.85rem;text-align:left}
  .badge{display:inline-block;padding:.1rem .5rem;border-radius:999px;font-size:.75rem;background:#eee}
  .pending{background:#fff3cd}.accepted{background:#d1e7dd}.published{background:#cff4fc}.rejected{background:#f8d7da}
  button{padding:.35rem .7rem;border:1px solid #21435f;background:#21435f;color:#fff;border-radius:6px;cursor:pointer;font-size:.8rem}
  button.reject{background:#fff;color:#ba1a1a;border-color:#ba1a1a}
  button.ghost{background:#fff;color:#21435f}
  .muted{color:#666;font-size:.8rem} a{color:#21435f}
  #login{max-width:320px;margin:4rem auto;display:flex;flex-direction:column;gap:.5rem}
</style>
</head>
<body>
<h1>Revue interne — file des soumissions « Marques engagées »</h1>
<div id="login">
  <p class="muted">Secret de revue :</p>
  <input id="secret" type="password" placeholder="REVIEW_SECRET">
  <button onclick="loadQueue()">Ouvrir la file</button>
</div>
<div id="content" style="display:none">
  <p class="muted">Grille : <a href="https://github.com/EcoCyclea/ecocyclea-content/blob/main/docs/rubric-brand-v1.0.md">rubric-brand-v1.0.md</a> (score min. 60, preuves requises). Les rejets n’apparaissent jamais dans l’app.</p>
  <h2>Soumissions</h2>
  <table id="subs"><thead><tr><th>Code</th><th>Marque</th><th>Site (preuve)</th><th>Catégorie</th><th>Justification</th><th>Statut</th><th>Reçue le</th><th>Actions</th></tr></thead><tbody></tbody></table>
  <h2>Signalements / mises à jour</h2>
  <table id="reports"><thead><tr><th>Type</th><th>Marque</th><th>Message</th><th>Statut</th><th>Reçu le</th></tr></thead><tbody></tbody></table>
</div>
<script>
let SECRET = '';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function loadQueue() {
  SECRET = document.getElementById('secret').value;
  const res = await fetch('/review/api/queue?secret=' + encodeURIComponent(SECRET));
  if (res.status === 401) { alert('Secret incorrect'); return; }
  const data = await res.json();
  document.getElementById('login').style.display = 'none';
  document.getElementById('content').style.display = 'block';
  const subsBody = document.querySelector('#subs tbody');
  subsBody.innerHTML = data.submissions.map((s) => \`
    <tr>
      <td><strong>\${esc(s.code)}</strong></td>
      <td>\${esc(s.name)}</td>
      <td><a href="\${esc(s.url)}" target="_blank" rel="noopener">\${esc(s.url)}</a></td>
      <td>\${esc(s.category)}</td>
      <td>\${esc(s.reason)}\${s.review_notes ? '<br><span class="muted">motif : ' + esc(s.review_notes) + '</span>' : ''}</td>
      <td><span class="badge \${esc(s.status)}">\${esc(s.status)}</span></td>
      <td>\${esc((s.created_at || '').slice(0, 16).replace('T', ' '))}</td>
      <td>
        \${s.status === 'pending' ? \`
          <button onclick="accept(\${s.id}, '\${esc(s.code)}')">Accepter → PR</button>
          <button class="reject" onclick="rejectSub(\${s.id})">Rejeter</button>\` : ''}
        \${s.status === 'accepted' ? \`<button onclick="publish(\${s.id})">Marquer publiée</button>\` : ''}
      </td>
    </tr>\`).join('');
  const repBody = document.querySelector('#reports tbody');
  repBody.innerHTML = data.reports.map((r) => \`
    <tr><td>\${esc(r.type)}</td><td>\${esc(r.brand_slug || '—')}</td><td>\${esc(r.message)}</td><td>\${esc(r.status)}</td><td>\${esc((r.created_at || '').slice(0, 16).replace('T', ' '))}</td></tr>\`).join('');
}
async function accept(id, code) {
  const res = await fetch('/review/accept/' + id + '?secret=' + encodeURIComponent(SECRET), { method: 'POST' });
  if (!res.ok) { alert('Erreur ' + res.status); return; }
  const { prUrl } = await res.json();
  if (confirm('Ouvrir la PR préremplie sur GitHub ?')) window.open(prUrl, '_blank');
  loadQueue();
}
async function rejectSub(id) {
  const reason = prompt('Motif du rejet (interne) :') || '';
  await fetch('/review/reject/' + id + '?secret=' + encodeURIComponent(SECRET), { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ reason }) });
  loadQueue();
}
async function publish(id) {
  await fetch('/review/publish/' + id + '?secret=' + encodeURIComponent(SECRET), { method: 'POST' });
  loadQueue();
}
</script>
</body>
</html>`;
}
