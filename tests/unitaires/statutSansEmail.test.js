/**
 * Un changement de statut prévient, il n'écrit pas.
 *
 * Chaque étape d'une commande envoyait un e-mail au client : reçue, payée,
 * acceptée, en préparation, prête, en livraison, livrée. Une commande passée
 * le matin et livrée l'après-midi, c'était six e-mails pour un seul achat —
 * et autant d'envois rapprochés depuis la même adresse, ce qui finit par
 * peser sur la délivrabilité de ceux qui comptent vraiment.
 *
 * Désormais, un changement de statut produit UNE notification : dans
 * l'application, et sur le téléphone. Pas d'e-mail en plus — prévenir deux
 * fois ne prévient pas mieux.
 *
 * L'EXCEPTION QUI RESTE : le client sans compte, qui a commandé depuis le
 * site de la boutique. Il n'a pas l'application, donc aucun appareil
 * enregistré : aucune notification ne peut l'atteindre. Lui retirer l'e-mail
 * le laisserait sans nouvelle de sa commande, et c'est pour cela que ce
 * fichier le vérifie aussi.
 */

const mockCreerNotification = jest.fn();
const mockEmailClient = jest.fn();
const mockEmailVendeur = jest.fn();

jest.mock('../../src/services/socket.service', () => ({
  getIO: () => ({ to: () => ({ emit: jest.fn() }) }),
}));

jest.mock('../../src/models', () => ({
  Commande: { findByPk: jest.fn() },
  LigneCommande: {},
  Produit: {},
  Utilisateur: { findByPk: jest.fn(async () => null) },
  Boutique: { findOne: jest.fn(async () => null) },
  HistoriqueCommande: { create: jest.fn() },
}));
jest.mock('../../src/config/db', () => ({
  transaction: jest.fn(),
  define: jest.fn(() => ({})),
}));
jest.mock('../../src/services/notifications/notification.service', () => ({
  creerNotification: (...a) => mockCreerNotification(...a),
  notifierUtilisateurs: jest.fn(),
  notifierAbonnesBoutique: jest.fn(),
}));
jest.mock('../../src/services/resend.service', () => ({
  sendCommandeClientEmail: (...a) => mockEmailClient(...a),
  sendNouvelleCommandeEmail: (...a) => mockEmailVendeur(...a),
}));

const { Commande } = require('../../src/models');
const CommandeService = require('../../src/services/commandes/commande.service');

/** Laisse partir les `.then()` lancés sans être attendus. */
const vider = () => new Promise((r) => setImmediate(r));

const AVEC_COMPTE = {
  id: 'cmd-1',
  referenceCommande: 'CMD-2026-LREV6T',
  montantTotal: '5500.00',
  statut: 'en_preparation',
  statutPaiement: 'non_paye',
  acheteurId: 'acheteur-1',
  vendeurId: 'vendeur-1',
};

const SANS_COMPTE = {
  ...AVEC_COMPTE,
  id: 'cmd-2',
  acheteurId: null,
  clientEmail: 'moussa@exemple.sn',
  clientPrenom: 'Moussa',
};

beforeEach(() => {
  jest.clearAllMocks();
  Commande.findByPk.mockImplementation(async (id) => ({
    ...(id === 'cmd-2' ? SANS_COMPTE : AVEC_COMPTE),
    lignes: [],
    acheteur: id === 'cmd-2' ? null : { email: 'awa@exemple.sn', prenom: 'Awa' },
  }));
});

describe('Le client qui a un compte', () => {
  const ETAPES = [
    'payee',
    'acceptee',
    'rejetee',
    'confirmee',
    'en_preparation',
    'prete',
    'en_livraison',
    'livree',
    'annulee',
  ];

  test.each(ETAPES)('« %s » ne déclenche aucun e-mail', async (statut) => {
    await CommandeService._notifierAcheteurStatut({ ...AVEC_COMPTE, statut });
    await vider();

    expect(mockEmailClient).not.toHaveBeenCalled();
  });

  test.each(ETAPES)('« %s » déclenche bien une notification', async (statut) => {
    await CommandeService._notifierAcheteurStatut({ ...AVEC_COMPTE, statut });

    expect(mockCreerNotification).toHaveBeenCalledTimes(1);
    const envoi = mockCreerNotification.mock.calls[0][0];
    expect(envoi.utilisateurId).toBe('acheteur-1');
    expect(envoi.titre).toContain('CMD-2026-LREV6T');
    expect(envoi.message.length).toBeGreaterThan(10);
  });

  test('la notification porte de quoi ouvrir la bonne commande', async () => {
    // Le téléphone n'a que cette charge utile quand l'application est fermée.
    await CommandeService._notifierAcheteurStatut({
      ...AVEC_COMPTE,
      statut: 'prete',
    });

    const { data } = mockCreerNotification.mock.calls[0][0];
    expect(data.commandeId).toBe('cmd-1');
    expect(data.reference).toBe('CMD-2026-LREV6T');
    expect(data.statut).toBe('prete');
    expect(data.pourVendeur).toBe(false);
  });

  test('un message particulier remplace le libellé, sans e-mail non plus', async () => {
    // Le refus d'une demande d'annulation porte son motif.
    await CommandeService._notifierAcheteurStatut(
      AVEC_COMPTE,
      'Votre demande d’annulation a été refusée : la commande est déjà partie.',
    );
    await vider();

    expect(mockEmailClient).not.toHaveBeenCalled();
    expect(mockCreerNotification.mock.calls[0][0].message).toContain('refusée');
  });
});

describe('Le client sans compte, qui a commandé depuis le site', () => {
  test('reçoit toujours son e-mail : c’est son seul canal', async () => {
    await CommandeService._notifierAcheteurStatut(SANS_COMPTE);
    await vider();

    expect(mockEmailClient).toHaveBeenCalledTimes(1);
    expect(mockEmailClient.mock.calls[0][0].to).toBe('moussa@exemple.sn');
  });

  test('et aucune notification, puisqu’il n’a pas de compte', async () => {
    await CommandeService._notifierAcheteurStatut(SANS_COMPTE);
    await vider();

    expect(mockCreerNotification).not.toHaveBeenCalled();
  });
});

describe('Le vendeur', () => {
  test('est prévenu une fois à l’arrivée de la commande, e-mail compris', async () => {
    await CommandeService._notifierVendeurNouvelleCommande(AVEC_COMPTE);
    await vider();

    expect(mockCreerNotification).toHaveBeenCalledTimes(1);
    expect(mockCreerNotification.mock.calls[0][0].titre).toContain('Nouvelle commande');
  });

  test('n’a plus un second e-mail quand la commande est payée', async () => {
    // Le même gabarit « Nouvelle commande » partait deux fois pour une seule
    // vente réglée en ligne : à la commande, puis à l'encaissement.
    await CommandeService._notifierVendeurNouvelleCommande(AVEC_COMPTE, true);
    await vider();

    expect(mockEmailVendeur).not.toHaveBeenCalled();
    expect(mockCreerNotification).toHaveBeenCalledTimes(1);
    expect(mockCreerNotification.mock.calls[0][0].titre).toContain('payée');
  });

  test('voit un montant lisible, pas « 5500.00 »', async () => {
    // Ce qui s'affiche sur l'écran verrouillé : « 5 500 FCFA ».
    await CommandeService._notifierVendeurNouvelleCommande(AVEC_COMPTE);

    const { message } = mockCreerNotification.mock.calls[0][0];
    expect(message).not.toContain('5500.00');
    expect(message.replace(/ | /g, ' ')).toContain('5 500 FCFA');
  });
});
