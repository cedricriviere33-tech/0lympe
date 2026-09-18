/* Test de démarrage headless — mêmes conventions que d'habitude :
   sessionStorage['olympe.testmode']='1' + OlympeAuth stubbé, pour que le
   monolithe démarre sur file:// sans dépendance Supabase. */
const { chromium } = require('playwright');
const path = require('path');

const FILE = 'file://' + path.resolve('index2.html');
const err = [];
let ko = 0;
function chk(nom, ok, det) {
  console.log((ok ? '  ok  ' : '  KO  ') + nom + (det ? '   ' + det : ''));
  if (!ok) ko++;
}

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox','--allow-file-access-from-files'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();

  p.on('pageerror', e => err.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') err.push('console: ' + m.text().slice(0, 200)); });

  await p.addInitScript(() => {
    try { sessionStorage.setItem('olympe.testmode', '1'); } catch (e) { }
    window.OlympeAuth = {
      client: () => null, user: () => ({ id: 'test', email: 'pfa@0lympe.local' }),
      isAdmin: () => true, signOut: () => { }, on: () => { }
    };
    // Jeu de données MRD : 3 jours, 5 compagnies, 2 agents de piste
    const cies = [['Air Austral', 'RAA'], ['Air France', 'RAA'], ['Air Mauritius', 'RAA'],
    ['Corsair', 'SAMSIC'], ['French Bee', 'SAMSIC']];
    const ent = []; let k = 0;
    ['2026-09-15', '2026-09-16', '2026-09-17'].forEach((d, di) => {
      cies.forEach((c, ci) => {
        for (let i = 0; i <= (ci + di) % 4; i++) {
          ent.push({
            id: 'T' + (k++), palette: 'PMC0' + (300 + k), cp: c[0], ag: c[1],
            ts: d + 'T08:0' + (i % 6) + ':00.000Z', src: 'manuel'
          });
        }
      });
    });
    try { localStorage.setItem('olympe_mrd_releve_v1', JSON.stringify({ entries: ent })); } catch (e) { }
    window.__NB_MRD = ent.length;
  });

  await p.goto(FILE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForTimeout(3500);

  console.log('\n── BOOT ──────────────────────────────────────────');
  chk('build exposé', await p.evaluate(() => window.OLYMPE_BUILD || ''), await p.evaluate(() => window.OLYMPE_BUILD));
  chk('OlympeCamionApp présent', await p.evaluate(() => typeof window.OlympeCamionApp === 'object'));
  chk('MRDReleve présent', await p.evaluate(() => typeof window.MRDReleve === 'object'));
  chk('MRDReleve.stats exposé', await p.evaluate(() => typeof window.MRDReleve.stats === 'function'));

  /* ═══ MFA RETIRÉ (option B) ═══════════════════════════════════════ */
  console.log('\n── MFA RETIRÉ ────────────────────────────────────');
  // Sur file:// les <script src> externes ne chargent pas : un test DOM sur
  // OlympeMFA passerait de toute façon. On vérifie donc la SOURCE.
  {
    const fs = require('fs');
    const code = fs.readFileSync('index2.html', 'utf8')
      .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*|   )/.test(l)).join('\n');
    chk('aucun appel à OlympeMFA', !/OlympeMFA\s*\./.test(code));
    chk('balise olympe-mfa.js retirée', !/src="olympe-mfa\.js"/.test(code));
    chk('balise olympe-auth.js conservée', /src="olympe-auth\.js"/.test(code));
    chk('olympeSyncBadge() intact', /function olympeSyncBadge\s*\(/.test(code));
  }
  chk('bouton 🔐 Sécurité retiré', await p.evaluate(() => !document.getElementById('olympe-sec-btn')));
  chk('panneau Sécurité retiré', await p.evaluate(() => !document.getElementById('olympe-sec')));
  chk('modale d\'enrôlement retirée', await p.evaluate(() => typeof window.olympeEnrollMFA === 'undefined'));


  /* ═══ CAMION ═══════════════════════════════════════════════════════ */
  console.log('\n── CAMION · BARRE UNIQUE ─────────────────────────');
  await p.evaluate(() => window.OlympeCamionApp.open());
  await p.waitForTimeout(700);

  chk('overlay ouvert', await p.evaluate(() => !!document.querySelector('#ocm-ov.on')));
  chk('barre unique présente', await p.evaluate(() => !!document.getElementById('ocm-sc-u')));
  chk('mode unique par défaut',
    await p.evaluate(() => !document.querySelector('#ocm-ov .ocm-scan').classList.contains('two')));
  chk('2 étapes masqué par défaut',
    await p.evaluate(() => getComputedStyle(document.getElementById('ocm-classic')).display === 'none'));
  chk('bouton de bascule présent', await p.evaluate(() => !!document.getElementById('ocm-swap')));

  // Lecture à la volée
  await p.fill('#ocm-sc-u', 'CTOCPRCP');
  await p.waitForTimeout(150);
  const hint = await p.evaluate(() => document.getElementById('ocm-uhint').textContent);
  chk('lecture à la volée', /CTOC PRIO/.test(hint) && /CP/.test(hint), hint.trim().slice(0, 60));

  // 5 flashs : 3 CTOC PRIO en CP, 2 BTOC ECO en CE30
  for (const code of ['CTOCPRCP', 'CTOCPRCP', 'CTOCPRCP', 'BTOCECCE', 'BTOCECCE']) {
    await p.fill('#ocm-sc-u', code);
    await p.press('#ocm-sc-u', 'Enter');
    await p.waitForTimeout(90);
  }
  const grid = await p.evaluate(() => {
    const raw = (window.OlympeDB && window.OlympeDB.getItem)
      ? window.OlympeDB.getItem('hermes_camion_v3')
      : localStorage.getItem('hermes_camion_v3');
    const db = JSON.parse(raw || '{}');
    const d = Object.keys(db.days || {})[0];
    return db.days[d].voy[1].dep.grid;
  });
  const prods = await p.evaluate(() => window.OlympeCamionApp.test('CTOCPRCP'));
  chk('diagnostic étiquette unique', prods.etiquetteUnique && prods.etiquetteUnique.col === 'CP',
    JSON.stringify(prods.etiquetteUnique));
  const vals = Object.values(grid);
  chk('5 unités écrites', vals.reduce((a, b) => a + b, 0) === 5, JSON.stringify(grid));
  chk('2 lignes de grille', Object.keys(grid).length === 2, Object.keys(grid).join(' · '));

  // Refus : étiquette produit seule → rien écrit
  await p.fill('#ocm-sc-u', 'CTOCPR');
  await p.press('#ocm-sc-u', 'Enter');
  await p.waitForTimeout(150);
  const stat = await p.evaluate(() => document.getElementById('ocm-stat').textContent);
  const after = await p.evaluate(() => {
    const raw = (window.OlympeDB && window.OlympeDB.getItem)
      ? window.OlympeDB.getItem('hermes_camion_v3')
      : localStorage.getItem('hermes_camion_v3');
    const db = JSON.parse(raw || '{}');
    const d = Object.keys(db.days || {})[0];
    return Object.values(db.days[d].voy[1].dep.grid).reduce((a, b) => a + b, 0);
  });
  chk('produit sans contenant refusé', /contenant manquant/.test(stat), stat.trim().slice(0, 60));
  chk('aucune écriture après refus', after === 5, 'total=' + after);

  // Bascule vers le mode 2 étapes, puis retour
  await p.click('#ocm-swap');
  await p.waitForTimeout(300);
  chk('bascule 2 étapes',
    await p.evaluate(() => document.querySelector('#ocm-ov .ocm-scan').classList.contains('two')
      && getComputedStyle(document.getElementById('ocm-sc-c')).display !== 'none'));
  chk('préférence mémorisée', await p.evaluate(() => localStorage.getItem('olympe_ocm_scanmode') === 'two'));
  // L'ancien flashage doit toujours fonctionner
  await p.fill('#ocm-sc-c', 'CP0042');
  await p.press('#ocm-sc-c', 'Enter');
  await p.waitForTimeout(120);
  await p.fill('#ocm-sc-p', 'CTOCPR');
  await p.press('#ocm-sc-p', 'Enter');
  await p.waitForTimeout(150);
  const after2 = await p.evaluate(() => {
    const raw = (window.OlympeDB && window.OlympeDB.getItem)
      ? window.OlympeDB.getItem('hermes_camion_v3')
      : localStorage.getItem('hermes_camion_v3');
    const db = JSON.parse(raw || '{}');
    const d = Object.keys(db.days || {})[0];
    return Object.values(db.days[d].voy[1].dep.grid).reduce((a, b) => a + b, 0);
  });
  chk('ancien flashage 2 étapes intact', after2 === 6, 'total=' + after2);
  await p.click('#ocm-swap');
  await p.waitForTimeout(250);
  chk('retour barre unique', await p.evaluate(() => localStorage.getItem('olympe_ocm_scanmode') === 'uni'));

  await p.evaluate(() => window.OlympeCamionApp.close());
  await p.waitForTimeout(300);

  /* ═══ MRD STATISTIQUES ═════════════════════════════════════════════ */
  console.log('\n── MRD · STATISTIQUES ────────────────────────────');
  await p.evaluate(() => window.MRDReleve.open());
  await p.waitForTimeout(400);
  chk('bouton stats dans la barre', await p.evaluate(() => !!document.getElementById('mr-stats-btn')));

  await p.evaluate(() => window.MRDReleve.statsSet({ from: '2026-09-15', to: '2026-09-17', group: 'cie', chart: 'bar' }));
  await p.waitForTimeout(1200);

  chk('fenêtre élargie', await p.evaluate(() => document.querySelector('#mrdModal .mr-card').classList.contains('wide')));
  chk('histogramme dessiné', await p.evaluate(() => document.querySelectorAll('#mr-body .mr-bar').length > 0),
    await p.evaluate(() => document.querySelectorAll('#mr-body .mr-bar').length + ' barres'));
  chk('barres animées jusqu\'à leur hauteur finale', await p.evaluate(() => {
    const r = [].slice.call(document.querySelectorAll('#mr-body .mr-bar'));
    return r.length > 0 && r.every(x => parseFloat(x.getAttribute('height')) === parseFloat(x.getAttribute('data-h')));
  }));
  const totAff = await p.evaluate(() => {
    const t = document.querySelector('#mr-body .mr-tab tfoot td.n.b');
    return t ? parseInt(t.textContent, 10) : -1;
  });
  const totRef = await p.evaluate(() => window.__NB_MRD);
  chk('total tableau = jeu de données', totAff === totRef, totAff + ' / ' + totRef);
  chk('5 compagnies en ligne', await p.evaluate(() => document.querySelectorAll('#mr-body .mr-tab tbody tr').length === 5));

  // Groupement par agent
  await p.evaluate(() => window.MRDReleve.statsSet({ group: 'agent' }));
  await p.waitForTimeout(900);
  chk('groupement par agent', await p.evaluate(() => document.querySelectorAll('#mr-body .mr-tab tbody tr').length === 2));

  // Groupement par jour + barres horizontales
  await p.evaluate(() => window.MRDReleve.statsSet({ group: 'jour', chart: 'barh' }));
  await p.waitForTimeout(900);
  chk('groupement par jour (3 jours)', await p.evaluate(() => document.querySelectorAll('#mr-body .mr-tab tbody tr').length === 3));
  chk('barres horizontales largeur finale', await p.evaluate(() => {
    const r = [].slice.call(document.querySelectorAll('#mr-body .mr-bar[data-w]'));
    return r.length > 0 && r.every(x => parseFloat(x.getAttribute('width')) === parseFloat(x.getAttribute('data-w')));
  }));

  // Camembert
  await p.evaluate(() => window.MRDReleve.statsSet({ group: 'cie', chart: 'pie' }));
  await p.waitForTimeout(1100);
  chk('camembert dessiné', await p.evaluate(() => document.querySelectorAll('#mr-body .mr-arc').length > 0),
    await p.evaluate(() => document.querySelectorAll('#mr-body .mr-arc').length + ' arcs'));
  chk('arcs déployés', await p.evaluate(() => {
    const a = [].slice.call(document.querySelectorAll('#mr-body .mr-arc[data-da]'));
    return a.length > 0 && a.every(x => x.getAttribute('stroke-dasharray') === x.getAttribute('data-da'));
  }));
  chk('légende présente', await p.evaluate(() => document.querySelectorAll('#mr-body .mr-lg').length === 5));

  // Comparaison de deux périodes
  await p.evaluate(() => window.MRDReleve.statsSet({
    chart: 'bar', group: 'cie', cmp: true,
    from: '2026-09-17', to: '2026-09-17', from2: '2026-09-15', to2: '2026-09-16'
  }));
  await p.waitForTimeout(900);
  chk('série B dessinée', await p.evaluate(() => document.querySelectorAll('#mr-body .mr-bar.b').length > 0));
  chk('colonne Écart présente', await p.evaluate(() =>
    [].slice.call(document.querySelectorAll('#mr-body .mr-tab th')).some(t => /Écart/.test(t.textContent))));
  chk('légende A/B', await p.evaluate(() => !!document.querySelector('#mr-body .mr-cmplg')));

  // Comparaison sur axe temporel : alignement rang par rang
  await p.evaluate(() => window.MRDReleve.statsSet({
    chart: 'bar', group: 'jour', cmp: true,
    from: '2026-09-16', to: '2026-09-17', from2: '2026-09-15', to2: '2026-09-15'
  }));
  await p.waitForTimeout(900);
  const alg = await p.evaluate(() => {
    const tr = [].slice.call(document.querySelectorAll('#mr-body .mr-tab tbody tr'));
    return tr.map(r => [].slice.call(r.querySelectorAll('td')).map(td => td.textContent.trim()));
  });
  chk('axe aligné rang par rang (2 rangs)', alg.length === 2, JSON.stringify(alg.map(r => r[0])));
  chk('rang 1 = 16/09 face au 15/09', /16\/09/.test(alg[0][0]) && /15\/09/.test(alg[0][0]), alg[0][0]);
  chk('rang 2 sans vis-à-vis', /—/.test(alg[1][0]), alg[1][0]);
  chk('écart du rang 2 = tout A', alg[1][3] === '+' + alg[1][1], alg[1].join(' | '));
  chk('mention d\'alignement affichée',
    await p.evaluate(() => !!document.querySelector('#mr-body .mr-cmplg .al')));

  // Filtre par agent
  await p.evaluate(() => window.MRDReleve.statsSet({ cmp: false, filt: 'SAMSIC', from: '2026-09-15', to: '2026-09-17' }));
  await p.waitForTimeout(800);
  const nSam = await p.evaluate(() => {
    const t = document.querySelector('#mr-body .mr-tab tfoot td.n.b');
    return t ? parseInt(t.textContent, 10) : -1;
  });
  const refSam = await p.evaluate(() => JSON.parse(((window.OlympeDB && window.OlympeDB.getItem)
    ? window.OlympeDB.getItem('olympe_mrd_releve_v1')
    : localStorage.getItem('olympe_mrd_releve_v1')) || '{"entries":[]}').entries
    .filter(e => e.ag === 'SAMSIC').length);
  chk('filtre SAMSIC', nSam === refSam, nSam + ' / ' + refSam);

  // Export CSV
  await p.evaluate(() => window.MRDReleve.statsSet({ filt: 'all' }));
  await p.waitForTimeout(600);
  const dl = await Promise.all([
    p.waitForEvent('download', { timeout: 8000 }).catch(() => null),
    p.click('#st-csv')
  ]).then(r => r[0]);
  chk('téléchargement CSV déclenché', !!dl, dl ? dl.suggestedFilename() : '—');
  if (dl) {
    const fs = require('fs');
    const dst = '/tmp/mrd_test.csv';
    await dl.saveAs(dst);
    const txt = fs.readFileSync(dst, 'utf8');
    chk('BOM UTF-8 (Excel FR)', txt.charCodeAt(0) === 0xFEFF);
    chk('séparateur point-virgule', txt.indexOf(';') > 0);
    chk('accents conservés', /Période|Synthèse|Détail/.test(txt));
    chk('détail des palettes exporté', (txt.match(/PMC0/g) || []).length === totRef,
      (txt.match(/PMC0/g) || []).length + ' lignes');
  }

  // Impression : la fenêtre doit s'ouvrir et contenir un SVG figé
  const [pop] = await Promise.all([
    ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null),
    p.click('#st-print')
  ]);
  chk('fenêtre d\'impression ouverte', !!pop);
  if (pop) {
    await pop.waitForTimeout(700);
    chk('graphique dans le document imprimé', await pop.evaluate(() => document.querySelectorAll('svg .mr-bar').length > 0));
    chk('aucune barre à zéro dans l\'impression', await pop.evaluate(() =>
      [].slice.call(document.querySelectorAll('svg .mr-bar')).every(r => !r.hasAttribute('data-h'))));
    chk('tableau détail imprimé', await pop.evaluate(() => /PMC0/.test(document.body.textContent)));
    await pop.close();
  }

  /* ═══ Non-régression : les vues existantes répondent ═══════════════ */
  console.log('\n── NON-RÉGRESSION ────────────────────────────────');
  await p.evaluate(() => window.MRDReleve.home());
  await p.waitForTimeout(400);
  chk('vue principale intacte', await p.evaluate(() => !!document.querySelector('#mr-body .mr-agent.raa')));
  chk('fenêtre revenue à sa largeur',
    await p.evaluate(() => !document.querySelector('#mrdModal .mr-card').classList.contains('wide')));
  await p.evaluate(() => window.MRDReleve.agent('RAA'));
  await p.waitForTimeout(400);
  chk('vue agent intacte', await p.evaluate(() => !!document.querySelector('#mr-body .mr-cie')));

  console.log('\n── ERREURS CONSOLE ───────────────────────────────');
  const graves = err.filter(e => !/favicon|net::ERR_FILE_NOT_FOUND|supabase|Failed to load resource/i.test(e));
  if (graves.length) { graves.slice(0, 12).forEach(e => console.log('  ! ' + e)); ko += graves.length; }
  else console.log('  aucune erreur JS bloquante');

  await b.close();
  console.log('\n' + (ko ? '❌ ' + ko + ' ÉCHEC(S)' : '✅ TOUS LES TESTS PASSENT'));
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
