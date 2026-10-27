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
  const annules = await L.sheetAnnules();
  const lignes = [['Date', `${L.dateFr(ev.date)}${ev.heure ? ', ' + ev.heure : ''}`]];
  let bloc = '', subject, nbPers = 0;
  const ordre = (a, b) => a.t - b.t; // ordre d'arrivée des réservations

  if (ev.type === 'repas') {
    let acomptes = 0, soldes = 0;
    const resas = (await L.acomptesSoiree(ev.id)).filter((pi) => !annules.has(pi.id)).map((pi) => {
      const m = pi.metadata || {}, pers = parseInt(m.places, 10) || 0, paye = pi.amount_received / 100, solde = Math.max(0, L.totalResa(ev, m) - paye);
      acomptes += paye; soldes += solde;
      return { t: pi.created || 0, nom: m.nom, email: m.email, tel: m.telephone, pers,
        obs: [`Acompte ${L.euro(paye)}, solde ${L.euro(solde)}`, m.enfants ? `dont ${m.enfants} enfant(s)` : '', m.occasion, m.plateaux, m.precisions].filter(Boolean).join(' · ') };
    }).sort(ordre);
    nbPers = resas.reduce((t, r) => t + r.pers, 0);
    lignes.push(['Couverts réservés en ligne', `${nbPers} / ${ev.places}`], ['Acomptes encaissés', L.euro(acomptes)], ['Soldes à encaisser', L.euro(soldes)]);
    bloc = liste('Réservations payées en ligne', resas, true);
  } else {
    const all = (await L.resasSoiree(ev.id)).filter((c) => !annules.has(c.id)).map((c) => ({ t: c.created || 0, f: c.metadata.formule, nom: c.name, email: c.email, tel: c.metadata.telephone || c.phone,
      pers: parseInt(c.metadata.places, 10) || 0, obs: [c.metadata.occasion, c.metadata.plateaux, c.metadata.precisions].filter(Boolean).join(' · ') })).sort(ordre);
    const pass = all.filter((r) => r.f === 'pass'), attente = all.filter((r) => r.f === 'attente');
    nbPers = pass.reduce((t, r) => t + r.pers, 0);
    lignes.push(['Pass réservés en ligne', String(nbPers)], ['À encaisser sur place', L.euro(nbPers * ev.prix)]);
    bloc = liste('Réservations', pass, false);
    if (attente.length) bloc += liste('Liste d\'attente', attente, false);
  }
  // Réservations saisies à la main dans le Sheet (téléphone, SMS) : sans référence Stripe.
  const aLaMain = (await L.sheetListe(ev.id)).filter((r) => r.statut === 'confirmé' && !/^(pi|cus|cs)_/.test(r.ref))
    .map((r) => ({ t: Date.parse(r.date) / 1000 || 0, nom: r.nom, email: r.email, tel: r.tel, pers: r.personnes, obs: [r.paiement, 'saisie dans le Sheet'].filter(Boolean).join(' · ') }));
  if (aLaMain.length) {
    const n = aLaMain.reduce((t, r) => t + r.pers, 0);
    nbPers += n;
    lignes.push(['Ajoutées dans le Sheet (téléphone)', `${aLaMain.length} réservation${aLaMain.length > 1 ? 's' : ''}, ${n} personne${n > 1 ? 's' : ''}`]);
    bloc += liste('Réservations ajoutées dans le Sheet', aLaMain, false);
  }
  lignes.push(['TOTAL attendu', `${nbPers} personne${nbPers > 1 ? 's' : ''}`]);
  subject = `Demain : ${ev.titre}, ${nbPers} personne${nbPers > 1 ? 's' : ''} réservée${nbPers > 1 ? 's' : ''}`;

  return L.sendMail({
    to: L.env('RESERVATION_EMAIL'),
    subject,
    html: L.mailHtml({ titre: `Liste des réservations : ${ev.titre}`, intro: 'Voici toutes les réservations faites sur le site pour la soirée de demain. Imprimez ce mail pour le pointage à l\'arrivée.', lignes, bloc,
      fin: 'Les réservations prises par téléphone figurent dans cette liste si elles ont été ajoutées dans le Google Sheet (statut « confirmé »).' }),
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
