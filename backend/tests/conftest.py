"""Shared test fixtures — ensures DB + model are initialized before any test."""
import pytest
from fastapi.testclient import TestClient
from main import app, init_db


@pytest.fixture(scope="session", autouse=True)
def _bootstrap_app():
    """Use the TestClient context manager to trigger FastAPI startup events
    (DB creation, model training) exactly once for the whole test session."""
    with TestClient(app):
        yield
