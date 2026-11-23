# Continuidad operativa, capacidad y seguridad

Evidencia y procedimientos para **RNF02** (tiempos), **RNF04** (seguridad), **RNF06** (disponibilidad
y respaldo diario), **RNF09** (capacidad), **RNF11** (calidad de la IA) y **RNF12** (recuperación).

| Requisito | Criterio de aceptación | Resultado | Evidencia |
|---|---|---|---|
| RNF02 | p95 de páginas ≤ 2 s | p95 **0,24 s** solo páginas; **0,98 s** con 10 % de escrituras | `docs/evidencias/carga-*.json` |
| RNF09 | 5000 cuentas y 100 usuarios concurrentes, errores < 1 % | 5009 cuentas, 100 concurrentes, **0 %** de errores en 3 corridas seguidas | `docs/evidencias/carga-mixta-100-usuarios.json` |
| RNF06 | Monitoreo calcula disponibilidad ≥ 99 %; cada respaldo deja evidencia | Monitor cada 5 min + informe; registro CSV con SHA-256 por respaldo | `monitoreo/disponibilidad.csv`, `db/respaldos/registro-respaldos.csv` |
| RNF12 | RPO 24 h, RTO 4 h; restauración probada antes de cada entrega | Respaldo **1,1 s**; restauración en base separada **2,7 s** con conteos idénticos | `db/respaldos/registro-restauraciones.csv` |
| RNF04 | Rechazar roles no autorizados, archivos inválidos y exceso de peticiones; sin secretos en logs | Validación de fotos JPEG, cabeceras de seguridad, HTTPS forzable, logs sin cuerpos | Pruebas `CP-RNF04` en `server/api.test.ts` |
| RNF11 | F1 macro ≥ 85 % y recall ≥ 80 % por categoría en un conjunto separado | Herramienta lista; **falta el conjunto de fotos del equipo** | `ia/evaluacion/README.md` |

Medido el 22 de noviembre de 2026 en un portátil AMD Ryzen 9 270 con 15 GB de RAM, Windows 11,
Node.js 24.22 y PostgreSQL 18.7, con la API y la base en el mismo equipo.

---

## 1. Respaldos (RNF06, RNF12)

`db/respaldo.ps1` crea un archivo en formato personalizado de PostgreSQL, comprueba con
`pg_restore --list` que se pueda leer, calcula su SHA-256 y agrega una línea a
`db/respaldos/registro-respaldos.csv` (fecha, archivo, bytes, segundos, sha256, resultado).
Nunca escribe la contraseña.

```powershell
powershell -ExecutionPolicy Bypass -File db\respaldo.ps1                  # pide la clave
powershell -ExecutionPolicy Bypass -File db\respaldo.ps1 -RetencionDias 7 # además borra respaldos de más de 7 días
powershell -ExecutionPolicy Bypass -File db\verificar-respaldo.ps1 -Archivo db\respaldos\ecosmart-AAAAMMDD-HHMMSS.dump
```

La retención solo borra archivos `ecosmart-*.dump` de la carpeta de destino. `db/respaldos/` está
fuera de Git.

**Resultado:** respaldo de 144 KB en 1,1 s, verificado (183 objetos listados por `pg_restore`).

### Simulacro de recuperación

`db/restaurar-prueba.ps1` restaura en una base **separada** (por defecto `ecosmart_restauracion`),
nunca sobre `ecosmart` ni sobre una base existente; compara las filas de `usuario`, `reciclaje`,
`movimiento_puntos`, `canje` y `auditoria` con la base de origen y anota el resultado en
`db/respaldos/registro-restauraciones.csv`.

```powershell
powershell -ExecutionPolicy Bypass -File db\restaurar-prueba.ps1 -Archivo db\respaldos\ecosmart-AAAAMMDD-HHMMSS.dump -BorrarAlTerminar
```

