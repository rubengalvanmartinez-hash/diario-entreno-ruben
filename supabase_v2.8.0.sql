-- =============================================================================
-- FitLog v2.8.0 — Seguridad: Supabase Auth + Row Level Security
-- Ejecutar ENTERO en el SQL Editor del proyecto: https://fxhkzstvxljlohrlgyyc.supabase.co
--
-- Qué hace:
--   1. Crea un usuario de Supabase Auth por cada fila de `usuarios`, con el MISMO
--      UUID (auth.uid() = usuarios.id = entrenos.usuario_id…). No mueve datos.
--      Email sintético <uuid>@fitlog.invalid: la app no envía correos.
--   2. Saca los hashes SHA-256 antiguos de `usuarios` a un esquema privado (no
--      expuesto por la API) y BORRA la columna `usuarios.password_hash`.
--   3. Activa RLS en las 9 tablas, borra TODAS sus políticas anteriores (p. ej.
--      "anon_all") y crea políticas "dueño o admin" ligadas a auth.uid().
--   4. Quita al rol `anon` todo acceso directo a esas tablas.
--   5. Crea las funciones RPC del login y de la gestión de usuarios:
--        listar_usuarios_login       (anon)  nombres para el desplegable del login
--        comprobar_password_legacy   (anon)  verifica la contraseña antigua (máx. 5 fallos)
--        migrar_password_legacy      (anon)  contraseña antigua → nueva (bcrypt en Auth)
--        activar_cuenta_con_codigo   (anon)  código de un solo uso del admin → contraseña
--        admin_crear_usuario         (admin) crea usuario y devuelve su código de acceso
--        admin_restablecer_acceso    (admin) borra la contraseña, cierra sesiones, nuevo código
--        admin_eliminar_usuario      (admin) borra usuario, sus datos y su cuenta Auth
--
-- Es UNA transacción: si algo falla no se aplica nada. Se puede re-ejecutar.
--
-- DESPUÉS de ejecutarlo:
--   a) Authentication → Sign In / Providers → desactivar "Allow new users to sign up"
--      (los usuarios los crea el admin desde la app). Dejar activado el proveedor Email.
--   b) Desplegar la versión 2.8.0 de la app (las versiones anteriores ya no
--      podrán iniciar sesión).
--   c) Cada usuario, en su primer acceso, escribe su contraseña de siempre y elige
--      una nueva (la antigua estuvo expuesta). Si no la recuerda, el admin pulsa
--      "Restablecer" y le pasa el código que muestra la app.
--   d) Verificar (debe devolver [] o un error, nunca datos):
--        curl "https://fxhkzstvxljlohrlgyyc.supabase.co/rest/v1/usuarios?select=password_hash" \
--          -H "apikey: <clave anon>" -H "Authorization: Bearer <clave anon>"
--
-- Si un admin pierde su contraseña y no hay otro admin, desde este SQL Editor:
--     select privado.restablecer_acceso('<uuid del usuario>');   -- devuelve el código
-- =============================================================================

BEGIN;

-- ── 0. Comprobaciones previas (abortan sin cambiar nada) ─────────────────────

DO $$
DECLARE
  t text;
BEGIN
  IF to_regprocedure('extensions.crypt(text,text)') IS NULL
     OR to_regprocedure('extensions.gen_salt(text,integer)') IS NULL
     OR to_regprocedure('extensions.digest(text,text)') IS NULL
     OR to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
    RAISE EXCEPTION 'pgcrypto no está instalado en el esquema "extensions" (Database → Extensions → pgcrypto)';
  END IF;

  IF NOT (has_table_privilege('auth.users',          'SELECT, INSERT, UPDATE, DELETE')
      AND has_table_privilege('auth.identities',     'SELECT, INSERT, DELETE')
      AND has_table_privilege('auth.sessions',       'DELETE')
      AND has_table_privilege('auth.refresh_tokens', 'DELETE')) THEN
    RAISE EXCEPTION 'El rol % no puede escribir en auth.users/identities/sessions: ejecuta este script desde el SQL Editor del proyecto', current_user;
  END IF;

  IF NOT (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'El rol % no tiene BYPASSRLS (auth.users tiene RLS): ejecuta este script desde el SQL Editor del proyecto', current_user;
  END IF;

  FOREACH t IN ARRAY ARRAY['usuarios','entrenos','registros_peso','composicion_corporal',
    'medidas_corporales','perfil_corporal','ejercicios_usuario','plantilla_ejercicios','equivalencias_gimnasio']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'Falta la tabla public.%', t;
    END IF;
    IF t NOT IN ('usuarios', 'plantilla_ejercicios') AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'usuario_id'
    ) THEN
      RAISE EXCEPTION 'La tabla public.% no tiene columna usuario_id', t;
    END IF;
  END LOOP;
