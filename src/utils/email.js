/**
 * Format d'une adresse e-mail — même règle que l'application mobile
 * (Mobile/lib/core/utils/email.dart).
 */
const FORMAT_EMAIL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

function estEmailValide(email) {
  const e = String(email ?? '').trim();
  return e.length > 0 && e.length <= 254 && FORMAT_EMAIL.test(e);
}

module.exports = { FORMAT_EMAIL, estEmailValide };
