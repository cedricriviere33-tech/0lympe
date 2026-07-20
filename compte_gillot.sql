-- ═══════════════════════════════════════════════════════════════════════════
-- 0LYMPE — compte UNIQUE partagé : gillot / gillot974 (admin)
-- À lancer dans Supabase → SQL Editor → Run.
-- ═══════════════════════════════════════════════════════════════════════════
create extension if not exists pgcrypto with schema extensions;

do $$
declare
  v_id    uuid := gen_random_uuid();
  v_email text := 'gillot@0lympe.local';
begin
  if exists (select 1 from auth.users where email = v_email) then
    raise notice 'Le compte gillot existe déjà.';
  else
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
      extensions.crypt('gillot974', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('uid','gillot','nom','Gillot','role','admin'),
      now(), now()
    );
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_id, v_id::text,
      jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    );
    raise notice 'Compte gillot créé.';
  end if;
end $$;

-- Vérif : gillot doit apparaître, role admin
select uid, nom, role, actif from public.profile where uid = 'gillot';

-- ─────────────────────────────────────────────────────────────────────────
-- (OPTIONNEL) Une fois que tu t'es connecté avec gillot et que ça marche,
-- supprime tous les comptes individuels pour ne garder que gillot :
-- ─────────────────────────────────────────────────────────────────────────
-- delete from auth.users
-- where email like '%@0lympe.local' and email <> 'gillot@0lympe.local';
