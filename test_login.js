/* test_login.js — vérification du retrait du verrou machine.
 *
 * Les dépendances réelles (supabase.js, olympe-config.js, olympe-auth.js,
 * olympe-mfa.js) sont remplacées par des bouchons : on teste l'aiguillage de
 * la page de connexion, pas Supabase. Le VRAI olympe-mfa.js est chargé à part
 * dans un test dédié pour vérifier sa surface d'API.
 *
 * Scénarios :
 *   A. aucune session         → sélecteur affiché, aucune redirection
 *   B. session pfa ouverte    → sélecteur + profil marqué, aucune redirection
 *   C. clic sur le profil marqué → entrée directe
 *   D. clic sur l'autre profil   → signOut() puis mot de passe
 *   E. connexion par mot de passe → entrée directe, sans écran intermédiaire
 *
 * Formats : 412×915, 915×412, 1440×900
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SRC = path.resolve('out/index.html');
const HARNESS = path.resolve('out/_harness.html');
const FORMATS = [[412, 915], [915, 412], [1440, 900]];

let ko = 0;
function chk(nom, ok, det) {
  console.log((ok ? '  ok  ' : '  KO  ') + nom + (det ? '   ' + det : ''));
  if (!ok) ko++;
}

/* Bouchons injectés à la place des 4 <script src> du haut de page. */
const BOUCHON = `<script>
window.__nav = [];
window.__signOut = 0;
(function () {
  'use strict';
  var SESSION = window.__SESSION_UID || null;
  window.OlympeAuth = {
    client: function () { return null; },
    session: function () { return Promise.resolve(SESSION ? { access_token: 'x' } : null); },
    profile: function () {
      return Promise.resolve(SESSION ? { uid: SESSION, nom: SESSION.toUpperCase(), role: 'agent' } : null);
    },
    signIn: function (u) { SESSION = u; return Promise.resolve({}); },
    signOut: function () { window.__signOut++; SESSION = null; return Promise.resolve(); },
    changePassword: function () { return Promise.resolve(); },
    markPasswordChanged: function () { return Promise.resolve(); },
    humanError: function (e) { return (e && e.message) || 'err'; }
  };
  /* Surface RÉELLE du nouveau olympe-mfa.js — si la page appelle autre chose,
     le test doit exploser, pas passer en silence. */
  window.OlympeMFA = {
    version: 'test', deviceToken: function () { return 'x'; }, guessLabel: function () { return 'Test'; },
    aal: function () { return Promise.resolve({}); },
    factors: function () { return Promise.resolve({ verified: [], unverified: [] }); },
    enroll: function () { return Promise.resolve({}); },
    verify: function () { return Promise.resolve({}); },
    unenroll: function () { return Promise.resolve(true); },
    current: function () { return Promise.resolve(null); },
    list: function () { return Promise.resolve([]); },
    approve: function () { return Promise.resolve({}); },
    revoke: function () { return Promise.resolve(true); },
    accessLog: function () { return Promise.resolve([]); },
    config: function () { return Promise.resolve({}); }
  };
  /* On intercepte l'entrée au lieu de la subir. */
  window.olpDemarrer = function () { window.__nav.push('index2.html'); };
})();
</script>`;

function buildHarness() {
  let s = fs.readFileSync(SRC, 'utf8');
  const avant = s;
  s = s.replace(/<script src="supabase\.js"><\/script>[\s\S]*?<script src="olympe-auth\.js"><\/script>/, BOUCHON);
  if (s === avant) throw new Error('bouchon non inséré : les <script src> du haut ont changé');
  // le second bloc (bulles agents) tape sur le CDN : on le neutralise
  s = s.replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>/, '');
  s = s.replace(/<script src="olympe-config\.js"><\/script>/g, '');
  // Le vrai olpDemarrer (selecteur de profils) est defini plus bas dans la
  // page et ecrase le bouchon. On reprend la main en dernier.
  s += '\n<script>window.olpDemarrer = function () { window.__nav.push("index2.html"); };<\/script>\n';
  fs.writeFileSync(HARNESS, s);
}

