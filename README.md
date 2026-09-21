# NBA Analytics Platform

A full-stack basketball analytics tool built as a portfolio piece for NBA front-office analyst roles: FastAPI + DuckDB backend over ~28 seasons of NBA stats, React/Plotly frontend, and a set of derived metrics (clutch splits, win-share estimates, shot-creation types, player archetypes, teammate on/off impact) built from raw box scores and play-by-play rather than pulled pre-made.

**Live demo: coming shortly (deployment in progress)** -- click around without installing anything, once it is up. It runs on a trimmed 5-season copy of the data (see below); the full ~28-season warehouse is available for local use.

## What's in here

- **`warehouse.duckdb`** -- the data warehouse: season-aggregate tables (traditional/advanced/defense/scoring stats, regular season and playoffs), game-level box scores, shot charts, lineup stints, and play-by-play, plus several tables derived directly from play-by-play (`fact_player_boxscore_game`, `fact_player_boxscore_clutch`) where no ready-made table existed. The `derive_*.py` and `build_warehouse.py` scripts at the project root show that work. It's too large for git, so it's distributed as a [GitHub Release asset](https://github.com/bbou122/nba-analytics/releases/download/full/warehouse.duckdb) (1.6GB, all ~28 seasons).
- **`demo_warehouse.duckdb`** -- a trimmed copy for the live demo and for anyone who just wants to poke at it locally without a 1.6GB download: full career-level history in every season-aggregate table (win shares, archetypes, four factors, etc.), but the big row-level tables (play-by-play, lineup stints, shot charts) are cut down to the 5 most recent seasons they cover. Built by `scripts/build_demo_warehouse.py`. [Download it here](https://github.com/bbou122/nba-analytics/releases/download/demo/demo_warehouse.duckdb) (253MB).
- **`api/`** -- a FastAPI backend (`routers/teams.py`, `players.py`, `shots.py`, `lineups.py`) exposing ~35 endpoints over the warehouse. `api/tests/` has an automated pytest suite covering the trickier logic (ID-bridging bugs, allocation math, route ordering).
- **`frontend/`** -- a React/Vite app: an Executive Dashboard (team record, four factors, quarter trends, clutch identity, net rating trend, roster with estimated win shares), a Player Explorer (multi-season/career splits, shot charts, clutch, similar players), a Lineup Explorer, Game Analysis, an Archetypes page (KMeans clustering), and a Compare page.

## Running it locally

Grab a copy of the data first -- either [the full warehouse](https://github.com/bbou122/nba-analytics/releases/download/full/warehouse.duckdb) (1.6GB, all seasons) or the [smaller demo warehouse](https://github.com/bbou122/nba-analytics/releases/download/demo/demo_warehouse.duckdb) (253MB, 5 recent seasons of row-level detail) -- and point the backend at it.

Backend:
```
cd api
pip install -r requirements.txt
export NBA_WAREHOUSE_PATH=/path/to/warehouse.duckdb   # or demo_warehouse.duckdb
uvicorn main:app --reload --port 8000
```
API docs at `http://127.0.0.1:8000/docs`.

Frontend:
```
cd frontend
npm install
npm run dev
```
By default it talks to `http://127.0.0.1:8000`; copy `frontend/.env.example` to `frontend/.env` and set `VITE_API_BASE_URL` to point elsewhere.

Tests (`pip install -r api/requirements-dev.txt` first):
```
cd api
pytest tests/ -v
```

## On honesty in the metrics

A lot of the more interesting features here -- home/away four factors, estimated win shares, player archetypes, clutch definitions, shot-creation types -- are things this project computed itself rather than metrics an official source publishes. Every one of them is labeled in its API response as official, derived, or estimated, with the reasoning, and the **Methodology** tab in the app collects all of that in one place. The short version: nothing here claims to be more authoritative than it actually is.
