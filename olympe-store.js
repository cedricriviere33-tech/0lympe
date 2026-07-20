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
  var DEBOUNCE   = CFG.pushDebounce || 800;

  /* Clés gérées par Supabase. Alignée sur MANAGED_KEYS d'Olympe, MOINS :
       - olympe_auth_v1     : les hashes de mots de passe n'ont plus rien à faire
                              dans une table lisible par tous les agents.
                              L'auth, c'est Supabase Auth (bcrypt, hors de portée).
       - olympe_extra_users : remplacé par la table `profile`.
     Ces deux clés restent en localStorage local et ne servent plus à rien. */
  var SCOPES = [
    'hermes_gillot_v4',
    'olympe_histo_ppi', 'olympe_histo_sac', 'olympe_histo_cabine',
    'olympe_histo_maritime', 'olympe_histo_anomalie', 'olympe_histo_vgp',
    'olympe_histo_mrd', 'olympe_histo_maurice', 'olympe_histo_mayotte',
    'olympe_histo_chronopost',
    'olympe_ano_list', 'olympe_vgp_list', 'olympe_nouveautes',
    'olympe_lab_v1', 'hermes_camion_v3', 'olympe_consommable_v1',
    'olympe_reexped_v1', 'olympe_rescon_v1', 'olympe_vols_v1', 'olympe_ata_v1'
  ];
  var NEVER_SYNC = ['olympe_auth_v1', 'olympe_extra_users'];

  /* Clés que les iframes lisent en localStorage direct : on garde le miroir. */
  var MIRROR = ['olympe_histo_anomalie', 'olympe_histo_vgp', 'olympe_histo_ppi',
    'olympe_histo_sac', 'olympe_histo_mrd', 'olympe_histo_cabine',
    'olympe_histo_maritime', 'olympe_ano_list', 'olympe_vgp_list',
    'olympe_rescon_v1', 'olympe_reexped_v1', 'olympe_vols_v1', 'olympe_ata_v1'];

  function log() { if (CFG.debug) console.log.apply(console, ['[store]'].concat([].slice.call(arguments))); }
  function isScope(k) { return SCOPES.indexOf(k) >= 0; }

  // ═══ Sérialisation canonique ═════════════════════════════════════════════
  // jsonb ne conserve PAS l'ordre des clés. Sans tri, tout reviendrait "modifié"
  // après le premier hydrate → ré-upsert massif inutile.
  function canon(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    var ks = Object.keys(v).sort();
    return '{' + ks.map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  }
  function safeParse(s, dflt) { try { return JSON.parse(s); } catch (e) { return dflt; } }

  // ═══ Adaptateurs blob ↔ lignes ═══════════════════════════════════════════
  // split : objet complet  → { entry_id: payload }
  // join  : { entry_id: payload } → objet complet
  var DEFAULT_ADAPTER = {
    split: function (o) {
      // Tableau ou scalaire : pas de découpage possible → 1 seule ligne.
      if (o === null || typeof o !== 'object' || Array.isArray(o)) return { _all: o };
      var out = {};
      Object.keys(o).forEach(function (k) { out[k] = o[k]; });
      return out;
    },
    join: function (e) {
      var ks = Object.keys(e);
      if (ks.length === 1 && ks[0] === '_all') return e._all;
      var o = {};
      ks.forEach(function (k) { o[k] = e[k]; });
      return o;
    }
  };

  // Hermès : le blob est { dates: {...}, <reste> }. Sans traitement spécial,
  // TOUT "dates" serait une seule ligne → deux agents sur deux jours différents
  // du Brief s'écraseraient. On descend d'un cran : 1 ligne = 1 journée.
  var ADAPTERS = {
    hermes_gillot_v4: {
      split: function (o) {
        o = (o && typeof o === 'object') ? o : {};
        var out = {}, root = {};
        Object.keys(o).forEach(function (k) { if (k !== 'dates') root[k] = o[k]; });
        out._root = root;
        var d = o.dates || {};
        Object.keys(d).forEach(function (day) { out['d:' + day] = d[day]; });
        return out;
      },
      join: function (e) {
        var o = {};
        Object.keys(e._root || {}).forEach(function (k) { o[k] = e._root[k]; });
        o.dates = {};
        Object.keys(e).forEach(function (id) {
          if (id.indexOf('d:') === 0) o.dates[id.slice(2)] = e[id];
        });
        return o;
      }
    }
  };
  function adapterFor(scope) { return ADAPTERS[scope] || DEFAULT_ADAPTER; }

  // ═══ Miroir localStorage (iframes) ═══════════════════════════════════════
  function mirror(scope, value) {
    if (MIRROR.indexOf(scope) < 0) return;
    try { _nativeLS.setItem(scope, value); } catch (e) { /* quota : non bloquant, le cache mémoire fait foi */ }
  }

  // ═══ Hydratation : Supabase → cache mémoire ══════════════════════════════
  // Pagination obligatoire : PostgREST plafonne à 1000 lignes par requête.
  function hydrate() {
    var rows = [], PAGE = 1000, from = 0;

    function page() {
      return SB.from('olympe_entry')
        .select('scope,entry_id,payload')
        .eq('deleted', false)
        .order('scope', { ascending: true })
        .order('entry_id', { ascending: true })
        .range(from, from + PAGE - 1)
        .then(function (r) {
          if (r.error) throw r.error;
          rows = rows.concat(r.data || []);
          if ((r.data || []).length === PAGE) { from += PAGE; return page(); }
        });
    }

    return page().then(function () {
      var byScope = {};
      rows.forEach(function (r) {
        (byScope[r.scope] = byScope[r.scope] || {})[r.entry_id] = r.payload;
      });
      SCOPES.forEach(function (scope) {
        var entries = byScope[scope];
        if (!entries) { _shadow[scope] = {}; return; }   // clé absente = jamais écrite
        _shadow[scope] = entries;
        var blob = JSON.stringify(adapterFor(scope).join(entries));
        _cache[scope] = blob;
        mirror(scope, blob);
      });
      _ready = true;
      log('hydraté :', rows.length, 'lignes /', Object.keys(byScope).length, 'scopes');
      return rows.length;
    });
  }

  // ═══ Diff blob → opérations ══════════════════════════════════════════════
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
    Object.keys(prev).forEach(function (id) {
      if (!next.hasOwnProperty(id)) {
        ops.push({ scope: scope, entry_id: id, payload: null, deleted: true, updated_by: _uid });
      }
    });

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
            // Verrou machine + Authenticator : on verifie AVANT d'hydrater.
            // Sans ca, le RLS renverrait 0 ligne et l'agent verrait un Olympe
            // VIDE au lieu d'un message clair — le pire des deux mondes.
            if (!global.OlympeMFA) return null;
            return global.OlympeMFA.gate().then(function (g) {
              if (g.action !== 'ok') {
                location.replace('../index.html?e=device');
                return Promise.reject(new Error('__redirect__'));
              }
              return global.OlympeMFA.logAccess();
            });
          })
          .then(function () { return hydrate(); })
          .then(function () {
            subscribe();
            flushOutbox();
            global.OlympeAuth.watchSignOut(function () { location.replace('../index.html?e=session'); });
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
    scopes:       SCOPES
  };

  global.OlympeStore = API;
})(window);
