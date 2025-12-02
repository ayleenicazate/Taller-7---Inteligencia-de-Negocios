import os
import sys
import math
import json
from typing import List, Dict, Any

import requests
import pandas as pd
import mysql.connector
from mysql.connector import MySQLConnection


DB_HOST = os.getenv("BT_DB_HOST", "auth-db465.hstgr.io")
DB_NAME = os.getenv("BT_DB_NAME", "u549055514_Banco_Turing")
DB_USER = os.getenv("BT_DB_USER", "u549055514_Turing")
DB_PASS = os.getenv("BT_DB_PASS", "Salmos#100")
DB_PORT = int(os.getenv("BT_DB_PORT", "3306"))

PREDICT_ENDPOINT = os.getenv(
    "BT_PREDICT_URL",
    "https://scoring-bancoturing.semilla42.com/predict_batch",
)

OUTPUT_PATH = os.getenv("BT_OUTPUT_PATH", os.path.join("docs", "data.json"))


def connect_mysql() -> MySQLConnection:
    return mysql.connector.connect(
        host=DB_HOST,
        user=DB_USER,
        password=DB_PASS,
        database=DB_NAME,
        port=DB_PORT,
        auth_plugin="mysql_native_password",
    )


def extract_solicitudes_joined(limit: int = 3000) -> pd.DataFrame:
    query = f"""
        SELECT
            s.id_solicitud,
            c.id_cliente,
            c.ingresos_mensuales,
            c.anios_empleo,
            c.tipo_contrato,
            c.deuda_total,
            c.limite_tc,
            c.comportamiento_pago,
            c.fecha_alta_cliente,
            c.edad,
            c.sexo,
            c.nacionalidad,
            c.comuna,
            COALESCE(c.etnia, 'No Informado') AS etnia,
            s.monto_solicitado,
            s.plazo_meses,
            s.tipo_producto,
            s.canal_origen,
            s.tasa_interes_anual,
            s.fecha_solicitud,
            s.incumplio,
            COALESCE(hp.max_dias_mora_historico, 0) AS max_dias_mora_historico,
            COALESCE(hp.cantidad_atrasos, 0) AS cantidad_atrasos,
            COALESCE(br.patrimonio_inmobiliario, 0) AS patrimonio_inmobiliario,
            COALESCE(br.tiene_propiedad_en_remate, 0) AS tiene_propiedad_en_remate
        FROM solicitudes_credito s
        JOIN clientes c ON c.id_cliente = s.id_cliente
        LEFT JOIN (
            SELECT id_cliente,
                   MAX(dias_atraso) AS max_dias_mora_historico,
                   SUM(CASE WHEN dias_atraso > 0 THEN 1 ELSE 0 END) AS cantidad_atrasos
            FROM historial_pagos
            GROUP BY id_cliente
        ) hp ON hp.id_cliente = c.id_cliente
        LEFT JOIN (
            SELECT id_cliente,
                   SUM(avaluo_fiscal) AS patrimonio_inmobiliario,
                   MAX(CASE WHEN en_remate = 1 THEN 1 ELSE 0 END) AS tiene_propiedad_en_remate
            FROM bienes_raices
            GROUP BY id_cliente
        ) br ON br.id_cliente = c.id_cliente
        LIMIT {limit}
    """
    conn = connect_mysql()
    try:
        df = pd.read_sql(query, conn)
        return df
    finally:
        conn.close()


def coerce_types(df: pd.DataFrame) -> pd.DataFrame:
    numeric_cols = [
        "ingresos_mensuales",
        "anios_empleo",
        "deuda_total",
        "limite_tc",
        "comportamiento_pago",
        "edad",
        "monto_solicitado",
        "plazo_meses",
        "tasa_interes_anual",
        "max_dias_mora_historico",
        "cantidad_atrasos",
        "patrimonio_inmobiliario",
        "tiene_propiedad_en_remate",
    ]
    for c in numeric_cols:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    # Normalizaciones básicas
    if "sexo" in df.columns:
        df["sexo"] = df["sexo"].astype(str).str.upper().str.strip()
        df["sexo"] = df["sexo"].where(df["sexo"].isin(["M", "F"]), other="NA")

    for cat_col in ["nacionalidad", "comuna", "etnia", "tipo_contrato"]:
        if cat_col in df.columns:
            df[cat_col] = df[cat_col].astype(str).str.strip()

    # Fechas a string ISO (evita error JSON serializable)
    if "fecha_alta_cliente" in df.columns:
        df["fecha_alta_cliente"] = pd.to_datetime(df["fecha_alta_cliente"], errors="coerce").dt.strftime("%Y-%m-%d")
    if "fecha_solicitud" in df.columns:
        df["fecha_solicitud"] = pd.to_datetime(df["fecha_solicitud"], errors="coerce").dt.strftime("%Y-%m-%d")

    # Rellena nulos razonables
    df["ingresos_mensuales"] = df["ingresos_mensuales"].fillna(0)
    df["edad"] = df["edad"].fillna(-1)

    return df


