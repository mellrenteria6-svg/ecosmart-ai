-- =============================================================================
-- Migración 002 — Varias universidades con sus dominios de correo
-- RN01 ajustada: solo se registra quien verifica un correo de un dominio
-- institucional AUTORIZADO. Cada usuario queda asignado a su universidad.
--
-- Ejecutar después de schema.sql y seed.sql:
--   psql -U postgres -d ecosmart -f db/migraciones/002_instituciones.sql
-- =============================================================================

-- Los archivos están en UTF-8 (tildes y ñ); evita errores con la consola de Windows
SET client_encoding = 'UTF8';

BEGIN;

CREATE TABLE institucion (
  id      TEXT    PRIMARY KEY,                 -- ej. 'inst-espol'
  nombre  TEXT    NOT NULL,
  siglas  TEXT    NOT NULL UNIQUE,
  activa  BOOLEAN NOT NULL DEFAULT true        -- inactiva: no acepta nuevos registros
);

-- Una universidad puede tener varios dominios (estudiantes, personal...)
-- y un dominio pertenece a una sola universidad.
CREATE TABLE institucion_dominio (
  dominio         CITEXT PRIMARY KEY CHECK (dominio ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'),
  institucion_id  TEXT   NOT NULL REFERENCES institucion(id) ON DELETE CASCADE
);
CREATE INDEX ix_dominio_institucion ON institucion_dominio (institucion_id);

-- Dominios de ejemplo: confirmar con cada universidad antes del piloto
INSERT INTO institucion (id, nombre, siglas) VALUES
  ('inst-demo',   'Universidad Demo',                               'DEMO'),
  ('inst-espol',  'Escuela Superior Politécnica del Litoral',       'ESPOL'),
  ('inst-ecotec', 'Universidad Tecnológica ECOTEC',                 'ECOTEC'),
  ('inst-ucsg',   'Universidad Católica de Santiago de Guayaquil',  'UCSG');

INSERT INTO institucion_dominio (dominio, institucion_id) VALUES
  ('universidad.edu.ec', 'inst-demo'),
  ('espol.edu.ec',       'inst-espol'),
  ('ecotec.edu.ec',      'inst-ecotec'),
  ('est.ecotec.edu.ec',  'inst-ecotec'),
  ('ucsg.edu.ec',        'inst-ucsg'),
  ('cu.ucsg.edu.ec',     'inst-ucsg');

-- Devuelve la universidad activa a la que pertenece un correo (o NULL)
CREATE FUNCTION institucion_por_correo(p_correo CITEXT) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT d.institucion_id
  FROM institucion_dominio d
  JOIN institucion i ON i.id = d.institucion_id AND i.activa
  WHERE d.dominio = lower(split_part(p_correo::text, '@', 2))::citext
$$;

-- Asignar a los usuarios existentes según su correo
ALTER TABLE usuario ADD COLUMN institucion_id TEXT REFERENCES institucion(id);
UPDATE usuario SET institucion_id = COALESCE(institucion_por_correo(correo), 'inst-demo');
ALTER TABLE usuario ALTER COLUMN institucion_id SET NOT NULL;
CREATE INDEX ix_usuario_institucion ON usuario (institucion_id);

-- Al registrarse: si no se indica la universidad, se deduce del correo; si el
-- dominio no está autorizado, el registro se rechaza (RN01).
CREATE FUNCTION fn_asignar_institucion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.institucion_id IS NULL THEN
    NEW.institucion_id := institucion_por_correo(NEW.correo);
  END IF;
  IF NEW.institucion_id IS NULL THEN
    RAISE EXCEPTION 'El correo % no pertenece a una universidad participante', NEW.correo;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tg_asignar_institucion BEFORE INSERT ON usuario
  FOR EACH ROW EXECUTE FUNCTION fn_asignar_institucion();

-- El dominio único del campus queda reemplazado por institucion_dominio
ALTER TABLE campus ALTER COLUMN dominio_institucional DROP NOT NULL;

-- EcoRanking por universidad (últimos 30 días)
CREATE VIEW v_ranking_universidades AS
SELECT i.siglas,
       i.nombre,
       COALESCE(SUM(m.puntos), 0)          AS puntos,
       COUNT(DISTINCT m.usuario_id)        AS participantes,
       RANK() OVER (ORDER BY COALESCE(SUM(m.puntos), 0) DESC) AS posicion
FROM institucion i
LEFT JOIN usuario u            ON u.institucion_id = i.id AND NOT u.bloqueado
LEFT JOIN movimiento_puntos m  ON m.usuario_id = u.id AND m.tipo = 'reciclaje'
                              AND m.creado_en >= now() - INTERVAL '30 days'
GROUP BY i.id;

INSERT INTO auditoria (actor_id, accion, entidad, entidad_id, detalle) VALUES
  (NULL, 'Migración 002', 'INSTITUCION', '*', 'Varias universidades con dominios autorizados');

COMMIT;
