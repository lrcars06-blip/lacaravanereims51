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
    if (d.action === 'rembourse') return json({ ok: true, lignes: rembourse(d.ref, d.total, d.montant) });
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

// Recopie dans l'onglet Soirees toutes les soirées de l'agenda du site (lacaravanereims.com/api/soirees).
// Tourne seul chaque matin (déclencheur créé au premier lancement) : une soirée ajoutée sur le site apparaît ici le lendemain au plus tard.
const SITE = 'https://lacaravanereims.com';
function majSoirees() {
  const r = UrlFetchApp.fetch(SITE + '/api/soirees?v=' + Date.now(), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) { Logger.log('Site injoignable : ' + r.getResponseCode()); return 0; }
  const avant = SpreadsheetApp.getActive().getSheetByName('Soirees').getRange(2, 1, 199, 1).getValues().flat().filter(String).length;
  JSON.parse(r.getContentText()).soirees.forEach((x) => ajouterSoiree(x.id, x.places, x.titre));
  const apres = SpreadsheetApp.getActive().getSheetByName('Soirees').getRange(2, 1, 199, 1).getValues().flat().filter(String).length;
  if (!ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'majSoirees')) {
    ScriptApp.newTrigger('majSoirees').timeBased().everyDays(1).atHour(6).create();
  }
  Logger.log((apres - avant) + ' soirée(s) ajoutée(s)');
  return apres - avant;
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

