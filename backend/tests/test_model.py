import pytest
import numpy as np
from data_gen import generate_dataset
from model import RiskModel, _rule_scores

def test_model_rule_signals():
    # Test normal transaction
    normal_txn = {
        "amount_ratio": 1.0,
        "geo_mismatch": 0,
        "user_velocity_1h": 0,
        "device_share_count_1h": 0,
        "receiver_concentration_1h": 0,
        "amount": 1000.0
    }
    signals = _rule_scores(normal_txn)
    assert signals["velocity"] == 0.0
    assert signals["amount_deviation"] == 0.0
    assert signals["device_ring"] == 0.0
    assert signals["receiver_mule"] == 0.0
    assert signals["geo_mismatch"] == 0.0

    # Test high velocity anomaly
    velocity_txn = {
        "amount_ratio": 1.0,
        "geo_mismatch": 0,
        "user_velocity_1h": 8,
        "device_share_count_1h": 0,
        "receiver_concentration_1h": 0,
        "amount": 1000.0
    }
    v_signals = _rule_scores(velocity_txn)
    assert v_signals["velocity"] == 1.0

    # Test geo mismatch anomaly
    geo_txn = {
        "amount_ratio": 1.0,
        "geo_mismatch": 1,
        "user_velocity_1h": 0,
        "device_share_count_1h": 0,
        "receiver_concentration_1h": 0,
        "amount": 1000.0
    }
    g_signals = _rule_scores(geo_txn)
    assert g_signals["geo_mismatch"] == 1.0

def test_amount_guardrails_precedence():
    model = RiskModel()
    
    # Synthetic normal transaction but with high amount exceeding 50,000 INR
    high_amount_txn = {
        "amount_ratio": 1.0,
        "geo_mismatch": 0,
        "user_velocity_1h": 0,
        "device_share_count_1h": 0,
        "receiver_concentration_1h": 0,
        "amount": 75000.0,
        "id": "t_high",
        "user_id": "u1",
        "receiver_id": "r1",
        "device_id": "d1",
        "geo": "IN-MH"
    }
    decision = model.fuse(high_amount_txn)
    # ML score alone would be 0, but hard block guardrail MUST take precedence
    assert decision["decision"] == "BLOCK_AND_REVIEW"
    assert decision["guardrail_applied"] == "hard_block_amount_inr"

    # Step-up verification guardrail (> 15,000 INR)
    step_up_txn = {
        "amount_ratio": 1.0,
        "geo_mismatch": 0,
        "user_velocity_1h": 0,
        "device_share_count_1h": 0,
        "receiver_concentration_1h": 0,
        "amount": 20000.0,
        "id": "t_step",
        "user_id": "u1",
        "receiver_id": "r1",
        "device_id": "d1",
        "geo": "IN-MH"
    }
    decision_step = model.fuse(step_up_txn)
    assert decision_step["decision"] == "STEP_UP_VERIFY"
    assert decision_step["guardrail_applied"] == "step_up_amount_inr"

def test_honest_train_val_test_split_and_evaluation():
    dataset = generate_dataset(n_normal=1000, n_fraud=300)
    model = RiskModel()
    metrics = model.train_and_evaluate(dataset)

    n_total = len(dataset)
    assert n_total > 1000
    
    # Verify exact 60/20/20 partition sizes
    expected_train = int(n_total * 0.60)
    expected_val = int(n_total * 0.20)
    expected_test = n_total - expected_train - expected_val
    
    assert abs(metrics["train_size"] - expected_train) <= 1
    assert abs(metrics["val_size"] - expected_val) <= 1
    assert abs(metrics["test_set_size"] - expected_test) <= 1
    
    # Verify metric keys and sanity
    assert 0.0 <= metrics["precision"] <= 1.0
    assert 0.0 <= metrics["recall"] <= 1.0
    assert 0.0 <= metrics["f1"] <= 1.0
    assert 0.0 <= metrics["false_positive_rate"] <= 1.0
    assert metrics["threshold_used"] > 0.0
    
    # Verify confusion matrix consistency on test split
    cm = metrics["confusion_matrix"]
    assert cm["tp"] + cm["fp"] + cm["fn"] + cm["tn"] == expected_test
    assert cm["tp"] + cm["fn"] == metrics["test_fraud_count"]
    
    # Verify cost model savings calculation
    cost = metrics["cost_model"]
    assert cost["estimated_savings_inr"] == cost["cost_no_detection_inr"] - cost["cost_with_model_inr"]
