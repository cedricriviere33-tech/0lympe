/* ═══════════════════════════════════════════════════════════════════════════
 * 0LYMPE — Store Supabase
 * Remplace le backend IndexedDB de OlympeDB. Chargé AVANT le script d'Olympe,
 * activé par OlympeStore.attach(OlympeDB) juste après la définition du module.
 * Dépendances : vendor/supabase.js → olympe-config.js → olympe-auth.js → ce fichier
 *
 * ── POURQUOI CETTE ARCHITECTURE ────────────────────────────────────────────
 * Olympe lit ses données de façon SYNCHRONE (OlympeDB.getItem renvoie une
 * string, tout de suite) sur 22 000 lignes. Supabase est asynchrone. Réécrire
 * l'app en async = des mois et des régressions partout.
 *
 * Donc : l'API publique de OlympeDB ne bouge pas d'un poil. On remplace
 * seulement ce qu'il y a DESSOUS :
 *
 *   getItem(k)     → cache mémoire (hydraté au boot par UN select Supabase)
 *   setItem(k, v)  → cache mémoire + diff blob→lignes + upsert débouncé
 *   realtime       → applique les changements des autres postes dans le cache
 *
 * ── LE POINT CRITIQUE : blob ↔ lignes ──────────────────────────────────────
 * Olympe stocke 1 clé = 1 gros JSON ("olympe_histo_sac" = TOUTES les sessions).
 * Si on synchronisait ce blob tel quel : Jérémie flashe une session pendant que
 * tu clôtures une réexpédition → le dernier setItem écrase le travail de
 * l'autre. Perte de données garantie.
 *
 * On éclate donc chaque blob en lignes (scope, entry_id) avant l'envoi, et on
 * ne pousse QUE les entrées réellement modifiées. Deux agents sur deux sessions
 * différentes ne se croisent jamais. Le merge est fait par la clé primaire
 * Postgres, pas par un algorithme maison.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var CFG = global.OLYMPE_CFG || {};

  /* ── Référentiel partagé ────────────────────────────────────────────────
     SCOPES, CUMULATIVE, MIRROR et les adaptateurs vivent dans
     olympe-scopes.js, chargé avant ce fichier. Le store n'en garde aucune
     copie : c'est la duplication de ces listes entre trois fichiers qui a
     produit les écarts silencieux du Dashboard Gillot.

     Pas de repli. Un store qui démarre sur une liste incomplète émet des
     marqueurs de suppression sur tout ce qu'il ne connaît pas et détruit
     l'historique pour l'ensemble des postes — c'est l'incident de juillet.
     Face à ce risque, refuser de démarrer est le comportement sûr. */
  var REF = global.OlympeScopes;
  if (!REF) {
    var _msg = 'olympe-scopes.js n\'est pas charg\u00e9. Le store ne peut pas '
             + 'd\u00e9marrer sans le r\u00e9f\u00e9rentiel de synchronisation.';
    try { console.error('[store] ' + _msg); } catch (e) {}
    function _ecranManquant() {
      try {
        document.body.innerHTML =
          '<div style="font:600 15px/1.6 system-ui;color:#fff;background:#001a4d;'
          + 'min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:40px">'
          + '<div><div style="font-size:44px;margin-bottom:14px">\u26A0</div>'
          + '<div style="font-size:20px;font-weight:800;margin-bottom:10px">Fichier manquant</div>'
          + '<div style="opacity:.75;max-width:460px;margin:0 auto 22px">' + _msg
          + '<br><br>V\u00e9rifie que <b>olympe-scopes.js</b> est bien d\u00e9ploy\u00e9 '
          + 'et charg\u00e9 AVANT olympe-store.js.</div>'
          + '<button onclick="location.reload()" style="background:#FFD100;color:#003189;border:0;'
          + 'padding:11px 26px;border-radius:9px;font-weight:800;cursor:pointer">R\u00e9essayer</button>'
          + '</div></div>';
      } catch (e) {}
    }
    global.OlympeStore = {
      isTestMode: function () {
        try { return sessionStorage.getItem('olympe.testmode') === '1'; } catch (e) { return false; }
      },
      attach: function (olympeDB) {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', _ecranManquant);
        } else { _ecranManquant(); }
        return olympeDB;
      },
      scopes: [], profile: function () { return null; },
      forget: function () { return this; }, purgePending: function () { return 0; },
      outboxCount: function () { return 0; },
      flushOutbox: function () { return Promise.resolve(0); },
      hydrate: function () { return Promise.reject(new Error(_msg)); }
    };
    return;
  }

  var SB  = null;
  var DB  = null;          // référence vers OlympeDB (injectée par attach())

  var _cache   = {};       // scope -> string JSON  (source des lectures synchrones)
  var _shadow  = {};       // scope -> { entry_id: payload }  dernier état connu (pour le diff)
  var _dirty   = {};       // scope -> true
  var _timer   = null;
  var _uid     = 'system';
  var _profile = null;
  var _ready   = false;
  var _nativeLS = global.localStorage;
  var _pending  = 0;       // upserts en vol
  var _lastErr  = null;

  var OUTBOX_KEY = 'olympe_outbox_v1';
  var PURGE_KEY  = 'olympe_purge_v1';

  /* ── SUPPRESSIONS VOLONTAIRES ────────────────────────────────────────────
     Sur les scopes cumulatifs, une entrée absente du blob local n'est jamais
     effacée : elle est restaurée depuis l'ombre. C'est ce qui a sauvé les
     historiques Hermès, mais cela rendait toute suppression impossible —
     la session revenait à la reconnexion suivante.

     On distingue donc les deux cas. Une entrée absente est restaurée SAUF si
     l'application a explicitement déclaré vouloir la détruire, en appelant
     OlympeStore.forget(scope, id). Ce registre survit à un rechargement
     survenu avant l'envoi, sinon un F5 mal placé annulerait la suppression.
     ───────────────────────────────────────────────────────────────────── */
  var _purge = {};
  function purgeLoad() {
    try { _purge = JSON.parse(_nativeLS.getItem(PURGE_KEY) || '{}') || {}; }
    catch (e) { _purge = {}; }
  }
  function purgeSave() {
    try { _nativeLS.setItem(PURGE_KEY, JSON.stringify(_purge)); } catch (e) {}
  }
  function purgeAdd(scope, ids) {
    if (!scope || !ids) return;
    if (!Array.isArray(ids)) ids = [ids];
    var m = _purge[scope] = _purge[scope] || {};
    ids.forEach(function (id) { if (id != null) m[String(id)] = Date.now(); });
    purgeSave();
  }
  function purgeHas(scope, id) {
    return !!(_purge[scope] && _purge[scope].hasOwnProperty(String(id)));
  }
  function purgeClear(ops) {
    var chg = false;
    ops.forEach(function (op) {
      if (op.deleted && _purge[op.scope] && _purge[op.scope][op.entry_id]) {
        delete _purge[op.scope][op.entry_id]; chg = true;
      }
    });
    if (chg) purgeSave();
  }
  var DEBOUNCE   = CFG.pushDebounce || 800;

  /* Listes du référentiel partagé — voir olympe-scopes.js.
     SCOPES et CUMULATIVE y bougent ensemble, et verifier() contrôle le
     couplage à chaque chargement de page. */
  var SCOPES     = REF.SCOPES;
  var NEVER_SYNC = REF.NEVER_SYNC;
  var MIRROR     = REF.MIRROR;




  purgeLoad();

  function log() { if (CFG.debug) console.log.apply(console, ['[store]'].concat([].slice.call(arguments))); }
  function isScope(k) { return SCOPES.indexOf(k) >= 0; }

  // ═══ Sérialisation canonique ═════════════════════════════════════════════
  // jsonb ne conserve PAS l'ordre des clés. Sans tri, tout reviendrait "modifié"
  // après le premier hydrate → ré-upsert massif inutile. Implémentation unique
  // dans olympe-scopes.js.
  var canon = REF.canon;
  function safeParse(s, dflt) { try { return JSON.parse(s); } catch (e) { return dflt; } }


  // ═══ Adaptateurs blob ↔ lignes ═══════════════════════════════════════════
  // Définis une seule fois, dans olympe-scopes.js — les dashboards utilisent
  // exactement les mêmes, ce qui est la condition pour qu'ils recomposent les
  // blobs comme le hub.
  var adapterFor = REF.adapterFor;


  // ═══ Miroir localStorage (iframes) ═══════════════════════════════════════
  function mirror(scope, value) {
    if (MIRROR.indexOf(scope) < 0) return;
    try { _nativeLS.setItem(scope, value); } catch (e) { /* quota : non bloquant, le cache mémoire fait foi */ }
  }

  // ═══ Hydratation : Supabase → cache mémoire ══════════════════════════════
  // La pagination et le filtre des lignes supprimées sont dans
  // OlympeScopes.charger(), partagé avec les deux dashboards. C'est ce qui
  // garantit que le hub et les dashboards lisent exactement la même chose.
  function hydrate() {
    return REF.charger(SB, SCOPES).then(function (res) {
      SCOPES.forEach(function (scope) {
        var entries = res.parScope[scope];
        if (!entries) { _shadow[scope] = {}; return; }   // clé absente = jamais écrite
        _shadow[scope] = entries;
        var blob = JSON.stringify(adapterFor(scope).join(entries));
        _cache[scope] = blob;
        mirror(scope, blob);
      });
      _ready = true;
      log('hydraté :', res.rows.length, 'lignes /',
          Object.keys(res.parScope).length, 'scopes /', res.pages, 'page(s)');
      return res.rows.length;
    });
  }

  // ═══ Diff blob → opérations ════════════════════════════════════════════════════════════════════════════════════════════
  function diff(scope) {
    var next = adapterFor(scope).split(safeParse(_cache[scope], {}));
    var prev = _shadow[scope] || {};
    var ops  = [];

    Object.keys(next).forEach(function (id) {
      if (!prev.hasOwnProperty(id) || canon(prev[id]) !== canon(next[id])) {
        ops.push({ scope: scope, entry_id: id, payload: next[id] === undefined ? null : next[id],
                   deleted: false, updated_by: _uid });
      }
    });
    // Entrée disparue du blob = suppression → TOMBSTONE, jamais un DELETE.
    // Un vrai DELETE serait ressuscité au prochain hydrate d'un autre poste.
    // La liste des scopes cumulatifs est dans olympe-scopes.js, au même
    // endroit que SCOPES : les deux doivent bouger ensemble, et les séparer
    // dans deux fichiers rendait l'oubli possible.
    if (!REF.estCumulatif(scope)) {
      Object.keys(prev).forEach(function (id) {
        if (!next.hasOwnProperty(id)) {
          ops.push({ scope: scope, entry_id: id, payload: null, deleted: true, updated_by: _uid });
        }
      });
    } else {
      // Scope cumulatif. Une cle absente du blob est restauree, SAUF si
      // l'application a demande sa destruction via OlympeStore.forget().
      // Sans cette exception, supprimer une session etait sans effet : elle
      // revenait au prochain hydrate, et un transfert la laissait dans les
      // DEUX historiques (source ressuscitee + copie a destination).
      Object.keys(prev).forEach(function (id) {
        if (next.hasOwnProperty(id)) return;
        if (purgeHas(scope, id)) {
          ops.push({ scope: scope, entry_id: id, payload: null,
                     deleted: true, updated_by: _uid });
          return;                       // volontaire : on laisse partir
        }
        next[id] = prev[id];            // simple absence locale : on restaure
      });
    }

    _shadow[scope] = next;
    return ops;
  }

  // ═══ Outbox (localStorage) ═══════════════════════════════════════════════
  // Ce n'est PAS une base parallèle : c'est une file d'envoi. Elle ne sert
  // jamais de source de lecture, donc elle ne peut pas entrer en conflit avec
  // Supabase. Sans elle, une coupure de 30 s = une session de flashage perdue.
  function outboxRead()  { return safeParse(_nativeLS.getItem(OUTBOX_KEY), []) || []; }
  function outboxWrite(a) {
    try { _nativeLS.setItem(OUTBOX_KEY, JSON.stringify(a)); }
    catch (e) { console.error('[store] outbox pleine :', e.name); }
  }
  function outboxPush(ops) {
    if (!CFG.offlineQueue) return;
    var q = outboxRead();
    ops.forEach(function (op) {
      // Une seule version par (scope, entry_id) : la dernière gagne localement.
      for (var i = 0; i < q.length; i++) {
        if (q[i].scope === op.scope && q[i].entry_id === op.entry_id) { q[i] = op; return; }
      }
      q.push(op);
    });
    outboxWrite(q);
    emit('olympe:queue', { n: q.length });
  }
  function outboxCount() { return outboxRead().length; }

  function flushOutbox() {
    var q = outboxRead();
    if (!q.length || !navigator.onLine) return Promise.resolve(0);
    log('flush outbox :', q.length, 'op(s)');
    return upsert(q).then(function () {
      purgeClear(q);
      outboxWrite([]);
      emit('olympe:queue', { n: 0 });
      emit('olympe:flushed', { n: q.length });
      return q.length;
    }).catch(function (e) {
      log('flush échoué, on garde la file :', e.message);
      return 0;
    });
  }

  // ═══ Envoi ═══════════════════════════════════════════════════════════════
  function upsert(ops) {
    if (!ops.length) return Promise.resolve();
    var chunks = [];
    for (var i = 0; i < ops.length; i += 100) chunks.push(ops.slice(i, i + 100));
    return chunks.reduce(function (p, c) {
      return p.then(function () {
        return SB.from('olympe_entry').upsert(c, { onConflict: 'scope,entry_id' })
          .then(function (r) { if (r.error) throw r.error; });
      });
    }, Promise.resolve());
  }

  function flush() {
    var scopes = Object.keys(_dirty);
    if (!scopes.length) return Promise.resolve();
    _dirty = {};

    var ops = [];
    scopes.forEach(function (s) { ops = ops.concat(diff(s)); });
    if (!ops.length) return Promise.resolve();

    if (!navigator.onLine) { outboxPush(ops); emit('olympe:offline', { n: ops.length }); return Promise.resolve(); }

    _pending++; emit('olympe:sync', { state: 'pushing', n: ops.length });
    return upsert(ops).then(function () {
      _pending--; _lastErr = null;
      purgeClear(ops);                  // suppressions confirmées par le serveur
      log('poussé :', ops.length, 'op(s)');
      emit('olympe:sync', { state: 'ok', n: ops.length });
    }).catch(function (e) {
      _pending--; _lastErr = e;
      console.error('[store] envoi échoué → mise en file :', e.message);
      outboxPush(ops);                       // rien n'est perdu
      emit('olympe:sync', { state: 'error', error: e.message });
    });
  }

  function schedule(scope) {
    _dirty[scope] = true;
    clearTimeout(_timer);
    _timer = setTimeout(flush, DEBOUNCE);
  }

  // ═══ Realtime ════════════════════════════════════════════════════════════
  function subscribe() {
    SB.channel('olympe-entries')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'olympe_entry' }, function (p) {
        var r = p.new && p.new.scope ? p.new : p.old;
        if (!r || !isScope(r.scope)) return;

        var sh = _shadow[r.scope] = _shadow[r.scope] || {};
        var incoming = (r.deleted || p.eventType === 'DELETE') ? undefined : r.payload;

        // Écho de notre propre écriture → rien à faire.
        var cur = sh.hasOwnProperty(r.entry_id) ? sh[r.entry_id] : undefined;
        if (canon(cur) === canon(incoming)) return;

        if (incoming === undefined) delete sh[r.entry_id];
        else sh[r.entry_id] = incoming;

        var blob = JSON.stringify(adapterFor(r.scope).join(sh));
        _cache[r.scope] = blob;
        mirror(r.scope, blob);

        log('realtime ←', r.scope, r.entry_id, r.updated_by);
        emit('olympe:remote', { scope: r.scope, entry_id: r.entry_id, by: r.updated_by, deleted: incoming === undefined });
      })
      .subscribe(function (st) { log('realtime :', st); });
  }

  function emit(name, detail) {
    try { global.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {}
  }

  // ═══ Reprise réseau ══════════════════════════════════════════════════════
  global.addEventListener('online', function () {
    emit('olympe:sync', { state: 'online' });
    flushOutbox().then(function (n) {
      // La file est partie. On recharge pour récupérer ce que les autres ont
      // fait pendant la coupure — sinon on travaillerait sur un cache périmé.
      return hydrate().then(function () { if (n) emit('olympe:resynced', { n: n }); });
    });
  });
  global.addEventListener('offline', function () { emit('olympe:sync', { state: 'offline' }); });

  // Dernier rempart : ne jamais quitter la page sur des écritures non parties.
  global.addEventListener('beforeunload', function (e) {
    if (Object.keys(_dirty).length) { clearTimeout(_timer); flush(); }
    if (outboxCount() > 0) {
      e.preventDefault();
      e.returnValue = 'Des données ne sont pas encore envoyées au serveur. Quitter quand même ?';
      return e.returnValue;
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // attach() — remplace le backend de OlympeDB sans toucher à son API
  // ═══════════════════════════════════════════════════════════════════════
  var API = {
    isTestMode: function () {
      try { return sessionStorage.getItem('olympe.testmode') === '1'; } catch (e) { return false; }
    },

    attach: function (olympeDB) {
      DB = olympeDB;

      // ░░ MODE TEST ░░ 100 % local, aucune connexion à Supabase.
      // On NE remplace PAS le backend : le OlympeDB natif (IndexedDB) reste en
      // place tel quel — getItem/setItem/init écrivent dans IndexedDB comme
      // avant la migration. Rien ne part sur le réseau, rien n'est verrouillé.
      // Sert à tout tester sur smartphone avant de déployer en production.
      if (API.isTestMode()) {
        _profile = { uid: 'test', nom: 'TEST (local)', role: 'admin' };
        _ready = true;
        DB.profile    = function () { return _profile; };
        DB.isTestMode = function () { return true; };
        DB.isFallback = function () { return false; };
        DB.isOnline   = function () { return true; };
        DB.pending    = function () { return 0; };
        DB.flushNow   = function () { return Promise.resolve(); };
        log('MODE TEST — backend IndexedDB natif, aucune connexion Supabase');
        return DB;   // init/getItem/setItem/removeItem natifs conservés
      }

      SB = global.OlympeAuth.client();

      DB.getItem = function (key) {
        if (_cache.hasOwnProperty(key)) return _cache[key];
        if (isScope(key)) return null;                  // scope jamais écrit
        return _nativeLS.getItem(key);                  // clés locales (thème, prefs…)
      };

      DB.setItem = function (key, value) {
        _cache[key] = value;
        if (isScope(key)) { mirror(key, value); schedule(key); return; }
        if (NEVER_SYNC.indexOf(key) >= 0) { try { _nativeLS.setItem(key, value); } catch (e) {} return; }
        try { _nativeLS.setItem(key, value); }
        catch (e) { console.error('[store] setItem local échoué (' + key + ') :', e.name); }
      };

      DB.removeItem = function (key) {
        delete _cache[key];
        if (isScope(key)) { _nativeLS.removeItem(key); schedule(key); return; }
        _nativeLS.removeItem(key);
      };

      DB.getTotalSize = function () {
        var t = 0; Object.keys(_cache).forEach(function (k) { t += (_cache[k] || '').length * 2; });
        return t;
      };
      DB.isReady    = function () { return _ready; };
      DB.isFallback = function () { return false; };     // plus d'IndexedDB, plus de mode dégradé
      DB.isOnline   = function () { return navigator.onLine && !_lastErr; };
      DB.pending    = function () { return _pending + outboxCount(); };
      DB.flushNow   = function () { clearTimeout(_timer); return flush().then(flushOutbox); };
      DB.profile    = function () { return _profile; };

      // Neutralisées : elles écrivaient dans IndexedDB / localStorage en direct.
      DB.migrateFromLocalStorage = function (p, done) { if (done) done(0); };

      // Purge admin : passe par le blob → devient des tombstones via le diff.
      DB.purgeOlderThan = function (days, onDone) {
        var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
        var cut = cutoff.toISOString().slice(0, 10), purged = 0;
        SCOPES.forEach(function (scope) {
          if (scope.indexOf('olympe_histo_') !== 0) return;
          var o = safeParse(_cache[scope], null); if (!o || typeof o !== 'object') return;
          Object.keys(o).forEach(function (k) { if (k.slice(0, 10) < cut) { delete o[k]; purged++; } });
          if (purged) DB.setItem(scope, JSON.stringify(o));
        });
        DB.flushNow().then(function () { if (onDone) onDone(purged); });
      };

      // ── Boot : garde d'accès → hydratation → app ────────────────────────
      DB.init = function (onReady) {
        global.OlympeAuth.requireSession('../index.html')
          .then(function (ctx) {
            _profile = ctx.profile;
            _uid     = ctx.profile.uid;
            // Le module MFA client a ete retire le 18/09/2026.
            //
            // Ce bloc exigeait window.OlympeMFA et, s'il manquait, renvoyait
            // vers ../index.html?e=device (« Poste non autorise »). C'est ce
            // garde-fou — et lui seul — qui bloquait la connexion des que la
            // balise olympe-mfa.js a ete retiree d'index2.html : le code a
            // quatre chiffres passait, puis index2 renvoyait a l'accueil.
            //
            // Il ne protegeait rien de reel : gate() renvoyait {action:'ok'}
            // des sa premiere ligne et logAccess() une promesse vide. Le
            // verrou machine effectif est cote serveur — RLS Postgres et
            // en-tete x-olympe-device pose par olympe-auth.js, qui n'a jamais
            // dependu de ce module.
            //
            // startPresence() alimente l'ecran « Appareils » d'olympe-control.
            // Il ne tournait plus, le renvoi partant avant lui : d'ou la
            // disparition des notifications de premiere connexion.
            try { startPresence(); } catch (e) {}
            return null;
          })
          .then(function () { return hydrate(); })
          .then(function () {
            subscribe();
            flushOutbox();
            global.OlympeAuth.watchSignOut(function () { location.replace('../index.html?e=session'); });
            emit('olympe:ready', {});
            if (onReady) onReady();
          })
          .catch(function (e) {
            if (e && e.message === '__redirect__') return;   // redirection en cours
            console.error('[store] boot échoué :', e);
            document.body.innerHTML =
              '<div style="font:600 15px/1.6 system-ui;color:#fff;background:#001a4d;'
              + 'min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:40px">'
              + '<div><div style="font-size:44px;margin-bottom:14px">\u26A0</div>'
              + '<div style="font-size:20px;font-weight:800;margin-bottom:10px">Connexion au serveur impossible</div>'
              + '<div style="opacity:.75;max-width:460px;margin:0 auto 22px">'
              + String(e && e.message || e) + '</div>'
              + '<button onclick="location.reload()" style="background:#FFD100;color:#003189;border:0;'
              + 'padding:11px 26px;border-radius:9px;font-weight:800;cursor:pointer">R\u00e9essayer</button>'
              + '</div></div>';
          });
      };

      log('attaché à OlympeDB');
      return DB;
    },

    // Exposé pour l'app (badge de synchro, panneau admin) et pour outils/migration.html
    profile:      function () { return _profile; },
    splitFor:     function (scope, obj) { return adapterFor(scope).split(obj); },
    hydrate:      hydrate,
    flushOutbox:  flushOutbox,
    outboxCount:  outboxCount,
    scopes:       SCOPES,
    /* Diagnostic 2026-09-17 — OlympeStore.geoEtat() en console :
       { actif:false, demandee:false, position:{lat:null,…} }
       actif=false  → le serveur refuse la position, rien n'est demandé
       actif=true   → demandee passe à true une seule fois par session      */
    geoEtat:      function () {
      return { actif: _geoActif, demandee: _geoDemandee, position: _geo,
               relectureIl_y_a_ms: _geoDernierLu ? (Date.now() - _geoDernierLu) : null };
    },

    /* Declare une suppression VOLONTAIRE sur un scope cumulatif.
       A appeler AVANT (ou juste apres) le setItem qui retire l'entree du blob.
       Sans cet appel, l'entree est consideree comme simplement absente de ce
       poste et sera restauree au prochain diff. */
    forget: function (scope, ids) {
      purgeAdd(scope, ids);
      return API;
    },
    purgePending: function () {
      var n = 0;
      Object.keys(_purge).forEach(function (s) { n += Object.keys(_purge[s] || {}).length; });
      return n;
    }
  };

  try { console.info('[olympe-store] r\u00e9f\u00e9rentiel partag\u00e9 + chargeur pagin\u00e9 \u2013 build 2026-09-20-SCOPES1'); } catch (e) {}
  // ── PRESENCE (Phase 2) : heartbeat + geoloc + enforcement blocage ──────────
  var _presenceTimer = null, _geo = { lat: null, lon: null, acc: null };

  /* ── Géolocalisation : état du verrou serveur ────────────────────────────
     Correctif 2026-09-17. Avant : _askGeo() était appelé toutes les 30 s.
     Or olympe_heartbeat JETTE les coordonnées tant que le réglage
     geoloc_active est faux — et il est faux par défaut. Le navigateur était
     donc sollicité deux fois par minute pour une donnée que PostgreSQL
     refuse d'enregistrer, et Chrome réaffiche la bulle de permission à
     chaque appel quand l'agent a répondu « Autoriser cette fois ».

     Deux règles désormais :
       1. on ne demande la position que si le serveur dit qu'il l'accepte ;
       2. on ne la demande qu'UNE fois par session, pas à chaque battement.

     Le réglage est relu périodiquement — mais toutes les 10 minutes, pas
     toutes les 30 secondes : l'admin doit pouvoir l'activer depuis la Tour
     sans demander à l'équipe de recharger, sans pour autant interroger la
     base en boucle.                                                        */
  var _geoActif      = null;    // null = pas encore su, true/false = su
  var _geoDemandee   = false;   // position déjà demandée dans cette session
  var _geoDernierLu  = 0;       // horodatage de la dernière lecture du réglage
  var GEO_RELECTURE  = 600000;  // 10 minutes

  function _litReglageGeo(apres) {
    if (!SB) { _geoActif = false; if (apres) apres(false); return; }
    var maintenant = Date.now();
    if (_geoActif !== null && (maintenant - _geoDernierLu) < GEO_RELECTURE) {
      if (apres) apres(_geoActif);
      return;
    }
    try {
      SB.rpc('olympe_reglage_actif', { p_cle: 'geoloc_active' }).then(function (res) {
        var v = !!(res && res.data);
        // Le réglage vient d'être coupé : on oublie la position en mémoire,
        // sinon le poste continuerait de l'envoyer au heartbeat suivant.
        if (_geoActif === true && v === false) {
          _geo = { lat: null, lon: null, acc: null };
          _geoDemandee = false;
        }
        _geoActif = v;
        _geoDernierLu = Date.now();
        log('geoloc_active =', v);
        if (apres) apres(v);
      }, function () {
        // Réglage illisible : on ne demande RIEN. En cas de doute sur un
        // traitement de données de localisation, l'abstention est la bonne
        // valeur par défaut — pas l'inverse.
        _geoActif = false;
        _geoDernierLu = Date.now();
        if (apres) apres(false);
      });
    } catch (e) {
      _geoActif = false;
      if (apres) apres(false);
    }
  }
  function _deviceId() {
    var id = localStorage.getItem('olympe_device_id');
    if (!id) {
      id = (global.crypto && crypto.randomUUID) ? crypto.randomUUID()
         : 'dev-' + Date.now() + '-' + Math.random().toString(16).slice(2);
      localStorage.setItem('olympe_device_id', id);
    }
    return id;
  }
  function _deviceLabel() {
    try { if (global.OlympeMFA && global.OlympeMFA.guessLabel) return global.OlympeMFA.guessLabel(); } catch (e) {}
    return navigator.userAgent;
  }
  function _askGeo() {
    if (!navigator.geolocation) return;
    if (_geoDemandee) return;            // une seule demande par session
    if (_geoActif !== true) return;      // le serveur n'accepte pas la position
    _geoDemandee = true;
    navigator.geolocation.getCurrentPosition(
      function (p) { _geo = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }; },
      function (err) {
        /* Refus ou erreur : position laissee a null, le poste reste liste.
           On ne relance pas immediatement — sauf si l'echec est technique
           (timeout, position indisponible) et non un refus explicite de
           l'agent. Un refus doit etre respecte pour toute la session. */
        if (err && err.code !== 1 /* PERMISSION_DENIED */) _geoDemandee = false;
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 }
    );
  }
  function _beat() {
    if (!SB) return;
    var did = _deviceId();
    try { SB.rpc('olympe_set_device', { p_device_id: did }).then(function () {}, function () {}); } catch (e) {}
    try {
      SB.rpc('olympe_heartbeat', {
        p_device_id: did, p_label: _deviceLabel(), p_user_agent: navigator.userAgent,
        p_lat: _geo.lat, p_lon: _geo.lon, p_accuracy: _geo.acc
      }).then(function (res) {
        var row = res && res.data && res.data[0];
        if (row && row.blocked) { try { location.replace('../index.html?e=blocked'); } catch (e) {} }
      }, function () {});
    } catch (e) {}
  }
  // ── GATE 2e facteur : l'appareil doit etre autorise par l'admin (Tour) ──
  // Le login index.html reste le 1er facteur. Ici on verifie que CE poste
  // a recu un mot d'autorisation valide, dans sa fenetre horaire/dates.
  function _gateOverlay(msg, deviceId, onOk) {
    var o = document.createElement('div');
    o.id = 'olympe-devgate';
    o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#05060a;color:#f2f2f7;'
      + 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;'
      + "font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;text-align:center;";
    o.innerHTML = '<div style="width:56px;height:56px;border-radius:16px;background:linear-gradient(145deg,#0a84ff,#0060df);display:grid;place-items:center;">'
      + '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#fff" stroke-width="1.8"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></div>'
      + '<div style="font-size:19px;font-weight:700;">Appareil non autorise</div>'
      + '<div id="dg-msg" style="font-size:13.5px;color:#a1a1aa;max-width:340px;line-height:1.5;">' + msg + '</div>'
      + '<input id="dg-code" type="text" autocomplete="off" placeholder="Code d\'autorisation" '
      + 'style="width:100%;max-width:300px;padding:13px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);'
      + 'border-radius:12px;color:#f2f2f7;font-size:16px;outline:none;text-align:center;letter-spacing:1px;">'
      + '<button id="dg-ok" style="width:100%;max-width:300px;padding:14px;border:none;border-radius:12px;background:#0a84ff;'
      + 'color:#fff;font-size:16px;font-weight:600;cursor:pointer;">Valider</button>'
      + '<div id="dg-err" style="font-size:12.5px;color:#ff8f88;min-height:16px;"></div>'
      + '<div style="font-size:11px;color:#6b6b73;margin-top:4px;">Poste : ' + deviceId.slice(0, 8) + '&hellip;</div>';
    document.body.appendChild(o);
    var go = function () {
      var v = (document.getElementById('dg-code').value || '').trim();
      if (!v) return;
      document.getElementById('dg-err').textContent = '';
      SB.rpc('olympe_verify_passphrase', { p_device_id: deviceId, p_word: v }).then(function (res) {
        var r = res && res.data && res.data[0];
        if (r && r.ok) { o.remove(); onOk(); }
        else {
          var m = { bad_code: 'Code incorrect.', blocked: 'Appareil bloque. Contacte l\'administrateur.',
                    no_code: 'Aucun code defini pour ce poste. Demande a l\'administrateur.',
                    expired: 'Autorisation expiree.', not_yet: 'Autorisation pas encore active.',
                    unknown: 'Poste inconnu, patiente quelques secondes puis reessaie.' };
          document.getElementById('dg-err').textContent = m[(r && r.reason) || ''] || 'Refuse.';
        }
      }, function () { document.getElementById('dg-err').textContent = 'Erreur reseau.'; });
    };
    document.getElementById('dg-ok').addEventListener('click', go);
    document.getElementById('dg-code').addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    setTimeout(function () { try { document.getElementById('dg-code').focus(); } catch (e) {} }, 200);
  }

  function _checkGate(cb) {
    if (!SB) return cb();
    var did = _deviceId();
    SB.rpc('olympe_device_allowed', { p_device_id: did }).then(function (res) {
      var r = res && res.data && res.data[0];
      if (r && r.allowed) return cb();
      var reason = (r && r.reason) || 'pending';
      if (reason === 'blocked') { try { location.replace('../index.html?e=blocked'); } catch (e) {} return; }
      var msg = (reason === 'off_hours')
        ? 'Acces hors plage horaire autorisee pour ce poste.'
        : 'Saisis le code transmis par l\'administrateur pour autoriser ce poste.';
      _gateOverlay(msg, did, cb);
    }, function () { cb(); });   // backend injoignable : on ne bloque pas le travail
  }

  function startPresence() {
    if (_presenceTimer) return;              // idempotent
    /* Le battement continue toutes les 30 s — c'est lui qui porte la presence
       et l'enforcement du blocage, il ne change pas. Seule la demande de
       position devient conditionnelle. */
    _litReglageGeo(function () { _askGeo(); });
    _beat();
    _presenceTimer = setInterval(function () {
      _litReglageGeo(function () { _askGeo(); });
      _beat();
    }, 30000);
    setTimeout(function () { _checkGate(function () {}); }, 1200);  // laisse le heartbeat creer la ligne
  }

  global.OlympeStore = API;
})(window);
