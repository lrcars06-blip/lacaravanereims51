// Paiement en ligne du solde (70 %) pour les soirées dont le solde se règle en ligne (api/_acomptes.js, champ « solde »).
// Lien privé : solde.html?s=<id soirée>&k=<clé>. Le client saisit l'e-mail utilisé pour son acompte.
//   GET  ?s=…&k=…                      → infos de la soirée
//   POST { s, k, email, action: 'apercu' } → acomptes trouvés et solde à payer
//   POST { s, k, email, action: 'payer' }  → paiement Stripe du solde (une ligne par acompte non soldé)
const L = require('./_lib');

async function acomptesClient(ev, email) {
  const annules = await L.sheetAnnules();
  const out = []; let page;
  do {
    const r = await L.stripe('GET', '/payment_intents/search', { query: `metadata['event_id']:'${ev.id}' AND status:'succeeded'`, limit: 100, page, expand: { 0: 'data.latest_charge' } });
    for (const pi of r.data) {
      const m = pi.metadata || {};
      if (String(m.email || '').trim().toLowerCase() !== email) continue;
      if (annules.has(pi.id) || (pi.latest_charge && pi.latest_charge.refunded)) continue;
      const acompte = (pi.amount_received || 0) / 100;
      out.push({ id: pi.id, nom: m.nom || '', places: parseInt(m.places, 10) || 0, enfants: parseInt(m.enfants, 10) || 0,
        total: L.totalResa(ev, m), acompte, solde: L.soldeRestant(ev, m, acompte), regle: !!m.solde_paye });
    }
    page = r.has_more ? r.next_page : undefined;
  } while (page);
  return out;
}

module.exports = async (req, res) => {
  const lire = (req.method === 'GET') ? new URL(req.url, 'http://x').searchParams : null;
  const b = lire ? { s: lire.get('s'), k: lire.get('k') } : await L.readJson(req);
  const ev = L.soiree(L.clean(b.s, 120)), lien = ev && L.lienAcompte(ev.id, b.k);
  if (!lien || !lien.solde) return L.json(res, 404, { ok: false, error: 'lien' });
  if (new Date(ev.date + 'T23:59:59') < new Date()) return L.json(res, 410, { ok: false, error: 'passee' });
  if (lire) return L.json(res, 200, { ok: true, titre: ev.titre, date: ev.date, heure: ev.heure, texte: lien.solde.texte });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return L.json(res, 405, { ok: false }); }
  if (b.botcheck) return L.json(res, 400, { ok: false });

  const email = L.clean(b.email, 200).toLowerCase();
  if (!L.isEmail(email)) return L.json(res, 400, { ok: false, error: 'email' });
  try {
    const liste = await acomptesClient(ev, email);
    if (!liste.length) return L.json(res, 404, { ok: false, error: 'introuvable' });
    const aPayer = liste.filter((a) => !a.regle && a.solde > 0);
    const total = Math.round(aPayer.reduce((t, a) => t + a.solde, 0) * 100) / 100;
    if (b.action !== 'payer') {
      return L.json(res, 200, { ok: true, solde: total, reservations: liste.map((a) => ({ nom: a.nom, places: a.places, enfants: a.enfants, total: a.total, acompte: a.acompte, solde: a.solde, regle: a.regle })) });
    }
    if (!aPayer.length) return L.json(res, 409, { ok: false, error: 'deja' });

    const site = L.siteUrl(req), nom = aPayer[0].nom;
    const lines = {};
    aPayer.forEach((a, i) => { lines[i] = { quantity: 1, price_data: { currency: 'eur', unit_amount: Math.round(a.solde * 100), product_data: { name: `Solde (70 %) : ${ev.titre}`, description: `Réservation de ${a.nom}, ${a.places} place${a.places > 1 ? 's' : ''}. Total ${L.euro(a.total)}, acompte déjà payé ${L.euro(a.acompte)}.` } } }; });
    const meta = { type: 'solde', solde_event: ev.id, acomptes: aPayer.map((a) => a.id).join(','), email, nom: nom.slice(0, 120) };
    const session = await L.stripe('POST', '/checkout/sessions', {
      mode: 'payment', locale: 'fr', customer_email: email,
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      line_items: lines, metadata: meta,
      payment_intent_data: { metadata: meta, description: `Solde ${ev.titre} (${ev.date}) : ${nom}` },
      invoice_creation: { enabled: true, invoice_data: {
        description: `Facture de solde (70 %) : ${ev.titre}, ${L.dateFr(ev.date)}`,
        footer: `Solde réglé : ${L.euro(total)}. Votre réservation est entièrement payée.`,
        metadata: { solde_event: ev.id },
      } },
      success_url: `${site}/merci.html?type=solde&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/solde.html?s=${encodeURIComponent(ev.id)}&k=${encodeURIComponent(b.k)}`,
    });
    return L.json(res, 200, { ok: true, url: session.url });
  } catch (e) {
    console.error(e.message);
    return L.json(res, 502, { ok: false });
  }
};
