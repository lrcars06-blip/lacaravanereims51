// Rappel automatique la veille de la soirée, envoyé chaque matin par la tâche planifiée Vercel (vercel.json).
// Protégé par CRON_SECRET : Vercel envoie « Authorization: Bearer <CRON_SECRET> ».
const L = require('./_lib');

module.exports = async (req, res) => {
  const secret = L.env('CRON_SECRET');
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return L.json(res, 401, { ok: false });

  const demain = new Date(Date.now() + 24 * 3600 * 1000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }); // AAAA-MM-JJ
  let envoyes = 0, page;
  try {
    const annules = await L.sheetAnnules();
    do {
      const r = await L.stripe('GET', '/payment_intents/search', { query: `metadata['event_date']:'${demain}' AND status:'succeeded'`, limit: 100, page });
      for (const pi of r.data) {
        const m = pi.metadata || {};
        if (m.rappel === 'envoye' || annules.has(pi.id)) continue;
        const ev = L.soiree(m.event_id) || { titre: m.event_id, date: demain, heure: '', prix: 0 };
        const places = parseInt(m.places, 10) || 0;
        const solde = Math.max(0, ev.prix * places - pi.amount_received / 100);
        const ok = await L.sendMail({
          to: m.email,
          subject: `C'est demain : ${ev.titre}`,
          replyTo: L.env('RESERVATION_EMAIL') || undefined,
          html: L.mailHtml({ titre: 'On vous attend demain !', intro: `Bonjour ${L.esc((m.nom || '').split(' ')[0])}, petit rappel de votre réservation à La Caravane.`,
            lignes: [['Soirée', ev.titre], ['Date', `${L.dateFr(ev.date)}${ev.heure ? ', ' + ev.heure : ''}`], ['Places', String(places)], ['Solde à régler sur place', L.euro(solde)]],
            fin: 'Adresse : 17 rue des Docks Rémois, Bétheny. Parking gratuit sur place.' }),
        });
        if (ok.ok) { envoyes++; await L.stripe('POST', '/payment_intents/' + pi.id, { metadata: { rappel: 'envoye' } }); }
      }
      page = r.has_more ? r.next_page : undefined;
    } while (page);
    let sheet = null;
    try { sheet = await L.syncSheet(); } catch (e) { console.error('sync Sheet', e.message); }
    return L.json(res, 200, { ok: true, date: demain, envoyes, sheet });
  } catch (e) {
    console.error(e.message);
    return L.json(res, 502, { ok: false });
  }
};
