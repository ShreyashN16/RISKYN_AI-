import re
import os
import json
import sqlite3
from contextlib import closing
from reasoning import explain_decision
from llm_client import call_llm


def classify_intent(question: str) -> str:
    q = question.lower()
    # Prioritize count and statistical aggregates first
    if "how many" in q or "count" in q or "number of" in q:
        return "count_flagged"
    if "why" in q or "explain transaction" in q or "reason" in q or ("flagged" in q and ("txn" in q or "transaction" in q or any(char.isdigit() for char in q))):
        return "explain_transaction"
    if "cluster" in q or "ring" in q or "topology" in q:
        return "explain_cluster"
    if "guardrail" in q or "policy" in q or "limit" in q or "band" in q or "happens above" in q:
        return "policy_lookup"
    if "threshold" in q and ("what if" in q or "hypothetical" in q or "change" in q or "would happen" in q or "were" in q or "set to" in q):
        return "threshold_hypothetical"
    if "precision" in q or "recall" in q or "metrics" in q or "performance" in q or "f1" in q:
        return "general_stats"
    return "unknown"


def extract_txn_id(question: str) -> str:
    m = re.search(r"\bmanual_\d+\b", question)
    if m:
        return m.group(0)
    words = re.findall(r"\b[0-9a-fA-F]{8}\b", question)
    if words:
        return words[0]
    words = re.findall(r"\b[a-zA-Z0-9_-]{8,15}\b", question)
    for w in words:
        if any(c.isdigit() for c in w) or "_" in w:
            return w
    return None


def extract_threshold(question: str) -> float:
    numbers = re.findall(r"\b\d+(?:\.\d+)?\b", question)
    if numbers:
        for num in numbers:
            val = float(num)
            if 1.0 <= val <= 100.0:
                return val
    return None


def extract_cluster_id(question: str) -> str:
    m = re.search(r"\bRING-[A-Z]+\b", question, re.IGNORECASE)
    if m:
        return m.group(0).upper()
    return None


def template_answer(intent: str, facts: dict) -> str:
    if "error" in facts:
        return facts["error"]
        
    if intent == "explain_transaction":
        return facts.get("reasoning_trace", f"Transaction {facts['transaction_id']} scored {facts['risk_score']}/100 and resulted in {facts['decision']}.")
        
    elif intent == "explain_cluster":
        return (
            f"Cluster {facts['cluster_id']} shows a potential coordinated abuse ring. "
            f"It links {facts['sender_count']} distinct senders via shared {facts['shared_entity_type']} {facts['shared_entity_id']}. "
            f"Over a {facts['window_minutes']}-minute window, these accounts conducted transactions totaling ₹{facts['total_volume_inr']:,} "
            f"with an average risk score of {facts['avg_risk_score']}."
        )
        
    elif intent == "count_flagged":
        return (
            f"From the transactions recorded, the system has processed a total of {facts['total_transactions']} transactions. "
            f"Out of these, {facts['blocked_count']} were blocked and held for review, "
            f"{facts['step_up_count']} were flagged for step-up verification, "
            f"and {facts['allowed_count']} were allowed automatically."
        )
        
    elif intent == "policy_lookup":
        return (
            f"RISKYN enforces a bounded policy. Under current configuration, "
            f"transactions exceeding ₹{facts['step_up_amount_inr']:,} trigger at least a STEP_UP_VERIFY challenge. "
            f"Transactions exceeding ₹{facts['hard_block_amount_inr']:,} are forced to BLOCK_AND_REVIEW, bypassing the ML model. "
            f"The standard decision threshold is currently set to {facts['current_decision_threshold']:.1f}."
        )
        
    elif intent == "threshold_hypothetical":
        return (
            f"Based on {facts['sample_count']} historical evaluation transactions, "
            f"changing the threshold from {facts['current_threshold']:.1f} to {facts['hypothetical_threshold']:.1f} "
            f"would yield a precision of {facts['precision']:.1%}, recall of {facts['recall']:.1%}, "
            f"and F1 score of {facts['f1']:.1%}. Confusion matrix: TP={facts['tp']}, FP={facts['fp']}, FN={facts['fn']}, TN={facts['tn']}."
        )
        
    elif intent == "general_stats":
        return (
            f"The model has a current decision threshold of {facts['current_threshold']:.1f}. "
            f"On the held-out test split of {facts['test_set_size']} samples (containing {facts['test_fraud_count']} fraud cases), "
            f"the model achieves precision of {facts['precision']:.1%}, recall of {facts['recall']:.1%}, "
            f"F1 score of {facts['f1']:.1%}, and false positive rate of {facts['false_positive_rate']:.2%}."
        )
        
    return "I don't have enough structured data to answer that specific question. Try asking about a transaction, model metrics, policy rules, or cluster rings."


