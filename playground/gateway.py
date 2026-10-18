"""The mock agent gateway and the world behind it.

Every tool call from the agent goes through `Gateway.handle`, which plays the part of a
real platform gateway: identity checks, policy, idempotency, and fault injection. The tools
themselves are fake and live in memory, so a run has no side effects outside this process.
"""
from __future__ import annotations

import json
from typing import Any

from .trace import Recorder

TIMEOUT_MS = 5000
ROLES = {"alice": {"label": "Alice (viewer)", "can": {"read"}}, "bob": {"label": "Bob (admin)", "can": {"read", "write", "delete"}}}


class World:
    def __init__(self, rec: Recorder, cfg: dict[str, Any]) -> None:
        self.rec = rec
        self.cfg = cfg
        self.tickets: list[dict[str, Any]] = []
        self.records: dict[str, dict[str, Any]] = {"rec-7": {"owner": "bob", "name": "Q3 customer export"}}
        self.idempotency: dict[str, dict[str, Any]] = {}
        self.sent: dict[str, int] = {}  # tool name -> times the agent called it
        self.gateway = Gateway(self)


class Gateway:
    def __init__(self, world: World) -> None:
        self.w = world

    # -- entry point -------------------------------------------------------------------
    def handle(self, name: str, args: dict[str, Any]) -> str:
        w, rec = self.w, self.w.rec
        n = w.sent[name] = w.sent.get(name, 0) + 1
        key = args.get("idempotency_key")
        rec.emit("agent", "gateway", "gateway.request", name,
                 detail=f"Agent calls {name}" + (f" with key {key}." if key else "."), args=args, attempt=n)

        denied = self._authorize(name, args)
        if denied:
            return denied

        if name == "create_ticket":
            return self._create_ticket(args, key, n)
        if name == "get_ticket":
            return self._get_ticket(args)
        if name == "delete_record":
            return self._delete_record(args)
        return self._reply(404, {"error": f"Unknown tool {name}"}, status="error")

    # -- policy ------------------------------------------------------------------------
    def _authorize(self, name: str, args: dict[str, Any]) -> str | None:
        cfg, rec = self.w.cfg, self.w.rec
        if "user" not in cfg:  # scenarios that do not exercise authorization
            return None
        user = ROLES[cfg["user"]]
        scope = cfg["agent_scope"]
        rec.emit("gateway", "gateway", "authz.agent", "agent identity",
                 detail="Workload identity verified: this is agent-7, a known agent.", dur=50)
        if "delete" not in user["can"]:
            rec.emit("gateway", "gateway", "authz.user", "user permission", status="error", dur=60,
                     detail=f"{user['label']} may not delete records.", layer="user")
            return self._deny("user", "The user this agent acts for is not allowed to delete records.",
                              "Ask an admin to run this, or have an admin approve it.")
        rec.emit("gateway", "gateway", "authz.user", "user permission", dur=50,
                 detail=f"{user['label']} may delete records.", layer="user")
        if "write" not in scope:
            rec.emit("gateway", "gateway", "authz.delegation", "delegated scope", status="error", dur=60,
                     detail="The user delegated read only; deleting needs write.", layer="delegation")
            return self._deny("delegation", "The agent was only delegated read access, and delete needs write.",
                              "Grant the agent the records:write scope, then retry.")
        rec.emit("gateway", "gateway", "authz.delegation", "delegated scope", dur=50,
                 detail="The agent holds records:write.", layer="delegation")
        if not cfg["resource_allows_agents"]:
            rec.emit("gateway", "gateway", "authz.resource", "resource policy", status="error", dur=60,
                     detail="rec-7 blocks deletes by agents, whoever delegates.", layer="resource")
            return self._deny("resource", "The record's own policy does not allow agents to delete it.",
                              "Delete it yourself in the console; this record is human-only.")
        rec.emit("gateway", "gateway", "authz.resource", "resource policy", dur=50,
                 detail="rec-7 allows this delete.", layer="resource")
        return None

    def _deny(self, layer: str, why: str, fix: str) -> str:
        helpful = self.w.cfg.get("helpful_errors", False)
        body = {"error": "forbidden", "layer": layer, "why": why, "try": fix} if helpful else {"error": "forbidden"}
        return self._reply(403, body, status="error", label="403 forbidden",
                           detail=("The error explains which check failed and what to do."
                                   if helpful else "The error says only 'forbidden'."))

    # -- tools -------------------------------------------------------------------------
    def _create_ticket(self, args: dict[str, Any], key: str | None, attempt: int) -> str:
        w, rec, cfg = self.w, self.w.rec, self.w.cfg
        dedupe = cfg.get("gateway_dedupes", False)
        if key and dedupe:
            hit = w.idempotency.get(key)
            if hit:
                rec.emit("gateway", "ledger", "idempotency.hit", f"key {key} seen", dur=50,
                         detail="Same key as an earlier call: return the stored result, do nothing new.")
                return self._reply(200, hit, label="200 original result",
                                   detail="The retry gets the original result back. No second ticket.")
            rec.emit("gateway", "ledger", "idempotency.miss", f"key {key} new", dur=50,
                     detail="First time this key is seen: remember it, then run the call.")
        elif key and not dedupe:
            rec.emit("gateway", "gateway", "idempotency.ignored", "key ignored", status="warn", dur=40,
                     detail="The call carries a key but this gateway does not deduplicate.")

        project = args.get("project", "SUP")
        if cfg.get("buggy_tool"):
            project = "OPS"  # the fault: the tool files it in the wrong project
        rec.emit("gateway", "tool", "tool.execute", "create_ticket", dur=80, detail="Gateway forwards the call to the ticket tool.")
        ticket = {"id": f"TCK-{len(w.tickets) + 1}", "title": args.get("title", ""), "project": project}
        w.tickets.append(ticket)
        rec.emit("tool", "ledger", "ledger.write", ticket["id"], dur=60,
                 detail=f"{ticket['id']} is written to the ticket store (project {project}).")
        body = {"ticket_id": ticket["id"], "status": "created"}
        if key and dedupe:
            w.idempotency[key] = body

        if cfg.get("drop_response") and attempt == 1:
            rec.emit("tool", "gateway", "response.lost", "response lost", status="error", dur=80,
                     detail="The ticket exists, but the response never reaches the gateway.")
            rec.emit("gateway", "agent", "timeout", "timeout", status="error", dur=TIMEOUT_MS,
                     detail=f"No response within {TIMEOUT_MS} ms. The agent cannot tell if the ticket was created.")
            return f"TIMEOUT: no response within {TIMEOUT_MS} ms"
        rec.emit("tool", "gateway", "tool.response", "created", dur=60, detail="Tool answers: ticket created.")
        return self._reply(200, body, label="200 OK", detail="Gateway returns 200 to the agent.")

    def _get_ticket(self, args: dict[str, Any]) -> str:
        w, rec = self.w, self.w.rec
        rec.emit("gateway", "tool", "tool.execute", "get_ticket", dur=60, detail="Read-back: fetch the ticket as it was stored.")
        t = next((t for t in w.tickets if t["id"] == args.get("ticket_id")), None)
        rec.emit("tool", "ledger", "ledger.read", args.get("ticket_id", "?"), dur=50, detail="Read the ticket from the store.")
        if not t:
            return self._reply(404, {"error": "not found"}, status="error")
        return self._reply(200, t, label="200 OK", detail=f"Stored project is {t['project']}.")

    def _delete_record(self, args: dict[str, Any]) -> str:
        w, rec = self.w, self.w.rec
        rec.emit("gateway", "tool", "tool.execute", "delete_record", dur=70, detail="Gateway forwards the delete.")
        w.records.pop(args.get("record_id", ""), None)
        rec.emit("tool", "ledger", "ledger.delete", args.get("record_id", "?"), dur=60, detail="The record is removed from the store.")
        rec.emit("tool", "gateway", "tool.response", "deleted", dur=50, detail="Tool answers: deleted.")
        return self._reply(200, {"deleted": args.get("record_id")}, label="200 OK", detail="Gateway returns 200 to the agent.")

    # -- helpers -----------------------------------------------------------------------
    def _reply(self, code: int, body: dict[str, Any], *, status: str = "ok", label: str | None = None,
               detail: str = "") -> str:
        self.w.rec.emit("gateway", "agent", "gateway.response", label or f"{code}", dur=50, status=status,
                        detail=detail or f"Gateway returns {code}.", code=code)
        return f"HTTP {code} {json.dumps(body)}"


def _fmt(args: dict[str, Any]) -> str:
    return ", ".join(f"{k}={v!r}" for k, v in args.items() if v is not None)
