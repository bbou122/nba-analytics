"""
Extracts the tables our analytics platform needs from nba.sqlite into
season-partitioned Parquet files (small enough to hand back to Claude).

Run this in the same folder as nba.sqlite (or edit DB_PATH below).
Requires: pandas, pyarrow (both ship with Anaconda; if missing: pip install pandas pyarrow)

Usage:
    python extract_nba_data.py
"""

import os
import sqlite3
import sys
import json

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "nba.sqlite")
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "extracted")
START_SEASON_YEAR = "1996"  # shot-location tracking begins 1996-97 season
MAX_ROWS_PER_CHUNK_FILE = 2_000_000  # safety valve for huge tables

# Tables we want, in priority order. Script skips any that don't exist
# in this build of the dataset (schema can vary slightly by release) and
# reports that clearly rather than failing silently.
TARGET_TABLES = [
    "fact_shot_chart",
    "fact_shot_chart_league_averages",
    "fact_shot_chart_lineup",
    "dim_shot_zone",
    "fact_team_lineups_detail",
    "agg_lineup_efficiency",
    "bridge_lineup_player",
    "fact_league_lineup_viz",
    "fact_on_off_detail",
    "fact_box_score_four_factors",
    "fact_box_score_advanced_player",
    "fact_box_score_advanced_team",
    "fact_player_pt_tracking",
    "fact_team_pt_tracking",
    "fact_league_pt_defend",
    "fact_tracking_defense",
    "fact_player_game_hustle",
    "fact_team_game_hustle",
    "fact_league_hustle",
    "fact_defense_hub",
    "fact_player_clutch_detail",
    "agg_clutch_stats",
    "fact_player_career",
    "fact_rotation",
    "fact_playoff_series",
    "fact_league_dash_player_stats",
    "fact_league_dash_team_stats",
    "dim_player",
    "dim_team",
    "dim_game",
    "dim_season",
]


def get_existing_tables(conn):
    cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    return {row[0] for row in cur.fetchall()}


def find_date_or_season_column(conn, table):
    cur = conn.execute(f"PRAGMA table_info('{table}')")
    cols = [row[1] for row in cur.fetchall()]
    for candidate in ("game_date", "season_year", "season", "game_date_est", "date"):
        if candidate in cols:
            return candidate
    return None


def main():
    if not os.path.exists(DB_PATH):
        print(f"ERROR: nba.sqlite not found at {DB_PATH}")
        sys.exit(1)

    try:
        import pandas as pd
    except ImportError:
        print("ERROR: pandas is required. Run: pip install pandas pyarrow")
        sys.exit(1)

    os.makedirs(OUT_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)

    existing = get_existing_tables(conn)
    manifest = {"extracted": [], "missing": [], "errors": []}

    for table in TARGET_TABLES:
        if table not in existing:
            print(f"[skip] {table} — not present in this schema build")
            manifest["missing"].append(table)
            continue

        try:
            date_col = find_date_or_season_column(conn, table)
            row_count = conn.execute(f"SELECT COUNT(*) FROM '{table}'").fetchone()[0]

            if date_col and date_col in ("game_date", "game_date_est", "date"):
                where_clause = f"WHERE {date_col} >= '{START_SEASON_YEAR}-01-01'"
            elif date_col in ("season_year", "season"):
                where_clause = f"WHERE CAST(SUBSTR({date_col}, 1, 4) AS INTEGER) >= {START_SEASON_YEAR}"
            else:
                where_clause = ""  # no obvious date column — pull it all (usually small dim/lookup tables)

            query = f"SELECT * FROM '{table}' {where_clause}"
            print(f"[extract] {table} (~{row_count:,} total rows) ...")

            if row_count > MAX_ROWS_PER_CHUNK_FILE:
                # chunked read/write to keep memory + output file size sane
                chunk_idx = 0
                for chunk in pd.read_sql_query(query, conn, chunksize=MAX_ROWS_PER_CHUNK_FILE):
                    out_path = os.path.join(OUT_DIR, f"{table}__part{chunk_idx:03d}.parquet")
                    chunk.to_parquet(out_path, index=False)
                    print(f"    wrote {out_path} ({len(chunk):,} rows)")
                    chunk_idx += 1
            else:
                df = pd.read_sql_query(query, conn)
                out_path = os.path.join(OUT_DIR, f"{table}.parquet")
                df.to_parquet(out_path, index=False)
                print(f"    wrote {out_path} ({len(df):,} rows)")

            manifest["extracted"].append(table)

        except Exception as e:
            print(f"[error] {table}: {e}")
            manifest["errors"].append({"table": table, "error": str(e)})

    with open(os.path.join(OUT_DIR, "extraction_manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)

    conn.close()
    print("\nDone. See extracted/extraction_manifest.json for a summary.")
    print(f"Extracted: {len(manifest['extracted'])} | Missing: {len(manifest['missing'])} | Errors: {len(manifest['errors'])}")


if __name__ == "__main__":
    main()
