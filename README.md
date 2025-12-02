# Banco Turing - Dashboard de Auditoría de Sesgos

Este proyecto construye un dataset unificado (DB + API de scoring) y un dashboard D3.js con 3 visualizaciones coordinadas para detectar posibles sesgos del modelo (“Scoring Turing”).

## 1) Requisitos

- Python 3.9+
- Pip

Instala dependencias:

```bash
pip install -r requirements.txt
```

## 2) ETL: Extracción y Enriquecimiento

El script `etl.py`:
1. Extrae clientes desde MySQL (solo lectura).
2. Llama a `predict_batch` para obtener `score_riesgo` y `decision_legacy`.
3. Genera `web/data.json` que alimenta el dashboard.

Credenciales por defecto (puedes sobreescribir con variables de entorno):

- `BT_DB_HOST` (default: `auth-db465.hstgr.io`)
- `BT_DB_NAME` (default: `u549055514_Banco_Turing`)
- `BT_DB_USER` (default: `u549055514_Turing`)
- `BT_DB_PASS` (default: `Salmos#100`)
- `BT_DB_PORT` (default: `3306`)
- `BT_PREDICT_URL` (default: `https://scoring-bancoturing.semilla42.com/predict_batch`)
- `BT_OUTPUT_PATH` (default: `web/data.json`)

Ejecuta:

```bash
python etl.py
```

Al finalizar, verás `web/data.json` con los campos esenciales:
`id_cliente, comuna, ingresos_mensuales, edad, sexo, nacionalidad, etnia, score_riesgo, decision_legacy, decision`.

## 3) Dashboard D3.js

Archivos:
- `web/index.html`
- `web/styles.css`
- `web/app.js`
- `web/data.json` (generado por el ETL)

Cómo visualizar en local (opciones):

- Abrir `web/index.html` directamente en el navegador (si tu navegador permite cargar `data.json` local).
- O servir la carpeta `web/` con un servidor simple, por ejemplo con Python:

```bash
cd web
python -m http.server 8000
# Visita: http://localhost:8000
```

## 4) Visualizaciones

1. Tasa de rechazo por comuna con control de ingresos (barras, top 12).  
2. Tasa por sexo y nacionalidad (dos paneles comparativos).  
3. Histograma de edad con apilamiento Aprobado vs Rechazado.  

Filtros globales: comuna, sexo, nacionalidad, umbral de ingresos y edad máxima. Las tres vistas se coordinan al cambiar filtros.

## 5) Despliegue (Enlace Web)

Puedes publicar la carpeta `web/` en:
- GitHub Pages: sube a un repo y configura Pages apuntando a `/web` o rama `gh-pages`.
- Netlify: arrastra y suelta la carpeta `web/` o conecta el repo y define `web` como directorio de publicación.

## 6) Notas

- El ETL usa lotes (batch) para la API. Ajusta `batch_size` en `etl.py` si lo requieres.
- Si la API retorna nombres alternativos de campos, el script intentará mapearlos a `score_riesgo` y `decision_legacy`.
- El dashboard evita gráficos de torta y prioriza color/posición/tamaño con ejes y leyendas claras.


