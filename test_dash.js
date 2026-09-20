/* ══════════════════════════════════════════════════════════════════════════
   test_dash.js — les deux dashboards sur le référentiel partagé.

   Trois défauts sont vérifiés, chacun invisible à l'écran en production :
     1. Camion absent des scopes chargés par le Dashboard Gillot ;
     2. absence de pagination — jeu tronqué à 1000 lignes sans le dire ;
     3. marqueurs de suppression comptés comme des données vivantes.

   Le test tourne sur la version d'AVANT et sur celle d'APRÈS, avec le même
   faux client Supabase. Il doit rougir sur la première.

   USAGE   node test_dash.js [dossier]      (défaut : dist)
   ══════════════════════════════════════════════════════════════════════════ */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const DOSSIER = path.resolve(process.argv[2] || 'dist');

let ok = 0, ko = 0;
function chk(c, l, d) {
  if (c) { ok++; console.log('  ✓ ' + l); }
  else { ko++; console.log('  ✗ ' + l + (d ? '\n      ' + d : '')); }
}

/* Faux Supabase installé AVANT les scripts de la page. Il respecte .range()
   et applique le plafond de 1000 lignes, comme PostgREST. */
const STUB = `
(function () {
  var lignes = [];
  for (var i = 0; i < 1400; i++) {
    lignes.push({ scope: 'hermes_camion_v3', entry_id: 'c' + i,
                  payload: { done: true, grid: { '15-CP': 1 } }, deleted: false });
  }
  for (i = 0; i < 300; i++) {
    lignes.push({ scope: 'olympe_histo_sac', entry_id: 's' + i,
                  payload: { prio: 1, eco: 1 }, deleted: false });
  }
  for (i = 0; i < 200; i++) {
    lignes.push({ scope: 'olympe_histo_sac', entry_id: 'mort' + i, payload: null, deleted: true });
  }
  window.__total = lignes.filter(function (r) { return !r.deleted; }).length;
  window.__requetes = 0;

  function requete() {
    var f = lignes.slice(), plage = null;
    var api = {
      select: function () { return api; },
      eq: function (c, v) { f = f.filter(function (r) { return r[c] === v; }); return api; },
      order: function (c) { f.sort(function (a, b) { return String(a[c]).localeCompare(String(b[c])); }); return api; },
      range: function (a, b) { plage = [a, b]; return api; },
      upsert: function () { return { then: function (res) { return Promise.resolve({ error: null }).then(res); } }; },
      then: function (res, rej) {
        var d = plage ? f.slice(plage[0], plage[1] + 1) : f;
        if (d.length > 1000) d = d.slice(0, 1000);
        window.__requetes++;
        window.__lignesRendues = (window.__lignesRendues || 0) + d.length;
        return Promise.resolve({ data: d.map(function (r) {
          return { scope: r.scope, entry_id: r.entry_id, payload: r.payload }; }), error: null }).then(res, rej);
      }
    };
    api['in'] = function (c, l) { f = f.filter(function (r) { return l.indexOf(r[c]) >= 0; }); return api; };
    return api;
  }

  window.supabase = {
    createClient: function () {
      return {
        from: function () { return requete(); },
        auth: {
          getSession: function () { return Promise.resolve({ data: { session: { user: { id: 'test' } } } }); },
          signInWithPassword: function () { return Promise.resolve({ error: null }); },
          signOut: function () { return Promise.resolve({}); }
        },
        channel: function () { return { on: function () { return this; }, subscribe: function (cb) { if (cb) cb('SUBSCRIBED'); return this; } }; },
        rpc: function () { return { then: function (res) { return Promise.resolve({ data: null }).then(res); } }; }
      };
    }
  };
})();
`;

async function gillot(browser, fichier) {
  const page = await browser.newPage();
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(String(e.message).slice(0, 180)));
  await page.addInitScript(STUB);
  await page.goto('file://' + fichier, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  /* Le script CDN de Supabase, s'il aboutit, écrase le faux client posé
     avant chargement. On le repose ici, juste avant boot(). */
  await page.evaluate(STUB);

  const r = await page.evaluate(async () => {
    const out = { scopes: null, erreur: null };
    if (!window.OlympeSBStore) { out.erreur = 'OlympeSBStore absent'; return out; }
    out.scopes = window.OlympeSBStore.scopes.slice();
    await new Promise(res => {
      try { window.OlympeSBStore.boot(function () { res(); }, function () {}); }
      catch (e) { out.erreur = String(e.message); res(); }
      setTimeout(res, 4000);
    });
    const cam = JSON.parse(window.OlympeSBStore.getItem('hermes_camion_v3') || '{}');
    const sac = JSON.parse(window.OlympeSBStore.getItem('olympe_histo_sac') || '{}');
    out.rotations = Object.keys(cam).length;
    out.sessions = Object.keys(sac).length;
    out.morts = Object.keys(sac).filter(k => k.indexOf('mort') === 0).length;
    out.requetes = window.__requetes;
    return out;
  });
  await page.close();
  return { ...r, erreurs };
}

