# Agent Gateway Playground

Break an AI agent on purpose. A real [Microsoft Agent Framework](https://github.com/microsoft/agent-framework) agent calls tools through a mock agent gateway. Flip a switch, and watch every step as a packet moving through the system, with a trace and an outcome at the end.

It makes the ideas in [AI Agent Platforms](https://ammar-site-black.vercel.app) testable instead of just readable.

## Scenarios

| Scenario | What you can break | Post |
|---|---|---|
| A tool call times out | Lose the response, then retry with and without an idempotency key, with and without gateway deduplication | [When a tool call times out, did it happen?](https://ammar-site-black.vercel.app/posts/tool-call-timeouts) |
| Who may delete this record? | Change the user, the delegated scope and the record's own policy; switch between a vague 403 and a helpful one | [An agent's identity is not its permission](https://ammar-site-black.vercel.app/posts/agent-identity-is-not-authorization) |
| A 200 that is wrong | A tool that files work in the wrong project while returning 200 OK; the agent either trusts the status or reads the result back | [A 200 OK doesn't mean the agent succeeded](https://ammar-site-black.vercel.app/posts/agent-success-is-not-a-200) |

## How it works

```
 User ─▶ Agent (Microsoft Agent Framework) ─▶ Gateway ─▶ Tool ─▶ Store
              │                                  │
              └── FunctionMiddleware ────────────┘   every tool call goes through the gateway
```

- **The agent is real.** `playground/scenarios.py` builds an `agent_framework.Agent` with `@tool` functions and a `FunctionMiddleware` (`GatewayMiddleware`). The middleware sends each tool call to the gateway instead of running it directly. This is the same extension point you would use to put a real policy layer in front of real tools.
- **The model is scripted.** `playground/client.py` is a small `BaseChatClient` (composed with `FunctionInvocationLayer`, like the built-in clients) whose "model" is a deterministic state machine. Every run is repeatable and needs no API key. Swap it for a real client to see how a live model behaves under the same gateway.
- **The gateway is mock.** `playground/gateway.py` does identity and policy checks, idempotency, and fault injection. Tools are fake and live in memory, so nothing outside the process is touched.
- **The trace is data.** Each hop becomes an event on a simulated clock (`playground/trace.py`). The API returns the whole trace, and the web UI replays it with controls (play, pause, step, scrub, speed).

## Run it

You need Python 3.11+ and Node 18+.

```bash
# API
python -m venv .venv
.venv/Scripts/activate        # macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"
uvicorn playground.api:app --port 8000

# UI (in another terminal)
cd web && npm install && npm run dev      # http://localhost:5173
```

Run the tests with `pytest`.

## Add a scenario

1. Write a "brain" in `playground/scenarios.py`: a function that looks at the messages so far and returns the next tool call or final answer.
2. Add an entry to `SCENARIOS` with its title, prompt and toggles. The UI renders the toggles from this list, so no front-end change is needed.
3. Add gateway behaviour in `playground/gateway.py` if the scenario needs a new tool or fault.
4. Add a test in `tests/`.

## Deploy

The repo deploys to Vercel as is: the UI builds from `web/` and the API runs as a Python function (`api/index.py`). `vercel.json` has the build settings.
