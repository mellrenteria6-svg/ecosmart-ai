-- =============================================================================
-- Migración 004 — Universidad Espíritu Santo (UEES)
-- Dominio de ejemplo: confirmar con la universidad antes del piloto.
-- =============================================================================
SET client_encoding = 'UTF8';

BEGIN;

INSERT INTO institucion (id, nombre, siglas) VALUES
  ('inst-uees', 'Universidad Espíritu Santo', 'UEES')
ON CONFLICT (id) DO NOTHING;

INSERT INTO institucion_dominio (dominio, institucion_id) VALUES
  ('uees.edu.ec', 'inst-uees')
ON CONFLICT (dominio) DO NOTHING;

INSERT INTO auditoria (actor_id, accion, entidad, entidad_id, detalle) VALUES
  (NULL, 'Agregar universidad', 'INSTITUCION', 'inst-uees', 'UEES: uees.edu.ec');

COMMIT;
