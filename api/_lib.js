// Outils partagés par les fonctions serveur (les fichiers commençant par « _ » ne sont pas des routes).
const crypto = require('crypto');
const { SOIREES, DEPOSIT } = require('./_soirees');

const env = (k) => process.env[k] || '';
const clean = (v, n = 300) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n);
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const euro = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
const dateFr = (d) => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const soiree = (id) => SOIREES.find((s) => s.id === id);
const ACOMPTES = require('./_acomptes');
/* Lien privé d'acompte valide pour cette soirée ? (clients ayant réservé par téléphone) */
const lienAcompte = (id, cle) => { const a = ACOMPTES[id]; return a && cle && String(cle) === a.cle ? a : null; };
/* Prix total TTC d'une réservation : métadonnée « total » si présente (adultes + enfants), sinon prix adulte × places. */
const totalResa = (ev, m) => (m && m.total ? Number(m.total) : (ev.prix || 0) * (parseInt(m && m.places, 10) || 0));
const siteUrl = (req) => (env('SITE_URL') || `https://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/$/, '');

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const raw = await readRaw(req);
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}
function readRaw(req) {
  return new Promise((ok, ko) => { let d = ''; req.setEncoding('utf8'); req.on('data', (c) => { d += c; }); req.on('end', () => ok(d)); req.on('error', ko); });
}

/* ---------- Stripe (API REST, sans dépendance) ---------- */
function form(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.join('&');
}
async function stripe(method, path, params) {
  const key = env('STRIPE_SECRET_KEY');
  if (!key) throw new Error('STRIPE_SECRET_KEY manquante');
  const url = 'https://api.stripe.com/v1' + path + (method === 'GET' && params ? '?' + form(params) : '');
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' },
    body: method === 'GET' ? undefined : form(params || {}),
  });
  const j = await r.json();
  if (!r.ok) { const e = new Error('Stripe ' + r.status + ' ' + (j.error && j.error.message)); e.stripe = j; throw e; }
  return j;
}
/* Places déjà payées pour une soirée : somme des acomptes réussis (métadonnée « places »). */
async function placesVendues(eventId) {
  let total = 0, page;
  do {
    const res = await stripe('GET', '/payment_intents/search', { query: `metadata['event_id']:'${eventId}' AND status:'succeeded'`, limit: 100, page });
    for (const pi of res.data) total += parseInt(pi.metadata.places, 10) || 0;
    page = res.has_more ? res.next_page : undefined;
  } while (page);
  return total;
}
/* Vérification de la signature d'un webhook Stripe (en-tête Stripe-Signature). */
function verifStripe(raw, header, secret, tolerance = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v]));
  const sigs = header.split(',').filter((p) => p.trim().startsWith('v1=')).map((p) => p.trim().slice(3));
  const t = parseInt(parts.t, 10);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > tolerance) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`, 'utf8').digest('hex');
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

