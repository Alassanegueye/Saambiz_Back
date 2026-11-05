const crypto = require('crypto');
const axios = require('axios');
const { BadRequestError } = require('../../errors/AppError');

const URL_SESSIONS = 'https://api.wave.com/v1/checkout/sessions';
// Wave demande de refuser une notification de plus de cinq minutes.
const ANCIENNETE_MAX_SECONDES = 5 * 60;

/**
 * Paiement Wave (https://docs.wave.com/checkout) : on crée une session, le
 * client la règle dans Wave, et le résultat arrive par notification signée.
 */
class WaveService {
  static async creerSession({ montant, reference }) {
    const cle = process.env.WAVE_API_KEY;
    const succes = process.env.WAVE_SUCCESS_URL;
    const erreur = process.env.WAVE_ERROR_URL;
    if (!cle || !succes || !erreur) {
      throw new BadRequestError('Le paiement Wave n\'est pas encore disponible. Choisissez Orange Money.');
    }

    const { data } = await axios.post(
      URL_SESSIONS,
      {
        // Une chaîne, sans décimales : le franc CFA n'en a pas.
        amount: String(Math.round(Number(montant))),
        currency: 'XOF',
        success_url: succes,
        error_url: erreur,
        client_reference: reference,
      },
      { headers: { Authorization: `Bearer ${cle}` }, timeout: 15000 }
    );
    return { sessionId: data.id, paymentUrl: data.wave_launch_url };
  }

  /**
   * En-tête « t=<secondes>,v1=<hex>[,v1=<hex>] » : HMAC-SHA256 du timestamp
   * suivi du corps BRUT. Plusieurs v1 coexistent pendant un changement de clé.
   */
  static signatureValide(entete, corpsBrut, secret = process.env.WAVE_WEBHOOK_SECRET, maintenant = Date.now()) {
    if (!secret || !entete || !corpsBrut) return false;
    const parties = entete.split(',').map((p) => p.trim());
    const timestamp = parties.find((p) => p.startsWith('t='))?.slice(2);
    const signatures = parties.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
    if (!timestamp || signatures.length === 0) return false;

    const age = maintenant / 1000 - Number(timestamp);
    if (!Number.isFinite(age) || Math.abs(age) > ANCIENNETE_MAX_SECONDES) return false;

    const attendue = Buffer.from(
      crypto.createHmac('sha256', secret).update(timestamp + corpsBrut).digest('hex')
    );
    return signatures.some((s) => {
      const recue = Buffer.from(s);
      return recue.length === attendue.length && crypto.timingSafeEqual(recue, attendue);
    });
  }
}

module.exports = WaveService;
