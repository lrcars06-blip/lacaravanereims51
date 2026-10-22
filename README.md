# La Caravane, Bétheny : site et réservations

## Contenu
- index.html : le site (photos et affiches à côté)
- mentions-legales.html, confidentialite.html, cgv.html : pages légales (aussi intégrées en fenêtre dans index.html)
- merci.html : page de remerciement (acompte payé, pass, liste d'attente, demande)
- api/checkout.js : crée le paiement Stripe de l'acompte de 30 % (soirées repas), refuse au-delà des places restantes
- api/stripe-webhook.js : acompte payé → e-mail de confirmation au client + alerte à La Caravane
- api/reserver.js : pass soirée, liste d'attente, privatisation, Convivialité → e-mail à La Caravane + accusé au client
- api/places.js : places déjà payées, pour la jauge des soirées
- api/session.js : récapitulatif affiché sur merci.html
- api/rappels.js : e-mail de rappel la veille de la soirée (tous les jours à 10h, via vercel.json)
- api/_soirees.js : prix et capacité des soirées côté paiement (généré depuis index.html)

## Mise en ligne (Vercel)
1. Pousser ce dossier sur GitHub, puis Vercel > Add New Project > importer le dépôt (Framework : Other, pas de build).
2. Settings > Environment Variables : renseigner les variables de .env.example, puis Redeploy.
3. Stripe > Développeurs > Webhooks > Ajouter un endpoint :
   URL https://VOTRE-SITE/api/stripe-webhook, événement checkout.session.completed.
   Copier la « clé secrète de signature » (whsec_...) dans STRIPE_WEBHOOK_SECRET, puis Redeploy.
4. Resend : tant qu'aucun domaine n'est vérifié, Resend n'envoie qu'à l'adresse du compte Resend.
   Les e-mails aux clients (confirmation, rappel) ne partent qu'après vérification d'un domaine (Resend > Domains).

## Tester (mode test Stripe)
Réserver une soirée repas avec la carte 4242 4242 4242 4242, date future, CVC quelconque.
Vérifier : retour sur merci.html, e-mails reçus, paiement visible dans Stripe, jauge qui baisse.