/* ---------- Resend ---------- */
async function sendMail({ to, subject, html, text, replyTo }) {
  const key = env('RESEND_API_KEY');
  if (!key || !to) return { ok: false, skipped: true };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('RESEND_FROM') || 'La Caravane <onboarding@resend.dev>', to: Array.isArray(to) ? to : [to], subject, html, text, reply_to: replyTo }),
  });
  if (!r.ok) console.error('Resend', r.status, await r.text());
  return { ok: r.ok };
}
/* Gabarit d'e-mail aux couleurs du site */
function mailHtml({ titre, intro, lignes = [], fin = '', bloc = '' }) {
  const rows = lignes.filter(Boolean).map(([k, v]) => `<tr><td style="padding:8px 0;color:#5B4F78;width:40%">${esc(k)}</td><td style="padding:8px 0;font-weight:600;color:#1D1338">${esc(v)}</td></tr>`).join('');
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#17123A;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#17123A;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFF7E8;border-radius:18px;overflow:hidden">
<tr><td style="background:#17123A;padding:22px 28px;color:#FAEBD3;font-size:22px;font-family:Georgia,serif">La Caravane <span style="color:#FFC83D">·</span> Bétheny</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:26px;color:#1D1338">${esc(titre)}</h1>
<p style="margin:0 0 18px;color:#1D1338;font-size:16px;line-height:1.55">${intro}</p>
${rows ? `<table role="presentation" width="100%" style="border-top:1px dashed #d8cdb6;border-bottom:1px dashed #d8cdb6;margin:0 0 18px;font-size:15px">${rows}</table>` : ''}
${bloc}
${fin ? `<p style="margin:0 0 6px;color:#1D1338;font-size:15px;line-height:1.55">${fin}</p>` : ''}
<p style="margin:18px 0 0;color:#5B4F78;font-size:14px">17 rue des Docks Rémois, 51450 Bétheny<br>03 26 07 59 10</p>
</td></tr></table></td></tr></table></body></html>`;
}

function json(res, code, obj) { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); }

/* ---------- Google Sheet « Réservations La Caravane » (Apps Script, voir sheet/apps-script.gs) ----------
   Le site y inscrit chaque réservation (pass, liste d'attente, acompte payé). Vincent annule une ligne en
   passant son Statut à « annulé » : la place se libère sur le site et disparaît du compte rendu.
   Inactif tant que SHEET_SECRET n'est pas défini dans Vercel (le site retombe alors sur Stripe seul). */
const SHEET_URL = () => env('SHEET_API_URL') || 'https://script.google.com/macros/s/AKfycbwcN1Cavshg_1aNnyMN6mfHwTdz0AfQC-LhZhYRaHskCsXweGHav7Fevff3aK57tOY3/exec';
const sheetOn = () => !!env('SHEET_SECRET');
/* Tolère un collage imparfait dans Vercel (espaces, guillemets, « SECRET = … ») : on garde l'identifiant. */
const sheetSecret = () => { const v = env('SHEET_SECRET'); const m = v.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i); return m ? m[0].toLowerCase() : v.trim(); };
async function sheetPost(payload) {
  if (!sheetOn()) return null;
  try {
    const r = await fetch(SHEET_URL(), {
      method: 'POST', redirect: 'follow', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...payload, secret: sheetSecret() }),
    });
    const j = await r.json();
    if (!j.ok) console.error('Sheet', j.error);
    return j;
  } catch (e) { console.error('Sheet', e.message); return null; }
}
/* Personnes confirmées par soirée d'après le Sheet : { id: nombre }, ou null si le Sheet est inactif ou injoignable. */
async function sheetCounts() {
  if (!sheetOn()) return null;
  try {
    const r = await fetch(SHEET_URL() + '?all=1', { redirect: 'follow', signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    return j && j.counts ? j.counts : null;
  } catch (e) { console.error('Sheet', e.message); return null; }
}
/* Lignes du Sheet pour une soirée (hors annulées), ou [] si le Sheet est inactif. */
async function sheetListe(eventId) {
  const j = await sheetPost({ action: 'liste', event: eventId });
  return (j && j.lignes) || [];
}
/* Références Stripe des réservations annulées dans le Sheet. */
async function sheetAnnules() {
  const j = await sheetPost({ action: 'annules' });
  return new Set((j && j.refs) || []);
}
/* Ligne de Sheet à partir d'un acompte Stripe (PaymentIntent) ou d'une réservation sans paiement (client Stripe). */
function ligneAcompte(pi) {
  const m = pi.metadata || {}, ev = soiree(m.event_id) || { titre: m.event_id, prix: 0, places: 160 };
  const pers = parseInt(m.places, 10) || 0, paye = (pi.amount_received || pi.amount || 0) / 100;
  return { event: m.event_id, titre: ev.titre, capacite: ev.places, nom: m.nom, email: m.email, tel: m.telephone, personnes: pers,
    statut: 'confirmé', paiement: `Acompte ${euro(paye)} · solde ${euro(Math.max(0, totalResa(ev, m) - paye))}${m.enfants ? ` (dont ${m.enfants} enfant${m.enfants > 1 ? 's' : ''})` : ''}`, ref: pi.id,
    date: pi.created ? new Date(pi.created * 1000).toISOString() : undefined };
}
function ligneResa(c) {
  const m = c.metadata || {}, ev = soiree(m.event_id) || { titre: m.event_id, prix: 0, places: 160 };
  const pers = parseInt(m.places, 10) || 0, attente = m.formule === 'attente';
  return { event: m.event_id, titre: ev.titre, capacite: ev.places, nom: c.name, email: c.email, tel: m.telephone || c.phone, personnes: pers,
    statut: attente ? 'attente' : 'confirmé', paiement: attente ? 'Liste d\'attente' : m.formule === 'surplace' ? `Repas réglé sur place (${euro(pers * ev.prix)})` : `Pass sur place (${euro(pers * ev.prix)})`, ref: c.id,
    date: c.created ? new Date(c.created * 1000).toISOString() : undefined };
}
/* Rattrapage : renvoie au Sheet toutes les réservations Stripe des soirées à venir (sans doublon, le Sheet dédoublonne par réf). */
async function syncSheet() {
  if (!sheetOn() || !env('STRIPE_SECRET_KEY')) return { skipped: true };
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const lignes = [];
  for (const s of SOIREES.filter((x) => x.date >= today)) {
    if (s.type === 'repas') (await acomptesSoiree(s.id)).forEach((pi) => lignes.push(ligneAcompte(pi)));
    else (await resasSoiree(s.id)).forEach((c) => lignes.push(ligneResa(c)));
  }
  if (!lignes.length) return { ok: true, ajoutees: 0 };
  return sheetPost({ action: 'lot', lignes });
}

/* Réservations sans paiement (pass soirée, liste d'attente) : enregistrées comme clients Stripe
   avec la métadonnée kind = « resa », pour le compte rendu de soirée. */
async function enregistrerResa(meta, { nom, email, telephone }) {
  if (!env('STRIPE_SECRET_KEY')) return;
  const md = {};
  for (const [k, v] of Object.entries(meta)) if (v !== undefined && v !== null && v !== '') md[k] = String(v).slice(0, 490);
  return stripe('POST', '/customers', { name: nom, email, phone: telephone, description: `Réservation ${meta.formule} ${meta.event_id}`, metadata: { kind: 'resa', ...md } });
}
/* Réservations de test (clients Stripe) ignorées partout : Sheet, rattrapage, compte rendu. */
const TESTS = new Set(['cus_VVpISzmFxpt5wq', 'cus_VVpHHdWdFTDFTY', 'cus_VVpDi6ikNzOA79', 'cus_VVleaIZQTqWsSf']);
async function resasSoiree(eventId) {
  const out = []; let page;
  do {
    const r = await stripe('GET', '/customers/search', { query: `metadata['kind']:'resa' AND metadata['event_id']:'${eventId}'`, limit: 100, page });
    out.push(...r.data.filter((c) => !TESTS.has(c.id)));
    page = r.has_more ? r.next_page : undefined;
  } while (page);
  return out;
}
async function acomptesSoiree(eventId) {
  const out = []; let page;
  do {
    const r = await stripe('GET', '/payment_intents/search', { query: `metadata['event_id']:'${eventId}' AND status:'succeeded'`, limit: 100, page });
    out.push(...r.data);
    page = r.has_more ? r.next_page : undefined;
  } while (page);
  return out;
}

module.exports = { sheetListe, lienAcompte, totalResa, sheetPost, sheetCounts, sheetAnnules, ligneAcompte, ligneResa, syncSheet, enregistrerResa, resasSoiree, acomptesSoiree, env, clean, isEmail, euro, dateFr, esc, soiree, siteUrl, readJson, readRaw, stripe, placesVendues, verifStripe, sendMail, mailHtml, json, SOIREES, DEPOSIT };
