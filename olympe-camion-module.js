/* ══════════════════════════════════════════════════════════════════════════
   OLYMPE — MODULE CAMION (onglet hub 🚚)
   ------------------------------------------------------------------------
   Rotations camion en saisie rapide : flashage douchette contenant → produit,
   saisie manuelle d'appoint, restitution 100 % KPI (aucune grille à remplir).

   BASE : hermes_camion_v3 — EXACTEMENT le même objet que l'onglet Camion
          d'Hermès (days[date].voy[n].arr / .dep). Tout ce qui est saisi ici
          apparaît dans Hermès, dans le Dashboard, dans Analytics.

   RECONNAISSANCE : tables lues dans hermes_gillot_v4 (H.prod / H.cm), avec
          repli sur les mêmes valeurs par défaut que lH(). Le résolveur produit
          est normalisé (accents / espaces / ponctuation) pour accepter les
          étiquettes produites par generateurCB.html ("PPI OO" → Inter OO).

   CONTEXTE : overlay du document PARENT. Pas d'iframe, pas de srcdoc.
   PREFIX   : ocm-   ·   API : window.OlympeCamionApp
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  if (global.__olympeCamionApp) return;
  global.__olympeCamionApp = true;

  /* ═══════════════ 1. RÉFÉRENTIEL — aligné sur Hermès ═══════════════ */

  var DBK = 'hermes_camion_v3';
  var HK  = 'hermes_gillot_v4';

  /* Contenants de la grille camion */
  var CT = ['CP', 'CE30', 'CV300', 'KUB', 'PAL'];

  /* 14 produits de la grille colis (courrier monté exclu : bloc dédié) */
  var PROD_DEF = ['CTOC PRIO', 'CTOC ECO', 'BTOC PRIO', 'BTOC ECO', 'BTOC JAVER',
    'Roissy', 'Presse', 'Cabine', 'Inter OO', 'Inter OS', 'Singapour',
    'Fausse direction', 'Anomalie colis', 'Courrier à ventiler'];

  /* Mapping douchette (17 codes) — identique à lH() dans Hermès */
  var CM_DEF = {
    'CTOCPR': 'CTOC PRIO', 'CTOCEC': 'CTOC ECO', 'BTOCPR': 'BTOC PRIO',
    'BTOCEC': 'BTOC ECO', 'BTOCJA': 'BTOC JAVER', 'ROISSY': 'Roissy',
    'PRESSE': 'Presse', 'CABINE': 'Cabine', 'PPIOO': 'Inter OO',
    'PPIOS': 'Inter OS', 'SINGAP': 'Singapour', 'FAUDIR': 'Fausse direction',
    'ANOMAL': 'Anomalie colis', 'COURAV': 'Courrier à ventiler',
    'COUKUB': 'KUB Courrier', 'PALBAK': 'BAK', 'PALKE7': 'KÉ7'
  };

  /* Produits hors grille, routés vers le bloc courrier monté */
  var COUR_ROUTE = { 'BAK': 'BAK', 'KÉ7': 'KE7', 'KUB Courrier': 'KUBc' };

  /* Couleur par produit — PRIO bleu La Poste, ECO vert La Poste (demande) */
  var PCOL = {
    'CTOC PRIO': '#0E4194', 'BTOC PRIO': '#0E4194',
    'CTOC ECO': '#009841', 'BTOC ECO': '#009841',
    'BTOC JAVER': '#00A8A8',
    'Roissy': '#6D5BD0',
    'Presse': '#E51932',
    'Cabine': '#F59E0B',
    'Inter OO': '#0891B2',
    'Inter OS': '#0EA5A5',
    'Singapour': '#DB2777',
    'Fausse direction': '#EA580C',
    'Anomalie colis': '#DC2626',
    'Courrier à ventiler': '#64748B',
    'BAK': '#8B5CF6', 'KÉ7': '#8B5CF6', 'KUB Courrier': '#8B5CF6'
  };
  var VIDE_COL = '#FDDD09';

  function pcol(p) { return PCOL[p] || '#0E4194'; }

  /* ═══════════════ 2. ACCÈS DONNÉES ═══════════════ */

  function ODB() {
    if (global.OlympeDB && typeof global.OlympeDB.getItem === 'function') return global.OlympeDB;
    /* Repli localStorage : le module reste utilisable si le store n'est pas prêt */
    return {
      getItem: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
      setItem: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { } },
      flushNow: function () { }
    };
  }

  function num(x) { var n = parseInt(x, 10); return isNaN(n) ? 0 : n; }

  var H = null;   /* hermes_gillot_v4 — référentiel produits / codes */
  var DB = null;  /* hermes_camion_v3 — données rotations */

  function loadH() {
    var d = null;
    try { var r = ODB().getItem(HK); if (r) d = JSON.parse(r); } catch (e) { d = null; }
    if (!d || typeof d !== 'object') d = {};
    if (!d.prod || !d.prod.length) d.prod = PROD_DEF.slice();
    if (!d.cm || !Object.keys(d.cm).length) d.cm = Object.assign({}, CM_DEF);
    if (!d.si) d.si = { CP: 0, CE30: 0, CV300: 0, KUB: 0, PAL: 0 };
    H = d;
    return H;
  }
  function PROD() { return (H && H.prod && H.prod.length) ? H.prod : PROD_DEF; }
  function CMAP() { return (H && H.cm) ? H.cm : CM_DEF; }

  function emptyLeg() {
    return {
      done: false, grid: {},
      cour: {
        BAK: { pal: 0, ce30: 0, cv300: 0 },
        KE7: { pal: 0, ce30: 0, cv300: 0 },
        KUBc: { pal: 0, ce30: 0, cv300: 0 }
      },
      h: '', scell: '', scellLat: '', taux: '', chauffeur: '', quai: '', etabli: ''
    };
  }
  function emptyVoy() { return { arr: emptyLeg(), dep: emptyLeg() }; }
  function emptyDay() {
    var v = {}; for (var i = 1; i <= 6; i++) v[i] = emptyVoy();
    return { voy: v, req: [], stockContenu: [], lastVoy: 6, dayTruck: '' };
  }
  function defDB() { return { trucks: [], societes: [], history: [], days: {} }; }

  function loadDB() {
    try {
      var r = ODB().getItem(DBK);
      if (r) {
        DB = JSON.parse(r);
        if (!DB || typeof DB !== 'object') DB = defDB();
        if (!DB.trucks) DB.trucks = [];
        if (!DB.societes) DB.societes = [];
        if (!DB.history) DB.history = [];
        if (!DB.days) DB.days = {};
        return DB;
      }
    } catch (e) { }
    DB = defDB();
    return DB;
  }
  function saveDB() {
    try { ODB().setItem(DBK, JSON.stringify(DB)); }
    catch (e) { toast('✗ Enregistrement refusé : ' + (e && e.message ? e.message : 'erreur inconnue'), 'err'); }
  }
  function flush() { try { if (ODB().flushNow) ODB().flushNow(); } catch (e) { } }

  /* Jour courant, créé à la demande — même forme qu'Hermès gDay() */
  function gDay(d) {
    var date = d || st.date;
    if (!DB.days[date]) DB.days[date] = emptyDay();
    var day = DB.days[date];
    if (!day.voy) day.voy = {};
    for (var i = 1; i <= 6; i++) if (!day.voy[i]) day.voy[i] = emptyVoy();
    if (!day.req) day.req = [];
    if (!day.stockContenu) day.stockContenu = [];
    if (!day.lastVoy) day.lastVoy = 6;
    return day;
  }
  function getLeg() { var day = gDay(); return day.voy[st.voy][st.mode]; }

  /* Lecture seule d'un jour quelconque (KPI semaine) */
  function dayOf(date) { return (DB.days || {})[date] || null; }
  function legsOf(day, kind) {
    var a = [];
    if (!day) return a;
    if (day.voy) for (var i = 1; i <= 6; i++) if (day.voy[i] && day.voy[i][kind]) a.push(day.voy[i][kind]);
    (day.req || []).forEach(function (r) {
      if (r && r.kind === (kind === 'arr' ? 'arr' : 'dep')) a.push(r);
    });
    if (kind === 'arr' && day.arrSP) a.push(day.arrSP);
    return a;
  }

  /* ═══════════════ 3. RECONNAISSANCE CODES-BARRES ═══════════════ */

  /* Normalisation : majuscules, accents retirés, tout sauf A-Z0-9 supprimé.
     C'est ce qui permet d'accepter les étiquettes de generateurCB.html
     ("PPI OO" → PPIOO, "CTOC PRIO" → CTOCPRIO) sans toucher au générateur. */
  function norm(s) {
    var x = String(s == null ? '' : s).toUpperCase();
    try { x = x.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { }
    return x.replace(/[^A-Z0-9]/g, '');
  }

  /* Contenant — logique identique à detC() d'Hermès */
  /* Forme stricte produite par generateurCB.html : CP0001, CE30001,
     CV300001, KUB001, PAL001. Testée en premier — c'est la seule qui ne peut
     pas se confondre avec un code produit. */
  var RE_CONT = /^(CV300|CE30|CP|KUB|PAL)(\d+)$/;

  function detC(v) {
    v = String(v || '').toUpperCase().trim();
    var m = RE_CONT.exec(v);
    if (m) return { t: m[1], col: m[1] };
    if (v.indexOf('CE30') === 0) return { t: 'CE30', col: 'CE30' };
    if (v.indexOf('CV300') === 0 || v.indexOf('CV30') === 0) return { t: 'CV300', col: 'CV300' };
    if (v.indexOf('KUB') === 0) return { t: 'KUB', col: 'KUB' };
    if (v.indexOf('PAL') === 0) return { t: 'PAL', col: 'PAL' };
    if (v.indexOf('CP') === 0) return { t: 'CP', col: 'CP' };
    if (v.indexOf('CE30') >= 0) return { t: 'CE30', col: 'CE30' };
    if (v.indexOf('CV300') >= 0 || v.indexOf('CV30') >= 0) return { t: 'CV300', col: 'CV300' };
    if (v.indexOf('KUB') >= 0) return { t: 'KUB', col: 'KUB' };
    if (v.indexOf('PAL') >= 0 && v.indexOf('PALETTE') < 0) return { t: 'PAL', col: 'PAL' };
    if (v.indexOf('CP') >= 0) return { t: 'CP', col: 'CP' };
    return null;
  }

  /* Produit — resP() d'Hermès + étape de normalisation supplémentaire */
  function resP(v) {
    var raw = String(v || '').toUpperCase().trim();
    if (!raw) return null;
    var cm = CMAP(), P = PROD(), i, k, n = norm(raw);

    if (cm[raw]) return cm[raw];                                   /* 1. code exact          */
    for (k in cm) { if (norm(k) === n) return cm[k]; }              /* 2. code normalisé      */
    for (i = 0; i < P.length; i++) { if (norm(P[i]) === n) return P[i]; }  /* 3. libellé produit */
    for (k in cm) { if (n.indexOf(norm(k)) >= 0) return cm[k]; }     /* 4. code contenu dedans */
    for (i = 0; i < P.length; i++) {                                /* 5. libellé contenu     */
      var pn = norm(P[i]); if (pn && n.indexOf(pn) >= 0) return P[i];
    }
    for (k in COUR_ROUTE) { if (norm(k) === n) return k; }           /* 6. courrier monté      */
    return null;
  }

  /* ═══════════════ 4. ÉTAT ═══════════════ */

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  }

  var st = {
    open: false,
    mode: 'dep',          /* 'dep' = départ (écran principal) | 'arr' = arrivée */
    voy: 1,               /* voyage 1..6 */
    date: todayISO(),
    scan: { c: null, used: [] },
    lastOp: null          /* dernière opération, pour l'annulation */
  };

  var _kpiCache = {};     /* mémorise les valeurs pour animer les changements  */

  /* ═══════════════ 5. CALCULS ═══════════════ */

  /* Ventilation d'un leg : [{prod, col, qte}] — uniquement le non nul */
  function legLines(leg) {
    var out = [], P = PROD(), k, pa, pi, col;
    if (!leg || !leg.grid) return out;
    for (k in leg.grid) {
      var q = num(leg.grid[k]);
      if (!q) continue;
      pa = k.split('-');
      col = pa[1];
      if (pa[0] === 'V') { out.push({ prod: '__VIDE__', col: col, qte: q }); continue; }
      pi = parseInt(pa[0], 10);
      if (isNaN(pi) || !P[pi]) continue;
      out.push({ prod: P[pi], col: col, qte: q });
    }
    return out;
  }

  function cRow(leg, t) {
    if (!leg.cour) leg.cour = {};
    if (!leg.cour[t]) leg.cour[t] = { pal: 0, ce30: 0, cv300: 0 };
    return leg.cour[t];
  }
  function kubcTot(leg) {
    var r = cRow(leg, 'KUBc'); var t = num(r.total);
    return t || (num(r.pal) + num(r.ce30) + num(r.cv300));
  }
  /* Contenu total d'une ligne courrier (BAK / KÉ7) */
  function courContent(leg, t) {
    var r = cRow(leg, t);
    if (r.palc != null || r.ce30c != null || r.cv300c != null)
      return num(r.palc) + num(r.ce30c) + num(r.cv300c);
    return num(r.pal) + num(r.ce30) + num(r.cv300);
  }
  function courTotal(leg) {
    if (!leg) return 0;
    return courContent(leg, 'BAK') + courContent(leg, 'KE7') + kubcTot(leg);
  }

  /* Total contenants pleins d'un leg (VIDE exclu) */
  function legPleins(leg) {
    var s = 0;
    legLines(leg).forEach(function (l) { if (l.prod !== '__VIDE__') s += l.qte; });
    return s;
  }
  function legVides(leg) {
    var s = 0;
    legLines(leg).forEach(function (l) { if (l.prod === '__VIDE__') s += l.qte; });
    return s;
  }

  /* Totaux CTOC / BTOC d'un jour, par contenant — pour le calendrier semaine */
  function ctocBtocOf(date) {
    var r = { CTOC: { CP: 0, CE30: 0, CV300: 0 }, BTOC: { CP: 0, CE30: 0, CV300: 0 } };
    var day = dayOf(date); if (!day) return r;
    legsOf(day, 'dep').forEach(function (leg) {
      legLines(leg).forEach(function (l) {
        if (l.prod === '__VIDE__') return;
        var fam = l.prod.indexOf('CTOC') === 0 ? 'CTOC' : (l.prod.indexOf('BTOC') === 0 ? 'BTOC' : null);
        if (!fam) return;
        if (r[fam][l.col] == null) return;   /* KUB / PAL hors tableau semaine */
        r[fam][l.col] += l.qte;
      });
    });
    return r;
  }

  /* Totaux PRIO / ECO du jour, tous contenants confondus */
  function prioEcoOf(date) {
    var r = { 'CTOC PRIO': 0, 'CTOC ECO': 0, 'BTOC PRIO': 0, 'BTOC ECO': 0 };
    var day = dayOf(date); if (!day) return r;
    legsOf(day, 'dep').forEach(function (leg) {
      legLines(leg).forEach(function (l) { if (r[l.prod] != null) r[l.prod] += l.qte; });
    });
    return r;
  }

  /* Vide revenu du jour (arrivées), par contenant */
  function videOf(date) {
    var r = { CP: 0, CE30: 0, CV300: 0, KUB: 0, PAL: 0, total: 0 };
    var day = dayOf(date); if (!day) return r;
    legsOf(day, 'arr').forEach(function (leg) {
      legLines(leg).forEach(function (l) {
        if (l.prod !== '__VIDE__') return;
        if (r[l.col] == null) return;
        r[l.col] += l.qte; r.total += l.qte;
      });
    });
    return r;
  }

  /* Total départs du jour : contenants pleins + courrier monté, nb de départs validés */
  function departJour(date) {
    var r = { pleins: 0, courrier: 0, rotations: 0 };
    var day = dayOf(date); if (!day) return r;
    legsOf(day, 'dep').forEach(function (leg) {
      r.pleins += legPleins(leg);
      r.courrier += courTotal(leg);
      if (leg.done) r.rotations++;
    });
    return r;
  }

  /* Lundi → samedi de la semaine contenant `date` */
  function weekDays(date) {
    var d = new Date(date + 'T12:00:00');
    if (isNaN(d.getTime())) d = new Date();
    var jd = d.getDay();                       /* 0 = dimanche */
    var delta = (jd === 0) ? -6 : (1 - jd);    /* recule au lundi */
    var lun = new Date(d.getTime()); lun.setDate(lun.getDate() + delta);
    var out = [];
    for (var i = 0; i < 6; i++) {              /* lundi → samedi */
      var x = new Date(lun.getTime()); x.setDate(x.getDate() + i);
      out.push({
        iso: x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'),
        lab: ['L', 'M', 'M', 'J', 'V', 'S'][i],
        jour: String(x.getDate()).padStart(2, '0')
      });
    }
    return out;
  }

  /* ═══════════════ 6. FEUILLE DE STYLE ═══════════════ */

  var CSS = [
    '#ocm-ov{position:fixed;inset:0;z-index:100060;display:none;flex-direction:column;',
    'background:#F4F7FC;color:#0E2A5C;overflow:hidden;',
    "font-family:'DM Sans','Segoe UI',-apple-system,BlinkMacSystemFont,sans-serif;}",
    '#ocm-ov.on{display:flex;animation:ocmIn .32s cubic-bezier(.22,.85,.28,1);}',
    '@keyframes ocmIn{from{opacity:0;transform:scale(.985)}to{opacity:1;transform:none}}',
    '#ocm-ov *{box-sizing:border-box;margin:0;}',
    '#ocm-ov button{font-family:inherit;cursor:pointer;border:0;}',

    /* variables de mode : bleu au départ, vert à l'arrivée */
    '#ocm-ov{--j:#FDDD09;--b:#0E4194;--b2:#134FB4;--v:#009841;--c:#00A8A8;--r:#E51932;',
    '--acc:#0E4194;--acc2:#134FB4;--line:rgba(14,65,148,.12);--muted:rgba(14,65,148,.58);',
    '--card:#FFFFFF;--sh:0 6px 20px rgba(14,65,148,.09);--sh2:0 16px 38px rgba(14,65,148,.18);',
    '--e:cubic-bezier(.22,.85,.28,1);--s:cubic-bezier(.34,1.5,.5,1);}',
    '#ocm-ov.arr{--acc:#009841;--acc2:#00B44E;--line:rgba(0,152,65,.16);--muted:rgba(6,80,45,.60);',
    '--sh:0 6px 20px rgba(0,152,65,.10);--sh2:0 16px 38px rgba(0,152,65,.20);color:#083E24;}',

    /* décor animé : chevrons de marque en dérive */
    '#ocm-bg{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0;}',
    '#ocm-bg i{position:absolute;display:block;opacity:.10;animation:ocmDrift 26s var(--e) infinite alternate;}',
    '#ocm-bg svg{width:100%;height:100%;display:block;}',
    '@keyframes ocmDrift{from{transform:translate3d(0,0,0) rotate(var(--rot,0deg)) scale(1)}',
    'to{transform:translate3d(var(--dx,24px),var(--dy,-30px),0) rotate(calc(var(--rot,0deg) + 4deg)) scale(1.08)}}',
    '#ocm-bg::after{content:"";position:absolute;inset:0;',
    'background:radial-gradient(120% 55% at 100% 0%,rgba(253,221,9,.30),transparent 62%),',
    'radial-gradient(85% 48% at 0% 8%,rgba(0,168,168,.16),transparent 60%);}',
    '#ocm-ov.arr #ocm-bg::after{background:radial-gradient(120% 55% at 100% 0%,rgba(0,152,65,.22),transparent 62%),',
    'radial-gradient(85% 48% at 0% 8%,rgba(253,221,9,.22),transparent 60%);}',

    /* barre haute */
    '.ocm-top{position:relative;z-index:2;display:flex;align-items:center;gap:12px;flex-wrap:wrap;',
    'padding:12px 18px;background:linear-gradient(100deg,var(--acc),var(--acc2));color:#fff;',
    'box-shadow:0 6px 22px rgba(0,20,60,.24);overflow:hidden;}',
    '.ocm-top::before{content:"";position:absolute;inset:0;pointer-events:none;',
    'background:linear-gradient(72deg,transparent 40%,rgba(255,255,255,.20) 50%,transparent 60%);',
    'transform:translateX(-70%);animation:ocmSweep 6s var(--e) infinite;}',
    '@keyframes ocmSweep{0%{transform:translateX(-70%)}55%,100%{transform:translateX(80%)}}',
    '.ocm-top::after{content:"";position:absolute;left:0;right:0;bottom:0;height:4px;',
    'background:repeating-linear-gradient(90deg,var(--b) 0 34px,var(--v) 34px 68px,var(--c) 68px 102px,var(--r) 102px 136px);',
    'background-size:136px 100%;animation:ocmBand 11s linear infinite;}',
    '@keyframes ocmBand{from{background-position:0 0}to{background-position:136px 0}}',
    '.ocm-brand{display:flex;align-items:center;gap:10px;font-weight:900;letter-spacing:-.4px;font-size:18px;position:relative;z-index:1;}',
    '.ocm-brand .em{font-size:24px;animation:ocmRoll 3.4s var(--e) infinite;}',
    '@keyframes ocmRoll{0%,70%,100%{transform:translateX(0)}82%{transform:translateX(6px)}}',
    '.ocm-brand small{display:block;font-size:10px;font-weight:700;letter-spacing:1.6px;',
    'text-transform:uppercase;opacity:.82;}',
    '.ocm-sp{flex:1;}',
    '.ocm-top input[type=date]{position:relative;z-index:1;background:rgba(255,255,255,.16);border:1.5px solid rgba(255,255,255,.34);',
    'color:#fff;border-radius:10px;padding:7px 10px;font-weight:800;font-size:13px;font-family:inherit;}',
    '.ocm-tbtn{position:relative;z-index:1;background:rgba(255,255,255,.15);border:1.5px solid rgba(255,255,255,.34) !important;',
    'color:#fff;border-radius:10px;padding:8px 14px;font-weight:800;font-size:12px;letter-spacing:.4px;',
    'transition:transform .14s var(--e),background .18s;}',
    '.ocm-tbtn:hover{background:rgba(255,255,255,.28);transform:translateY(-2px);}',
    '.ocm-tbtn:active{transform:scale(.95);}',
    '.ocm-tbtn.j{background:var(--j);color:#0E2A5C;border-color:var(--j) !important;box-shadow:0 4px 14px rgba(253,221,9,.42);}',

    /* bascule départ / arrivée */
    '.ocm-modebar{position:relative;z-index:2;display:flex;gap:10px;padding:14px 18px 6px;flex-wrap:wrap;}',
    '.ocm-mode{flex:1;min-width:180px;border-radius:14px;padding:14px 16px;font-weight:900;font-size:15px;',
    'letter-spacing:.6px;background:var(--card);color:var(--muted);border:2px solid var(--line) !important;',
    'box-shadow:var(--sh);transition:transform .2s var(--s),box-shadow .2s,color .2s,border-color .2s;',
    'display:flex;align-items:center;justify-content:center;gap:10px;position:relative;overflow:hidden;}',
    '.ocm-mode:hover{transform:translateY(-3px);box-shadow:var(--sh2);}',
    '.ocm-mode .cnt{font-size:11px;font-weight:800;opacity:.7;letter-spacing:.4px;}',
    /* Éteint, le bouton porte déjà sa couleur : l'agent repère l'arrivée
       sans lire le libellé, c'est le code couleur demandé. */
    '.ocm-mode.dep:not(.on){color:#0E4194;border-color:rgba(14,65,148,.42) !important;}',
    '.ocm-mode.arr:not(.on){color:#007533;border-color:rgba(0,152,65,.52) !important;',
    'background:linear-gradient(180deg,#fff,#F0FBF4);}',
    '.ocm-mode.arr:not(.on)::before{content:"";position:absolute;left:12px;top:50%;',
    'width:9px;height:9px;border-radius:50%;background:#009841;transform:translateY(-50%);',
    'box-shadow:0 0 0 0 rgba(0,152,65,.6);animation:ocmPulse 2.2s ease-out infinite;}',
    '@keyframes ocmPulse{0%{box-shadow:0 0 0 0 rgba(0,152,65,.55)}',
    '70%{box-shadow:0 0 0 12px rgba(0,152,65,0)}100%{box-shadow:0 0 0 0 rgba(0,152,65,0)}}',
    '.ocm-mode.on.dep{background:linear-gradient(100deg,#0E4194,#134FB4);color:#fff;border-color:#0E4194 !important;',
    'box-shadow:0 12px 30px rgba(14,65,148,.34);}',
    '.ocm-mode.on.arr{background:linear-gradient(100deg,#009841,#00B44E);color:#fff;border-color:#009841 !important;',
    'box-shadow:0 12px 30px rgba(0,152,65,.34);}',
    '.ocm-mode.on::after{content:"";position:absolute;inset:0;',
    'background:linear-gradient(72deg,transparent 42%,rgba(255,255,255,.26) 50%,transparent 58%);',
    'transform:translateX(-70%);animation:ocmSweep 4.5s var(--e) infinite;}',

    /* sélecteur de voyage */
    '.ocm-voybar{position:relative;z-index:2;display:flex;gap:8px;padding:10px 18px 4px;',
    'overflow-x:auto;scrollbar-width:none;align-items:center;}',
    '.ocm-voybar::-webkit-scrollbar{display:none;}',
    '.ocm-vlab{font-size:10px;font-weight:900;letter-spacing:1.4px;text-transform:uppercase;color:var(--muted);',
    'white-space:nowrap;margin-right:4px;}',
    '.ocm-voy{flex:0 0 auto;border-radius:100px;padding:8px 16px;font-weight:800;font-size:13px;',
    'background:var(--card);color:var(--muted);border:1.5px solid var(--line) !important;box-shadow:var(--sh);',
    'transition:transform .16s var(--s),background .2s,color .2s;position:relative;}',
    '.ocm-voy:hover{transform:translateY(-2px);}',
    '.ocm-voy.on{background:var(--j);color:#0E2A5C;border-color:var(--j) !important;box-shadow:0 6px 18px rgba(253,221,9,.45);}',
    '.ocm-voy .dot{position:absolute;top:5px;right:7px;width:7px;height:7px;border-radius:50%;background:var(--v);',
    'box-shadow:0 0 0 2px #fff;}',

    /* corps */
    '.ocm-main{position:relative;z-index:2;flex:1;overflow-y:auto;padding:10px 18px 28px;',
    '-webkit-overflow-scrolling:touch;}',
    '.ocm-card{background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:var(--sh);',
    'padding:16px;margin-bottom:14px;position:relative;overflow:hidden;}',
    '.ocm-card.enter{animation:ocmRise .5s var(--e) both;animation-delay:var(--d,0ms);}',
    '@keyframes ocmRise{from{transform:translate3d(0,22px,0) scale(.97);opacity:0}to{transform:none;opacity:1}}',
    '.ocm-h{font-size:11px;font-weight:900;letter-spacing:1.6px;text-transform:uppercase;color:var(--acc);',
    'margin-bottom:12px;display:flex;align-items:center;gap:8px;}',
    '.ocm-h::after{content:"";flex:1;height:2px;border-radius:2px;background:var(--line);}',

    /* zone de flashage */
    '.ocm-scan{border:2px solid var(--acc);box-shadow:var(--sh2);}',
    '.ocm-scan::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;',
    'background:linear-gradient(90deg,transparent,var(--acc),transparent);animation:ocmRead 2.6s linear infinite;}',
    '@keyframes ocmRead{from{transform:translateX(-100%)}to{transform:translateX(100%)}}',
    '.ocm-steps{display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:11px;font-weight:800;color:var(--muted);}',
    '.ocm-num{width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;',
    'background:var(--line);color:var(--muted);font-weight:900;font-size:12px;transition:.24s var(--s);}',
    '.ocm-num.act{background:var(--j);color:#0E2A5C;transform:scale(1.14);box-shadow:0 0 0 4px rgba(253,221,9,.3);}',
    '.ocm-num.ok{background:var(--v);color:#fff;}',
    '.ocm-sins{display:grid;grid-template-columns:1fr 1fr;gap:10px;}',
    '.ocm-in{width:100%;background:#F7F9FD;border:2px solid var(--line);border-radius:12px;padding:13px 14px;',
    "font-family:'DM Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;font-weight:700;",
    'color:#0E2A5C;letter-spacing:.5px;transition:.2s var(--e);}',
    '.ocm-in::placeholder{color:rgba(14,65,148,.34);font-weight:600;}',
    '.ocm-in:focus{outline:0;border-color:var(--acc);background:#fff;box-shadow:0 0 0 5px rgba(14,65,148,.12);}',
    '#ocm-ov.arr .ocm-in:focus{box-shadow:0 0 0 5px rgba(0,152,65,.14);}',
    '.ocm-in.done{border-color:var(--v);background:rgba(0,152,65,.08);color:#046b33;}',
    '.ocm-in:disabled{opacity:.5;cursor:not-allowed;}',
    '.ocm-stat{margin-top:10px;font-size:13px;font-weight:800;color:var(--muted);min-height:20px;}',
    '.ocm-stat.ok{color:#047a37;}.ocm-stat.err{color:var(--r);}.ocm-stat.warn{color:#B45309;}',
    '.ocm-stat.pop{animation:ocmPop .4s var(--s);}',
    '@keyframes ocmPop{0%{transform:scale(.88)}60%{transform:scale(1.06)}100%{transform:none}}',
    '.ocm-log{margin-top:10px;display:flex;flex-direction:column;gap:4px;max-height:132px;overflow-y:auto;}',
    '.ocm-li{font-size:11px;font-weight:700;color:var(--muted);background:#F7F9FD;border-radius:8px;',
    "padding:5px 9px;font-family:ui-monospace,monospace;animation:ocmSlide .34s var(--e);}",
    '@keyframes ocmSlide{from{transform:translateX(-18px);opacity:0}to{transform:none;opacity:1}}',
    '.ocm-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;}',
    '.ocm-b{border-radius:10px;padding:9px 15px;font-weight:800;font-size:12px;letter-spacing:.3px;',
    'background:#F0F4FB;color:var(--acc);border:1.5px solid var(--line) !important;',
    'transition:transform .14s var(--e),box-shadow .18s;}',
    '.ocm-b:hover{transform:translateY(-2px);box-shadow:var(--sh);}',
    '.ocm-b:active{transform:scale(.95);}',
    '.ocm-b.g{background:var(--v);color:#fff;border-color:var(--v) !important;}',
    '.ocm-b.j{background:var(--j);color:#0E2A5C;border-color:var(--j) !important;}',
    '.ocm-b.r{background:#FDECEE;color:var(--r);border-color:rgba(229,25,50,.28) !important;}',

    /* saisie manuelle */
    '.ocm-man{display:grid;grid-template-columns:2fr 1fr 80px auto;gap:8px;align-items:center;}',
    '.ocm-sel{width:100%;background:#F7F9FD;border:2px solid var(--line);border-radius:10px;padding:10px 11px;',
    'font-size:13px;font-weight:700;color:#0E2A5C;font-family:inherit;}',
    '.ocm-sel:focus{outline:0;border-color:var(--acc);}',

    /* KPI produits flashés */
    '.ocm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;}',
    '.ocm-k{position:relative;border-radius:14px;padding:14px;background:var(--card);overflow:hidden;',
    'border:1px solid var(--line);box-shadow:var(--sh);--kc:#0E4194;',
    'transition:transform .26s var(--e),box-shadow .26s;animation:ocmRise .46s var(--e) both;animation-delay:var(--d,0ms);}',
    '.ocm-k:hover{transform:translateY(-4px);box-shadow:var(--sh2);}',
    '.ocm-k::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--kc);}',
    '.ocm-k .kt{font-size:11px;font-weight:900;letter-spacing:.7px;text-transform:uppercase;color:var(--kc);',
    'margin-bottom:6px;padding-left:6px;}',
    '.ocm-k .kv{font-size:34px;font-weight:900;line-height:1;letter-spacing:-1.6px;color:var(--kc);padding-left:6px;}',
    '.ocm-k .kv.pop{animation:ocmPop .5s var(--s);}',
    '.ocm-k .ku{font-size:10px;font-weight:800;color:var(--muted);letter-spacing:.6px;padding-left:6px;margin-top:2px;}',
    '.ocm-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px;padding-left:6px;}',
    '.ocm-chip{font-size:10px;font-weight:800;border-radius:100px;padding:3px 9px;',
    'background:color-mix(in srgb,var(--kc) 12%,transparent);color:var(--kc);',
    'border:1px solid color-mix(in srgb,var(--kc) 26%,transparent);}',
    '.ocm-empty{padding:26px 14px;text-align:center;font-size:13px;font-weight:700;color:var(--muted);}',
    '.ocm-empty .big{font-size:34px;display:block;margin-bottom:8px;opacity:.5;}',

    /* bandeau totaux */
    '.ocm-tot{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;}',
    '.ocm-tot .ocm-k .kv{font-size:40px;}',

    /* calendrier semaine */
    '.ocm-wk{width:100%;border-collapse:separate;border-spacing:0;font-size:13px;}',
    '.ocm-wk th{font-size:10px;font-weight:900;letter-spacing:.8px;text-transform:uppercase;',
    'padding:8px 6px;color:#fff;background:var(--acc);white-space:nowrap;}',
    '.ocm-wk thead tr th:first-child{border-radius:10px 0 0 0;}',
    '.ocm-wk thead tr th:last-child{border-radius:0 10px 0 0;}',
    '.ocm-wk th.ct{background:#0E4194;}.ocm-wk th.bt{background:#00A8A8;}',
    '.ocm-wk td{padding:9px 6px;text-align:center;font-weight:800;border-bottom:1px solid var(--line);',
    'color:#0E2A5C;transition:background .2s;}',
    '.ocm-wk td.d{text-align:left;font-weight:900;color:var(--muted);letter-spacing:.6px;white-space:nowrap;}',
    '.ocm-wk tr.now td{background:rgba(253,221,9,.22);}',
    '.ocm-wk tr.now td.d{color:#0E2A5C;}',
    '.ocm-wk td.z{color:rgba(14,65,148,.24);font-weight:600;}',
    '.ocm-wk tfoot td{font-weight:900;color:var(--acc);border-top:2px solid var(--acc);border-bottom:0;}',
    '.ocm-wkwrap{overflow-x:auto;-webkit-overflow-scrolling:touch;}',

    /* toast */
    '#ocm-toast{position:fixed;left:50%;bottom:26px;transform:translate(-50%,26px);z-index:100068;',
    'background:#0E2A5C;color:#fff;border-radius:12px;padding:12px 20px;font-weight:800;font-size:13px;',
    'box-shadow:0 14px 34px rgba(0,20,60,.34);opacity:0;pointer-events:none;transition:.28s var(--e);',
    "font-family:'DM Sans','Segoe UI',sans-serif;max-width:88vw;text-align:center;}",
    '#ocm-toast.on{opacity:1;transform:translate(-50%,0);}',
    '#ocm-toast.err{background:var(--r);}#ocm-toast.ok{background:#047a37;}',

    /* bouton retour depuis le dashboard */
    '#ocm-back{position:fixed;left:16px;top:16px;z-index:100076;display:none;align-items:center;gap:8px;',
    'background:#0E4194;color:#fff;border-radius:100px;padding:11px 20px;font-weight:900;font-size:13px;',
    'box-shadow:0 10px 28px rgba(14,65,148,.4);border:0;cursor:pointer;',
    "font-family:'DM Sans','Segoe UI',sans-serif;animation:ocmPop .4s cubic-bezier(.34,1.5,.5,1);}",
    '#ocm-back.on{display:inline-flex;}',
    '#ocm-back:active{transform:scale(.95);}',

    /* responsive */
    '@media (max-width:760px){',
    '.ocm-top{padding:10px 12px;gap:8px;}.ocm-brand{font-size:15px;}',
    '.ocm-modebar,.ocm-voybar{padding-left:12px;padding-right:12px;}',
    '.ocm-main{padding:8px 12px 24px;}',
    '.ocm-sins{grid-template-columns:1fr;}',
    '.ocm-man{grid-template-columns:1fr 1fr;}',
    '.ocm-man .fullw{grid-column:1 / -1;}',
    '.ocm-grid{grid-template-columns:repeat(auto-fill,minmax(142px,1fr));}',
    '.ocm-k .kv{font-size:28px;}',
    '}',
    '@media (prefers-reduced-motion:reduce){',
    '#ocm-ov *,#ocm-ov *::before,#ocm-ov *::after{animation-duration:.001ms !important;',
    'animation-iteration-count:1 !important;transition-duration:.001ms !important;}',
    '#ocm-bg{display:none;}',
    '}'
  ].join('');

  /* ═══════════════ 7. CONSTRUCTION DU DOM ═══════════════ */

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function $(id) { return document.getElementById(id); }

  var CHEVRON = '<svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4 30 L52 30 L74 10 L26 10 Z" fill="currentColor"/>' +
    '<path d="M28 36 L96 36 L96 32 L34 32 Z" fill="currentColor"/></svg>';

  function buildShell() {
    if ($('ocm-ov')) return;

    var style = document.createElement('style');
    style.id = 'ocm-style';
    style.textContent = CSS;
    document.head.appendChild(style);

    var ov = document.createElement('div');
    ov.id = 'ocm-ov';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-label', 'Rotations camion');
    ov.innerHTML = [
      '<div id="ocm-bg" aria-hidden="true"></div>',
      '<header class="ocm-top">',
      '  <div class="ocm-brand"><span class="em">🚚</span><span>CAMION<small>PIC Gillot · Rotations</small></span></div>',
      '  <input type="date" id="ocm-date" aria-label="Date de la rotation">',
      '  <div class="ocm-sp"></div>',
      '  <button class="ocm-tbtn j" id="ocm-dash" type="button">📊 Dashboard</button>',
      '  <button class="ocm-tbtn" id="ocm-close" type="button" aria-label="Fermer">✕ Fermer</button>',
      '</header>',
      '<div class="ocm-modebar">',
      '  <button class="ocm-mode dep on" id="ocm-m-dep" type="button" aria-pressed="true">',
      '    <span>⬆ DÉPART CAMION</span><span class="cnt" id="ocm-cnt-dep"></span></button>',
      '  <button class="ocm-mode arr" id="ocm-m-arr" type="button" aria-pressed="false">',
      '    <span>⬇ ARRIVÉE CAMION</span><span class="cnt" id="ocm-cnt-arr"></span></button>',
      '</div>',
      '<div class="ocm-voybar" id="ocm-voybar"></div>',
      '<main class="ocm-main">',
      '  <section class="ocm-card ocm-scan">',
      '    <div class="ocm-h" id="ocm-scan-h">Flashage douchette</div>',
      '    <div class="ocm-steps"><span class="ocm-num act" id="ocm-n1">1</span><span>Contenant</span>',
      '      <span style="opacity:.4">→</span><span class="ocm-num" id="ocm-n2">2</span><span>Produit</span></div>',
      '    <div class="ocm-sins">',
      '      <input class="ocm-in" id="ocm-sc-c" placeholder="Flasher contenant…" autocomplete="off" aria-label="Code-barres contenant">',
      '      <input class="ocm-in" id="ocm-sc-p" placeholder="Flasher produit…" autocomplete="off" disabled aria-label="Code-barres produit">',
      '    </div>',
      '    <div class="ocm-stat" id="ocm-stat">En attente…</div>',
      '    <div class="ocm-acts">',
      '      <button class="ocm-b" id="ocm-reset" type="button">↺ Réinitialiser</button>',
      '      <button class="ocm-b r" id="ocm-undo" type="button">⤺ Annuler la dernière</button>',
      '      <button class="ocm-b g" id="ocm-valid" type="button">✓ Valider</button>',
      '    </div>',
      '    <div class="ocm-log" id="ocm-log"></div>',
      '  </section>',
      '  <section class="ocm-card">',
      '    <div class="ocm-h">Saisie manuelle</div>',
      '    <div class="ocm-man">',
      '      <select class="ocm-sel fullw" id="ocm-mp" aria-label="Produit"></select>',
      '      <select class="ocm-sel" id="ocm-mc" aria-label="Contenant"></select>',
      '      <input class="ocm-in" id="ocm-mq" type="number" min="1" value="1" style="padding:10px 11px;font-size:14px" aria-label="Quantité">',
      '      <button class="ocm-b j" id="ocm-madd" type="button">+ Ajouter</button>',
      '    </div>',
      '  </section>',
      '  <section id="ocm-flux"></section>',
      '  <section id="ocm-kpis"></section>',
      '</main>'
    ].join('');
    document.body.appendChild(ov);

    var toast = document.createElement('div');
    toast.id = 'ocm-toast';
    document.body.appendChild(toast);

    var back = document.createElement('button');
    back.id = 'ocm-back';
    back.type = 'button';
    back.innerHTML = '← Retour Camion';
    document.body.appendChild(back);

    /* décor */
    var bg = $('ocm-bg');
    if (bg) {
      var spots = [
        { l: '4%', t: '12%', w: 160, rot: -12, dx: '30px', dy: '-24px', d: 0 },
        { l: '72%', t: '6%', w: 220, rot: 8, dx: '-26px', dy: '32px', d: 3 },
        { l: '18%', t: '68%', w: 190, rot: 16, dx: '34px', dy: '20px', d: 6 },
        { l: '84%', t: '58%', w: 140, rot: -6, dx: '-30px', dy: '-28px', d: 9 }
      ];
      spots.forEach(function (s) {
        var i = document.createElement('i');
        i.style.left = s.l; i.style.top = s.t;
        i.style.width = s.w + 'px'; i.style.height = (s.w * 0.4) + 'px';
        i.style.setProperty('--rot', s.rot + 'deg');
        i.style.setProperty('--dx', s.dx);
        i.style.setProperty('--dy', s.dy);
        i.style.animationDelay = s.d + 's';
        i.style.color = (s.d % 6 === 0) ? '#FDDD09' : '#0E4194';
        i.innerHTML = CHEVRON;
        bg.appendChild(i);
      });
    }

    wire();
  }

  /* ═══════════════ 8. ÉVÉNEMENTS ═══════════════ */

  function on(id, ev, fn) { var e = $(id); if (e) e.addEventListener(ev, fn); }

  function wire() {
    on('ocm-close', 'click', close);
    on('ocm-dash', 'click', openDashboard);
    on('ocm-back', 'click', closeDashboard);

    on('ocm-m-dep', 'click', function () { setMode('dep'); });
    on('ocm-m-arr', 'click', function () { setMode('arr'); });

    on('ocm-date', 'change', function (e) {
      var v = e.target.value;
      if (!v) { e.target.value = st.date; return; }
      st.date = v; resetScan(true); render();
    });

    on('ocm-sc-c', 'keydown', scanContenant);
    on('ocm-sc-p', 'keydown', scanProduit);
    on('ocm-reset', 'click', function () { resetScan(false); });
    on('ocm-undo', 'click', undoLast);
    on('ocm-valid', 'click', validateLeg);
    on('ocm-madd', 'click', manualAdd);

    document.addEventListener('keydown', function (e) {
      if (!st.open) return;
      if (e.key === 'Escape') {
        if ($('ocm-back') && $('ocm-back').classList.contains('on')) { closeDashboard(); return; }
        close();
      }
    });

    /* Un autre poste a modifié la rotation : on relit, sans jamais écraser
       une saisie en cours (même garde que olympeLiveRefresh d'Hermès). */
    setInterval(function () {
      if (!st.open) return;
      var a = document.activeElement;
      var t = a ? (a.tagName || '').toLowerCase() : '';
      if (t === 'input' || t === 'select' || t === 'textarea') return;
      var before = ODB().getItem(DBK);
      if (before === _lastRaw) return;
      _lastRaw = before;
      loadH(); loadDB(); render();
    }, 6000);
  }
  var _lastRaw = null;

  /* ═══════════════ 9. FLASHAGE ═══════════════ */

  function setStat(msg, kind) {
    var e = $('ocm-stat'); if (!e) return;
    e.textContent = msg;
    e.className = 'ocm-stat' + (kind ? ' ' + kind : '') + ' pop';
    setTimeout(function () { if (e.textContent === msg) e.className = 'ocm-stat' + (kind === 'ok' ? '' : (kind ? ' ' + kind : '')); }, 2600);
  }
  function addLog(code, prod) {
    var l = $('ocm-log'); if (!l) return;
    var it = document.createElement('div');
    it.className = 'ocm-li';
    it.textContent = code + '  →  ' + prod;
    l.prepend(it);
    while (l.children.length > 12) l.removeChild(l.lastChild);
  }
  function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 14); } catch (e) { } }

  function resetScan(silent) {
    st.scan = { c: null, used: st.scan ? st.scan.used : [] };
    if (!silent) st.scan.used = [];
    var c = $('ocm-sc-c'), p = $('ocm-sc-p');
    if (c) { c.disabled = false; c.className = 'ocm-in'; c.value = ''; }
    if (p) { p.disabled = true; p.className = 'ocm-in'; p.value = ''; }
    if ($('ocm-n1')) $('ocm-n1').className = 'ocm-num act';
    if ($('ocm-n2')) $('ocm-n2').className = 'ocm-num';
    if (!silent) { if ($('ocm-log')) $('ocm-log').innerHTML = ''; setStat('En attente…', null); }
    if (c && st.open && !silent) { try { c.focus(); } catch (e) { } }
  }

  function scanContenant(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var v = String(e.target.value || '').toUpperCase().trim();
    if (!v) return;
    /* Garde anti-inversion : "CTOCPR" contient la sous-chaîne "CP" et serait
       lu comme un contenant CP par la détection par mot-clé. On teste donc
       d'abord si le code est un PRODUIT connu, et on refuse explicitement. */
    if (!RE_CONT.test(v) && resP(v)) {
      setStat('✗ « ' + v + ' » est un code produit — flasher d\'abord le contenant', 'err');
      e.target.value = ''; buzz([40, 40, 40]); return;
    }
    var d = detC(v);
    if (!d) { setStat('✗ Contenant inconnu : ' + v, 'err'); e.target.value = ''; buzz([40, 40, 40]); return; }
    if (st.scan.used.indexOf(v) >= 0) { setStat('⚠ ' + v + ' déjà flashé sur ce trajet', 'warn'); e.target.value = ''; buzz([30, 30]); return; }
    st.scan.c = { id: v, t: d.t, col: d.col };
    e.target.value = v; e.target.className = 'ocm-in done'; e.target.disabled = true;
    var p = $('ocm-sc-p');
    if (p) { p.disabled = false; p.className = 'ocm-in'; try { p.focus(); } catch (er) { } }
    if ($('ocm-n1')) $('ocm-n1').className = 'ocm-num ok';
    if ($('ocm-n2')) $('ocm-n2').className = 'ocm-num act';
    setStat('✓ ' + v + ' (' + d.t + ') — flasher le produit', 'ok');
    buzz(12);
  }

  function scanProduit(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var v = String(e.target.value || '').toUpperCase().trim();
    if (!v || !st.scan.c) return;
    var pn = resP(v);
    if (!pn) { setStat('✗ Produit inconnu : ' + v, 'err'); e.target.value = ''; buzz([40, 40, 40]); return; }

    var ok = applyOne(pn, st.scan.c.col, 1);
    if (!ok) { e.target.value = ''; return; }

    if (st.scan.used.indexOf(st.scan.c.id) < 0) st.scan.used.push(st.scan.c.id);
    addLog(st.scan.c.id, pn);
    setStat('✓ ' + pn + ' → ' + st.scan.c.col + ' (+1)', 'ok');
    buzz(18);

    /* retour à l'étape 1, prêt pour le contenant suivant */
    st.scan.c = null;
    var c = $('ocm-sc-c');
    if (c) { c.disabled = false; c.className = 'ocm-in'; c.value = ''; try { c.focus(); } catch (er) { } }
    e.target.disabled = true; e.target.className = 'ocm-in'; e.target.value = '';
    if ($('ocm-n1')) $('ocm-n1').className = 'ocm-num act';
    if ($('ocm-n2')) $('ocm-n2').className = 'ocm-num';
  }

  /* Écriture d'une unité — grille produit OU bloc courrier monté.
     Retourne false et affiche la cause si le produit n'est pas plaçable. */
  function applyOne(pn, col, qte) {
    var leg = getLeg();
    if (!leg) { setStat('✗ Trajet introuvable', 'err'); return false; }
    qte = num(qte) || 1;

    if (pn === '__VIDE__') {
      var kv = 'V-' + col;
      leg.grid[kv] = num(leg.grid[kv]) + qte;
      st.lastOp = { kind: 'grid', key: kv, qte: qte };
      commit(); return true;
    }

    if (COUR_ROUTE[pn]) {
      var row = COUR_ROUTE[pn];
      var r = cRow(leg, row);
      if (row === 'KUBc') {
        r.total = num(r.total) + qte;
        st.lastOp = { kind: 'cour', row: row, field: 'total', qte: qte };
      } else {
        var mapCol = { PAL: 'palc', CE30: 'ce30c', CV300: 'cv300c', CP: 'palc', KUB: 'palc' };
        var f = mapCol[col] || 'palc';
        r[f] = num(r[f]) + qte;
        st.lastOp = { kind: 'cour', row: row, field: f, qte: qte };
      }
      commit(); return true;
    }

    var P = PROD(), pi = P.indexOf(pn);
    if (pi === -1) { setStat('✗ « ' + pn + ' » absent de la grille produits', 'err'); return false; }
    var k = pi + '-' + col;
    leg.grid[k] = num(leg.grid[k]) + qte;
    st.lastOp = { kind: 'grid', key: k, qte: qte };
    commit(); return true;
  }

  function commit() {
    saveDB();
    _lastRaw = ODB().getItem(DBK);
    renderFlux(); renderKPIs(); renderVoybar(); renderModeCounts();
  }

  function undoLast() {
    if (!st.lastOp) { toast('Rien à annuler', 'err'); return; }
    var leg = getLeg(), op = st.lastOp;
    if (op.kind === 'grid') {
      var n = num(leg.grid[op.key]) - op.qte;
      if (n > 0) leg.grid[op.key] = n; else delete leg.grid[op.key];
    } else if (op.kind === 'cour') {
      var r = cRow(leg, op.row);
      r[op.field] = Math.max(0, num(r[op.field]) - op.qte);
    }
    st.lastOp = null;
    commit();
    toast('⤺ Dernière saisie annulée', 'ok');
  }

  function validateLeg() {
    var leg = getLeg();
    if (!leg) return;
    var tot = legPleins(leg) + legVides(leg) + courTotal(leg);
    if (!tot) { toast('Rien à valider sur ce trajet', 'err'); return; }
    leg.done = true;
    if (!leg.etabli) leg.etabli = agentName();
    if (!leg.h) leg.h = new Date().toTimeString().slice(0, 5);
    commit();
    flush();
    toast('✓ ' + (st.mode === 'dep' ? 'Départ' : 'Arrivée') + ' ' + st.voy + ' validé — ' + tot + ' contenants', 'ok');
    resetScan(false);
  }

  function agentName() {
    try {
      var p = JSON.parse(localStorage.getItem('olympe_profil') || '{}');
      if (p && p.prenom) return p.prenom;
    } catch (e) { }
    return '';
  }

  /* ═══════════════ 10. SAISIE MANUELLE ═══════════════ */

  function fillManual() {
    var mp = $('ocm-mp'), mc = $('ocm-mc');
    if (!mp || !mc) return;
    var P = PROD(), h = '';
    P.forEach(function (p) { h += '<option value="' + esc(p) + '">' + esc(p) + '</option>'; });
    h += '<option value="BAK">Courrier monté — BAK</option>';
    h += '<option value="KÉ7">Courrier monté — KÉ7</option>';
    h += '<option value="KUB Courrier">Courrier monté — KUB</option>';
    h += '<option value="__VIDE__">▸ VIDE (matériel vide)</option>';
    if (mp.innerHTML !== h) mp.innerHTML = h;
    var hc = CT.map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
    if (mc.innerHTML !== hc) mc.innerHTML = hc;
  }

  function manualAdd() {
    var mp = $('ocm-mp'), mc = $('ocm-mc'), mq = $('ocm-mq');
    if (!mp || !mc || !mq) return;
    var pn = mp.value, col = mc.value, q = num(mq.value);
    if (!pn || !col) { toast('Produit et contenant requis', 'err'); return; }
    if (q < 1) { toast('Quantité invalide', 'err'); return; }
    if (applyOne(pn, col, q)) {
      toast('+ ' + q + ' × ' + (pn === '__VIDE__' ? 'VIDE' : pn) + ' en ' + col, 'ok');
      mq.value = 1;
    }
  }

  /* ═══════════════ 11. RENDU ═══════════════ */

  function toast(msg, kind) {
    var t = $('ocm-toast'); if (!t) return;
    t.textContent = msg;
    t.className = 'on' + (kind ? ' ' + kind : '');
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.className = ''; }, 2600);
  }

  function setMode(m) {
    if (st.mode === m) return;
    st.mode = m;
    var ov = $('ocm-ov');
    if (ov) ov.classList.toggle('arr', m === 'arr');
    var bd = $('ocm-m-dep'), ba = $('ocm-m-arr');
    if (bd) { bd.classList.toggle('on', m === 'dep'); bd.setAttribute('aria-pressed', m === 'dep' ? 'true' : 'false'); }
    if (ba) { ba.classList.toggle('on', m === 'arr'); ba.setAttribute('aria-pressed', m === 'arr' ? 'true' : 'false'); }
    var h = $('ocm-scan-h');
    if (h) h.textContent = m === 'dep' ? 'Flashage douchette — chargement départ' : 'Flashage douchette — déchargement arrivée';
    st.lastOp = null;
    resetScan(false);
    render();
  }

  function renderVoybar() {
    var bar = $('ocm-voybar'); if (!bar) return;
    var day = gDay(), h = '<span class="ocm-vlab">Voyage</span>';
    for (var i = 1; i <= 6; i++) {
      var leg = day.voy[i] ? day.voy[i][st.mode] : null;
      var q = leg ? (legPleins(leg) + legVides(leg) + courTotal(leg)) : 0;
      h += '<button class="ocm-voy' + (i === st.voy ? ' on' : '') + '" type="button" data-voy="' + i + '">' +
        (st.mode === 'dep' ? 'Départ ' : 'Arrivée ') + i +
        (q ? ' · ' + q : '') +
        (leg && leg.done ? '<span class="dot"></span>' : '') + '</button>';
    }
    bar.innerHTML = h;
    Array.prototype.forEach.call(bar.querySelectorAll('.ocm-voy'), function (b) {
      b.addEventListener('click', function () {
        st.voy = num(b.getAttribute('data-voy')) || 1;
        st.lastOp = null;
        resetScan(false);
        render();
      });
    });
  }

  function renderModeCounts() {
    var day = gDay();
    ['dep', 'arr'].forEach(function (m) {
      var n = 0, done = 0;
      for (var i = 1; i <= 6; i++) {
        var leg = day.voy[i] ? day.voy[i][m] : null;
        if (!leg) continue;
        n += legPleins(leg) + legVides(leg) + courTotal(leg);
        if (leg.done) done++;
      }
      var e = $('ocm-cnt-' + m);
      if (e) e.textContent = n ? (n + ' contenants · ' + done + '/6 validés') : 'aucune saisie';
    });
  }

  /* Carte KPI générique */
  function kCard(key, title, value, unit, color, chips, delay) {
    var prev = _kpiCache[key];
    var pop = (prev != null && prev !== value) ? ' pop' : '';
    _kpiCache[key] = value;
    return '<div class="ocm-k" style="--kc:' + color + ';--d:' + (delay || 0) + 'ms">' +
      '<div class="kt">' + esc(title) + '</div>' +
      '<div class="kv' + pop + '">' + esc(String(value)) + '</div>' +
      (unit ? '<div class="ku">' + esc(unit) + '</div>' : '') +
      (chips && chips.length ? '<div class="ocm-chips">' + chips.map(function (c) {
        return '<span class="ocm-chip">' + esc(c) + '</span>';
      }).join('') + '</div>' : '') +
      '</div>';
  }

  /* Ce qui est réellement entré dans le camion — uniquement le flashé */
  function renderFlux() {
    var box = $('ocm-flux'); if (!box) return;
    var leg = getLeg();
    var lines = legLines(leg);

    /* regroupement par produit */
    var byProd = {}, order = [];
    lines.forEach(function (l) {
      var key = l.prod;
      if (!byProd[key]) { byProd[key] = { total: 0, cols: {} }; order.push(key); }
      byProd[key].total += l.qte;
      byProd[key].cols[l.col] = (byProd[key].cols[l.col] || 0) + l.qte;
    });

    /* courrier monté */
    var cm = [];
    if (leg) {
      var bak = courContent(leg, 'BAK'), ke7 = courContent(leg, 'KE7'), kub = kubcTot(leg);
      if (bak) cm.push({ n: 'BAK', q: bak });
      if (ke7) cm.push({ n: 'KÉ7', q: ke7 });
      if (kub) cm.push({ n: 'KUB Courrier', q: kub });
    }

    var title = st.mode === 'dep'
      ? 'Entré dans le camion — Départ ' + st.voy
      : 'Reçu du camion — Arrivée ' + st.voy;

    if (!order.length && !cm.length) {
      box.innerHTML = '<div class="ocm-card enter"><div class="ocm-h">' + esc(title) + '</div>' +
        '<div class="ocm-empty"><span class="big">📦</span>Aucun contenant flashé sur ce trajet.<br>' +
        'Flashe un contenant puis son produit, ou utilise la saisie manuelle.</div></div>';
      return;
    }

    var d = 0, h = '<div class="ocm-card enter"><div class="ocm-h">' + esc(title) + '</div><div class="ocm-grid">';

    /* produits pleins d'abord, VIDE en dernier */
    order.filter(function (p) { return p !== '__VIDE__'; }).forEach(function (p) {
      var o = byProd[p];
      var chips = CT.filter(function (c) { return o.cols[c]; })
        .map(function (c) { return c + ' · ' + o.cols[c]; });
      h += kCard('fx-' + p, p, o.total, 'contenants', pcol(p), chips, d); d += 45;
    });
    cm.forEach(function (x) {
      h += kCard('fx-cm-' + x.n, x.n + ' (courrier monté)', x.q, 'contenu', PCOL['BAK'], [], d); d += 45;
    });
    if (byProd['__VIDE__']) {
      var v = byProd['__VIDE__'];
      var vch = CT.filter(function (c) { return v.cols[c]; }).map(function (c) { return c + ' · ' + v.cols[c]; });
      h += kCard('fx-vide', 'VIDE — matériel', v.total, 'contenants vides', VIDE_COL, vch, d);
    }
    h += '</div></div>';
    box.innerHTML = h;
  }

  /* Tous les KPI de synthèse */
  function renderKPIs() {
    var box = $('ocm-kpis'); if (!box) return;
    var leg = getLeg();
    var dj = departJour(st.date);
    var pe = prioEcoOf(st.date);
    var vd = videOf(st.date);
    var wk = weekDays(st.date);

    var h = '';

    /* ── 1. totaux départ ── */
    h += '<div class="ocm-card enter" style="--d:60ms"><div class="ocm-h">' +
      (st.mode === 'dep' ? 'Totaux départ camion' : 'Totaux arrivée camion') +
      '</div><div class="ocm-tot">';
    h += kCard('t-leg', (st.mode === 'dep' ? 'Départ ' : 'Arrivée ') + st.voy, legPleins(leg), 'contenants pleins', '#0E4194', [], 0);
    h += kCard('t-cour', 'Courrier monté', courTotal(leg), 'contenu · trajet en cours', '#8B5CF6', [], 40);
    h += kCard('t-jour', 'Total départs du jour', dj.pleins, dj.rotations + ' rotation' + (dj.rotations > 1 ? 's' : '') + ' validée' + (dj.rotations > 1 ? 's' : ''), '#0E4194', [], 80);
    h += kCard('t-vide', 'Vide revenu du jour', vd.total, 'contenants vides',
      VIDE_COL, CT.filter(function (c) { return vd[c]; }).map(function (c) { return c + ' · ' + vd[c]; }), 120);
    h += '</div></div>';

    /* ── 2. PRIO / ECO du jour ── */
    h += '<div class="ocm-card enter" style="--d:110ms"><div class="ocm-h">CTOC / BTOC du jour — ' + esc(fmtDate(st.date)) + '</div><div class="ocm-tot">';
    h += kCard('pe-cp', 'CTOC PRIO', pe['CTOC PRIO'], 'contenants', '#0E4194', [], 0);
    h += kCard('pe-ce', 'CTOC ECO', pe['CTOC ECO'], 'contenants', '#009841', [], 40);
    h += kCard('pe-bp', 'BTOC PRIO', pe['BTOC PRIO'], 'contenants', '#0E4194', [], 80);
    h += kCard('pe-be', 'BTOC ECO', pe['BTOC ECO'], 'contenants', '#009841', [], 120);
    h += '</div></div>';

    /* ── 3. calendrier de la semaine ── */
    h += '<div class="ocm-card enter" style="--d:160ms"><div class="ocm-h">Semaine — CTOC / BTOC (prio + éco) par contenant</div>';
    h += '<div class="ocm-wkwrap"><table class="ocm-wk"><thead><tr>' +
      '<th style="background:var(--acc)">Jour</th>' +
      '<th class="ct">CTOC CP</th><th class="ct">CTOC CE30</th><th class="ct">CTOC CV300</th>' +
      '<th class="bt">BTOC CP</th><th class="bt">BTOC CE30</th><th class="bt">BTOC CV300</th>' +
      '<th style="background:#0F0F0F">Total</th></tr></thead><tbody>';

    var sum = { cCP: 0, cCE: 0, cCV: 0, bCP: 0, bCE: 0, bCV: 0, t: 0 };
    wk.forEach(function (d) {
      var r = ctocBtocOf(d.iso);
      var tot = r.CTOC.CP + r.CTOC.CE30 + r.CTOC.CV300 + r.BTOC.CP + r.BTOC.CE30 + r.BTOC.CV300;
      sum.cCP += r.CTOC.CP; sum.cCE += r.CTOC.CE30; sum.cCV += r.CTOC.CV300;
      sum.bCP += r.BTOC.CP; sum.bCE += r.BTOC.CE30; sum.bCV += r.BTOC.CV300; sum.t += tot;
      function cell(n) { return '<td class="' + (n ? '' : 'z') + '">' + (n || '–') + '</td>'; }
      h += '<tr' + (d.iso === st.date ? ' class="now"' : '') + '>' +
        '<td class="d">' + d.lab + ' ' + d.jour + '</td>' +
        cell(r.CTOC.CP) + cell(r.CTOC.CE30) + cell(r.CTOC.CV300) +
        cell(r.BTOC.CP) + cell(r.BTOC.CE30) + cell(r.BTOC.CV300) +
        '<td style="font-weight:900">' + (tot || '–') + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td class="d">Total</td>' +
      '<td>' + sum.cCP + '</td><td>' + sum.cCE + '</td><td>' + sum.cCV + '</td>' +
      '<td>' + sum.bCP + '</td><td>' + sum.bCE + '</td><td>' + sum.bCV + '</td>' +
      '<td>' + sum.t + '</td></tr></tfoot></table></div></div>';

    box.innerHTML = h;
  }

  function fmtDate(iso) {
    var p = String(iso || '').split('-');
    return p.length === 3 ? (p[2] + '/' + p[1] + '/' + p[0]) : iso;
  }

  function render() {
    loadH();
    fillManual();
    renderVoybar();
    renderModeCounts();
    renderFlux();
    renderKPIs();
    var di = $('ocm-date');
    if (di && di.value !== st.date) di.value = st.date;
  }

  /* ═══════════════ 12. DASHBOARD GILLOT — aller / retour ═══════════════ */

  function openDashboard() {
    var back = $('ocm-back');
    try {
      if (global.OlympeDashboard && typeof global.OlympeDashboard.open === 'function') {
        global.OlympeDashboard.open();
        if (back) back.classList.add('on');
        return;
      }
    } catch (e) { }
    toast('✗ Dashboard indisponible sur ce poste', 'err');
  }
  function closeDashboard() {
    try { if (global.OlympeDashboard && global.OlympeDashboard.close) global.OlympeDashboard.close(); } catch (e) { }
    var back = $('ocm-back'); if (back) back.classList.remove('on');
    render();
  }
  /* Si le dashboard se ferme par son propre bouton, on retire le nôtre */
  global.addEventListener('message', function (e) {
    if (!e || !e.data || e.data.type !== 'olympe-close-app') return;
    var back = $('ocm-back'); if (back) back.classList.remove('on');
    if (st.open) render();
  });

  /* ═══════════════ 13. OUVERTURE / FERMETURE ═══════════════ */

  function open() {
    buildShell();
    loadH(); loadDB();
    _lastRaw = ODB().getItem(DBK);
    st.date = todayISO();
    st.open = true;
    var ov = $('ocm-ov');
    if (ov) { ov.classList.add('on'); ov.classList.toggle('arr', st.mode === 'arr'); }
    document.body.style.overflow = 'hidden';
    resetScan(false);
    render();
    setTimeout(function () { var c = $('ocm-sc-c'); if (c) { try { c.focus(); } catch (e) { } } }, 340);
  }

  function close() {
    st.open = false;
    var ov = $('ocm-ov'); if (ov) ov.classList.remove('on');
    var back = $('ocm-back'); if (back) back.classList.remove('on');
    document.body.style.overflow = '';
    flush();
  }

  /* ═══════════════ 14. API PUBLIQUE ═══════════════ */

  global.olympeOpenCamion = function (btn) {
    try {
      if (global.OlympeHubLoader && global.OlympeHubLoader.show) {
        global.OlympeHubLoader.show('Camion');
        setTimeout(function () {
          try { open(); } finally { if (global.OlympeHubLoader.hide) global.OlympeHubLoader.hide(); }
        }, 200);
        return;
      }
    } catch (e) { }
    open();
  };

  global.OlympeCamionApp = {
    open: open,
    close: close,
    refresh: function () { if (st.open) { loadH(); loadDB(); render(); } },
    mode: function (m) { if (m === 'dep' || m === 'arr') setMode(m); return st.mode; },
    voyage: function (n) { n = num(n); if (n >= 1 && n <= 6) { st.voy = n; render(); } return st.voy; },
    state: function () { return { mode: st.mode, voy: st.voy, date: st.date, open: st.open }; },
    /* Diagnostic : vérifie qu'un code-barres est reconnu par le moteur */
    test: function (code) {
      loadH();
      return { contenant: detC(code), produit: resP(code) };
    }
  };

})(window);
