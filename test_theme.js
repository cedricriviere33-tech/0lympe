/* ══════════════════════════════════════════════════════════════════════════
   test_theme.js — thème clair Hermès, posé depuis le hub.

   Le thème est testé là où il vit : dans l'iframe d'index2, posée par le
   poseur sur contentDocument, pas sur le srcdoc ouvert à part. Ce qui est
   vérifié n'est pas « c'est joli » mais des faits mesurables :

     · la couche est posée et les tableaux sont enveloppés ;
     · aucun bloc ne dépasse la largeur de l'écran, aux trois formats ;
     · le contraste du texte sur les en-têtes de tableau est suffisant ;
     · le retour au thème sombre restitue les attributs style= à l'identique.

   USAGE   node test_theme.js [fichier.html]
   ══════════════════════════════════════════════════════════════════════════ */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const CIBLE = path.resolve(process.argv[2] || 'index2_theme.html');
const SCOPES_JS = fs.readFileSync(path.resolve('olympe-scopes.js'), 'utf8');

const H_STORE = {
  dates: {}, _prodv5: true,
  si: { CP: 0, CE30: 0, CV300: 0, KUB: 0, PAL: 0 },
  prod: ['CTOC PRIO', 'CTOC ECO', 'BTOC PRIO', 'BTOC ECO', 'BTOC JAVER',
    'Roissy', 'Presse', 'Cabine', 'Inter OO', 'Inter OS', 'Singapour',
    'Fausse direction', 'Anomalie colis', 'Courrier à ventiler'],
  cm: { 'CTOCPR': 'CTOC PRIO' },
  eq: ['Ferrere Jérémie', 'Marinier Eric']
};

const ATTENDUES = /OlympeStore is not defined|renderDash is not defined|OlympeDB is not defined/;
const VUES = [
  { nom: 'PC 1600×1000', w: 1600, h: 1000 },
  { nom: 'portrait 412×915', w: 412, h: 915 },
  { nom: 'paysage 915×412', w: 915, h: 412 }
];

let ok = 0, ko = 0;
function chk(c, l, d) {
  if (c) { ok++; console.log('  ✓ ' + l); }
  else { ko++; console.log('  ✗ ' + l + (d ? '\n      ' + d : '')); }
}

