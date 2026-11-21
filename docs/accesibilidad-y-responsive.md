# Verificación de accesibilidad (RNF08) y diseño responsive (RNF01)

Fecha: 21 de noviembre de 2026 · Estándar: **WCAG 2.2, nivel AA** · Herramienta: axe-core 4.14 (reglas `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`) más pruebas manuales con teclado.

## Alcance

35 vistas de los cuatro roles: 6 públicas, 10 del usuario, 5 del recolector, 11 del administrador y 3 del aliado, más 11 ventanas emergentes (8 del administrador y 3 del usuario: confirmar canje, detalle de reciclaje y eliminar cuenta).

## Resultado

| Criterio | Resultado |
|---|---|
| axe-core, WCAG 2.2 AA | **0 incumplimientos** en las 35 vistas y 11 ventanas |
| Sin desplazamiento horizontal a 360 px | Cumple (34 vistas) |
| Sin desplazamiento horizontal a 768 px | Cumple (32 vistas) |
| Sin desplazamiento horizontal a 1280 px | Cumple (32 vistas) |
| Texto al 200 % (1280 px) | Cumple en las 7 vistas probadas del usuario, sin pérdida de contenido |
| Enlace "Saltar al contenido" | Primer elemento con Tab; lleva el foco al contenido principal |
| Foco visible | Contorno terracota de 3 px en todos los controles, incluidos los campos de texto |
| Ventanas emergentes | Se abren con Enter, el foco entra a la ventana, Escape la cierra y el foco vuelve al botón |
| Menú del celular | Se abre con el botón (anuncia "Abrir/Cerrar menú") y se cierra con Escape |
| Alternativa al QR | Código impreso que se escribe a mano (RF07) |
| Idioma | Interfaz en español, `lang="es"` |

## Problemas encontrados y corregidos

1. **Contraste del terracota.** El texto blanco sobre `#d9622b` daba 3,66:1 (mínimo 4,5:1). Se oscureció a `#b04a1c` (5,47:1). También se ajustaron el gris secundario (`#626155`, 4,9:1 sobre beige) y los tonos de "advertencia" y "correcto" de las etiquetas.
2. **Nombre accesible del logo.** El lector de pantalla anunciaba un texto distinto del visible (WCAG 2.5.3). Ahora el nombre contiene el texto visible.
3. **Texto semitransparente.** Insignias pendientes, filas inactivas, recompensas agotadas, canjes vencidos, universidades inactivas y filas excluidas de un lote bajaban el contraste del texto. Ahora solo se atenúan íconos e imágenes.
4. **Tablas anchas.** Las tablas que se desplazan de lado no se podían recorrer con teclado. Ahora son regiones enfocables.
5. **Foco en campos de texto.** El halo lima casi no se distinguía; se reemplazó por el contorno terracota común.
6. **Encabezado en celular.** A 360 px el botón de menú se salía 6 px; "Salir" pasó al menú desplegable.
7. **Pestañas del EcoRanking.** A 360 px se salían 32 px; ahora bajan de línea.
8. **Pantalla de ingreso.** A 360 px se salía 38 px por los correos de las cuentas demo; ahora se recortan con puntos suspensivos.
9. **Auditoría.** Detalles con palabras largas desbordaban a 360 px; ahora se cortan.

## Pendiente antes del piloto

- Prueba con lector de pantalla real (NVDA en Windows o TalkBack en Android) por una persona del equipo.
- Repetir esta verificación si se agregan pantallas nuevas.
