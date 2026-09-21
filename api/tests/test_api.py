"""
Integration tests against the real warehouse, covering the trickier logic
in this API rather than every route (an exhaustive route sweep lives in
the manual smoke-test at the project root, test_api.py). Run with:

    cd api
    pytest tests/ -v

Requires NBA_WAREHOUSE_PATH set (or warehouse.duckdb at db.py's default
path) and the dev extras: pip install -r requirements-dev.txt
"""

from tests.conftest import KNOWN_PO_WINS, KNOWN_RS_WINS, KNOWN_SEASON, KNOWN_TEAM_ID


# --- Route ordering -------------------------------------------------------
# /players/archetypes and /players/{id}/similar both sit next to
# /players/{player_id}; if they're registered after it in players.py,
# FastAPI/Starlette matches {player_id} first and 422s trying to parse
# "archetypes" as an int. This regression happened once already.

def test_archetypes_route_not_shadowed_by_player_id(client):
    r = client.get("/players/archetypes", params={"season": KNOWN_SEASON, "min_gp": 20})
    assert r.status_code == 200, r.text


def test_similar_route_not_shadowed_by_player_id(client):
    r = client.get("/players/1628369/similar", params={"season": KNOWN_SEASON, "min_gp": 20})
    assert r.status_code == 200, r.text


def test_ordinary_player_id_route_still_works(client):
    r = client.get("/players/2544")  # LeBron James
    assert r.status_code == 200, r.text


# --- GAME_ID bridging -------------------------------------------------
# fact_shot_chart.GAME_ID is BIGINT (no leading zeros); dim_game/
# fact_lineup_stints.game_id is zero-padded VARCHAR. Bridging them wrong
# silently returns fga=0 instead of erroring -- this caught that bug once.

def test_teammate_impact_game_id_bridging_returns_real_shot_volume(client):
    r = client.get(
        f"/teams/{KNOWN_TEAM_ID}/teammate-impact",
        params={"player_id": 1628369, "teammate_id": 1629057, "seasons": KNOWN_SEASON},  # Tatum + Robert Williams III
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["with_teammate"]["fga_per_game"] > 0
    assert data["without_teammate"]["fga_per_game"] > 0


# --- Win Shares allocation ------------------------------------------------
# Must sum (by construction) to the team's actual win total for the season.

def test_win_shares_sum_to_team_wins_regular_season(client):
    r = client.get(f"/teams/{KNOWN_TEAM_ID}/win-shares", params={"season": KNOWN_SEASON})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["team_wins"] == KNOWN_RS_WINS
    assert abs(data["allocated_win_shares_total"] - data["team_wins"]) < 1.0


def test_win_shares_playoffs_toggle_sums_to_playoff_wins(client):
    r = client.get(
        f"/teams/{KNOWN_TEAM_ID}/win-shares",
        params={"season": KNOWN_SEASON, "season_type": "Playoffs"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["team_wins"] == KNOWN_PO_WINS


# --- Home/away four factors approximation ---------------------------------
# eFG% and FTA rate should reproduce the official all-games numbers almost
# exactly when home+away are combined back together; that's the accuracy
# claim made in the endpoint's docstring, so it's worth pinning down.

def test_home_away_four_factors_efg_close_to_official(client):
    official = client.get(f"/teams/{KNOWN_TEAM_ID}/dashboard", params={"season": KNOWN_SEASON})
    assert official.status_code == 200
    official_efg = official.json()["four_factors"]["team"]["efg_pct"]

    home = client.get(f"/teams/{KNOWN_TEAM_ID}/dashboard", params={"season": KNOWN_SEASON, "home_away": "home"})
    away = client.get(f"/teams/{KNOWN_TEAM_ID}/dashboard", params={"season": KNOWN_SEASON, "home_away": "away"})
    assert home.status_code == 200 and away.status_code == 200
    assert home.json()["four_factors_estimated"] is True
    assert away.json()["four_factors_estimated"] is True
    # Not a strict average (game counts differ), but should be in the
    # same neighborhood as the official combined figure, not wildly off.
    home_efg = home.json()["four_factors"]["team"]["efg_pct"]
    away_efg = away.json()["four_factors"]["team"]["efg_pct"]
    assert abs((home_efg + away_efg) / 2 - official_efg) < 0.05


# --- Clutch definition -----------------------------------------------------

def test_player_clutch_games_less_than_total_games(client):
    clutch = client.get("/players/1628369/clutch", params={"seasons": KNOWN_SEASON})
    averages = client.get("/players/1628369/game-averages", params={"seasons": KNOWN_SEASON})
    assert clutch.status_code == 200 and averages.status_code == 200
    assert clutch.json()["clutch_games"] <= averages.json()["gp"]


def test_team_clutch_record_games_le_season_games(client):
    r = client.get(f"/teams/{KNOWN_TEAM_ID}/clutch", params={"season": KNOWN_SEASON})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["clutch_wins"] + data["clutch_losses"] + data["clutch_ties"] == data["clutch_games"]
    assert data["clutch_games"] <= 82


# --- Playoffs vs Regular Season toggle -------------------------------------

def test_roster_differs_between_regular_season_and_playoffs(client):
    rs = client.get(f"/teams/{KNOWN_TEAM_ID}/roster", params={"season": KNOWN_SEASON})
    po = client.get(f"/teams/{KNOWN_TEAM_ID}/roster", params={"season": KNOWN_SEASON, "season_type": "Playoffs"})
    assert rs.status_code == 200 and po.status_code == 200
    rs_gp = {p["PLAYER_ID"]: p["GP"] for p in rs.json()}
    po_gp = {p["PLAYER_ID"]: p["GP"] for p in po.json()}
    shared = set(rs_gp) & set(po_gp)
    assert shared, "expected at least some players to appear in both RS and playoff rosters"
    assert any(rs_gp[pid] != po_gp[pid] for pid in shared)


# --- Similarity search ------------------------------------------------------

def test_similar_players_excludes_target_and_returns_ranked_list(client):
    r = client.get("/players/1628369/similar", params={"season": KNOWN_SEASON, "min_gp": 20, "n": 5})
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["similar_players"]) == 5
    assert all(p["player_id"] != 1628369 for p in data["similar_players"])
    distances = [p["similarity_distance"] for p in data["similar_players"]]
    assert distances == sorted(distances)


# --- Net rating trend --------------------------------------------------------

def test_net_rating_trend_game_count_matches_season(client):
    r = client.get(f"/teams/{KNOWN_TEAM_ID}/net-rating-trend", params={"season": KNOWN_SEASON})
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["games"]) == 82
    # Known-good spot check: Celtics were the league's best regular-season
    # net rating team in 2022-23, right around +6.
    season_avg = sum(g["net_rating_est"] for g in data["games"]) / len(data["games"])
    assert 4.0 < season_avg < 9.0