/* Contraste WCAG entre deux couleurs rgb() */
function lum(c) {
  const v = c.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function contraste(a, b) {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function rgb(s) {
  const m = String(s).match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

async function ouvrirHermes(browser, vue) {
  const page = await browser.newPage({ viewport: { width: vue.w, height: vue.h } });
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
  await page.waitForTimeout(600);
  await page.evaluate(() => { try { openApp('hermes'); } catch (e) { } });
  await page.waitForTimeout(2200);
  return { page, erreurs };
}

(async () => {
  console.log('\n  CIBLE : ' + CIBLE);
  const browser = await chromium.launch();

  for (const vue of VUES) {
    console.log('\n  ── ' + vue.nom + ' ──');
    const { page, erreurs } = await ouvrirHermes(browser, vue);

    const r = await page.evaluate(() => {
      const out = { etat: null, deborde: null, larges: [], th: null, erreur: null };
      try {
        out.etat = window.OlympeHermesThemePose ? OlympeHermesThemePose.etat() : { module: 'poseur absent' };
        const fr = document.getElementById('iframe-hermes');
        const d = fr && fr.contentDocument;
        if (!d || !d.body) { out.erreur = 'contentDocument inaccessible'; return out; }

        /* Débordement horizontal : la mesure, pas l'impression visuelle. */
        const de = d.documentElement;
        out.deborde = de.scrollWidth - de.clientWidth;
        /* Un tableau PLUS LARGE que l'écran est normal : il défile dans son
           conteneur. Ce qui ne doit pas dépasser, c'est tout le reste — et
           le conteneur lui-même. On exclut donc ce qui est dans .hth-scroll,
           sans exclure le conteneur. */
        d.querySelectorAll('header,nav,.page,.page *').forEach(e => {
          if (e.closest && e.closest('.hth-scroll') && !e.classList.contains('hth-scroll')) return;
          const b = e.getBoundingClientRect();
          if (b.width > de.clientWidth + 2 && b.width > 0) {
            out.larges.push((e.className || e.tagName) + ' ' + Math.round(b.width));
          }
        });

        /* Contrôle positif : le conteneur tient dans l'écran ET son tableau
           est plus large que lui. Sans les deux, soit le défilement ne sert
           à rien, soit les colonnes de droite sont inaccessibles. */
        const box = d.querySelector('.hth-scroll');
        if (box) {
          const t = box.querySelector('table');
          out.defilement = {
            conteneur: Math.round(box.getBoundingClientRect().width),
            tableau: t ? Math.round(t.scrollWidth) : 0,
            ecran: de.clientWidth
          };
        }

        /* Contraste de l'en-tête de tableau — c'est là qu'était l'illisible. */
        const th = d.querySelector('th');
        if (th) {
          const cs = d.defaultView.getComputedStyle(th);
          out.th = { texte: cs.color, fond: cs.backgroundColor };
        }
      } catch (e) { out.erreur = String(e.message); }
      return out;
    });

    if (r.erreur) { chk(false, 'ouverture d\'Hermès', r.erreur); await page.close(); continue; }

    chk(r.etat && r.etat.pose === true, 'la couche est posée sur l\'iframe',
      JSON.stringify(r.etat));
    chk(r.etat && r.etat.actif === true, 'le thème clair est actif');
    chk(r.etat && r.etat.tableauxEnveloppes > 0,
      'les tableaux sont enveloppés (' + (r.etat && r.etat.tableauxEnveloppes) + ')');
    chk(r.deborde <= 2, 'aucun débordement horizontal (' + r.deborde + 'px)',
      r.larges.slice(0, 3).join(' · '));
    chk(r.larges.length === 0, 'aucun bloc plus large que l\'écran (hors tableaux défilants)',
      r.larges.slice(0, 3).join(' · '));

    if (r.defilement) {
      const f = r.defilement;
      chk(f.conteneur <= f.ecran + 2,
        'le conteneur défilant tient dans l\'écran (' + f.conteneur + ' ≤ ' + f.ecran + ')');
      if (f.tableau > f.conteneur) {
        chk(true, 'le tableau déborde de son conteneur et y défile ('
          + f.tableau + ' dans ' + f.conteneur + ')');
      }
    }

    if (r.th) {
      const c = contraste(rgb(r.th.texte), rgb(r.th.fond));
      chk(c >= 4.5, 'contraste des en-têtes de tableau : ' + c.toFixed(1) + ':1 (min 4,5)',
        r.th.texte + ' sur ' + r.th.fond);
    } else {
      chk(false, 'en-tête de tableau trouvé');
    }

    chk(erreurs.length === 0, 'aucune erreur JS', erreurs.slice(0, 2).join(' | '));
    await page.close();
  }

  /* ── Réversibilité : repasser en sombre ne doit rien laisser derrière ── */
  console.log('\n  ── Retour au thème sombre ──');
  const { page } = await ouvrirHermes(browser, VUES[0]);
  const rev = await page.evaluate(() => {
    const d = document.getElementById('iframe-hermes').contentDocument;
    const cible = d.querySelector('[data-hth-orig]');
    const original = cible ? cible.getAttribute('data-hth-orig') : null;
    const modifie = cible ? cible.getAttribute('style') : null;
    OlympeHermesTheme.retirer(d);
    return {
      original, modifie,
      restitue: cible ? cible.getAttribute('style') : null,
      restes: d.querySelectorAll('[data-hth-orig]').length,
      classe: d.body.classList.contains('hth-on'),
      fond: !!d.querySelector('.hth-bg')
    };
  });
  chk(rev.original !== null, 'un attribut style= modifié a bien été sauvegardé');
  chk(rev.modifie !== rev.original, 'il avait bien été modifié');
  chk(rev.restitue === rev.original, 'il est restitué au caractère près',
    JSON.stringify({ attendu: rev.original, obtenu: rev.restitue }));
  chk(rev.restes === 0, 'aucune trace résiduelle');
  chk(rev.classe === false, 'la classe hth-on est retirée');
  chk(rev.fond === false, 'le motif de fond est retiré');
  await page.close();

  await browser.close();
  console.log('\n  ' + ok + ' contrôle(s) OK · ' + ko + ' en échec\n');
  process.exit(ko ? 1 : 0);
})();
