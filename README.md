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
- api/compte-rendu.js : la veille de chaque soirée vers 17h-18h, liste complète des réservations (site + lignes ajoutées à la main dans le Sheet) (nom, e-mail, téléphone, personnes, observations, case Vu) envoyée à RESERVATION_EMAIL
- api/version.js : commit en ligne, utilisé par deploy.sh
- api/_soirees.js : prix et capacité des soirées côté paiement (généré depuis index.html)

## Suivi des réservations : Google Sheet « Réservations La Caravane »
- Compte Google de La Caravane. Script : `sheet/apps-script.gs` (copie de référence de Extensions > Apps Script).
- Chaque pass, liste d'attente et acompte payé y est inscrit automatiquement (réf Stripe en colonne I).
- Onglet `Soirees` : capacité, réservées (statut « confirmé ») et restantes, par soirée (ajoutée automatiquement).
- Remboursement total dans Stripe : la ligne passe automatiquement en « annulé » (webhook charge.refunded) ; remboursement partiel : noté dans la colonne Paiement, la ligne reste confirmée.
- Annuler : passer le Statut à « annulé » (ne pas supprimer la ligne). La place se libère sur le site (jauge et paiement),
  la réservation sort du compte rendu et du rappel. Un acompte annulé se rembourse à part dans Stripe.
- Réservation prise par téléphone : ajouter une ligne à la main (Soirée = id de la soirée, Statut = confirmé), elle compte dans la jauge.
- Rattrapage automatique chaque matin (tâche des rappels) : les réservations Stripe des soirées à venir absentes du Sheet y sont ajoutées.
- Variable Vercel `SHEET_SECRET` = propriété SECRET du script (Apps Script > Paramètres du projet). Sans elle, le site fonctionne sur Stripe seul.

## Acompte des clients ayant réservé par téléphone (soirées complètes)
Lien privé par soirée, à envoyer par La Caravane à ses clients : `acompte.html?s=<id soirée>&k=<clé>` (clés dans `api/_acomptes.js`).
Le client saisit nom, e-mail, téléphone, adultes et enfants, puis paie 30 %. Plafond : la capacité de la soirée (160) sur l'ensemble des
lignes « confirmé » du Sheet ; au-delà, le paiement est refusé. Pour ces soirées, ne pas ajouter les réservations téléphoniques à la main
dans le Sheet (chaque client s'y inscrit en payant), sinon elles compteraient deux fois.
Même circuit que le site : facture d'acompte, e-mails, ligne dans le Sheet, rappel la veille, compte rendu.
Pour désactiver un lien : supprimer sa ligne dans `api/_acomptes.js`. Pour une nouvelle soirée : ajouter une ligne avec une nouvelle clé.

## Jours d'ouverture
Ouvert au public du vendredi au dimanche. Du lundi au jeudi : privatisation uniquement (formule Convivialité refusée ces jours-là, sauf soirée de l'agenda), côté formulaire (index.html, fermePublic) et côté serveur (api/reserver.js).

## Factures d'acompte
Stripe génère une facture (préfixe CARAV) pour chaque acompte payé et l'envoie au client avec son reçu
(`invoice_creation` dans api/checkout.js ; e-mails « Paiements réussis » activés dans Stripe).

## Déployer une modification
`./deploy.sh "message"` : vérifie les images et les fonctions, commit, push sur `main`, puis attend que lacaravanereims.com serve ce commit (route `/api/version`) (Vercel déploie automatiquement chaque push sur `main`).

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
