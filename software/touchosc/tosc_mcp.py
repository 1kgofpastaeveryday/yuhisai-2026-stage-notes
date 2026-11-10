"""Minimal client for the TouchOSC desktop MCP server (streamable HTTP, stateless).

The server only listens on 127.0.0.1 and is off by default. Start TouchOSC with
`open -a /Applications/TouchOSC.app --args --mcp.enabled=true` first.
"""
import json
import urllib.request

URL = "http://127.0.0.1:13579/mcp"
_next_id = 0


def _rpc(method, params=None):
    global _next_id
    _next_id += 1
    body = {"jsonrpc": "2.0", "id": _next_id, "method": method}
    if params is not None:
        body["params"] = params
    req = urllib.request.Request(
        URL,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode()
    # The server may answer as an SSE stream; the JSON-RPC payload is on the data: line.
    if not text.lstrip().startswith("{"):
        text = next(line[5:] for line in text.splitlines() if line.startswith("data:"))
    data = json.loads(text)
    if "error" in data:
        raise RuntimeError(json.dumps(data["error"], ensure_ascii=False))
    return data["result"]


def call(tool, **args):
    """Call a TouchOSC tool and return its parsed JSON result (or raw text)."""
    res = _rpc("tools/call", {"name": tool, "arguments": args})
    text = "".join(part.get("text", "") for part in res.get("content", []))
    if res.get("isError"):
        raise RuntimeError(f"{tool}: {text}")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text