def answer_question(question: str, db_path, model) -> dict:
    intent = classify_intent(question)
    facts = {}

    with closing(sqlite3.connect(db_path)) as conn:
        conn.row_factory = sqlite3.Row

        if intent == "explain_transaction":
            txn_id = extract_txn_id(question)
            if not txn_id:
                facts = {"error": "Please provide a valid transaction ID (e.g. manual_12345 or an 8-char hex code)."}
            else:
                row = conn.execute("SELECT * FROM transactions WHERE id=?", (txn_id,)).fetchone()
                if not row:
                    facts = {"error": f"Transaction '{txn_id}' not found in the database."}
                else:
                    txn = dict(row)
                    txn["signals"] = json.loads(txn["signals"])
                    decision = {
                        "risk_score": txn["risk_score"],
                        "decision": txn["decision"],
                        "signals": txn["signals"],
                        "top_signal": txn["top_signal"],
                        "guardrail_applied": txn.get("guardrail_applied")
                    }
                    trace = explain_decision(txn, decision)
                    facts = {
                        "transaction_id": txn["id"],
                        "amount_inr": txn["amount"],
                        "user_id": txn["user_id"],
                        "receiver_id": txn["receiver_id"],
                        "device_id": txn.get("device_id"),
                        "geo": txn.get("geo"),
                        "timestamp": txn.get("ts"),
                        "risk_score": txn["risk_score"],
                        "decision": txn["decision"],
                        "top_signal": txn["top_signal"],
                        "signals": txn["signals"],
                        "guardrail_applied": txn.get("guardrail_applied"),
                        "reasoning_trace": trace["text"]
                    }

        elif intent == "explain_cluster":
            cluster_id = extract_cluster_id(question)
            if not cluster_id:
                facts = {"error": "Please provide a valid cluster ID (e.g., RING-A)."}
            else:
                from main import get_latest_clusters
                clusters = get_latest_clusters()
                target = None
                for c in clusters:
                    if c["cluster_id"] == cluster_id:
                        target = c
                        break
                if not target:
                    facts = {"error": f"Cluster '{cluster_id}' was not found in the active network graph."}
                else:
                    facts = {
                        "cluster_id": target["cluster_id"],
                        "sender_count": target["sender_count"],
                        "shared_entity_type": target["shared_entity_type"],
                        "shared_entity_id": target["shared_entity_id"],
                        "total_volume_inr": target["total_volume_inr"],
                        "avg_risk_score": target["avg_risk_score"],
                        "window_minutes": target["window_minutes"],
                        "member_node_ids": target["member_node_ids"]
                    }

        elif intent == "count_flagged":
            total = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
            blocked = conn.execute("SELECT COUNT(*) FROM transactions WHERE decision='BLOCK_AND_REVIEW'").fetchone()[0]
            step_up = conn.execute("SELECT COUNT(*) FROM transactions WHERE decision='STEP_UP_VERIFY'").fetchone()[0]
            allowed = conn.execute("SELECT COUNT(*) FROM transactions WHERE decision='ALLOW'").fetchone()[0]
            facts = {
                "total_transactions": total,
                "blocked_count": blocked,
                "step_up_count": step_up,
                "allowed_count": allowed
            }

        elif intent == "policy_lookup":
            facts = {
                "step_up_amount_inr": model.guardrails["step_up_amount_inr"],
                "hard_block_amount_inr": model.guardrails["hard_block_amount_inr"],
                "current_decision_threshold": model.threshold,
                "decision_bands": [
                    {"decision": "ALLOW", "range": f"0 to {round(model.threshold * 0.6, 1)}"},
                    {"decision": "STEP_UP_VERIFY", "range": f"{round(model.threshold * 0.6, 1)} to {round(model.threshold, 1)}"},
                    {"decision": "BLOCK_AND_REVIEW", "range": f"{round(model.threshold, 1)} to 100"}
                ]
            }

        elif intent == "threshold_hypothetical":
            threshold = extract_threshold(question)
            if threshold is None:
                facts = {"error": "Please specify a hypothetical threshold value (e.g., 65 or 65.0)."}
            else:
                rows = conn.execute(
                    "SELECT risk_score, fraud_type FROM transactions WHERE fraud_type != 'unknown' AND fraud_type != 'manual_test'"
                ).fetchall()
                if not rows:
                    facts = {
                        "hypothetical_threshold": threshold,
                        "current_threshold": model.threshold,
                        "tp": 0, "fp": 0, "fn": 0, "tn": 0,
                        "precision": 0.0, "recall": 0.0, "f1": 0.0,
                        "sample_count": 0
                    }
                else:
                    tp = fp = fn = tn = 0
                    for r in rows:
                        actual = 1 if r["fraud_type"] != "none" else 0
                        pred = 1 if r["risk_score"] >= threshold else 0
                        if actual == 1 and pred == 1:
                            tp += 1
                        elif actual == 0 and pred == 1:
                            fp += 1
                        elif actual == 1 and pred == 0:
                            fn += 1
                        else:
                            tn += 1
                    precision = tp / (tp + fp) if (tp + fp) else 0.0
                    recall = tp / (tp + fn) if (tp + fn) else 0.0
                    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
                    facts = {
                        "hypothetical_threshold": threshold,
                        "current_threshold": model.threshold,
                        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
                        "precision": round(precision, 3),
                        "recall": round(recall, 3),
                        "f1": round(f1, 3),
                        "sample_count": len(rows)
                    }

        elif intent == "general_stats":
            if model.metrics:
                facts = {
                    "current_threshold": model.threshold,
                    "precision": model.metrics["precision"],
                    "recall": model.metrics["recall"],
                    "f1": model.metrics["f1"],
                    "false_positive_rate": model.metrics["false_positive_rate"],
                    "test_set_size": model.metrics["test_set_size"],
                    "test_fraud_count": model.metrics["test_fraud_count"]
                }
            else:
                facts = {"error": "Model has not been trained/evaluated yet."}

        else:
            intent = "unknown"
            facts = {"message": "I don't have direct database queries for that question. You can ask about transactions, policy, metrics, or clusters."}

    system_prompt = (
        "You are RISKYN's grounded investigator. Answer the user's question using the provided facts where applicable. "
        "If the user is asking about specific transactions, devices, receivers, or metrics, you must rely strictly on the facts JSON. Do not invent any numbers. "
        "If the user is asking general conceptual questions (e.g. 'What is a false positive?', 'How does Isolation Forest work?'), explain using your general knowledge in a helpful risk analyst tone. "
        "Keep the response professional, concise, and under 4 sentences."
    )
    prompt = f"Question: {question}\n\nFacts JSON:\n{json.dumps(facts)}"
    
    llm_resp = call_llm(system_prompt, prompt)
    if llm_resp:
        return {"answer": llm_resp, "facts_used": facts, "source": "llm"}
        
    return {"answer": template_answer(intent, facts), "facts_used": facts, "source": "template"}
