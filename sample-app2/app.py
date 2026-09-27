"""
Acme Inventory API — deliberately LEGACY Flask 2.3.x application.

Pinned to:  Flask==2.3.3  Werkzeug==2.3.7  requests==2.28.2

Breaking patterns present (detected by scanner, break under Flask 3.0):
  1.  from flask import escape          — removed in Flask 3 (use markupsafe.escape)
  2.  from flask import Markup          — removed in Flask 3 (use markupsafe.Markup)
  3.  from requests.packages import urllib3 — removed path (use `import urllib3`)
  4.  app.config['JSON_SORT_KEYS']      — config key removed in Flask 3
  5.  app.config['JSONIFY_PRETTYPRINT_REGULAR'] — config key removed in Flask 3
  6.  FLASK_ENV environment variable    — removed in Flask 3 (use FLASK_DEBUG)
"""

import os

# ─── Breaking: flask.escape / flask.Markup removed in Flask 3 ─────────────────
#   In Flask 2.3 these emit DeprecationWarning; in Flask 3 they raise ImportError.
from flask import Flask, jsonify, request, abort, escape, Markup  # noqa: F401  ← breaking ×2

# ─── Breaking: requests.packages.urllib3 — removed path ──────────────────────
from requests.packages import urllib3   # ← breaking: use `import urllib3` directly
urllib3.disable_warnings()

# ─── App factory ─────────────────────────────────────────────────────────────
app = Flask(__name__)
app.config['TESTING'] = False

# ─── Breaking: removed config keys in Flask 3 ────────────────────────────────
app.config['JSON_SORT_KEYS'] = True             # ← breaking: removed in Flask 3
app.config['JSONIFY_PRETTYPRINT_REGULAR'] = False  # ← breaking: removed in Flask 3

# ─── Breaking: FLASK_ENV env var removed in Flask 3 ──────────────────────────
os.environ.setdefault('FLASK_ENV', 'development')  # ← breaking: use FLASK_DEBUG

# In-memory store (no real DB needed for demo)
_db = {}
_next_id = [1]


# ─── Seed helper ─────────────────────────────────────────────────────────────
def seed_data():
    """Seed two sample items. Called by conftest before each test."""
    _db[1] = {'id': 1, 'name': 'Widget A', 'qty': 100, 'status': 'active'}
    _db[2] = {'id': 2, 'name': 'Widget B', 'qty':  50, 'status': 'active'}
    _next_id[0] = 3


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route('/health')
def health():
    # ─── Breaking: flask.escape / Markup used inline ─────────────────────────
    _safe = escape('<b>status</b>')    # ← breaking: use markupsafe.escape
    _html = Markup('<em>ok</em>')      # ← breaking: use markupsafe.Markup
    return jsonify({'status': 'ok', 'version': '1.0.0', 'safe_demo': str(_safe)})


@app.route('/items', methods=['GET'])
def list_items():
    status_filter = request.args.get('status')
    items = list(_db.values())
    if status_filter:
        items = [i for i in items if i['status'] == status_filter]
    return jsonify(items)


@app.route('/items', methods=['POST'])
def create_item():
    data = request.get_json(silent=True)
    if not data or 'name' not in data:
        abort(400)
    item = {
        'id':     _next_id[0],
        'name':   data['name'],
        'qty':    data.get('qty', 0),
        'status': data.get('status', 'active'),
    }
    _db[_next_id[0]] = item
    _next_id[0] += 1
    return jsonify(item), 201


@app.route('/items/<int:item_id>', methods=['GET'])
def get_item(item_id):
    item = _db.get(item_id)
    if not item:
        abort(404)
    return jsonify(item)


@app.route('/items/<int:item_id>', methods=['PUT'])
def update_item(item_id):
    if item_id not in _db:
        abort(404)
    data = request.get_json(silent=True) or {}
    _db[item_id].update({k: v for k, v in data.items() if k != 'id'})
    return jsonify(_db[item_id])


@app.route('/items/<int:item_id>', methods=['DELETE'])
def delete_item(item_id):
    if item_id not in _db:
        abort(404)
    del _db[item_id]
    return jsonify({'deleted': item_id})


@app.route('/items/count')
def count_items():
    status_filter = request.args.get('status')
    items = list(_db.values())
    if status_filter:
        items = [i for i in items if i['status'] == status_filter]
    return jsonify({'count': len(items)})


if __name__ == '__main__':
    app.run(debug=True)
