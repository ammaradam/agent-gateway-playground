"""A tiny trace recorder. Every hop in a run becomes one event on a simulated clock."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

LANES = ("user", "agent", "gateway", "tool", "ledger")


@dataclass
class Event:
    id: int
    t: int  # simulated start time, ms
    dur: int  # simulated duration, ms
    src: str  # lane the packet leaves
    dst: str  # lane the packet arrives at
    kind: str  # machine-readable step name, e.g. "gateway.request"
    label: str  # short text shown on the packet
    detail: str = ""  # one sentence shown in the log
    status: str = "ok"  # ok | warn | error
    data: dict[str, Any] = field(default_factory=dict)


class Recorder:
    def __init__(self) -> None:
        self.events: list[Event] = []
        self.clock = 0

    def emit(self, src: str, dst: str, kind: str, label: str, *, dur: int = 60, detail: str = "",
             status: str = "ok", **data: Any) -> Event:
        ev = Event(len(self.events), self.clock, dur, src, dst, kind, label, detail, status, data)
        self.events.append(ev)
        self.clock += dur
        return ev

    def to_list(self) -> list[dict[str, Any]]:
        return [asdict(e) for e in self.events]
