# Base de datos de EcoSmart AI (PostgreSQL)

Versión recomendada: **PostgreSQL 18** (compatible con 15 o superior).

## Instalar o actualizar

La forma más simple (crea la base si no existe y aplica las migraciones que falten):

```bash
powershell -ExecutionPolicy Bypass -File db\instalar.ps1
```

| Archivo | Contenido |
|---|---|
| `schema.sql` | 18 tablas, índices, reglas de inmutabilidad y vistas |
| `seed.sql` | Datos de demostración (contraseña de las cuentas: `EcoSmart2026`) |
| `migraciones/002_instituciones.sql` | Varias universidades con sus dominios de correo (RN01 ajustada) |
| `migraciones/003_servidor.sql` | Sesiones con token y bandeja de correo simulada |
| `migraciones/004_uees.sql` | Universidad Espíritu Santo (`uees.edu.ec`) |

## Conectar la página a PostgreSQL

1. `powershell -ExecutionPolicy Bypass -File server\configurar.ps1` — guarda la clave en `server/.env` (no se sube a git).
2. `npm run servidor` — API en http://localhost:3001/api.
3. `npm run dev:bd` — la página en http://localhost:5173 usando la base de datos.

Sin el servidor, `npm run dev` sigue funcionando en modo demostración (datos en el navegador).

## Reglas que garantiza la propia base de datos

- `movimiento_puntos`, `auditoria` y `categoria_version` no se pueden editar ni borrar.
- Un reciclaje validado o rechazado no vuelve a cambiar de estado.
- El rechazo exige motivo y corregir la cantidad exige motivo.
- La misma `idempotency_key` no crea dos reciclajes ni dos canjes.
- Un reciclaje acredita puntos una sola vez y un canje devuelve puntos una sola vez.
- Un recolector tiene como máximo una asignación activa por punto.
- Una recompensa activa necesita costo positivo y vigencia coherente.
- Solo se registran correos de universidades activas, y cada dominio pertenece a una sola universidad.
- Cambiar los puntos de una categoría crea una nueva versión automáticamente.

## Consultas útiles

```sql
SELECT * FROM v_saldo_usuario;           -- saldo confirmado y pendiente
SELECT * FROM v_ecoranking_mes;          -- ranking de personas
SELECT * FROM v_ranking_universidades;   -- ranking por universidad
SELECT * FROM v_material_por_categoria;  -- material recuperado
```

Diagrama: en pgAdmin, clic derecho sobre la base `ecosmart` → **ERD For Database**.
