// services/sites/mails.kodafrik.js
//
// Les e-mails de Kodafrik : une seule mise en page pour tous, et les modèles.
// Repris tels quels du site Kodafrik (public/api/_mails.php), qui ne peut plus
// les envoyer : LWS n'exécute plus son PHP.
//
// Même construction que les e-mails de Yobante : fond gris clair, carte
// blanche aux coins arrondis, bandeau bleu nuit du K avec le pictogramme et
// le trait bleu, contenu aéré, pied de page discret. Tout en styles EN LIGNE
// et en tableaux : Gmail, Outlook et les messageries mobiles ignorent les
// feuilles de style. Chaque modèle rend { sujet, html, texte }.

const { reglagesKodafrik } = require('./sites.config');

const MARINE = '#101F45';
const BLEU = '#1B6EF3';
const BLEU_PALE = '#E8F0FE';
const FOND = '#F3F5FA';
const ENCRE = '#1C2333';
const DISCRET = '#5F6B7E';
const POLICE = 'font-family:Arial,Helvetica,sans-serif';

/** Les modèles : clé → [libellé, champs obligatoires des données]. */
const MODELES = Object.freeze({
  bienvenue: ['Bienvenue (compte créé)', ['email', 'codeAcces', 'espaces']],
  acces_ouverts: ['Nouveaux espaces ouverts', ['espaces']],
  code_acces: ["Nouveau code d'accès", ['codeAcces']],
  compte_modifie: ['Compte modifié', []],
  compte_desactive: ['Compte désactivé', []],
  compte_reactive: ['Compte réactivé', []],
  compte_supprime: ['Compte supprimé', []],
  reponse_message: ['Réponse à un message du site', ['message']],
  message_libre: ['Message libre', ['sujet', 'message']],
});

const echapper = (v) => String(v ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const nl2br = (t) => t.replace(/\r?\n/g, '<br>');

/** Un texte saisi (plusieurs lignes) : échappé, retours à la ligne gardés. */
const paragraphes = (t) => String(t || '').trim().split(/\n\s*\n/).filter(Boolean)
  .map((b) => `<p style="margin:0 0 14px">${nl2br(echapper(b.trim()))}</p>`).join('');

function entete(rubrique) {
  const picto = `${reglagesKodafrik().images}/kodafrik-picto.png`;
  return `
    <tr><td style="background:${MARINE};padding:20px 24px">
      <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
        <td style="vertical-align:middle;padding-right:14px">
          <img src="${picto}" width="48" height="48" alt="Kodafrik" style="display:block;width:48px;height:48px;border:0;border-radius:12px;background:#FFFFFF" />
        </td>
        <td style="vertical-align:middle">
          <div style="color:#FFFFFF;font-size:20px;font-weight:bold;${POLICE}">Kodafrik</div>
          <div style="width:36px;height:4px;background:${BLEU};border-radius:2px;margin-top:7px;font-size:0;line-height:0">&nbsp;</div>
        </td>
        <td style="vertical-align:middle;padding-left:18px;color:#AFC4EC;font-size:12px;${POLICE}">${echapper(rubrique)}</td>
      </tr></table>
    </td></tr>`;
}

/** L'e-mail complet, autour d'un contenu HTML déjà échappé. */
function miseEnPage(contenu, rubrique = '', avantPremiere = '', maintenant = new Date()) {
  const apercu = avantPremiere
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${echapper(avantPremiere)}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Kodafrik</title></head>
<body style="margin:0;padding:0;background:${FOND}">${apercu}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FOND};border-collapse:collapse"><tr><td style="padding:24px 12px;${POLICE};color:${ENCRE}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden;border-collapse:separate;border:1px solid #E4E9F2">
${entete(rubrique)}
    <tr><td style="padding:28px 24px 24px;font-size:14px;line-height:1.6;color:${ENCRE};${POLICE}">
${contenu}
    </td></tr>
  </table>
  <p style="text-align:center;font-size:11px;line-height:1.6;color:#9AA3B2;margin:14px 0 0;${POLICE}">
    © ${maintenant.getUTCFullYear()} Kodafrik · <a href="https://kodafrik.com" style="color:#9AA3B2;text-decoration:underline">kodafrik.com</a><br>
    Dakar, Sénégal
  </p>
</td></tr></table>
</body></html>`;
}

const bonjour = (prenom) => {
  const nom = String(prenom || '').trim();
  return `<p style="font-size:16px;margin:0 0 12px">Bonjour${nom ? ` ${echapper(nom)}` : ''},</p>`;
};

const titre = (t) => `<h1 style="font-size:19px;line-height:1.35;margin:0 0 14px;color:${MARINE};${POLICE}">${echapper(t)}</h1>`;

function info(libelle, valeur, secret = false) {
  const v = secret
    ? `<span style="display:inline-block;background:${BLEU_PALE};color:${MARINE};border-radius:10px;padding:10px 16px;font-size:19px;font-weight:bold;letter-spacing:2px;font-family:Consolas,Menlo,monospace">${echapper(valeur)}</span>`
    : `<div style="font-size:16px;font-weight:bold;color:${ENCRE}">${echapper(valeur)}</div>`;
  return `<div style="margin:0 0 14px"><div style="font-size:12px;color:${DISCRET};margin:0 0 4px">${echapper(libelle)}</div>${v}</div>`;
}

/** Le code d'accès, chiffre par chiffre (lisible, recopiable). */
function code(valeur, libelle = "Code d'accès") {
  const cases = Array.from(String(valeur)).map((c) => `<td style="width:46px;height:56px;background:${BLEU_PALE};border-radius:10px;text-align:center;vertical-align:middle;font-size:26px;font-weight:bold;color:${MARINE};${POLICE}">${echapper(c)}</td>`)
    .join('<td style="width:8px;font-size:0">&nbsp;</td>');
  return `<div style="font-size:12px;color:${DISCRET};margin:4px 0 6px">${echapper(libelle)}</div>`
    + `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:0 0 18px"><tr>${cases}</tr></table>`;
}