**Resultado:** 23 tablas restauradas en 2,7 s, conteos idénticos a la base original. Frente al RTO de
4 horas, el margen es amplio; el tiempo real de recuperación lo dominan instalar PostgreSQL y
configurar el servidor (~30 minutos siguiendo el README).

También se comprobó que el script rechaza un respaldo alterado (SHA-256 distinto) y que se niega a
restaurar sobre `ecosmart`.

### Clave para las tareas programadas

Las tareas corren sin nadie frente al equipo, así que la clave va en el archivo estándar de
PostgreSQL, visible solo para la cuenta de Windows que ejecuta la tarea:

```powershell
New-Item -ItemType Directory -Force "$env:APPDATA\postgresql" | Out-Null
notepad "$env:APPDATA\postgresql\pgpass.conf"
```

Escriba una línea `localhost:5432:ecosmart:postgres:SU_CLAVE`, guarde, y restrinja el acceso:

```powershell
icacls "$env:APPDATA\postgresql\pgpass.conf" /inheritance:r /grant:r "${env:USERNAME}:F"
```

Con `-Desatendido`, `respaldo.ps1` nunca pide la clave por teclado: si no encuentra este archivo
termina con un error claro en vez de quedarse esperando.

## 2. Programación diaria y monitoreo (RNF06)

`db/programar-tareas.ps1` registra dos tareas en el Programador de tareas de Windows, con la cuenta
actual:

| Tarea | Qué hace | Cuándo |
|---|---|---|
| EcoSmart - respaldo diario | `db\respaldo.ps1 -Desatendido -RetencionDias 7` | Todos los días a las 02:00; si el equipo estaba apagado, al encenderlo |
| EcoSmart - monitoreo | `scripts\monitor-disponibilidad.mjs` contra `/api/salud` | Cada 5 minutos |

```powershell
powershell -ExecutionPolicy Bypass -File db\programar-tareas.ps1          # registrar
powershell -ExecutionPolicy Bypass -File db\programar-tareas.ps1 -Quitar  # quitar
```

`/api/salud` responde solo si la API funciona **y** PostgreSQL contesta. Cada verificación agrega una
línea a `monitoreo/disponibilidad.csv` (fuera de Git).

### Informe de disponibilidad

```powershell
node scripts\monitor-disponibilidad.mjs --informe --desde=2026-11-01 --hasta=2026-11-30
```

Cuenta solo el **horario académico** (por defecto lunes a viernes 07:00–21:00 y sábado 07:00–13:00;
se cambia con `--horario="1-5@07:00-21:00;6@07:00-13:00"`). Muestra:

- **Disponibilidad** = verificaciones exitosas / verificaciones hechas, contra la meta de 99 %.
- **Cobertura** = verificaciones hechas / esperadas. Si el equipo estuvo apagado, el monitor tampoco
  corrió: el informe lo avisa en vez de mostrar una disponibilidad inflada.
- Cada caída con su inicio y fin.

Comprobado con una semana sintética (912 verificaciones, una caída de 30 minutos): 99,34 %, cumple;
y con datos incompletos avisa cobertura de 55 %.

## 3. Capacidad y tiempos (RNF02, RNF09)

### Datos de la prueba

Base separada `ecosmart_carga` (nunca la real), llenada con `scripts/poblar-carga.mjs`:
**5009 cuentas**, 20 302 reciclajes, 16 003 movimientos de puntos, 10 000 notificaciones y 100
sesiones distintas.

```powershell
node --env-file=server/.env scripts/poblar-carga.mjs --base=ecosmart_carga --cuentas=5000 --sesiones=100
```

Servidor de prueba en otro puerto, apuntando a esa base (en una terminal aparte: las variables
quedan solo en esa terminal):

```powershell
$env:PGDATABASE='ecosmart_carga'; $env:PUERTO='3101'; $env:BANDEJA_DEMO='0'; $env:LIMITE_AUTH='100000'; $env:LIMITE_ACCIONES='100000'
npm.cmd run servidor
```

