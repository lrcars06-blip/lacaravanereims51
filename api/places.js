// Places déjà réservées en ligne pour chaque soirée à venir : { "id-soiree": nombre }
// Source : le Google Sheet (pass + acomptes, annulations déduites). Repli sur Stripe (acomptes seuls) si le Sheet est inactif.
const L = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const avenir = L.SOIREES.filter((x) => x.date >= today);
  const out = {};
  try {
    const counts = await L.sheetCounts();
    if (counts) {
      for (const s of avenir) if (counts[s.id]) out[s.id] = counts[s.id];
      return L.json(res, 200, out);
    }
    if (!L.env('STRIPE_SECRET_KEY')) return L.json(res, 200, out);
    for (const s of avenir.filter((x) => x.type === 'repas')) out[s.id] = await L.placesVendues(s.id);
    return L.json(res, 200, out);
  } catch (e) {
    console.error(e.message);
    return L.json(res, 200, out);
  }
};
