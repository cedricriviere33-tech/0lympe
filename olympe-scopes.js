/* ═══════════════════════════════════════════════════════════════════════════
 * 0LYMPE — Référentiel de synchronisation
 * build scopes-2026-09-21-SCOPES7
 *
 * UNE définition de SCOPES, CUMULATIVE, MIRROR et des adaptateurs, et UN
 * chargeur. Chargé par olympe-store.js, dashboard_gillot.html et
 * dashboard-direction.html.
 *
 * ── POURQUOI CE FICHIER EXISTE ────────────────────────────────────────────
 * Ces listes vivaient en trois exemplaires recopiés à la main. Elles avaient
 * divergé, et les écarts ne se voyaient pas à l'écran :
 *
 *   · hermes_camion_v3 figurait dans le CUMULATIVE du Dashboard Gillot mais
 *     pas dans son SCOPES. Le dashboard ne chargeait donc jamais les données
 *     Camion depuis Supabase — la carte « COLIS MONTÉS CAMION » restait vide
 *     sur tout poste qui n'avait pas produit la saisie lui-même.
 *
 *   · Même chose pour olympe_reexped_v1, olympe_histo_maritime,
 *     olympe_histo_mrd, maurice, mayotte, chronopost : lus par le code du
 *     dashboard, absents de sa liste de chargement.
 *
 *   · Le commentaire du dashboard affirmait que hermes_mrd_histo et
 *     hermes_uld_histo n'étaient pas synchronisés. C'était vrai jusqu'au
 *     17/09 et faux depuis — une copie ne se met pas à jour toute seule.
 *
 * Le carnet appelle ça le footgun SCOPES ≠ MANAGED_KEYS. Il s'était
 * reproduit une couche plus haut, entre fichiers au lieu d'entre listes.
 *
 * ── LA RÈGLE QUI NE DOIT JAMAIS ÊTRE OUBLIÉE ──────────────────────────────
 * SCOPES et CUMULATIVE bougent ENSEMBLE. Ajouter une clé à SCOPES sans
 * l'ajouter à CUMULATIVE est le scénario exact de l'incident de juillet : au
 * premier chargement d'un poste qui n'a pas tout en cache, le différentiel
 * émet un marqueur de suppression sur chaque entrée absente, et l'historique
 * est détruit pour tout le monde. verifier() contrôle ce couplage à chaque
 * chargement de page.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var BUILD = 'scopes-2026-09-21-SCOPES7';

  /* ── Clés synchronisées par Supabase ───────────────────────────────────
     Alignée sur MANAGED_KEYS d'Olympe, MOINS olympe_auth_v1 (les hashes de
     mots de passe n'ont rien à faire dans une table lisible par tous les
     agents) et olympe_extra_users (remplacé par la table profile). */
  var SCOPES = [
    'hermes_gillot_v4',
    'olympe_histo_ppi', 'olympe_histo_sac', 'olympe_histo_cabine',
    'olympe_histo_maritime', 'olympe_histo_anomalie', 'olympe_histo_vgp',
    'olympe_histo_mrd', 'olympe_histo_maurice', 'olympe_histo_mayotte',
    'olympe_histo_chronopost',
    'olympe_ano_list', 'olympe_vgp_list', 'olympe_nouveautes',
    'olympe_lab_v1', 'hermes_camion_v3', 'olympe_consommable_v1',
    'olympe_reexped_v1', 'olympe_rescon_v1', 'olympe_vols_v1', 'olympe_ata_v1',
    'olympe_mrd_releve_v1', 'olympe_rules_v1',
    'olympe_ctoc_v1', 'olympe_camstock_v1', 'olympe_finposte_v1',
    'olympe_dash_msg_v1', 'olympe_jsa_obj_v1', 'olympe_dash_obj_v1',
    'olympe_tv_locked',
    'olympe_planning_v1', 'olympe_agenda_v1', 'olympe_pensebete_v1',
    'hermes_uld_histo', 'hermes_mrd_histo',
    /* ── Ajouté le 20/09 ───────────────────────────────────────────────
       Résumé du jour publié par l'onglet Camion : rotations, contenants
       pleins et vides, produits montés, stock. Les dashboards le LISENT au
       lieu de recalculer les rotations chacun de leur côté — une seule
       computation, donc un seul endroit où elle peut être fausse. */
    'olympe_camion_kpi_v1',
    /* ── Ajouté le 21/09 ───────────────────────────────────────────────
       Espace bien-être : humeurs du jour, mur de l'équipe, défi de la
       semaine, coups de cœur. C'est un fil collaboratif — plusieurs agents
       y écrivent le même jour depuis des postes différents, donc il lui
       faut un adaptateur fin (voir ADAPTERS) et le mode cumulatif. */
    'olympe_bienetre_v1',
    /* Messages de l'équipe affichés au clic sur le logo. Chaque annonce
       est une entrée à part (adaptateur « a: »), sinon deux agents qui
       publient dans la même minute s'écraseraient — et une annonce peut
       porter une photo, donc on ne veut renvoyer que celle qui change. */
    'olympe_annonce_v1'
  ];

  /* ── Scopes CUMULATIFS ─────────────────────────────────────────────────
     Une entrée absente du blob local n'y est JAMAIS effacée : elle est
     restaurée depuis l'ombre. Une clé absente signifie seulement que ce
     poste ne l'a pas encore hydratée, surtout pas qu'il faut la détruire
     pour tout le monde. La suppression volontaire passe par
     OlympeStore.forget(). */
  var CUMULATIVE = [
    'hermes_gillot_v4', 'olympe_histo_ppi', 'olympe_histo_sac',
    'olympe_histo_cabine', 'olympe_histo_maritime', 'olympe_histo_anomalie',
    'olympe_histo_vgp', 'olympe_histo_mrd', 'olympe_histo_maurice',
    'olympe_histo_mayotte', 'olympe_histo_chronopost', 'olympe_mrd_releve_v1',
    'hermes_camion_v3', 'olympe_reexped_v1',
    'hermes_uld_histo', 'hermes_mrd_histo',
    /* Une entrée par jour : un poste qui n'a pas tout en cache ne doit jamais
       faire disparaître les journées qu'il ignore. */
    'olympe_camion_kpi_v1',
    /* Un message du mur publié depuis le PC ne doit pas disparaître parce
       qu'un poste mobile, qui ne l'a pas encore hydraté, enregistre une
       humeur. La suppression volontaire passe par le registre « x: » de
       l'adaptateur, jamais par l'absence. */
    'olympe_bienetre_v1',
    /* Cumulatif comme le bien-être : un message retiré du blob local
       serait restauré depuis l'ombre. Toute suppression passe donc par
       le registre « x: » de l'adaptateur. */
    'olympe_annonce_v1'
  ];

  /* ── Miroir localStorage ───────────────────────────────────────────────
     Clés que les iframes lisent en localStorage direct. olympe_rules_v1 en
     est volontairement absent : il contient des images en base64 et ferait
     sauter le plafond de 5 Mo. */
  var MIRROR = [
    'olympe_histo_anomalie', 'olympe_histo_vgp', 'olympe_histo_ppi',
    'olympe_histo_sac', 'olympe_histo_mrd', 'olympe_histo_cabine',
    'olympe_histo_maritime', 'olympe_ano_list', 'olympe_vgp_list',
    'olympe_rescon_v1', 'olympe_reexped_v1', 'olympe_vols_v1', 'olympe_ata_v1',
    'olympe_dash_msg_v1', 'olympe_jsa_obj_v1', 'olympe_dash_obj_v1',
    'olympe_tv_locked'
  ];

  /* ── Libellés lisibles ─────────────────────────────────────────────────
     Le nom affiché de chaque base. Cette table vivait en trois exemplaires
     (le hub, la recherche de colis, OlympeCode) ; un historique ajouté n'en
     recevait qu'un, et apparaissait sous sa clé technique ailleurs. */
  var LIBELLES = {
    hermes_gillot_v4: 'Hermès — Brief Gillot',
    hermes_camion_v3: 'Camion', hermes_uld_histo: 'Hermès — ULD',
    hermes_mrd_histo: 'Hermès — MRD',
    olympe_histo_ppi: 'Relevé PPI', olympe_histo_sac: 'Sac CP84',
    olympe_histo_cabine: 'Pointage Cabine', olympe_histo_maritime: 'Maritime Mayotte',
    olympe_histo_anomalie: 'Anomalies', olympe_histo_vgp: 'VGP',
    olympe_histo_mrd: 'MRD', olympe_histo_maurice: 'Maurice',
    olympe_histo_mayotte: 'Mayotte', olympe_histo_chronopost: 'Chronopost',
    olympe_ano_list: 'Anomalies — liste', olympe_vgp_list: 'VGP — liste',
    olympe_mrd_releve_v1: 'Relevé MRD', olympe_reexped_v1: 'Réexpédition CP84',
    olympe_rescon_v1: 'RESCON secours', olympe_lab_v1: 'Laboratoire',
    olympe_consommable_v1: 'Suivi consommable', olympe_rules_v1: 'Règles & Process',
    olympe_vols_v1: 'Vols', olympe_ata_v1: 'Jours sans ATA',
    olympe_camion_kpi_v1: 'Camion — résumé du jour',
    olympe_bienetre_v1: 'Espace bien-être',
    olympe_annonce_v1: 'Messages de l\u2019équipe'
  };
  function libelle(scope) { return LIBELLES[scope] || scope; }

  /* Les bases qui contiennent des colis scannés : c'est là qu'on cherche un
     code. Dérivée de SCOPES, donc un historique ajouté est fouillé sans que
     personne n'ait à y penser. */
  function scopesHistoriques() {
    return SCOPES.filter(function (k) { return k.indexOf('olympe_histo_') === 0; });
  }

  var NEVER_SYNC = ['olympe_auth_v1', 'olympe_extra_users'];

  /* ── Sous-ensemble affiché par les dashboards ──────────────────────────
     Les dashboards ne chargent pas tout : olympe_rules_v1 porte des images
     en base64, et le Lab, l'agenda, les post-it et le planning ne sont
     affichés nulle part chez eux. Cette liste est ici, à côté de SCOPES,
     pour qu'elle ne puisse plus diverger en silence — verifier() contrôle
     que chacune de ses entrées existe bien dans SCOPES. */
  var POUR_DASHBOARD = [
    'hermes_gillot_v4', 'hermes_camion_v3',
    'hermes_uld_histo', 'hermes_mrd_histo',
    'olympe_histo_ppi', 'olympe_histo_sac', 'olympe_histo_cabine',
    'olympe_histo_maritime', 'olympe_histo_anomalie', 'olympe_histo_vgp',
    'olympe_histo_mrd', 'olympe_histo_maurice', 'olympe_histo_mayotte',
    'olympe_histo_chronopost',
    'olympe_ano_list', 'olympe_vgp_list',
    'olympe_mrd_releve_v1', 'olympe_reexped_v1', 'olympe_ata_v1',
    'olympe_ctoc_v1', 'olympe_camstock_v1', 'olympe_finposte_v1',
    'olympe_dash_msg_v1', 'olympe_jsa_obj_v1', 'olympe_dash_obj_v1',
    'olympe_camion_kpi_v1'
  ];

  /* ═══ Adaptateurs blob ↔ lignes ══════════════════════════════════════════
     Olympe stocke 1 clé = 1 gros JSON. Synchroniser ce blob tel quel ferait
     que le dernier setItem écrase le travail de l'autre. On éclate donc en
     lignes (scope, entry_id) et le merge est fait par la clé primaire
     Postgres, pas par un algorithme maison. */
  var DEFAULT_ADAPTER = {
    split: function (o) {
      if (o === null || typeof o !== 'object' || Array.isArray(o)) return { _all: o };
      var out = {};
      Object.keys(o).forEach(function (k) { out[k] = o[k]; });
      return out;
    },
    join: function (e) {
      var ks = Object.keys(e);
      if (ks.length === 1 && ks[0] === '_all') return e._all;
      var o = {};
      ks.forEach(function (k) { o[k] = e[k]; });
      return o;
    }
  };

  var ADAPTERS = {
    /* Hermès : 1 ligne = 1 journée. Sans ça, deux agents sur deux jours
       différents du Brief s'écraseraient. */
    hermes_gillot_v4: {
      split: function (o) {
        o = (o && typeof o === 'object') ? o : {};
        var out = {}, root = {};
        Object.keys(o).forEach(function (k) { if (k !== 'dates') root[k] = o[k]; });
        out._root = root;
        var d = o.dates || {};
        Object.keys(d).forEach(function (day) { out['d:' + day] = d[day]; });
        return out;
      },
      join: function (e) {
        var o = {};
        Object.keys(e._root || {}).forEach(function (k) { o[k] = e._root[k]; });
        o.dates = {};
        Object.keys(e).forEach(function (id) {
          if (id.indexOf('d:') === 0) o.dates[id.slice(2)] = e[id];
        });
        return o;
      }
    },
    /* Relevé MRD : 1 ligne = 1 palette relevée → fusion fine PC ↔ mobile.
       ── Registre de suppression (lignes « x:<signature> »), ajouté le 20/09
       Une palette effacée revenait, par deux chemins indépendants :
         · importHermes() relit hermes_mrd_histo à chaque ouverture de la
           modale et réinsère toute signature absente — donc justement celle
           que l'agent venait d'effacer ;
         · le scope est CUMULATIF : une entrée simplement absente du blob est
           restaurée depuis l'ombre au prochain hydrate.
       Effacer localement ne pouvait donc rien effacer durablement. La
       suppression est désormais un FAIT PUBLIÉ, au même titre que la saisie :
       elle voyage avec le scope, et elle vaut pour tous les postes.
       Sans ce split, le registre resterait dans le blob local et serait perdu
       au premier aller-retour — l'ancien adaptateur ne publiait que « e: ». */
    olympe_mrd_releve_v1: {
      split: function (o) {
        o = (o && typeof o === 'object') ? o : {};
        var out = {};
        (Array.isArray(o.entries) ? o.entries : []).forEach(function (e) {
          if (e && e.id) out['e:' + e.id] = e;
        });
        var sup = (o.supprimes && typeof o.supprimes === 'object') ? o.supprimes : {};
        Object.keys(sup).forEach(function (s) { if (s) out['x:' + s] = 1; });
        return out;
      },
      join: function (e) {
        var entries = [], supprimes = {};
        Object.keys(e).forEach(function (id) {
          if (id.indexOf('e:') === 0 && e[id]) entries.push(e[id]);
          else if (id.indexOf('x:') === 0) supprimes[id.slice(2)] = 1;
        });
        entries.sort(function (a, b) {
          return String((b && b.ts) || '').localeCompare(String((a && a.ts) || ''));
        });
        return { entries: entries, supprimes: supprimes };
      }
    }
,
    /* Espace bien-être : 1 ligne = 1 fait élémentaire.
       Avec l'adaptateur par défaut, tout le mur ne ferait qu'UNE ligne :
       deux agents qui publient dans la même minute depuis deux postes, et
       le second écrase le message du premier. Même chose pour les humeurs
       et les réactions. On éclate donc au grain du fait :

         _meta        le défi de la semaine (un seul à la fois, le dernier
                      écrivain gagne — c'est voulu)
         m:<id>       un message du mur, sans ses réactions
         r:<id>|<e>|<agent>  une réaction (1 agent, 1 emoji, 1 message)
         x:<id>       une suppression PUBLIÉE — indispensable, le scope
                      étant cumulatif, un message simplement absent serait
                      restauré depuis l'ombre au prochain hydrate
         h:<jour>|<agent>    l'humeur d'un agent pour une journée
         f:<idx>|<agent>     un coup de cœur sur une citation            */

    /* ── Messages de l'équipe ───────────────────────────────────────────
       Le fil affiché au clic sur le logo Olympe. Au grain du message :

         _meta        version du format, rien d'autre
         a:<id>       une annonce complète (texte, photo, vocal, auteur)
         x:<id>       une suppression PUBLIÉE — le scope étant cumulatif,
                      une annonce simplement absente serait restaurée

       Aucune date n'est calculée ici : chaque annonce porte son propre
       horodatage. Une valeur dérivée de l'horloge rendrait la
       recomposition non déterministe, donc republiée à chaque
       hydratation, sans fin — le défaut trouvé sur le bien-être. */
    olympe_annonce_v1: {
      split: function (o) {
        o = (o && typeof o === 'object') ? o : {};
        var out = { _meta: { v: o.v || 1 } };
        (Array.isArray(o.items) ? o.items : []).forEach(function (it) {
          if (it && it.id) out['a:' + it.id] = it;
        });
        var sup = (o.supprimes && typeof o.supprimes === 'object') ? o.supprimes : {};
        Object.keys(sup).forEach(function (id) { if (id) out['x:' + id] = sup[id] || 1; });
        return out;
      },
      join: function (e) {
        var supprimes = {}, items = [];
        Object.keys(e).forEach(function (k) {
          if (k.indexOf('x:') === 0) supprimes[k.slice(2)] = e[k] || 1;
        });
        Object.keys(e).forEach(function (k) {
          if (k.indexOf('a:') !== 0) return;
          var id = k.slice(2), v = e[k];
          if (supprimes[id] || !v || typeof v !== 'object') return;   /* effacé = jamais ressuscité */
          items.push(v);
        });
        items.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
        var meta = e._meta || {};
        return { v: meta.v || 1, items: items, supprimes: supprimes };
      }
    },

    olympe_bienetre_v1: {
      split: function (o) {
        o = (o && typeof o === 'object') ? o : {};
        var out = { _meta: { defi: o.defi || null } };

        (Array.isArray(o.mur) ? o.mur : []).forEach(function (m) {
          if (!m || !m.id) return;
          out['m:' + m.id] = { id: m.id, auteur: m.auteur, emoji: m.emoji, txt: m.txt, ts: m.ts };
          var re = (m.react && typeof m.react === 'object') ? m.react : {};
          Object.keys(re).forEach(function (e) {
            (Array.isArray(re[e]) ? re[e] : []).forEach(function (a) {
              if (a) out['r:' + m.id + '|' + e + '|' + a] = 1;
            });
          });
        });

        var sup = (o.supprimes && typeof o.supprimes === 'object') ? o.supprimes : {};
        Object.keys(sup).forEach(function (id) { if (id) out['x:' + id] = sup[id] || 1; });

        var mo = (o.mood && typeof o.mood === 'object') ? o.mood : {};
        Object.keys(mo).forEach(function (j) {
          var agents = mo[j] || {};
          Object.keys(agents).forEach(function (a) { out['h:' + j + '|' + a] = agents[a]; });
        });

        var fa = (o.fav && typeof o.fav === 'object') ? o.fav : {};
        Object.keys(fa).forEach(function (idx) {
          (Array.isArray(fa[idx]) ? fa[idx] : []).forEach(function (a) {
            if (a) out['f:' + idx + '|' + a] = 1;
          });
        });
        return out;
      },
      join: function (e) {
        var meta = e._meta || {};
        var supprimes = {}, parId = {}, react = {}, mood = {}, fav = {};

        Object.keys(e).forEach(function (id) {
          if (id.indexOf('x:') === 0) supprimes[id.slice(2)] = e[id] || 1;
        });

        Object.keys(e).forEach(function (id) {
          var v = e[id], p;
          if (id.indexOf('m:') === 0) {
            var mid = id.slice(2);
            if (!supprimes[mid] && v) parId[mid] = v;          /* effacé = jamais ressuscité */
          } else if (id.indexOf('r:') === 0) {
            p = id.slice(2).split('|');
            if (p.length === 3 && !supprimes[p[0]]) {
              (react[p[0]] = react[p[0]] || {});
              (react[p[0]][p[1]] = react[p[0]][p[1]] || []).push(p[2]);
            }
          } else if (id.indexOf('h:') === 0) {
            p = id.slice(2).split('|');
            if (p.length === 2 && v) (mood[p[0]] = mood[p[0]] || {})[p[1]] = v;
          } else if (id.indexOf('f:') === 0) {
            p = id.slice(2).split('|');
            if (p.length === 2) (fav[p[0]] = fav[p[0]] || []).push(p[1]);
          }
        });

        var mur = Object.keys(parId).map(function (id) {
          var m = parId[id];
          m.react = react[id] || {};
          return m;
        }).sort(function (a, b) { return (Number(b && b.ts) || 0) - (Number(a && a.ts) || 0); });

        /* `maj` doit être DÉRIVÉ des données, jamais de l'horloge : un join
           qui rend un blob différent à chaque appel serait vu « modifié » à
           chaque hydratation, et republié en boucle. C'est le même piège que
           l'ordre des clés jsonb, une ligne plus bas dans ce fichier. */
        var maj = 0;
        function plusRecent(t) { t = Number(t) || 0; if (t > maj) maj = t; }
        mur.forEach(function (m) { plusRecent(m && m.ts); });
        Object.keys(mood).forEach(function (j) {
          Object.keys(mood[j]).forEach(function (a) { plusRecent(mood[j][a] && mood[j][a].ts); });
        });
        Object.keys(supprimes).forEach(function (k) { plusRecent(supprimes[k]); });
        plusRecent(meta.defi && meta.defi.ts);

        return { mood: mood, mur: mur, defi: meta.defi || null,
                 fav: fav, supprimes: supprimes, maj: maj };
      }
    }
  };

  function adapterFor(scope) { return ADAPTERS[scope] || DEFAULT_ADAPTER; }

  /* ═══ Sérialisation canonique ════════════════════════════════════════════
     jsonb ne conserve pas l'ordre des clés. Sans tri, tout reviendrait
     « modifié » après le premier chargement. */
  function canon(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    var ks = Object.keys(v).sort();
    return '{' + ks.map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  }

  /* ═══ LE CHARGEUR — une seule implémentation ═════════════════════════════
     Deux pièges que chaque copie devait éviter séparément, et que les deux
     dashboards n'évitaient pas :

       1. PAGINATION. PostgREST plafonne une réponse à 1000 lignes et ne
          signale rien : au-delà, on reçoit un jeu tronqué qui a l'air
          complet. Les deux dashboards lisaient sans .range() — leurs
          chiffres étaient donc partiels dès que la table dépassait ce
          seuil, sans qu'aucun écran ne le dise.

       2. LIGNES SUPPRIMÉES. Une suppression est un marqueur (deleted=true,
          payload null), jamais un DELETE — sinon un autre poste la
          ressusciterait au chargement suivant. Il faut donc filtrer
          deleted=false à la lecture. Les deux dashboards ne filtraient pas :
          une session supprimée par un administrateur continuait de peser
          dans leurs compteurs.

     Une seule fonction, utilisée par les trois fichiers. */
  function charger(SB, scopes, options) {
    options = options || {};
    var PAGE = options.page || 1000;
    var rows = [], from = 0;

    function requete() {
      var q = SB.from('olympe_entry').select('scope,entry_id,payload').eq('deleted', false);
      if (scopes && scopes.length) q = q['in']('scope', scopes);
      return q.order('scope', { ascending: true })
        .order('entry_id', { ascending: true })
        .range(from, from + PAGE - 1)
        .then(function (r) {
          if (r && r.error) throw r.error;
          var lot = r.data || [];
          rows = rows.concat(lot);
          /* Un lot plein signifie qu'il reste probablement des lignes. On
             continue jusqu'à un lot incomplet — c'est la seule fin de
             pagination fiable, le total n'étant pas renvoyé. */
          if (lot.length === PAGE) { from += PAGE; return requete(); }
          return null;
        });
    }

    return requete().then(function () {
      var parScope = {};
      rows.forEach(function (r) {
        (parScope[r.scope] = parScope[r.scope] || {})[r.entry_id] = r.payload;
      });
      return { rows: rows, parScope: parScope, pages: Math.ceil(rows.length / PAGE) || 1 };
    });
  }

  /* Recompose le blob d'un scope depuis ses lignes. */
  function recomposer(parScope, scope) {
    return JSON.stringify(adapterFor(scope).join(parScope[scope] || {}));
  }

  /* ═══ Contrôle d'intégrité ═══════════════════════════════════════════════
     Tourne à chaque chargement de page. Une liste incohérente est la cause
     racine des deux pertes de données qu'a connues le projet ; elle doit se
     voir tout de suite, pas le jour où un historique disparaît. */
  function verifier() {
    var pb = [];
    function absent(liste, nom) {
      liste.forEach(function (k) {
        if (SCOPES.indexOf(k) < 0) pb.push(nom + ' contient « ' + k +' », absent de SCOPES');
      });
    }
    absent(CUMULATIVE, 'CUMULATIVE');
    absent(MIRROR, 'MIRROR');
    absent(POUR_DASHBOARD, 'POUR_DASHBOARD');

    function doublons(liste, nom) {
      var vus = {};
      liste.forEach(function (k) {
        if (vus[k]) pb.push(nom + ' contient « ' + k + ' » en double');
        vus[k] = true;
      });
    }
    doublons(SCOPES, 'SCOPES');
    doublons(CUMULATIVE, 'CUMULATIVE');
    doublons(POUR_DASHBOARD, 'POUR_DASHBOARD');

    NEVER_SYNC.forEach(function (k) {
      if (SCOPES.indexOf(k) >= 0) pb.push('« ' + k + ' » est à la fois dans SCOPES et NEVER_SYNC');
    });

    if (pb.length) {
      try { console.error('[olympe-scopes] référentiel incohérent :\n  · ' + pb.join('\n  · ')); } catch (e) {}
    }
    return pb;
  }

  global.OlympeScopes = {
    BUILD: BUILD,
    SCOPES: SCOPES,
    CUMULATIVE: CUMULATIVE,
    MIRROR: MIRROR,
    NEVER_SYNC: NEVER_SYNC,
    LIBELLES: LIBELLES, libelle: libelle, scopesHistoriques: scopesHistoriques,
    POUR_DASHBOARD: POUR_DASHBOARD,
    DEFAULT_ADAPTER: DEFAULT_ADAPTER,
    ADAPTERS: ADAPTERS,
    adapterFor: adapterFor,
    canon: canon,
    charger: charger,
    recomposer: recomposer,
    verifier: verifier,
    estCumulatif: function (scope) { return CUMULATIVE.indexOf(scope) >= 0; },
    estScope: function (scope) { return SCOPES.indexOf(scope) >= 0; }
  };

  verifier();
  try { console.info('[olympe-scopes] ' + BUILD + ' — ' + SCOPES.length + ' scopes, ' + CUMULATIVE.length + ' cumulatifs'); } catch (e) {}
})(window);
