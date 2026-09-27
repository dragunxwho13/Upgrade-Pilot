# Flask 3 Migration Guide

## Overview

Flask 3.0 drops Python 2 support, removes several long-deprecated APIs, and
introduces stricter typing and Werkzeug 3 compatibility. This document
summarises the breaking changes most commonly seen in Flask 1.x applications.

---

## Breaking Changes

### 1. `flask.json` module restructured
`flask.json` no longer exports `JSONEncoder` / `JSONDecoder` directly.

**Before (Flask 1/2):**
```python
from flask.json import JSONEncoder
class MyEncoder(JSONEncoder): ...
app.json_encoder = MyEncoder
```
**After (Flask 3):**
```python
from flask.json.provider import DefaultJSONProvider
class MyProvider(DefaultJSONProvider): ...
app.json_provider_class = MyProvider
```

---

### 2. `before_first_request` removed
`@app.before_first_request` was deprecated in Flask 2.2 and removed in 3.0.

**Before:**
```python
@app.before_first_request
def setup():
    init_db()
```
**After:**
```python
with app.app_context():
    init_db()
```
Or use `app.cli.with_appcontext` for CLI commands.

---

### 3. `send_file` / `send_from_directory` — `attachment_filename` kwarg removed
The `attachment_filename` keyword was renamed to `download_name` in Flask 2.0
and removed entirely in 3.0.

**Before:**
```python
send_file(path, attachment_filename='report.pdf')
```
**After:**
```python
send_file(path, download_name='report.pdf')
```

---

### 4. `Request.environ['werkzeug.request']` removed
Direct access via `environ['werkzeug.request']` was removed; use the `request`
proxy object directly.

---

### 5. `jsonify` error response shape change
In Flask 3, `jsonify` responses set `Content-Type: application/json` strictly;
the fallback `text/html` error pages are no longer injected.

---

### 6. `requests` library — `PreparedRequest` / response streaming API changes

The popular `requests` library (≥ 2.28) deprecated several patterns:

#### 6a. `requests.packages.urllib3` removed
**Before (requests ≤ 2.25):**
```python
from requests.packages import urllib3
urllib3.disable_warnings()
```
**After:**
```python
import urllib3
urllib3.disable_warnings()
```

#### 6b. `proxies` dict with `http` key — no scheme normalisation
`requests` ≥ 2.26 now expects fully-qualified scheme keys (`http://`, `https://`).
Using bare `http` / `https` keys still works but triggers a `DeprecationWarning`.

#### 6c. `Response.iter_content(decode_unicode=True)` preferred over `Response.text` in streaming loops

---

## Migration Checklist

- [ ] Replace `@app.before_first_request` with app-context initialisation
- [ ] Replace `app.json_encoder` with `app.json_provider_class`
- [ ] Replace `attachment_filename` kwarg with `download_name` in all `send_file` calls
- [ ] Remove `requests.packages.urllib3` imports; import `urllib3` directly
- [ ] Audit all `jsonify` error handlers — return explicit status codes
- [ ] Run `flask routes` to verify no route-registration regressions

---

## References

- https://flask.palletsprojects.com/en/3.0.x/changes/
- https://flask.palletsprojects.com/en/3.0.x/upgrading/
- https://docs.python-requests.org/en/latest/community/updates/
