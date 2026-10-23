"""Local dev server for Riftscan. Default bind is localhost; pass the Tailscale IP as 2nd arg to reach it from the phone."""
import http.server, os, sys
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
host = sys.argv[2] if len(sys.argv) > 2 else '127.0.0.1'
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".webmanifest": "application/manifest+json", ".js": "text/javascript"}
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()
http.server.ThreadingHTTPServer((host, port), H).serve_forever()