const bouton = (libelle, lien) => `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:8px 0 20px"><tr>
      <td style="background:${BLEU};border-radius:10px">
        <a href="${echapper(lien)}" style="display:inline-block;padding:12px 22px;color:#FFFFFF;font-size:15px;font-weight:bold;text-decoration:none;${POLICE}">${echapper(libelle)}</a>
      </td></tr></table>`;

const TONS = { info: ['#FEF6DD', '#5C4A12'], alerte: ['#FDECEC', '#8A1F1F'], succes: ['#E7F6EC', '#1D5B33'], bleu: [BLEU_PALE, MARINE] };
const encadre = (html, ton = 'info') => {
  const [fond, encre] = TONS[ton] || TONS.info;
  return `<p style="margin:6px 0 18px;padding:12px 14px;background:${fond};color:${encre};border-radius:10px;font-size:13px;line-height:1.6">${html}</p>`;
};

function espacesEnPastilles(espaces) {
  if (!espaces.length) return '';
  const pastilles = espaces.map((e) => `<span style="display:inline-block;margin:0 6px 6px 0;padding:6px 12px;border:1px solid #D9E2F2;border-radius:999px;font-size:13px;font-weight:bold;color:${MARINE}">${echapper(e)}</span>`).join('');
  return `<div style="margin:0 0 16px"><div style="font-size:12px;color:${DISCRET};margin:0 0 6px">Vos espaces</div>${pastilles}</div>`;
}

const note = (t) => `<p style="font-size:12px;color:${DISCRET};margin:16px 0 0;line-height:1.6">${t}</p>`;
const signature = (auteur) => `<p style="margin:18px 0 0">À bientôt,<br><strong>${echapper(auteur || "L'équipe Kodafrik")}</strong></p>`;

const versionTexte = (lignes) => [...lignes, '', '—', 'Kodafrik · https://kodafrik.com'].join('\n');
const salut = (prenom) => `Bonjour${prenom ? ` ${prenom}` : ''},`;
const extrait = (t, n = 110) => Array.from(String(t || '').trim()).slice(0, n).join('');
const dateFr = (date) => {
  const d = new Date(date);
  const deux = (n) => String(n).padStart(2, '0');
  return `${deux(d.getUTCDate())}/${deux(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} à ${deux(d.getUTCHours())}:${deux(d.getUTCMinutes())}`;
};

