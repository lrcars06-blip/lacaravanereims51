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
  if (event.type !== 'checkout.session.completed') return L.json(res, 200, { ok: true, ignored: event.type });

  const s = event.data.object;
  if (s.payment_status !== 'paid') return L.json(res, 200, { ok: true, unpaid: true });
  const m = s.metadata || {};
  const ev = L.soiree(m.event_id) || { titre: m.event_id, date: m.event_date, heure: '', prix: 0 };
  const places = parseInt(m.places, 10) || 0;
  const paye = (s.amount_total || 0) / 100;
  const solde = Math.max(0, ev.prix * places - paye);
  const lignes = [
    ['Soirée', ev.titre], ['Date', `${L.dateFr(ev.date)}${ev.heure ? ', ' + ev.heure : ''}`], ['Places', String(places)],
    ['Acompte payé', L.euro(paye)], ['Solde à régler sur place', L.euro(solde)],
    m.plateaux ? ['Plateaux', m.plateaux] : null,
  ];

  await Promise.all([
    L.sendMail({
      to: m.email || s.customer_details?.email,
      subject: `Votre place est confirmée : ${ev.titre}`,
      replyTo: L.env('RESERVATION_EMAIL') || undefined,
      html: L.mailHtml({ titre: 'C\'est réservé !', intro: `Bonjour ${L.esc(m.nom || '')}, nous avons bien reçu votre acompte. Votre place est confirmée.`, lignes, fin: 'Le solde se règle sur place, le soir même. Pour toute question, répondez simplement à cet e-mail ou appelez-nous.' }),
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
