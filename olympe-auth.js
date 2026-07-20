/* ═══════════════════════════════════════════════════════════════════════════
 * 0LYMPE — Couche d'authentification
 * Partagée par la page de connexion (/index.html) et l'app (/app/index.html).
 * Dépendances : assets/vendor/supabase.js + assets/olympe-config.js (dans cet ordre)
 *
 * Rappel d'architecture — à ne pas perdre de vue :
 *   Séparer la page de login de l'app ne « cache » PAS l'app : Netlify sert du
 *   statique, n'importe qui peut télécharger /app/index.html. Ça n'a aucune
 *   importance — le fichier ne contient AUCUNE donnée. La sécurité réelle,
 *   c'est le RLS Postgres : sans JWT valide, Supabase renvoie 0 ligne.
 *   Le garde ci-dessous est de l'ergonomie (rediriger), pas du blindage.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var CFG = global.OLYMPE_CFG;
  if (!CFG) throw new Error('[OlympeAuth] olympe-config.js manquant ou chargé après olympe-auth.js');
  if (!global.supabase || !global.supabase.createClient)
    throw new Error('[OlympeAuth] assets/vendor/supabase.js manquant ou chargé après olympe-auth.js');
  if (CFG.url.indexOf('XXXX') >= 0)
    console.error('[OlympeAuth] assets/olympe-config.js n\'est pas configuré (url/anonKey encore en XXXX).');

  var _client  = null;
  var _profile = null;

  function log() { if (CFG.debug) console.log.apply(console, ['[auth]'].concat([].slice.call(arguments))); }

  /* Jeton machine — lu ICI parce qu'il doit partir dans les en-têtes du client,
     donc avant sa création. olympe-mfa.js le gère ensuite (rotation, hash…).
     32 octets aléatoires ; seul son SHA-256 existe en base. */
  function deviceToken() {
    try {
      var t = localStorage.getItem('olympe.device');
      if (t && t.length === 64) return t;
      var b = new Uint8Array(32);
      (global.crypto || global.msCrypto).getRandomValues(b);
      t = Array.from(b).map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
      localStorage.setItem('olympe.device', t);
      return t;
    } catch (e) { return ''; }   // navigation privée verrouillée : pas de jeton
  }

  /* Client unique, réutilisé partout. persistSession:true → le refresh token
     survit à un rechargement, l'agent ne retape pas son mot de passe.

     x-olympe-device : le jeton machine part sur CHAQUE requête. Postgres le
     vérifie lui-même (device_ok()). C'est ce qui fait de la liste blanche de
     machines une vraie règle serveur et pas une condition JavaScript. */
  function client() {
    if (_client) return _client;
    _client = global.supabase.createClient(CFG.url, CFG.anonKey, {
      auth: {
        persistSession:      true,
        autoRefreshToken:    true,
        detectSessionInUrl:  false,
        storageKey:          'olympe.auth'
      },
      global: { headers: { 'x-olympe-device': deviceToken() } }
    });
    return _client;
  }

  /* "cedric" → "cedric@0lympe.local". Aucune vraie adresse n'est manipulée. */
  function uidToEmail(uid) {
    return String(uid || '').trim().toLowerCase() + '@' + CFG.emailDomain;
  }

  /* Messages Supabase → français métier. */
  function humanError(err) {
    var m = (err && (err.message || err.error_description) || '').toLowerCase();
    if (m.indexOf('invalid login credentials') >= 0) return 'Identifiant ou mot de passe incorrect.';
    if (m.indexOf('email not confirmed')       >= 0) return 'Compte non confirmé — préviens l\'administrateur.';
    if (m.indexOf('at least 6 characters')     >= 0) return 'Le mot de passe doit faire au moins 6 caractères.';
    if (m.indexOf('rate limit') >= 0 || m.indexOf('too many') >= 0)
      return 'Trop de tentatives. Patiente une minute.';
    if (m.indexOf('invalid totp code') >= 0 || m.indexOf('invalid mfa') >= 0 || m.indexOf('challenge') >= 0)
      return 'Code Authenticator invalide ou expire. Le code change toutes les 30 s.';
    if (m.indexOf('factor') >= 0 && m.indexOf('exists') >= 0)
      return 'Un enrolement est deja en cours. Recharge la page.';
    if (m.indexOf('aal2') >= 0 || m.indexOf('assurance') >= 0)
      return 'Code Authenticator requis pour cette action.';
    if (m.indexOf('failed to fetch') >= 0 || m.indexOf('networkerror') >= 0)
      return 'Serveur injoignable — vérifie la connexion réseau.';
    return (err && err.message) ? err.message : 'Erreur inconnue.';
  }

  var API = {
    client:      client,
    uidToEmail:  uidToEmail,
    humanError:  humanError,
    deviceToken: deviceToken,

    /* ── Connexion ─────────────────────────────────────────────────────── */
    signIn: function (uid, password) {
      return client().auth.signInWithPassword({
        email:    uidToEmail(uid),
        password: password
      }).then(function (r) {
        if (r.error) throw r.error;
        log('connecté', r.data.user.id);
        return r.data.session;
      });
    },

    signOut: function () {
      _profile = null;
      return client().auth.signOut().catch(function () { /* déconnexion locale quoi qu'il arrive */ });
    },

    session: function () {
      return client().auth.getSession().then(function (r) { return (r.data && r.data.session) || null; });
    },

    /* ── Profil (rôle, nom) — lu en base, pas dans le JS ────────────────
       C'est la table `profile` qui fait foi. Un agent ne peut pas se
       promouvoir admin : le RLS interdit l'UPDATE sauf aux admins. */
    profile: function (force) {
      if (_profile && !force) return Promise.resolve(_profile);
      return client().auth.getUser().then(function (r) {
        var u = r.data && r.data.user;
        if (!u) return null;
        return client().from('profile')
          .select('uid,nom,role,actif').eq('id', u.id).single()
          .then(function (p) {
            if (p.error || !p.data) {
              console.error('[auth] profil introuvable pour', u.id, p.error);
              return null;
            }
            if (p.data.actif === false) return null;   // compte désactivé
            _profile = p.data;
            return _profile;
          });
      });
    },

    /* ── Garde d'accès ─────────────────────────────────────────────────
       Utilisé au boot de l'app. Pas de session ou pas de profil actif
       → retour à la page de connexion. */
    requireSession: function (loginUrl) {
      loginUrl = loginUrl || 'index.html';
      return API.session().then(function (s) {
        if (!s) { location.replace(loginUrl); return Promise.reject(new Error('__redirect__')); }
        return API.profile().then(function (p) {
          if (!p) {
            return API.signOut().then(function () {
              location.replace(loginUrl + '?e=profil');
              return Promise.reject(new Error('__redirect__'));
            });
          }
          return { session: s, profile: p };
        });
      });
    },

    /* Déconnexion forcée si le refresh token est révoqué côté serveur
       (agent supprimé, mot de passe changé, session expirée). */
    watchSignOut: function (onGone) {
      client().auth.onAuthStateChange(function (event) {
        if (event === 'SIGNED_OUT') onGone();
      });
    },

    markPasswordChanged: function () {
      return client().rpc('mark_password_changed').then(function (r) {
        if (r.error) throw r.error;
        if (_profile) _profile.must_change_password = false;
        return true;
      });
    },

    changePassword: function (newPw) {
      return client().auth.updateUser({ password: newPw }).then(function (r) {
        if (r.error) throw r.error;
        return true;
      });
    }
  };

  global.OlympeAuth = API;
})(window);
