/* ══════════════════════════════════════════════════════════════════════════
   test_del_uld.js — supprimer une journée Hermès doit AUSSI effacer ses
   historiques ULD et MRD, et le déclarer au store.

   Le test rejoue le scénario exact : une journée avec un ULD Corsair, une
   suppression depuis l'Historique, puis on regarde ce que les dashboards
   liraient. Il rougit sur la version d'avant — c'est son objet.

   USAGE   node test_del_uld.js [fichier.html]
   ══════════════════════════════════════════════════════════════════════════ */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const CIBLE = path.resolve(process.argv[2] || 'index2_del.html');
const SCOPES_JS = fs.readFileSync(path.resolve('olympe-scopes.js'), 'utf8');
const JOUR = '2026-09-20';

let ok = 0, ko = 0;
function chk(c, l, d) {
  if (c) { ok++; console.log('  ✓ ' + l); }
  else { ko++; console.log('  ✗ ' + l + (d ? '\n      ' + d : '')); }
}

const ATTENDUES = /OlympeStore is not defined|renderDash is not defined|OlympeDB is not defined/;

(async () => {
  console.log('\n  CIBLE : ' + CIBLE);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const erreurs = [];
  page.on('pageerror', e => {
    const m = String(e.message).slice(0, 160);
    if (!ATTENDUES.test(m)) erreurs.push(m);
  });

  await page.addInitScript((j) => {
    try {
      sessionStorage.setItem('olympe.testmode', '1');
      localStorage.clear();
      localStorage.setItem('olympe_profil', JSON.stringify({ prenom: 'Test', role: 'admin' }));
    } catch (e) { }
    window.OlympeAuth = {
      client: () => null, profile: () => ({ role: 'admin' }),
      isAdmin: () => true, user: () => ({ id: 'test' })
    };
    /* Une suppression demande confirmation : on répond oui, comme l'agent. */
    window.confirm = () => true;
    window.alert = () => { };
    window.__jour = j;
  }, JOUR);
  await page.addInitScript(SCOPES_JS);

  await page.goto('file://' + CIBLE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);

  const r = await page.evaluate(async () => {
    const J = window.__jour;
    const out = { oublis: [], erreur: null };

    /* On observe ce que le store reçoit comme déclarations de suppression :
       sans elles, diff() restaure l'entrée au prochain hydrate et le
       correctif n'aurait l'air de marcher que jusqu'au lendemain. */
    window.OlympeStore = window.OlympeStore || {};
    window.OlympeStore.forget = function (scope, ids) {
      out.oublis.push({ scope: scope, ids: [].concat(ids) });
      return window.OlympeStore;
    };

    /* État de départ : une journée Hermès + son ULD Corsair + un MRD. */
    OlympeDB.setItem('hermes_gillot_v4', JSON.stringify({
      dates: { [J]: { brief: [{ cp: 'Corsair', nv: 'SS910', pk: 1500 }], rots: [], mx: [] } },
      prod: [], cm: {}, si: {}
    }));
    OlympeDB.setItem('hermes_uld_histo', JSON.stringify({
      [J]: [{ cp: 'Corsair', nv: 'SS910', tu: 'AMF2103SS', np: '', pk: 1500, st: 'En cours' }],
      '2026-09-19': [{ cp: 'Air Austral', nv: 'UU974', pk: 900, st: 'Debarque' }]
    }));
    OlympeDB.setItem('hermes_mrd_histo', JSON.stringify({
      [J]: [{ cp: 'Corsair', vl: 'SS910', tu: 'AMF2103SS', fait: false }]
    }));

    const lire = k => { try { return JSON.parse(OlympeDB.getItem(k) || '{}'); } catch (e) { return {}; } };
    out.avant = {
      uld: Object.keys(lire('hermes_uld_histo')),
      mrd: Object.keys(lire('hermes_mrd_histo'))
    };

    try { delHD('hermes', J); } catch (e) { out.erreur = String(e.message); }
    await new Promise(r => setTimeout(r, 400));

    out.apres = {
      uld: Object.keys(lire('hermes_uld_histo')),
      mrd: Object.keys(lire('hermes_mrd_histo')),
      hermes: Object.keys(lire('hermes_gillot_v4').dates || {})
    };
    return out;
  });

  if (r.erreur) chk(false, 'delHD s\'exécute', r.erreur);

  console.log('\n  ── État de départ ──');
  chk(r.avant.uld.indexOf(JOUR) >= 0, 'la journée a bien un ULD en historique',
    JSON.stringify(r.avant.uld));
  chk(r.avant.mrd.indexOf(JOUR) >= 0, 'et un MRD');

  console.log('\n  ── Après suppression de la journée Hermès ──');
  chk(r.apres.uld.indexOf(JOUR) < 0,
    'l\'ULD de la journée est effacé — c\'est lui qui restait affiché au dashboard',
    'restant : ' + JSON.stringify(r.apres.uld));
  chk(r.apres.mrd.indexOf(JOUR) < 0, 'le MRD de la journée est effacé',
    'restant : ' + JSON.stringify(r.apres.mrd));
  chk(r.apres.uld.indexOf('2026-09-19') >= 0,
    'les AUTRES journées sont intactes — on supprime une journée, pas l\'historique',
    JSON.stringify(r.apres.uld));
  chk((r.apres.hermes || []).indexOf(JOUR) < 0, 'la journée Hermès elle-même est supprimée');

  console.log('\n  ── Déclaration au store (tombstones) ──');
  const scopes = r.oublis.map(o => o.scope);
  chk(scopes.indexOf('hermes_uld_histo') >= 0,
    'la suppression de l\'ULD est déclarée — sinon elle revient au prochain hydrate',
    JSON.stringify(r.oublis));
  chk(scopes.indexOf('hermes_mrd_histo') >= 0, 'celle du MRD aussi');
  const uld = r.oublis.find(o => o.scope === 'hermes_uld_histo');
  chk(uld && uld.ids.length === 1 && uld.ids[0] === JOUR,
    'et elle ne déclare QUE la journée supprimée',
    JSON.stringify(uld));

  chk(erreurs.length === 0, 'aucune erreur JS', erreurs.slice(0, 2).join(' | '));

  await browser.close();
  console.log('\n  ' + ok + ' contrôle(s) OK · ' + ko + ' en échec\n');
  process.exit(ko ? 1 : 0);
})();
