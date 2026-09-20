/* ══════════════════════════════════════════════════════════════════════════
   test_bus.js — OlympeBus : routage, garde de saisie, isolation des erreurs.

   Le store est inatteignable en file:// (pas de Supabase). On n'en a pas
   besoin : le contrat du bus est l'événement 'olympe:remote', que le store
   émet déjà en production (olympe-store.js, subscribe(), l.405). On émet donc
   le même événement, avec la même forme, et on observe ce que les modules
   font. C'est le contrat qui est testé, pas une imitation du réseau.

   USAGE   node test_bus.js [fichier.html]
   ══════════════════════════════════════════════════════════════════════════ */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const CIBLE = path.resolve(process.argv[2] || 'index2_bus2.html');

/* Le référentiel partagé doit être présent avant les scripts de la page,
   comme en production où index2.html le charge par balise. */
const SCOPES_JS = fs.readFileSync(path.resolve('olympe-scopes.js'), 'utf8');

const H_STORE = {
  dates: {}, _prodv5: true,
  si: { CP: 0, CE30: 0, CV300: 0, KUB: 0, PAL: 0 },
  prod: ['CTOC PRIO', 'CTOC ECO', 'BTOC PRIO', 'BTOC ECO', 'BTOC JAVER',
    'Roissy', 'Presse', 'Cabine', 'Inter OO', 'Inter OS', 'Singapour',
    'Fausse direction', 'Anomalie colis', 'Courrier à ventiler'],
  cm: { 'CTOCPR': 'CTOC PRIO', 'PPIOO': 'Inter OO' }
};

const ATTENDUES = /OlympeStore is not defined|renderDash is not defined|OlympeDB is not defined/;

let ok = 0, ko = 0;
function chk(c, l, d) {
  if (c) { ok++; console.log('  ✓ ' + l); }
  else { ko++; console.log('  ✗ ' + l + (d ? '\n      ' + d : '')); }
}

