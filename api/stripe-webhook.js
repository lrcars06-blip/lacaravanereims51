// Reçoit les événements Stripe. Sur un acompte payé : e-mail de confirmation au client et alerte à La Caravane.
// À déclarer dans Stripe : Développeurs > Webhooks > Ajouter un endpoint
//   URL : https://VOTRE-SITE/api/stripe-webhook   Événement : checkout.session.completed
const L = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.json(res, 405, { ok: false }); }
  const raw = await L.readRaw(req);
  if (!L.verifStripe(raw, req.headers['stripe-signature'], L.env('STRIPE_WEBHOOK_SECRET'))) return L.json(res, 400, { ok: false, error: 'signature' });

  let event;
  try { event = JSON.parse(raw); } catch { return L.json(res, 400, { ok: false }); }
  // Remboursement (fait par Vincent dans Stripe) : mise à jour du Sheet → place libérée, sortie du compte rendu et du rappel.
  if (event.type === 'charge.refunded') {
    const c = event.data.object;
    if (c.payment_intent) {
      const total = !!c.refunded || (c.amount_refunded || 0) >= (c.amount || 0);
      const r = await L.sheetPost({ action: 'rembourse', ref: c.payment_intent, total, montant: ((c.amount_refunded || 0) / 100).toFixed(2).replace('.', ',') });
      return L.json(res, 200, { ok: true, refund: true, lignes: r && r.lignes });
    }
    return L.json(res, 200, { ok: true, refund: true });
  }
  if (event.type !== 'checkout.session.completed') return L.json(res, 200, { ok: true, ignored: event.type });

  const s = event.data.object;
  if (s.payment_status !== 'paid') return L.json(res, 200, { ok: true, unpaid: true });
  const m = s.metadata || {};

  // Paiement du solde (lien solde.html) : acomptes marqués soldés, Sheet, e-mails.
  if (m.type === 'solde') {
    const evS = L.soiree(m.solde_event) || { titre: m.solde_event, date: '', heure: '' };
    const montant = (s.amount_total || 0) / 100;
    for (const id of String(m.acomptes || '').split(',').filter(Boolean)) {
      try { await L.stripe('POST', '/payment_intents/' + id, { metadata: { solde_paye: 'oui', solde_session: s.id } }); } catch (e) { console.error('solde', id, e.message); }
      await L.sheetPost({ action: 'solde', ref: id, montant: montant.toFixed(2).replace('.', ',') });
    }
    const lignesS = [['Soirée', evS.titre], ['Date', evS.date ? `${L.dateFr(evS.date)}${evS.heure ? ', ' + evS.heure : ''}` : ''], ['Solde payé', L.euro(montant)], ['Reste à payer', L.euro(0)]];
    await Promise.all([
      L.sendMail({ to: m.email || s.customer_details?.email, subject: `Votre réservation est réglée : ${evS.titre}`, replyTo: L.env('RESERVATION_EMAIL') || undefined,
        html: L.mailHtml({ titre: 'Tout est réglé !', intro: `Bonjour ${L.esc((m.nom || '').split(' ')[0])}, nous avons bien reçu le solde. Votre réservation est entièrement payée.`, lignes: lignesS, bloc: L.INFOS_SECURITE, fin: 'Votre facture de solde est jointe à l\'e-mail de reçu Stripe. À très vite !' }) }),
      L.sendMail({ to: L.env('RESERVATION_EMAIL'), subject: `Solde reçu : ${evS.titre} (${m.nom})`, replyTo: m.email,
        html: L.mailHtml({ titre: 'Solde payé', intro: 'Un solde vient d\'être payé en ligne.', lignes: [...lignesS, ['Nom', m.nom], ['E-mail', m.email]] }) }),
    ]);
    return L.json(res, 200, { ok: true, solde: true });
  }
  const ev = L.soiree(m.event_id) || { titre: m.event_id, date: m.event_date, heure: '', prix: 0 };
  const places = parseInt(m.places, 10) || 0;
  const paye = (s.amount_total || 0) / 100;
  const solde = L.soldeRestant(ev, m, paye), enLigne = L.soldeEnLigne(ev.id);
  const lignes = [
    ['Soirée', ev.titre], ['Date', `${L.dateFr(ev.date)}${ev.heure ? ', ' + ev.heure : ''}`], ['Places', m.enfants ? `${places} (dont ${m.enfants} enfant${m.enfants > 1 ? 's' : ''})` : String(places)],
    ['Acompte payé', L.euro(paye)], [L.soldeLibelle(ev.id), L.euro(solde)],
    m.plateaux ? ['Plateaux', m.plateaux] : null,
  ];

  await Promise.all([
    L.sendMail({
      to: m.email || s.customer_details?.email,
      subject: `Votre place est confirmée : ${ev.titre}`,
      replyTo: L.env('RESERVATION_EMAIL') || undefined,
      html: L.mailHtml({ titre: 'C\'est réservé !', intro: `Bonjour ${L.esc(m.nom || '')}, nous avons bien reçu votre acompte. Votre place est confirmée.`, lignes, bloc: L.INFOS_SECURITE, fin: (enLigne ? `Le solde se règle ${enLigne.texte}, avec le lien que nous vous enverrons.` : 'Le solde se règle sur place, le soir même.') + ' Pour toute question, répondez simplement à cet e-mail ou appelez-nous.' }),
    }),
    L.sendMail({
      to: L.env('RESERVATION_EMAIL'),
      subject: `Acompte reçu : ${ev.titre}, ${places} place${places > 1 ? 's' : ''} (${m.nom})`,
      replyTo: m.email,
      html: L.mailHtml({ titre: 'Nouvelle réservation payée', intro: 'Un acompte vient d\'être payé en ligne.', lignes: [...lignes, ['Nom', m.nom], ['E-mail', m.email], ['Téléphone', m.telephone], ['Occasion', m.occasion], m.precisions ? ['Précisions', m.precisions] : null] }),
    }),
  ]);

  // Suivi dans le Google Sheet (réf = PaymentIntent, pour dédoublonner et pour les annulations)
  if (s.payment_intent) {
    await L.sheetPost(L.ligneAcompte({ id: s.payment_intent, metadata: m, amount_received: s.amount_total, created: event.created }));
  }
  return L.json(res, 200, { ok: true });
};
