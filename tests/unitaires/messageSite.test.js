/**
 * Message laissé sur la page « Contact » du site d'une boutique.
 *
 * Le visiteur n'a pas de compte : le message n'a de valeur que si le vendeur
 * peut répondre, d'où le numéro obligatoire. Et une notification qui échoue
 * ne doit jamais faire croire au visiteur que son message est perdu.
 */
const VitrineService = require('../../src/services/vitrine/vitrine.service');
const MessageService = require('../../src/services/messagerie/message.service');
const NotificationService = require('../../src/services/notifications/notification.service');
const { MessageSite } = require('../../src/models');

const boutique = { vendeurId: 'vendeur-1', nom: 'Chez Awa' };

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(VitrineService, '_chargerBoutique').mockResolvedValue(boutique);
  jest.spyOn(MessageSite, 'create').mockImplementation(async (v) => ({ id: 'm1', ...v }));
  jest.spyOn(NotificationService, 'creerNotification').mockResolvedValue({});
});

describe('Envoi depuis la page Contact', () => {
  it('enregistre le message pour le vendeur de la boutique et le prévient', async () => {
    const r = await VitrineService.envoyerMessage('chez-awa', {
      nom: ' Fatou\nDiop ', telephone: '77 123 45 67', message: '  Avez-vous la taille M ?  ',
    });
    expect(r).toEqual({ envoye: true });
    expect(MessageSite.create).toHaveBeenCalledWith({
      vendeurId: 'vendeur-1', nom: 'Fatou Diop', telephone: '+221771234567', contenu: 'Avez-vous la taille M ?',
    });
    expect(NotificationService.creerNotification).toHaveBeenCalledWith(
      expect.objectContaining({ utilisateurId: 'vendeur-1', type: 'systeme' })
    );
  });

  it('accepte un message sans nom', async () => {
    await VitrineService.envoyerMessage('chez-awa', { telephone: '771234567', message: 'Bonjour' });
    expect(MessageSite.create).toHaveBeenCalledWith(expect.objectContaining({ nom: null }));
  });

  it('refuse un numéro invalide ou un message vide, sans rien enregistrer', async () => {
    await expect(VitrineService.envoyerMessage('chez-awa', { telephone: '12', message: 'Bonjour' }))
      .rejects.toThrow(/numéro/);
    await expect(VitrineService.envoyerMessage('chez-awa', { telephone: '771234567', message: '  ' }))
      .rejects.toThrow(/message/);
    await expect(VitrineService.envoyerMessage('chez-awa', { telephone: '771234567', message: 'x'.repeat(2001) }))
      .rejects.toThrow(/trop long/);
    expect(MessageSite.create).not.toHaveBeenCalled();
  });

  it('fait semblant d\'accepter un robot (champ piège rempli) sans rien enregistrer', async () => {
    const r = await VitrineService.envoyerMessage('chez-awa', {
      telephone: '771234567', message: 'Promo !!!', site: 'http://spam.example',
    });
    expect(r).toEqual({ envoye: true });
    expect(MessageSite.create).not.toHaveBeenCalled();
  });

  it('confirme l\'envoi même si la notification au vendeur échoue', async () => {
    NotificationService.creerNotification.mockRejectedValue(new Error('push indisponible'));
    await expect(VitrineService.envoyerMessage('chez-awa', { telephone: '771234567', message: 'Bonjour' }))
      .resolves.toEqual({ envoye: true });
  });
});

describe('Lecture par le vendeur', () => {
  it('ne touche qu\'aux messages du vendeur connecté', async () => {
    const update = jest.spyOn(MessageSite, 'update').mockResolvedValue([1]);
    const id = '6f1c2a3b-1111-4222-8333-944455556666';
    await expect(MessageService.marquerMessageSiteLu(id, 'vendeur-1')).resolves.toMatchObject({ success: true });
    expect(update).toHaveBeenCalledWith({ lu: true }, { where: { id, vendeurId: 'vendeur-1' } });
  });

  it('répond « introuvable » à un identifiant mal formé sans interroger la base', async () => {
    const update = jest.spyOn(MessageSite, 'update');
    await expect(MessageService.marquerMessageSiteLu('pas-un-uuid', 'vendeur-1')).resolves.toMatchObject({ success: false });
    expect(update).not.toHaveBeenCalled();
  });
});
