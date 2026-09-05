import os
import json
import pytest
from fastapi.testclient import TestClient
from main import app, model, init_db, DB_PATH, score_limiter
from model import FUSION_WEIGHTS, calculate_confidence
from reasoning import explain_decision
from llm_client import get_llm_status

client = TestClient(app)

@pytest.fixture(scope="module", autouse=True)
def setup_db():
    init_db()

def test_confidence_calculation():
    # Case 1: Perfect agreement (all rules and ML at 0)
    clean_rules = {"velocity": 0.0, "amount_deviation": 0.0, "device_ring": 0.0, "receiver_mule": 0.0, "geo_mismatch": 0.0}
    assert calculate_confidence(clean_rules, 0.0) == "HIGH"

    # Case 2: Extreme disagreement (velocity=1.0, others=0.0, ML=0.0)
    conflict_rules = {"velocity": 1.0, "amount_deviation": 0.0, "device_ring": 0.0, "receiver_mule": 0.0, "geo_mismatch": 0.0}
    assert calculate_confidence(conflict_rules, 0.0) in ("MEDIUM", "LOW")

def test_explain_structured_evidence():
    txn = {
        "id": "t_depth_test",
        "amount": 12000.0,
        "amount_ratio": 3.5,
        "user_velocity_1h": 6,
        "device_share_count_1h": 0,
        "receiver_concentration_1h": 0,
        "geo": "IN-MH"
    }
    decision = {
        "risk_score": 68.0,
        "decision": "BLOCK_AND_REVIEW",
        "top_signal": "velocity",
        "signals": {"velocity": 0.75, "amount_deviation": 0.4, "device_ring": 0.0, "receiver_mule": 0.0, "geo_mismatch": 0.0},
        "ml_anomaly_component": 0.8,
        "confidence": "MEDIUM"
    }
    res = explain_decision(txn, decision)
    assert "evidence_for" in res
    assert "evidence_against" in res
    assert "confidence" in res
    assert any("Velocity spike" in e for e in res["evidence_for"])
    assert any("Dedicated hardware signature" in e for e in res["evidence_against"])
    assert res["confidence"] == "MEDIUM"

def test_fusion_debugger_endpoint():
    score_limiter.history.clear()
    # Score a transaction first
    score_resp = client.post("/api/score", json={"amount": 4500.0, "user_velocity_1h": 5, "device_share_count_1h": 3})
    assert score_resp.status_code == 200
    txn_id = score_resp.json()["id"]

    res = client.get(f"/api/fusion/{txn_id}")
    assert res.status_code == 200
    data = res.json()
    assert "breakdown" in data
    assert "weights" in data
    assert "arithmetic_proof" in data
    
    # Verify manual arithmetic matches
    computed_sum = sum(b["contribution"] for b in data["breakdown"])
    assert abs(computed_sum - data["fused_score_before_guardrail"]) < 0.05
    assert abs(data["final_risk_score"] - round(data["fused_score_before_guardrail"], 1)) < 0.2

def test_counterfactual_endpoint():
    score_limiter.history.clear()
    # Score a flagged transaction
    score_resp = client.post("/api/score", json={"amount": 7500.0, "user_velocity_1h": 8, "device_share_count_1h": 4})
    txn_id = score_resp.json()["id"]

    res = client.get(f"/api/counterfactual/{txn_id}")
    assert res.status_code == 200
    data = res.json()
    assert "current_risk" in data
    assert "counterfactual_factors" in data
    assert "waterfall" in data
    assert data["baseline_neutralized_score"] < 25.0
    assert data["baseline_neutralized_decision"] == "ALLOW"

def test_replay_endpoint(monkeypatch):
    score_limiter.history.clear()
    # Score a transaction
    score_resp = client.post("/api/score", json={"amount": 2500.0, "user_velocity_1h": 0})
    txn_id = score_resp.json()["id"]

    # Test 1: Same model version -> reproducible == True
    res1 = client.get(f"/api/replay/{txn_id}")
    assert res1.status_code == 200
    assert res1.json()["reproducible"] is True

    # Test 2: Version mismatch -> reproducible == "model_version_mismatch"
    monkeypatch.setattr(model, "version", "2.0.0-experimental")
    res2 = client.get(f"/api/replay/{txn_id}")
    assert res2.status_code == 200
    assert res2.json()["reproducible"] == "model_version_mismatch"

def test_metrics_at_threshold():
    # Ensure model has evaluated test scores
    with TestClient(app) as c:
        res30 = c.get("/api/metrics/at_threshold?threshold=30")
        res50 = c.get("/api/metrics/at_threshold?threshold=50")
        res70 = c.get("/api/metrics/at_threshold?threshold=70")

        assert res30.status_code == 200
        assert res50.status_code == 200
        assert res70.status_code == 200

        m30 = res30.json()
        m50 = res50.json()
        m70 = res70.json()

        # Monotonic tradeoff: recall must decrease as threshold rises
        assert m30["recall"] >= m50["recall"] >= m70["recall"]

def test_incident_auto_grouping():
    res = client.get("/api/network")
    assert res.status_code == 200
    data = res.json()
    clusters = data.get("clusters", [])
    if clusters:
        for c in clusters:
            assert "incident_id" in c
            assert c["incident_id"].startswith("INC-")
        # Ensure clusters are sorted by total_volume_inr descending
        vols = [c["total_volume_inr"] for c in clusters]
        assert vols == sorted(vols, reverse=True)

def test_ai_killswitch_visibility(monkeypatch):
    # Unconfigured state
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    s1 = get_llm_status()
    assert s1["active"] is False
    assert "TEMPLATE FALLBACK" in s1["status"]

    # Configured state
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    s2 = get_llm_status()
    assert s2["active"] is True
    assert s2["status"] == "LIVE (Gemini)"
