# Fase 1 — Base del motor (cerrada)

Rama `formato-documental`. Solo se tocó el motor del formato animado (`backend/motion/src/scenes/` y `src/lib/fechas.ts`). No se tocaron agentes, pipeline, frontend ni base de datos.

## 1. Resumen de cambios
| Commit | Punto | Qué hace |
|---|---|---|
| `04f2a61` + `966d547` | 1 · Colores | Paleta fija del formato (`scenes/palette.ts`): rojo peligro, verde seguro, **naranja foco** para el acento de los dibujos, azul solo para el texto resaltado. Ignora la paleta del nicho |
| `4c9340f` | 2 · Movimiento de base | Toda escena se acerca un 8 % y se desliza un 1,8 % del ancho, con curva suave, aunque el plan no tenga pasos |
| `7103442` | 3 · Sin zoom | Los pasos `camera` abren una **lupa** (`scenes/Lupa.tsx`) que no mueve el encuadre; prueba arriba, derecha, izquierda y abajo, y elige la que no tapa dibujos |
| `f4a7c0b` | 4 · Fundidos | Fundido cruzado de 0,6 s entre escenas |
| (punto 5) | 5 · Fechas | `lib/fechas.ts`: "26 de abril de 1986" → "26/04/1986" en textos, etiquetas, gráficos y capa fija |
| (punto 6) | 6 · Subtítulos | `Captions.tsx`: abajo al centro, chicos, crecen palabra por palabra, la actual en azul subrayada, color según el fondo |

**Afuera:** explosión (se reemplaza con el recurso `evento` en la Fase 2), "nada rojo antes del remate" (Fase 3, el plan todavía no marca el remate) y conectar los subtítulos al render de producción.

## 2. Métricas (salida real de `medir-movimiento.py`, plan `pruebas-video/plan-escenas-30s-revisado.json`, sin audio)
| Render | Congelados cada 30 s | Pico/media |
|---|---|---|
| Antes (motor anterior) | **11** | 5,8 |
| Fase 1, sin subtítulos (como sale hoy en producción) | **0** | 6,5 |
| Fase 1, con subtítulos (pasados a mano en el JSON) | **0** | 6,2 |

**Criterio de éxito (≤ 2 cada 30 s): cumplido.** El remate sigue por debajo de la referencia (8–9), porque depende de la idea del plan (Fases 2 y 3).

## 3. Checklist de reglas
| Regla | Estado | Evidencia |
|---|---|---|
| Distribuciones fijas | ❌ | Las posiciones las sigue eligiendo la IA (`x/y/w`): Fases 2 y 3 |
| Lugares fijos (título, capítulo, subtítulo, suelo) | ⚠️ parcial | Capítulo arriba a la derecha y subtítulo abajo al centro sí; título de escena y suelo dependen del plan |
| Fondo claro u oscuro | ⚠️ | El motor lo soporta; el plan de Chernobyl no lo pide para el reactor |
| Colores con significado | ✅ | `palette.ts`; sin azul en dibujos ni en el lienzo |
| Nada rojo antes del remate | no aplica | El plan no marca el remate (Fase 3) |
| Ritmo sin congelados | ✅ | 11 → 0 |
| Fundidos | ✅ | 0,6 s |
| Sin explosiones | ❌ | La "explosión" del plan es un dibujo de la IA; se reemplaza en la Fase 2 |
| Fechas DD/MM/AAAA | ✅ | `lib/fechas.ts` |
| Sin coordenadas de la IA | ❌ | Fases 2 y 3 |
| Sincronía por palabra intacta | ✅ | No se tocó: los pasos siguen en su `at` |

## 4. Mapa de comunicación (solo lectura, sin cambios)
Orquestador = `directAnimatedScenesManaged` (`managedSceneDirector.ts`). No hay llamadas directas entre agentes: todas las herramientas las responde `SceneTools.run` en nuestro proceso. Sí hay salidas de un agente que llegan a otro:
1. `managedSceneDirector.ts:689` / `sceneReview.ts:96-101`: el Auditor lee los veredictos del Revisor.
2. `managedSceneDirector.ts:358-361` + `:696`: Escenas recibe correcciones del Revisor/Auditor y su versión anterior.
3. `managedSceneDirector.ts:681-698`: ida y vuelta Revisor/Auditor ↔ Escenas (`REVIEW_ROUNDS = 2`).
4. `managedSceneDirector.ts:354-357`: Escenas lee la biblioteca de los Dibujantes.
5. `managedSceneDirector.ts:327-331`: los Dibujantes leen la lista de componentes del Director.
6. `managedSceneDirector.ts:624, 635`: una sola instancia de `SceneTools` compartida por todas las sesiones en paralelo.
7. `sceneDirector.ts:672-680` (respaldo): los diseñadores reciben la estructura del Director.

## 5. Dudas y riesgos
- **Subtítulos en producción:** `renderAnimated` (`renderVideo.tool.ts:1305-1314`) no pasa `captions` al motor, y el plan tampoco los trae. El estilo está listo, pero en un video real no aparecen hasta tocar el pipeline (no autorizado en esta fase).
- **Paleta del nicho:** el formato animado ya no usa la paleta del nicho. Afecta solo a este formato.
- **Movimiento de base:** ahora es más visible (8 %). Si se siente mareante, se baja en `Scene.tsx` (`CAMERA_ZOOM`, `CAMERA_DRIFT`).
- **Lupa:** se ubica con las cajas de los dibujos; con escenas muy cargadas puede tapar algo.
- **Fechas:** reconoce "D de mes de AAAA" y variantes. No toca fechas parciales ("abril de 1986") ni horas.
- **Audio:** los renders de prueba no tienen voz (el audio está en R2 y no se llega desde este entorno). No afecta las métricas.
