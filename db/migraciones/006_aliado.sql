-- =============================================================================
-- Migración 006 — Aliado de demostración (Fase 2: panel del aliado A01–A04)
-- Cafetería El Roble entrega el café americano. Contraseña: EcoSmart2026
-- =============================================================================
SET client_encoding = 'UTF8';

BEGIN;

INSERT INTO usuario (id, campus_id, nombre, correo, facultad, rol, password_hash, verificado, consentimiento_privacidad, institucion_id)
VALUES ('00000000-0000-0000-0000-000000000006', 1, 'Cafetería El Roble', 'aliado@universidad.edu.ec', 'Aliado del campus', 'aliado',
        crypt('EcoSmart2026', gen_salt('bf')), true, true, 'inst-demo')
ON CONFLICT (correo) DO NOTHING;

-- El café lo entrega la cafetería: solo esa cuenta puede validar sus códigos
UPDATE recompensa
SET aliado_id = (SELECT id FROM usuario WHERE correo = 'aliado@universidad.edu.ec'),
    responsable = 'Cafetería El Roble',
    procedencia = 'Aliado: Cafetería El Roble'
WHERE id = 'rw-cafe' AND aliado_id IS NULL;

INSERT INTO auditoria (actor_id, accion, entidad, entidad_id, detalle) VALUES
  (NULL, 'Migración 006', 'USUARIO', 'aliado', 'Cuenta de aliado Cafetería El Roble vinculada al café americano');

COMMIT;
