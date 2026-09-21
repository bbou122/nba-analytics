"""
Builds warehouse.duckdb from the three confirmed data sources sitting in
your nba data folder:
  1. csv/*.csv          -- from the wyattowalsh/nba-database sqlite export
  2. NBA-dataset-stats-player-team-main/**/*.csv  -- Brescou season stats
  3. shots_by_season/*.parquet -- shot location data (run split script first)

play_by_play.csv is intentionally NOT loaded here -- it's 2.25GB and needs
its own per-season split + lineup-derivation pass, coming next.

Requires: pip install duckdb pandas pyarrow
Run in Jupyter with: %run "C:/Users/15042/Downloads/nba data/build_warehouse.py"
"""

import os
import glob
import duckdb
import pandas as pd

BASE = r"C:\Users\15042\Downloads\nba data"
CSV_DIR = os.path.join(BASE, "csv")
BRESCOU_DIR = os.path.join(BASE, "NBA-dataset-stats-player-team-main", "NBA-dataset-stats-player-team-main")
SHOTS_DIR = os.path.join(BASE, "shots_by_season")
DB_PATH = os.path.join(BASE, "warehouse.duckdb")

con = duckdb.connect(DB_PATH)
report = {"loaded": [], "skipped": [], "validation": []}


def load_csv(table_name, path, **read_csv_kwargs):
    if not os.path.exists(path):
        print(f"[skip] {table_name} -- file not found: {path}")
        report["skipped"].append(table_name)
        return
    con.execute(f"DROP TABLE IF EXISTS {table_name}")
    con.execute(
        f"CREATE TABLE {table_name} AS SELECT * FROM read_csv_auto(?, {_kwargs_to_sql(read_csv_kwargs)})",
        [path],
    ) if read_csv_kwargs else con.execute(
        f"CREATE TABLE {table_name} AS SELECT * FROM read_csv_auto(?)", [path]
    )
    n = con.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
    print(f"[ok]   {table_name:<40} {n:>10,} rows   <- {os.path.basename(path)}")
    report["loaded"].append({"table": table_name, "rows": n, "source": path})


def _kwargs_to_sql(kwargs):
    parts = []
    for k, v in kwargs.items():
        if isinstance(v, bool):
            parts.append(f"{k}={str(v).upper()}")
        elif isinstance(v, str):
            parts.append(f"{k}='{v}'")
        else:
            parts.append(f"{k}={v}")
    return ", " + ", ".join(parts) if parts else ""


print("=" * 70)
print("1. Loading dimension + fact tables from csv/ (nba.sqlite export)")
print("=" * 70)

load_csv("dim_player", os.path.join(CSV_DIR, "player.csv"))
load_csv("dim_common_player_info", os.path.join(CSV_DIR, "common_player_info.csv"))
load_csv("dim_team", os.path.join(CSV_DIR, "team.csv"))
load_csv("dim_team_details", os.path.join(CSV_DIR, "team_details.csv"))
load_csv("dim_team_history", os.path.join(CSV_DIR, "team_history.csv"))
load_csv("dim_team_info_common", os.path.join(CSV_DIR, "team_info_common.csv"))
load_csv("dim_game", os.path.join(CSV_DIR, "game.csv"))
load_csv("dim_game_info", os.path.join(CSV_DIR, "game_info.csv"))
load_csv("fact_game_summary", os.path.join(CSV_DIR, "game_summary.csv"))
load_csv("fact_line_score", os.path.join(CSV_DIR, "line_score.csv"))
load_csv("fact_other_stats", os.path.join(CSV_DIR, "other_stats.csv"))
load_csv("fact_officials", os.path.join(CSV_DIR, "officials.csv"))
load_csv("fact_inactive_players", os.path.join(CSV_DIR, "inactive_players.csv"))
load_csv("dim_draft_history", os.path.join(CSV_DIR, "draft_history.csv"))
load_csv("dim_draft_combine_stats", os.path.join(CSV_DIR, "draft_combine_stats.csv"))

