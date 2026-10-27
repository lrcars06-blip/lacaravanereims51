// Demandes sans paiement en ligne : pass soirée, soirée repas réglée sur place, liste d'attente, privatisation, Convivialité.
// Envoie la demande à La Caravane et un accusé de réception au client.
const L = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.json(res, 405, { ok: false }); }
  const b = await L.readJson(req);
  if (b.botcheck) return L.json(res, 200, { ok: true }); // piège à robots : ignoré en silence

  const email = L.clean(b.email, 200), nom = L.clean(b.nom, 120), tel = L.clean(b.telephone, 40);
  const subject = L.clean(b.subject, 200) || 'Demande de réservation';
  const message = L.clean(b.message, 5000);
  if (!nom || !L.isEmail(email) || tel.replace(/\D/g, '').length < 9 || !message) return L.json(res, 400, { ok: false, error: 'champs' });
  if (!L.env('RESEND_API_KEY') || !L.env('RESERVATION_EMAIL')) return L.json(res, 500, { ok: false, error: 'configuration' });
  // Fermé au public du lundi au jeudi : seule la privatisation est possible ces jours-là (sauf soirée de l'agenda).
  const jour = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? new Date(b.date + 'T12:00:00').getDay() : -1;
  if (L.clean(b.formule, 20) === 'conviv' && jour >= 1 && jour <= 4 && !L.SOIREES.some((s) => s.date === b.date)) return L.json(res, 400, { ok: false, error: 'ferme' });

  // Soirée complète sans liste d'attente : aucune inscription acceptée.
  const evAsk = L.soiree(L.clean(b.soiree, 120));
  if (b.attente && evAsk && evAsk.attente === false) return L.json(res, 409, { ok: false, error: 'complet', restant: 0 });
  // Places : pass et soirée repas « sur place » limités à la capacité (réservations déjà prises + inscrites dans le Sheet).
  const fAsk = L.clean(b.formule, 20), nAsk = parseInt(b.invites, 10) || 0;
  const surPlaceAsk = fAsk === 'soiree' && evAsk && evAsk.surPlace;
  if (evAsk && !b.attente && (fAsk === 'pass' || surPlaceAsk) && !evAsk.gratuit) {
    if (evAsk.complet) return L.json(res, 409, { ok: false, error: 'complet', restant: 0 });
    const counts = await L.sheetCounts();
    if (counts) {
      const restant = Math.max(0, Math.min(evAsk.places || 160, 160) - (evAsk.reservees || 0) - (counts[evAsk.id] || 0));
      if (nAsk > restant) return L.json(res, 409, { ok: false, error: 'complet', restant });
    }
  }

  // 1. La demande, pour La Caravane (répondre = écrire au client)
  const interne = await L.sendMail({ to: L.env('RESERVATION_EMAIL'), subject, text: message, replyTo: email });
  if (!interne.ok) return L.json(res, 502, { ok: false });

  // 2. Accusé de réception au client (nécessite un domaine vérifié dans Resend)
  const ev = L.soiree(L.clean(b.soiree, 120));
  const f = L.clean(b.formule, 20), attente = !!b.attente, n = L.clean(b.invites, 4), prenom = nom.split(' ')[0];
  let titre, intro, fin, lignes = [];
  if (attente && ev) {
    titre = 'Vous êtes sur la liste d\'attente';
    intro = `Bonjour ${L.esc(prenom)}, la soirée est complète pour le moment. Nous vous recontactons dès qu'une place se libère.`;
    lignes = [['Soirée', ev.titre], ['Date', L.dateFr(ev.date)], ['Personnes', n]];
  } else if (f === 'soiree' && ev && ev.surPlace) {
    titre = 'Votre place est réservée';
    intro = `Bonjour ${L.esc(prenom)}, c'est noté, on vous attend !`;
    lignes = [['Soirée', ev.titre], ['Date', `${L.dateFr(ev.date)}, ${ev.heure}`], ['Places', `${n} × ${L.euro(ev.prix)}, à régler sur place`]];
    fin = 'Aucun paiement en ligne : tout se règle sur place, le soir même.';
  } else if (f === 'pass' && ev) {
    titre = ev.gratuit ? 'Votre table est réservée' : 'Votre pass est réservé';
    intro = `Bonjour ${L.esc(prenom)}, c'est noté, on vous attend !`;
    lignes = [['Soirée', ev.titre], ['Date', `${L.dateFr(ev.date)}, ${ev.heure}`], ev.gratuit ? ['Personnes', `${n}, entrée gratuite`] : ['Pass', `${n} × ${L.euro(ev.prix)}, à régler sur place`]];
    fin = ev.gratuit ? 'Entrée gratuite, les consommations se règlent sur place.' : 'Le pass comprend l\'entrée et une consommation.';
  } else {
    titre = 'Nous avons bien reçu votre demande';
    intro = `Bonjour ${L.esc(prenom)}, merci pour votre demande. Nous revenons vers vous très vite pour confirmer la date.`;
    lignes = [['Date souhaitée', b.date ? L.dateFr(L.clean(b.date, 10)) : 'à définir'], ['Personnes', n], ['Formule', f === 'conviv' ? 'Convivialité' : 'Privatisation']];
  }
  if (b.plateaux) lignes.push(['Plateaux', L.clean(b.plateaux, 400)]);
  if (ev && (attente || f === 'pass' || (f === 'soiree' && ev.surPlace))) {
    const meta = { event_id: ev.id, event_date: ev.date, formule: attente ? 'attente' : f === 'soiree' ? 'surplace' : 'pass', places: n,
      telephone: tel, occasion: L.clean(b.occasion, 80), plateaux: L.clean(b.plateaux, 400), precisions: L.clean(b.precisions, 450) };
    let client = null;
    try { client = await L.enregistrerResa(meta, { nom, email, telephone: tel }); } catch (e) { console.error('enregistrement resa', e.message); }
    // Suivi dans le Google Sheet (réf = client Stripe, pour dédoublonner et pour les annulations)
    await L.sheetPost(L.ligneResa({ name: nom, email, phone: tel, ...(client || {}), metadata: { ...meta, ...((client && client.metadata) || {}) } }));
  }
  await L.sendMail({ to: email, subject: titre + ' : La Caravane', replyTo: L.env('RESERVATION_EMAIL'), html: L.mailHtml({ titre, intro, lignes, fin, bloc: ev && !attente && (f === 'pass' || (f === 'soiree' && ev.surPlace)) ? L.INFOS_SECURITE : '' }) });

  return L.json(res, 200, { ok: true });
};
