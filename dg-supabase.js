/* ══════════════════════════════════════════════════════════════════════════
   DASHBOARD GILLOT — COUCHE SUPABASE            build dg-supabase-2026-09-14
   ------------------------------------------------------------------------
   Remplace l'accès au store du hub parent par un accès direct à Supabase,
   pour que le Dashboard Gillot fonctionne seul, comme la Direction.

   POURQUOI CE FICHIER EXISTE
   Le dashboard écrit (camstock, finposte, ctoc, objectifs, message équipe).
   Écrire dans olympe_entry impose de choisir l'entry_id, et cette convention
   est celle des adaptateurs de olympe-store.js. Ils sont donc RECOPIÉS ICI À
   L'IDENTIQUE — pas réinventés :
     · par défaut    : une ligne par clé de premier niveau ; un tableau ou un
                       scalaire ne se découpe pas → une seule ligne « _all »
     · hermes_gillot_v4     : « _root » + une ligne « d:<date> » par journée
     · olympe_mrd_releve_v1 : une ligne « e:<id> » par palette relevée
   Toute divergence ici ferait lire deux jeux de données différents au hub et
   au dashboard sur la même clé — l'incident de juillet.

   API : window.OlympeSBStore — getItem / setItem / removeItem synchrones sur
   un cache mémoire, plus boot() qui précharge et onChange() pour le direct.
   Le code existant du dashboard n'a donc rien à changer.
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* La clé anon est publique par conception : les policies sont toutes
     `to authenticated`, elle ne donne rien sans session. Même valeur que
     dans olympe-config.js et dans le dashboard Direction. */
  var CFG = global.OLYMPE_CFG || {
    url: 'https://eedvljmmvsxrcwhclfpg.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlZHZsam1tdnN4cmN3aGNsZnBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0OTgzMDcsImV4cCI6MjEwMDA3NDMwN30.Tmf3pchljBcjHpg5NzyJFA_gQPuYiKZqfwTjEYG5krA',
    emailDomain: '0lympe.local'
  };

  /* Scopes réellement lus ou écrits par ce dashboard. */
  var SCOPES = [
    'hermes_gillot_v4',
    'olympe_histo_ppi', 'olympe_histo_sac', 'olympe_histo_cabine',
    'olympe_histo_anomalie', 'olympe_histo_vgp',
    'olympe_mrd_releve_v1', 'olympe_ata_v1',
    'olympe_ctoc_v1', 'olympe_camstock_v1', 'olympe_finposte_v1',
    'olympe_dash_msg_v1', 'olympe_jsa_obj_v1', 'olympe_dash_obj_v1'
  ];

  /* Repris tel quel de olympe-store.js : sur ces scopes, aucune suppression
     automatique n'est émise — une entrée absente du cache local ne veut pas
     dire qu'elle a été supprimée, seulement que ce poste ne l'a pas hydratée. */
  var CUMULATIVE = ['hermes_gillot_v4', 'olympe_histo_ppi', 'olympe_histo_sac',
    'olympe_histo_cabine', 'olympe_histo_maritime', 'olympe_histo_anomalie',
    'olympe_histo_vgp', 'olympe_histo_mrd', 'olympe_histo_maurice',
    'olympe_histo_mayotte', 'olympe_histo_chronopost', 'olympe_mrd_releve_v1',
    'hermes_camion_v3', 'olympe_reexped_v1'];

  /* hermes_mrd_histo et hermes_uld_histo sont ABSENTS de SCOPES dans
     olympe-store.js : ils n'ont jamais été synchronisés et n'existent donc
     pas dans olympe_entry. On les laisse en localStorage — c'est la seule
     source qui les contient. Écart connu, documenté au §7. */
  var LOCAL_ONLY = ['hermes_mrd_histo', 'hermes_uld_histo'];

  /* ── Adaptateurs — copie conforme de olympe-store.js ────────────────── */

  var DEFAULT_ADAPTER = {
    split: function (o) {
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
    },
    olympe_mrd_releve_v1: {
      split: function (o) {
        o = (o && typeof o === 'object') ? o : {};
        var out = {};
        (Array.isArray(o.entries) ? o.entries : []).forEach(function (e) {
          if (e && e.id) out['e:' + e.id] = e;
        });
        return out;
      },
      join: function (e) {
        var entries = [];
        Object.keys(e).forEach(function (id) {
          if (id.indexOf('e:') === 0 && e[id]) entries.push(e[id]);
        });
        entries.sort(function (a, b) {
          return String((b && b.ts) || '').localeCompare(String((a && a.ts) || ''));
        });
        return { entries: entries };
      }
    }
  };
  function adapterFor(s) { return ADAPTERS[s] || DEFAULT_ADAPTER; }

  /* Sérialisation canonique : jsonb ne garde pas l'ordre des clés. Sans tri,
     tout reviendrait « modifié » au premier chargement. */
  function canon(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    return '{' + Object.keys(v).sort().map(function (k) {
      return JSON.stringify(k) + ':' + canon(v[k]);
    }).join(',') + '}';
  }
  function parse(s, d) { try { return JSON.parse(s); } catch (e) { return d; } }

  /* ── État ───────────────────────────────────────────────────────────── */

  var SB = null;
  var cache = {};        /* scope -> blob JSON (chaîne), ce que lit le dashboard */
  var shadow = {};       /* scope -> { entry_id: payload } dernier état connu  */
  var queue = [];        /* opérations en attente d'envoi                      */
  var flushT = null, listeners = [], ready = false, online = false;

  function emit(ev, data) {
    listeners.forEach(function (f) { try { f(ev, data); } catch (e) { } });
  }

  function LS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function LSset(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }

  /* ── Lecture / écriture, vues par le dashboard ──────────────────────── */

  function getItem(k) {
    if (LOCAL_ONLY.indexOf(k) >= 0) return LS(k);
    if (cache.hasOwnProperty(k)) return cache[k];
    return LS(k);            /* repli tant que le préchargement n'a pas fini */
  }

  function setItem(k, v) {
    v = String(v);
    if (LOCAL_ONLY.indexOf(k) >= 0 || SCOPES.indexOf(k) < 0) { LSset(k, v); return; }
    cache[k] = v;
    LSset(k, v);             /* copie locale : survit à une coupure réseau */
    diff(k);
    schedule();
  }

  function removeItem(k) {
    try { localStorage.removeItem(k); } catch (e) { }
    if (SCOPES.indexOf(k) >= 0) { cache[k] = '{}'; diff(k); schedule(); }
  }

  /* Calcule les lignes à envoyer pour un scope, exactement comme le store :
     upsert des entrées nouvelles ou modifiées, marqueur de suppression pour
     celles qui ont disparu — sauf sur les scopes cumulatifs. */
  function diff(scope) {
    var next = adapterFor(scope).split(parse(cache[scope], {}) || {});
    var prev = shadow[scope] || (shadow[scope] = {});
    var id;

    for (id in next) {
      if (!prev.hasOwnProperty(id) || canon(prev[id]) !== canon(next[id])) {
        push({ scope: scope, entry_id: id, payload: next[id] === undefined ? null : next[id], deleted: false });
      }
    }
    if (CUMULATIVE.indexOf(scope) < 0) {
      for (id in prev) {
        if (!next.hasOwnProperty(id)) {
          push({ scope: scope, entry_id: id, payload: null, deleted: true });
        }
      }
    }
    shadow[scope] = next;
  }

  function push(op) {
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].scope === op.scope && queue[i].entry_id === op.entry_id) { queue[i] = op; return; }
    }
    queue.push(op);
  }

  function schedule() {
    if (flushT) clearTimeout(flushT);
    flushT = setTimeout(flush, 700);
  }

  function flush(cb) {
    flushT = null;
    if (!SB || !queue.length) { if (cb) cb(); return; }
    var batch = queue.slice(); queue = [];
    SB.from('olympe_entry')
      .upsert(batch, { onConflict: 'scope,entry_id' })
      .then(function (r) {
        if (r && r.error) {
          /* Un échec doit se voir : on remet en file et on le dit. */
          queue = batch.concat(queue);
          emit('error', r.error.message || 'envoi refusé');
        } else {
          emit('sync', batch.length);
        }
        if (cb) cb();
      });
  }

  /* ── Préchargement ──────────────────────────────────────────────────── */

  function loadAll(done) {
    if (!SB) { done(new Error('pas de session')); return; }
    SB.from('olympe_entry')
      .select('scope,entry_id,payload')
      .in('scope', SCOPES)
      .then(function (r) {
        if (r && r.error) { done(r.error); return; }
        var byScope = {};
        (r.data || []).forEach(function (row) {
          (byScope[row.scope] = byScope[row.scope] || {})[row.entry_id] = row.payload;
        });
        SCOPES.forEach(function (scope) {
          var entries = byScope[scope] || {};
          shadow[scope] = entries;
          cache[scope] = JSON.stringify(adapterFor(scope).join(entries));
          LSset(scope, cache[scope]);
        });
        ready = true; online = true;
        emit('loaded', (r.data || []).length);
        done(null);
      });
  }

  /* Temps réel : une ligne change côté serveur, on recompose le blob. */
  function subscribe(onChange) {
    if (!SB || !SB.channel) return;
    try {
      SB.channel('dg-entry')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'olympe_entry' },
          function (msg) {
            var row = msg["new"] || msg.old; if (!row) return;
            if (SCOPES.indexOf(row.scope) < 0) return;
            var sh = shadow[row.scope] || (shadow[row.scope] = {});
            if (msg.eventType === 'DELETE' || (msg["new"] && msg["new"].deleted)) delete sh[row.entry_id];
            else sh[row.entry_id] = row.payload;
            cache[row.scope] = JSON.stringify(adapterFor(row.scope).join(sh));
            LSset(row.scope, cache[row.scope]);
            emit('remote', row.scope);
            if (onChange) onChange(row.scope);
          })
        .subscribe();
    } catch (e) { }
  }

  /* ── Portail de connexion ───────────────────────────────────────────── */

  function gate(onOk) {
    var g = document.createElement('div');
    g.id = 'dg-gate';
    g.innerHTML =
      '<div class="dg-gate-card">' +
      '  <div class="dg-gate-logo">📮</div>' +
      '  <b>Dashboard Gillot</b>' +
      '  <span>PIC Gillot Import · activité du jour</span>' +
      '  <input id="dg-lg-id" placeholder="Identifiant" autocomplete="username">' +
      '  <input id="dg-lg-pw" type="password" placeholder="Mot de passe" autocomplete="current-password">' +
      '  <button id="dg-lg-go" type="button">Se connecter</button>' +
      '  <em id="dg-lg-err"></em>' +
      '</div>';
    document.body.appendChild(g);

    function err(m) { var e = document.getElementById('dg-lg-err'); if (e) e.textContent = m || ''; }
    function go() {
      var id = (document.getElementById('dg-lg-id').value || '').trim();
      var pw = document.getElementById('dg-lg-pw').value || '';
      if (!id || !pw) { err('Identifiant et mot de passe requis.'); return; }
      err('Connexion au serveur…');
      var mail = id.indexOf('@') >= 0 ? id : (id + '@' + CFG.emailDomain);
      SB.auth.signInWithPassword({ email: mail, password: pw }).then(function (r) {
        if (r && r.error) { err('Connexion refusée : ' + r.error.message); return; }
        g.remove();
        onOk();
      });
    }
    document.getElementById('dg-lg-go').addEventListener('click', go);
    g.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    setTimeout(function () { try { document.getElementById('dg-lg-id').focus(); } catch (e) { } }, 200);
  }

  /* ── Démarrage ──────────────────────────────────────────────────────── */

  function boot(onReady, onChange) {
    if (!global.supabase || !global.supabase.createClient) {
      emit('error', 'bibliothèque Supabase absente');
      onReady(new Error('supabase absent'));
      return;
    }
    SB = global.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true } });

    function start() {
      loadAll(function (e) {
        if (e) { emit('error', e.message || 'lecture refusée'); }
        subscribe(onChange);
        onReady(e || null);
      });
    }

    /* Même origine que le hub : la session posée à la connexion est déjà là,
       le portail ne s'affiche que pour un poste qui ouvre le dashboard seul. */
    SB.auth.getSession().then(function (r) {
      if (r && r.data && r.data.session) start();
      else gate(start);
    });
  }

  global.OlympeSBStore = {
    getItem: getItem,
    setItem: setItem,
    removeItem: removeItem,
    boot: boot,
    flushNow: function (cb) { if (flushT) clearTimeout(flushT); flush(cb); },
    onChange: function (f) { listeners.push(f); },
    etat: function () { return { pret: ready, enLigne: online, enAttente: queue.length }; },
    scopes: SCOPES
  };

})(window);
