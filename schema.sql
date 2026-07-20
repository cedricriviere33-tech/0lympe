-- ═══════════════════════════════════════════════════════════════════════════
--  0LYMPE — Schéma Supabase (PIC Gillot Import)
--  À exécuter UNE FOIS dans : Supabase Dashboard → SQL Editor → New query
--  Idempotent : ré-exécutable sans casse.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. PROFILS AGENTS
--    Un profil est lié 1:1 à un compte auth.users. Le rôle vit ICI (base),
--    plus jamais dans le JS : un agent ne peut pas se promouvoir admin.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.profile (
  id         uuid primary key references auth.users(id) on delete cascade,
  uid        text unique not null,                    -- 'cedric' — identifiant de connexion
  nom        text not null,                           -- 'Cédric' — affiché dans le hub
  role       text not null default 'agent' check (role in ('agent','admin')),
  actif      boolean not null default true,
  created_at timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. DONNÉES MÉTIER
--    1 ligne = 1 ENTRÉE (une session CP84, un jour PPI, une clôture…).
--    JAMAIS un blob entier : c'est ce qui empêche deux agents de s'écraser.
--    Suppression = tombstone (deleted=true), jamais un DELETE :
--    sinon une suppression est « ressuscitée » par la synchro suivante.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.olympe_entry (
  scope      text not null,                           -- 'olympe_histo_sac'
  entry_id   text not null,                           -- '2026-07-07_11h45'
  payload    jsonb,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'system',
  primary key (scope, entry_id)
);

create index if not exists idx_entry_scope   on public.olympe_entry (scope);
create index if not exists idx_entry_updated on public.olympe_entry (updated_at desc);

-- ───────────────────────────────────────────────────────────────────────────
-- 3. HELPERS DE RÔLE
--    security definer : contourne le RLS de `profile`, sinon les policies de
--    `profile` qui interrogent `profile` partent en récursion infinie.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profile
                   where id = auth.uid() and actif = true), 'anon');
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() = 'admin';
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. AUTO-CRÉATION DU PROFIL À LA CRÉATION D'UN COMPTE
--    Dashboard → Authentication → Add user, avec User Metadata :
--      { "uid": "jeremie", "nom": "Jérémie", "role": "agent" }
--    → la ligne profile est créée toute seule.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profile (id, uid, nom, role)
  values (
    new.id,
    lower(coalesce(new.raw_user_meta_data->>'uid',  split_part(new.email, '@', 1))),
    coalesce(new.raw_user_meta_data->>'nom',  initcap(split_part(new.email, '@', 1))),
    case when coalesce(new.raw_user_meta_data->>'role','agent') = 'admin'
         then 'admin' else 'agent' end
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────────────────────────────────────────────────────────
-- 5. HORODATAGE SERVEUR (jamais l'horloge du poste — elle peut être fausse)
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.touch_updated()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists t_entry_touch on public.olympe_entry;
create trigger t_entry_touch before update on public.olympe_entry
  for each row execute function public.touch_updated();

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. RLS — LA VRAIE SÉCURITÉ
--    Sans JWT valide : 0 ligne. Le HTML servi par Netlify est une coquille
--    vide, il n'y a rien à voler dedans.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.profile      enable row level security;
alter table public.olympe_entry enable row level security;

-- ── profile ──────────────────────────────────────────────────────────────
drop policy if exists "profile_select_auth"  on public.profile;
drop policy if exists "profile_write_admin"  on public.profile;
drop policy if exists "profile_self_update"  on public.profile;

-- Tout agent connecté voit la liste des agents (badge, panneau admin).
-- Le rôle `anon` n'a AUCUNE policy → la liste des agents n'est pas publique.
create policy "profile_select_auth" on public.profile
  for select to authenticated using (true);

-- Seul un admin crée / modifie / désactive un profil.
create policy "profile_write_admin" on public.profile
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── olympe_entry ─────────────────────────────────────────────────────────
drop policy if exists "entry_select_auth"  on public.olympe_entry;
drop policy if exists "entry_insert_auth"  on public.olympe_entry;
drop policy if exists "entry_update_auth"  on public.olympe_entry;
drop policy if exists "entry_delete_admin" on public.olympe_entry;

create policy "entry_select_auth" on public.olympe_entry
  for select to authenticated using (true);

create policy "entry_insert_auth" on public.olympe_entry
  for insert to authenticated
  with check (auth.uid() is not null and public.my_role() <> 'anon');

create policy "entry_update_auth" on public.olympe_entry
  for update to authenticated
  using (public.my_role() <> 'anon') with check (public.my_role() <> 'anon');

-- Purge physique réservée à l'admin (le flux normal = tombstone deleted=true).
create policy "entry_delete_admin" on public.olympe_entry
  for delete to authenticated using (public.is_admin());

-- ───────────────────────────────────────────────────────────────────────────
-- 7. REALTIME — propagation instantanée entre postes
-- ───────────────────────────────────────────────────────────────────────────
do $$
begin
  alter publication supabase_realtime add table public.olympe_entry;
exception when duplicate_object then null;
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 8. VÉRIFICATION
-- ───────────────────────────────────────────────────────────────────────────
select tablename,
       rowsecurity                       as rls_actif,
       (select count(*) from pg_policies p where p.tablename = t.tablename) as policies
from pg_tables t
where schemaname = 'public' and tablename in ('profile','olympe_entry');
-- Attendu : profile → rls_actif=true, policies=2
--           olympe_entry → rls_actif=true, policies=4
