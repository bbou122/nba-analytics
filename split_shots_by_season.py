"""
Splits the big combined NBA_2004_2025_Shots.csv into one compressed Parquet
file per season, small enough to hand back to Claude individually.

Run in the same folder as NBA_2004_2025_Shots.csv (or edit CSV_PATH below).
Requires: pandas, pyarrow
"""

import os
import pandas as pd

CSV_PATH = r"C:\Users\15042\Downloads\nba data\NBA_2004_2025_Shots.csv\NBA_2004_2025_Shots.csv"
OUT_DIR = r"C:\Users\15042\Downloads\nba data\shots_by_season"
CHUNK_SIZE = 500_000

os.makedirs(OUT_DIR, exist_ok=True)

# First pass: figure out the season column name (varies by release —
# check common variants) without loading the whole file.
sample = pd.read_csv(CSV_PATH, nrows=5)
season_col = None
for candidate in ("SEASON_1", "SEASON_2", "SEASON", "Season", "season"):
    if candidate in sample.columns:
        season_col = candidate
        break

if season_col is None:
    print("Could not auto-detect a season column. Columns found:")
    print(list(sample.columns))
    raise SystemExit(1)

print(f"Using season column: {season_col}")
print(f"Columns: {list(sample.columns)}")

writers = {}  # season -> list of DataFrames accumulated, flushed per chunk
season_frames = {}

for i, chunk in enumerate(pd.read_csv(CSV_PATH, chunksize=CHUNK_SIZE)):
    for season, group in chunk.groupby(season_col):
        out_path = os.path.join(OUT_DIR, f"shots_{season}.parquet")
        if season in season_frames:
            # append via concat-then-write (simplest correct approach; fine at this scale per season)
            existing = pd.read_parquet(out_path)
            combined = pd.concat([existing, group], ignore_index=True)
            combined.to_parquet(out_path, index=False)
        else:
            group.to_parquet(out_path, index=False)
            season_frames[season] = True
    print(f"  processed chunk {i+1} ({(i+1)*CHUNK_SIZE:,} rows so far)")

print("\nDone. Per-season files written to:", OUT_DIR)
for f in sorted(os.listdir(OUT_DIR)):
    full = os.path.join(OUT_DIR, f)
    print(f"  {f}  ({os.path.getsize(full) / 1e6:.1f} MB)")
