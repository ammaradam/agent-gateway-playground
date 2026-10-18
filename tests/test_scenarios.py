import pytest

from playground.scenarios import run_scenario


@pytest.mark.asyncio
async def test_timeout_without_key_creates_duplicate():
    r = await run_scenario("timeout", {})
    assert r["outcome"]["verdict"] == "bad"
    assert r["outcome"]["facts"][0]["value"] == "2"
    assert any(e["kind"] == "timeout" for e in r["events"])


@pytest.mark.asyncio
async def test_timeout_with_key_and_dedupe_is_safe():
    r = await run_scenario("timeout", {"agent_sends_key": True, "gateway_dedupes": True})
    assert r["outcome"]["verdict"] == "good"
    assert r["outcome"]["facts"][0]["value"] == "1"
    assert any(e["kind"] == "idempotency.hit" for e in r["events"])


@pytest.mark.asyncio
async def test_key_without_dedupe_still_duplicates():
    r = await run_scenario("timeout", {"agent_sends_key": True, "gateway_dedupes": False})
    assert r["outcome"]["facts"][0]["value"] == "2"


@pytest.mark.asyncio
async def test_no_fault_creates_one_ticket():
    r = await run_scenario("timeout", {"drop_response": False})
    assert r["outcome"]["facts"][0]["value"] == "1"


@pytest.mark.asyncio
async def test_permission_denied_layers():
    r = await run_scenario("permission", {})
    assert [e["layer"] for e in r["events"] if e["kind"].startswith("authz.") and e["status"] == "error" for e in [e["data"]]] == ["user"]
    r = await run_scenario("permission", {"user": "bob", "agent_scope": "read"})
    assert any(e["data"].get("layer") == "delegation" and e["status"] == "error" for e in r["events"])
    r = await run_scenario("permission", {"user": "bob", "agent_scope": "read+write", "resource_allows_agents": False})
    assert any(e["data"].get("layer") == "resource" and e["status"] == "error" for e in r["events"])


@pytest.mark.asyncio
async def test_permission_allowed_and_error_style():
    r = await run_scenario("permission", {"user": "bob", "agent_scope": "read+write"})
    assert r["outcome"]["title"] == "Record deleted."
    vague = await run_scenario("permission", {})
    helpful = await run_scenario("permission", {"helpful_errors": True})
    assert "can't tell why" in vague["final"]
    assert "admin" in helpful["final"]


@pytest.mark.asyncio
async def test_wrong_200_needs_a_read_back():
    blind = await run_scenario("wrong200", {})
    assert blind["outcome"]["verdict"] == "bad"
    checked = await run_scenario("wrong200", {"agent_verifies": True})
    assert checked["outcome"]["title"] == "Wrong project caught."
    clean = await run_scenario("wrong200", {"buggy_tool": False})
    assert clean["outcome"]["title"] == "Ticket filed correctly."


@pytest.mark.asyncio
async def test_events_are_ordered_on_a_clock():
    r = await run_scenario("timeout", {})
    ts = [e["t"] for e in r["events"]]
    assert ts == sorted(ts) and r["total_ms"] >= ts[-1]
