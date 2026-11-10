#!/usr/bin/env python3
# the text editor's server: serves the repo so tools/text/editor.html can
# load ../../js/text.js and show the page beside its fields, and writes
# js/text.js when the editor saves (a POST to /save with the file's text as
# the body). local only.
#
#   python3 tools/text/serve.py             opens the editor in the browser
#   python3 tools/text/serve.py --no-open   serves it, opens nothing
import http.server
import os
import sys
import threading
import webbrowser

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TEXT = os.path.join(ROOT, 'js', 'text.js')
PORT = 8789
URL = f'http://127.0.0.1:{PORT}/tools/text/editor.html'


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # every edit must show on reload
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        if self.path != '/save':
            self.send_error(404)
            return
        n = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(n)
        with open(TEXT, 'wb') as f:
            f.write(body)
        print(f'wrote js/text.js ({n} bytes)', flush=True)
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(b'ok')

    # quiet: only the saves are printed
    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print(f'text editor at {URL}  (ctrl-c to stop)', flush=True)
    if '--no-open' not in sys.argv:
        threading.Timer(0.3, lambda: webbrowser.open(URL)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
