// Crée le paiement Stripe de l'acompte (30 %) pour une soirée repas, après vérification des places restantes.
const L = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return L.json(res, 405, { ok: false }); }
  const b = await L.readJson(req);
  if (b.botcheck) return L.json(res, 400, { ok: false });

  const ev = L.soiree(L.clean(b.soiree, 120));
  const places = parseInt(b.invites, 10);
  const email = L.clean(b.email, 200), nom = L.clean(b.nom, 120), tel = L.clean(b.telephone, 40);
  if (!ev || ev.type !== 'repas') return L.json(res, 400, { ok: false, error: 'soiree' });
  if (!(places >= 1 && places <= 20)) return L.json(res, 400, { ok: false, error: 'places' });
  if (!nom || !L.isEmail(email) || tel.replace(/\D/g, '').length < 9) return L.json(res, 400, { ok: false, error: 'coordonnees' });
  if (new Date(ev.date + 'T23:59:59') < new Date()) return L.json(res, 400, { ok: false, error: 'passee' });

  try {
    if (ev.complet) return L.json(res, 409, { ok: false, error: 'complet', restant: 0 });
    const vendues = await L.placesVendues(ev.id);
    const restant = Math.max(0, ev.places - ev.reservees - vendues);
    if (places > restant) return L.json(res, 409, { ok: false, error: 'complet', restant });

    const unit = Math.round(ev.prix * L.DEPOSIT * 100); // en centimes
    const site = L.siteUrl(req);
    const meta = {
      event_id: ev.id, event_date: ev.date, places: String(places), nom, email, telephone: tel,
      occasion: L.clean(b.occasion, 80), plateaux: L.clean(b.plateaux, 400), precisions: L.clean(b.precisions, 450),
    };
    const session = await L.stripe('POST', '/checkout/sessions', {
      mode: 'payment',
      locale: 'fr',
      customer_email: email,
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60, // 31 min : la place n'est pas bloquée plus longtemps
      line_items: { 0: { quantity: places, price_data: { currency: 'eur', unit_amount: unit, product_data: { name: `Acompte 30 % : ${ev.titre}`, description: `${L.dateFr(ev.date)}, ${ev.heure}. Solde réglé sur place.` } } } },
      metadata: meta,
      payment_intent_data: { metadata: meta, description: `Acompte ${ev.titre} (${ev.date}) x${places}` },
      success_url: `${site}/merci.html?type=soiree&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/#agenda`,
    });
    return L.json(res, 200, { ok: true, url: session.url });
  } catch (e) {
    console.error(e.message);
    return L.json(res, 502, { ok: false });
  }
};
