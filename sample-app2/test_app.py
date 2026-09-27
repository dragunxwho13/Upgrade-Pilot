"""
test_app.py — Integration tests for the Acme Inventory API (legacy Flask 1.x).

All 12 tests must pass on:
  Flask==1.1.4, Werkzeug==1.0.1, requests==2.25.1, pytest==7.4.4
"""
import json
import pytest


# ─── Helper ───────────────────────────────────────────────────────────────────
def post_item(client, name='Widget X', qty=10, status='active'):
    return client.post(
        '/items',
        data=json.dumps({'name': name, 'qty': qty, 'status': status}),
        content_type='application/json',
    )


# ─── Tests ────────────────────────────────────────────────────────────────────

def test_01_health(client):
    """1. GET /health returns 200 and status ok."""
    r = client.get('/health')
    assert r.status_code == 200
    data = json.loads(r.data)
    assert data['status'] == 'ok'


def test_02_list_items_initially_empty(client):
    """2. GET /items returns an array (may contain seed data after first req)."""
    r = client.get('/items')
    assert r.status_code == 200
    data = json.loads(r.data)
    assert isinstance(data, list)


def test_03_create_item_returns_201(client):
    """3. POST /items creates a new item and returns 201."""
    r = post_item(client, name='Gadget Z', qty=5)
    assert r.status_code == 201
    data = json.loads(r.data)
    assert data['name'] == 'Gadget Z'
    assert data['qty'] == 5
    assert 'id' in data


def test_04_create_item_missing_name_returns_400(client):
    """4. POST /items without name returns 400."""
    r = client.post(
        '/items',
        data=json.dumps({'qty': 5}),
        content_type='application/json',
    )
    assert r.status_code == 400


def test_05_get_item_by_id(client):
    """5. GET /items/:id returns the created item."""
    create_r = post_item(client, name='Item Five', qty=99)
    item_id = json.loads(create_r.data)['id']
    r = client.get(f'/items/{item_id}')
    assert r.status_code == 200
    data = json.loads(r.data)
    assert data['id'] == item_id
    assert data['name'] == 'Item Five'


def test_06_get_nonexistent_item_returns_404(client):
    """6. GET /items/99999 returns 404."""
    r = client.get('/items/99999')
    assert r.status_code == 404


def test_07_update_item(client):
    """7. PUT /items/:id updates the item and returns the new document."""
    create_r = post_item(client, name='Old Name', qty=1)
    item_id = json.loads(create_r.data)['id']
    r = client.put(
        f'/items/{item_id}',
        data=json.dumps({'name': 'New Name', 'qty': 42}),
        content_type='application/json',
    )
    assert r.status_code == 200
    data = json.loads(r.data)
    assert data['name'] == 'New Name'
    assert data['qty'] == 42


def test_08_update_nonexistent_item_returns_404(client):
    """8. PUT /items/99999 returns 404."""
    r = client.put(
        '/items/99999',
        data=json.dumps({'name': 'Ghost'}),
        content_type='application/json',
    )
    assert r.status_code == 404


def test_09_delete_item(client):
    """9. DELETE /items/:id removes the item."""
    create_r = post_item(client, name='Doomed Item', qty=3)
    item_id = json.loads(create_r.data)['id']
    r = client.delete(f'/items/{item_id}')
    assert r.status_code == 200
    data = json.loads(r.data)
    assert data['deleted'] == item_id
    # Confirm it's gone
    r2 = client.get(f'/items/{item_id}')
    assert r2.status_code == 404


def test_10_count_items(client):
    """10. GET /items/count returns correct total (exercises count endpoint)."""
    # Seed 2 items
    post_item(client, name='Count A', qty=1, status='active')
    post_item(client, name='Count B', qty=2, status='inactive')
    r = client.get('/items/count')
    assert r.status_code == 200
    data = json.loads(r.data)
    assert 'count' in data
    assert isinstance(data['count'], int)
    assert data['count'] >= 2


def test_11_count_items_filtered_by_status(client):
    """11. GET /items/count?status=inactive returns filtered count."""
    post_item(client, name='Filter A', qty=1, status='inactive')
    post_item(client, name='Filter B', qty=2, status='active')
    r = client.get('/items/count?status=inactive')
    assert r.status_code == 200
    data = json.loads(r.data)
    assert data['count'] >= 1


def test_12_list_items_filtered_by_status(client):
    """12. GET /items?status=active returns only active items."""
    post_item(client, name='Active One',   qty=1, status='active')
    post_item(client, name='Inactive One', qty=1, status='inactive')
    r = client.get('/items?status=active')
    assert r.status_code == 200
    items = json.loads(r.data)
    assert all(i['status'] == 'active' for i in items)
