#!/usr/bin/env bash
# Déploie La Caravane : commit + push sur main → Vercel met en production automatiquement.
# Usage : ./deploy.sh "message du changement"
set -euo pipefail
cd "$(dirname "$0")"
MSG="${1:-Mise à jour du site}"
SITE="https://lacaravanereims.com"

# 1. Garde-fous : aucune image référencée ne doit manquer
missing=0
for f in $(grep -ohE "[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)" index.html | sort -u); do
  [ -f "$f" ] || { echo "IMAGE MANQUANTE : $f"; missing=1; }
done
[ "$missing" = 0 ] || { echo "Déploiement annulé."; exit 1; }
for f in api/*.js; do node --check "$f" >/dev/null || { echo "Erreur de syntaxe : $f"; exit 1; }; done

# 2. Commit + push
git add -A
if git diff --cached --quiet; then echo "Rien à déployer."; exit 0; fi
git commit -q -m "$MSG"
git push -q origin main
SHA=$(git rev-parse --short HEAD)
echo "Poussé ($SHA). Vercel déploie…"

# 3. Attendre que Vercel serve ce commit (route /api/version)
FULL=$(git rev-parse HEAD)
for i in $(seq 1 30); do
  sleep 10
  LIVE=$(curl -s "$SITE/api/version?v=$RANDOM" | sed -n 's/.*"commit":"\([0-9a-f]*\)".*/\1/p')
  if [ "$LIVE" = "$FULL" ]; then echo "En ligne ($SHA) : $SITE"; exit 0; fi
done
echo "Vercel ne sert pas encore $SHA après 5 min : vérifier Vercel > Deployments."
exit 1
