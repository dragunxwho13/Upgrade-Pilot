"""
conftest.py — pytest fixtures for Acme Inventory API tests.
"""
import pytest
from app import app as flask_app, _db, _next_id, seed_data


@pytest.fixture
def app():
    flask_app.config.update({'TESTING': True})
    yield flask_app


@pytest.fixture(autouse=True)
def reset_db():
    """Clear the in-memory store and re-seed before each test."""
    _db.clear()
    seed_data()
    yield
    _db.clear()


@pytest.fixture
def client(app):
    return app.test_client()
