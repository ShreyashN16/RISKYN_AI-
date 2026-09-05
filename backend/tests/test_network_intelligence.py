import os
import sys
import json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient
from main import app, model, score_limiter, generate_decision_fingerprint
from reasoning import extract_evidence, explain_cluster
from policy import POLICY_VERSION

client = TestClient(app)

@pytest.fixture(autouse=True)
def reset_limiters_and_db():
    score_limiter.history.clear()


def test_cluster_evidence_shared_function():
    cluster_data = {
        "cluster_id": "RING-TEST",
        "incident_id": "INC-TEST1234",
        "sender_count": 4,
        "shared_entity_type": "receiver",
        "shared_entity_id": "rcv_test_mule",
        "total_volume_inr": 24000.0,
        "avg_risk_score": 68.5,
        "window_minutes": 12.0,
        "transactions": [
            {"amount": 6000.0, "user_id": f"usr_{i}", "receiver_id": "rcv_test_mule", "device_id": f"dev_{i}"}
            for i in range(4)
        ],
        "devices_count": 4,
        "receivers_count": 1,
    }
    decision = {
        "signals": {
            "receiver_mule": 0.8,
            "velocity": 0.6,
            "amount_deviation": 0.4,
            "device_ring": 0.2,
            "geo_mismatch": 0.0,
        },
        "ml_anomaly_component": 0.7,
        "risk_score": 68.5,
    }

    ev_for, ev_against, confidence = extract_evidence(cluster_data, decision, entity_type="cluster")
    assert isinstance(ev_for, list) and len(ev_for) > 0
    assert any("converged on shared receiver rcv_test_mule" in s for s in ev_for)
    assert any("Rapid burst" in s for s in ev_for)
    assert confidence in ("HIGH", "MEDIUM", "LOW")

    res = explain_cluster(cluster_data, decision)
    assert "text" in res
    assert "source" in res
    assert res["evidence_for"] == ev_for


def test_incident_detail_endpoint():
    # Insert or query network graph
    net_res = client.get("/api/network")
    assert net_res.status_code == 200
    clusters = net_res.json().get("clusters", [])
    if not clusters:
        # Generate burst transactions to create cluster
        client.post("/api/score", json={"amount": 4000, "user_id": "u1", "receiver_id": "r_mule_shared", "user_velocity_1h": 5})
        client.post("/api/score", json={"amount": 4500, "user_id": "u2", "receiver_id": "r_mule_shared", "user_velocity_1h": 6})
        client.post("/api/score", json={"amount": 4200, "user_id": "u3", "receiver_id": "r_mule_shared", "user_velocity_1h": 7})
        net_res = client.get("/api/network")
        clusters = net_res.json().get("clusters", [])

    assert len(clusters) > 0
    target_inc = clusters[0]["incident_id"]

    inc_res = client.get(f"/api/network/incident/{target_inc}")
    assert inc_res.status_code == 200
    d = inc_res.json()
    assert d["incident_id"] == target_inc
    assert "risk_score" in d
    assert "confidence" in d
    assert "entity_counts" in d
    assert "risk_drivers" in d and len(d["risk_drivers"]) == 6
    assert "activity_rate" in d
    assert "timeline" in d
    assert "subgraph" in d

    # Confirm manual arithmetic sum of risk drivers matches reported proof
    calc_sum = sum(driver["points"] for driver in d["risk_drivers"])
    proof_val = float(d["risk_drivers_proof"].split("=")[-1].strip())
    assert abs(calc_sum - proof_val) < 0.1


def test_detect_rings_action():
    resp = client.post("/api/network/detect")
    assert resp.status_code == 200
    data = resp.json()
    assert "clusters" in data
    assert "nodes" in data
    assert "edges" in data


def test_decision_fingerprint_stability_and_uniqueness():
    fp1 = generate_decision_fingerprint("txn_001", "1.1.0", POLICY_VERSION, {"amount_ratio": 2.5, "user_velocity_1h": 3}, "2026-09-04T12:00:00")
    fp2 = generate_decision_fingerprint("txn_001", "1.1.0", POLICY_VERSION, {"amount_ratio": 2.5, "user_velocity_1h": 3}, "2026-09-04T12:00:00")
    assert fp1 == fp2  # Identical snapshot -> identical fingerprint

    fp_diff_txn = generate_decision_fingerprint("txn_002", "1.1.0", POLICY_VERSION, {"amount_ratio": 2.5, "user_velocity_1h": 3}, "2026-09-04T12:00:00")
    assert fp1 != fp_diff_txn

    fp_diff_ver = generate_decision_fingerprint("txn_001", "1.2.0", POLICY_VERSION, {"amount_ratio": 2.5, "user_velocity_1h": 3}, "2026-09-04T12:00:00")
    assert fp1 != fp_diff_ver


def test_metrics_integrity_runtime_checks():
    resp = client.get("/api/metrics/integrity")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "PASS", f"Checks failed: {data['checks']}"
    checks = {c["id"]: c for c in data["checks"]}
    assert checks["split_sum_integrity"]["passed"] is True
    assert checks["val_threshold_isolation"]["passed"] is True
    assert checks["test_evaluation_isolation"]["passed"] is True
    assert checks["version_audit_integrity"]["passed"] is True


def test_incident_detail_stale_id_recovery():
    resp = client.get("/api/network/incident/INC-08404819")
    assert resp.status_code == 200
    data = resp.json()
    assert "incident_id" in data
    assert "risk_drivers" in data
    assert "activity_rate" in data
    assert "timeline" in data
