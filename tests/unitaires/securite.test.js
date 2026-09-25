/**
 * Contrôles de démarrage de `config/security.js`.
 *
 * Ces tests portent sur la règle « échouer au boot vaut mieux qu'une faille
 * silencieuse » : chacun décrit une configuration dangereuse qui a déjà été
 * livrée quelque part, et vérifie que l'application refuse de partir.
 */

/** Recharge le module avec un environnement donné. */
function chargerSecurite(env) {
  jest.resetModules();
  const sauvegarde = { ...process.env };
  Object.assign(process.env, env);
  try {
    return require('../../src/config/security');
  } finally {
    process.env = sauvegarde;
  }
}

const VALIDE = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  JWT_RESET_SECRET: 'c'.repeat(40),
  CORS_ORIGIN: 'https://saambiz.sn',
};

describe('config/security — contrôles de démarrage', () => {
  test('accepte une configuration de production complète', () => {
    expect(() => chargerSecurite(VALIDE)).not.toThrow();
  });

  describe('secrets JWT', () => {
    test('refuse un secret manquant', () => {
      expect(() => chargerSecurite({ ...VALIDE, JWT_SECRET: '' }))
        .toThrow(/JWT_SECRET manquant/);
    });

    test('refuse un secret de moins de 32 caractères', () => {
      expect(() => chargerSecurite({ ...VALIDE, JWT_REFRESH_SECRET: 'trop_court' }))
        .toThrow(/inférieur à 32 caractères/);
    });

    test('exige un secret de réinitialisation en production', () => {
      expect(() => chargerSecurite({ ...VALIDE, JWT_RESET_SECRET: '' }))
        .toThrow(/JWT_RESET_SECRET/);
    });

    test('refuse deux secrets identiques', () => {
      // Deux secrets partagés annulent la séparation des usages : un jeton
      // d'accès devient utilisable comme jeton de rafraîchissement.
      expect(() => chargerSecurite({ ...VALIDE, JWT_REFRESH_SECRET: 'a'.repeat(40) }))
        .toThrow(/même valeur/);
    });

    test("refuse une valeur d'exemple laissée en production", () => {
      expect(() => chargerSecurite({
        ...VALIDE,
        JWT_SECRET: 'dev_jwt_secret_change_me_min_32_caracteres_0001',
      })).toThrow(/valeur d'exemple/);
    });

    test("tolère l'absence de secret de réinitialisation hors production", () => {
      expect(() => chargerSecurite({
        ...VALIDE, NODE_ENV: 'development', JWT_RESET_SECRET: '',
      })).not.toThrow();
    });
  });

  describe('CORS', () => {
    test('refuse une liste vide en production', () => {
      expect(() => chargerSecurite({ ...VALIDE, CORS_ORIGIN: '' }))
        .toThrow(/CORS_ORIGIN/);
    });

    test('refuse le joker', () => {
      expect(() => chargerSecurite({ ...VALIDE, CORS_ORIGIN: '*' }))
        .toThrow(/ne peut pas valoir/);
    });

    test('refuse une origine de développement en production', () => {
      // Cas vécu : une variable oubliée après une recette, et l'API accepte
      // les requêtes d'un poste de développement.
      expect(() => chargerSecurite({ ...VALIDE, CORS_ORIGIN: 'http://localhost:5190' }))
        .toThrow(/origine de développement/);
    });

    // `origin` est une fonction depuis que le développement doit accepter les
    // ports mouvants de Flutter Web : on l'interroge plutôt que de comparer
    // une liste. `verdict` rend true si l'origine passe.
    const verdict = (corsConfig, origine) => {
      let autorise = null;
      corsConfig.origin(origine, (err, ok) => { autorise = !err && ok === true; });
      return autorise;
    };

    test('accepte plusieurs origines séparées par des virgules', () => {
      const { corsConfig } = chargerSecurite({
        ...VALIDE, CORS_ORIGIN: 'https://saambiz.sn, https://app.saambiz.sn',
      });
      expect(verdict(corsConfig, 'https://saambiz.sn')).toBe(true);
      expect(verdict(corsConfig, 'https://app.saambiz.sn')).toBe(true);
    });

    test('refuse une origine absente de la liste', () => {
      const { corsConfig } = chargerSecurite({ ...VALIDE, CORS_ORIGIN: 'https://saambiz.sn' });
      expect(verdict(corsConfig, 'https://mechant.example')).toBe(false);
    });

    test('accepte une requête sans origine (appel serveur à serveur)', () => {
      // curl, un autre service, une application mobile native : seul un
      // navigateur envoie systématiquement une origine.
      const { corsConfig } = chargerSecurite({ ...VALIDE, CORS_ORIGIN: 'https://saambiz.sn' });
      expect(verdict(corsConfig, undefined)).toBe(true);
    });

    test(`accepte localhost sur n'importe quel port en développement`, () => {
      // Flutter Web tire un port au hasard à chaque lancement. Sans cette
      // tolérance, l'application échoue sur un « XMLHttpRequest error » que
      // rien n'explique — le navigateur masque le refus CORS derrière une
      // erreur réseau générique.
      const { corsConfig } = chargerSecurite({
        ...VALIDE, NODE_ENV: 'development', CORS_ORIGIN: 'http://localhost:5173',
      });
      expect(verdict(corsConfig, 'http://localhost:52341')).toBe(true);
      expect(verdict(corsConfig, 'http://127.0.0.1:61234')).toBe(true);
      expect(verdict(corsConfig, 'https://mechant.example')).toBe(false);
    });

    test('refuse localhost en production', () => {
      // La tolérance ci-dessus ne doit jamais suivre en production, où elle
      // ouvrirait l'API à toute page servie depuis la machine d'un visiteur.
      const { corsConfig } = chargerSecurite({ ...VALIDE, CORS_ORIGIN: 'https://saambiz.sn' });
      expect(verdict(corsConfig, 'http://localhost:5173')).toBe(false);
    });
  });

  describe('limitation de débit', () => {
    test('compte par utilisateur quand la requête est authentifiée', () => {
      const { userRateLimitConfig } = chargerSecurite(VALIDE);
      const cle = userRateLimitConfig.keyGenerator({ user: { id: 'abc' }, ip: '1.2.3.4' });
      expect(cle).toBe('u:abc');
    });

    test("retombe sur l'IP pour un visiteur non authentifié", () => {
      const { userRateLimitConfig } = chargerSecurite(VALIDE);
      const cle = userRateLimitConfig.keyGenerator({ ip: '1.2.3.4' });
      expect(cle).toContain('ip:');
    });

    test("l'envoi d'OTP est compté sur l'adresse visée, pas sur l'IP", () => {
      // Sans cette clé, un attaquant qui fait tourner ses IP pilonne la boîte
      // mail d'une victime sans jamais déclencher la limite.
      const { otpRateLimitConfig } = chargerSecurite(VALIDE);
      const cle = otpRateLimitConfig.keyGenerator({
        body: { email: 'Victime@Saambiz.SN' }, ip: '9.9.9.9',
      });
      expect(cle).toBe('otp:victime@saambiz.sn');
    });

    test('les limites sont actives en production', () => {
      const { rateLimitConfig, authRateLimitConfig } = chargerSecurite(VALIDE);
      expect(rateLimitConfig.skip()).toBe(false);
      expect(authRateLimitConfig.skip()).toBe(false);
    });

    test('refuse de démarrer si les limites sont désactivées sur une instance publique', () => {
      expect(() => chargerSecurite({
        ...VALIDE, NODE_ENV: 'development', EXPOSE_PUBLIQUEMENT: 'true',
      })).toThrow(/Limitation de débit désactivée/);
    });
  });

  describe('mots de passe', () => {
    test('bcrypt tourne au moins 12 fois', () => {
      const { bcryptConfig } = chargerSecurite(VALIDE);
      expect(bcryptConfig.saltRounds).toBeGreaterThanOrEqual(12);
    });
  });
});
