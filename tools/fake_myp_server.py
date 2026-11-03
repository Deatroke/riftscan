"""Tiny stand-in for the MYP Cards API, to test tools/sync_myp.py without access.

    python tools/fake_myp_server.py 8765
    MYP_BASE_URL=http://127.0.0.1:8765/api/v1 python tools/sync_myp.py

Serves GET /api/v1/riftbound/precos with the documented shape (page_number, page_size, cards[]), 120 fake cards.
"""
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

CARDS = [{'internal_code': 1000 + i, 'card_code': f'OGN-{i:03d}', 'tcg_productId': 650000 + i if i % 10 else None,
          'name_en': f'Fake {i}', 'min_price': f'{1 + i / 10:.2f}' if i % 3 else None, 'avg_price': f'{2 + i / 10:.2f}' if i % 3 else None,
          'deck_labels': [f'Fake {i} [OGN] {i}', f'Fake {i} OGN ({i:03d}/298)'], 'link': f'https://mypcards.com/riftbound/produto/{1000 + i}/fake-{i}'}
         for i in range(1, 121)]


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path != '/api/v1/riftbound/precos':
            return self.send(404, {'error': 'nope', 'code': 'not_found', 'status': 404})
        page, size = max(1, int(q.get('page_number', ['1'])[0])), min(50, int(q.get('page_size', ['50'])[0]))
        self.send(200, {'page_number': page, 'page_size': size, 'cards': CARDS[(page - 1) * size: page * size]})

    def send(self, status, body):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('X-Rate-Limit-Limit', '60')
        self.send_header('X-Rate-Limit-Remaining', '59')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    HTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8765), H).serve_forever()
