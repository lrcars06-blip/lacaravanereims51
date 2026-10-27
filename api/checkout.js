// Crée le paiement Stripe de l'acompte (30 %) pour une soirée repas.
// - Réservation sur le site : vérifie les places restantes.
// - Lien privé d'acompte (acompte.html?s=…&k=…) pour les clients ayant déjà réservé par téléphone :
//   pas de contrôle de places (déjà comptées), adultes + enfants. GET ?s=…&k=… renvoie les infos de la soirée.
const L = require('./_lib');

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const q = new URL(req.url, 'http://x').searchParams;
    const ev = L.soiree(L.clean(q.get('s'), 120)), lien = ev && L.lienAcompte(ev.id, q.get('k'));
    if (!lien || ev.type !== 'repas') return L.json(res, 404, { ok: false });
    if (new Date(ev.date + 'T23:59:59') < new Date()) return L.json(res, 410, { ok: false, error: 'passee' });
    return L.json(res, 200, { ok: true, titre: ev.titre, date: ev.date, heure: ev.heure, prix: ev.prix, prixEnfant: lien.prixEnfant, enfantTexte: lien.enfantTexte, depot: L.DEPOSIT });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return L.json(res, 405, { ok: false }); }
  const b = await L.readJson(req);
  if (b.botcheck) return L.json(res, 400, { ok: false });

  const ev = L.soiree(L.clean(b.soiree, 120));
  const lien = ev && L.lienAcompte(ev.id, b.cle);
  const adultes = parseInt(b.invites, 10);
  const enfants = lien ? Math.max(0, parseInt(b.enfants, 10) || 0) : 0;
  const places = adultes + enfants;
  const email = L.clean(b.email, 200), nom = L.clean(b.nom, 120), tel = L.clean(b.telephone, 40);
  if (!ev || ev.type !== 'repas') return L.json(res, 400, { ok: false, error: 'soiree' });
  if (!(adultes >= (lien && enfants ? 0 : 1) && adultes <= 20 && enfants <= 20 && places >= 1)) return L.json(res, 400, { ok: false, error: 'places' });
  if (!nom || !L.isEmail(email) || tel.replace(/\D/g, '').length < 9) return L.json(res, 400, { ok: false, error: 'coordonnees' });
  if (new Date(ev.date + 'T23:59:59') < new Date()) return L.json(res, 400, { ok: false, error: 'passee' });

  try {
    if (!lien) {
      if (ev.complet) return L.json(res, 409, { ok: false, error: 'complet', restant: 0 });
      const counts = await L.sheetCounts();
      const vendues = counts ? (counts[ev.id] || 0) : await L.placesVendues(ev.id);
      const restant = Math.max(0, ev.places - ev.reservees - vendues);
      if (places > restant) return L.json(res, 409, { ok: false, error: 'complet', restant });
    }

    const unit = Math.round(ev.prix * L.DEPOSIT * 100); // en centimes
    const unitEnfant = lien ? Math.round(lien.prixEnfant * L.DEPOSIT * 100) : 0;
    const total = adultes * ev.prix + enfants * (lien ? lien.prixEnfant : 0);
    const acompte = (adultes * unit + enfants * unitEnfant) / 100;
    const site = L.siteUrl(req);
    const meta = {
      event_id: ev.id, event_date: ev.date, places: String(places), nom, email, telephone: tel,
      occasion: L.clean(b.occasion, 80), plateaux: L.clean(b.plateaux, 400), precisions: L.clean(b.precisions, 450),
      total: String(total), enfants: enfants ? String(enfants) : undefined, origine: lien ? 'telephone' : 'site',
    };
    const desc = `${L.dateFr(ev.date)}, ${ev.heure}. Solde réglé sur place.`;
    const lines = {};
    if (adultes) lines[0] = { quantity: adultes, price_data: { currency: 'eur', unit_amount: unit, product_data: { name: `Acompte 30 % : ${ev.titre}${enfants ? ' (adulte)' : ''}`, description: desc } } };
    if (enfants) lines[adultes ? 1 : 0] = { quantity: enfants, price_data: { currency: 'eur', unit_amount: unitEnfant, product_data: { name: `Acompte 30 % : ${ev.titre} (enfant)`, description: desc } } };

    const session = await L.stripe('POST', '/checkout/sessions', {
      mode: 'payment',
      locale: 'fr',
      customer_email: email,
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60, // 31 min : la place n'est pas bloquée plus longtemps
      line_items: lines,
      metadata: meta,
      payment_intent_data: { metadata: meta, description: `Acompte ${ev.titre} (${ev.date}) x${places}` },
      // Facture d'acompte générée par Stripe et envoyée au client avec son reçu
      invoice_creation: { enabled: true, invoice_data: {
        description: `Facture d'acompte (30 %) : ${ev.titre}, ${L.dateFr(ev.date)}, ${places} place${places > 1 ? 's' : ''}${enfants ? ` dont ${enfants} enfant${enfants > 1 ? 's' : ''}` : ''}`,
        footer: `Acompte de 30 % sur un total de ${L.euro(total)} TTC. Solde de ${L.euro(total - acompte)} à régler sur place le soir de la soirée.`,
        metadata: { event_id: ev.id, places: String(places) },
      } },
      success_url: `${site}/merci.html?type=soiree&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: lien ? `${site}/acompte.html?s=${encodeURIComponent(ev.id)}&k=${encodeURIComponent(b.cle)}` : `${site}/#agenda`,
    });
    return L.json(res, 200, { ok: true, url: session.url });
  } catch (e) {
    console.error(e.message);
    return L.json(res, 502, { ok: false });
  }
};
