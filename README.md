# Banco Turing - Dashboard de Auditoría de Sesgos

Este proyecto construye un dataset unificado (DB + API de scoring) y un dashboard D3.js con 3 visualizaciones coordinadas para detectar posibles sesgos del modelo (“Scoring Turing”).

## 1) Objetivo y contexto

La gerencia sospecha que el modelo de crédito “Scoring Turing” podría discriminar por comuna, nacionalidad/sexo o edad. Este trabajo no corrige el modelo: lo “acusa” mediante un dashboard que muestra patrones de rechazo y score controlando por ingreso.

Preguntas de negocio (Por qué):
- ¿La tasa de rechazo es más alta en comunas pobres a igual nivel de ingreso?
- ¿Se castiga el score solo por ser extranjero?
- ¿Existen grupos de edad excluidos?

## 2) Requisitos

- Python 3.9+
- Pip

Instala dependencias:

```bash
pip install -r requirements.txt
```

## 3) ETL: Extracción y Enriquecimiento

El script `etl.py`:
1. Extrae clientes desde MySQL (solo lectura).
2. Llama a `predict_batch` para obtener `score_riesgo` y `decision_legacy`.
3. Genera `docs/data.json` que alimenta el dashboard (listo para GitHub Pages).

Credenciales por defecto (puedes sobreescribir con variables de entorno):

- `BT_DB_HOST` (default: `auth-db465.hstgr.io`)
- `BT_DB_NAME` (default: `u549055514_Banco_Turing`)
- `BT_DB_USER` (default: `u549055514_Turing`)
- `BT_DB_PASS` (default: `Salmos#100`)
- `BT_DB_PORT` (default: `3306`)
- `BT_PREDICT_URL` (default: `https://scoring-bancoturing.semilla42.com/predict_batch`)
- `BT_OUTPUT_PATH` (default: `docs/data.json`)

Ejecuta:

```bash
python etl.py
```

Al finalizar, verás `web/data.json` con los campos esenciales:
`id_cliente, comuna, ingresos_mensuales, edad, sexo, nacionalidad, etnia, score_riesgo, decision_legacy, decision`.

## 4) Dashboard D3.js

Estructura:
- `docs/index.html` (página principal para publicar)
- `docs/styles.css`
- `docs/app.js`
- `docs/data.json` (generado por el ETL)

Cómo visualizar en local (opciones):

- Abrir `docs/index.html` directamente en el navegador (algunos navegadores bloquean fetch a archivos locales).
- O servir la carpeta `docs/` con un servidor simple, por ejemplo con Python:

```bash
cd docs
python -m http.server 8000
# Visita: http://localhost:8000
```

## 5) Visualizaciones (3 coordinadas)

1) Tasa de rechazo por comuna (barras, top 12). Use “Banda de ingresos”/umbrales para comparar comunas a igual nivel de ingreso. Tooltip muestra n y rechazados. Ajusta el mínimo de muestra (por defecto n≥20) en `app.js` si lo requieres.

2) Score por nacionalidad: boxplot (Chilena vs Extranjera) con puntos jitter y Δ de medias. Se interpreta la diferencia de medias dentro del mismo tramo de ingresos. Si Δ<0 (Extranjera menor), hay evidencia de castigo a extranjeros.

3) ¿Grupos de edad excluidos? Histograma por edad (aprobado/rechazado) con una línea de tasa de rechazo. Picos altos indican tramos etarios con mayor probabilidad de rechazo relativo.

Filtros globales: comuna, sexo, nacionalidad, banda/umbral de ingresos y edad máxima. Las 3 vistas se coordinan.

Subtítulos dinámicos: bajo cada gráfico se resume el “top” o las diferencias relevantes (top comunas por tasa, Δ de medias en score, tramo etario con mayor tasa).

## 6) Despliegue (Enlace Web)

Publicar `docs/`:
- GitHub Pages: Settings → Pages → Source: Deploy from a branch → Branch: `main` / Folder: `/docs`.
- Netlify: directorio de publicación = `docs/`.

## 7) Notas

- El ETL usa lotes (batch) para la API. Ajusta `batch_size` en `etl.py` si lo requieres.
- Si la API retorna nombres alternativos de campos, el script intentará mapearlos a `score_riesgo` y `decision_legacy`.
- El dashboard evita tortas y prioriza color/posición/tamaño con ejes/leyendas claras. Las vistas están coordinadas y tienen filtros interactivos.