`LIMITE_AUTH` y `LIMITE_ACCIONES` se suben **solo en la prueba**: los 100 usuarios simulados salen de
una misma IP, y el límite por IP (RNF04) los frenaría como si fueran uno solo.

```powershell
# Solo páginas: 1000 consultas, 100 a la vez, cada una con la sesión de un usuario distinto
node scripts/prueba-carga.mjs --url=http://localhost:3101/api --ruta=estado --tokens=scripts/tokens-carga.json --solicitudes=1000 --concurrencia=100
# Mixta: además, el 10 % registra un reciclaje real (con foto JPEG), cada uno con otra cuenta
node scripts/prueba-carga.mjs --url=http://localhost:3101/api --ruta=estado --tokens=scripts/tokens-carga.json --solicitudes=1000 --concurrencia=100 --escrituras=10
# Para repetirla el mismo día sin chocar con el tope de 10 registros diarios por cuenta
node --env-file=server/.env scripts/limpiar-carga.mjs --base=ecosmart_carga
```

La prueba no deja pausas entre solicitudes: 100 trabajadores piden una tras otra, lo que equivale a
mucho más tráfico que 100 personas usando la app.

### Resultados

| | Antes | Después: solo páginas | Después: mixta (10 % escrituras) |
|---|---|---|---|
| Errores | **93,5 %** (tiempos agotados) | 0 % | 0 % |
| p50 | 10 s | 0,14 s | 0,07 s |
| p95 | 10 s | **0,24 s** | **0,98 s** |
| p95 de las escrituras | — | — | 1,50 s |
| Solicitudes por segundo | 9,9 | 647 | 487 |
| Tamaño de cada respuesta | 5,2 MB | 117 KB (16 KB comprimida) | 117 KB |

La mixta se corrió **tres veces seguidas** con 0 % de errores (p95 de escrituras 1,63 s, 1,37 s y
1,50 s). El servidor informa en la cabecera estándar `Server-Timing` en qué se va el tiempo de cada
acción (autenticación, espera en la fila, base de datos y armado de la respuesta), y la prueba lo
resume en `servidorEscrituras`.

### Qué se cambió para lograrlo

1. **Copia en memoria para consultar.** Antes, cada página releía toda la base y esperaba a las
   escrituras. Ahora las consultas leen una copia en memoria que se reemplaza en cada escritura
   confirmada y se relee de PostgreSQL cada 15 s por si alguien cambió datos desde fuera.
2. **Cada rol recibe solo lo suyo**: el estudiante, sus datos y el EcoRanking ya calculado (50
   primeros y su fila, solo de su universidad y de "todas", las dos opciones de la pantalla), no el
   libro completo. El ranking se calcula una vez por cambio de puntos, no en cada consulta.
3. **Las fotos no viajan con los datos** ni se guardan en memoria: se piden una por una a
   `/api/foto/:id`, que vuelve a comprobar el permiso (RNF05).
4. **Commit en grupo.** Las acciones que llegan mientras se guarda otra esperan juntas y se guardan
   en una sola transacción; cada una se valida con sus propias reglas y una que falla no afecta a las
   demás (prueba `CP-RNF09` en `server/api.test.ts`).
5. **Registros de solo lectura en el servidor.** Cada acción intenta primero sin copiar las 20 000
   filas: si solo agrega registros (registrar un reciclaje) no copia nada; si quiere cambiar uno
   existente, JavaScript lo impide y la acción se repite con la copia completa (pruebas `CP-RNF09` en
   `src/data/reglas.test.ts`).
6. Copia de tablas con `{...registro}` (≈ 2 ms frente a ≈ 100 ms de `structuredClone`), huellas de
   fotos convertidas una sola vez, índices por usuario reutilizados entre versiones y respuestas
   comprimidas.

Costo de registrar un reciclaje en memoria: de 70 ms a 5 ms.

### Límites conocidos

