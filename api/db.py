"""
Shared DuckDB connection dependency for the API. Opens a fresh read-only
connection per request -- cheap for DuckDB and avoids any thread-safety
issues with sharing one connection across FastAPI's threadpool.

DB_PATH is read from the NBA_WAREHOUSE_PATH environment variable so the
project is portable (anyone cloning this repo can point it at their own
copy of warehouse.duckdb without editing source); it falls back to the
path this project has always lived at during development.
"""

import os

import duckdb

DB_PATH = os.environ.get("NBA_WAREHOUSE_PATH", r"C:\Users\15042\Downloads\nba data\warehouse.duckdb")


def get_db():
    con = duckdb.connect(DB_PATH, read_only=True)
    try:
        yield con
    finally:
        con.close()
