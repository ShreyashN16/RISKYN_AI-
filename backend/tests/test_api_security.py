import os
import pytest
from fastapi.testclient import TestClient
from main import app, score_limiter, ask_limiter

client = TestClient(app)

def test_admin_endpoints_token_gate(monkeypatch):
    # Case 1: ADMIN_TOKEN unset in env -> endpoint is open (200 OK)
    monkeypatch.delenv("ADMIN_TOKEN", raising=False)
    resp = client.get("/api/config/status")
    assert resp.status_code == 200
    assert "gemini_active" in resp.json()

    # Case 2: ADMIN_TOKEN set, but missing or mismatched header -> 401 Unauthorized
    monkeypatch.setenv("ADMIN_TOKEN", "secure-secret-token")
    resp_no_header = client.get("/api/config/status")
    assert resp_no_header.status_code == 401
    
    resp_wrong_header = client.get("/api/config/status", headers={"X-Admin-Token": "wrong-secret"})
    assert resp_wrong_header.status_code == 401

    # Case 3: ADMIN_TOKEN set and correct header provided -> 200 OK
    resp_valid = client.get("/api/config/status", headers={"X-Admin-Token": "secure-secret-token"})
    assert resp_valid.status_code == 200
    assert "gemini_active" in resp_valid.json()

def test_manual_score_validation():
    # Negative amount -> 422 Unprocessable Entity
    resp_neg = client.post("/api/score", json={"amount": -100.0})
    assert resp_neg.status_code == 422
    assert "Amount must be non-negative" in str(resp_neg.json())

    # Negative velocity count -> 422
    resp_count = client.post("/api/score", json={"amount": 500.0, "user_velocity_1h": -5})
    assert resp_count.status_code == 422
    assert "Counts must be non-negative" in str(resp_count.json())

    # Valid payload -> 200 OK
    score_limiter.history.clear()
    resp_valid = client.post("/api/score", json={"amount": 1500.0, "user_id": "u_test"})
    assert resp_valid.status_code == 200
    data = resp_valid.json()
    assert "risk_score" in data
    assert "decision" in data

def test_rate_limiting_enforcement():
    score_limiter.history.clear()
    
    # 30 allowed requests per minute
    for i in range(30):
        resp = client.post("/api/score", json={"amount": 100.0})
        assert resp.status_code == 200, f"Request {i+1} failed"
        
    # 31st request must trigger 429 Too Many Requests
    resp_exceeded = client.post("/api/score", json={"amount": 100.0})
    assert resp_exceeded.status_code == 429
    assert "Too many requests" in resp_exceeded.json()["detail"]

def test_deep_health_check():
    with TestClient(app) as c:
        resp = c.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"
        assert data["database"] == "connected"
        assert data["model_trained"] is True
        assert "model_version" in data
        assert "decision_threshold" in data

def test_frontend_static_assets():
    # Verify console page loads
    resp_console = client.get("/console")
    assert resp_console.status_code == 200
    assert "RISKYN AI" in resp_console.text
    assert '<link rel="stylesheet" href="/static/console.css?v=4">' in resp_console.text

    # Verify static CSS and JS are served properly
    resp_css = client.get("/static/console.css")
    assert resp_css.status_code == 200
    assert "--panel" in resp_css.text

    resp_js = client.get("/static/console.js")
    assert resp_js.status_code == 200
    assert "loadMetrics" in resp_js.text