/**
 * Rend un modèle.
 * @param {string} modele une clé de MODELES (ou « contact_recu », interne)
 * @param {object} d      les données du modèle
 * @returns {{sujet: string, html: string, texte: string}}
 */
function rendre(modele, d = {}, maintenant = new Date()) {
  const prenom = d.prenom ? String(d.prenom) : null;
  const espaces = (Array.isArray(d.espaces) ? d.espaces : []).map(String).filter(Boolean);
  const { portail } = reglagesKodafrik();
  const auteur = d.auteur ? String(d.auteur) : null;
  const page = (contenu, rubrique, avant) => miseEnPage(contenu, rubrique, avant, maintenant);

  switch (modele) {
    case 'bienvenue': {
      const mdp = String(d.motDePasse || '');
      const html = bonjour(prenom)
        + titre('Votre compte administrateur est prêt')
        + '<p style="margin:0 0 20px">Un compte vient d’être créé pour vous sur le <strong>back-office Kodafrik</strong>. Voici de quoi vous connecter :</p>'
        + info('Identifiant', String(d.email))
        + (mdp ? info('Mot de passe provisoire', mdp, true) : '')
        + code(String(d.codeAcces), "Code d'accès (demandé avant d'entrer dans un espace)")
        + espacesEnPastilles(espaces)
        + bouton('Se connecter au back-office', portail)
        + encadre(mdp
          ? 'Ce mot de passe est <strong>provisoire</strong> : à votre première connexion, vous choisirez le vôtre. Il deviendra le même dans tous vos espaces.'
          : 'Votre mot de passe vous est transmis séparément. À votre première connexion, vous choisirez le vôtre : il deviendra le même dans tous vos espaces.')
        + note("Gardez ces informations confidentielles : l'équipe Kodafrik ne vous demandera jamais votre mot de passe ni votre code d'accès.")
        + signature(auteur);
      const texte = versionTexte([
        salut(prenom), '',
        'Un compte administrateur vient d’être créé pour vous sur le back-office Kodafrik.', '',
        `Identifiant : ${d.email}`,
        ...(mdp ? [`Mot de passe provisoire : ${mdp}`] : []),
        `Code d'accès : ${d.codeAcces}`,
        ...(espaces.length ? [`Vos espaces : ${espaces.join(', ')}`] : []), '',
        `Connexion : ${portail}`, '',
        ...(mdp ? ['Ce mot de passe est provisoire : vous choisirez le vôtre à la première connexion.'] : []),
      ]);
      return { sujet: 'Bienvenue sur le back-office Kodafrik', html: page(html, 'Administration', 'Vos identifiants de connexion au back-office Kodafrik'), texte };
    }

    case 'acces_ouverts': {
      const mdp = String(d.motDePasse || '');
      const html = bonjour(prenom)
        + titre('De nouveaux espaces vous sont ouverts')
        + '<p style="margin:0 0 18px">Vous pouvez désormais administrer ces espaces depuis le back-office Kodafrik, avec votre identifiant et votre code d’accès habituels :</p>'
        + espacesEnPastilles(espaces)
        + (mdp ? info('Mot de passe provisoire pour ces espaces', mdp, true)
          + encadre('À votre prochaine connexion, le portail vous le demandera <strong>une seule fois</strong> puis le remplacera par votre mot de passe habituel.') : '')
        + bouton('Ouvrir le back-office', portail)
        + signature(auteur);
      const texte = versionTexte([
        salut(prenom), '',
        `De nouveaux espaces vous sont ouverts : ${espaces.join(', ')}.`,
        ...(mdp ? [`Mot de passe provisoire pour ces espaces : ${mdp}`] : []),
        '', `Connexion : ${portail}`,
      ]);
      return { sujet: 'De nouveaux espaces vous sont ouverts', html: page(html, 'Administration', 'Vos accès ont été étendus'), texte };
    }

    case 'code_acces': {
      const html = bonjour(prenom)
        + titre("Votre code d'accès a changé")
        + '<p style="margin:0 0 18px">Voici votre nouveau code à quatre chiffres. Il vous sera demandé avant d’entrer dans chacun de vos espaces :</p>'
        + code(String(d.codeAcces), 'Nouveau code')
        + encadre("L'ancien code ne fonctionne plus. Vous n'êtes pas à l'origine de ce changement ? Prévenez l'administrateur principal.", 'bleu')
        + bouton('Se connecter', portail)
        + signature(auteur);
      const texte = versionTexte([salut(prenom), '', `Votre nouveau code d'accès : ${d.codeAcces}`, "L'ancien code ne fonctionne plus.", '', `Connexion : ${portail}`]);
      return { sujet: "Votre nouveau code d'accès Kodafrik", html: page(html, 'Sécurité', "Votre nouveau code d'accès"), texte };
    }

    case 'compte_modifie': {
      const email = String(d.email || '');
      const html = bonjour(prenom)
        + titre('Votre compte a été mis à jour')
        + '<p style="margin:0 0 18px">Un administrateur a modifié les informations de votre compte.</p>'
        + (email ? info('Votre identifiant de connexion', email) : '')
        + encadre('Votre mot de passe et votre code d’accès ne changent pas.', 'bleu')
        + bouton('Ouvrir le back-office', portail)
        + signature(auteur);
      const texte = versionTexte([salut(prenom), '', 'Les informations de votre compte ont été modifiées.', email ? `Identifiant : ${email}` : '', 'Votre mot de passe et votre code d’accès ne changent pas.']);
      return { sujet: 'Votre compte Kodafrik a été mis à jour', html: page(html, 'Administration'), texte };
    }

    case 'compte_desactive': {
      const motif = String(d.motif || '').trim();
      const html = bonjour(prenom)
        + titre('Votre accès est suspendu')
        + '<p style="margin:0 0 18px">Votre compte administrateur a été <strong>désactivé</strong> : vous ne pouvez plus vous connecter au back-office Kodafrik.</p>'
        + (motif ? info('Motif', motif) : '')
        + encadre('Votre compte et son historique sont conservés : il pourra être réactivé. Pour toute question, répondez simplement à cet e-mail.', 'alerte')
        + signature(auteur);
      const texte = versionTexte([salut(prenom), '', 'Votre compte administrateur Kodafrik a été désactivé.', motif ? `Motif : ${motif}` : '', 'Il pourra être réactivé. Pour toute question, répondez à cet e-mail.']);
      return { sujet: 'Votre accès au back-office Kodafrik est suspendu', html: page(html, 'Administration'), texte };
    }

    case 'compte_reactive': {
      const html = bonjour(prenom)
        + titre('Votre accès est rétabli')
        + '<p style="margin:0 0 18px">Bonne nouvelle : votre compte administrateur est de nouveau actif. Vous pouvez vous connecter avec votre identifiant, votre mot de passe et votre code d’accès habituels.</p>'
        + bouton('Se connecter', portail)
        + signature(auteur);
      const texte = versionTexte([salut(prenom), '', 'Votre compte administrateur Kodafrik est de nouveau actif.', `Connexion : ${portail}`]);
      return { sujet: 'Votre accès au back-office Kodafrik est rétabli', html: page(html, 'Administration'), texte };
    }

    case 'compte_supprime': {
      const html = bonjour(prenom)
        + titre('Votre compte a été supprimé')
        + '<p style="margin:0 0 18px">Votre compte administrateur du back-office Kodafrik a été supprimé. Vous n’y avez plus accès.</p>'
        + encadre("S'il s'agit d'une erreur, répondez simplement à cet e-mail.", 'alerte')
        + signature(auteur);
      const texte = versionTexte([salut(prenom), '', 'Votre compte administrateur Kodafrik a été supprimé.', "S'il s'agit d'une erreur, répondez à cet e-mail."]);
      return { sujet: 'Votre compte Kodafrik a été supprimé', html: page(html, 'Administration'), texte };
    }

    case 'reponse_message': {
      const origine = String(d.messageOrigine || '').trim();
      const html = bonjour(prenom)
        + paragraphes(d.message)
        + signature(auteur)
        + (origine
          ? `<div style="margin:22px 0 0;padding:12px 14px;border-left:3px solid #D9E2F2;background:#F8FAFD;border-radius:0 10px 10px 0;font-size:13px;color:${DISCRET}">`
            + `<div style="font-size:12px;font-weight:bold;margin:0 0 6px">Votre message${d.dateOrigine ? ` du ${echapper(d.dateOrigine)}` : ''}</div>`
            + `${nl2br(echapper(extrait(origine, 3000)))}</div>`
          : '');
      const texte = versionTexte([
        salut(prenom), '', String(d.message || '').trim(), '', 'À bientôt,', auteur || "L'équipe Kodafrik",
        ...(origine ? ['', `> ${origine.replace(/\n/g, '\n> ')}`] : []),
      ]);
      return { sujet: String(d.sujet || '') || 'Votre demande à Kodafrik', html: page(html, 'Votre projet', extrait(d.message)), texte };
    }

    case 'message_libre': {
      const lien = String(d.lien || '').trim();
      const libelle = String(d.libelleLien || '').trim() || 'Ouvrir';
      const lienSur = /^https:\/\//.test(lien);
      const html = bonjour(prenom)
        + titre(String(d.sujet))
        + paragraphes(d.message)
        + (lienSur ? bouton(libelle, lien) : '')
        + signature(auteur);
      const texte = versionTexte([salut(prenom), '', String(d.message || '').trim(), lienSur ? `\n${libelle} : ${lien}` : '', '', 'À bientôt,', auteur || "L'équipe Kodafrik"]);
      return { sujet: String(d.sujet), html: page(html, 'Message', extrait(d.message)), texte };
    }

    case 'contact_recu': {
      // Interne : la notification d'une demande du formulaire, pour contact@kodafrik.com.
      const lignes = [
        ['Nom', d.nom], ['Entreprise', d.entreprise], ['E-mail', d.email],
        ['Téléphone', d.telephone], ['Type de projet', d.type], ['Budget estimé', d.budget],
      ];
      const table = lignes.map(([l, v]) => `<tr><td width="130" style="width:130px;padding:8px 12px 8px 0;font-size:12px;color:${DISCRET};white-space:nowrap;vertical-align:top">${echapper(l)}</td>`
        + `<td style="padding:8px 0;font-size:14px;font-weight:bold;color:${ENCRE}">${v ? echapper(v) : '—'}</td></tr>`).join('');
      const html = titre('Nouvelle demande depuis kodafrik.com')
        + `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 16px;width:100%;border-top:1px solid #EEF1F6">${table}</table>`
        + `<div style="font-size:12px;color:${DISCRET};margin:0 0 6px">Projet</div>`
        + `<div style="padding:14px;background:#F8FAFD;border-radius:10px;margin:0 0 18px">${paragraphes(d.message)}</div>`
        + bouton('Voir dans le dashboard', `${portail}kodafrik/site-vitrine`)
        + note(`Répondez directement à cet e-mail pour écrire au client. Reçu le ${echapper(dateFr(maintenant))}.`);
      const texte = versionTexte([
        'Nouvelle demande reçue depuis le formulaire de kodafrik.com', '-'.repeat(50),
        ...lignes.map(([l, v]) => `${l} : ${v || '—'}`),
        '', 'Projet :', String(d.message || ''), '', 'Répondez directement à ce mail pour écrire au client.',
      ]);
      return {
        sujet: `Demande de devis — ${d.type || 'Nouveau projet'} — ${d.nom}`,
        html: page(html, 'Site vitrine', `Nouvelle demande de ${d.nom}`),
        texte,
      };
    }

    default:
      throw new Error(`Modèle inconnu : ${modele}`);
  }
}

module.exports = { MODELES, rendre, echapper };
