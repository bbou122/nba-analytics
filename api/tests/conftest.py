"""
Shared pytest fixtures for the API test suite. Points db.DB_PATH at the
real warehouse -- these are integration tests against actual data (the
whole point is to catch bugs like the leading-zero GAME_ID mismatch or a
SQL parameter-count mismatch that only show up against real query shapes),
not unit tests against a mock. Set NBA_WAREHOUSE_PATH before running if
your warehouse.duckdb isn't at the default path db.py falls back to.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture(scope="session")
def client():
    return TestClient(app)


# A team/season known to have real, sanity-checkable data throughout this
# project's development (Boston Celtics, 2022-23: 57-25 regular season,
# #1 seed, lost Game 7 of the ECF -- 11 playoff wins).
KNOWN_TEAM_ID = 1610612738
KNOWN_SEASON = "2022-23"
KNOWN_RS_WINS = 57
KNOWN_PO_WINS = 11