END $$;

-- ── 1. Esquema privado (NO expuesto por la API REST) ─────────────────────────

CREATE SCHEMA IF NOT EXISTS privado;
REVOKE ALL ON SCHEMA privado FROM PUBLIC;
REVOKE ALL ON SCHEMA privado FROM anon;
-- authenticated necesita USAGE solo para evaluar privado.es_admin() dentro de las políticas
GRANT USAGE ON SCHEMA privado TO authenticated;

-- Hashes SHA-256 de la app antigua, pendientes de migrar (se borran al migrar cada usuario)
CREATE TABLE IF NOT EXISTS privado.credenciales_legacy (
  usuario_id        uuid PRIMARY KEY REFERENCES public.usuarios(id) ON DELETE CASCADE,
  password_sha256   text NOT NULL,
  intentos_fallidos int  NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Códigos de acceso de un solo uso (alta de usuario o restablecimiento). Solo se guarda el hash.
CREATE TABLE IF NOT EXISTS privado.codigos_acceso (
  usuario_id        uuid PRIMARY KEY REFERENCES public.usuarios(id) ON DELETE CASCADE,
  codigo_hash       text NOT NULL,
  expira_at         timestamptz NOT NULL,
  intentos_fallidos int  NOT NULL DEFAULT 0,
  creado_por        uuid,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE privado.credenciales_legacy ENABLE ROW LEVEL SECURITY;
ALTER TABLE privado.codigos_acceso      ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA privado FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA privado FROM anon, authenticated;

-- Copiar los hashes antiguos (solo si la columna aún existe: re-ejecución segura)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'usuarios' AND column_name = 'password_hash') THEN
    EXECUTE $q$
      INSERT INTO privado.credenciales_legacy (usuario_id, password_sha256)
      SELECT id, lower(password_hash) FROM public.usuarios
      WHERE password_hash IS NOT NULL AND password_hash <> ''
      ON CONFLICT (usuario_id) DO NOTHING
    $q$;
  END IF;
END $$;

-- ── 2. Funciones internas (privado.*) ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION privado.email_auth(p_id uuid)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_id::text || '@fitlog.invalid'
$$;

CREATE OR REPLACE FUNCTION privado.es_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT u.es_admin FROM public.usuarios u WHERE u.id = auth.uid()), false)
$$;

