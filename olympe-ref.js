/* ═══════════════════════════════════════════════════════════════════════════
 * 0LYMPE — Référentiel métier unique
 * build ref-2026-09-21-REF2
 *
 * UNE définition des compagnies, contenants, types d'ULD, flux et produits.
 * Chargé avant olympe-scopes.js, donc disponible pour tout le reste.
 *
 * ── POURQUOI CE FICHIER EXISTE ────────────────────────────────────────────
 * Le même inventaire vivait en une vingtaine d'exemplaires recopiés à la
 * main dans index2.html. Ils avaient divergé, et les écarts ne se voyaient
 * pas à l'écran — c'est le footgun SCOPES ≠ MANAGED_KEYS, une couche plus
 * haut : entre tables métier au lieu d'entre listes de synchronisation.
 *
 *   · TYPES D'ULD. L'étiquettage connaissait ALF mais ni UMC ni MANUEL ;
 *     Hermès connaissait UMC et MANUEL mais pas ALF. Un ULD saisi dans une
 *     app était donc d'un type inconnu dans l'autre.
 *
 *   · COULEURS DE COMPAGNIE. Cinq compagnies, mais QUATRE valeurs
 *     différentes pour Corsair (#E67E22, #c99700, #C98A00, #d4af00), trois
 *     pour French Bee, deux pour Air Austral et Air France. Selon l'écran,
 *     la même compagnie n'avait pas la même couleur — exactement ce qui
 *     empêche de la reconnaître d'un coup d'œil.
 *
 *   · FLUX. L'onglet ULD proposait « Courrier », les stats RESCON ne le
 *     connaissaient pas : un ULD de ce flux n'apparaissait nulle part.
 *
 *   · CODES PRODUIT. La table à 6 caractères (douchette) et celle à 5
 *     (étiquette) ne couvraient pas le même inventaire : « Douane » et
 *     « PPI OS Roissy » n'existaient que dans l'une, « BAK » et « KÉ7 »
 *     que dans l'autre.
 *
 * ── LA RÈGLE ──────────────────────────────────────────────────────────────
 * Une entité métier se déclare ICI et nulle part ailleurs. Un écran qui a
 * besoin d'une couleur, d'un libellé ou d'un code le DEMANDE au référentiel.
 * verifier() tourne à chaque chargement de page et signale toute incohérence
 * — codes en double, trous, renvois vers des entités inexistantes.
 *
 * ── CE QUE LE RÉFÉRENTIEL NE FAIT PAS ─────────────────────────────────────
 * Il ne remplace aucun moteur de lecture existant (detCStrict, uldReco,
 * camScP, OlympeCode). Ceux-ci gardent leur algorithme ; ils lisent
 * simplement les mêmes tables. Remplacer un algorithme de reconnaissance en
 * même temps qu'on centralise ses données, ce serait mélanger deux risques.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var BUILD = 'ref-2026-09-21-REF2';

  /* ══ COMPAGNIES ══════════════════════════════════════════════════════════
     couleur  : teinte principale, celle de la marque
     couleur2 : teinte claire, pour les dégradés d'en-tête
     agent    : agent de piste qui traite la compagnie à Gillot
     alias    : ce qu'un agent peut taper ou ce qu'un import peut contenir */
  var COMPAGNIES = [
    { iata:'UU', nom:'Air Austral',   agent:'RAA',    couleur:'#E4002B', couleur2:'#FF5765', alias:['austral','reunion','réunion','uu'] },
    { iata:'AF', nom:'Air France',    agent:'RAA',    couleur:'#0055A4', couleur2:'#2E8BE0', alias:['france','af'] },
    { iata:'SS', nom:'Corsair',       agent:'SAMSIC', couleur:'#C98A00', couleur2:'#E8B93F', alias:['corsairfly','corsair fly','ss'] },
    { iata:'BF', nom:'French Bee',    agent:'SAMSIC', couleur:'#00A0D2', couleur2:'#4FC3E8', alias:['frenchbee','french bee','bee','bf'] },
    { iata:'MK', nom:'Air Mauritius', agent:'RAA',    couleur:'#8E44AD', couleur2:'#B07CC6', alias:['mauritius','maurice','mk'] }
  ];

  /* ══ CONTENANTS ══════════════════════════════════════════════════════════
     chiffre  : dernier caractère du code douchette (…340 → 4 → KUB)
     suffixes : formes acceptées en fin de code produit (CTOCPRCE → CE30)
     stock    : entre dans le stock de contenants vides. La palette n'y est
                pas : elle repart avec le camion, on ne la stocke pas.
     atlas    : libellé attendu par l'export ATLAS, qui dit PALET, pas PAL. */
  var CONTENANTS = [
    { code:'CP',    label:'CP',      chiffre:'1', suffixes:['CP'],           stock:true,  atlas:'CP' },
    { code:'CE30',  label:'CE30',    chiffre:'2', suffixes:['CE','CE30'],    stock:true,  atlas:'CE30' },
    { code:'CV300', label:'CV300',   chiffre:'3', suffixes:['CV','CV300'],   stock:true,  atlas:'CV300' },
    { code:'KUB',   label:'KUB',     chiffre:'4', suffixes:['KU','KUB'],     stock:true,  atlas:'KUB' },
    { code:'PAL',   label:'Palette', chiffre:null, suffixes:['PA','PAL'],    stock:false, atlas:'PALET' }
  ];

  /* ══ TYPES D'ULD ═════════════════════════════════════════════════════════
     Union des deux listes qui avaient divergé. Chaque type porte enfin la
     même définition des deux côtés. */
  var ULD = [
    { code:'AKE',    label:'AKE',    famille:'conteneur', couleur:'#0047BB' },
    { code:'AKN',    label:'AKN',    famille:'conteneur', couleur:'#00A0D2' },
    { code:'PMC',    label:'PMC',    famille:'palette',   couleur:'#E8710A' },
    { code:'PAG',    label:'PAG',    famille:'palette',   couleur:'#F2A900' },
    { code:'AMF',    label:'AMF',    famille:'conteneur', couleur:'#7B3FA0' },
    { code:'AAF',    label:'AAF',    famille:'conteneur', couleur:'#00857A' },
    { code:'ALF',    label:'ALF',    famille:'conteneur', couleur:'#B3005E' },
    { code:'UMC',    label:'UMC',    famille:'conteneur', couleur:'#4A5D23' },
    { code:'VRAC',   label:'VRAC',   famille:'vrac',      couleur:'#5B6068' },
    { code:'MANUEL', label:'MANUEL', famille:'vrac',      couleur:'#8B4513' }
  ];

  /* ══ FLUX ════════════════════════════════════════════════════════════════
     « Courrier » manquait aux statistiques : il est ici comme les autres. */
  var FLUX = [
    { code:'PRIO',     label:'PRIO',     couleur:'#C0392B' },
    { code:'ECO',      label:'ECO',      couleur:'#0F7A3C' },
    { code:'Courrier', label:'Courrier', couleur:'#64748B' },
    { code:'PPI',      label:'PPI',      couleur:'#0047BB' },
    { code:'MIXTE',    label:'MIXTE',    couleur:'#8E44AD' }
  ];

  /* ══ PRODUITS ════════════════════════════════════════════════════════════
     c6     : code douchette à 6 caractères (null = pas d'étiquette connue)
     c5     : code à 5 caractères (null = idem)
     posHermes / posCamion : RANG dans chacune des deux grilles de saisie.
              Ce ne sont pas des doublons : Hermès saisit 14 produits, le
              Camion en saisit 16 — il ajoute « PPI OS Roissy » et
              « Douane », et donc TOUT ce qui suit est décalé chez lui.
              Les deux grilles stockent par POSITION ('pi-col'), pas par
              libellé : les confondre décalerait les saisies enregistrées
              d'une des deux apps. null = ce produit n'est pas dans la
              grille concernée.
     monte  : courrier monté, qui a son bloc dédié hors grille
     atlas  : regroupement de l'export ATLAS

     Les trous (c5 ou c6 à null) sont RÉELS : ces produits n'ont pas de code
     dans l'un des deux formats. On ne les invente pas — un code qui n'existe
     pas sur une étiquette ferait plus de dégâts qu'un trou déclaré.
     verifier() les liste sans crier : ce sont des constats, pas des fautes. */
  var PRODUITS = [
    { label:'CTOC PRIO',           c6:'CTOCPR', c5:'CTOCP', couleur:'#0E4194', posHermes:0, posCamion:0, monte:false, atlas:'COLIS' },
    { label:'CTOC ECO',            c6:'CTOCEC', c5:'CTOCE', couleur:'#009841', posHermes:1, posCamion:1, monte:false, atlas:'COLIS' },
    { label:'BTOC PRIO',           c6:'BTOCPR', c5:'BTOCP', couleur:'#0E4194', posHermes:2, posCamion:2, monte:false, atlas:'COLIS' },
    { label:'BTOC ECO',            c6:'BTOCEC', c5:'BTOCE', couleur:'#009841', posHermes:3, posCamion:3, monte:false, atlas:'COLIS' },
    { label:'BTOC JAVER',          c6:'BTOCJA', c5:'BTOCJ', couleur:'#00A8A8', posHermes:4, posCamion:4, monte:false, atlas:'COLIS' },
    { label:'Roissy',              c6:'ROISSY', c5:'ROISS', couleur:'#6D5BD0', posHermes:5, posCamion:5, monte:false, atlas:'ROISSY' },
    { label:'Presse',              c6:'PRESSE', c5:'PRESS', couleur:'#E51932', posHermes:6, posCamion:6, monte:false, atlas:'PRESSE' },
    { label:'Cabine',              c6:'CABINE', c5:'CABIN', couleur:'#F59E0B', posHermes:7, posCamion:7, monte:false, atlas:'CABINE' },
    { label:'Inter OO',            c6:'PPIOO',  c5:'PPIOO', couleur:'#0891B2', posHermes:8, posCamion:8, monte:false, atlas:'INTER OO / OS' },
    { label:'Inter OS',            c6:'PPIOS',  c5:'PPIOS', couleur:'#0EA5A5', posHermes:9, posCamion:9, monte:false, atlas:'INTER OO / OS' },
    { label:'Singapour',           c6:'SINGAP', c5:'SINGA', couleur:'#DB2777', posHermes:10, posCamion:11, monte:false, atlas:null },
    { label:'Fausse direction',    c6:'FAUDIR', c5:'FAUDI', couleur:'#EA580C', posHermes:11, posCamion:13, monte:false, atlas:'ANOMALIE / FAUSSE D.' },
    { label:'Anomalie colis',      c6:'ANOMAL', c5:'ANOMA', couleur:'#DC2626', posHermes:12, posCamion:14, monte:false, atlas:'ANOMALIE / FAUSSE D.' },
    { label:'Courrier à ventiler', c6:'COURAV', c5:'COURA', couleur:'#64748B', posHermes:13, posCamion:15, monte:false, atlas:null },
    { label:'KUB Courrier',        c6:'COUKUB', c5:'COUKU', couleur:'#8B5CF6', posHermes:null, posCamion:null, monte:true,  atlas:'PAL. COURRIER / KOB', contenantImpose:'KUB', routeCourrier:'KUBc' },
    { label:'BAK',                 c6:'PALBAK', c5:null,    couleur:'#8B5CF6', posHermes:null, posCamion:null, monte:true,  atlas:'PAL. COURRIER / KOB', routeCourrier:'BAK' },
    { label:'KÉ7',                 c6:'PALKE7', c5:null,    couleur:'#8B5CF6', posHermes:null, posCamion:null, monte:true,  atlas:'PAL. COURRIER / KOB', routeCourrier:'KE7' },
    { label:'PPI OS Roissy',       c6:null,     c5:'PPIRO', couleur:'#7C3AED', posHermes:null, posCamion:10, monte:false, atlas:'INTER OO / OS' },
    { label:'Douane',              c6:null,     c5:'DOUAN', couleur:'#B45309', posHermes:null, posCamion:12, monte:false, atlas:null }
  ];

  /* Regroupements ATLAS qui ne correspondent à aucun produit de la grille :
     ils existent côté export seulement. Déclarés ici pour que l'export n'ait
     pas sa propre table. */
  var ATLAS_EXTRA = {
    'PRESSE':               ['Kob Presse'],
    'PAL. COURRIER / KOB':  ['Palette Courrier','Kob Courrier'],
    'CE30 / CV300':         ['CE30/CV300']
  };

  /* ══ Index ═══════════════════════════════════════════════════════════════ */
  function norm(v) {
    var t = String(v == null ? '' : v).toLowerCase();
    try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
    return t.replace(/\s+/g, ' ').trim();
  }
  var _iCie = {}, _iProd = {}, _iCont = {}, _iUld = {}, _iFlux = {};
  COMPAGNIES.forEach(function (c) {
    _iCie[norm(c.iata)] = c; _iCie[norm(c.nom)] = c;
    (c.alias || []).forEach(function (a) { _iCie[norm(a)] = c; });
  });
  PRODUITS.forEach(function (p) {
    _iProd[norm(p.label)] = p;
    if (p.c6) _iProd[norm(p.c6)] = p;
    if (p.c5) _iProd[norm(p.c5)] = p;
  });
  CONTENANTS.forEach(function (c) {
    _iCont[norm(c.code)] = c; _iCont[norm(c.label)] = c;
    if (c.chiffre) _iCont['#' + c.chiffre] = c;
    (c.suffixes || []).forEach(function (s) { _iCont[norm(s)] = c; });
  });
  ULD.forEach(function (u) { _iUld[norm(u.code)] = u; });
  FLUX.forEach(function (f) { _iFlux[norm(f.code)] = f; });

  /* ══ Accès ═══════════════════════════════════════════════════════════════ */
  function compagnie(x) { return _iCie[norm(x)] || null; }
  function produit(x)   { return _iProd[norm(x)] || null; }
  function contenant(x) { return _iCont[norm(x)] || null; }
  function contenantParChiffre(d) { return _iCont['#' + String(d)] || null; }
  function typeUld(x)   { return _iUld[norm(x)] || null; }
  function flux(x)      { return _iFlux[norm(x)] || null; }

  /* Rend les produits d'une grille, dans l'ordre de leurs positions. */
  function parGrille(champ) {
    return PRODUITS.filter(function (p) { return p[champ] != null; })
                   .sort(function (a, b) { return a[champ] - b[champ]; })
                   .map(function (p) { return p.label; });
  }

  function liste(quoi, champ) {
    var src = { compagnies: COMPAGNIES, contenants: CONTENANTS, uld: ULD, flux: FLUX, produits: PRODUITS }[quoi] || [];
    return src.map(function (x) { return champ ? x[champ] : x; });
  }
  function table(quoi, cle, valeur) {
    var out = {};
    liste(quoi).forEach(function (x) { if (x[cle] != null) out[x[cle]] = x[valeur]; });
    return out;
  }

  /* ══ Lecture d'un code ═══════════════════════════════════════════════════
     Reconnaît les deux formes en usage sur le site :
       · ULD    « AMF2122SS » → type + numéro + compagnie
       · produit « CTOCPRCP » → produit + contenant (suffixe ou chiffre)
     Rend null si rien n'est sûr : un doute doit remonter à l'agent, pas être
     deviné. Les moteurs existants gardent leur logique — celui-ci sert à
     l'ingestion et à tout nouvel écran. */
  function lire(code) {
    var s = String(code == null ? '' : code).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!s) return null;

    var m = s.match(/^([A-Z]{3})(\d{3,6})([A-Z]{2})$/);
    if (m && typeUld(m[1]) && compagnie(m[3])) {
      return { type:'uld', uld:m[1], numero:m[2], compagnie:compagnie(m[3]).nom,
               agent:compagnie(m[3]).agent, code:s };
    }

    /* Suffixe de contenant : on essaie les formes connues, de la plus longue
       à la plus courte. Une expression gourmande comme /[A-Z]{2,5}$/ ne
       fonctionne pas ici — elle capte cinq lettres et ne revient jamais en
       arrière, puisqu'il n'y a rien après elle à faire échouer. */
    var formes = [];
    CONTENANTS.forEach(function (c) { (c.suffixes || []).forEach(function (x) { formes.push([x, c]); }); });
    formes.sort(function (a, b) { return b[0].length - a[0].length; });
    for (var f = 0; f < formes.length; f++) {
      var sx = formes[f][0];
      if (s.length > sx.length && s.slice(-sx.length) === sx) {
        var p6 = produit(s.slice(0, s.length - sx.length));
        if (p6) return { type:'colis', produit:p6.label, contenant:formes[f][1].code, code:s };
      }
    }
    var mc = s.match(/^([A-Z]{5,6})(\d)$/);
    if (mc) {
      var pr = produit(mc[1]), ct = contenantParChiffre(mc[2]);
      if (pr && ct) return { type:'colis', produit:pr.label, contenant:ct.code, code:s };
    }
    var num = s.match(/^\d+([A-Z]{5,6})(\d)$/);
    if (num) {
      var pr2 = produit(num[1]), ct2 = contenantParChiffre(num[2]);
      if (pr2 && ct2) return { type:'colis', produit:pr2.label, contenant:ct2.code, code:s };
    }
    var seul = produit(s);
    if (seul) return { type:'produit', produit:seul.label, code:s };
    return null;
  }

  /* ══ Contrôle d'intégrité ════════════════════════════════════════════════
     Tourne à chaque chargement. Une table incohérente est la cause racine
     des écarts qu'on vient de résorber : elle doit se voir tout de suite. */
  function verifier() {
    var pb = [], info = [];
    function doublons(liste2, champ, nom) {
      var vus = {};
      liste2.forEach(function (x) {
        var v = x[champ]; if (v == null) return;
        if (vus[v]) pb.push(nom + ' : « ' + v + ' » en double sur ' + champ);
        vus[v] = true;
      });
    }
    doublons(COMPAGNIES, 'iata', 'COMPAGNIES');
    doublons(COMPAGNIES, 'nom', 'COMPAGNIES');
    doublons(CONTENANTS, 'code', 'CONTENANTS');
    doublons(ULD, 'code', 'ULD');
    doublons(FLUX, 'code', 'FLUX');
    doublons(PRODUITS, 'label', 'PRODUITS');
    doublons(PRODUITS, 'c6', 'PRODUITS');
    doublons(PRODUITS, 'c5', 'PRODUITS');

    PRODUITS.forEach(function (p) {
      if (!p.c6 && !p.c5) pb.push('PRODUITS : « ' + p.label + ' » n\'a aucun code, il est inatteignable au scan');
      else if (!p.c6) info.push('« ' + p.label + ' » n\'a pas de code douchette 6 caractères');
      else if (!p.c5) info.push('« ' + p.label + ' » n\'a pas de code étiquette 5 caractères');
      if (p.contenantImpose && !contenant(p.contenantImpose)) {
        pb.push('PRODUITS : « ' + p.label + ' » impose le contenant « ' + p.contenantImpose +' », inconnu');
      }
    });
    COMPAGNIES.forEach(function (c) {
      if (!/^#[0-9A-Fa-f]{6}$/.test(c.couleur)) pb.push('COMPAGNIES : couleur invalide pour ' + c.nom);
      if (['RAA', 'SAMSIC'].indexOf(c.agent) < 0) pb.push('COMPAGNIES : agent inconnu pour ' + c.nom);
    });

    /* ── LE CONTRÔLE QUI COMPTE VRAIMENT ──────────────────────────────────
       Les saisies des deux grilles sont stockées PAR POSITION, pas par
       libellé : rot.g[3] est le quatrième produit de la liste. Réordonner
       une grille, ou y insérer une ligne au milieu, décalerait silencieusement
       toutes les saisies déjà enregistrées — les colis d'un produit
       apparaîtraient sous un autre, sans message d'erreur, sur tout
       l'historique.
       Les deux ordres sont donc figés ici. Pour ajouter un produit à une
       grille : l'ajouter À LA FIN, et allonger la liste figée d'autant.
       Jamais au milieu. */
    var FIGE = {
      'grille Hermès (hermes_gillot_v4)': [parGrille('posHermes'),
        ['CTOC PRIO','CTOC ECO','BTOC PRIO','BTOC ECO','BTOC JAVER','Roissy',
         'Presse','Cabine','Inter OO','Inter OS','Singapour','Fausse direction',
         'Anomalie colis','Courrier \u00e0 ventiler']],
      'grille Camion (hermes_camion_v3)': [parGrille('posCamion'),
        ['CTOC PRIO','CTOC ECO','BTOC PRIO','BTOC ECO','BTOC JAVER','Roissy',
         'Presse','Cabine','Inter OO','Inter OS','PPI OS Roissy','Singapour',
         'Douane','Fausse direction','Anomalie colis','Courrier \u00e0 ventiler']]
    };
    Object.keys(FIGE).forEach(function (nom) {
      var vue = FIGE[nom][0], attendu = FIGE[nom][1];
      if (vue.length < attendu.length) {
        pb.push(nom + ' : ' + vue.length + ' produits au lieu de ' + attendu.length
          + ' — un produit a disparu, les saisies enregistrees seraient decalees');
        return;
      }
      attendu.forEach(function (lab, i) {
        if (vue[i] !== lab) {
          pb.push(nom + ', position ' + i + ' : « ' + vue[i] + ' » au lieu de « ' + lab
            + ' » — l\'ordre a change, les saisies enregistrees seraient decalees');
        }
      });
    });

    if (pb.length) {
      try { console.error('[olympe-ref] référentiel incohérent :\n  · ' + pb.join('\n  · ')); } catch (e) {}
    }
    return { problemes: pb, constats: info };
  }

  /* Propagation vers les iframes : le srcdoc vit dans un autre document, il
     n'a pas ce script. On le lui passe plutôt que d'en charger une copie. */
  function poser(w) {
    try { if (w && !w.OlympeRef) w.OlympeRef = global.OlympeRef; return true; }
    catch (e) { return false; }
  }
  function poserPartout() {
    try {
      document.querySelectorAll('iframe').forEach(function (f) {
        try { poser(f.contentWindow); } catch (e) {}
      });
    } catch (e) {}
  }

  global.OlympeRef = {
    BUILD: BUILD,
    COMPAGNIES: COMPAGNIES, CONTENANTS: CONTENANTS, ULD: ULD,
    FLUX: FLUX, PRODUITS: PRODUITS, ATLAS_EXTRA: ATLAS_EXTRA,
    compagnie: compagnie, produit: produit, contenant: contenant,
    contenantParChiffre: contenantParChiffre, typeUld: typeUld, flux: flux,
    liste: liste, table: table, norm: norm, lire: lire, verifier: verifier,
    poser: poser, poserPartout: poserPartout,

    /* Raccourcis, pour que les écrans n'aient jamais à reconstruire une liste */
    nomsCompagnies:    function () { return liste('compagnies', 'nom'); },
    couleursCompagnies: function () { return table('compagnies', 'nom', 'couleur'); },
    couleurCompagnie:  function (x) { var c = compagnie(x); return c ? c.couleur : '#8a8a8e'; },
    couleurCompagnie2: function (x) { var c = compagnie(x); return c ? c.couleur2 : '#b0b0b5'; },
    agentDe:           function (x) { var c = compagnie(x); return c ? c.agent : ''; },
    codesContenants:   function () { return liste('contenants', 'code'); },
    contenantsStock:   function () { return CONTENANTS.filter(function (c) { return c.stock; }).map(function (c) { return c.code; }); },
    codesUld:          function () { return liste('uld', 'code'); },
    codesFlux:         function () { return liste('flux', 'code'); },
    couleursFlux:      function () { return table('flux', 'code', 'couleur'); },
    /* Couleur d'un type d'ULD, même rôle que couleurCompagnie() : un code
       inconnu rend une teinte neutre plutôt que rien, pour qu'un écran qui
       affiche un type non répertorié reste lisible. */
    couleurUld:        function (x) { var u = typeUld(x); return (u && u.couleur) || '#64748B'; },
    couleursUld:       function () { return table('uld', 'code', 'couleur'); },
    /* Deux grilles, deux ordres — voir le commentaire sur PRODUITS. */
    grilleHermes:      function () { return parGrille('posHermes'); },
    grilleCamion:      function () { return parGrille('posCamion'); },
    /* Ancien nom, conservé : il désignait la grille Hermès. */
    produitsGrille:    function () { return parGrille('posHermes'); },
    produitsMontes:    function () { return PRODUITS.filter(function (p) { return p.monte; }).map(function (p) { return p.label; }); },
    codes6:            function () { return table('produits', 'c6', 'label'); },
    codes5:            function () { return table('produits', 'c5', 'label'); },
    couleursProduits:  function () { return table('produits', 'label', 'couleur'); },
    couleurProduit:    function (x) { var p = produit(x); return p ? p.couleur : '#8a8a8e'; },
    routesCourrier:    function () {
      var o = {};
      PRODUITS.forEach(function (p) { if (p.routeCourrier) o[p.label] = p.routeCourrier; });
      return o;
    },
    atlasParProduit: function () {
      var o = {};
      PRODUITS.forEach(function (p) { if (p.atlas) (o[p.atlas] = o[p.atlas] || []).push(p.label); });
      Object.keys(ATLAS_EXTRA).forEach(function (g) {
        (o[g] = o[g] || []).push.apply(o[g], ATLAS_EXTRA[g]);
      });
      return o;
    },
    atlasContenants: function () { return table('contenants', 'code', 'atlas'); }
  };

  var bilan = verifier();
  try {
    console.info('[olympe-ref] ' + BUILD + ' — ' + COMPAGNIES.length + ' compagnies, '
      + CONTENANTS.length + ' contenants, ' + ULD.length + ' types ULD, '
      + FLUX.length + ' flux, ' + PRODUITS.length + ' produits'
      + (bilan.constats.length ? ' · ' + bilan.constats.length + ' constat(s)' : ''));
  } catch (e) {}
})(window);
