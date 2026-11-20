// Pruebas unitarias de las reglas de negocio (RNF10).
// Cada prueba parte de los datos de demostración y ejecuta las mismas funciones que usa
// la aplicación y el servidor. Los identificadores CP-* remiten a la matriz de trazabilidad.
import { randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { crearDbSemilla } from './seed'
import {
  aplicarRetencionFotos,
  cancelarCanje,
  cerrarLote,
  crearAjuste,
  crearCanje,
  actualizarCategoria,
  eliminarCuentaLocal,
  entregarCanje,
  guardarInstitucion,
  guardarRecompensa,
  institucionPorCorreo,
  motorServidor,
  procesarVencimientos,
  puntoPorCodigo,
  registrarReciclaje,
  saldoConfirmado,
  cambiarBloqueo,
} from './store'
import type { DatosReciclaje } from './store'
import { REPORTES } from './reportes'
import type { Db } from './types'

const ESTUDIANTE = 'u-estudiante'
const DIEGO = 'u-diego'
const RECOLECTOR = 'u-recolector'
const ADMIN = 'u-admin'
const DIA = 86_400_000

const db = (): Db => motorServidor.db()
const huella = () => randomBytes(8).toString('hex') // huella perceptual distinta en cada foto
let clave = 0

function datos(extra: Partial<DatosReciclaje> = {}): DatosReciclaje {
  clave += 1
  return {
    idempotencyKey: `prueba-${clave}`,
    usuarioId: ESTUDIANTE,
    codigoPunto: 'ECO-BIB-01',
    categoriaId: 'cat-pet',
    categoriaIa: 'cat-pet',
    confianzaIa: 0.9,
    modeloVersion: 'clip-prueba',
    cantidad: 3,
    foto: 'data:image/jpeg;base64,AAAA',
    fotoHash: huella(),
    ...extra,
  }
}

beforeEach(() => {
  motorServidor.cargar(crearDbSemilla())
})

describe('Registro de reciclaje (RF07–RF11)', () => {
  it('CP-RF10: crea el registro pendiente con la tarifa congelada y sin tocar el saldo', async () => {
    const antes = saldoConfirmado(db(), ESTUDIANTE)
    const { reciclaje } = await registrarReciclaje(datos({ cantidad: 4 }))
    expect(reciclaje.estado).toBe('pendiente')
    expect(reciclaje.puntosPorUnidad).toBe(10)
    expect(reciclaje.puntosEstimados).toBe(40)
    expect(saldoConfirmado(db(), ESTUDIANTE)).toBe(antes)
  })

  it('CP-RNF03: la misma clave de idempotencia no crea un segundo registro', async () => {
    const d = datos()
    const primero = await registrarReciclaje(d)
    const segundo = await registrarReciclaje(d)
    expect(segundo.repetido).toBe(true)
    expect(segundo.reciclaje.id).toBe(primero.reciclaje.id)
    expect(db().reciclajes.filter((r) => r.idempotencyKey === d.idempotencyKey)).toHaveLength(1)
  })

  it('CP-RF11: rechaza una foto casi idéntica y deja una alerta antifraude', async () => {
    const h = 'a1b2c3d4e5f60718'
    await registrarReciclaje(datos({ fotoHash: h }))
    await expect(registrarReciclaje(datos({ fotoHash: 'a1b2c3d4e5f60719' }))).rejects.toThrow(/casi idéntica/)
    expect(db().alertas.some((a) => a.regla === 'Foto duplicada' && a.usuarioId === ESTUDIANTE)).toBe(true)
  })

  it('CP-RF11: aplica el tope diario configurable', async () => {
    db().config.topeDiario = 3 // la semilla ya tiene 2 registros de hoy
    await registrarReciclaje(datos())
    await expect(registrarReciclaje(datos())).rejects.toThrow(/tope diario/)
  })

  it('CP-RF07: rechaza códigos inexistentes y puntos en mantenimiento', () => {
    expect(() => puntoPorCodigo('ECO-XXX-99')).toThrow(/no corresponde/)
    expect(() => puntoPorCodigo('ECO-DEP-04')).toThrow(/mantenimiento/)
    expect(puntoPorCodigo('eco-bib-01').id).toBe('p-biblioteca')
  })

  it('RN02: el punto debe aceptar la categoría', async () => {
    await expect(registrarReciclaje(datos({ codigoPunto: 'ECO-ING-03', categoriaId: 'cat-vidrio', categoriaIa: 'cat-vidrio' }))).rejects.toThrow(/no acepta/)
  })

  it('CP-RF09: una corrección de categoría o baja confianza va a revisión individual', async () => {
    const corregido = await registrarReciclaje(datos({ categoriaId: 'cat-vidrio', categoriaIa: 'cat-pet', cantidad: 2 }))
    expect(corregido.reciclaje.estado).toBe('en_revision')
    const dudoso = await registrarReciclaje(datos({ confianzaIa: 0.4 }))
    expect(dudoso.reciclaje.estado).toBe('en_revision')
  })

  it('RN11: una cuenta bloqueada no puede registrar', async () => {
    await cambiarBloqueo(ADMIN, ESTUDIANTE, true, 'Prueba')
    await expect(registrarReciclaje(datos())).rejects.toThrow(/bloqueada/)
  })
})

describe('Validación por lotes (RF12–RF14, RF29)', () => {
  it('CP-RF14: validar acredita los puntos, crea el movimiento y notifica', async () => {
    const antes = saldoConfirmado(db(), ESTUDIANTE)
    const lote = await cerrarLote(RECOLECTOR, 'p-biblioteca', [{ reciclajeId: 'r-004', accion: 'validar' }])
    expect(lote.validados).toBe(1)
    expect(saldoConfirmado(db(), ESTUDIANTE)).toBe(antes + 60)
    expect(db().movimientos.some((m) => m.referenciaId === 'r-004' && m.tipo === 'reciclaje')).toBe(true)
    expect(db().notificaciones.some((n) => n.usuarioId === ESTUDIANTE && n.titulo === 'Reciclaje validado')).toBe(true)
  })

  it('CP-RF13: el rechazo exige motivo y no acredita puntos', async () => {
    await expect(cerrarLote(RECOLECTOR, 'p-biblioteca', [{ reciclajeId: 'r-004', accion: 'rechazar' }])).rejects.toThrow(/motivo/)
    const antes = saldoConfirmado(db(), ESTUDIANTE)
    await cerrarLote(RECOLECTOR, 'p-biblioteca', [{ reciclajeId: 'r-004', accion: 'rechazar', motivoRechazo: 'No era PET' }])
    expect(db().reciclajes.find((r) => r.id === 'r-004')?.estado).toBe('rechazado')
    expect(saldoConfirmado(db(), ESTUDIANTE)).toBe(antes)
  })

  it('CP-RF29: corregir la cantidad exige motivo y recalcula con la tarifa congelada', async () => {
    await expect(cerrarLote(RECOLECTOR, 'p-biblioteca', [{ reciclajeId: 'r-004', accion: 'validar', cantidadFinal: 4 }])).rejects.toThrow(/motivo/)
    await cerrarLote(RECOLECTOR, 'p-biblioteca', [{ reciclajeId: 'r-004', accion: 'validar', cantidadFinal: 4, motivoCantidad: 'Dos no eran PET' }])
    const r = db().reciclajes.find((x) => x.id === 'r-004')!
    expect(r.cantidadFinal).toBe(4)
    expect(r.puntosEstimados).toBe(40)
  })

  it('CP-RF14: el lote es atómico; si un registro falla no se confirma ninguno', async () => {
    const antes = db().movimientos.length
    await expect(
      cerrarLote(RECOLECTOR, 'p-biblioteca', [
        { reciclajeId: 'r-004', accion: 'validar' },
        { reciclajeId: 'r-005', accion: 'validar' }, // está en revisión: no entra al lote
      ]),
    ).rejects.toThrow(/individualmente/)
    expect(db().movimientos.length).toBe(antes)
    expect(db().reciclajes.find((r) => r.id === 'r-004')?.estado).toBe('pendiente')
  })

  it('RN14: sin asignación vigente no se puede validar en el punto', async () => {
    await expect(cerrarLote(RECOLECTOR, 'p-ingenieria', [{ reciclajeId: 'r-006', accion: 'validar' }])).rejects.toThrow(/asignación/)
  })

  it('CP-RF13: un registro ya decidido no vuelve a cambiar', async () => {
    await cerrarLote(RECOLECTOR, 'p-biblioteca', [{ reciclajeId: 'r-004', accion: 'validar' }])
    await expect(cerrarLote(RECOLECTOR, 'p-biblioteca', [{ reciclajeId: 'r-004', accion: 'validar' }])).rejects.toThrow(/pendiente/)
  })
})

describe('EcoPoints y canjes (RF15, RF18–RF20, RN07, RN08, RN15)', () => {
  it('CP-RF15: el saldo es exactamente la suma del libro de movimientos', () => {
    const suma = db().movimientos.filter((m) => m.usuarioId === ESTUDIANTE).reduce((t, m) => t + m.puntos, 0)
    expect(saldoConfirmado(db(), ESTUDIANTE)).toBe(suma)
  })

  it('CP-RF18: canjear descuenta saldo y stock y genera un código único con vencimiento', async () => {
    const saldo = saldoConfirmado(db(), ESTUDIANTE)
    const canje = await crearCanje(ESTUDIANTE, 'rw-cafe', 'canje-1')
    expect(canje.codigo).toMatch(/^ECO-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect(canje.venceEn - canje.creadoEn).toBe(72 * 3_600_000)
    expect(saldoConfirmado(db(), ESTUDIANTE)).toBe(saldo - 60)
    expect(db().recompensas.find((r) => r.id === 'rw-cafe')?.stock).toBe(24)
    const repetido = await crearCanje(ESTUDIANTE, 'rw-cafe', 'canje-1')
    expect(repetido.id).toBe(canje.id)
    expect(db().canjes).toHaveLength(1)
  })

  it('RN08: exige saldo suficiente y stock disponible', async () => {
    await expect(crearCanje(ESTUDIANTE, 'rw-termo', 'canje-2')).rejects.toThrow(/Saldo insuficiente/)
    await expect(crearCanje(ESTUDIANTE, 'rw-bolsa', 'canje-3')).rejects.toThrow(/agotada/)
  })

  it('CP-RF20: cancelar devuelve puntos y stock una sola vez', async () => {
    const saldo = saldoConfirmado(db(), ESTUDIANTE)
    const canje = await crearCanje(ESTUDIANTE, 'rw-cafe', 'canje-4')
    await cancelarCanje(ESTUDIANTE, canje.id)
    expect(saldoConfirmado(db(), ESTUDIANTE)).toBe(saldo)
    await expect(cancelarCanje(ESTUDIANTE, canje.id)).rejects.toThrow(/pendiente/)
    expect(db().movimientos.filter((m) => m.referenciaId === canje.id && m.tipo === 'devolucion')).toHaveLength(1)
  })

  it('RN15: al vencer, el canje devuelve puntos y stock', async () => {
    const saldo = saldoConfirmado(db(), ESTUDIANTE)
    const canje = await crearCanje(ESTUDIANTE, 'rw-cafe', 'canje-5')
    db().canjes.find((c) => c.id === canje.id)!.venceEn = Date.now() - 1000
    procesarVencimientos()
    expect(db().canjes.find((c) => c.id === canje.id)?.estado).toBe('vencido')
    expect(saldoConfirmado(db(), ESTUDIANTE)).toBe(saldo)
    expect(db().recompensas.find((r) => r.id === 'rw-cafe')?.stock).toBe(25)
  })

  it('CP-RF19: un código se entrega una sola vez', async () => {
    const canje = await crearCanje(ESTUDIANTE, 'rw-cafe', 'canje-6')
    expect((await entregarCanje(ADMIN, canje.codigo)).estado).toBe('entregado')
    await expect(entregarCanje(ADMIN, canje.codigo)).rejects.toThrow(/ya fue utilizado/)
  })

  it('RN07: un ajuste no puede dejar el saldo en negativo y solo lo hace la administración', async () => {
    await expect(crearAjuste(ADMIN, ESTUDIANTE, -10_000, 'Corrección')).rejects.toThrow(/negativo/)
    await expect(crearAjuste(ESTUDIANTE, ESTUDIANTE, 500, 'Trampa')).rejects.toThrow(/permiso/)
  })

  it('CP-RF17: no se activa una recompensa sin costo positivo o con vigencia incoherente', async () => {
    const base = { nombre: 'Prueba', descripcion: '', stock: 5, responsable: 'Admin', activa: true, emoji: '🎁', procedencia: 'Campus', tipo: 'beneficio' as const }
    await expect(guardarRecompensa(ADMIN, { ...base, costo: 0, vigenciaDesde: '2026-01-01', vigenciaHasta: '2026-12-31' })).rejects.toThrow(/costo/)
    await expect(guardarRecompensa(ADMIN, { ...base, costo: 10, vigenciaDesde: '2026-12-31', vigenciaHasta: '2026-01-01' })).rejects.toThrow(/vigencia/)
  })
})

describe('Configuración (RF16, RN04)', () => {
  it('CP-RF16: versionar una categoría no cambia los registros existentes', async () => {
    const { reciclaje } = await registrarReciclaje(datos({ cantidad: 2 }))
    await actualizarCategoria(ADMIN, 'cat-pet', { unidad: 'botella', puntosPorUnidad: 25, minimo: 1, maximo: 20 })
    expect(db().categorias.find((c) => c.id === 'cat-pet')?.version).toBe(2)
    const viejo = db().reciclajes.find((r) => r.id === reciclaje.id)!
    expect(viejo.puntosPorUnidad).toBe(10)
    expect(viejo.categoriaVersion).toBe(1)
    const nuevo = await registrarReciclaje(datos({ cantidad: 2 }))
    expect(nuevo.reciclaje.puntosEstimados).toBe(50)
  })
})

describe('Privacidad (RNF05)', () => {
  it('CP-RNF05: eliminar la cuenta anonimiza datos, borra fotos y conserva el historial', async () => {
    await crearCanje(ESTUDIANTE, 'rw-cafe', 'canje-7')
    const movimientos = db().movimientos.filter((m) => m.usuarioId === ESTUDIANTE).length
    eliminarCuentaLocal(ESTUDIANTE)
    const u = db().usuarios.find((x) => x.id === ESTUDIANTE)!
    expect(u.nombre).toBe('Cuenta eliminada')
    expect(u.correo).toMatch(/^eliminada-.*@anonimo\.invalid$/)
    expect(u.bloqueado && !!u.eliminadoEn).toBe(true)
    expect(db().reciclajes.filter((r) => r.usuarioId === ESTUDIANTE).every((r) => r.foto === '')).toBe(true)
    expect(db().reciclajes.filter((r) => r.usuarioId === ESTUDIANTE).some((r) => r.estado === 'pendiente' || r.estado === 'en_revision')).toBe(false)
    expect(db().canjes.every((c) => c.estado !== 'pendiente')).toBe(true)
    expect(db().movimientos.filter((m) => m.usuarioId === ESTUDIANTE).length).toBeGreaterThan(movimientos) // la devolución del canje
    expect(db().auditoria.some((a) => a.accion === 'Eliminar cuenta (anonimizada)')).toBe(true)
  })

  it('CP-RNF05: solo el titular de una cuenta de usuario puede eliminarla así', () => {
    expect(() => eliminarCuentaLocal(ADMIN)).toThrow(/administración/)
  })

  it('CP-RNF05: la retención borra solo fotos de registros decididos y antiguos', () => {
    const r = db().reciclajes
    r.find((x) => x.id === 'r-001')!.creadoEn = Date.now() - 100 * DIA // validado y antiguo
    r.find((x) => x.id === 'r-004')!.creadoEn = Date.now() - 100 * DIA // pendiente: se conserva
    aplicarRetencionFotos()
    expect(db().reciclajes.find((x) => x.id === 'r-001')?.foto).toBe('')
    expect(db().reciclajes.find((x) => x.id === 'r-004')?.foto).not.toBe('')
    expect(db().reciclajes.find((x) => x.id === 'r-002')?.foto).not.toBe('')
  })
})

describe('Universidades (RN01 ajustada)', () => {
  it('reconoce la universidad por el dominio exacto del correo', () => {
    expect(institucionPorCorreo(db(), 'ana@espol.edu.ec')?.siglas).toBe('ESPOL')
    expect(institucionPorCorreo(db(), 'beto@cu.ucsg.edu.ec')?.siglas).toBe('UCSG')
    expect(institucionPorCorreo(db(), 'luis@UEES.edu.ec')?.siglas).toBe('UEES')
    expect(institucionPorCorreo(db(), 'x@gmail.com')).toBeUndefined()
    expect(institucionPorCorreo(db(), 'x@falso-espol.edu.ec')).toBeUndefined()
  })

  it('un dominio pertenece a una sola universidad', async () => {
    await expect(guardarInstitucion(ADMIN, { nombre: 'Otra', siglas: 'OTRA', dominios: ['espol.edu.ec'], activa: true })).rejects.toThrow(/ya pertenece/)
  })
})

describe('Reportes (RF24, RF27)', () => {
  it('CP-RF24: los totales del reporte coinciden con los registros de origen', async () => {
    await cerrarLote(RECOLECTOR, 'p-biblioteca', [{ reciclajeId: 'r-004', accion: 'validar' }])
    const hoy = new Date().toISOString().slice(0, 10)
    const hace30 = new Date(Date.now() - 30 * DIA).toISOString().slice(0, 10)
    const filtros = { desde: hace30, hasta: hoy, puntoId: 'todos', categoriaId: 'todas', institucionId: 'todas' }
    const reporte = REPORTES.find((r) => r.id === 'reciclajes')!.generar(db(), filtros)
    expect(reporte.filas).toHaveLength(db().reciclajes.length)
    // Concilia con los movimientos que nacen de un reciclaje registrado (la semilla trae historial sin registro)
    const ids = new Set(db().reciclajes.map((r) => r.id))
    const acreditados = db().movimientos.filter((m) => m.tipo === 'reciclaje' && ids.has(m.referenciaId)).reduce((t, m) => t + m.puntos, 0)
    expect(reporte.totales?.puntos).toBe(acreditados)
    expect(REPORTES).toHaveLength(8)
  })

  it('el filtro por universidad deja fuera a las demás', () => {
    const hoy = new Date().toISOString().slice(0, 10)
    const filtros = { desde: '2020-01-01', hasta: hoy, puntoId: 'todos', categoriaId: 'todas', institucionId: 'inst-espol' }
    expect(REPORTES.find((r) => r.id === 'reciclajes')!.generar(db(), filtros).filas).toHaveLength(0)
    expect(db().usuarios.find((u) => u.id === DIEGO)?.institucionId).toBe('inst-demo')
  })
})