CREATE OR REPLACE FUNCTION privado.password_valida(p text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  -- bcrypt solo usa los primeros 72 bytes
  SELECT p IS NOT NULL AND char_length(p) >= 8 AND octet_length(p) <= 72
$$;

-- Crea (si no existe) la cuenta de Supabase Auth con el mismo UUID que usuarios.id.
-- Las columnas *_token van a '' (no NULL): GoTrue las lee como string y falla con NULL.
CREATE OR REPLACE FUNCTION privado.crear_usuario_auth(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_email text := privado.email_auth(p_id);
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = p_id) THEN
    RETURN;
  END IF;
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', v_email, '', now(),
    '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), false, false
  );
  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  VALUES (
    p_id::text, p_id,
    jsonb_build_object('sub', p_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    'email', now(), now()
  );
END $$;

CREATE OR REPLACE FUNCTION privado.establecer_password_auth(p_id uuid, p_password text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM privado.crear_usuario_auth(p_id);
  -- Coste 10 = el de GoTrue (con otro coste lo re-hashea en el siguiente login)
  UPDATE auth.users
     SET encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         updated_at = now()
   WHERE id = p_id;
END $$;

-- 'activo' = tiene contraseña en Auth · 'migrar' = puede usar su contraseña antigua
-- 'pendiente' = necesita un código del admin
CREATE OR REPLACE FUNCTION privado.estado_acceso(p_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM auth.users a
                 WHERE a.id = p_id AND coalesce(a.encrypted_password, '') <> '') THEN 'activo'
    WHEN EXISTS (SELECT 1 FROM privado.credenciales_legacy c
                 WHERE c.usuario_id = p_id AND c.intentos_fallidos < 5) THEN 'migrar'
    ELSE 'pendiente'
  END
$$;

-- Devuelve 'ok' | 'incorrecta' | 'bloqueado' | 'no_aplica'. NO lanza excepciones a
-- propósito: un RAISE desharía el incremento del contador de intentos.
CREATE OR REPLACE FUNCTION privado.verificar_legacy(p_id uuid, p_password text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v privado.credenciales_legacy%ROWTYPE;
BEGIN
  IF privado.estado_acceso(p_id) = 'activo' THEN
    RETURN 'no_aplica';
  END IF;
  SELECT * INTO v FROM privado.credenciales_legacy WHERE usuario_id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'no_aplica';
  END IF;
  IF v.intentos_fallidos >= 5 THEN
    RETURN 'bloqueado';
  END IF;
  IF encode(extensions.digest(coalesce(p_password, ''), 'sha256'), 'hex') <> v.password_sha256 THEN
    UPDATE privado.credenciales_legacy SET intentos_fallidos = intentos_fallidos + 1 WHERE usuario_id = p_id;
    RETURN CASE WHEN v.intentos_fallidos + 1 >= 5 THEN 'bloqueado' ELSE 'incorrecta' END;
  END IF;
  RETURN 'ok';
END $$;

-- Genera un código de 8 caracteres (32 símbolos sin 0/O/1/I ≈ 40 bits), válido 7 días
-- y 5 intentos. Sustituye al código anterior. Devuelve el código en claro "ABCD-EFGH".
CREATE OR REPLACE FUNCTION privado.generar_codigo_acceso(p_usuario_id uuid, p_creado_por uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes  bytea := extensions.gen_random_bytes(8);
  v_codigo text  := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = p_usuario_id) THEN
    RAISE EXCEPTION 'Usuario no encontrado' USING ERRCODE = 'P0002';
  END IF;
  FOR i IN 0..7 LOOP
    v_codigo := v_codigo || substr(v_alfabeto, (get_byte(v_bytes, i) % 32) + 1, 1);
  END LOOP;
  INSERT INTO privado.codigos_acceso (usuario_id, codigo_hash, expira_at, intentos_fallidos, creado_por, created_at)
  VALUES (p_usuario_id, extensions.crypt(v_codigo, extensions.gen_salt('bf', 8)),
          now() + interval '7 days', 0, p_creado_por, now())
  ON CONFLICT (usuario_id) DO UPDATE
    SET codigo_hash = EXCLUDED.codigo_hash, expira_at = EXCLUDED.expira_at,
        intentos_fallidos = 0, creado_por = EXCLUDED.creado_por, created_at = EXCLUDED.created_at;
  RETURN substr(v_codigo, 1, 4) || '-' || substr(v_codigo, 5, 4);
END $$;

-- Restablecimiento completo SIN comprobar admin (no expuesto: solo SQL Editor y la RPC admin).
CREATE OR REPLACE FUNCTION privado.restablecer_acceso(p_usuario_id uuid, p_creado_por uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = p_usuario_id) THEN
    RAISE EXCEPTION 'Usuario no encontrado' USING ERRCODE = 'P0002';
  END IF;
  PERFORM privado.crear_usuario_auth(p_usuario_id);
  UPDATE auth.users SET encrypted_password = '', updated_at = now() WHERE id = p_usuario_id;
  -- Cerrar sus sesiones abiertas (los tokens de acceso ya emitidos caducan en ≤ 1 h)
  DELETE FROM auth.sessions       WHERE user_id = p_usuario_id;
  DELETE FROM auth.refresh_tokens WHERE user_id = p_usuario_id::text;
  DELETE FROM privado.credenciales_legacy WHERE usuario_id = p_usuario_id;
  RETURN privado.generar_codigo_acceso(p_usuario_id, p_creado_por);
END $$;

-- ── 3. Vincular los usuarios actuales con Supabase Auth ───────────────────────

DO $$
DECLARE
  r record;
BEGIN
  -- Sin contraseña en Auth. Quien tenía hash antiguo queda 'migrar'; quien no (alta
  -- sin primer acceso) queda 'pendiente' y solo puede entrar con un código del admin:
  -- la cuenta ya no es "reclamable" por cualquiera como antes.
  FOR r IN SELECT id FROM public.usuarios LOOP
    PERFORM privado.crear_usuario_auth(r.id);
  END LOOP;

  -- usuarios.id → auth.users.id (si el rol tiene permiso REFERENCES; si no, se omite:
  -- las RPC mantienen igualmente la correspondencia 1:1)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_id_auth_users_fkey')
     AND has_table_privilege('auth.users', 'REFERENCES') THEN
    ALTER TABLE public.usuarios
      ADD CONSTRAINT usuarios_id_auth_users_fkey
      FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- El hash antiguo ya está en privado.credenciales_legacy: fuera de la tabla pública
ALTER TABLE public.usuarios DROP COLUMN IF EXISTS password_hash;

-- ── 4. RPC públicas (expuestas en /rest/v1/rpc/…) ─────────────────────────────

-- Desplegable del login: solo id, nombre y estado. Nada de email ni hashes.
CREATE OR REPLACE FUNCTION public.listar_usuarios_login()
RETURNS TABLE (id uuid, nombre text, estado text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.id, u.nombre, privado.estado_acceso(u.id)
  FROM public.usuarios u
  ORDER BY u.created_at
$$;

CREATE OR REPLACE FUNCTION public.comprobar_password_legacy(p_usuario_id uuid, p_password text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN privado.verificar_legacy(p_usuario_id, p_password);
END $$;

-- 'ok' | 'incorrecta' | 'bloqueado' | 'no_aplica' | 'password_invalida' | 'password_igual'
CREATE OR REPLACE FUNCTION public.migrar_password_legacy(
  p_usuario_id uuid, p_password_actual text, p_password_nueva text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_res text;
BEGIN
  IF NOT privado.password_valida(p_password_nueva) THEN
    RETURN 'password_invalida';
  END IF;
  IF p_password_nueva = p_password_actual THEN
    RETURN 'password_igual';
  END IF;
  v_res := privado.verificar_legacy(p_usuario_id, p_password_actual);
  IF v_res <> 'ok' THEN
    RETURN v_res;
  END IF;
  PERFORM privado.establecer_password_auth(p_usuario_id, p_password_nueva);
  DELETE FROM privado.credenciales_legacy WHERE usuario_id = p_usuario_id;
  DELETE FROM privado.codigos_acceso      WHERE usuario_id = p_usuario_id;
  RETURN 'ok';
END $$;

-- 'ok' | 'codigo_invalido' | 'bloqueado' | 'password_invalida'
CREATE OR REPLACE FUNCTION public.activar_cuenta_con_codigo(
  p_usuario_id uuid, p_codigo text, p_password_nueva text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v    privado.codigos_acceso%ROWTYPE;
  v_cod text := upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
BEGIN
  IF NOT privado.password_valida(p_password_nueva) THEN
    RETURN 'password_invalida';
  END IF;
  SELECT * INTO v FROM privado.codigos_acceso WHERE usuario_id = p_usuario_id FOR UPDATE;
  IF NOT FOUND OR v.expira_at < now() THEN
    RETURN 'codigo_invalido';
  END IF;
  IF v.intentos_fallidos >= 5 THEN
    RETURN 'bloqueado';
  END IF;
  IF extensions.crypt(v_cod, v.codigo_hash) <> v.codigo_hash THEN
    UPDATE privado.codigos_acceso SET intentos_fallidos = intentos_fallidos + 1 WHERE usuario_id = p_usuario_id;
    RETURN CASE WHEN v.intentos_fallidos + 1 >= 5 THEN 'bloqueado' ELSE 'codigo_invalido' END;
  END IF;
  PERFORM privado.establecer_password_auth(p_usuario_id, p_password_nueva);
  DELETE FROM privado.codigos_acceso      WHERE usuario_id = p_usuario_id;
  DELETE FROM privado.credenciales_legacy WHERE usuario_id = p_usuario_id;
  RETURN 'ok';
END $$;

CREATE OR REPLACE FUNCTION public.admin_crear_usuario(p_nombre text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id     uuid := gen_random_uuid();
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_codigo text;
BEGIN
  IF NOT privado.es_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede crear usuarios' USING ERRCODE = '42501';
  END IF;
  IF v_nombre = '' OR char_length(v_nombre) > 60 THEN
    RAISE EXCEPTION 'Nombre no válido' USING ERRCODE = '22023';
  END IF;
  PERFORM privado.crear_usuario_auth(v_id);
  INSERT INTO public.usuarios (id, nombre, es_admin, puede_peso_corporal)
  VALUES (v_id, v_nombre, false, false);
  v_codigo := privado.generar_codigo_acceso(v_id, auth.uid());
  RETURN json_build_object('id', v_id, 'nombre', v_nombre, 'codigo', v_codigo);
END $$;

CREATE OR REPLACE FUNCTION public.admin_restablecer_acceso(p_usuario_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT privado.es_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede restablecer accesos' USING ERRCODE = '42501';
  END IF;
  IF p_usuario_id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes restablecer tu propio acceso: pídeselo a otro administrador' USING ERRCODE = '22023';
  END IF;
  RETURN privado.restablecer_acceso(p_usuario_id, auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.admin_eliminar_usuario(p_usuario_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT privado.es_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede eliminar usuarios' USING ERRCODE = '42501';
  END IF;
  IF p_usuario_id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes eliminar tu propio usuario' USING ERRCODE = '22023';
  END IF;
  -- Borrado explícito: no depende de que cada FK tenga ON DELETE CASCADE
  DELETE FROM public.entrenos               WHERE usuario_id = p_usuario_id;
  DELETE FROM public.registros_peso         WHERE usuario_id = p_usuario_id;
  DELETE FROM public.composicion_corporal   WHERE usuario_id = p_usuario_id;
  DELETE FROM public.medidas_corporales     WHERE usuario_id = p_usuario_id;
  DELETE FROM public.perfil_corporal        WHERE usuario_id = p_usuario_id;
  DELETE FROM public.ejercicios_usuario     WHERE usuario_id = p_usuario_id;
  DELETE FROM public.equivalencias_gimnasio WHERE usuario_id = p_usuario_id;
  DELETE FROM public.usuarios               WHERE id = p_usuario_id;
  DELETE FROM auth.users                    WHERE id = p_usuario_id;
END $$;

-- ── 5. Row Level Security ─────────────────────────────────────────────────────

-- 5a. Borrar TODAS las políticas existentes de estas tablas (p. ej. "anon_all" de
--     v2.5.0): las políticas permisivas se suman con OR y anularían las nuevas.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('usuarios','entrenos','registros_peso','composicion_corporal','medidas_corporales',
                        'perfil_corporal','ejercicios_usuario','plantilla_ejercicios','equivalencias_gimnasio')
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

ALTER TABLE public.usuarios               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entrenos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registros_peso         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.composicion_corporal   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medidas_corporales     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfil_corporal        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ejercicios_usuario     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plantilla_ejercicios   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equivalencias_gimnasio ENABLE ROW LEVEL SECURITY;

-- 5b. usuarios: cada uno ve su fila; el admin ve y edita todas. Altas y bajas solo por RPC.
CREATE POLICY usuarios_select ON public.usuarios
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT privado.es_admin()));
CREATE POLICY usuarios_update_admin ON public.usuarios
  FOR UPDATE TO authenticated
  USING ((SELECT privado.es_admin()))
  WITH CHECK ((SELECT privado.es_admin()));

-- 5c. Datos por usuario: el dueño, o un admin (función "Ver perfil de…")
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['entrenos','registros_peso','composicion_corporal','medidas_corporales',
                           'perfil_corporal','ejercicios_usuario','equivalencias_gimnasio']
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (usuario_id = (SELECT auth.uid()) OR (SELECT privado.es_admin())) '
      'WITH CHECK (usuario_id = (SELECT auth.uid()) OR (SELECT privado.es_admin()))',
      t || '_dueno_o_admin', t);
  END LOOP;
END $$;

-- 5d. Plantilla: lectura para cualquier usuario autenticado, escritura solo admin
CREATE POLICY plantilla_select ON public.plantilla_ejercicios
  FOR SELECT TO authenticated USING (true);
CREATE POLICY plantilla_admin ON public.plantilla_ejercicios
  FOR ALL TO authenticated
  USING ((SELECT privado.es_admin()))
  WITH CHECK ((SELECT privado.es_admin()));

-- ── 6. Privilegios ────────────────────────────────────────────────────────────

-- anon: nada (con RLS ya vería [], esto además devuelve error 401/42501)
REVOKE ALL ON TABLE public.usuarios, public.entrenos, public.registros_peso, public.composicion_corporal,
  public.medidas_corporales, public.perfil_corporal, public.ejercicios_usuario,
  public.plantilla_ejercicios, public.equivalencias_gimnasio FROM anon;

-- authenticated: solo CRUD (sin TRUNCATE/TRIGGER/REFERENCES, que no pasan por RLS)
REVOKE ALL ON TABLE public.usuarios, public.entrenos, public.registros_peso, public.composicion_corporal,
  public.medidas_corporales, public.perfil_corporal, public.ejercicios_usuario,
  public.plantilla_ejercicios, public.equivalencias_gimnasio FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.entrenos, public.registros_peso,
  public.composicion_corporal, public.medidas_corporales, public.perfil_corporal,
  public.ejercicios_usuario, public.plantilla_ejercicios, public.equivalencias_gimnasio TO authenticated;
-- usuarios: lectura + edición de columnas de perfil/permisos (nunca id ni created_at)
GRANT SELECT ON TABLE public.usuarios TO authenticated;
GRANT UPDATE (nombre, email, edad, altura_cm, sexo, es_admin, puede_peso_corporal)
  ON TABLE public.usuarios TO authenticated;

-- Funciones: por defecto PostgreSQL da EXECUTE a PUBLIC y Supabase a anon/authenticated
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA privado FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA privado FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION privado.es_admin() TO authenticated;

REVOKE EXECUTE ON FUNCTION
  public.listar_usuarios_login(),
  public.comprobar_password_legacy(uuid, text),
  public.migrar_password_legacy(uuid, text, text),
  public.activar_cuenta_con_codigo(uuid, text, text),
  public.admin_crear_usuario(text),
  public.admin_restablecer_acceso(uuid),
  public.admin_eliminar_usuario(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.listar_usuarios_login(),
  public.comprobar_password_legacy(uuid, text),
  public.migrar_password_legacy(uuid, text, text),
  public.activar_cuenta_con_codigo(uuid, text, text)
TO anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.admin_crear_usuario(text),
  public.admin_restablecer_acceso(uuid),
  public.admin_eliminar_usuario(uuid)
TO authenticated;

-- Que la API REST vea las funciones nuevas sin esperar
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── Resultado: estado de cada usuario ─────────────────────────────────────────
--   activo    → ya entra con su contraseña de Supabase Auth
--   migrar    → en su próximo acceso: contraseña de siempre + elegir una nueva
--   pendiente → necesita un código: en la app, Usuarios → Restablecer
SELECT u.nombre, privado.estado_acceso(u.id) AS estado, u.es_admin
FROM public.usuarios u
ORDER BY u.created_at;
