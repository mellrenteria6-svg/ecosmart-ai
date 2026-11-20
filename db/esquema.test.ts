// Pruebas de integración de la base de datos (RNF07, RNF10): reglas que PostgreSQL
// hace cumplir por sí mismo, aunque alguien intente saltarse la aplicación.
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearBasePrueba } from './base-prueba'

let db: PGlite
const ESTUDIANTE = '00000000-0000-0000-0000-000000000001'
const RECOLECTOR = '00000000-0000-0000-0000-000000000003'
const uno = async <T,>(sql: string) => (await db.query<T>(sql)).rows[0]

function reciclajeSql(clave: string, extra = '') {
  return `INSERT INTO reciclaje (idempotency_key, usuario_id, punto_id, categoria_id, categoria_ia, confianza_ia, modelo_version,
            cantidad_reportada, unidad, puntos_por_unidad, categoria_version, puntos_estimados, foto_url, foto_hash${extra ? ', estado, motivo_rechazo' : ''})
          VALUES ('${clave}', '${ESTUDIANTE}', 'p-biblioteca', 'cat-pet', 'cat-pet', 0.9, 'clip', 3, 'botella', 10, 1, 30, 'foto', '0123456789abcdef'${extra})`
}

beforeAll(async () => {
  db = await crearBasePrueba()
})
afterAll(async () => {
  await db?.close()
})

describe('Esquema PostgreSQL', () => {
  it('crea todas las tablas y carga las universidades', async () => {
    const t = await uno<{ n: number }>("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")
    expect(t.n).toBe(21) // 18 del esquema + institucion, institucion_dominio y correo_simulado
    const u = await uno<{ s: string }>("SELECT string_agg(siglas, ',' ORDER BY siglas) AS s FROM institucion")
    expect(u.s).toBe('DEMO,ECOTEC,ESPOL,UCSG,UEES')
  })

  it('CP-RNF04: las contraseñas se guardan con bcrypt y se verifican en la base', async () => {
    const r = await uno<{ ok: boolean; bcrypt: boolean }>(
      "SELECT password_hash = crypt('EcoSmart2026', password_hash) AS ok, password_hash LIKE '$2a$%' AS bcrypt FROM usuario WHERE correo = 'estudiante@universidad.edu.ec'",
    )
    expect(r).toEqual({ ok: true, bcrypt: true })
  })

  it('CP-RNF03: la misma clave de idempotencia no crea dos reciclajes', async () => {
    await db.exec(reciclajeSql('idem-1'))
    await expect(db.exec(reciclajeSql('idem-1'))).rejects.toThrow(/duplicate key|llave duplicada/)
  })

  it('CP-RNF07: el libro de puntos y la auditoría no se pueden editar ni borrar', async () => {
    await expect(db.exec('UPDATE movimiento_puntos SET puntos = 9999')).rejects.toThrow(/inmutable/)
    await expect(db.exec('DELETE FROM auditoria')).rejects.toThrow(/inmutable/)
  })

  it('CP-RF13: un reciclaje decidido no cambia, salvo borrar su foto (RNF05)', async () => {
    await db.exec(reciclajeSql('final-1', ", 'rechazado', 'No era PET'"))
    await expect(db.exec("UPDATE reciclaje SET estado = 'pendiente' WHERE idempotency_key = 'final-1'")).rejects.toThrow(/estado final/)
    await expect(db.exec("UPDATE reciclaje SET puntos_estimados = 99 WHERE idempotency_key = 'final-1'")).rejects.toThrow(/estado final/)
    await db.exec("UPDATE reciclaje SET foto_url = '' WHERE idempotency_key = 'final-1'")
    expect((await uno<{ f: string }>("SELECT foto_url AS f FROM reciclaje WHERE idempotency_key = 'final-1'")).f).toBe('')
  })

  it('CP-RF13: el rechazo exige motivo', async () => {
    await expect(db.exec(reciclajeSql('sin-motivo', ", 'rechazado', NULL"))).rejects.toThrow(/check/i)
  })

  it('RN15: un reciclaje acredita puntos una sola vez', async () => {
    const ins = `INSERT INTO movimiento_puntos (usuario_id, tipo, puntos, referencia_id, descripcion) VALUES ('${ESTUDIANTE}', 'reciclaje', 30, 'rec-x', 'x')`
    await db.exec(ins)
    await expect(db.exec(ins)).rejects.toThrow(/duplicate key|llave duplicada/)
  })

  it('RN14: un recolector tiene una sola asignación activa por punto', async () => {
    await expect(
      db.exec(`INSERT INTO asignacion_recolector (recolector_id, punto_id, desde, hasta, horario) VALUES ('${RECOLECTOR}', 'p-biblioteca', CURRENT_DATE, CURRENT_DATE, 'x')`),
    ).rejects.toThrow(/duplicate key|llave duplicada/)
  })

  it('CP-RF16: cambiar los puntos de una categoría crea una versión nueva', async () => {
    await db.exec("UPDATE categoria_residuo SET puntos_por_unidad = 12 WHERE id = 'cat-vidrio'")
    const v = await db.query<{ version: number }>("SELECT version FROM categoria_version WHERE categoria_id = 'cat-vidrio' ORDER BY version")
    expect(v.rows.map((x) => x.version)).toEqual([1, 2])
  })

  it('RN01: solo se registran correos de universidades activas', async () => {
    const insertar = (correo: string) =>
      db.exec(`INSERT INTO usuario (campus_id, nombre, correo, facultad, password_hash, consentimiento_privacidad) VALUES (1, 'X', '${correo}', 'F', 'h', true)`)
    await insertar('ana@ESPOL.edu.ec')
    expect((await uno<{ i: string }>("SELECT institucion_id AS i FROM usuario WHERE correo = 'ana@espol.edu.ec'")).i).toBe('inst-espol')
    await expect(insertar('x@gmail.com')).rejects.toThrow(/universidad participante/)
  })

  it('CP-RNF05: una cuenta eliminada no puede conservar datos personales', async () => {
    await expect(db.exec(`UPDATE usuario SET eliminado_en = now() WHERE id = '${ESTUDIANTE}'`)).rejects.toThrow(/ck_usuario_eliminado_anonimo/)
    await db.exec(
      `UPDATE usuario SET eliminado_en = now(), bloqueado = true, facultad = '', nombre = 'Cuenta eliminada', correo = 'eliminada-1@anonimo.invalid' WHERE id = '${ESTUDIANTE}'`,
    )
  })
})
