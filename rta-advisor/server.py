#!/usr/bin/env python3
"""Serve the advisor and refresh its hero, multiplier, and season files."""

from __future__ import annotations

import json
import mimetypes
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

mimetypes.add_type("application/wasm", ".wasm")

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "tools"))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/") or path.endswith(".json"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/api/version":
            self.respond(read_version())
            return
        super().do_GET()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)
        if self.path.split("?", 1)[0] != "/api/update":
            self.send_error(404)
            return
        try:
            import build_catalog
            from live_data import refresh_all

            refresh_all(build_catalog)
        except SystemExit as exc:
            self.respond({"ok": False, "error": str(exc)}, 500)
            return
        except Exception as exc:  # noqa: BLE001
            self.respond({"ok": False, "error": str(exc)}, 500)
            return
        self.respond({"ok": True, "version": read_version()})

    def respond(self, payload, status=200):
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def read_version():
    path = ROOT / "data" / "version.json"
    if not path.exists():
        return {"ok": False, "error": "還沒有版本檔"}
    payload = json.loads(path.read_text())
    payload["ok"] = True
    return payload


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 8765), Handler)
    print("http://127.0.0.1:8765/")
    server.serve_forever()


if __name__ == "__main__":
    main()
