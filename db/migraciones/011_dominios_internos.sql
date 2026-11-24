-- =============================================================================
-- Migración 011 — Dominios internos por rol
-- La administración crea cuentas con un correo interno según el rol, por ejemplo
-- juan@aliado.eco.smart.com. Estos dominios no tienen buzón real: sus códigos se envían al
-- correo del proyecto. Nadie puede registrarse solo con ellos (no se ven en el registro).
-- =============================================================================
SET client_encoding = 'UTF8';

BEGIN;

CREATE TABLE dominio_interno (
  rol      rol_usuario PRIMARY KEY,
  dominio  CITEXT      NOT NULL UNIQUE CHECK (dominio ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$')
);

INSERT INTO dominio_interno (rol, dominio) VALUES
  ('usuario',    'eco.smart.com'),
  ('recolector', 'recolector.eco.smart.com'),
  ('aliado',     'aliado.eco.smart.com'),
  ('admin',      'administrador.eco.smart.com');

-- ¿El correo pertenece a un dominio interno?
CREATE FUNCTION es_correo_interno(p_correo CITEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM dominio_interno WHERE dominio = lower(split_part(p_correo::text, '@', 2))::citext)
$$;

INSERT INTO auditoria (actor_id, accion, entidad, entidad_id, detalle) VALUES
  (NULL, 'Migración 011', 'DOMINIO_INTERNO', '*', 'Cuentas internas creadas por la administración según el rol');

COMMIT;
