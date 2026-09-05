/* ═══════════════════════════════════════════════════════════════════════════
   0LYMPE — OlympeCode : moteur central de reconnaissance des codes-barres
   ───────────────────────────────────────────────────────────────────────────
   POURQUOI : chaque application embarquait sa propre fonction parseCode.
   Cinq variantes divergentes cohabitaient (majuscules ou non, dépêche sur
   4 ou 8 caractères, type détecté dans une seule). Un même code pouvait donc
   être lu différemment selon l'écran de saisie.

   CE FICHIER est la référence unique : toutes les apps l'utilisent, ce qui
   garantit une lecture identique partout et rend les historiques comparables.

   API :
     OlympeCode.parse(code)            → objet normalisé
     OlympeCode.type(code)             → 'PRIO' | 'ECO' | 'CP84' | 'OO' | 'OS' | '?'
     OlympeCode.pays(code)             → pays d'origine (via la table PORTS)
     OlympeCode.estDoublon(code, liste)→ true si déjà scanné
     OlympeCode.ajouter(code, liste)   → { ok, raison, item }
     OlympeCode.stats(liste)           → totaux par type, poids, dépêches, pays
   ═══════════════════════════════════════════════════════════════════════════ */
(function (G) {
  'use strict';

  /* ── Normalisation : un même code doit toujours donner la même clé ────── */
  function nettoie(code) {
    return String(code == null ? '' : code).replace(/\s+/g, '').toUpperCase();
  }

  /* ── Pays d'origine : s'appuie sur la table PORTS déjà présente ───────── */
  function pays(code) {
    var raw = nettoie(code);
    var P = G.PORTS || {};
    if (typeof G.getPort === 'function') {
      try { var r = G.getPort(raw); if (r && r !== raw) return r; } catch (e) {}
    }
    // Essais du plus précis au plus large : code complet, 6 puis 2 caractères
    if (P[raw]) return P[raw];
    if (raw.length >= 6 && P[raw.slice(0, 6)]) return P[raw.slice(0, 6)];
    if (raw.length >= 2 && P[raw.slice(0, 2)]) return P[raw.slice(0, 2)];
    return null;
  }

  /* ── Type de flux ─────────────────────────────────────────────────────
     Règles issues des formats réellement observés à Gillot. Toute règle
     non vérifiée renvoie '?' plutôt qu'une supposition : mieux vaut une
     valeur inconnue qu'un comptage faux.                                  */
  function type(code) {
    var raw = nettoie(code);
    if (!raw) return '?';
    if (typeof G.classify === 'function') {                 // règle métier existante
      try { var c = G.classify(raw); if (c && c !== '?') return c; } catch (e) {}
    }
    if (/^C[A-Z]{2}/.test(raw) || /PRIO/.test(raw)) return 'PRIO';
    if (/^[EU][A-Z]{2}/.test(raw) || /ECO/.test(raw))  return 'ECO';
    if (/CP84/.test(raw)) return 'CP84';
    if (/^OO/.test(raw))  return 'OO';
    if (/^OS/.test(raw))  return 'OS';
    return '?';
  }

  /* ── Découpage : dépêche, poids ───────────────────────────────────────
     Les codes longs (≥20) portent la dépêche en positions 16-20.
     Les codes courts n'ont pas ce champ : on prend le préfixe.            */
  function parse(code) {
    var raw = nettoie(code);
    var depeche = raw.length >= 20 ? raw.slice(16, 20) : (raw.slice(0, 4) || '????');
    var digits = raw.replace(/[^0-9]/g, '');
    var poids = digits.length >= 4 ? parseInt(digits.slice(-4), 10) / 10 : null;
    return {
      code:     raw,
      depeche:  depeche,
      sousType: raw.length >= 15 ? raw.slice(12, 15) : '',
      port:     pays(raw),
      pays:     pays(raw),
      poids:    poids,
      type:     type(raw),
      valide:   raw.length >= 4,
      scanneA:  new Date().toISOString()
    };
  }

  /* ── Doublons ─────────────────────────────────────────────────────────
     Compare sur le code normalisé : un scan répété est détecté même si la
     douchette ajoute des espaces ou change la casse.                       */
  function cle(x) { return nettoie(typeof x === 'string' ? x : (x && (x.code || x.cb || x.barcode)) || ''); }

  function estDoublon(code, liste) {
    var k = nettoie(code);
    if (!k || !Array.isArray(liste)) return false;
    for (var i = 0; i < liste.length; i++) if (cle(liste[i]) === k) return true;
    return false;
  }

  /* Ajout contrôlé : refuse les doublons et les codes trop courts. */
  function ajouter(code, liste, options) {
    var o = options || {};
    var raw = nettoie(code);
    if (!raw) return { ok: false, raison: 'vide' };
    if (raw.length < 4) return { ok: false, raison: 'code trop court' };
    if (!Array.isArray(liste)) liste = [];
    if (!o.autoriserDoublon && estDoublon(raw, liste)) {
      return { ok: false, raison: 'doublon', item: parse(raw) };
    }
    var item = parse(raw);
    if (o.palette) item.palette = String(o.palette);
    liste.push(item);
    return { ok: true, item: item, total: liste.length };
  }

  /* ── Suivi par palette ────────────────────────────────────────────────
     Regroupe les colis scannés par palette : utile pour retrouver un colis
     et pour repérer un même code présent sur deux palettes différentes.    */
  function parPalette(liste) {
    var out = {};
    (liste || []).forEach(function (it) {
      var p = (it && it.palette) || 'sans palette';
      if (!out[p]) out[p] = { palette: p, colis: [], poids: 0 };
      out[p].colis.push(it);
      out[p].poids += (parseFloat(it && it.poids) || 0);
    });
    return Object.keys(out).map(function (k) { return out[k]; })
      .sort(function (a, b) { return b.colis.length - a.colis.length; });
  }

  /* Un même code sur plusieurs palettes = anomalie à signaler. */
  function doublonsEntrePalettes(liste) {
    var vu = {}, out = [];
    (liste || []).forEach(function (it) {
      var k = cle(it); if (!k) return;
      var p = (it && it.palette) || '—';
      if (vu[k] && vu[k] !== p) out.push({ code: k, palettes: [vu[k], p] });
      else vu[k] = p;
    });
    return out;
  }

  /* ── Statistiques ─────────────────────────────────────────────────────── */
  function stats(liste) {
    var r = { total: 0, poids: 0, types: {}, depeches: {}, pays: {}, inconnus: 0 };
    (liste || []).forEach(function (it) {
      if (!it) return;
      var d = (typeof it === 'string') ? parse(it) : it;
      r.total++;
      r.poids += (parseFloat(d.poids) || 0);
      var t = d.type || '?';
      r.types[t] = (r.types[t] || 0) + 1;
      if (t === '?') r.inconnus++;
      if (d.depeche) r.depeches[d.depeche] = (r.depeches[d.depeche] || 0) + 1;
      var p = d.pays || d.port;
      if (p) r.pays[p] = (r.pays[p] || 0) + 1;
    });
    r.poids = Math.round(r.poids * 10) / 10;
    r.nbDepeches = Object.keys(r.depeches).length;
    r.nbPays = Object.keys(r.pays).length;
    return r;
  }

  /* ── Recherche transverse ─────────────────────────────────────────────
     Retrouve un colis dans TOUS les historiques : réponse immédiate à
     « où est passé ce colis ? » sans ouvrir chaque application.            */
  var SCOPES = ['olympe_histo_ppi', 'olympe_histo_sac', 'olympe_histo_cabine',
    'olympe_histo_maritime', 'olympe_histo_anomalie', 'olympe_histo_mrd',
    'olympe_histo_vgp', 'olympe_histo_maurice', 'olympe_histo_mayotte',
    'olympe_histo_chronopost'];

  var NOMS = {
    olympe_histo_ppi: 'Relevé PPI', olympe_histo_sac: 'Sac CP84',
    olympe_histo_cabine: 'Cabine', olympe_histo_maritime: 'Maritime',
    olympe_histo_anomalie: 'Anomalies', olympe_histo_mrd: 'MRD',
    olympe_histo_vgp: 'VGP', olympe_histo_maurice: 'Maurice',
    olympe_histo_mayotte: 'Mayotte', olympe_histo_chronopost: 'Chronopost'
  };

  function lire(k) {
    try { return JSON.parse((G.OlympeDB || localStorage).getItem(k) || '{}'); }
    catch (e) { return {}; }
  }

  function chercher(code) {
    var k = nettoie(code), res = [];
    if (!k) return res;
    SCOPES.forEach(function (scope) {
      var raw = lire(scope);
      Object.keys(raw).forEach(function (sessionKey) {
        var sess = raw[sessionKey];
        var list = (sess && (sess.items || sess.detail || sess.sacs)) || [];
        if (!Array.isArray(list)) return;
        list.forEach(function (it) {
          if (cle(it) === k) {
            res.push({
              application: NOMS[scope] || scope,
              scope: scope,
              session: sessionKey,
              date: (sess && sess.date) || String(sessionKey).slice(0, 10),
              item: it
            });
          }
        });
      });
    });
    return res;
  }

  G.OlympeCode = {
    version: '1.0',
    nettoie: nettoie,
    parse: parse,
    type: type,
    pays: pays,
    estDoublon: estDoublon,
    ajouter: ajouter,
    parPalette: parPalette,
    doublonsEntrePalettes: doublonsEntrePalettes,
    stats: stats,
    chercher: chercher,
    scopes: SCOPES,
    noms: NOMS
  };

  try { console.info('[0lympe] OlympeCode 1.0 — reconnaissance centralisée'); } catch (e) {}
})(typeof window !== 'undefined' ? window : this);
