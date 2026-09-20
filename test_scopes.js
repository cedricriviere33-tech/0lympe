/* ══════════════════════════════════════════════════════════════════════════
   test_scopes.js — le référentiel partagé et le chargeur paginé.

   On fait tourner l'ANCIEN store et le NOUVEAU sur exactement les mêmes
   données, servies par un faux client Supabase qui respecte .range() comme le
   vrai. Trois choses sont vérifiées :

     1. le refactor ne change rien — mêmes blobs en sortie ;
     2. la pagination va bien au-delà de 1000 lignes ;
     3. les lignes supprimées (tombstones) ne sont pas lues comme des données.

   Le faux client est la seule façon de tester le plafond de PostgREST sans
   base : ce plafond est justement ce qui ne se voit pas en production.

   USAGE   node test_scopes.js
   ══════════════════════════════════════════════════════════════════════════ */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

/* localStorage est refusé sur une origine opaque (about:blank) : le harnais
   doit être une vraie page file://, comme l'application. */
const HARNAIS = path.join(os.tmpdir(), 'olympe-harnais.html');
fs.writeFileSync(HARNAIS, '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');

const SCOPES_JS = fs.readFileSync(path.resolve('olympe-scopes.js'), 'utf8');
const STORE_AVANT = fs.readFileSync(path.resolve('olympe-store.js'), 'utf8');
const STORE_APRES = fs.readFileSync(path.resolve('olympe-store-patched.js'), 'utf8');

let ok = 0, ko = 0;
function chk(c, l, d) {
  if (c) { ok++; console.log('  ✓ ' + l); }
  else { ko++; console.log('  ✗ ' + l + (d ? '\n      ' + d : '')); }
}

/* Jeu de données : assez volumineux pour franchir DEUX fois le plafond de
   1000 lignes, plus des tombstones mêlés aux lignes vivantes. */
const STUBS = `
window.OLYMPE_CFG = { debug: false, offlineQueue: false, pushDebounce: 800 };

window.__lignes = (function () {
  var out = [], i;
  /* 1200 journées Hermès — à elles seules au-delà du plafond */
  for (i = 0; i < 1200; i++) {
    out.push({ scope: 'hermes_gillot_v4', entry_id: 'd:2026-' + String((i % 12) + 1).padStart(2,'0') + '-' + String((i % 28) + 1).padStart(2,'0') + '-' + i,
               payload: { rots: [{ n: i }] }, deleted: false });
  }
  out.push({ scope: 'hermes_gillot_v4', entry_id: '_root', payload: { prod: ['A','B'], si: {} }, deleted: false });
  /* 900 sessions CP84 */
  for (i = 0; i < 900; i++) {
    out.push({ scope: 'olympe_histo_sac', entry_id: '2026-09-20T' + i, payload: { prio: i % 5, eco: i % 3 }, deleted: false });
  }
  /* 400 rotations camion */
  for (i = 0; i < 400; i++) {
    out.push({ scope: 'hermes_camion_v3', entry_id: 'c' + i, payload: { g: { '15-CP': i } }, deleted: false });
  }
  /* 150 tombstones : supprimées, donc à NE PAS lire */
  for (i = 0; i < 150; i++) {
    out.push({ scope: 'olympe_histo_sac', entry_id: 'supprimee-' + i, payload: null, deleted: true });
  }
  return out;
})();
window.__vivantes = window.__lignes.filter(function (r) { return !r.deleted; }).length;

/* Faux client Supabase — respecte select / eq / in / order / range comme
   PostgREST, plafond compris. */
function faireSB(lignes) {
  function requete() {
    var f = lignes.slice(), plage = null;
    var api = {
      select: function () { return api; },
      eq: function (col, val) { f = f.filter(function (r) { return r[col] === val; }); return api; },
      order: function (col) { f.sort(function (a, b) { return String(a[col]).localeCompare(String(b[col])); }); return api; },
      range: function (a, b) { plage = [a, b]; return api; },
      upsert: function () { return { then: function (res) { return Promise.resolve({ error: null }).then(res); } }; },
      then: function (res, rej) {
        var PLAFOND = 1000;
        var d = plage ? f.slice(plage[0], plage[1] + 1) : f;
        if (d.length > PLAFOND) d = d.slice(0, PLAFOND);   /* le vrai plafond, silencieux */
        window.__requetes = (window.__requetes || 0) + 1;
        return Promise.resolve({
          data: d.map(function (r) { return { scope: r.scope, entry_id: r.entry_id, payload: r.payload }; }),
          error: null
        }).then(res, rej);
      }
    };
    api['in'] = function (col, liste) { f = f.filter(function (r) { return liste.indexOf(r[col]) >= 0; }); return api; };
    return api;
  }
  return { from: function () { return requete(); }, channel: function () { return { on: function () { return this; }, subscribe: function () { return this; } }; } };
}

window.OlympeAuth = {
  client: function () { return faireSB(window.__lignes); },
  requireSession: function () { return Promise.resolve({ profile: { uid: 'test', nom: 'Test', role: 'admin' } }); },
  watchSignOut: function () {}
};

/* OlympeDB minimal — attach() remplace getItem/setItem par les siens. */
window.OlympeDB = {
  getItem: function () { return null; }, setItem: function () {},
  removeItem: function () {}, init: function () {}
};
`;

