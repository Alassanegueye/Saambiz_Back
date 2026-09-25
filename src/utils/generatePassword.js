const crypto = require('crypto');

/**
 * Génère un mot de passe sécurisé de 12 caractères
 * respectant : majuscule + chiffre + caractère spécial
 */
function generatePassword() {
  const upper   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower   = 'abcdefghijklmnopqrstuvwxyz';
  const digits  = '0123456789';
  const special = '@#$!%&*';
  const all     = upper + lower + digits + special;

  const getRand = (chars) => chars[crypto.randomInt(0, chars.length)];

  const required = [
    getRand(upper),
    getRand(digits),
    getRand(special),
  ];

  const rest = Array.from({ length: 9 }, () => getRand(all));
  const pwd  = [...required, ...rest];

  // Mélange Fisher-Yates
  for (let i = pwd.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
  }

  return pwd.join('');
}

module.exports = { generatePassword };
