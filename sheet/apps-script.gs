// ===== La Caravane – Réservations (Google Apps Script lié au Sheet « Réservations La Caravane ») =====
// Copie de référence du script déployé dans le Sheet (Extensions > Apps Script).
// Le site (api/_lib.js) écrit ici chaque réservation ; Vincent annule en passant la colonne Statut à « annulé ».
const P = PropertiesService.getScriptProperties();
const STATUTS = ['confirmé', 'attente', 'annulé'];

// À relancer après chaque modification de ce fichier : onglets, en-têtes, formules, secret.
function installation() {
  const ss = SpreadsheetApp.getActive();
  ss.rename('Réservations La Caravane');

  const r = ss.getSheetByName('Reservations') || ss.getSheets()[0];
  r.setName('Reservations');
  r.getRange(1, 1, 1, 9).setValues([['Date', 'Soirée', 'Nom', 'Email', 'Téléphone', 'Personnes', 'Statut', 'Paiement', 'Réf Stripe']])
    .setFontWeight('bold').setBackground('#1f1f1f').setFontColor('#ffffff');
  r.setFrozenRows(1);
  r.getRange('G2:G').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUTS, true).build());
  r.getRange('A2:A').setNumberFormat('dd/mm/yyyy hh:mm');
  r.getRange('E2:E').setNumberFormat('@');

  const s = ss.getSheetByName('Soirees') || ss.insertSheet('Soirees');
  s.getRange(1, 1, 1, 5).setValues([['id', 'capacite', 'réservées', 'restantes', 'titre']])
    .setFontWeight('bold').setBackground('#1f1f1f').setFontColor('#ffffff');
  s.setFrozenRows(1);
  const fC = [], fD = [];
  for (let i = 2; i <= 200; i++) {
    fC.push(['=IF(A' + i + '="";"";SUMIFS(Reservations!F:F;Reservations!B:B;A' + i + ';Reservations!G:G;"confirmé"))']);
    fD.push(['=IF(A' + i + '="";"";B' + i + '-C' + i + ')']);
  }
  s.getRange(2, 3, 199, 1).setFormulas(fC);
  s.getRange(2, 4, 199, 1).setFormulas(fD);

  // Nettoyage des lignes de test de l'installation
  for (let i = s.getLastRow(); i >= 2; i--) {
    const id = s.getRange(i, 1).getValue();
    if (id === 'test' || id === 'nouvel-an-2026') s.getRange(i, 1, 1, 2).clearContent();
  }
  for (let i = r.getLastRow(); i >= 2; i--) if (r.getRange(i, 2).getValue() === 'test') r.deleteRow(i);

  if (!P.getProperty('SECRET')) P.setProperty('SECRET', Utilities.getUuid());
  Logger.log('Installation OK');
}

// Lecture publique : nombre de personnes confirmées par soirée (pour la jauge du site).
function doGet(e) {
  const p = (e && e.parameter) || {};
  const counts = compter();
  if (p.all) return json({ counts });
  return json({ event: p.event, reservees: counts[p.event] || 0, restantes: restantes(p.event, counts) });
}

// Écriture : réservée au serveur du site (secret partagé SHEET_SECRET).
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const d = JSON.parse(e.postData.contents);
    if (!d.secret || d.secret !== P.getProperty('SECRET')) return json({ ok: false, error: 'interdit' });
    if (d.action === 'annules') return json({ ok: true, refs: annules() });
    if (d.action === 'liste') return json({ ok: true, lignes: liste(d.event) });
    const lignes = d.action === 'lot' ? (d.lignes || []) : [d];
    let ajoutees = 0;
    const refs = new Set(feuille().getRange('I:I').getValues().flat().filter(String));
    for (const l of lignes) if (enregistrer(l, refs)) ajoutees++;
    return json({ ok: true, ajoutees });
  } finally {
    lock.releaseLock();
  }
}

function enregistrer(d, refs) {
  if (!d.event) return false;
  if (d.ref && refs.has(d.ref)) return false;
  const statut = STATUTS.includes(d.statut) ? d.statut : 'confirmé';
  feuille().appendRow([d.date ? new Date(d.date) : new Date(), d.event, d.nom || '', d.email || '', d.tel ? "'" + String(d.tel) : '',
    parseInt(d.personnes, 10) || 0, statut, d.paiement || '', d.ref || '']);
  if (d.ref) refs.add(d.ref);
  ajouterSoiree(d.event, d.capacite, d.titre);
  return true;
}

// Ajoute la soirée dans l'onglet Soirees si elle n'y est pas encore.
function ajouterSoiree(id, capacite, titre) {
  const s = SpreadsheetApp.getActive().getSheetByName('Soirees');
  const ids = s.getRange(2, 1, 199, 1).getValues().flat();
  if (ids.includes(id)) return;
  const libre = ids.indexOf('');
  if (libre < 0) return;
  s.getRange(libre + 2, 1, 1, 2).setValues([[id, parseInt(capacite, 10) || 160]]);
  if (titre) s.getRange(libre + 2, 5).setValue(titre);
}

function compter() {
  const out = {};
  feuille().getDataRange().getValues().slice(1).forEach((r) => {
    if (r[1] && r[6] === 'confirmé') out[r[1]] = (out[r[1]] || 0) + (Number(r[5]) || 0);
  });
  return out;
}

function restantes(event, counts) {
  const s = SpreadsheetApp.getActive().getSheetByName('Soirees').getDataRange().getValues().find((r) => r[0] === event);
  if (!s) return null;
  return Math.max(0, s[1] - ((counts || compter())[event] || 0));
}

function annules() {
  return feuille().getDataRange().getValues().slice(1).filter((r) => r[6] === 'annulé' && r[8]).map((r) => String(r[8]));
}

// Lignes d'une soirée (hors annulées), pour le compte rendu de la veille.
function liste(event) {
  return feuille().getDataRange().getValues().slice(1).filter((r) => r[1] === event && r[6] !== 'annulé').map((r) => ({
    date: r[0] instanceof Date ? r[0].toISOString() : String(r[0] || ''), nom: String(r[2] || ''), email: String(r[3] || ''),
    tel: String(r[4] || ''), personnes: Number(r[5]) || 0, statut: String(r[6] || ''), paiement: String(r[7] || ''), ref: String(r[8] || ''),
  }));
}

function feuille() { return SpreadsheetApp.getActive().getSheetByName('Reservations'); }
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