(async () => {
  buildHarness();
  const url = 'file://' + HARNESS;
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });

  const erreurs = [];
  async function page(sessionUid, w, h) {
    const ctx = await b.newContext({ viewport: { width: w || 1440, height: h || 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => erreurs.push(e.message));
    await p.addInitScript(`window.__SESSION_UID = ${sessionUid ? JSON.stringify(sessionUid) : 'null'};`);
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(600);
    return p;
  }

  /* ═══ Structure ═══════════════════════════════════════════════════ */
  console.log('\n── STRUCTURE ─────────────────────────────────────');
  let p = await page(null);
  const dom = await p.evaluate(() => ({
    mfa: !!document.getElementById('s-mfa'),
    enroll: !!document.getElementById('s-enroll'),
    blocked: !!document.getElementById('s-blocked'),
    login: !!document.getElementById('s-login'),
    pwc: !!document.getElementById('s-pwc'),
    picker: !!document.getElementById('picker'),
    sections: (window.SECTIONS || null)
  }));
  chk('écran s-mfa retiré', !dom.mfa);
  chk('écran s-enroll retiré', !dom.enroll);
  chk('écran s-blocked retiré', !dom.blocked);
  chk('écran s-login conservé', dom.login);
  chk('écran s-pwc conservé', dom.pwc);
  chk('sélecteur de profil conservé', dom.picker);
  {
    // On cherche un APPEL, pas une mention : les lignes de commentaire qui
    // expliquent le retrait ne doivent pas faire echouer le test.
    const code = fs.readFileSync(SRC, 'utf8').split('\n')
      .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    chk('aucun appel à OlympeMFA.gate', !/OlympeMFA\s*\.\s*gate\s*\(/.test(code));
    chk('aucun appel à OlympeMFA.register', !/OlympeMFA\s*\.\s*register\s*\(/.test(code));
  }

  /* ═══ A. Aucune session ═══════════════════════════════════════════ */
  console.log('\n── A · AUCUNE SESSION ────────────────────────────');
  chk('sélecteur visible', await p.evaluate(() =>
    !document.getElementById('s-login').classList.contains('hide')));
  chk('aucune redirection', (await p.evaluate(() => window.__nav)).length === 0);
  chk('aucun profil marqué', await p.evaluate(() =>
    !document.querySelector('#picker .profile.session-ouverte')));
  await p.context().close();

  /* ═══ B. Session pfa ouverte ══════════════════════════════════════ */
  console.log('\n── B · SESSION PFA OUVERTE ───────────────────────');
  p = await page('pfa');
  chk('aucune redirection automatique', (await p.evaluate(() => window.__nav)).length === 0);
  chk('profil pfa marqué', await p.evaluate(() =>
    !!document.querySelector('#picker .profile[data-uid="pfa"].session-ouverte')));
  chk('étiquette « session ouverte »', await p.evaluate(() => {
    const t = document.querySelector('#picker .profile[data-uid="pfa"] .sess-tag');
    return !!t && /session ouverte/.test(t.textContent);
  }));

  /* ═══ C. Reprise en 1 clic ════════════════════════════════════════ */
  console.log('\n── C · REPRISE EN 1 CLIC ─────────────────────────');
  await p.click('#picker .profile[data-uid="pfa"]');
  await p.waitForTimeout(900);
  chk('entrée dans index2', (await p.evaluate(() => window.__nav)).join() === 'index2.html');
  chk('aucun écran intermédiaire', await p.evaluate(() =>
    !document.getElementById('s-login').classList.contains('hide')));
  await p.context().close();

  /* ═══ D. Changement de compte ═════════════════════════════════════ */
  console.log('\n── D · CHANGEMENT DE COMPTE ──────────────────────');
  p = await page('pfa');
  await p.click('#picker .profile[data-uid="gillot"]');
  await p.waitForTimeout(700);
  chk('signOut() appelé', (await p.evaluate(() => window.__signOut)) === 1);
  chk('mot de passe demandé', await p.evaluate(() =>
    document.body.classList.contains('authing') || !document.getElementById('pw').disabled));
  chk('aucune redirection', (await p.evaluate(() => window.__nav)).length === 0);
  await p.context().close();

  /* ═══ E. Connexion par mot de passe ═══════════════════════════════ */
  console.log('\n── E · CONNEXION PAR MOT DE PASSE ────────────────');
  p = await page(null);
  await p.click('#picker .profile[data-uid="gillot"]');
  await p.waitForTimeout(500);
  await p.fill('#pw', 'motdepasse');
  await p.click('#go');
  await p.waitForTimeout(1100);
  chk('entrée dans index2', (await p.evaluate(() => window.__nav)).join() === 'index2.html');
  chk('aucun écran Authenticator', await p.evaluate(() =>
    !document.getElementById('s-mfa') && !document.getElementById('s-enroll')));
  await p.context().close();

  /* ═══ Formats ═════════════════════════════════════════════════════ */
  console.log('\n── FORMATS ───────────────────────────────────────');
  for (const [w, h] of FORMATS) {
    const q = await page(null, w, h);
    const r = await q.evaluate(() => {
      const s = document.getElementById('s-login').getBoundingClientRect();
      return { deborde: document.documentElement.scrollWidth > window.innerWidth + 1, visible: s.width > 0 };
    });
    chk(w + '×' + h + ' — pas de débordement horizontal', !r.deborde);
    chk(w + '×' + h + ' — écran de connexion visible', r.visible);
    await q.screenshot({ path: 'out/shot_' + w + 'x' + h + '.png' });
    await q.context().close();
  }

  /* ═══ Option B : le module n'existe plus ════════════════════════ */
  console.log('\n── OPTION B · MODULE RETIRÉ ──────────────────────');
  chk('balise olympe-mfa.js retirée',
    !/<script src="olympe-mfa\.js">/.test(fs.readFileSync(SRC, 'utf8')));
  chk('olympe-auth.js toujours chargé', /<script src="olympe-auth\.js">/.test(fs.readFileSync(SRC, 'utf8')));
  {
    const code = fs.readFileSync(SRC, 'utf8').split('\n')
      .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    chk('aucune référence à OlympeMFA', !/OlympeMFA\s*\./.test(code));
  }

  console.log('\n── ERREURS JS ────────────────────────────────────');
  const graves = erreurs.filter(e => !/favicon|ERR_FILE_NOT_FOUND|Failed to load/i.test(e));
  if (graves.length) { [...new Set(graves)].forEach(e => console.log('  ! ' + e)); ko += graves.length; }
  else console.log('  aucune');

  await b.close();
  console.log('\n' + (ko ? '❌ ' + ko + ' ÉCHEC(S)' : '✅ TOUS LES TESTS PASSENT'));
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
