const axios = require('axios');
const axiosRetry = require('axios-retry').default || require('axios-retry');
const crypto = require('crypto');
const logger = require('../../utils/logger');

// M-02 : URL configurable via env
const ORANGE_API_BASE = process.env.ORANGE_API_BASE || 'https://api.orange.com/orange-money-webpay/dev/v1';
const HTTP_TIMEOUT = 15000;

// MED-07 : retry avec backoff exponentiel sur erreurs réseau transitoires
axiosRetry(axios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay, // 500ms, 1s, 2s
  retryCondition: (error) =>
    axiosRetry.isNetworkOrIdempotentRequestError(error) ||
    (error.response && error.response.status >= 500),
  onRetry: (retryCount, error) => {
    logger.warn('orangeMoney.retry', { attempt: retryCount, message: error.message });
  },
});

class OrangeMoneyService {

  // -------------------- OBTENIR TOKEN --------------------
  static async getToken() {
    const credentials = Buffer.from(
      `${process.env.ORANGE_CLIENT_ID}:${process.env.ORANGE_CLIENT_SECRET}`
    ).toString('base64');

    const response = await axios.post(
      'https://api.orange.com/oauth/v3/token',
      'grant_type=client_credentials',
      {
        timeout: HTTP_TIMEOUT,
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
      }
    );

    return response.data.access_token;
  }

  // -------------------- INITIER UN PAIEMENT --------------------
  static async initiePaiement({ phone, amount, orderId }) {
    const token = await OrangeMoneyService.getToken();

    const payload = {
      merchant_key: process.env.ORANGE_MERCHANT_KEY,
      currency: 'XOF',
      order_id: orderId,
      amount,
      return_url: process.env.ORANGE_RETURN_URL,
      cancel_url: process.env.ORANGE_CANCEL_URL,
      notif_url: process.env.ORANGE_NOTIF_URL,
      lang: 'fr',
      reference: orderId,
    };

    const response = await axios.post(
      `${ORANGE_API_BASE}/webpayment`,
      payload,
      {
        timeout: HTTP_TIMEOUT,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      }
    );

    return {
      payToken:    response.data.data?.pay_token    || response.data.pay_token,
      paymentUrl:  response.data.data?.payment_url  || response.data.payment_url,
      notifToken:  response.data.data?.notif_token  || response.data.notif_token,
    };
  }

  // -------------------- VERIFIER STATUT --------------------
  static async verifierStatut({ payToken }) {
    const token = await OrangeMoneyService.getToken();

    const response = await axios.get(
      `${ORANGE_API_BASE}/transactionstatus`,
      {
        params: { order_id: payToken },
        timeout: HTTP_TIMEOUT,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      }
    );

    return response.data;
  }

  // -------------------- VALIDER SIGNATURE WEBHOOK — C-01 --------------------
  static validerSignature(req) {
    const webhookSecret = process.env.ORANGE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      if (process.env.NODE_ENV !== 'production') {
        logger.warn('ORANGE_WEBHOOK_SECRET non défini — vérification HMAC désactivée (dev uniquement)');
        const { status, order_id } = req.body;
        return !!(status && order_id);
      }
      logger.error('ORANGE_WEBHOOK_SECRET manquant en production — webhook rejeté');
      return false;
    }

    const receivedSignature = req.headers['x-orange-signature'];
    if (!receivedSignature) {
      logger.warn('Webhook Orange reçu sans header x-orange-signature');
      return false;
    }

    const rawBody = req.rawBody || JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(receivedSignature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );
    } catch {
      return false;
    }
  }
}

module.exports = OrangeMoneyService;
