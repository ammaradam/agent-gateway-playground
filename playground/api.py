"""HTTP API: list scenarios, run one with chosen toggles. Returns the whole trace as JSON."""
from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .scenarios import SCENARIOS, public_catalogue, run_scenario

app = FastAPI(title="Agent Gateway Playground", docs_url="/api/docs", openapi_url="/api/openapi.json")


class RunRequest(BaseModel):
    scenario: str
    toggles: dict[str, Any] = Field(default_factory=dict)


@app.get("/api/scenarios")
def scenarios() -> list[dict[str, Any]]:
    return public_catalogue()


@app.post("/api/run")
async def run(req: RunRequest) -> dict[str, Any]:
    if req.scenario not in SCENARIOS:
        raise HTTPException(404, f"Unknown scenario '{req.scenario}'. Try one of: {', '.join(SCENARIOS)}.")
    return await run_scenario(req.scenario, req.toggles)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
