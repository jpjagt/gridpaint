"""Tiny stdlib HTTP API for the /lab page (see docs/architecture.md).

GET  /api/lab/recipes                         -> [recipe json]
POST /api/lab/run       {recipe, params?, seed?}   -> Design
POST /api/lab/variants  {recipe, params?, seeds}   -> [Design]
GET  /api/lab/health                          -> {"ok": true}
"""

from __future__ import annotations

import json
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .io import design_to_dict
from .recipes import list_recipes, run_recipe

MAX_VARIANTS = 32


class Handler(BaseHTTPRequestHandler):
    server_version = "gridlab/0.1"

    def _send(self, code: int, obj) -> None:
        body = json.dumps(obj, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _path(self) -> str:
        return self.path.split("?", 1)[0].rstrip("/")

    def do_GET(self):  # noqa: N802
        p = self._path()
        if p == "/api/lab/recipes":
            return self._send(200, [r.to_json() for r in list_recipes()])
        if p == "/api/lab/health":
            return self._send(200, {"ok": True})
        self._send(404, {"error": f"not found: {p}"})

    def do_POST(self):  # noqa: N802
        p = self._path()
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
            if p == "/api/lab/run":
                d = run_recipe(body["recipe"], body.get("params") or {}, int(body.get("seed") or 0))
                return self._send(200, design_to_dict(d))
            if p == "/api/lab/variants":
                seeds = [int(s) for s in (body.get("seeds") or [1, 2, 3, 4])][:MAX_VARIANTS]
                out = [design_to_dict(run_recipe(body["recipe"], body.get("params") or {}, s)) for s in seeds]
                return self._send(200, out)
            self._send(404, {"error": f"not found: {p}"})
        except (KeyError, ValueError, TypeError) as e:
            msg = e.args[0] if isinstance(e, KeyError) and e.args else str(e)
            self._send(400, {"error": str(msg)})
        except Exception as e:  # pragma: no cover
            traceback.print_exc()
            self._send(500, {"error": f"{type(e).__name__}: {e}"})

    def log_message(self, fmt, *args):
        print(f"[gridlab] {self.address_string()} {fmt % args}")


def make_server(port: int = 8765, host: str = "127.0.0.1") -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), Handler)


def serve(port: int = 8765, host: str = "127.0.0.1") -> None:
    srv = make_server(port, host)
    print(f"gridlab API on http://{host}:{port}/api/lab (recipes: {len(list_recipes())}); Ctrl+C to stop")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