print()
print("=" * 70)
print("2. Loading Brescou season stats (player + team, rs + po)")
print("=" * 70)

for side in ("player", "team"):
    side_dir = os.path.join(BRESCOU_DIR, side)
    if not os.path.isdir(side_dir):
        print(f"[skip] {side_dir} not found")
        continue
    for path in sorted(glob.glob(os.path.join(side_dir, "*.csv"))):
        base = os.path.basename(path).replace(".csv", "")
        # e.g. player_stats_advanced_rs -> fact_player_advanced_rs
        table_name = "fact_" + base.replace("_stats_", "_").replace("traditionnal", "traditional")
        load_csv(table_name, path)

print()
print("=" * 70)
print("3. Loading shot chart data (per-season parquet)")
print("=" * 70)

shot_files = sorted(glob.glob(os.path.join(SHOTS_DIR, "shots_*.parquet")))
if shot_files:
    con.execute("DROP TABLE IF EXISTS fact_shot_chart")
    file_list_sql = ", ".join(f"'{p}'" for p in shot_files)
    con.execute(f"CREATE TABLE fact_shot_chart AS SELECT * FROM read_parquet([{file_list_sql}])")
    n = con.execute("SELECT COUNT(*) FROM fact_shot_chart").fetchone()[0]
    print(f"[ok]   fact_shot_chart{'':<27} {n:>10,} rows   <- {len(shot_files)} season files")
    report["loaded"].append({"table": "fact_shot_chart", "rows": n, "source": f"{len(shot_files)} season parquet files"})
else:
    print(f"[skip] no shots_*.parquet files found in {SHOTS_DIR} -- run split_shots_by_season.py first")
    report["skipped"].append("fact_shot_chart")

print()
print("=" * 70)
print("4. Validation checks")
print("=" * 70)

all_tables = [r[0] for r in con.execute("SHOW TABLES").fetchall()]

for t in all_tables:
    row = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    if row == 0:
        msg = f"[WARN] {t} loaded but has 0 rows"
        print(msg)
        report["validation"].append(msg)

# duplicate-game check on dim_game if it has GAME_ID
try:
    cols = [c[0] for c in con.execute("DESCRIBE dim_game").fetchall()]
    if "game_id" in [c.lower() for c in cols]:
        dupe = con.execute(
            "SELECT COUNT(*) - COUNT(DISTINCT game_id) FROM dim_game"
        ).fetchone()[0]
        msg = f"dim_game duplicate GAME_IDs: {dupe}"
        print(("[WARN] " if dupe else "[ok]   ") + msg)
        report["validation"].append(msg)
except Exception as e:
    print(f"[info] duplicate-game check skipped: {e}")

# shot coordinate sanity check
if "fact_shot_chart" in all_tables:
    try:
        cols = [c[0].lower() for c in con.execute("DESCRIBE fact_shot_chart").fetchall()]
        loc_x_col = next((c for c in cols if c in ("loc_x", "x", "shot_x")), None)
        if loc_x_col:
            bad = con.execute(
                f"SELECT COUNT(*) FROM fact_shot_chart WHERE {loc_x_col} IS NULL"
            ).fetchone()[0]
            msg = f"fact_shot_chart rows with NULL {loc_x_col}: {bad:,}"
            print(("[WARN] " if bad else "[ok]   ") + msg)
            report["validation"].append(msg)
    except Exception as e:
        print(f"[info] shot coordinate check skipped: {e}")

print()
print("=" * 70)
print("SUMMARY")
print("=" * 70)
print(f"Tables loaded:  {len(report['loaded'])}")
print(f"Tables skipped: {len(report['skipped'])}  -> {report['skipped']}")
print(f"Validation flags: {len(report['validation'])}")
print(f"\nWarehouse written to: {DB_PATH}")
print(f"Size on disk: {os.path.getsize(DB_PATH) / 1e6:.1f} MB")

con.close()
