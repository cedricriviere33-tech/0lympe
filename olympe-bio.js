/* ═══════════════════════════════════════════════════════════════════════════
 * 0LYMPE — Déverrouillage par empreinte ou visage
 * build bio-2026-09-21-BIO1
 *
 * CE QUE ÇA FAIT
 * Une fois activé sur un téléphone, l'agent n'a plus à taper le mot de passe
 * du compte partagé (gillot / pfa) : Face ID, Touch ID ou l'empreinte Android
 * ouvrent la session. Le code à quatre chiffres du profil reste demandé —
 * c'est lui qui dit QUI travaille, et il ne doit pas disparaître.
 *
 * COMMENT
 * Le navigateur expose la biométrie de l'appareil par WebAuthn. Aucune
 * empreinte, aucun visage ne quitte le téléphone ni n'arrive jusqu'à Olympe :
 * le système d'exploitation vérifie la personne, et ne rend qu'un « oui ».
 * Ce oui sert à déverrouiller le mot de passe du compte, chiffré et rangé
 * sur l'appareil.
 *
 * DEUX NIVEAUX, ET IL FAUT SAVOIR LEQUEL ON A
 *
 *   « biometrie » — l'appareil gère l'extension PRF (Android récent, iOS 18+).
 *     La clé de chiffrement est DÉRIVÉE de la biométrie : sans empreinte
 *     valide, le mot de passe rangé est indéchiffrable, même en lisant le
 *     stockage du navigateur. C'est le bon niveau.
 *
 *   « appareil » — l'appareil ne gère pas PRF. La clé est alors rangée à
 *     côté du secret, et la biométrie n'est qu'une porte devant : elle évite
 *     qu'un collègue ouvre la session sur un téléphone déverrouillé, mais
 *     quelqu'un qui sait lire le stockage du navigateur retrouverait le mot
 *     de passe du compte partagé. C'est une COMMODITÉ D'ACCÈS, pas un
 *     renforcement de la sécurité, et l'écran le dit à l'agent.
 *
 * Dans les deux cas l'autorité reste côté serveur : politiques RLS, jeton
 * d'appareil (x-olympe-device), et le code à quatre chiffres du profil.
 *
 * CE QUE ÇA NE FAIT PAS
 * Ce n'est pas une passkey vérifiée par le serveur. Une vraie passkey ne
 * stockerait aucun secret sur l'appareil : le serveur enverrait un défi et
 * vérifierait une signature. Cela demande une fonction Edge côté Supabase et
 * une table de clés publiques — à faire le jour où on veut supprimer
 * complètement le mot de passe partagé.
 *
 * LIÉ AU DOMAINE
 * WebAuthn attache la clé au nom de domaine. Si l'adresse d'Olympe change
 * (migration de serveur), les activations sont perdues et chaque agent
 * réactive en tapant son mot de passe une fois. Rien n'est cassé, mais il
 * faut le savoir avant de migrer.
 *
 * DIAGNOSTIC : OlympeBio.etat()
 * ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';
  if (global.OlympeBio) return;

  var CLE     = 'olympe_bio_v1';
  var BUILD   = 'bio-2026-09-21-BIO1';
  var TIMEOUT = 60000;

  /* ── Outils binaires ─────────────────────────────────────────────────── */
  function alea(n) { var b = new Uint8Array(n); crypto.getRandomValues(b); return b; }
  function b64(buf) {
    var b = new Uint8Array(buf), s = '', i;
    for (i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  function deb64(s) {
    var t = atob(String(s || '')), b = new Uint8Array(t.length), i;
    for (i = 0; i < t.length; i++) b[i] = t.charCodeAt(i);
    return b;
  }
  function utf8(s) { return new TextEncoder().encode(String(s)); }

  /* ── Stockage ────────────────────────────────────────────────────────── */
  function tout() {
    try { return JSON.parse(localStorage.getItem(CLE) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function ecrire(o) {
    try { localStorage.setItem(CLE, JSON.stringify(o)); return true; }
    catch (e) { console.warn('[bio] écriture impossible', e); return false; }
  }
  function fiche(compte) { return tout()[String(compte || '').toLowerCase()] || null; }

  /* ── Disponibilité ───────────────────────────────────────────────────── */
  function supporte() {
    return !!(global.PublicKeyCredential && global.navigator && navigator.credentials
              && navigator.credentials.create && global.crypto && crypto.subtle);
  }
  /* L'authentificateur « plateforme » est celui intégré au téléphone : Face
     ID, Touch ID, capteur d'empreinte. On ne veut pas d'une clé USB ici. */
  function disponible() {
    if (!supporte()) return Promise.resolve(false);
    if (!PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) return Promise.resolve(false);
    return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
      .then(function (ok) { return !!ok; })
      .catch(function () { return false; });
  }
  function activee(compte) { return !!fiche(compte); }

  /* ── Chiffrement ─────────────────────────────────────────────────────── */
  function cleDepuis(octets, sel) {
    return crypto.subtle.importKey('raw', octets, 'HKDF', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'HKDF', hash: 'SHA-256', salt: sel, info: utf8('olympe-bio-v1') },
          base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
  }
  function chiffrer(cle, texte) {
    var iv = alea(12);
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, cle, utf8(texte))
      .then(function (c) { return { iv: b64(iv), blob: b64(c) }; });
  }
  function dechiffrer(cle, iv, blob) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: deb64(iv) }, cle, deb64(blob))
      .then(function (c) { return new TextDecoder().decode(c); });
  }

  /* ── WebAuthn ────────────────────────────────────────────────────────── */
  function rpId() { try { return location.hostname; } catch (e) { return undefined; } }

  function creer(compte, sel) {
    return navigator.credentials.create({
      publicKey: {
        challenge: alea(32),
        rp: { name: 'Olympe — PIC Gillot Import', id: rpId() },
        user: { id: utf8('olympe:' + compte), name: compte, displayName: 'Olympe · ' + compte },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',   /* la biométrie du téléphone */
          userVerification: 'required',          /* pas de simple présence */
          residentKey: 'preferred'
        },
        timeout: TIMEOUT,
        attestation: 'none',                     /* aucune donnée d'identification matérielle */
        extensions: { prf: { eval: { first: sel } } }
      }
    });
  }

  function verifier(credId, sel) {
    return navigator.credentials.get({
      publicKey: {
        challenge: alea(32),
        rpId: rpId(),
        allowCredentials: credId ? [{ type: 'public-key', id: deb64(credId) }] : [],
        userVerification: 'required',
        timeout: TIMEOUT,
        extensions: { prf: { eval: { first: sel } } }
      }
    });
  }

  /* Le secret PRF n'est pas toujours rendu à la création : la plupart des
     plateformes ne le donnent qu'à la première vérification. On tente donc
     les deux, et on retient ce qui vient. */
  function prfDe(assertion) {
    try {
      var r = assertion.getClientExtensionResults();
      if (r && r.prf && r.prf.results && r.prf.results.first) return new Uint8Array(r.prf.results.first);
    } catch (e) {}
    return null;
  }

  /* ── Activation ──────────────────────────────────────────────────────── */
  function activer(compte, motDePasse, etiquette) {
    compte = String(compte || '').toLowerCase();
    if (!compte || !motDePasse) return Promise.reject(new Error('Compte ou mot de passe manquant.'));
    if (!supporte()) return Promise.reject(new Error('Ce navigateur ne gère pas le déverrouillage biométrique.'));

    var sel = alea(32);
    return creer(compte, sel).then(function (cred) {
      if (!cred) throw new Error('Activation annulée.');
      var credId = b64(cred.rawId);

      /* On enchaîne sur une vérification : elle confirme que la biométrie
         fonctionne vraiment, et c'est là que le secret PRF arrive. */
      return verifier(credId, sel).then(function (asr) {
        var prf = prfDe(asr) || prfDe(cred);
        var niveau = prf ? 'biometrie' : 'appareil';
        var matiere = prf || alea(32);   /* repli : clé locale, voir l'en-tête */

        return cleDepuis(matiere, sel).then(function (cle) {
          return chiffrer(cle, motDePasse).then(function (c) {
            var o = tout();
            o[compte] = {
              credId: credId, sel: b64(sel), iv: c.iv, blob: c.blob,
              niveau: niveau,
              /* En mode « appareil » seulement : la clé doit être conservée,
                 puisque la biométrie ne la reconstruit pas. C'est ce qui
                 rend ce mode plus faible, et pourquoi il est nommé. */
              cleLocale: prf ? null : b64(matiere),
              etiquette: String(etiquette || '').slice(0, 60),
              cree: Date.now(), dernier: null
            };
            if (!ecrire(o)) throw new Error('Impossible d\'enregistrer sur cet appareil.');
            return { ok: true, niveau: niveau, compte: compte };
          });
        });
      });
    });
  }

  /* ── Ouverture ───────────────────────────────────────────────────────── */
  function ouvrir(compte) {
    compte = String(compte || '').toLowerCase();
    var f = fiche(compte);
    if (!f) return Promise.reject(new Error('Déverrouillage non activé pour ce compte.'));
    if (!supporte()) return Promise.reject(new Error('Ce navigateur ne gère pas le déverrouillage biométrique.'));

    var sel = deb64(f.sel);
    return verifier(f.credId, sel).then(function (asr) {
      if (!asr) throw new Error('Vérification annulée.');
      var matiere;
      if (f.niveau === 'biometrie') {
        matiere = prfDe(asr);
        /* Si la plateforme cesse de rendre le secret (mise à jour du système,
           changement de navigateur), on ne devine pas : on le dit et on
           demande une réactivation. Un déchiffrement au hasard échouerait
           avec un message incompréhensible. */
        if (!matiere) throw new Error('Cet appareil ne rend plus la clé biométrique. Réactive le déverrouillage.');
      } else {
        matiere = deb64(f.cleLocale || '');
      }
      return cleDepuis(matiere, sel)
        .then(function (cle) { return dechiffrer(cle, f.iv, f.blob); })
        .then(function (mdp) {
          var o = tout();
          if (o[compte]) { o[compte].dernier = Date.now(); ecrire(o); }
          return { compte: compte, motDePasse: mdp, niveau: f.niveau };
        })
        .catch(function () {
          throw new Error('Déverrouillage impossible. Réactive-le en te connectant avec ton mot de passe.');
        });
    });
  }

  /* ── Révocation ──────────────────────────────────────────────────────── */
  function oublier(compte) {
    var o = tout();
    delete o[String(compte || '').toLowerCase()];
    return ecrire(o);
  }
  function toutOublier() { try { localStorage.removeItem(CLE); return true; } catch (e) { return false; } }

  function etat() {
    var o = tout();
    return {
      build: BUILD, supporte: supporte(), domaine: rpId(),
      comptes: Object.keys(o).map(function (c) {
        return { compte: c, niveau: o[c].niveau, etiquette: o[c].etiquette,
                 cree: o[c].cree, dernier: o[c].dernier };
      })
    };
  }

  /* Étiquette lisible de l'appareil, pour que l'agent reconnaisse le sien. */
  function etiquetteAppareil() {
    var ua = String(navigator.userAgent || '');
    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/iPad/i.test(ua)) return 'iPad';
    if (/Android/i.test(ua)) return 'Android';
    if (/Macintosh/i.test(ua)) return 'Mac';
    if (/Windows/i.test(ua)) return 'PC Windows';
    return 'Cet appareil';
  }
  /* Le nom que porte la biométrie sur l'appareil, pour parler sa langue. */
  function nomBiometrie() {
    var ua = String(navigator.userAgent || '');
    if (/iPhone|iPad|Macintosh/i.test(ua)) return 'Face ID / Touch ID';
    if (/Android/i.test(ua)) return 'empreinte ou visage';
    return 'Windows Hello';
  }

  global.OlympeBio = {
    BUILD: BUILD,
    supporte: supporte, disponible: disponible, activee: activee,
    activer: activer, ouvrir: ouvrir, oublier: oublier, toutOublier: toutOublier,
    fiche: fiche, etat: etat,
    etiquetteAppareil: etiquetteAppareil, nomBiometrie: nomBiometrie
  };

  try { console.info('[olympe-bio] ' + BUILD + ' — domaine ' + rpId()); } catch (e) {}
})(window);
