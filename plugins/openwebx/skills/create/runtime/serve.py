#!/usr/bin/env python3
"""Serve this openwebx site locally: python serve.py [port]

ES modules must be served over HTTP (file:// blocks them), and on Windows the
stock http.server can label .js as text/plain, which browsers refuse to run as
a module. This server pins the MIME types and disables caching.
"""
import functools
import http.server
import os
import socketserver
import sys
import webbrowser
from pathlib import Path

TYPES = {
    ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
    ".json": "application/json", ".html": "text/html; charset=utf-8",
    ".svg": "image/svg+xml", ".webp": "image/webp", ".avif": "image/avif",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".glsl": "text/plain", ".wasm": "application/wasm", ".woff2": "font/woff2",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **TYPES}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "404" in (args[1] if len(args) > 1 else ""):
            super().log_message(fmt, *args)


class Server(socketserver.ThreadingTCPServer):
    # A page pulls ~30 ES modules at once; the default backlog of 5 drops some.
    request_queue_size = 128
    daemon_threads = True
    # On Windows SO_REUSEADDR lets a second server bind a port that is already
    # in use (and silently serve the wrong site), so only reuse elsewhere.
    allow_reuse_address = os.name != "nt"


def main():
    nums = [a for a in sys.argv[1:] if a.isdigit()]
    port = int(nums[0]) if nums else 5173
    root = Path(__file__).resolve().parent
    handler = functools.partial(Handler, directory=str(root))
    for candidate in range(port, port + 20):
        try:
            httpd = Server(("127.0.0.1", candidate), handler)
            break
        except OSError:
            continue
    else:
        sys.exit(f"No free port in {port}-{port + 19}")
    url = f"http://127.0.0.1:{candidate}/"
    print(f"openwebx: serving {root.name} at {url}  (Ctrl+C to stop)")
    if "--no-open" not in sys.argv:
        webbrowser.open(url)
    with httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