def chunk_list(items: List[Dict[str, Any]], size: int) -> List[List[Dict[str, Any]]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def call_predict_batch(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # La API típicamente acepta una lista de registros JSON y retorna una lista con
    # los campos de salida por registro (orden estable). Incluimos id_cliente para
    # facilitar el merge robusto.
    headers = {"Content-Type": "application/json"}
    # Contrato confirmado por OpenAPI: {"clientes": [...]}
    payload = {"clientes": records}
    response = requests.post(PREDICT_ENDPOINT, headers=headers, json=payload, timeout=60)
    if not response.ok:
        try:
            print(f"Respuesta de error ({response.status_code}): {response.text}")
        except Exception:
            pass
        response.raise_for_status()
    data = response.json()
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        # Intentar detectar lista útil dentro del dict
        for key in ["predicciones", "predictions", "result", "results", "data", "items"]:
            val = data.get(key)
            if isinstance(val, list):
                return val
        # Si alguna clave tiene una lista del mismo tamaño, úsala
        for key, val in data.items():
            if isinstance(val, list) and len(val) == len(records):
                return val
        raise ValueError(f"Respuesta inesperada de predict_batch (dict sin lista utilizable). Claves: {list(data.keys())}")
    raise ValueError("Respuesta inesperada de predict_batch: tipo no soportado")


def enrich_with_predictions(df: pd.DataFrame, batch_size: int = 500) -> pd.DataFrame:
    payload_records: List[Dict[str, Any]] = df.to_dict(orient="records")
    batches = chunk_list(payload_records, batch_size)

    results: List[Dict[str, Any]] = []
    for idx, batch in enumerate(batches, start=1):
        print(f"Llamando predict_batch: lote {idx}/{len(batches)} (registros: {len(batch)})...")
        preds = call_predict_batch(batch)

        # Asegura longitud
        if len(preds) != len(batch):
            print("Advertencia: Tamaño de respuesta no coincide con el batch; intentando merge por id_cliente")

        results.extend(preds)

    # Merge: si la respuesta trae id_cliente, hacemos merge por llave; si no, por posición.
    resp_df = pd.DataFrame(results)

    # Intento 1: merge por id_cliente
    if "id_cliente" in resp_df.columns:
        merged = df.merge(resp_df, on="id_cliente", how="left", suffixes=("", "_model"))
    else:
        # Positional merge as fallback
        if len(resp_df) != len(df):
            raise ValueError("No se puede alinear predicciones a registros sin id_cliente y con distinto largo.")
        resp_df = resp_df.reset_index(drop=True)
        merged = df.reset_index(drop=True).join(resp_df, lsuffix="", rsuffix="_model")

    # Normaliza nombres de salida esperados
    # Intentamos mapear variantes comunes:
    if "score_riesgo" not in merged.columns:
        for alt in ["score", "risk_score", "scoreRisk"]:
            if alt in merged.columns:
                merged = merged.rename(columns={alt: "score_riesgo"})
                break

    if "decision_legacy" not in merged.columns:
        for alt in ["decision", "legacy_decision", "approved"]:
            if alt in merged.columns:
                merged = merged.rename(columns={alt: "decision_legacy"})
                break

    # Derivar campo 'decision' amigable si posible
    if "decision_legacy" in merged.columns:
        # Acepta formatos booleanos o strings
        def normalize_decision(v: Any) -> str:
            if v is None:
                return "Desconocido"
            s = str(v).strip().lower()
            if s in ("aprobado", "approve", "approved", "1", "true", "si", "sí", "ok"):
                return "Aprobado"
            if s in ("rechazado", "reject", "rejected", "0", "false", "no"):
                return "Rechazado"
            return v if isinstance(v, str) else "Desconocido"

        merged["decision"] = merged["decision_legacy"].map(normalize_decision)

    return merged


def ensure_output_dir(path: str) -> None:
    directory = os.path.dirname(path)
    if directory and not os.path.exists(directory):
        os.makedirs(directory, exist_ok=True)


def save_json_records(df: pd.DataFrame, path: str) -> None:
    ensure_output_dir(path)

    # Selección de columnas claves para D3 (mantén extras útiles)
    cols = [
        "id_solicitud",
        "id_cliente",
        "comuna",
        "ingresos_mensuales",
        "edad",
        "sexo",
        "nacionalidad",
        "etnia",
        "monto_solicitado",
        "plazo_meses",
        "tipo_producto",
        "canal_origen",
        "tasa_interes_anual",
        "fecha_solicitud",
        "score_riesgo",
        "decision_legacy",
        "decision",
        "incumplio",
    ]
    existing = [c for c in cols if c in df.columns]
    out_df = df[existing].copy()

    records = out_df.to_dict(orient="records")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)

    print(f"Archivo generado: {path} ({len(records)} registros)")


def main() -> None:
    try:
        print("Extrayendo solicitudes + clientes desde MySQL...")
        df = extract_solicitudes_joined(limit=3000)
        print(f"Registros extraídos: {len(df)}")

        print("Normalizando tipos/categorías...")
        df = coerce_types(df)

        print("Llamando API de scoring por lotes...")
        enriched = enrich_with_predictions(df, batch_size=500)

        print("Guardando dataset para D3...")
        save_json_records(enriched, OUTPUT_PATH)

        print("Listo.")
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()