async function executer(browser, storeSrc, avecScopes) {
  const page = await browser.newPage();
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(String(e.message).slice(0, 200)));
  await page.goto('file://' + HARNAIS);
  await page.addScriptTag({ content: STUBS });
  if (avecScopes) await page.addScriptTag({ content: SCOPES_JS });
  await page.addScriptTag({ content: storeSrc });

  const res = await page.evaluate(async () => {
    const out = { erreur: null, blobs: {}, requetes: 0, vivantes: window.__vivantes };
    try {
      OlympeStore.attach(window.OlympeDB);
      await OlympeStore.hydrate();
      ['hermes_gillot_v4', 'olympe_histo_sac', 'hermes_camion_v3'].forEach(s => {
        const b = window.OlympeDB.getItem(s);
        out.blobs[s] = b ? b.length : 0;
      });
      const h = JSON.parse(window.OlympeDB.getItem('hermes_gillot_v4') || '{}');
      out.joursHermes = Object.keys(h.dates || {}).length;
      const sac = JSON.parse(window.OlympeDB.getItem('olympe_histo_sac') || '{}');
      out.sessionsSac = Object.keys(sac).length;
      out.tombstonesLues = Object.keys(sac).filter(k => k.indexOf('supprimee-') === 0).length;
    } catch (e) { out.erreur = String(e && e.message || e); }
    out.requetes = window.__requetes || 0;
    return out;
  });
  await page.close();
  return { ...res, erreurs };
}

(async () => {
  const browser = await chromium.launch();

  console.log('\n  ── Référentiel partagé ──');
  const ref = await (async () => {
    const p = await browser.newPage();
    await p.goto('file://' + HARNAIS);
    await p.addScriptTag({ content: SCOPES_JS });
    const r = await p.evaluate(() => ({
      build: OlympeScopes.BUILD,
      scopes: OlympeScopes.SCOPES.length,
      cumul: OlympeScopes.CUMULATIVE.length,
      dash: OlympeScopes.POUR_DASHBOARD.length,
      problemes: OlympeScopes.verifier()
    }));
    await p.close(); return r;
  })();
  chk(ref.problemes.length === 0, 'référentiel cohérent (' + ref.scopes + ' scopes, '
    + ref.cumul + ' cumulatifs, ' + ref.dash + ' dashboard)', ref.problemes.join(' | '));

  console.log('\n  ── Chargement : ancien store ──');
  const A = await executer(browser, STORE_AVANT, false);
  chk(!A.erreur, 'hydratation sans exception', A.erreur);
  chk(A.joursHermes === 1200, 'ancien store : 1200 journées Hermès',
    'obtenu ' + A.joursHermes + ' en ' + A.requetes + ' requête(s)');

  console.log('\n  ── Chargement : store sur référentiel partagé ──');
  const B = await executer(browser, STORE_APRES, true);
  chk(!B.erreur, 'hydratation sans exception', B.erreur);
  chk(B.joursHermes === 1200, 'nouveau store : 1200 journées Hermès',
    'obtenu ' + B.joursHermes + ' en ' + B.requetes + ' requête(s)');
  chk(B.sessionsSac === 900, 'nouveau store : 900 sessions CP84',
    'obtenu ' + B.sessionsSac);

  console.log('\n  ── Le refactor ne change rien ──');
  ['hermes_gillot_v4', 'olympe_histo_sac', 'hermes_camion_v3'].forEach(s => {
    chk(A.blobs[s] === B.blobs[s] && A.blobs[s] > 0,
      'blob identique avant/après pour « ' + s +' »',
      'avant ' + A.blobs[s] + ' octets · après ' + B.blobs[s]);
  });

  console.log('\n  ── Pagination au-delà du plafond ──');
  chk(B.requetes >= 3, 'plusieurs requêtes émises (' + B.requetes + ')',
    'une seule requête = jeu tronqué à 1000 lignes');
  chk(B.joursHermes + B.sessionsSac > 1000,
    'plus de 1000 lignes réellement chargées (' + (B.joursHermes + B.sessionsSac) + ')');

  console.log('\n  ── Lignes supprimées ──');
  chk(B.tombstonesLues === 0, 'aucun tombstone lu comme donnée vivante',
    'lus : ' + B.tombstonesLues);

  console.log('\n  ── Garde : olympe-scopes.js absent ──');
  const C = await executer(browser, STORE_APRES, false);
  chk(!!C.erreur || C.joursHermes === undefined,
    'le store REFUSE de démarrer sans le référentiel',
    'il a démarré : ' + JSON.stringify(C.blobs));

  const ecran = await (async () => {
    const p = await browser.newPage();
    await p.goto('file://' + HARNAIS);
    await p.addScriptTag({ content: STUBS });
    await p.addScriptTag({ content: STORE_APRES });
    await p.evaluate(() => { try { OlympeStore.attach(window.OlympeDB); } catch (e) {} });
    await p.waitForTimeout(150);
    const t = await p.evaluate(() => document.body.textContent || '');
    await p.close(); return t;
  })();
  chk(/olympe-scopes\.js/.test(ecran) && /Fichier manquant/.test(ecran),
    'et il le dit à l\'écran, au lieu de tourner sur une liste fausse',
    ecran.slice(0, 120));

  console.log('\n  ── Démarrage ──');
  chk(B.erreurs.length === 0, 'aucune erreur JS', B.erreurs.join(' | '));

  await browser.close();
  console.log('\n  ' + ok + ' contrôle(s) OK · ' + ko + ' en échec\n');
  process.exit(ko ? 1 : 0);
})();
