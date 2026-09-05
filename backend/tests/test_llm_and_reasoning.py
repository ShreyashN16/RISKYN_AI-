import pytest
import os
from reasoning import explain_decision
from agent import answer_question, classify_intent
from main import model, DB_PATH
from llm_client import call_llm

def test_llm_client_fallback_when_unconfigured(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    # Should gracefully return None when no providers configured
    res = call_llm("system prompt", "user prompt")
    assert res is None

def test_explain_decision_template_fallback(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    txn = {
        "id": "t_sample",
        "amount": 5500.0,
        "user_id": "u1",
        "receiver_id": "r1"
    }
    decision = {
        "risk_score": 75.0,
        "decision": "BLOCK_AND_REVIEW",
        "top_signal": "velocity",
        "signals": {
            "velocity": 0.8,
            "amount_deviation": 0.1,
            "device_ring": 0.0,
            "receiver_mule": 0.0,
            "geo_mismatch": 0.0
        }
    }

    explanation = explain_decision(txn, decision)
    assert explanation["source"] == "template"
    assert "Transaction t_sample scored 75.0/100" in explanation["text"]
    assert "held for manual review" in explanation["text"]

def test_agent_intent_classification():
    assert classify_intent("how many transactions were flagged?") == "count_flagged"
    assert classify_intent("how many transactions were blocked?") == "count_flagged"
    assert classify_intent("why was transaction 12345678 blocked?") == "explain_transaction"
    assert classify_intent("explain ring RING-A") == "explain_cluster"
    assert classify_intent("what is the hard block policy limit?") == "policy_lookup"
    assert classify_intent("what would happen if threshold were set to 70?") == "threshold_hypothetical"
    assert classify_intent("what is model precision and recall?") == "general_stats"
