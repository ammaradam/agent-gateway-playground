"""A scripted chat client for Microsoft Agent Framework.

It stands in for an LLM so every scenario is deterministic and runs without an API key.
It plugs into the same layers a real client uses, so the Agent, the tool-calling loop
and the function middleware are the real thing; only the "model" is a small state machine.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any

from agent_framework import (
    BaseChatClient,
    ChatMiddlewareLayer,
    ChatResponse,
    Content,
    FunctionInvocationLayer,
    Message,
)

Brain = Callable[[list[Message]], list[Content]]


class ScriptedClient(FunctionInvocationLayer, ChatMiddlewareLayer, BaseChatClient):
    def __init__(self, brain: Brain, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._brain = brain

    def _inner_get_response(self, *, messages: Sequence[Message], stream: bool,
                            options: Mapping[str, Any], **kwargs: Any):
        if stream:
            raise NotImplementedError("The scripted client does not stream.")

        async def respond() -> ChatResponse:
            contents = self._brain(list(messages))
            return ChatResponse(messages=[Message("assistant", contents)])

        return respond()


def tool_results(messages: Sequence[Message]) -> list[str]:
    """Text of every tool result seen so far, oldest first."""
    out: list[str] = []
    for m in messages:
        for c in m.contents:
            if c.type == "function_result":
                out.append(str(c.result))
    return out


def call(call_id: str, name: str, **arguments: Any) -> Content:
    return Content.from_function_call(call_id, name, arguments=arguments)


def say(text: str) -> Content:
    return Content.from_text(text)