// Remboursement Stripe : total → statut « annulé » ; partiel → mention dans la colonne Paiement.
function rembourse(ref, total, montant) {
  if (!ref) return 0;
  const f = feuille(), vals = f.getRange(2, 1, Math.max(1, f.getLastRow() - 1), 9).getValues();
  let n = 0;
  vals.forEach((r, i) => {
    if (String(r[8]) !== String(ref)) return;
    const note = (total ? 'Remboursé' : 'Remboursé en partie') + (montant ? ' ' + montant + ' €' : '') + ' le ' + Utilities.formatDate(new Date(), 'Europe/Paris', 'dd/MM');
    if (total) f.getRange(i + 2, 7).setValue('annulé');
    const p = String(r[7] || '');
    if (p.indexOf(note) < 0) f.getRange(i + 2, 8).setValue(p ? p + ' · ' + note : note);
    n++;
  });
  return n;
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

// ===== Mise en forme (à relancer sans risque) : onglet « Par soirée », couleurs, filtres =====
function miseEnForme() {
  const ss = SpreadsheetApp.getActive(), r = feuille(), s = ss.getSheetByName('Soirees');
  const NOIR = '#1D1338', CREME = '#FFF7E8', OR = '#FFC83D';

  // 1. Soirées de l'agenda présentes dans l'onglet Soirees (lues sur le site, voir majSoirees)
  majSoirees();
  s.getRange('F1:G1').setValues([['soirée (date · titre)', 'date']]);
  const fF = [], fG = [];
  for (let i = 2; i <= 200; i++) {
    const d = 'RIGHT(A' + i + ';10)';
    fG.push(['=IF(A' + i + '="";"";DATE(VALUE(LEFT(' + d + ';4));VALUE(MID(' + d + ';6;2));VALUE(RIGHT(' + d + ';2))))']);
    fF.push(['=IF(A' + i + '="";"";PROPER(TEXT(G' + i + ';"ddd dd/mm"))&" · "&IF(E' + i + '="";A' + i + ';E' + i + '))']);
  }
  s.getRange(2, 7, 199, 1).setFormulas(fG).setNumberFormat('dd/mm/yyyy');
  s.getRange(2, 6, 199, 1).setFormulas(fF);
  s.getRange('A1:G1').setFontWeight('bold').setBackground(NOIR).setFontColor(CREME);
  s.setColumnWidth(5, 220); s.setColumnWidth(6, 260);
  s.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($A2<>"";$D2<=0)').setBackground('#FFD6D1').setFontColor('#7A1F16').setRanges([s.getRange('A2:G200')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($A2<>"";$D2<=20)').setBackground('#FFF1C9').setRanges([s.getRange('A2:G200')]).build(),
  ]);

  // 2. Onglet Reservations : couleurs par statut, filtre, largeurs
  r.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$G2="annulé"').setFontColor('#9A93A8').setStrikethrough(true).setRanges([r.getRange('A2:I1000')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$G2="attente"').setBackground('#FFF1C9').setRanges([r.getRange('A2:I1000')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('confirmé').setBackground('#DDF5CF').setFontColor('#24601A').setBold(true).setRanges([r.getRange('G2:G1000')]).build(),
  ]);
  if (!r.getFilter()) r.getRange('A1:I1000').createFilter();
  [140, 190, 170, 220, 120, 90, 100, 260, 200].forEach((w, i) => r.setColumnWidth(i + 1, w));

  // 3. Onglet « Par soirée »
  const v = ss.getSheetByName('Par soirée') || ss.insertSheet('Par soirée', 0);
  v.clear(); v.clearConditionalFormatRules(); v.getRange('A1:Z1000').clearDataValidations();
  v.setHiddenGridlines(true);
  v.getRange('A1:H1000').setFontFamily('Arial').setFontSize(11).setFontColor(NOIR).setVerticalAlignment('middle');
  v.getRange('A1').setValue('Réservations par soirée').setFontSize(20).setFontWeight('bold');
  v.getRange('A2').setValue('Choisissez la soirée dans la case jaune. La liste se met à jour toute seule.').setFontColor('#5B4F78').setFontSize(10);

  // Liste des soirées triée par date (colonne Z cachée) + identifiant de la soirée choisie (Z1)
  v.getRange('Z2').setFormula('=IFERROR(SORT(FILTER(Soirees!F2:F200;Soirees!A2:A200<>"");FILTER(Soirees!G2:G200;Soirees!A2:A200<>"");TRUE);"")');
  v.getRange('Z1').setFormula('=IFERROR(INDEX(Soirees!A2:A200;MATCH(B4;Soirees!F2:F200;0));"")');
  v.hideColumns(26);

  v.getRange('A4').setValue('Soirée').setFontWeight('bold');
  v.getRange('B4:D4').merge().setBackground('#FFF1C9').setFontWeight('bold').setFontSize(13)
    .setBorder(true, true, true, true, false, false, OR, SpreadsheetApp.BorderStyle.SOLID_MEDIUM)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(v.getRange('Z2:Z200'), true).setAllowInvalid(false).build());
  v.getRange('F4').insertCheckboxes(); v.getRange('G4').setValue('Afficher aussi les annulées').setFontColor('#5B4F78');

  // Chiffres clés
  const cartes = [['Réservations', '=IF($Z$1="";"";COUNTIFS(Reservations!B:B;$Z$1;Reservations!G:G;"confirmé"))'],
    ['Personnes', '=IF($Z$1="";"";SUMIFS(Reservations!F:F;Reservations!B:B;$Z$1;Reservations!G:G;"confirmé"))'],
    ['Places restantes', '=IF($Z$1="";"";IFERROR(INDEX(Soirees!D2:D200;MATCH($Z$1;Soirees!A2:A200;0));""))'],
    ['Liste d\'attente', '=IF($Z$1="";"";SUMIFS(Reservations!F:F;Reservations!B:B;$Z$1;Reservations!G:G;"attente"))']];
  cartes.forEach((c, i) => {
    const col = 1 + i * 2;
    v.getRange(6, col, 1, 2).merge().setValue(c[0]).setFontColor('#5B4F78').setFontSize(10).setBackground(CREME).setHorizontalAlignment('center');
    v.getRange(7, col, 1, 2).merge().setFormula(c[1]).setFontSize(22).setFontWeight('bold').setBackground(CREME).setHorizontalAlignment('center');
  });

  // Tableau des réservations de la soirée choisie
  v.getRange('A9:G9').setValues([['Date', 'Nom', 'Téléphone', 'E-mail', 'Personnes', 'Statut', 'Paiement']])
    .setFontWeight('bold').setBackground(NOIR).setFontColor(CREME);
  v.getRange('A10').setFormula('=IF($Z$1="";"";IFERROR(SORT(CHOOSECOLS(FILTER(Reservations!A2:H;Reservations!B2:B=$Z$1;(Reservations!G2:G<>"annulé")+($F$4=TRUE));1;3;5;4;6;7;8);1;TRUE);"Aucune réservation pour cette soirée"))');
  v.getRange('A10:A500').setNumberFormat('dd/mm hh:mm');
  v.getRange('C10:C500').setNumberFormat('@');
  v.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$F10="annulé"').setFontColor('#9A93A8').setStrikethrough(true).setRanges([v.getRange('A10:G500')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$F10="attente"').setBackground('#FFF1C9').setRanges([v.getRange('A10:G500')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($A10<>"";ISEVEN(ROW()))').setBackground('#F6EEDC').setRanges([v.getRange('A10:G500')]).build(),
  ]);
  [120, 200, 130, 230, 95, 95, 300].forEach((w, i) => v.setColumnWidth(i + 1, w));
  v.setRowHeight(4, 34); v.setRowHeight(7, 44); v.setFrozenRows(9);

  // Soirée sélectionnée par défaut : la prochaine à venir
  SpreadsheetApp.flush();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const lignes = s.getRange(2, 1, 199, 7).getValues().filter((x) => x[0] && x[6] instanceof Date && x[6] >= today).sort((a, b) => a[6] - b[6]);
  if (lignes.length && !v.getRange('B4').getValue()) v.getRange('B4').setValue(lignes[0][5]);
  ss.setActiveSheet(v); ss.moveActiveSheet(1);
  Logger.log('Mise en forme OK');
}