- La copia en memoria está pensada para **un solo servidor**. Con varios, las escrituras siguen
  siendo seguras (se serializan con un bloqueo de PostgreSQL y solo se escriben las columnas que
  cambiaron), pero cada servidor podría mostrar datos con hasta `CACHE_MS` de atraso: en ese caso,
  bajar `CACHE_MS` o compartir el estado (por ejemplo con Redis, como prevé la matriz).
- El EcoRanking puede tardar hasta 10 s (`RANKING_MS`) en reflejar un cambio de nombre o de
  facultad; los puntos y el anonimato se reflejan al instante.

## 4. Seguridad (RNF04)

- **Fotos:** el servidor no confía en el navegador. Acepta solo `data:image/jpeg;base64`, base64
  válido, de 100 bytes a 600 KB, con estructura JPEG real (inicio, encabezado con dimensiones y fin)
  y entre 32 y 4096 píxeles por lado. Revisa también el tipo y el largo de cada dato del registro.
  Todo esto antes de entrar a la fila de escrituras.
- **Fecha:** la fecha del registro la pone el servidor; antes un navegador podía fechar registros en
  días anteriores para esquivar el tope diario.
- **Logs:** el error de JSON mal formado traía el cuerpo de la petición (con la contraseña, si era un
  inicio de sesión) y se imprimía completo. Ahora responde 400 y solo se registra el mensaje y la pila
  de errores internos.
- **Cabeceras:** `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
  `Cross-Origin-Opener-Policy`, `Permissions-Policy` (cámara solo para la propia página), CSP estricta
  en la API, `Cache-Control: no-store` en respuestas personales, y en la página compilada una CSP que
  solo permite el código propio, el motor de la IA (jsDelivr) y el modelo (Hugging Face). Se comprobó
  en el navegador que la IA descarga e inicia el modelo con la CSP activa.
- **HTTPS:** en producción, `FORZAR_HTTPS=1` redirige todo a HTTPS y activa HSTS; detrás de un proxy,
  `CONFIAR_PROXY=1` toma la IP real y el protocolo de sus cabeceras.

## 5. Variables de entorno del servidor

| Variable | Por defecto | Para qué |
|---|---|---|
| `PUERTO` | 3001 | Puerto de la API |
| `PG_POOL_MAX` | 10 | Conexiones simultáneas a PostgreSQL |
| `CACHE_MS` | 15000 | Cada cuánto se relee la base aunque no haya escrituras |
| `RANKING_MS` | 10000 | Atraso máximo del ranking cuando no cambian puntos |
| `LOTE_MAXIMO` | 50 | Acciones por transacción en el commit en grupo |
| `MANTENIMIENTO_MS` | 60000 | Cada cuánto se vencen canjes y se aplica la retención de fotos |
| `LIMITE_AUTH` | 20 | Intentos de autenticación por IP y minuto |
| `LIMITE_ACCIONES` | 120 | Acciones por IP y minuto |
| `FORZAR_HTTPS` | — | `1` en producción con HTTPS |
| `CONFIAR_PROXY` | — | `1` si hay un proxy delante |
| `BANDEJA_DEMO` | 1 | `0` para apagar la bandeja de correo simulada |

## 6. Frecuencia

| Control | Frecuencia | Evidencia |
|---|---|---|
| Respaldo de PostgreSQL | Diario (tarea programada) | `registro-respaldos.csv`: archivo, SHA-256, verificación |
| Monitoreo de disponibilidad | Cada 5 minutos (tarea programada) | `monitoreo/disponibilidad.csv` |
| Informe de disponibilidad | Mensual | Salida de `--informe` |
| Simulacro de restauración | Antes de cada entrega mayor y mensual | `registro-restauraciones.csv` |
| Prueba de carga | Antes de cada entrega mayor | `docs/evidencias/carga-*.json` |
| Evaluación de la IA | Al cambiar el modelo o sus descripciones | `docs/evidencias/evaluacion-ia.json` |
| Revisión de RPO y RTO | Semestral | Acta de revisión |
