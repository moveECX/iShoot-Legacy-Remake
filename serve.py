"""Tiny static dev-server for the iShoot remake.

Run it from the repository root:

    python serve.py            # serves on http://127.0.0.1:8080/
    python serve.py 8090       # custom port

The game needs to be served over HTTP (ES modules + fetch do not work from a
file:// URL). Any other static server works just as well.
"""
import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.command, self.path))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True   # avoid TIME_WAIT bind errors on restart
    address_family = 2           # AF_INET (IPv4)


if __name__ == "__main__":
    with Server(("0.0.0.0", PORT), Handler) as httpd:
        print(f"iShoot dev server running at http://127.0.0.1:{PORT}/")
        httpd.serve_forever()
