"""
NBA analytics API. Serves the warehouse.duckdb tables built earlier
(teams, players, shot charts -- lineup/on-off and other sections come later).

Run from this folder with:
    uvicorn main:app --reload --port 8000

Then browse to http://127.0.0.1:8000/docs for interactive API docs.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import data_quality, games, lineups, players, shots, teams

app = FastAPI(
    title="NBA Analytics API",
    description="Backend for the NBA analytics portfolio project.",
    version="0.1.0",
)

# Wide open for local dev -- the React frontend will run on localhost too,
# just on a different port (5173 for Vite, 3000 for CRA-style setups).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(teams.router, prefix="/teams", tags=["teams"])
app.include_router(players.router, prefix="/players", tags=["players"])
app.include_router(shots.router, prefix="/shots", tags=["shots"])
app.include_router(lineups.router, prefix="/lineups", tags=["lineups"])
app.include_router(games.router, prefix="/games", tags=["games"])
app.include_router(data_quality.router, prefix="/data-quality", tags=["data-quality"])


@app.get("/")
def root():
    return {"status": "ok", "service": "nba-analytics-api"}
