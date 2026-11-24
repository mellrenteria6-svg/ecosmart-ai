# Conjunto de prueba de la IA (RNF11)

RNF11 pide que el clasificador, **en un conjunto de prueba separado**, logre **F1 macro ≥ 85 %** y
**recall ≥ 80 % en cada categoría**, y que cada inferencia registre la versión del modelo
(cada reciclaje guarda `modelo_version`, hoy `clip-vit-b32-q8-sonda-1.1`).

## Dos carpetas, dos usos

| Carpeta | Para qué | Comando |
|---|---|---|
| `ia/entrenamiento/` | **Práctica**: la IA aprende de estas fotos cómo se ve cada material | `npm.cmd run ia:entrenar` |
| `ia/evaluacion/` | **Examen**: fotos nuevas que la IA nunca vio; solo se usan para medir | `npm.cmd run ia:evaluar` |

Nunca pongas la misma foto en las dos: si la IA aprende de una foto y luego la evalúa con esa
misma, el resultado no vale (sería darle las respuestas del examen).

### Versión 1.1 (24 de noviembre de 2026)

Se entrenó con 68 fotos de práctica (las primeras que juntó el equipo). Estimación dejando una
foto fuera cada vez: **F1 macro 66,3 % (1.0) → 76,4 % (1.1)**; latas 58 % → 83 %, vidrio 30 % → 50 %.
Detalle en `docs/evidencias/entrenamiento-ia.json`. Muchas de esas fotos tenían varios residuos
mezclados o eran de internet; con fotos propias de un solo residuo, la IA debería mejorar más.

## Cómo armar el conjunto

Una carpeta por categoría, con el identificador exacto (igual en `ia/entrenamiento/`):

```
ia/evaluacion/
  cat-pet/        botellas PET (agua, gaseosa, jugo)
  cat-papel/      papel y cartón
  cat-vidrio/     botellas y frascos de vidrio
  cat-lata/       latas de aluminio
  cat-tetra/      Tetra Pak (leche, jugo)
  cat-plastico/   otros plásticos (tarrinas, vasos, envases, tapas)
  ninguno/        (opcional) fotos que NO son residuos: personas, mesas, celulares…
```

Reglas para que la medición sea válida:

1. **Al menos 30 fotos por categoría** (mejor 50). Con menos, el script avisa y no aprueba.
2. **Separado de verdad**: ninguna de estas fotos puede haberse usado para elegir o ajustar las
   descripciones de `scripts/generar-embeddings-ia.ts`. Tómenlas después de fijar la versión.
3. **Como en el uso real**: con el celular, en los puntos del campus, con distinta luz, fondo,
   ángulo y estado (aplastado, sucio, con etiqueta o sin ella). Un objeto por foto.
4. **Sin datos personales** (RNF05): que no salgan caras, carnés ni pantallas con información.
5. Formatos: `.jpg`, `.jpeg`, `.png` o `.webp`. Pueden ir tal como salen del celular: la app las
   reduce a 960 px antes de clasificar, pero CLIP trabaja a 224 px, así que el resultado es el mismo.

Las fotos **no se suben a Git** (están en `.gitignore`): guárdenlas en la carpeta compartida del
equipo. El informe registra una huella SHA-256 del conjunto, así se sabe exactamente qué fotos
dieron cada resultado.

## Cómo correr la evaluación

```powershell
npm.cmd run ia:evaluar
```

La primera vez descarga el modelo (~150 MB) a `~/.cache/ecosmart-ia`. Muestra precisión, recall y
F1 por categoría, el F1 macro y la matriz de confusión, y guarda el informe en
`docs/evidencias/evaluacion-ia.json` (con la lista de fotos mal clasificadas para revisarlas).
Termina con código 0 si cumple, 1 si no cumple y 2 si no hay fotos.

## Si no cumple

1. Revisen `errores` en el informe: qué se confunde con qué.
2. Ajusten las descripciones en `scripts/generar-embeddings-ia.ts`, **suban la versión**
   (`VERSION_MODELO` en `src/lib/ia-puntaje.ts`, por ejemplo `clip-vit-b32-q8-zs-1.1`) y regeneren:
   `npm.cmd run ia:embeddings`.
3. Para no "aprenderse" la prueba, ajusten con **otro** grupo de fotos (de validación) y usen este
   conjunto solo para la medición final.
