/* ═══════════════════════════════════════════════════════════════════════════
 * 0LYMPE — Configuration Supabase
 * ───────────────────────────────────────────────────────────────────────────
 * REMPLIS LES DEUX LIGNES CI-DESSOUS. C'est le SEUL fichier à éditer.
 *
 * Où trouver les valeurs :
 *   Supabase Dashboard → Project Settings → API
 *     • Project URL         → OLYMPE_CFG.url
 *     • Project API keys → anon / public → OLYMPE_CFG.anonKey
 *
 * ⚠ L'anon key est PUBLIQUE par conception : elle est faite pour vivre dans
 *   le JS du navigateur. Elle ne donne accès à RIEN sans un JWT valide,
 *   parce que le RLS est actif sur toutes les tables (voir supabase/schema.sql).
 *   Ne JAMAIS mettre la `service_role` key ici : celle-là contourne le RLS.
 * ═══════════════════════════════════════════════════════════════════════════ */
window.OLYMPE_CFG = {

  url:     'https://eedvljmmvsxrcwhclfpg.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlZHZsam1tdnN4cmN3aGNsZnBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0OTgzMDcsImV4cCI6MjEwMDA3NDMwN30.Tmf3pchljBcjHpg5NzyJFA_gQPuYiKZqfwTjEYG5krA',

  /* Domaine des e-mails synthétiques. Les agents ne tapent JAMAIS d'e-mail :
     ils saisissent leur identifiant ("cedric"), le code construit
     "cedric@0lympe.local". Aucune vraie adresse La Poste n'est stockée. */
  emailDomain: '0lympe.local',

  /* File d'attente d'écriture si le réseau tombe (localStorage, pas IndexedDB).
     true  = une coupure réseau ne fait perdre AUCUNE saisie (recommandé)
     false = 100 % en ligne, une coupure = saisie perdue */
  offlineQueue: true,

  /* Debounce d'envoi vers Supabase (ms). 800 = confortable au scan de sacs. */
  pushDebounce: 800,

  /* Logs détaillés dans la console (à laisser false en production) */
  debug: false
};