async function direction(browser, fichier) {
  const page = await browser.newPage();
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(String(e.message).slice(0, 180)));
  await page.addInitScript(STUB);
  await page.goto('file://' + fichier, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.evaluate(STUB);
  const r = await page.evaluate(async () => {
    const out = {};
    if (typeof window.connect === 'function') {
      try { window.connect('pfa', 'x'); } catch (e) { out.erreur = String(e.message); }
    } else if (typeof window.reloadAll === 'function') {
      try { window.reloadAll(); } catch (e) { out.erreur = String(e.message); }
    } else { out.erreur = 'ni connect() ni reloadAll() accessibles'; }
    await new Promise(res => setTimeout(res, 2500));
    out.requetes = window.__requetes || 0;
    out.lignes = window.__lignesRendues || 0;
    return out;
  });
  await page.close();
  return { ...r, erreurs };
}

(async () => {
  /* olympe-scopes.js doit être à côté des dashboards patchés */
  fs.copyFileSync(path.resolve('olympe-scopes.js'), path.join(DOSSIER, 'olympe-scopes.js'));

  const browser = await chromium.launch();

  console.log('\n  ══ AVANT (version d\'origine) ══');
  const gA = await gillot(browser, path.resolve('dashboard_gillot.html'));
  chk(gA.scopes && gA.scopes.indexOf('hermes_camion_v3') >= 0,
    'Gillot : hermes_camion_v3 dans les scopes chargés',
    'absent — la carte « COLIS MONTÉS CAMION » ne peut rien afficher');
  chk(gA.requetes >= 2, 'Gillot : plusieurs requêtes (pagination)',
    gA.requetes + ' requête(s) — jeu tronqué à 1000 lignes');

  const dA = await direction(browser, path.resolve('dashboard-direction.html'));
  chk(dA.requetes >= 2, 'Direction : plusieurs requêtes (pagination)',
    dA.requetes + ' requête(s) pour ' + dA.lignes + ' ligne(s) rendues');

  console.log('\n  ══ APRÈS (référentiel partagé) ══');
  const gB = await gillot(browser, path.join(DOSSIER, 'dashboard_gillot.html'));
  chk(!gB.erreur, 'Gillot : démarrage sans exception', gB.erreur);
  chk(gB.scopes && gB.scopes.indexOf('hermes_camion_v3') >= 0,
    'Gillot : hermes_camion_v3 chargé', JSON.stringify(gB.scopes && gB.scopes.length));
  ['olympe_reexped_v1', 'olympe_histo_maritime', 'olympe_histo_chronopost',
    'hermes_uld_histo'].forEach(s => {
      chk(gB.scopes && gB.scopes.indexOf(s) >= 0, 'Gillot : « ' + s + ' » chargé');
    });
  chk(gB.rotations === 1400, 'Gillot : les 1400 rotations Camion sont là',
    'obtenu ' + gB.rotations + ' en ' + gB.requetes + ' requête(s)');
  chk(gB.requetes >= 2, 'Gillot : pagination effective (' + gB.requetes + ' requêtes)');
  chk(gB.morts === 0, 'Gillot : aucun marqueur de suppression compté',
    'lus : ' + gB.morts);
  chk(gB.sessions === 300, 'Gillot : 300 sessions CP84 vivantes',
    'obtenu ' + gB.sessions);
  chk(gB.erreurs.length === 0, 'Gillot : aucune erreur JS', gB.erreurs.join(' | '));

  const dB = await direction(browser, path.join(DOSSIER, 'dashboard-direction.html'));
  chk(dB.requetes >= 2, 'Direction : pagination effective (' + dB.requetes + ' requêtes)',
    dB.erreur || '');
  chk(dB.lignes > 1000, 'Direction : plus de 1000 lignes chargées (' + dB.lignes + ')');

  console.log('\n  ══ Garde : olympe-scopes.js absent ══');
  fs.unlinkSync(path.join(DOSSIER, 'olympe-scopes.js'));
  const gC = await gillot(browser, path.join(DOSSIER, 'dashboard_gillot.html'));
  chk(!gC.scopes || gC.erreur, 'Gillot refuse de démarrer sans le référentiel',
    'il a démarré avec ' + (gC.scopes && gC.scopes.length) + ' scopes');

  await browser.close();
  console.log('\n  ' + ok + ' contrôle(s) OK · ' + ko + ' en échec');
  console.log('  (les échecs de la section AVANT sont attendus : ils décrivent le défaut)\n');
  process.exit(0);
})();
