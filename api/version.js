// Version déployée (commit Git), utilisée par deploy.sh pour savoir quand la mise en production est terminée.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ commit: process.env.VERCEL_GIT_COMMIT_SHA || null }));
};
