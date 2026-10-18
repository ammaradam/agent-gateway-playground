from fastapi.testclient import TestClient

from playground.api import app

client = TestClient(app)


def test_lists_scenarios_with_toggles():
    r = client.get("/api/scenarios")
    assert r.status_code == 200
    ids = [s["id"] for s in r.json()]
    assert ids == ["timeout", "permission", "wrong200"]
    assert all(s["toggles"] and "brain" not in s for s in r.json())


def test_run_returns_a_trace():
    r = client.post("/api/run", json={"scenario": "timeout", "toggles": {"agent_sends_key": True, "gateway_dedupes": True}})
    assert r.status_code == 200
    body = r.json()
    assert body["outcome"]["verdict"] == "good"
    assert body["events"][0]["kind"] == "user.prompt"


def test_unknown_scenario_is_a_404_with_a_hint():
    r = client.post("/api/run", json={"scenario": "nope"})
    assert r.status_code == 404
    assert "timeout" in r.json()["detail"]


def test_bad_toggle_values_fall_back_to_defaults():
    r = client.post("/api/run", json={"scenario": "permission", "toggles": {"user": "mallory"}})
    assert r.status_code == 200
    assert r.json()["toggles"]["user"] == "alice"
