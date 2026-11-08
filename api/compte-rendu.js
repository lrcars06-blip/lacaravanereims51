// Compte rendu des réservations, envoyé à La Caravane la VEILLE de chaque soirée (tâche planifiée Vercel, vercel.json).
// Liste imprimable façon feuille de pointage : n°, nom, e-mail, téléphone, personnes, observation, case « Vu ».
// Protégé par CRON_SECRET. Test manuel : GET /api/compte-rendu?date=AAAA-MM-JJ (date de la soirée).
const L = require('./_lib');

const th = 'padding:8px 6px;text-align:left;font-size:11px;color:#FAEBD3;background:#1D1338;text-transform:uppercase;letter-spacing:.05em';
const td = 'padding:8px 6px;border-bottom:1px solid #eadfca;vertical-align:top;font-size:14px;color:#1D1338';
const vu = '<span style="display:inline-block;width:14px;height:14px;border:1.5px solid #5B4F78;border-radius:3px"></span>';

function liste(titre, resas, repas) {
  const total = resas.reduce((t, r) => t + r.pers, 0);
  const head = `<h2 style="font-family:Georgia,serif;font-size:20px;color:#1D1338;margin:24px 0 8px">${L.esc(titre)} <span style="color:#B58A2E;font-size:16px">${resas.length} réservation${resas.length > 1 ? 's' : ''} · ${total} personne${total > 1 ? 's' : ''}</span></h2>`;
  if (!resas.length) return head + '<p style="margin:0;color:#5B4F78;font-size:14px">Aucune réservation sur le site.</p>';
  const rows = resas.map((r, i) => `<tr style="background:${i % 2 ? '#FFF7E8' : '#F6EEDC'}">
<td style="${td};color:#5B4F78">${i + 1}</td>
<td style="${td}"><b>${L.esc(r.nom)}</b>${r.email ? `<br><a href="mailto:${L.esc(r.email)}" style="color:#5B4F78;font-size:12px">${L.esc(r.email)}</a>` : ''}</td>
<td style="${td};text-align:center;font-weight:700">${r.pers}</td>
<td style="${td};white-space:nowrap">${r.tel ? `<a href="tel:${L.esc(r.tel.replace(/[^\d+]/g, ''))}" style="color:#1D1338">${L.esc(r.tel)}</a>` : ''}</td>
<td style="${td};font-size:13px">${L.esc(r.obs)}</td>
<td style="${td};text-align:center">${vu}</td></tr>`).join('');
  return head + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
<tr><th style="${th}">N°</th><th style="${th}">Nom / e-mail</th><th style="${th};text-align:center">Pers.</th><th style="${th}">Téléphone</th><th style="${th}">Observation</th><th style="${th};text-align:center">Vu</th></tr>
${rows}
<tr><td colspan="6" style="padding:10px 6px;background:#1D1338;color:#FAEBD3;font-weight:700;font-size:14px;text-align:right">TOTAL : ${resas.length} réservation${resas.length > 1 ? 's' : ''} · ${total} personne${total > 1 ? 's' : ''}</td></tr></table>`;
}

async function compteRendu(ev) {
  const lignes = [['Date', `${L.dateFr(ev.date)}${ev.heure ? ', ' + ev.heure : ''}`]];
  const ordre = (a, b) => a.t - b.t; // ordre d'arrivée des réservations
  let bloc = '', nbPers = 0;

  // Détails saisis par le client sur le site (occasion, planches, précisions), retrouvés par la référence Stripe.
  const details = new Map();
  try {
    if (ev.type === 'repas' && !ev.surPlace) {
      let acomptes = 0, soldes = 0;
      const annules = await L.sheetAnnules();
      for (const pi of await L.acomptesSoiree(ev.id)) {
        const m = pi.metadata || {}, paye = pi.amount_received / 100;
        if (!annules.has(pi.id)) { acomptes += paye; soldes += L.soldeRestant(ev, m, paye); }
        details.set(pi.id, [m.enfants ? `dont ${m.enfants} enfant(s)` : '', m.occasion, m.plateaux, m.precisions].filter(Boolean).join(' · '));
      }
      lignes.push(['Acomptes encaissés', L.euro(acomptes)], ['Soldes à encaisser', L.euro(soldes)]);
    } else {
      for (const c of await L.resasSoiree(ev.id)) details.set(c.id, [c.metadata.occasion, c.metadata.plateaux, c.metadata.precisions].filter(Boolean).join(' · '));
    }
  } catch (e) { console.error('détails Stripe', e.message); }

  // LA source de vérité : le Google Sheet (statuts modifiés par Vincent, réservations déplacées, saisies par téléphone).
  const j = await L.sheetPost({ action: 'liste', event: ev.id });
  if (!j || !j.ok) lignes.push(['⚠️ Attention', 'Google Sheet injoignable au moment de l\'envoi : ouvrez le Sheet pour la liste à jour.']);
  const rows = ((j && j.lignes) || []).map((r) => ({ t: Date.parse(r.date) / 1000 || 0, statut: r.statut, nom: r.nom, email: r.email, tel: r.tel, pers: r.personnes,
    obs: [r.paiement, details.get(r.ref)].filter(Boolean).join(' · ') }));
  const conf = rows.filter((r) => r.statut === 'confirmé').sort(ordre), attente = rows.filter((r) => r.statut === 'attente').sort(ordre);
  nbPers = conf.reduce((t, r) => t + r.pers, 0);
  const nbAtt = attente.reduce((t, r) => t + r.pers, 0);
  lignes.push(['Réservations confirmées (Sheet)', `${conf.length} réservation${conf.length > 1 ? 's' : ''}, ${nbPers} personne${nbPers > 1 ? 's' : ''}`]);
  if (!(ev.type === 'repas' && !ev.surPlace) && ev.prix) lignes.push(['À encaisser sur place', L.euro(nbPers * ev.prix)]);
  if (attente.length) lignes.push(['Liste d\'attente (non confirmée)', `${attente.length} demande${attente.length > 1 ? 's' : ''}, ${nbAtt} personne${nbAtt > 1 ? 's' : ''}`]);
  bloc = liste('Réservations confirmées', conf, false);
  if (attente.length) bloc += liste('Liste d\'attente (à rappeler, non confirmée)', attente, false);

  // Réservations prises hors site (téléphone, réseaux), saisies dans la configuration de la soirée.
  // Soirée complète par la salle : le chiffre inclut déjà tout le monde, on affiche la capacité.
  const plein = ev.complet && (ev.reservees || 0) >= (ev.places || 160);
  if (!plein && ev.reservees) lignes.push(['Réservations prises hors site (téléphone, SMS)', `${ev.reservees} personnes, à pointer sur votre liste`]);
  if (plein) lignes.push(['TOTAL attendu', `Complet : ${ev.places} personnes`]);
  else { nbPers += ev.reservees || 0; lignes.push(['TOTAL attendu', `${nbPers} personne${nbPers > 1 ? 's' : ''}`]); }
  const subject = plein ? `Demain : ${ev.titre}, complet (${ev.places} personnes)` : `Demain : ${ev.titre}, ${nbPers} personne${nbPers > 1 ? 's' : ''} réservée${nbPers > 1 ? 's' : ''}`;

  return L.sendMail({
    to: L.env('RESERVATION_EMAIL'),
    subject,
    html: L.mailHtml({ titre: `Liste des réservations : ${ev.titre}`, intro: 'Voici la liste à jour du Google Sheet pour la soirée de demain. Imprimez ce mail pour le pointage à l\'arrivée.', lignes, bloc,
      fin: 'Seules les lignes « confirmé » du Sheet comptent dans le total. La liste d\'attente est donnée pour information.' }),
  });
}

module.exports = async (req, res) => {
  const secret = L.env('CRON_SECRET');
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return L.json(res, 401, { ok: false });
  if (!L.env('RESERVATION_EMAIL')) return L.json(res, 500, { ok: false, error: 'configuration' });

  const q = new URL(req.url, 'http://x').searchParams.get('date');
  const demain = new Date(Date.now() + 24 * 3600 * 1000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const jour = /^\d{4}-\d{2}-\d{2}$/.test(q || '') ? q : demain;
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
