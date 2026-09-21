# NBA Analytics Platform

A full-stack basketball analytics tool built as a portfolio piece for NBA front-office analyst roles: FastAPI + DuckDB backend over ~28 seasons of NBA stats, React/Plotly frontend, and a set of derived metrics (clutch splits, win-share estimates, shot-creation types, player archetypes, teammate on/off impact) built from raw box scores and play-by-play rather than pulled pre-made.

## What's in here

- **`warehouse.duckdb`** -- the data warehouse: season-aggregate tables (traditional/advanced/defense/scoring stats, regular season and playoffs), game-level box scores, shot charts, lineup stints, and play-by-play, plus several tables derived directly from play-by-play (`fact_player_boxscore_game`, `fact_player_boxscore_clutch`) where no ready-made table existed. The `derive_*.py` and `build_warehouse.py` scripts at the project root show that work.
- **`api/`** -- a FastAPI backend (`routers/teams.py`, `players.py`, `shots.py`, `lineups.py`) exposing ~35 endpoints over the warehouse. `api/tests/` has an automated pytest suite covering the trickier logic (ID-bridging bugs, allocation math, route ordering).
- **`frontend/`** -- a React/Vite app: an Executive Dashboard (team record, four factors, quarter trends, clutch identity, net rating trend, roster with estimated win shares), a Player Explorer (multi-season/career splits, shot charts, clutch, similar players), a Lineup Explorer, Game Analysis, an Archetypes page (KMeans clustering), and a Compare page.

## Running it

Backend:
```
cd api
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
Set `NBA_WAREHOUSE_PATH` if `warehouse.duckdb` isn't at the default path `api/db.py` falls back to. API docs at `http://127.0.0.1:8000/docs`.

Frontend:
```
cd frontend
npm install
npm run dev
```

Tests (`pip install -r api/requirements-dev.txt` first):
```
cd api
pytest tests/ -v
```

## On honesty in the metrics

A lot of the more interesting features here -- home/away four factors, estimated win shares, player archetypes, clutch definitions, shot-creation types -- are things this project computed itself rather than metrics an official source publishes. Every one of them is labeled in its API response as official, derived, or estimated, with the reasoning, and the **Methodology** tab in the app collects all of that in one place. The short version: nothing here claims to be more authoritative than it actually is.
