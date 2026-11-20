-- =============================================================================
-- Migración 005 — Privacidad (RNF05)
--   * Cuentas eliminadas por su titular (datos anonimizados)
--   * Las fotos de reciclajes ya decididos pueden borrarse (retención de 90 días),
--     sin permitir ningún otro cambio en un registro con estado final
-- =============================================================================
SET client_encoding = 'UTF8';

BEGIN;

ALTER TABLE usuario ADD COLUMN eliminado_en TIMESTAMPTZ;

-- Un reciclaje validado o rechazado es final: lo único que puede cambiar es que
-- su foto se borre (foto_url = '') por retención o por eliminación de la cuenta.
CREATE OR REPLACE FUNCTION fn_reciclaje_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado IN ('validado', 'rechazado') THEN
    IF NEW.foto_url = '' AND (to_jsonb(NEW) - 'foto_url') = (to_jsonb(OLD) - 'foto_url') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'El reciclaje % ya tiene un estado final (%)', OLD.id, OLD.estado;
  END IF;
  RETURN NEW;
END $$;

-- Una cuenta eliminada no conserva datos personales
ALTER TABLE usuario ADD CONSTRAINT ck_usuario_eliminado_anonimo
  CHECK (eliminado_en IS NULL OR (bloqueado AND correo LIKE 'eliminada-%@anonimo.invalid' AND facultad = ''));

-- Fotos pendientes de borrar por retención (para monitoreo)
CREATE VIEW v_fotos_por_vencer AS
SELECT r.id, r.estado, r.creado_en,
       r.creado_en + make_interval(days => c.dias_retencion_fotos) AS se_borra_el
FROM reciclaje r
CROSS JOIN configuracion c
WHERE c.campus_id = 1 AND r.foto_url <> '' AND r.estado IN ('validado', 'rechazado');

INSERT INTO auditoria (actor_id, accion, entidad, entidad_id, detalle) VALUES
  (NULL, 'Migración 005', 'USUARIO', '*', 'Eliminación de cuenta y retención de fotos');

COMMIT;
