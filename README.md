# 0LYMPE — version simplifiée (compte unique)

Repo à plat (aucun sous-dossier). L'app = `index2.html` ; la page de connexion = `index.html`.

## Compte
Un seul compte partagé : **identifiant `gillot` / mot de passe `gillot974`** (admin).
Pas d'Authenticator, pas de changement de mot de passe dans l'app.
Pour changer le mot de passe : Supabase → Authentication → Users → gillot.

## Déploiement
1. Upload TOUS les fichiers de ce dossier (à plat) sur GitHub → Netlify (Publish directory = `.`).
   ⚠️ Garde ton `_headers` et `netlify.toml` (non fournis ici, Netlify ne les sert pas).
2. Supabase (SQL Editor) → lance **`schema.sql`** puis **`compte_gillot.sql`**.
3. Sécurité : Authentication → Sign In / Providers → Email → décoche
   **"Allow new users to sign up"** (compte admin unique partagé).
4. Connexion : `gillot` / `gillot974` → tu entres direct.

## Fichiers SQL
- `schema.sql` — tables + sécurité (obligatoire).
- `compte_gillot.sql` — crée le compte gillot.

Tout le reste (MFA, bulles agents, création d'agents, changement de mot de passe forcé)
a été retiré pour rester simple. Aucune erreur console.
