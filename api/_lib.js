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
function mailHtml({ titre, intro, lignes = [], fin = '' }) {
  const rows = lignes.filter(Boolean).map(([k, v]) => `<tr><td style="padding:8px 0;color:#5B4F78;width:40%">${esc(k)}</td><td style="padding:8px 0;font-weight:600;color:#1D1338">${esc(v)}</td></tr>`).join('');
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#17123A;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#17123A;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFF7E8;border-radius:18px;overflow:hidden">
<tr><td style="background:#17123A;padding:22px 28px;color:#FAEBD3;font-size:22px;font-family:Georgia,serif">La Caravane <span style="color:#FFC83D">·</span> Bétheny</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:26px;color:#1D1338">${esc(titre)}</h1>
<p style="margin:0 0 18px;color:#1D1338;font-size:16px;line-height:1.55">${intro}</p>
${rows ? `<table role="presentation" width="100%" style="border-top:1px dashed #d8cdb6;border-bottom:1px dashed #d8cdb6;margin:0 0 18px;font-size:15px">${rows}</table>` : ''}
${fin ? `<p style="margin:0 0 6px;color:#1D1338;font-size:15px;line-height:1.55">${fin}</p>` : ''}
<p style="margin:18px 0 0;color:#5B4F78;font-size:14px">17 rue des Docks Rémois, 51450 Bétheny<br>03 26 07 59 10</p>
</td></tr></table></td></tr></table></body></html>`;
}

function json(res, code, obj) { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); }

module.exports = { env, clean, isEmail, euro, dateFr, esc, soiree, siteUrl, readJson, readRaw, stripe, placesVendues, verifStripe, sendMail, mailHtml, json, SOIREES, DEPOSIT };