(async () => {
  console.log('\n  CIBLE : ' + CIBLE + '\n');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', e => {
    const m = String(e.message).slice(0, 160);
    if (!ATTENDUES.test(m)) erreurs.push(m);
  });

  await page.addInitScript((h) => {
    try {
      sessionStorage.setItem('olympe.testmode', '1');
      localStorage.clear();
      localStorage.setItem('hermes_gillot_v4', JSON.stringify(h));
      localStorage.setItem('olympe_profil', JSON.stringify({ prenom: 'Test', role: 'admin' }));
    } catch (e) { }
    window.OlympeAuth = {
      client: () => null, profile: () => ({ role: 'admin' }),
      isAdmin: () => true, user: () => ({ id: 'test' })
    };
  }, H_STORE);
  await page.addInitScript(SCOPES_JS);

  await page.goto('file://' + CIBLE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);

  /* ── 1. Le bus est posé avant les modules ───────────────────────────── */
  console.log('  ── Pose du bus ──');
  const pose = await page.evaluate(() => ({
    present: typeof window.OlympeBus,
    api: window.OlympeBus ? Object.keys(window.OlympeBus).sort() : [],
    modules: window.OlympeBus ? OlympeBus.modules() : [],
    etat: window.OlympeBus ? OlympeBus.etat() : { modules: [] }
  }));
  chk(pose.present === 'object', 'OlympeBus exposé');
  chk(['emettre', 'etat', 'modules', 'off', 'on'].every(k => pose.api.indexOf(k) >= 0),
    'API complète', JSON.stringify(pose.api));
  chk(['apps-iframe', 'analytics', 'historique', 'mrd-releve'].every(m => pose.modules.indexOf(m) >= 0),
    'applications, Analytics, Historique et MRD inscrits', JSON.stringify(pose.modules));
  const appsIf = pose.etat.modules.find(m => m.id === 'apps-iframe');
  chk(appsIf && appsIf.scopes === 35,
    'les iframes suivent les 35 scopes du référentiel partagé',
    'scopes surveillés : ' + (appsIf && appsIf.scopes));

  /* ── 2. Camion s'inscrit à l'ouverture de l'onglet ───────────────────── */
  console.log('\n  ── Inscription de l\'onglet Camion ──');
  const camion = await page.evaluate(async () => {
    OlympeCamionApp.open();
    await new Promise(r => setTimeout(r, 300));
    return { modules: OlympeBus.modules() };
  });
  chk(camion.modules.indexOf('camion') >= 0, 'camion inscrit après ouverture',
    JSON.stringify(camion.modules));

  /* ── 3. Routage par scope ────────────────────────────────────────────── */
  console.log('\n  ── Routage par scope ──');
  const routage = await page.evaluate(async () => {
    const compte = () => OlympeBus.etat().modules
      .reduce((o, m) => (o[m.id] = m.rendus, o), {});
    const avant = compte();

    /* Scope surveillé par personne : rien ne doit bouger. */
    window.dispatchEvent(new CustomEvent('olympe:remote',
      { detail: { scope: 'olympe_scope_inexistant', entry_id: 'x', by: 'autre' } }));
    await new Promise(r => setTimeout(r, 600));
    const apresHorsScope = compte();

    /* Scope d'Hermès : seules les vues concernées se redessinent. */
    window.dispatchEvent(new CustomEvent('olympe:remote',
      { detail: { scope: 'hermes_camion_v3', entry_id: 'd:2026-09-20', by: 'Jérémie' } }));
    await new Promise(r => setTimeout(r, 700));
    const apresDansScope = compte();

    return { avant, apresHorsScope, apresDansScope };
  });
  const bouge = (a, b) => Object.keys(b).filter(k => b[k] !== a[k]);
  chk(bouge(routage.avant, routage.apresHorsScope).length === 0,
    'un scope non surveillé ne redessine personne',
    'ont bougé : ' + JSON.stringify(bouge(routage.avant, routage.apresHorsScope)));
  const mus = bouge(routage.apresHorsScope, routage.apresDansScope);
  chk(mus.length > 0, 'un scope surveillé déclenche les vues concernées',
    'aucune vue n\'a réagi');
  chk(mus.indexOf('camion') >= 0, 'camion réagit à hermes_camion_v3', JSON.stringify(mus));

  /* ── 4. Une rafale de lignes = un seul rendu ─────────────────────────── */
  console.log('\n  ── Regroupement des rafales ──');
  const rafale = await page.evaluate(async () => {
    const n0 = OlympeBus.etat().modules.find(m => m.id === 'camion').rendus;
    for (let i = 0; i < 20; i++) {
      window.dispatchEvent(new CustomEvent('olympe:remote',
        { detail: { scope: 'hermes_camion_v3', entry_id: 'e' + i, by: 'Éric' } }));
    }
    await new Promise(r => setTimeout(r, 800));
    const n1 = OlympeBus.etat().modules.find(m => m.id === 'camion').rendus;
    return n1 - n0;
  });
  chk(rafale <= 1, '20 lignes d\'un coup → au plus un rendu (obtenu : ' + rafale + ')');

  /* ── 5. La garde de saisie — le point qui compte ─────────────────────
     Règle : on protège une SAISIE, pas un focus. La barre de flashage de
     Camion garde le focus en permanence pour la douchette ; une garde sur le
     focus seul y gèlerait tout rafraîchissement à vie. Les deux cas sont
     donc testés, et le second est celui qui compte en production. */
  console.log('\n  ── Garde de saisie ──');
  const garde = await page.evaluate(async () => {
    const etat = () => OlympeBus.etat().modules.find(m => m.id === 'camion');
    const inp = document.getElementById('ocm-sc-u') || document.getElementById('ocm-sc-c');
    if (!inp) return { err: 'champ de saisie introuvable' };

    /* (a) Champ VIDE et focalisé — l'état permanent de l'onglet Camion.
           Le rendu doit passer : sinon Camion ne se met plus jamais à jour. */
    inp.value = '';
    inp.focus();
    const videFocus = document.activeElement === inp;
    const avantVide = etat().rendus;
    window.dispatchEvent(new CustomEvent('olympe:remote',
      { detail: { scope: 'hermes_camion_v3', entry_id: 'v1', by: 'Éric' } }));
    await new Promise(r => setTimeout(r, 700));
    const apresVide = etat().rendus;

    /* (b) Frappe en cours — un code à moitié saisi. Là, on protège. */
    inp.value = '203974850CTO';
    inp.focus();
    const av = etat();
    window.dispatchEvent(new CustomEvent('olympe:remote',
      { detail: { scope: 'hermes_camion_v3', entry_id: 'z', by: 'Nathan' } }));
    await new Promise(r => setTimeout(r, 700));
    const pendant = etat();

    /* (c) L'agent termine : le rendu reporté doit finir par tomber. */
    inp.value = '';
    inp.blur();
    await new Promise(r => setTimeout(r, 3200));
    const apres = etat();

    return {
      videFocus, avantVide, apresVide,
      rendusAvant: av.rendus, rendusPendant: pendant.rendus, rendusApres: apres.rendus,
      reportsAvant: av.reportsSaisie, reportsPendant: pendant.reportsSaisie
    };
  });
  if (garde.err) { chk(false, 'garde de saisie', garde.err); }
  else {
    chk(garde.videFocus, 'curseur placé dans la barre de flashage');
    chk(garde.apresVide > garde.avantVide,
      'champ VIDE focalisé → le rendu passe (cas permanent de Camion)',
      'rendus ' + garde.avantVide + ' → ' + garde.apresVide);
    chk(garde.rendusPendant === garde.rendusAvant,
      'frappe en cours → aucun rendu',
      'rendus ' + garde.rendusAvant + ' → ' + garde.rendusPendant);
    chk(garde.reportsPendant > garde.reportsAvant,
      'le rendu est compté comme reporté, pas perdu',
      'reports ' + garde.reportsAvant + ' → ' + garde.reportsPendant);
    chk(garde.rendusApres > garde.rendusPendant,
      'le rendu tombe une fois la saisie terminée',
      'rendus ' + garde.rendusPendant + ' → ' + garde.rendusApres);
  }

  /* ── 6. Isolation des erreurs ────────────────────────────────────────── */
  console.log('\n  ── Isolation des erreurs ──');
  const isolation = await page.evaluate(async () => {
    let sainAppele = 0;
    OlympeBus.on({
      id: 'test-casse', scopes: ['olympe_histo_sac'], auBoot: false,
      fn: function () { throw new Error('module volontairement cassé'); }
    });
    OlympeBus.on({
      id: 'test-sain', scopes: ['olympe_histo_sac'], auBoot: false,
      fn: function () { sainAppele++; }
    });
    window.dispatchEvent(new CustomEvent('olympe:remote',
      { detail: { scope: 'olympe_histo_sac', entry_id: 'a', by: 'test' } }));
    await new Promise(r => setTimeout(r, 700));
    const e = OlympeBus.etat().modules;
    return {
      sainAppele,
      erreursCasse: (e.find(m => m.id === 'test-casse') || {}).erreurs,
      messageCasse: (e.find(m => m.id === 'test-casse') || {}).derniereErreur
    };
  });
  chk(isolation.erreursCasse === 1, 'l\'exception est comptée, pas avalée en silence',
    'erreurs: ' + isolation.erreursCasse);
  chk(isolation.sainAppele === 1, 'le module sain se redessine quand même',
    'appels: ' + isolation.sainAppele);
  chk(!!isolation.messageCasse, 'le message d\'erreur est conservé pour le diagnostic',
    String(isolation.messageCasse));

  /* ── 7. Réinscription : pas de doublon ──────────────────────────────── */
  console.log('\n  ── Réinscription du même module ──');
  const doublon = await page.evaluate(async () => {
    let n = 0;
    const f = () => { n++; };
    OlympeBus.on({ id: 'test-double', scopes: ['olympe_vgp_list'], auBoot: false, fn: f });
    OlympeBus.on({ id: 'test-double', scopes: ['olympe_vgp_list'], auBoot: false, fn: f });
    OlympeBus.on({ id: 'test-double', scopes: ['olympe_vgp_list'], auBoot: false, fn: f });
    window.dispatchEvent(new CustomEvent('olympe:remote',
      { detail: { scope: 'olympe_vgp_list', entry_id: 'a', by: 'test' } }));
    await new Promise(r => setTimeout(r, 700));
    return { appels: n, occurrences: OlympeBus.modules().filter(m => m === 'test-double').length };
  });
  chk(doublon.occurrences === 1, 'une seule inscription conservée',
    'occurrences: ' + doublon.occurrences);
  chk(doublon.appels === 1, 'appelé une seule fois', 'appels: ' + doublon.appels);

  /* ── 8. Démarrage sain ───────────────────────────────────────────────── */
  console.log('\n  ── Démarrage ──');
  chk(erreurs.length === 0, 'aucune erreur JS inattendue', erreurs.join(' | '));

  await browser.close();
  console.log('\n  ' + ok + ' contrôle(s) OK · ' + ko + ' en échec\n');
  process.exit(ko ? 1 : 0);
})();
