// Liens privés « payer l'acompte » pour les clients ayant réservé par téléphone (soirées complètes).
// Lien : https://lacaravanereims.com/acompte.html?s=<id>&k=<cle>   (envoyé par La Caravane à ses clients)
// La clé évite qu'un inconnu réserve une soirée complète via ce lien. Pour désactiver un lien : supprimer sa ligne.
// prixEnfant : tarif enfant payant (les moins de 6 ans gratuits ne sont pas comptés).
module.exports = {
  'halloween-repas-2026-10-31': { cle: 'QOnrwXSxKA4F', prixEnfant: 15, enfantTexte: 'Enfants de 6 à 12 ans (15 €)' },
  'reveillon-2026-12-31': { cle: '6gY2sDJdXDHW', prixEnfant: 30, enfantTexte: 'Enfants jusqu\'à 15 ans (menu 30 €)' },
};
