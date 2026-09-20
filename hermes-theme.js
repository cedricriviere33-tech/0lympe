/* ═══════════════════════════════════════════════════════════════════════════
 * 0LYMPE — Hermès · thème clair La Poste
 * build hth-2026-09-20-CLAIR1
 *
 * ── CE QUE CE MODULE FAIT, ET POURQUOI IL EST FAIT COMME ÇA ───────────────
 * Hermès possédait déjà un thème clair — 395 règles sous body.theme-light.
 * Il ne rendait pas parce que 133 déclarations sombres sont écrites en
 * ATTRIBUT style= directement sur les éléments : fond blanc translucide,
 * texte blanc, bordures blanches, backdrop-filter. Un attribut inline bat
 * toute feuille de style. Le thème clair était donc percé de trous, et
 * aucune règle CSS supplémentaire n'y aurait changé quoi que ce soit.
 *
 * On procède donc en deux temps :
 *   1. nettoyerInline() retire des attributs style= les SEULES propriétés
 *      qui imposent le sombre. La mise en page inline (flex, gap, padding,
 *      largeurs) est conservée telle quelle : y toucher casserait des écrans
 *      qui fonctionnent.
 *   2. la feuille hth-style habille ce qui est alors redevenu stylable.
 *
 * Le srcdoc n'est jamais modifié : tout passe par contentDocument après
 * chargement, comme olympe-hermes-fix et OlympeLPSkin.
 *
 * ── IDENTITÉ VISUELLE ─────────────────────────────────────────────────────
 * Couleurs La Poste (jaune, bleu, turquoise, vert, rouge) sur fond clair.
 * Le motif de fond est un chevron géométrique abstrait — des parallélogrammes
 * en biais, déjà utilisés ailleurs dans le hub. Ce n'est pas le logo de
 * La Poste et ça n'essaie pas d'y ressembler : une marque déposée ne se
 * redessine pas, elle s'utilise telle qu'elle est fournie.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var BUILD = 'hth-2026-09-20-CLAIR1';

  /* ═══════════════ 1. FEUILLE DE STYLE ═══════════════ */
  var CSS = [
'/* ── Jetons ── */',
':root{',
'  --hth-j:#FFCC00; --hth-j2:#FFE066; --hth-jo:#E6A700;',
'  --hth-b:#003189; --hth-b2:#0A4FBF; --hth-b3:#6E8FD6;',
'  --hth-t:#00A9A5; --hth-v:#00954E; --hth-r:#E4032E; --hth-o:#F08A24;',
'  --hth-fond:#F2F5FA; --hth-carte:#FFFFFF;',
'  --hth-encre:#0A1A3C; --hth-encre2:#5A6B8C; --hth-encre3:#8C9AB5;',
'  --hth-ligne:rgba(0,49,137,.10); --hth-ligne2:rgba(0,49,137,.18);',
'  --hth-o1:0 1px 2px rgba(10,26,60,.04), 0 6px 18px rgba(10,26,60,.06);',
'  --hth-o2:0 2px 6px rgba(10,26,60,.06), 0 18px 44px rgba(10,26,60,.10);',
'  --hth-rd:18px; --hth-rd2:12px; --hth-rd3:999px;',
'  --hth-ms:cubic-bezier(.22,1,.36,1);',
'}',

'/* ── Fond ── */',
'body.theme-light.hth-on{',
'  background:var(--hth-fond); color:var(--hth-encre);',
'  -webkit-font-smoothing:antialiased;',
'}',
'body.theme-light.hth-on #hermes-stars{display:none !important;}',

'/* Motif de fond : chevrons géométriques, lents, très discrets. */',
'.hth-bg{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;}',
'.hth-bg i{position:absolute;display:block;opacity:.038;',
'  background:currentColor; filter:blur(2px);',
'  clip-path:polygon(0 0, 72% 0, 100% 50%, 72% 100%, 0 100%, 28% 50%);',
'  animation:hthDerive var(--d,90s) linear infinite;}',
'@keyframes hthDerive{',
'  from{transform:translate3d(0,0,0) rotate(var(--rot,0deg));}',
'  to{transform:translate3d(var(--dx,120px),var(--dy,-90px),0) rotate(var(--rot,0deg));}}',
'body.theme-light.hth-on header,',
'body.theme-light.hth-on nav.tabs,',
'body.theme-light.hth-on .page{position:relative;z-index:1;}',

'/* ── En-tête ── */',
'body.theme-light.hth-on header{',
'  background:#fff; border-bottom:1px solid var(--hth-ligne);',
'  box-shadow:var(--hth-o1); position:sticky; top:0; z-index:40;',
'  padding:10px 20px; gap:12px;',
'}',
/* Filet jaune : la signature couleur, sans rien emprunter d'autre. */
'body.theme-light.hth-on header::after{',
'  content:""; position:absolute; left:0; right:0; bottom:-1px; height:3px;',
'  background:linear-gradient(90deg,var(--hth-j) 0%,var(--hth-j) 22%,',
'    var(--hth-t) 22%,var(--hth-t) 44%,var(--hth-b) 44%,var(--hth-b) 70%,',
'    var(--hth-v) 70%,var(--hth-v) 86%,var(--hth-r) 86%);',
'  transform:scaleX(0); transform-origin:left;',
'  animation:hthFilet 1.1s var(--hth-ms) .15s forwards;}',
'@keyframes hthFilet{to{transform:scaleX(1);}}',

'body.theme-light.hth-on .logo-sq{',
'  background:var(--hth-b); color:#fff; border-radius:14px;',
'  box-shadow:0 6px 16px rgba(0,49,137,.28); letter-spacing:.5px;}',
'body.theme-light.hth-on .logo-t1{color:var(--hth-b); letter-spacing:.4px; font-weight:800;}',
'body.theme-light.hth-on .logo-t2{color:var(--hth-encre2);}',
'body.theme-light.hth-on #hclk{',
'  color:var(--hth-b) !important; background:var(--hth-fond);',
'  border:1px solid var(--hth-ligne); border-radius:var(--hth-rd3);',
'  padding:5px 12px; font-variant-numeric:tabular-nums;}',

'/* ── Boutons d\'en-tête ── */',
'body.theme-light.hth-on header button{',
'  background:#fff; color:var(--hth-b); border:1px solid var(--hth-ligne2);',
'  border-radius:var(--hth-rd3); padding:8px 14px; font-weight:700;',
'  transition:transform .18s var(--hth-ms), box-shadow .18s, background .18s;}',
'body.theme-light.hth-on header button:hover{',
'  transform:translateY(-1px); box-shadow:var(--hth-o1); background:var(--hth-fond);}',
'body.theme-light.hth-on header button:active{transform:translateY(0) scale(.98);}',
'body.theme-light.hth-on .bk-btn{background:var(--hth-b) !important; color:#fff !important; border-color:transparent !important;}',

'/* ── Onglets ── */',
'body.theme-light.hth-on nav.tabs{',
'  background:#fff; border-bottom:1px solid var(--hth-ligne);',
'  padding:8px 16px; gap:6px; position:sticky; top:var(--hth-htop,64px); z-index:35;',
'  overflow-x:auto; scrollbar-width:none;}',
'body.theme-light.hth-on nav.tabs::-webkit-scrollbar{display:none;}',
'body.theme-light.hth-on .tab{',
'  background:transparent; color:var(--hth-encre2); border:0;',
'  border-radius:var(--hth-rd3); padding:9px 16px; font-weight:700;',
'  white-space:nowrap; transition:color .2s, background .2s;}',
'body.theme-light.hth-on .tab:hover{background:var(--hth-fond); color:var(--hth-b);}',
'body.theme-light.hth-on .tab.active{color:var(--hth-b); background:rgba(255,204,0,.20);}',
/* Repère glissant : une seule barre qui se déplace, pas une bordure par onglet. */
'body.theme-light.hth-on .hth-ind{',
'  position:absolute; bottom:4px; height:3px; border-radius:3px;',
'  background:var(--hth-j); transition:transform .38s var(--hth-ms), width .38s var(--hth-ms);',
'  pointer-events:none;}',

'/* ── Pages et cartes ── */',
'body.theme-light.hth-on .page{padding:18px 16px 96px;}',
'body.theme-light.hth-on .card{',
'  background:var(--hth-carte); border:1px solid var(--hth-ligne);',
'  border-radius:var(--hth-rd); box-shadow:var(--hth-o1); padding:18px;',
'  transition:box-shadow .28s var(--hth-ms), transform .28s var(--hth-ms);}',
'body.theme-light.hth-on .card:hover{box-shadow:var(--hth-o2); transform:translateY(-2px);}',
'body.theme-light.hth-on .ct{',
'  color:var(--hth-b); font-weight:800; letter-spacing:.6px;',
'  text-transform:uppercase; font-size:12.5px; margin-bottom:12px;',
'  display:flex; align-items:center; justify-content:flex-start;',
'  text-align:left; gap:8px;}',
'body.theme-light.hth-on .ct::before{',
'  content:""; width:4px; height:15px; border-radius:2px; background:var(--hth-j);',
'  flex:0 0 auto;}',

'/* Entrée en cascade — une seule fois, à l\'affichage de la page. */',
'body.theme-light.hth-on .hth-cascade{opacity:0; transform:translateY(14px);}',
'body.theme-light.hth-on .hth-cascade.hth-vu{',
'  animation:hthMonte .5s var(--hth-ms) forwards; animation-delay:var(--dl,0ms);}',
'@keyframes hthMonte{to{opacity:1; transform:translateY(0);}}',

'/* ── KPI ── */',
'body.theme-light.hth-on .kpi{',
'  background:var(--hth-carte); border:1px solid var(--hth-ligne);',
'  border-radius:var(--hth-rd2); padding:14px 16px; box-shadow:var(--hth-o1);',
'  position:relative; overflow:hidden;}',
'body.theme-light.hth-on .kpi::before{',
'  content:""; position:absolute; left:0; top:0; bottom:0; width:4px;',
'  background:var(--hth-b); transform:scaleY(0); transform-origin:bottom;',
'  animation:hthBarre .5s var(--hth-ms) .1s forwards;}',
'@keyframes hthBarre{to{transform:scaleY(1);}}',
'body.theme-light.hth-on .kpi .n{',
'  color:var(--hth-b); font-weight:800; font-size:30px; line-height:1.1;',
'  font-variant-numeric:tabular-nums;}',
'body.theme-light.hth-on .kpi .l{',
'  color:var(--hth-encre2); font-size:11.5px; font-weight:600;',
'  text-transform:uppercase; letter-spacing:.5px; margin-top:2px;}',

'/* ── Tableaux ── */',
'body.theme-light.hth-on .hth-scroll{',
'  overflow-x:auto; -webkit-overflow-scrolling:touch; border-radius:var(--hth-rd2);',
'  scrollbar-width:thin;}',
'body.theme-light.hth-on table{border-collapse:separate; border-spacing:0; width:100%;}',
'body.theme-light.hth-on th{',
'  background:var(--hth-b) !important; color:#fff !important;',
'  font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px;',
'  padding:10px 12px; text-align:left; white-space:nowrap;',
'  position:sticky; top:0; z-index:2;}',
'body.theme-light.hth-on th:first-child{border-top-left-radius:var(--hth-rd2);}',
'body.theme-light.hth-on th:last-child{border-top-right-radius:var(--hth-rd2);}',
'body.theme-light.hth-on td{',
'  padding:9px 12px; border-bottom:1px solid var(--hth-ligne);',
'  color:var(--hth-encre); font-size:13px;}',
'body.theme-light.hth-on tbody tr{transition:background .16s;}',
'body.theme-light.hth-on tbody tr:nth-child(even){background:rgba(0,49,137,.025);}',
'body.theme-light.hth-on tbody tr:hover{background:rgba(255,204,0,.13);}',
/* Le récap semaine avait un en-tête gris très clair sur fond clair : illisible. */
'body.theme-light.hth-on table th *{color:#fff !important;}',

'/* ── Champs et boutons ── */',
'body.theme-light.hth-on input,body.theme-light.hth-on select,body.theme-light.hth-on textarea{',
'  background:#fff; color:var(--hth-encre); border:1px solid var(--hth-ligne2);',
'  border-radius:10px; padding:8px 11px; font-size:14px;',
'  transition:border-color .18s, box-shadow .18s;}',
'body.theme-light.hth-on input:focus,body.theme-light.hth-on select:focus,body.theme-light.hth-on textarea:focus{',
'  outline:none; border-color:var(--hth-b2); box-shadow:0 0 0 3px rgba(10,79,191,.14);}',
'body.theme-light.hth-on .btn{',
'  border-radius:var(--hth-rd3); font-weight:700; border:1px solid var(--hth-ligne2);',
'  background:#fff; color:var(--hth-b); padding:9px 16px;',
'  transition:transform .18s var(--hth-ms), box-shadow .18s;}',
'body.theme-light.hth-on .btn:hover{transform:translateY(-1px); box-shadow:var(--hth-o1);}',
'body.theme-light.hth-on .btn:active{transform:translateY(0) scale(.98);}',

'/* ── En-tête : hauteur libre ──',
'   Le CSS d\'origine fixe height:56px. En portrait, les boutons ne tiennent',
'   pas sur cette ligne : ils débordaient sur la barre d\'onglets et poussaient',
'   la page au-delà de la largeur de l\'écran. La hauteur devient libre, et',
'   mesurerEntete() la relève pour caler les onglets collants. */',
'body.theme-light.hth-on header{height:auto; min-height:56px; flex-wrap:wrap; row-gap:8px;}',
'body.theme-light.hth-on header > div{flex-wrap:wrap; justify-content:flex-end; row-gap:8px;}',

'/* ── Smartphone ── */',
'@media screen and (max-width:820px){',
'  body.theme-light.hth-on header{padding:8px 12px; row-gap:6px;}',
'  body.theme-light.hth-on header > div{width:100%; justify-content:flex-start;}',
'  body.theme-light.hth-on #hclk{font-size:13px; padding:4px 9px;}',
'  body.theme-light.hth-on .logo-t2{display:none;}',
'  body.theme-light.hth-on .logo-t1{font-size:15px;}',
'  body.theme-light.hth-on header button{padding:7px 11px; font-size:12px;}',
'  body.theme-light.hth-on .page{padding:14px 12px 104px;}',
'  body.theme-light.hth-on .card{padding:14px; border-radius:var(--hth-rd2);}',
'  body.theme-light.hth-on .kpi .n{font-size:26px;}',
'  body.theme-light.hth-on th,body.theme-light.hth-on td{padding:8px 10px;}',
'}',
/* La barre d'onglets du mode smartphone passe en bas : sans cette réserve,
   le dernier bloc de chaque page disparaît dessous. */
'body.theme-light.hth-on.olympe-mobile .page{padding-bottom:calc(84px + env(safe-area-inset-bottom,0px));}',
'/* Aucun bloc ne doit être plus large que l\'écran : les tableaux défilent',
'   dans leur conteneur, pas la page entière. */',
'/* ── La règle qui fait tenir les tableaux dans l\'écran ──',
'   Un élément de grille ou de flex vaut min-width:auto par défaut : sa',
'   largeur minimale est celle de son contenu. Un tableau large forçait donc',
'   sa colonne à s\'élargir, et la grille débordait de l\'écran — le',
'   conteneur défilant ne servait à rien puisque son parent avait déjà cédé.',
'   min-width:0 rend la contrainte à la grille ; le défilement retrouve alors',
'   sa raison d\'être. */',
'body.theme-light.hth-on .g2 > *,',
'body.theme-light.hth-on .g3 > *,',
'body.theme-light.hth-on .kpis > *{min-width:0;}',
'body.theme-light.hth-on .hth-scroll{min-width:0; max-width:100%;}',

'@media screen and (max-width:820px){',
'  body.theme-light.hth-on .card,body.theme-light.hth-on .kpi{max-width:100%;}',
'  /* Deux colonnes n\'ont pas de sens sur un téléphone. */',
'  body.theme-light.hth-on .g2,body.theme-light.hth-on .g3{grid-template-columns:1fr;}',
'  /* Indice de défilement : sans lui, rien ne dit qu\'il reste des colonnes',
'     à droite — c\'est exactement ce qui les rendait invisibles avant. */',
'  body.theme-light.hth-on .hth-scroll{position:relative;',
'    -webkit-mask-image:linear-gradient(90deg,#000 88%,transparent 100%);',
'    mask-image:linear-gradient(90deg,#000 88%,transparent 100%);}',
'  body.theme-light.hth-on .hth-scroll.hth-bout{-webkit-mask-image:none; mask-image:none;}',
'}',

'/* ── Plein écran PC ── */',
'@media screen and (min-width:1400px){',
'  body.theme-light.hth-on .page{padding:26px 34px 60px; max-width:none;}',
'  body.theme-light.hth-on .card{padding:22px; border-radius:22px;}',
'  body.theme-light.hth-on .kpi .n{font-size:36px;}',
'  body.theme-light.hth-on .ct{font-size:13px;}',
'  body.theme-light.hth-on td{font-size:13.5px; padding:11px 14px;}',
'}',
'@media screen and (min-width:1800px){',
'  body.theme-light.hth-on .page{padding:30px 60px 60px;}',
'}',

'/* ── Respect des préférences et impression ── */',
'@media (prefers-reduced-motion:reduce){',
'  body.theme-light.hth-on *,body.theme-light.hth-on *::before,body.theme-light.hth-on *::after{',
'    animation-duration:.001ms !important; animation-iteration-count:1 !important;',
'    transition-duration:.001ms !important;}',
'  body.theme-light.hth-on .hth-cascade{opacity:1; transform:none;}',
'}',
'@media print{',
'  .hth-bg,.hth-ind{display:none !important;}',
'  body.theme-light.hth-on .card{box-shadow:none; border:1px solid #ccc;}',
'  body.theme-light.hth-on .hth-cascade{opacity:1 !important; transform:none !important;}',
'  body.theme-light.hth-on th{background:#003189 !important; -webkit-print-color-adjust:exact; print-color-adjust:exact;}',
'}'
  ].join('\n');

  /* ═══════════════ 2. NETTOYAGE DES STYLES INLINE ═══════════════
     On ne retire QUE ce qui impose le sombre. Tout le reste de l'attribut
     — flex, gap, padding, largeurs — est conservé : ces règles font la mise
     en page et y toucher casserait des écrans qui marchent. */
  var SOMBRE = [
    /(^|;)\s*background(-color)?\s*:\s*rgba\(\s*255\s*,\s*255\s*,\s*255[^;]*/gi,
    /(^|;)\s*background\s*:\s*rgba\(\s*0\s*,\s*0\s*,\s*0[^;]*/gi,
    /(^|;)\s*color\s*:\s*(#fff(f{3})?|white|rgba\(\s*255\s*,\s*255\s*,\s*255[^;]*)/gi,
    /(^|;)\s*border(-[a-z]+)?\s*:[^;]*rgba\(\s*255\s*,\s*255\s*,\s*255[^;]*/gi,
    /(^|;)\s*-?webkit-?backdrop-filter\s*:[^;]*/gi,
    /(^|;)\s*backdrop-filter\s*:[^;]*/gi
  ];

  function nettoyerInline(doc) {
    var n = 0;
    var els = doc.querySelectorAll('[style]');
    Array.prototype.forEach.call(els, function (el) {
      if (el.hasAttribute('data-hth-net')) return;
      var v = el.getAttribute('style') || '', avant = v;
      SOMBRE.forEach(function (re) { v = v.replace(re, '$1'); });
      if (v !== avant) {
        /* L'original est conservé : le retrait du thème doit pouvoir le
           rendre intact. Sans cette copie, repasser en sombre laisserait du
           texte foncé sur fond foncé — on aurait réparé le clair en cassant
           l'autre. */
        el.setAttribute('data-hth-orig', avant);
        el.setAttribute('style', v);
        n++;
      }
      el.setAttribute('data-hth-net', '1');
    });
    return n;
  }

  /* Rend les attributs style= tels qu'ils étaient et désactive la couche.
     Appelé quand l'agent repasse en thème sombre. */
  function retirer(doc) {
    if (!doc || !doc.body) return 0;
    var n = 0;
    Array.prototype.forEach.call(doc.querySelectorAll('[data-hth-orig]'), function (el) {
      el.setAttribute('style', el.getAttribute('data-hth-orig'));
      el.removeAttribute('data-hth-orig');
      el.removeAttribute('data-hth-net');
      n++;
    });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-hth-net]'), function (el) {
      el.removeAttribute('data-hth-net');
    });
    doc.body.classList.remove('hth-on');
    var bg = doc.querySelector('.hth-bg'); if (bg) bg.remove();
    if (doc.__hthObs) { try { doc.__hthObs.disconnect(); } catch (e) {} doc.__hthObs = null; }
    doc.__hthPose = null;
    return n;
  }

  /* ═══════════════ 3. TABLEAUX DÉFILABLES ═══════════════
     Aucun tableau n'était enveloppé : en portrait, les colonnes de droite
     étaient purement inaccessibles. */
  function habillerTableaux(doc) {
    var n = 0;
    Array.prototype.forEach.call(doc.querySelectorAll('table'), function (t) {
      var p = t.parentNode;
      if (!p || (p.classList && p.classList.contains('hth-scroll'))) return;
      var box = doc.createElement('div');
      box.className = 'hth-scroll';
      p.insertBefore(box, t);
      box.appendChild(t);
      box.addEventListener('scroll', function () {
        var fini = (box.scrollLeft + box.clientWidth) >= (box.scrollWidth - 2);
        box.classList.toggle('hth-bout', fini);
      });
      n++;
    });
    return n;
  }

  /* ═══════════════ 4. REPÈRE D'ONGLET GLISSANT ═══════════════ */
  function indicateurOnglets(doc) {
    var nav = doc.querySelector('nav.tabs');
    if (!nav) return;
    var ind = nav.querySelector('.hth-ind');
    if (!ind) {
      ind = doc.createElement('div');
      ind.className = 'hth-ind';
      nav.appendChild(ind);
      /* Pas de position en inline ici : la feuille pose déjà position:sticky
         sur la barre, et un attribut style= l'écraserait — la barre repassait
         en position:relative et recouvrait le premier bloc de la page.
         Un élément sticky est un ancêtre positionné : le repère absolu s'y
         accroche sans qu'on ait à toucher au positionnement. */
    }
    function placer() {
      var a = nav.querySelector('.tab.active');
      if (!a) { ind.style.width = '0px'; return; }
      ind.style.width = a.offsetWidth + 'px';
      ind.style.transform = 'translateX(' + (a.offsetLeft - nav.scrollLeft) + 'px)';
    }
    placer();
    nav.addEventListener('click', function () { setTimeout(placer, 30); });
    nav.addEventListener('scroll', placer);
    (doc.defaultView || global).addEventListener('resize', placer);
    return placer;
  }

  /* ═══════════════ 5. CASCADE D'ENTRÉE ═══════════════
     Marquée une seule fois par élément : une page qu'on rouvre ne rejoue pas
     l'animation, sinon le travail clignote à chaque aller-retour d'onglet. */
  function cascade(doc) {
    var page = doc.querySelector('.page.active');
    if (!page || page.hasAttribute('data-hth-casc')) return;
    page.setAttribute('data-hth-casc', '1');
    var blocs = page.querySelectorAll('.card, .kpi');
    Array.prototype.forEach.call(blocs, function (b, i) {
      b.classList.add('hth-cascade');
      b.style.setProperty('--dl', Math.min(i * 45, 450) + 'ms');
      /* Deux images successives avant de relâcher : une seule ne suffit pas,
         le navigateur n'a pas encore appliqué l'état initial. */
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { b.classList.add('hth-vu'); });
      });
    });
  }

  /* ═══════════════ 6. FOND ═══════════════ */
  function fond(doc) {
    if (doc.querySelector('.hth-bg')) return;
    var bg = doc.createElement('div');
    bg.className = 'hth-bg';
    var teintes = ['var(--hth-j)', 'var(--hth-b)', 'var(--hth-t)', 'var(--hth-v)'];
    var pts = [
      { l: '4%', t: '12%', w: 190, rot: -14, dx: '90px', dy: '-60px', d: '84s' },
      { l: '72%', t: '6%', w: 260, rot: 8, dx: '-110px', dy: '70px', d: '102s' },
      { l: '18%', t: '64%', w: 150, rot: 22, dx: '130px', dy: '-40px', d: '76s' },
      { l: '86%', t: '58%', w: 210, rot: -6, dx: '-80px', dy: '-90px', d: '95s' },
      { l: '48%', t: '32%', w: 120, rot: 16, dx: '70px', dy: '80px', d: '110s' }
    ];
    pts.forEach(function (p, i) {
      var e = doc.createElement('i');
      e.style.left = p.l; e.style.top = p.t;
      e.style.width = p.w + 'px';
      e.style.height = Math.round(p.w * 0.34) + 'px';
      e.style.color = teintes[i % teintes.length];
      e.style.setProperty('--rot', p.rot + 'deg');
      e.style.setProperty('--dx', p.dx);
      e.style.setProperty('--dy', p.dy);
      e.style.setProperty('--d', p.d);
      bg.appendChild(e);
    });
    doc.body.insertBefore(bg, doc.body.firstChild);
  }

  /* ═══════════════ 7. HAUTEUR D'EN-TÊTE ═══════════════
     Les onglets collent sous l'en-tête ; sa hauteur varie avec le format,
     donc elle est mesurée, pas supposée. */
  function mesurerEntete(doc) {
    var h = doc.querySelector('header');
    if (!h) return;
    doc.documentElement.style.setProperty('--hth-htop', h.offsetHeight + 'px');
  }

  /* ═══════════════ 8. APPLICATION ═══════════════ */
  function appliquer(doc, opts) {
    opts = opts || {};
    if (!doc || !doc.body) return null;
    var win = doc.defaultView || global;

    if (!doc.getElementById('hth-style')) {
      var st = doc.createElement('style');
      st.id = 'hth-style';
      st.textContent = CSS;
      (doc.head || doc.documentElement).appendChild(st);
    }

    /* Le thème clair d'Hermès reste la base : on l'active s'il ne l'est pas,
       puis on pose notre couche par-dessus. */
    doc.body.classList.add('theme-light', 'hth-on');

    var res = {
      inline: nettoyerInline(doc),
      tableaux: habillerTableaux(doc)
    };
    fond(doc);
    mesurerEntete(doc);
    var placer = indicateurOnglets(doc);
    cascade(doc);

    /* Le contenu est réécrit en innerHTML à chaque rendu : les nouveaux
       éléments arrivent avec leurs styles inline sombres. On repasse, en
       différé pour ne pas relancer le nettoyage à chaque nœud d'une rafale. */
    if (!opts.sansObservateur && win.MutationObserver && !doc.__hthObs) {
      var t = null;
      doc.__hthObs = new win.MutationObserver(function () {
        clearTimeout(t);
        t = setTimeout(function () {
          nettoyerInline(doc);
          habillerTableaux(doc);
          mesurerEntete(doc);
          if (placer) placer();
          cascade(doc);
        }, 120);
      });
      doc.__hthObs.observe(doc.body, { childList: true, subtree: true });
    }

    return res;
  }

  global.OlympeHermesTheme = {
    BUILD: BUILD,
    appliquer: appliquer,
    retirer: retirer,
    css: CSS,
    /* Diagnostic : OlympeHermesTheme.etat(document) */
    etat: function (doc) {
      doc = doc || global.document;
      return {
        build: BUILD,
        pose: !!doc.getElementById('hth-style'),
        actif: doc.body ? doc.body.classList.contains('hth-on') : false,
        tableauxEnveloppes: doc.querySelectorAll('.hth-scroll').length,
        inlineNettoyes: doc.querySelectorAll('[data-hth-net]').length
      };
    }
  };

  try { console.info('[hermes-theme] ' + BUILD); } catch (e) {}
})(window);
