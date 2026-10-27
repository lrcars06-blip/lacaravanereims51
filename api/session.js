// Récapitulatif d'un paiement pour la page de remerciement (merci.html?type=soiree&session_id=...)
const L = require('./_lib');

module.exports = async (req, res) => {
  const id = String((req.query && req.query.session_id) || new URL(req.url, 'http://x').searchParams.get('session_id') || '');
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return L.json(res, 400, { ok: false });
  try {
    const s = await L.stripe('GET', '/checkout/sessions/' + id);
    const m = s.metadata || {};
    const ev = L.soiree(m.event_id) || {};
    const places = parseInt(m.places, 10) || 0;
    const paye = (s.amount_total || 0) / 100;
    return L.json(res, 200, {
      ok: true, paye: s.payment_status === 'paid',
      prenom: (m.nom || '').split(' ')[0], soiree: ev.titre || '', date: ev.date || m.event_date, heure: ev.heure || '',
      places, acompte: paye, solde: Math.max(0, L.totalResa(ev, m) - paye), plateaux: m.plateaux || '',
    });
  } catch (e) {
    console.error(e.message);
    return L.json(res, 502, { ok: false });
  }
};
