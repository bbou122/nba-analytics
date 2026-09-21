"""
Smoke-tests the FastAPI backend without needing a separate terminal: starts
the API in a background thread inside this Jupyter process, then hits each
endpoint and prints the results.

Run with: %run "C:/Users/15042/Downloads/nba data/test_api.py"

For actual ongoing use (e.g. once we build the React frontend), run the API
for real in a terminal instead, so it keeps running after this cell ends:
    cd "C:\\Users\\15042\\Downloads\\nba data\\api"
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000
Then browse to http://127.0.0.1:8000/docs
"""

import sys
import time
import threading
import json

API_DIR = r"C:\Users\15042\Downloads\nba data\api"
sys.path.insert(0, API_DIR)

import uvicorn
from main import app

def _run_server():
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")

server_thread = threading.Thread(target=_run_server, daemon=True)
server_thread.start()
print("Starting API server in background thread...")
time.sleep(2)

import requests

BASE = "http://127.0.0.1:8000"


def show(label, resp):
    print(f"\n--- {label} ---")
    print(f"status: {resp.status_code}")
    try:
        data = resp.json()
    except Exception:
        print(resp.text[:500])
        return None
    preview = json.dumps(data, indent=2, default=str)
    print(preview[:1500] + ("... (truncated)" if len(preview) > 1500 else ""))
    return data


show("GET /", requests.get(f"{BASE}/"))

teams = show("GET /teams", requests.get(f"{BASE}/teams"))
lakers_id = next((t["id"] for t in teams if t["abbreviation"] == "LAL"), None)
print(f"\nResolved Lakers team_id = {lakers_id}")

show(f"GET /teams/{lakers_id}", requests.get(f"{BASE}/teams/{lakers_id}"))
show(f"GET /teams/{lakers_id}/seasons", requests.get(f"{BASE}/teams/{lakers_id}/seasons"))
show(f"GET /teams/{lakers_id}/stats?season=2022-23&stat_type=advanced",
     requests.get(f"{BASE}/teams/{lakers_id}/stats", params={"season": "2022-23", "stat_type": "advanced"}))

players = show("GET /players?q=lebron", requests.get(f"{BASE}/players", params={"q": "lebron"}))
lebron_id = players[0]["id"] if players else None
print(f"\nResolved LeBron player_id = {lebron_id}")

if lebron_id:
    show(f"GET /players/{lebron_id}", requests.get(f"{BASE}/players/{lebron_id}"))
    show(f"GET /players/{lebron_id}/stats?season=2022-23",
         requests.get(f"{BASE}/players/{lebron_id}/stats", params={"season": "2022-23"}))
    show(f"GET /shots/zones?player_id={lebron_id}&season=2022-23",
         requests.get(f"{BASE}/shots/zones", params={"player_id": lebron_id, "season": "2022-23"}))
    show(f"GET /shots?player_id={lebron_id}&season=2022-23&limit=3",
         requests.get(f"{BASE}/shots", params={"player_id": lebron_id, "season": "2022-23", "limit": 3}))
    show(f"GET /players/{lebron_id}/on-off?team_id={lakers_id}",
         requests.get(f"{BASE}/players/{lebron_id}/on-off", params={"team_id": lakers_id}))

show(f"GET /lineups?team_id={lakers_id}&limit=5",
     requests.get(f"{BASE}/lineups", params={"team_id": lakers_id, "limit": 5}))
show(f"GET /lineups/excluded?team_id={lakers_id}&limit=5",
     requests.get(f"{BASE}/lineups/excluded", params={"team_id": lakers_id, "limit": 5}))

print("\nDone. Server keeps running in the background of this kernel until you restart it.")
