"""Scenarios: each one wires a Microsoft Agent Framework agent to the mock gateway."""
from __future__ import annotations

import hashlib
from collections.abc import Awaitable, Callable
from typing import Annotated, Any

from agent_framework import Agent, FunctionInvocationContext, FunctionMiddleware, Message, tool

from .client import ScriptedClient, call, say, tool_results
from .gateway import ROLES, World
from .trace import Recorder


# -- tools: the schema the model sees. The gateway middleware runs them, so bodies are empty ----
@tool(description="Create a support ticket. Pass an idempotency_key so a retry cannot create a second one.")
def create_ticket(
    title: Annotated[str, "Ticket title"],
    project: Annotated[str, "Project code, for example SUP"] = "SUP",
    idempotency_key: Annotated[str | None, "Stable key for this logical request"] = None,
) -> str:
    raise RuntimeError("runs through the gateway")


@tool(description="Read a ticket back by id.")
def get_ticket(ticket_id: Annotated[str, "Ticket id"]) -> str:
    raise RuntimeError("runs through the gateway")


@tool(description="Delete a record by id.")
def delete_record(record_id: Annotated[str, "Record id"]) -> str:
    raise RuntimeError("runs through the gateway")


class GatewayMiddleware(FunctionMiddleware):
    """Agent Framework function middleware that sends every tool call through the gateway."""

    def __init__(self, world: World) -> None:
        self.world = world

    async def process(self, context: FunctionInvocationContext, call_next: Callable[[], Awaitable[None]]) -> None:
        args = {k: v for k, v in dict(context.arguments).items()}
        context.result = self.world.gateway.handle(context.function.name, args)
        # Not calling call_next(): the gateway already did the work.


# -- scripted "models" ----------------------------------------------------------------------
def brain_timeout(w: World):
    rec = w.rec
    key = "refund-1042-" + hashlib.sha1(b"refund-1042").hexdigest()[:6]
    use_key = w.cfg["agent_sends_key"]

    def brain(messages: list[Message]):
        results = tool_results(messages)
        args: dict[str, Any] = {"title": "Refund order #1042", "project": "SUP"}
        if use_key:
            args["idempotency_key"] = key
        if not results:
            rec.emit("agent", "agent", "agent.plan", "plan", dur=120,
                     detail="Plan: create one refund ticket" + (f", with key {key}." if use_key else ", without a key."))
            return [call("c1", "create_ticket", **args)]
        last = results[-1]
        if last.startswith("TIMEOUT") and len(results) < 3:
            rec.emit("agent", "agent", "agent.retry", "retry", dur=150, status="warn",
                     detail="No answer, so the agent retries" + (" with the same key." if use_key else ". It has no key, so the gateway sees a new request."))
            return [call(f"c{len(results) + 1}", "create_ticket", **args)]
        n = len(w.tickets)
        rec.emit("agent", "user", "agent.final", "done", dur=100, detail="Agent reports back to the user.")
        return [say(f"Done. I created the refund ticket ({n} ticket{'s' if n != 1 else ''} in the system).")]

    return brain


def brain_permission(w: World):
    rec = w.rec

    def brain(messages: list[Message]):
        results = tool_results(messages)
        if not results:
            rec.emit("agent", "agent", "agent.plan", "plan", dur=120, detail="Plan: delete record rec-7 for the user.")
            return [call("c1", "delete_record", record_id="rec-7")]
        last = results[-1]
        rec.emit("agent", "user", "agent.final", "done", dur=100, detail="Agent reports back to the user.")
        if last.startswith("HTTP 200"):
            return [say("Deleted rec-7.")]
        if '"try"' in last:
            fix = last.split('"try": "', 1)[1].split('"', 1)[0]
            return [say(f"I couldn't delete rec-7. {fix}")]
        return [say("I couldn't delete rec-7: the request was forbidden, and I can't tell why.")]

    return brain


def brain_wrong_200(w: World):
    rec = w.rec
    verify = w.cfg["agent_verifies"]

    def brain(messages: list[Message]):
        results = tool_results(messages)
        if not results:
            rec.emit("agent", "agent", "agent.plan", "plan", dur=120, detail="Plan: file a ticket in project SUP" + (", then read it back." if verify else "."))
            return [call("c1", "create_ticket", title="Printer offline on floor 3", project="SUP")]
        if verify and len(results) == 1:
            tid = results[0].split('"ticket_id": "', 1)[1].split('"', 1)[0]
            rec.emit("agent", "agent", "agent.verify", "verify", dur=100, detail="Verify: read the ticket back and compare it to what was asked.")
            return [call("c2", "get_ticket", ticket_id=tid)]
        rec.emit("agent", "user", "agent.final", "done", dur=100, detail="Agent reports back to the user.")
        if verify and '"project": "SUP"' not in results[-1]:
            return [say("The ticket was created, but in project OPS, not SUP. I am not reporting this as done.")]
        return [say("Done. The ticket is filed in SUP.")]

    return brain


