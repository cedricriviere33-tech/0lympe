/* ═══════════════════════════════════════════════════════════════════════════
 * 0LYMPE — Authenticator (TOTP) + machines autorisées
 * Dépendances : vendor/supabase.js → olympe-config.js → olympe-auth.js → ce fichier
 *
 * ── CE QUE CHAQUE BRIQUE FAIT (et ne fait PAS) ─────────────────────────────
 *
 *  Authenticator (TOTP)  = « tu détiens le téléphone où est le secret ».
 *                          Ne sait RIEN de la machine, du réseau, de l'IP.
 *                          Ce n'est PAS un mécanisme d'identification d'appareil.
 *
 *  Jeton machine         = un secret aléatoire par navigateur (localStorage).
 *                          Envoyé en en-tête `x-olympe-device`, VÉRIFIÉ PAR
 *                          POSTGRES (device_ok()). C'est ça, la liste blanche
 *                          de machines — pas du fingerprinting, qui se falsifie.
 *
 *  IP                    = AUDIT uniquement, capturée côté serveur par
 *                          PostgREST. Le navigateur ne connaît pas sa propre
 *                          IP publique et pourrait mentir. Et à la PIC tous
 *                          les postes sortent derrière la même IP (NAT) : ça
 *                          ne distingue rien du tout.
 *
 * ── LE LIEN ENTRE LES DEUX ─────────────────────────────────────────────────
 *  Nouvelle machine → jeton inconnu → device_ok() = false → 0 ligne.
 *  Pour l'approuver, il faut une session aal2, c'est-à-dire un code
 *  Authenticator validé. La règle est dans la policy `dev_update`, pas ici.
 *  Le JavaScript ci-dessous ne fait que l'ergonomie : même en le réécrivant
 *  entièrement, on n'approuve pas une machine sans le code à 6 chiffres.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var DEVICE_KEY = 'olympe.device';

  function log() { if ((global.OLYMPE_CFG || {}).debug) console.log.apply(console, ['[mfa]'].concat([].slice.call(arguments))); }
  function SB() { return global.OlympeAuth.client(); }

  // ═══ Jeton machine ═══════════════════════════════════════════════════════
  // 32 octets aléatoires. Seul son SHA-256 part en base : lire la table
  // `device` ne donne aucun jeton réutilisable.
  function deviceToken() {
    var t = null;
    try { t = localStorage.getItem(DEVICE_KEY); } catch (e) { return null; }
    if (t && t.length === 64) return t;
    var b = new Uint8Array(32);
    (global.crypto || global.msCrypto).getRandomValues(b);
    t = Array.from(b).map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    try { localStorage.setItem(DEVICE_KEY, t); } catch (e) { return null; }
    log('nouveau jeton machine');
    return t;
  }

  // Doit produire exactement le même résultat que, côté Postgres :
  //   encode(digest(token, 'sha256'), 'hex')
  function sha256hex(s) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    });
  }

  // Étiquette lisible pour le panneau admin : « Chrome · Windows ».
  // C'est du confort d'affichage, jamais un critère de sécurité — tout ça se
  // falsifie en deux clics.
  function guessLabel() {
    var u = navigator.userAgent, os = 'Inconnu', nav = 'Navigateur';
    if (/Windows NT/.test(u))        os = 'Windows';
    else if (/Android/.test(u))      os = 'Android';
    else if (/iPhone|iPad/.test(u))  os = 'iPhone/iPad';
    else if (/Mac OS X/.test(u))     os = 'Mac';
    else if (/Linux/.test(u))        os = 'Linux';
    if (/Edg\//.test(u))             nav = 'Edge';
    else if (/OPR\//.test(u))        nav = 'Opera';
    else if (/Chrome\//.test(u))     nav = 'Chrome';
    else if (/Firefox\//.test(u))    nav = 'Firefox';
    else if (/Safari\//.test(u))     nav = 'Safari';
    return nav + ' \u00b7 ' + os;
  }

  var API = {
    deviceToken: deviceToken,
    guessLabel:  guessLabel,

    // ═══ Authenticator ═════════════════════════════════════════════════════

    /* aal1 = mot de passe seul · aal2 = mot de passe + code Authenticator.
       nextLevel = aal2 quand l'agent a un facteur vérifié → il DOIT le passer. */
    aal: function () {
      var r = SB().auth.mfa.getAuthenticatorAssuranceLevel();
      return Promise.resolve(r).then(function (x) { return (x && x.data) || { currentLevel: null, nextLevel: null }; });
    },

    factors: function () {
      return SB().auth.mfa.listFactors().then(function (r) {
        if (r.error) throw r.error;
        var all = (r.data && r.data.totp) || [];
        return {
          verified:   all.filter(function (f) { return f.status === 'verified'; }),
          unverified: all.filter(function (f) { return f.status !== 'verified'; })
        };
      });
    },

    /* Enrôlement. Retourne un QR (SVG en data-URL) + le secret en clair pour
       la saisie manuelle (téléphone sans caméra, ou QR illisible à l'écran).
       friendlyName doit être UNIQUE par utilisateur : un doublon fait tomber
       l'API en 500. D'où l'horodatage. */
    enroll: function () {
      return API.factors().then(function (f) {
        // Ménage : un enrôlement abandonné laisse un facteur non vérifié qui
        // bloque les suivants.
        var clean = f.unverified.reduce(function (p, x) {
          return p.then(function () { return SB().auth.mfa.unenroll({ factorId: x.id }); });
        }, Promise.resolve());
        return clean.then(function () {
          return SB().auth.mfa.enroll({
            factorType:   'totp',
            friendlyName: 'Olympe ' + new Date().toISOString().slice(0, 16).replace('T', ' ')
          });
        });
      }).then(function (r) {
        if (r.error) throw r.error;
        var t = r.data.totp || {};
        return { factorId: r.data.id, qr: t.qr_code, secret: t.secret, uri: t.uri };
      });
    },

    /* Valide le code à 6 chiffres. En cas de succès la session passe aal2 :
       c'est ce nouveau JWT qui débloque le RLS, pas un booléen JavaScript. */
    verify: function (factorId, code) {
      code = String(code || '').replace(/\D/g, '');
      if (code.length !== 6) return Promise.reject(new Error('Le code fait 6 chiffres.'));
      return SB().auth.mfa.challengeAndVerify({ factorId: factorId, code: code })
        .then(function (r) { if (r.error) throw r.error; return r.data; });
    },

    /* Retire l'Authenticator. Supabase exige aal2 pour retirer un facteur
       vérifié : impossible de se le retirer sans le téléphone. */
    unenroll: function (factorId) {
      return SB().auth.mfa.unenroll({ factorId: factorId })
        .then(function (r) { if (r.error) throw r.error; return true; });
    },

    // ═══ Machines ══════════════════════════════════════════════════════════

    /* La machine courante, telle que la base la connaît.
         null            → jamais enregistrée
         {approved:false}→ enregistrée, en attente de validation
         {approved:true} → autorisée */
    current: function () {
      return Promise.resolve(null); /* device désactivé */
      var t = deviceToken();
      if (!t) return Promise.resolve(null);
      return sha256hex(t).then(function (h) {
        return SB().from('device').select('*').eq('token_hash', h).maybeSingle();
      }).then(function (r) {
        if (r.error) { log('lecture machine :', r.error.message); return null; }
        return r.data || null;
      });
    },

    /* Enregistre la machine. Elle naît TOUJOURS non approuvée : le trigger
       device_stamp force approved=false, ip et user-agent à l'insertion.
       Le client ne choisit ni son IP, ni son statut. */
    register: function (label) {
      var t = deviceToken();
      if (!t) return Promise.reject(new Error('Stockage local indisponible — machine non enregistrable.'));
      return Promise.all([sha256hex(t), SB().auth.getUser()]).then(function (a) {
        var u = a[1].data && a[1].data.user;
        if (!u) throw new Error('Session absente.');
        return SB().from('device').insert({
          user_id: u.id, uid: '?', token_hash: a[0], label: label || guessLabel()
        }).select().single();
      }).then(function (r) {
        if (r.error) throw r.error;
        log('machine enregistree', r.data.id);
        return r.data;
      });
    },

    /* Approuve une machine. Le RLS n'accepte cet UPDATE que si la session est
       aal2 (= code Authenticator validé) ou si l'appelant est admin.
       Appeler ça sans aal2 renvoie 0 ligne — pas une erreur, un silence.
       D'où la vérification du retour. */
    approve: function (id) {
      return SB().from('device').update({ approved: true }).eq('id', id).select()
        .then(function (r) {
          if (r.error) throw r.error;
          if (!r.data || !r.data.length)
            throw new Error('Approbation refusee par le serveur (code Authenticator requis).');
          return r.data[0];
        });
    },

    list: function () {
      return Promise.resolve([]); /* device désactivé */
      return SB().from('device')
        .select('id,uid,label,approved,approved_by,approved_at,revoked,ip_first,ip_last,created_at,last_seen_at,user_agent')
        .order('last_seen_at', { ascending: false })
        .then(function (r) { if (r.error) throw r.error; return r.data || []; });
    },

    revoke: function (id, on) {
      return SB().from('device').update({ revoked: on !== false }).eq('id', id)
        .then(function (r) { if (r.error) throw r.error; return true; });
    },

    /* Marque la machine vue. Le trigger réécrit ip_last et last_seen_at
       côté serveur au passage. */
    touch: function (id) {
      return Promise.resolve(); /* device désactivé */
      return SB().from('device').update({ label: undefined }).eq('id', id)
        .then(function () {}).catch(function () {});
    },

    // ═══ Journal ═══════════════════════════════════════════════════════════
    logAccess: function () {
      return Promise.resolve(); /* journal désactivé */
      var t = null; try { t = localStorage.getItem(DEVICE_KEY); } catch (e) {}
      return SB().rpc('log_access', { p_device: t ? t.slice(0, 8) : null })
        .then(function () {}).catch(function (e) { log('journal :', e.message); });
    },

    accessLog: function (n) {
      return SB().from('access_log').select('uid,at,ip,aal,device,ua')
        .order('at', { ascending: false }).limit(n || 50)
        .then(function (r) { if (r.error) throw r.error; return r.data || []; });
    },

    config: function () {
      return SB().from('app_config').select('key,value').then(function (r) {
        var o = { device_lock: false, mfa_admin: false };
        if (!r.error) (r.data || []).forEach(function (x) { o[x.key] = x.value === 'true'; });
        return o;
      });
    },

    // ═══ Décision de boot ══════════════════════════════════════════════════
    /* Que faut-il faire avant de laisser entrer l'agent ?
         'ok'       → rien, il entre
         'mfa'      → il a un Authenticator : code exigé (le RLS l'exigera de toute façon)
         'enroll'   → verrou machine actif, machine inconnue, pas d'Authenticator
                      → il doit en enrôler un pour approuver sa machine
         'approve'  → machine inconnue mais Authenticator présent → code puis approbation
         'pending'  → machine en attente de validation par un admin */
    gate: function () {
      return Promise.resolve({ action: 'ok' }); /* Authenticator retiré — simplifie */
      return Promise.all([API.aal(), API.factors(), API.config()]).then(function (a) {
        var aal = a[0], f = a[1], cfg = a[2];
        var hasTotp = f.verified.length > 0;
        var isAal2  = aal.currentLevel === 'aal2';

        if (hasTotp && !isAal2)
          return { action: 'mfa', factorId: f.verified[0].id, cfg: cfg };

        if (!cfg.device_lock) return { action: 'ok', cfg: cfg };

        return API.current().then(function (d) {
          if (d && d.approved && !d.revoked) return { action: 'ok', device: d, cfg: cfg };
          if (d && d.revoked)  return { action: 'revoked', device: d, cfg: cfg };
          if (d && !d.approved) {
            if (isAal2) return { action: 'approve', device: d, cfg: cfg };
            return { action: hasTotp ? 'mfa' : 'pending', device: d,
                     factorId: hasTotp ? f.verified[0].id : null, cfg: cfg };
          }
          // Machine jamais vue
          if (!hasTotp) return { action: 'enroll', cfg: cfg };
          return { action: isAal2 ? 'approve' : 'mfa',
                   factorId: hasTotp ? f.verified[0].id : null, cfg: cfg };
        });
      });
    }
  };

  global.OlympeMFA = API;
})(window);
