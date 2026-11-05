"""A dev server that turns off browser caching, so reloading always shows your latest code.

Run it from the project folder:  python tools/serve.py [port]
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCache(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
print(f'Patchwork is running at http://localhost:{port}')
ThreadingHTTPServer(('', port), NoCache).serve_forever()
