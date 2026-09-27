# flask-legacy.py — deliberately LEGACY Flask 2.x fixture for scanner tests.
# Mirrors the breaking patterns in sample-app2/app.py.
# This file is intentionally NOT executable — it is a scan target only.

# Breaking: flask.escape removed in Flask 3
from flask import Flask, escape, Markup   # ← flask/escape-import + flask/markup-import

# Breaking: requests.packages.urllib3 removed path
from requests.packages import urllib3     # ← requests/packages-urllib3

app = Flask(__name__)

# Breaking: legacy config keys removed in Flask 3
app.config['JSON_SORT_KEYS'] = True               # ← flask/json-sort-keys-config
app.config['JSONIFY_PRETTYPRINT_REGULAR'] = False  # ← flask/jsonify-prettyprint-config

# Breaking: FLASK_ENV removed
FLASK_ENV = 'development'                          # ← flask/flask-env
