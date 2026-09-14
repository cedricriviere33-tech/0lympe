/* ══════════════════════════════════════════════════════════════════════════
   OLYMPE — CORRECTIFS UI                          build uifix-2026-09-14
   ------------------------------------------------------------------------
   Trois correctifs indépendants, chacun dans son bloc :

   A. PLEINE LARGEUR DES APPLICATIONS
      Les srcdoc portent tous un conteneur centré à largeur fixe
      (main{max-width:960px}, .panel{max-width:1100px}, .wrap{820px}…).
      L'iframe fait bien 100vw, c'est le contenu qui est bridé. On injecte
      une feuille dans le contentDocument après chargement — jamais dans le
      srcdoc — comme le fait OlympeLPSkin.

   B. ANTI-SACCADE AU DÉFILEMENT
      Cause principale : background-attachment:fixed sur #hub dans le thème
      La Poste. Chrome doit repeindre le dégradé plein écran à chaque frame
      de défilement. S'y ajoutent 100+ backdrop-filter et les animations
      décoratives qui tournent en continu.

   C. THÈME HISTORIQUE LA POSTE
      Reprise complète de #histo-screen : identité de marque, navigation par
      pastilles au lieu de la liste déroulante, recherche instantanée,
      animations d'entrée. Le sélecteur d'origine reste dans le DOM et reste
      la source de vérité — switchHistoSelect() n'est pas touché.

   PREFIX : olp-fw- / olp-perf- / hlp-
   API    : window.OlympeUIFix
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  if (global.__olympeUIFix) return;
  global.__olympeUIFix = true;

  var doc = document;
  function $(id) { return doc.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ════════════════════════════════════════════════════════════════════
     A. PLEINE LARGEUR DES APPLICATIONS EN IFRAME
     ════════════════════════════════════════════════════════════════════ */

  /* Conteneurs relevés un par un dans les srcdoc. La liste est explicite
     plutôt qu'un max-width:none global : certains max-width portent du sens
     (logo 420px, bulle d'aide 320px) et ne doivent pas bouger. */
  var FW_CSS = [
    /* Pas de garde @media min-width ici : une iframe en display:none a une
       largeur de calcul nulle, la media query ne s'appliquerait jamais. Sans
       garde, la regle est inoffensive en petit ecran — un conteneur de 960px
       s'affiche deja a 100 % sous 960px. Le padding s'adapte au clamp. */
    'main, .panel, .wrap, .lab-wrap, .csm-wrap, .main, .dv-body, .page, .exp-wrap{',
    '  max-width:none !important; width:100% !important;',
    '  margin-left:0 !important; margin-right:0 !important;',
    '  padding-left:clamp(14px,3vw,48px) !important;',
    '  padding-right:clamp(14px,3vw,48px) !important;',
    '}',
    /* À l'impression, on rend la largeur d'origine : une page A4 fait 794 px. */
    '@media print{',
    '  main, .panel, .wrap, .lab-wrap, .csm-wrap, .main, .dv-body, .page, .exp-wrap{',
    '    max-width:100% !important;padding-left:0 !important;padding-right:0 !important;}',
    '}'
  ].join('\n');

  function applyFullWidth(fr) {
    var d;
    try { d = fr.contentDocument; } catch (e) { return false; }
    if (!d || !d.head) return false;
    if (d.getElementById('olp-fw')) return true;      /* garde de ré-entrée */
    var s = d.createElement('style');
    s.id = 'olp-fw';
    s.textContent = FW_CSS;
    d.head.appendChild(s);
    return true;
  }

  function sweepFrames() {
    var n = 0;
    Array.prototype.forEach.call(doc.querySelectorAll('iframe.app-iframe'), function (fr) {
      if (applyFullWidth(fr)) n++;
      if (!fr.__olpFwBound) {
        fr.__olpFwBound = true;
        fr.addEventListener('load', function () { applyFullWidth(fr); });
      }
    });
    return n;
  }

  /* Les srcdoc lourds sont injectés tardivement et certains sont rechargés
     par openApp : un balayage périodique est plus sûr qu'un seul passage. */
  function startFullWidth() {
    sweepFrames();
    setInterval(sweepFrames, 1500);
    if (typeof global.openApp === 'function' && !global.openApp.__olpFwWrapped) {
      var orig = global.openApp;
      var wrapped = function () {
        var r = orig.apply(this, arguments);
        setTimeout(sweepFrames, 120);
        setTimeout(sweepFrames, 600);
        return r;
      };
      wrapped.__olpFwWrapped = true;
      global.openApp = wrapped;
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     B. ANTI-SACCADE AU DÉFILEMENT
     ════════════════════════════════════════════════════════════════════ */

  var PERF_CSS = [
    /* 1. LA cause : un fond fixe force un repaint plein écran par frame.
          Le dégradé est ramené en défilement normal — visuellement
          quasi identique, puisqu'il est vertical et couvre toute la page. */
    'html body.lp-hub #hub,html body #hub{background-attachment:scroll !important;}',

    /* 2. Les couches décoratives sont isolées du reste de la page : le
          navigateur n'a plus à recalculer leur mise en page au défilement. */
    '#hub::before,#hub::after,#lp-decor,#lp-decor i{',
    'contain:layout style paint;will-change:transform;}',

    /* 3. Pendant le défilement : animations décoratives en pause, flous
          coupés, transitions de survol suspendues. Tout revient 150 ms
          après le dernier événement de scroll. */
    'body.olp-scrolling #lp-decor i,',
    'body.olp-scrolling #hub::before,',
    'body.olp-scrolling #hub::after,',
    'body.olp-scrolling .hub-card::before,',
    'body.olp-scrolling .hub-card::after,',
    'body.olp-scrolling .hub-tabs::after,',
    'body.olp-scrolling .lp-onde{animation-play-state:paused !important;}',
    'body.olp-scrolling .hub-card,',
    'body.olp-scrolling .hub-tab,',
    'body.olp-scrolling .histo-card{transition:none !important;}',
    'body.olp-scrolling .hub-card,',
    'body.olp-scrolling .histo-header,',
    'body.olp-scrolling .hub-apps{backdrop-filter:none !important;',
    '-webkit-backdrop-filter:none !important;}',

    /* 4. Le survol 3D des cartes suit le pointeur en rAF : inutile et coûteux
          sur un écran tactile, où il ne peut de toute façon pas se déclencher. */
    '@media (hover:none){',
    '.hub-card{transform:none !important;}',
    '.hub-card::after{display:none !important;}',
    '}'
  ].join('\n');

  function startPerf() {
    var s = doc.createElement('style');
    s.id = 'olp-perf-style';
    s.textContent = PERF_CSS;
    doc.head.appendChild(s);

    var t = null;
    function mark() {
      if (!doc.body.classList.contains('olp-scrolling')) doc.body.classList.add('olp-scrolling');
      if (t) clearTimeout(t);
      t = setTimeout(function () { doc.body.classList.remove('olp-scrolling'); }, 150);
    }
    global.addEventListener('scroll', mark, { passive: true });
    doc.addEventListener('scroll', mark, { passive: true, capture: true });
  }

  /* ════════════════════════════════════════════════════════════════════
     C. THÈME HISTORIQUE — IDENTITÉ LA POSTE
     ════════════════════════════════════════════════════════════════════ */

  /* Une couleur de marque par application : l'agent reconnaît l'historique
     ouvert au coup d'œil, sans lire le titre. */
  var HAPP = {
    hermes: { c: '#009841', e: '🚛' },
    ppi: { c: '#0E4194', e: '📋' },
    cp84: { c: '#0E4194', e: '📬' },
    cabine: { c: '#009841', e: '✈️' },
    maritime: { c: '#00A8A8', e: '⚓' },
    anomalie: { c: '#E51932', e: '📦' },
    vgp: { c: '#00A8A8', e: '🔧' },
    mrd: { c: '#6D5BD0', e: '📦' },
    rescon: { c: '#EA580C', e: '🏷️' },
    maurice: { c: '#DB2777', e: '🏠' },
    mayotte: { c: '#0891B2', e: '🌴' },
    chronopost: { c: '#F59E0B', e: '🚚' }
  };

  /* Le thème iOS existant pose beaucoup de !important : on gagne par
     spécificité (html body #histo-screen) ET par ordre d'insertion. */
  var H = 'html body #histo-screen ';
  var HISTO_CSS = [
    H + '{background:#F4F7FC !important;color:#0E2A5C !important;',
    "font-family:'DM Sans','Segoe UI',-apple-system,BlinkMacSystemFont,sans-serif !important;",
    '--j:#FDDD09;--b:#0E4194;--v:#009841;--c:#00A8A8;--r:#E51932;',
    '--line:rgba(14,65,148,.12);--muted:rgba(14,65,148,.6);',
    '--e:cubic-bezier(.22,.85,.28,1);--s:cubic-bezier(.34,1.5,.5,1);}',

    /* décor de marque, isolé du flux de défilement */
    H + '#hlp-bg{position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden;',
    'contain:strict;',
    'background:radial-gradient(120% 50% at 100% 0%,rgba(253,221,9,.26),transparent 60%),',
    'radial-gradient(80% 45% at 0% 6%,rgba(0,168,168,.14),transparent 58%);}',
    H + '#hlp-bg i{position:absolute;opacity:.09;color:#0E4194;',
    'animation:hlpDrift 24s var(--e) infinite alternate;}',
    H + '#hlp-bg svg{width:100%;height:100%;display:block;}',
    '@keyframes hlpDrift{from{transform:translate3d(0,0,0) rotate(var(--rot,0deg))}',
    'to{transform:translate3d(var(--dx,28px),var(--dy,-26px),0) rotate(calc(var(--rot,0deg) + 5deg))}}',
    'body.olp-scrolling ' + H.trim() + ' #hlp-bg i{animation-play-state:paused !important;}',

    /* en-tête */
    H + '.histo-header{position:relative;z-index:2;overflow:hidden;height:auto !important;',
    'min-height:58px;padding:10px 18px !important;flex-wrap:wrap;gap:10px;',
    'background:linear-gradient(100deg,#0E4194,#134FB4) !important;border-bottom:0 !important;',
    'backdrop-filter:none !important;box-shadow:0 6px 22px rgba(0,20,60,.24) !important;}',
    H + '.histo-header::before{content:"";position:absolute;inset:0;pointer-events:none;',
    'background:linear-gradient(72deg,transparent 40%,rgba(255,255,255,.18) 50%,transparent 60%);',
    'transform:translateX(-70%);animation:hlpSweep 6s var(--e) infinite;}',
    '@keyframes hlpSweep{0%{transform:translateX(-70%)}55%,100%{transform:translateX(80%)}}',
    H + '.histo-header::after{content:"";position:absolute;left:0;right:0;bottom:0;height:4px;',
    'background:repeating-linear-gradient(90deg,#0E4194 0 34px,#009841 34px 68px,#00A8A8 68px 102px,#E51932 102px 136px);',
    'background-size:136px 100%;animation:hlpBand 11s linear infinite;}',
    '@keyframes hlpBand{from{background-position:0 0}to{background-position:136px 0}}',
    H + '.histo-header-title{color:#fff !important;font-weight:900 !important;',
    'letter-spacing:-.3px !important;position:relative;z-index:1;}',
    H + '.histo-header-title span{color:var(--j) !important;filter:none !important;}',
    H + '.histo-back,' + H + '.histo-print-btn{position:relative;z-index:1;',
    'background:rgba(255,255,255,.16) !important;border:1.5px solid rgba(255,255,255,.34) !important;',
    'color:#fff !important;border-radius:10px !important;font-weight:800 !important;',
    'transition:transform .14s var(--e),background .18s !important;}',
    H + '.histo-back:hover,' + H + '.histo-print-btn:hover{',
    'background:rgba(255,255,255,.3) !important;transform:translateY(-2px);}',

    /* barre de navigation par pastilles */
    H + '.histo-tabs{position:relative;z-index:2;display:block !important;padding:12px 18px 4px !important;}',
    H + '.histo-select-label{display:none !important;}',
    H + '.histo-select{position:absolute !important;width:1px !important;height:1px !important;',
    'opacity:0 !important;pointer-events:none !important;overflow:hidden !important;}',
    H + '#hlp-chips{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding-bottom:4px;}',
    H + '#hlp-chips::-webkit-scrollbar{display:none;}',
    H + '.hlp-chip{flex:0 0 auto;border:1.5px solid var(--line);border-radius:100px;',
    'background:#fff;color:var(--muted);font-weight:800;font-size:13px;padding:8px 15px;',
    "cursor:pointer;font-family:inherit;white-space:nowrap;--cc:#0E4194;",
    'box-shadow:0 4px 14px rgba(14,65,148,.08);position:relative;overflow:hidden;',
    'transition:transform .16s var(--s),color .2s,border-color .2s;}',
    H + '.hlp-chip:hover{transform:translateY(-2px);color:var(--cc);border-color:var(--cc);}',
    H + '.hlp-chip.on{background:var(--cc);border-color:var(--cc);color:#fff;',
    'box-shadow:0 8px 22px color-mix(in srgb,var(--cc) 42%,transparent);}',
    H + '.hlp-chip.on::after{content:"";position:absolute;inset:0;',
    'background:linear-gradient(72deg,transparent 42%,rgba(255,255,255,.32) 50%,transparent 58%);',
    'transform:translateX(-70%);animation:hlpSweep 4.4s var(--e) infinite;}',

    /* recherche instantanée */
    H + '#hlp-count{flex:0 0 auto;align-self:center;margin-left:auto;padding-left:10px;',
    'font-size:11px;font-weight:800;color:var(--muted);white-space:nowrap;}',

    /* Filtres natifs de l'historique remis aux couleurs de la maison */
    H + '.histo-filter-btn{background:#fff !important;color:var(--muted) !important;',
    'border:1.5px solid var(--line) !important;border-radius:100px !important;',
    'font-weight:800 !important;transition:transform .14s var(--e) !important;}',
    H + '.histo-filter-btn:hover{transform:translateY(-2px);}',
    H + '.histo-filter-btn.active{background:var(--j) !important;color:#0E2A5C !important;',
    'border-color:var(--j) !important;box-shadow:0 6px 18px rgba(253,221,9,.45) !important;}',
    H + 'input[type=date],' + H + 'input[type=search],' + H + 'input[type=text]{',
    'background:#fff !important;border:1.5px solid var(--line) !important;border-radius:10px !important;',
    'color:#0E2A5C !important;font-family:inherit !important;font-weight:700 !important;}',
    H + 'input:focus{outline:0 !important;border-color:#0E4194 !important;',
    'box-shadow:0 0 0 4px rgba(14,65,148,.12) !important;}',

    /* contenu */
    H + '.histo-content{position:relative;z-index:2;padding:12px 18px 32px !important;',
    'overscroll-behavior:contain;}',
    H + '.histo-card{background:#fff !important;border:1px solid var(--line) !important;',
    'border-radius:16px !important;box-shadow:0 6px 20px rgba(14,65,148,.09) !important;',
    'overflow:hidden;position:relative;',
    'transition:transform .24s var(--e),box-shadow .24s !important;}',
    H + '.histo-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;',
    'background:var(--cc,#0E4194);}',
    H + '.histo-card:hover{transform:translateY(-3px);',
    'box-shadow:0 16px 38px rgba(14,65,148,.17) !important;}',
    H + '.hlp-in{animation:hlpRise .46s var(--e) both;animation-delay:var(--d,0ms);}',
    '@keyframes hlpRise{from{transform:translate3d(0,20px,0) scale(.985);opacity:0}',
    'to{transform:none;opacity:1}}',
    H + '.hlp-hidden{display:none !important;}',
    H + '.histo-card-title{color:#0E2A5C !important;font-weight:900 !important;}',
    H + '.histo-date-badge{background:var(--j) !important;color:#0E2A5C !important;',
    'font-weight:900 !important;border-radius:100px !important;border:0 !important;}',
    H + '.histo-table th{background:var(--cc,#0E4194) !important;color:#fff !important;',
    'font-weight:900 !important;letter-spacing:.6px;}',
    H + '.histo-table td{color:#0E2A5C !important;border-bottom:1px solid var(--line) !important;}',
    H + '.histo-table tr:hover td{background:rgba(253,221,9,.14) !important;}',
    H + '.histo-empty{color:var(--muted) !important;font-weight:700 !important;padding:34px 16px !important;}',
    H + '.histo-filter-btn{border-radius:100px !important;font-weight:800 !important;}',

    /* défilement fluide : la décoration se met en pause */
    'body.olp-scrolling ' + H.trim() + ' .histo-card{transition:none !important;}',
    'body.olp-scrolling ' + H.trim() + ' .histo-header::before,',
    'body.olp-scrolling ' + H.trim() + ' .histo-header::after,',
    'body.olp-scrolling ' + H.trim() + ' .hlp-chip.on::after{animation-play-state:paused !important;}',

    '@media screen and (max-width:760px){',
    H + '.histo-header{padding:10px 12px !important;}',
    H + '.histo-tabs{padding:10px 12px 4px !important;}',
    H + '.histo-content{padding:10px 12px 28px !important;}',
    '}',
    '@media (prefers-reduced-motion:reduce){',
    H + '*,' + H + '*::before,' + H + '*::after{animation-duration:.001ms !important;',
    'animation-iteration-count:1 !important;transition-duration:.001ms !important;}',
    H + '#hlp-bg i{display:none !important;}',
    '}'
  ].join('\n');

  var CHEVRON = '<svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4 30 L52 30 L74 10 L26 10 Z" fill="currentColor"/>' +
    '<path d="M28 36 L96 36 L96 32 L34 32 Z" fill="currentColor"/></svg>';

  function histoColor(app) { return (HAPP[app] && HAPP[app].c) || '#0E4194'; }

  function buildChips() {
    var sel = $('histo-app-select'), tabs = doc.querySelector('#histo-screen .histo-tabs');
    if (!sel || !tabs || $('hlp-chips')) return;

    var wrap = doc.createElement('div');
    wrap.id = 'hlp-chips';
    wrap.setAttribute('role', 'tablist');

    Array.prototype.forEach.call(sel.options, function (o) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'hlp-chip';
      b.setAttribute('role', 'tab');
      b.setAttribute('data-app', o.value);
      b.style.setProperty('--cc', histoColor(o.value));
      /* Le libellé de l'option porte déjà son emoji : on le reprend tel quel. */
      b.textContent = o.textContent.trim();
      b.addEventListener('click', function () {
        if (typeof global.switchHistoSelect === 'function') global.switchHistoSelect(o.value);
        else { sel.value = o.value; sel.dispatchEvent(new Event('change')); }
        syncChips(o.value);
      });
      wrap.appendChild(b);
    });
    tabs.appendChild(wrap);

    /* Pas de champ de recherche ici : l'historique en possède déjà un dans son
       contenu (« RECHERCHE : »), et deux champs côte à côte sont un piège. On
       n'ajoute que le compteur d'entrées, à droite des pastilles. */
    var cnt = doc.createElement('span');
    cnt.id = 'hlp-count';
    wrap.appendChild(cnt);

    syncChips(sel.value);
  }

  function syncChips(app) {
    Array.prototype.forEach.call(doc.querySelectorAll('#hlp-chips .hlp-chip'), function (b) {
      var on = b.getAttribute('data-app') === app;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var c = doc.querySelector('#histo-screen .histo-content');
    if (c) c.style.setProperty('--cc', histoColor(app));
  }

  function cards() {
    var c = doc.querySelector('#histo-screen .histo-content');
    if (!c) return [];
    var list = c.querySelectorAll('.histo-card');
    return list.length ? Array.prototype.slice.call(list)
      : Array.prototype.slice.call(c.children);
  }

  function filterCards(q) {
    q = String(q || '').trim().toLowerCase();
    var shown = 0, all = cards();
    all.forEach(function (el) {
      if (!el || !el.classList) return;
      var hit = !q || (el.textContent || '').toLowerCase().indexOf(q) >= 0;
      el.classList.toggle('hlp-hidden', !hit);
      if (hit) shown++;
    });
    var cnt = $('hlp-count');
    if (cnt) cnt.textContent = q ? (shown + ' / ' + all.length) : (all.length ? all.length + ' entrée(s)' : '');
  }

  /* Cascade d'entrée à chaque re-rendu du contenu */
  function animateCards() {
    var list = cards(), d = 0;
    list.forEach(function (el) {
      if (!el || !el.classList || el.classList.contains('hlp-in')) return;
      el.style.setProperty('--d', Math.min(d, 520) + 'ms');
      el.classList.add('hlp-in');
      d += 42;
    });
    var cnt = $('hlp-count');
    if (cnt) cnt.textContent = list.length ? list.length + ' entrée(s)' : '';
  }

  function startHisto() {
    var s = doc.createElement('style');
    s.id = 'olympe-histo-lp';
    s.textContent = HISTO_CSS;
    doc.head.appendChild(s);

    var screen = $('histo-screen');
    if (!screen) return;

    if (!$('hlp-bg')) {
      var bg = doc.createElement('div');
      bg.id = 'hlp-bg';
      bg.setAttribute('aria-hidden', 'true');
      [{ l: '6%', t: '14%', w: 170, rot: -10, dx: '30px', dy: '-22px', d: 0, col: '#FDDD09' },
      { l: '74%', t: '8%', w: 210, rot: 9, dx: '-26px', dy: '30px', d: 4, col: '#0E4194' },
      { l: '22%', t: '70%', w: 180, rot: 15, dx: '32px', dy: '18px', d: 8, col: '#00A8A8' }
      ].forEach(function (o) {
        var i = doc.createElement('i');
        i.style.left = o.l; i.style.top = o.t;
        i.style.width = o.w + 'px'; i.style.height = (o.w * 0.4) + 'px';
        i.style.setProperty('--rot', o.rot + 'deg');
        i.style.setProperty('--dx', o.dx);
        i.style.setProperty('--dy', o.dy);
        i.style.animationDelay = o.d + 's';
        i.style.color = o.col;
        i.innerHTML = CHEVRON;
        bg.appendChild(i);
      });
      screen.insertBefore(bg, screen.firstChild);
    }

    buildChips();

    /* Le contenu est réécrit par renderHisto() : on rejoue l'animation et le
       filtre à chaque remplacement, sans jamais appeler renderHisto nous-mêmes. */
    var content = doc.querySelector('#histo-screen .histo-content');
    if (content && global.MutationObserver) {
      var pending = null;
      new MutationObserver(function () {
        if (pending) clearTimeout(pending);
        pending = setTimeout(animateCards, 60);
      }).observe(content, { childList: true, subtree: false });
    }

    /* Le sélecteur reste la source de vérité : si un autre code le change,
       les pastilles suivent. */
    var sel = $('histo-app-select');
    if (sel) sel.addEventListener('change', function () { syncChips(sel.value); });

    animateCards();
  }

  /* ════════════════════════════════════════════════════════════════════
     D. HUB — PLEINE LARGEUR SUR GRAND ÉCRAN
     ════════════════════════════════════════════════════════════════════ */

  /* Le hub lui-même était bridé : .hub-section 1160px, .hub-tabs 900px en
     style en ligne, #section-analytics 900px. On les libère au-delà de
     1100 px et on densifie la grille de cartes quand l'écran le permet.
     Hermès et Analytics gardent leur colonne unique. */
  var HUBW_CSS = [
    '@media screen and (min-width:1100px){',
    '  html body .hub-section{max-width:min(1680px,95vw) !important;}',
    '  html body #section-analytics.hub-section.active{max-width:min(1680px,95vw) !important;}',
    '  html body .hub-tabs{max-width:min(1280px,92vw) !important;}',
    '  html body #hub{padding-left:clamp(20px,3vw,56px) !important;',
    '    padding-right:clamp(20px,3vw,56px) !important;}',
    '  html body #hub > .hub-head,html body #hub > div[style*="max-width:900px"]{',
    '    max-width:min(1280px,92vw) !important;}',
    '}',
    '@media screen and (min-width:1520px){',
    '  html body .hub-section.active:not(#section-hermes):not(#section-analytics){',
    '    grid-template-columns:repeat(5,1fr) !important;}',
    '}',
    '@media screen and (min-width:1900px){',
    '  html body .hub-section.active:not(#section-hermes):not(#section-analytics){',
    '    grid-template-columns:repeat(6,1fr) !important;}',
    '}'
  ].join('\n');

  /* ════════════════════════════════════════════════════════════════════
     E. FOND D'ÉCRAN DU HUB — REDEVENU VISIBLE
     ════════════════════════════════════════════════════════════════════ */

  /* #hubBgImage est en position:fixed;z-index:-1. Le thème La Poste a posé
     un fond OPAQUE sur #hub, qui est en z-index:1 : l'image passait dessous
     et ne se voyait plus. On remonte la couche au-dessus du fond de page,
     sous le hub, et le fond du hub devient un simple voile translucide —
     l'image se voit, les cartes restent lisibles. */
  var BG_CSS = [
    '#hubBgImage.has-img.hub-visible{z-index:0 !important;}',
    'html body.olp-hubbg #hub{background-image:none !important;',
    '  background-color:rgba(244,247,252,.34) !important;}',
    'html body.olp-hubbg:not(.hub-day) #hub{background-color:rgba(4,14,44,.52) !important;}',
    /* Les lignes de piste décoratives brouillent une photo : on les retire. */
    'html body.olp-hubbg #hub::before{opacity:.18 !important;}'
  ].join('\n');

  function syncHubBg() {
    var el = $('hubBgImage');
    var on = !!(el && el.classList.contains('has-img'));
    doc.body.classList.toggle('olp-hubbg', on);
  }

  function startHubBg() {
    var el = $('hubBgImage');
    if (!el) return;
    syncHubBg();
    if (global.MutationObserver) {
      new MutationObserver(syncHubBg).observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     F. ANALYTICS — HARMONISATION DU MODE NUIT
     ════════════════════════════════════════════════════════════════════ */

  /* Le thème iOS clair d'Analytics est désormais limité à body.hub-day
     (patché dans le monolithe). En mode nuit, Analytics retrouve son
     habillage sombre d'origine : on y ajoute le cadre de marque pour qu'il
     s'accorde aux cartes du hub nocturne. */
  var ANA_CSS = [
    'html body:not(.hub-day) #section-analytics{background:transparent !important;',
    '  color:#EAF1FF !important;}',
    'html body:not(.hub-day) #analytics-root{',
    '  background:linear-gradient(180deg,rgba(9,24,64,.88),rgba(6,16,44,.94)) !important;',
    '  border:1px solid rgba(255,255,255,.13) !important;border-radius:18px !important;',
    '  padding:14px !important;box-shadow:0 18px 46px rgba(0,8,40,.42) !important;}',
    'html body:not(.hub-day) #analytics-root::before{content:"";display:block;height:4px;',
    '  border-radius:3px;margin:-4px 0 12px;',
    '  background:repeating-linear-gradient(90deg,#0E4194 0 30px,#009841 30px 60px,',
    '  #00A8A8 60px 90px,#E51932 90px 120px);background-size:120px 100%;',
    '  animation:hlpBand 11s linear infinite;}',
    'html body.olp-scrolling:not(.hub-day) #analytics-root::before{',
    '  animation-play-state:paused !important;}',
    'html body:not(.hub-day) #analytics-root .an-card{',
    '  background:rgba(255,255,255,.05) !important;border:1px solid rgba(255,255,255,.12) !important;',
    '  border-radius:14px !important;}',
    'html body:not(.hub-day) #analytics-root table th{background:rgba(14,65,148,.72) !important;',
    '  color:#fff !important;}',
    'html body:not(.hub-day) #analytics-root table td{color:#EAF1FF !important;',
    '  border-bottom:1px solid rgba(255,255,255,.09) !important;}',
    'html body:not(.hub-day) #analytics-root table tr:hover td{',
    '  background:rgba(253,221,9,.10) !important;}'
  ].join('\n');

  /* ════════════════════════════════════════════════════════════════════
     G. POIDS PAR KPI DANS LES SESSIONS D'HISTORIQUE
     ════════════════════════════════════════════════════════════════════ */

  /* Appelé depuis les tableaux PPI et CP84 de l'historique (monolithe).
     La logique vit ici pour que le patch du monolithe reste d'une ligne
     par cellule. `det` est le tableau des saisies de la session. */
  function kgLine(det, kind) {
    var w = 0, i, it, k;
    det = det || [];
    for (i = 0; i < det.length; i++) {
      it = det[i];
      k = String((it && it.type) || '').toUpperCase();
      if (k === 'SINGAPOUR') k = 'SGP';
      if (k === 'CP84') k = 'CP';
      var p = parseFloat(it && it.poids) || 0;
      if (kind === 'TOT') { w += p; continue; }
      if (kind === 'PRIO') { if (k.indexOf('PRIO') >= 0) w += p; continue; }
      if (kind === 'ECO') { if (k.indexOf('ECO') >= 0) w += p; continue; }
      if (k === kind) w += p;
    }
    if (!w) return '<div class="olp-kg olp-kg0">—</div>';
    return '<div class="olp-kg">' + (Math.round(w * 10) / 10) + ' kg</div>';
  }

  var KG_CSS = [
    '.olp-kg{font-size:9.5px;font-weight:800;letter-spacing:.3px;margin-top:3px;',
    '  opacity:.72;font-variant-numeric:tabular-nums;}',
    '.olp-kg0{opacity:.28;font-weight:600;}',
    'html body #histo-screen .olp-kg{color:rgba(14,65,148,.72);}',
    'html body #histo-screen .olp-kg0{color:rgba(14,65,148,.3);}'
  ].join('\n');

  function startExtras() {
    var s = doc.createElement('style');
    s.id = 'olp-extra-style';
    s.textContent = [HUBW_CSS, BG_CSS, ANA_CSS, KG_CSS].join('\n');
    doc.head.appendChild(s);
    startHubBg();
  }

  /* ════════════════════════════════════════════════════════════════════
     DÉMARRAGE
     ════════════════════════════════════════════════════════════════════ */

  function boot() {
    try { startPerf(); } catch (e) { console.warn('[olympe-ui-fixes] perf:', e); }
    try { startFullWidth(); } catch (e) { console.warn('[olympe-ui-fixes] pleine largeur:', e); }
    try { startHisto(); } catch (e) { console.warn('[olympe-ui-fixes] historique:', e); }
    try { startExtras(); } catch (e) { console.warn('[olympe-ui-fixes] extras:', e); }
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* Exposé globalement : les tableaux PPI et CP84 du monolithe l'appellent. */
  global.olpKgLine = kgLine;

  global.OlympeUIFix = {
    largeur: sweepFrames,
    kg: kgLine,
    fond: syncHubBg,
    histoRefresh: animateCards,
    histoFiltre: filterCards
  };

})(window);
