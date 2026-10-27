// Liste publique des soirées de l'agenda, lue chaque jour par le Google Sheet (fonction majSoirees du script).
const { SOIREES } = require('./_soirees');
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ soirees: SOIREES.map((s) => ({ id: s.id, titre: s.titre, date: s.date, places: Math.min(s.places || 160, 160) })) }));
};
