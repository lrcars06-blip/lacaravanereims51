// Places déjà payées en ligne pour chaque soirée repas à venir : { "id-soiree": nombre }
const L = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
  if (!L.env('STRIPE_SECRET_KEY')) return L.json(res, 200, {});
  const today = new Date().toISOString().slice(0, 10);
  const out = {};
  try {
    for (const s of L.SOIREES.filter((x) => x.type === 'repas' && x.date >= today)) out[s.id] = await L.placesVendues(s.id);
    return L.json(res, 200, out);
  } catch (e) {
    console.error(e.message);
    return L.json(res, 200, out);
  }
};
