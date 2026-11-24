-- =============================================================================
-- Migración 010 — Registro con cualquier correo (grupo "Invitados")
-- Un correo que no pertenece a una universidad participante ya no se rechaza: la cuenta
-- queda en "Invitados" y, como todas, debe verificar su correo antes de entrar (RF01).
-- Si la administración desactiva "Invitados", vuelve a aceptarse solo correo universitario.
-- =============================================================================
SET client_encoding = 'UTF8';

BEGIN;

INSERT INTO institucion (id, nombre, siglas, activa) VALUES ('inst-invitados', 'Invitados', 'INVITADOS', true)
ON CONFLICT (id) DO NOTHING;

-- Universidad para un registro nuevo: la del dominio o, si no hay, "Invitados" (si está activa)
CREATE FUNCTION institucion_para_registro(p_correo CITEXT) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(institucion_por_correo(p_correo), (SELECT id FROM institucion WHERE id = 'inst-invitados' AND activa))
$$;

CREATE OR REPLACE FUNCTION fn_asignar_institucion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.institucion_id IS NULL THEN
    NEW.institucion_id := institucion_para_registro(NEW.correo);
  END IF;
  IF NEW.institucion_id IS NULL THEN
    RAISE EXCEPTION 'El correo % no pertenece a una universidad participante', NEW.correo;
  END IF;
  RETURN NEW;
END $$;

INSERT INTO auditoria (actor_id, accion, entidad, entidad_id, detalle) VALUES
  (NULL, 'Migración 010', 'INSTITUCION', 'inst-invitados', 'Registro con cualquier correo en el grupo Invitados');

COMMIT;
