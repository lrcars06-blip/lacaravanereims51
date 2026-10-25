// Compte rendu des réservations, envoyé à La Caravane le jour de chaque soirée (tâche planifiée Vercel, vercel.json).
// Protégé par CRON_SECRET. Test manuel : GET /api/compte-rendu?date=AAAA-MM-JJ avec « Authorization: Bearer <CRON_SECRET> ».
const L = require('./_lib');

const td = 'padding:7px 8px;border-bottom:1px solid #eadfca;vertical-align:top;font-size:14px;color:#1D1338';
const th = 'padding:7px 8px;text-align:left;font-size:12px;color:#5B4F78;text-transform:uppercase;letter-spacing:.04em;border-bottom:2px solid #d8cdb6';
function tableau(titre, cols, rows) {
  if (!rows.length) return `<h2 style="font-family:Georgia,serif;font-size:19px;color:#1D1338;margin:22px 0 6px">${L.esc(titre)}</h2><p style="margin:0;color:#5B4F78;font-size:14px">Aucune.</p>`;
  return `<h2 style="font-family:Georgia,serif;font-size:19px;color:#1D1338;margin:22px 0 6px">${L.esc(titre)}</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 6px">
<tr>${cols.map((c) => `<th style="${th}">${L.esc(c)}</th>`).join('')}</tr>
${rows.map((r) => `<tr>${r.map((v) => `<td style="${td}">${L.esc(v || '')}</td>`).join('')}</tr>`).join('')}</table>`;
}

async function compteRendu(ev) {
  const lignes = [['Date', `${L.dateFr(ev.date)}${ev.heure ? ', ' + ev.heure : ''}`]];
  let bloc = '', subject;

  if (ev.type === 'repas') {
    const pis = (await L.acomptesSoiree(ev.id)).sort((a, b) => (a.metadata.nom || '').localeCompare(b.metadata.nom || '', 'fr'));
    let places = 0, acomptes = 0, soldes = 0;
    const rows = pis.map((pi) => {
      const m = pi.metadata || {}, n = parseInt(m.places, 10) || 0, paye = pi.amount_received / 100, solde = Math.max(0, ev.prix * n - paye);
      places += n; acomptes += paye; soldes += solde;
      return [m.nom, String(n), m.telephone, L.euro(paye), L.euro(solde), [m.plateaux, m.precisions].filter(Boolean).join(' · ')];
    });
    const horsLigne = ev.reservees || 0;
    lignes.push(['Places payées en ligne', `${places}`], horsLigne ? ['Places réservées hors site', `${horsLigne}`] : null,
      horsLigne ? ['Total attendu', `${places + horsLigne} / ${ev.places}`] : null, ['Acomptes encaissés', L.euro(acomptes)], ['Soldes à encaisser ce soir', L.euro(soldes)]);
    bloc = tableau('Réservations payées', ['Nom', 'Places', 'Téléphone', 'Acompte', 'Solde', 'Plateaux / précisions'], rows);
    subject = `Compte rendu ${ev.titre} : ${places} couvert${places > 1 ? 's' : ''} réservé${places > 1 ? 's' : ''} en ligne`;
  } else {
    const resas = await L.resasSoiree(ev.id);
    const pass = resas.filter((c) => c.metadata.formule === 'pass'), attente = resas.filter((c) => c.metadata.formule === 'attente');
    const nb = (l) => l.reduce((t, c) => t + (parseInt(c.metadata.places, 10) || 0), 0);
    const ligne = (c) => [c.name, c.metadata.places, c.metadata.telephone || c.phone, [c.metadata.plateaux, c.metadata.precisions].filter(Boolean).join(' · ')];
    lignes.push(['Pass réservés', `${nb(pass)} (${pass.length} réservation${pass.length > 1 ? 's' : ''})`], ['À encaisser sur place', L.euro(nb(pass) * ev.prix)]);
    bloc = tableau('Pass réservés', ['Nom', 'Pass', 'Téléphone', 'Plateaux / précisions'], pass.map(ligne));
    subject = `Compte rendu ${ev.titre} : ${nb(pass)} pass réservés`;
    if (attente.length) { lignes.push(['Liste d\'attente', `${nb(attente)} personnes`]); bloc += tableau('Liste d\'attente', ['Nom', 'Personnes', 'Téléphone', 'Précisions'], attente.map(ligne)); }
  }

  return L.sendMail({
    to: L.env('RESERVATION_EMAIL'),
    subject,
    html: L.mailHtml({ titre: ev.titre, intro: 'Voici les réservations enregistrées sur le site pour la soirée de ce soir.', lignes, bloc,
      fin: 'Les réservations prises par téléphone ou par SMS ne figurent pas dans ce compte rendu.' }),
  });
}

module.exports = async (req, res) => {
  const secret = L.env('CRON_SECRET');
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return L.json(res, 401, { ok: false });
  if (!L.env('RESERVATION_EMAIL')) return L.json(res, 500, { ok: false, error: 'configuration' });

  const q = new URL(req.url, 'http://x').searchParams.get('date');
  const jour = /^\d{4}-\d{2}-\d{2}$/.test(q || '') ? q : new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const soirees = L.SOIREES.filter((s) => s.date === jour);
  const envoyes = [];
  try {
    for (const ev of soirees) { const r = await compteRendu(ev); if (r.ok) envoyes.push(ev.id); }
    return L.json(res, 200, { ok: true, date: jour, soirees: soirees.map((s) => s.id), envoyes });
  } catch (e) {
    console.error(e.message);
    return L.json(res, 502, { ok: false });
  }
};

module.exports.compteRendu = compteRendu;