# -- scenario catalogue (also served to the UI) ---------------------------------------------
SCENARIOS: dict[str, dict[str, Any]] = {
    "timeout": {
        "id": "timeout",
        "title": "A tool call times out",
        "short": "Timeout",
        "post": "tool-call-timeouts",
        "summary": "The ticket tool did its job, but the response was lost. Does the retry create a second ticket?",
        "prompt": "Create a refund ticket for order #1042.",
        "toggles": [
            {"key": "drop_response", "short": "Lose response", "label": "Lose the first response", "type": "bool", "default": True,
             "help": "The tool succeeds, but the answer never arrives."},
            {"key": "agent_sends_key", "short": "Send key", "label": "Agent sends an idempotency key", "type": "bool", "default": False,
             "help": "A stable key that names this one logical request."},
            {"key": "gateway_dedupes", "short": "Dedupe", "label": "Gateway deduplicates by key", "type": "bool", "default": False,
             "help": "Return the stored result when a key repeats."},
        ],
        "brain": brain_timeout,
    },
    "permission": {
        "id": "permission",
        "title": "Who may delete this record?",
        "short": "Permission",
        "post": "agent-identity-is-not-authorization",
        "summary": "Knowing who the agent is answers only part of the question. Four checks decide: agent, user, delegation, resource.",
        "prompt": "Delete record rec-7 (Q3 customer export).",
        "toggles": [
            {"key": "user", "short": "Acting for", "label": "Acting for", "type": "choice", "default": "alice",
             "options": [{"value": k, "label": v["label"]} for k, v in ROLES.items()]},
            {"key": "agent_scope", "short": "Scope", "label": "Scope the user delegated", "type": "choice", "default": "read",
             "options": [{"value": "read", "label": "Read only"}, {"value": "read+write", "label": "Read and write"}]},
            {"key": "resource_allows_agents", "short": "Record allows agents", "label": "Record allows agent deletes", "type": "bool", "default": True,
             "help": "The resource's own policy has the last word."},
            {"key": "helpful_errors", "short": "Helpful errors", "label": "Helpful error messages", "type": "bool", "default": False,
             "help": "Say which check failed and what to do next."},
        ],
        "brain": brain_permission,
    },
    "wrong200": {
        "id": "wrong200",
        "title": "A 200 that is wrong",
        "short": "Wrong 200",
        "post": "agent-success-is-not-a-200",
        "summary": "Every metric is green, and the ticket is in the wrong project. Only a read-back catches it.",
        "prompt": "File a ticket in SUP: printer offline on floor 3.",
        "toggles": [
            {"key": "buggy_tool", "short": "Wrong project", "label": "Tool files it in the wrong project", "type": "bool", "default": True,
             "help": "The call still returns 200 OK."},
            {"key": "agent_verifies", "short": "Read back", "label": "Agent reads the ticket back", "type": "bool", "default": False,
             "help": "Check the outcome, not the status code."},
        ],
        "brain": brain_wrong_200,
    },
}


def public_catalogue() -> list[dict[str, Any]]:
    return [{k: v for k, v in s.items() if k != "brain"} for s in SCENARIOS.values()]


def _config(scn: dict[str, Any], toggles: dict[str, Any]) -> dict[str, Any]:
    cfg: dict[str, Any] = {}
    for t in scn["toggles"]:
        v = toggles.get(t["key"], t["default"])
        if t["type"] == "bool":
            v = bool(v)
        elif t["type"] == "choice":
            allowed = {o["value"] for o in t["options"]}
            v = v if v in allowed else t["default"]
        cfg[t["key"]] = v
    return cfg


def _outcome(sid: str, w: World, final: str) -> dict[str, Any]:
    cfg = w.cfg
    if sid == "timeout":
        n = len(w.tickets)
        bad = n != 1
        return {"verdict": "bad" if bad else "good",
                "title": f"{n} ticket{'s' if n != 1 else ''} created" + (" for one request." if bad else "."),
                "facts": [{"label": "Tickets in the store", "value": str(n), "status": "error" if bad else "ok"},
                          {"label": "Expected", "value": "1", "status": "ok"},
                          {"label": "Agent says", "value": final, "status": "ok"}]}
    if sid == "permission":
        gone = "rec-7" not in w.records
        return {"verdict": "good" if gone else "info",
                "title": "Record deleted." if gone else "Delete blocked.",
                "facts": [{"label": "Record rec-7", "value": "deleted" if gone else "still there", "status": "ok" if gone else "warn"},
                          {"label": "Agent says", "value": final, "status": "ok"}]}
    if sid == "wrong200":
        wrong = bool(w.tickets) and w.tickets[0]["project"] != "SUP"
        said_done = final.startswith("Done")
        bad = wrong and said_done
        return {"verdict": "bad" if bad else "good" if not wrong else "info",
                "title": "Success reported, outcome wrong." if bad else "Wrong project caught." if wrong else "Ticket filed correctly.",
                "facts": [{"label": "Dashboard", "value": "200 OK, all green", "status": "ok"},
                          {"label": "Ticket project", "value": w.tickets[0]["project"] if w.tickets else "-", "status": "error" if wrong else "ok"},
                          {"label": "Agent says", "value": final, "status": "error" if bad else "ok"}]}
    return {"verdict": "info", "title": "", "facts": []}


async def run_scenario(sid: str, toggles: dict[str, Any]) -> dict[str, Any]:
    scn = SCENARIOS[sid]
    rec = Recorder()
    w = World(rec, _config(scn, toggles))
    rec.emit("user", "agent", "user.prompt", "prompt", dur=60, detail=f'User: "{scn["prompt"]}"')
    agent = Agent(
        ScriptedClient(scn["brain"](w)),
        instructions="You are a careful operations agent. Use the tools you are given.",
        name="ops-agent",
        tools=[create_ticket, get_ticket, delete_record],
        middleware=[GatewayMiddleware(w)],
    )
    response = await agent.run(scn["prompt"])
    final = response.text
    return {"scenario": sid, "toggles": w.cfg, "events": rec.to_list(), "final": final,
            "outcome": _outcome(sid, w, final), "total_ms": rec.clock}
