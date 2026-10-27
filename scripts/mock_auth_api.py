"""FAITHFUL MOCK tRPC API SERVER — multi Set-Cookie + x-renewed-token headers.

Playwright's route.fulfill(headers=...) cannot carry repeated Set-Cookie
headers (list values get stringified into ONE garbage header), so this real
HTTP server is used as the backend behind route.fetch → route.fulfill(response=...)
which preserves every header exactly as the production server emits them.
"""
import json, threading, http.server, socketserver, urllib.parse

MOCK_PORT = 4599
MOCK_BASE = f"http://127.0.0.1:{MOCK_PORT}"

USER = {"id": 77, "username": "sessiontester", "name": "Session Tester", "role": "user", "email": None}

TOKEN_V1 = "eyJhbGciOiJIUzI1NiJ9.v1.expired.sig"   # token stored at login / pre-expiry
TOKEN_V2 = "eyJhbGciOiJIUzI1NiJ9.v2.renewed.sig"   # token minted by renewal

# behaviour toggles (set by the test through /__control)
mode = {"renew": "off"}   # "off" | "cookie" | "header"
state = {"logged_out": False}


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, payload, extra_headers=None, content_type="application/json"):
        body = json.dumps(payload).encode() if payload is not None else b""
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        # CORS: the native WebView calls the API cross-origin (https://localhost →
        # production domain). x-renewed-token MUST be exposed or page JS can
        # never read it (Access-Control-Expose-Headers) — this mirrors the
        # production fix in api/boot.ts + the edge worker.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Auth-Token, X-Request-ID, X-Forwarded-For, X-Capacitor-Platform")
        self.send_header("Access-Control-Expose-Headers", "X-Request-ID, X-Renewed-Token")
        self.send_header("Access-Control-Allow-Credentials", "true")
        for k, v in (extra_headers or []):
            self.send_header(k, v)  # repeated call = repeated header (RFC-correct)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def log_message(self, *a):
        pass

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/__control":
            q = urllib.parse.parse_qs(parsed.query)
            if "renew" in q:
                mode["renew"] = q["renew"][0]
            self._send(200, {"mode": mode})
            return

        if path in ("/api/version", "/api/env", "/api/health"):
            self._send(200, {"status": "ok", "version": "e2e-mock"})
            return

        if not path.startswith("/api/trpc/"):
            self._send(404, {"error": "not found"})
            return

        name = path.split("/api/trpc/")[1].split("?")[0]
        if name == "auth.me":
            # Production contract: auth.logout REVOKES the session server-side,
            # so an auth.me racing the logout (logout onSuccess invalidate())
            # comes back 401 UNAUTHORIZED — no user, and CRUCIALLY no
            # x-renewed-token that the client fetch wrapper would re-store
            # into localStorage after removeStoredToken() already ran.
            if state["logged_out"]:
                body = json.dumps({
                    "error": {"json": {
                        "message": "UNAUTHORIZED",
                        "code": -32001,
                        "data": {"code": "UNAUTHORIZED", "httpStatus": 401, "path": "auth.me"},
                    }}
                }).encode()
                self.send_response(401)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Credentials", "true")
                self.end_headers()
                self.wfile.write(body)
                return
            auth = self.headers.get("authorization") or ""
            headers = []
            if mode["renew"] == "on" and auth:
                # Production contract: the renewal path re-mints the JWT and
                # delivers it BOTH as the renewed cookie pair (web) and as the
                # x-renewed-token header (native Bearer clients).
                headers.append(("X-Renewed-Token", TOKEN_V2))
                headers.append(("Set-Cookie", f"elbaz_auth={TOKEN_V2}; Max-Age=2592000; Path=/; SameSite=None; Secure; HttpOnly"))
                headers.append(("Set-Cookie", "elbaz_auth_flag=1; Max-Age=2592000; Path=/; SameSite=None; Secure"))
            self._send(200, {"result": {"data": {"json": USER}}}, headers)
            return

        self._send(404, {"error": f"unknown GET procedure {name}"})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if not path.startswith("/api/trpc/"):
            self._send(404, {"error": "not found"})
            return
        name = path.split("/api/trpc/")[1].split("?")[0]

        if name == "auth.login":
            state["logged_out"] = False  # a fresh login starts a live session
            headers = [
                ("Set-Cookie", f"elbaz_auth={TOKEN_V1}; Max-Age=2592000; Path=/; SameSite=None; Secure; HttpOnly"),
                ("Set-Cookie", "elbaz_auth_flag=1; Max-Age=2592000; Path=/; SameSite=None; Secure"),
            ]
            self._send(200, {"result": {"data": {"json": {"user": USER, "token": TOKEN_V1}}}}, headers)
            return

        if name == "auth.logout":
            state["logged_out"] = True  # server-side revocation (production contract)
            headers = [
                ("Set-Cookie", "elbaz_auth=; Max-Age=0; Path=/; SameSite=None; Secure; HttpOnly"),
                ("Set-Cookie", "elbaz_auth_flag=; Max-Age=0; Path=/; SameSite=None; Secure"),
            ]
            self._send(200, {"result": {"data": {"json": {"success": True}}}}, headers)
            return

        self._send(404, {"error": f"unknown POST procedure {name}"})


def start_mock_server():
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(("127.0.0.1", MOCK_PORT), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
