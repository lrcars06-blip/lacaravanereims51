// Liste publique des soirées de l'agenda, lue chaque jour par le Google Sheet (fonction majSoirees du script).
// places = places encore réservables en ligne (capacité moins les réservations prises hors site), ou la capacité si la soirée est complète.
const { SOIREES } = require('./_soirees');
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ soirees: SOIREES.map((s) => ({ id: s.id, titre: s.titre, date: s.date, places: s.complet && (s.reservees || 0) >= (s.places || 160) ? Math.min(s.places || 160, 160) : Math.max(0, Math.min(s.places || 160, 160) - (s.reservees || 0)) })) }));
};
