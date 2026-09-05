"""
reasoning.py — Structured reasoning trace for a risk decision.

Defense-only: explains a decision already made by model.py.
Structured into three auditable parts:
  - evidence_for: concrete facts elevating risk
  - evidence_against: concrete mitigating facts arguing against risk
  - confidence: HIGH / MEDIUM / LOW based on signal agreement
"""

import os
import json
from llm_client import call_llm
from model import calculate_confidence

SIGNAL_LABELS = {
    "velocity": "a burst of transactions from this sender in the last hour",
    "amount_deviation": "an amount far above this sender's usual spend",
    "device_ring": "this device being shared by multiple sender accounts",
    "receiver_mule": "this receiver collecting from many distinct senders quickly",
    "geo_mismatch": "a sending location that doesn't match the sender's usual geography",
}


def extract_evidence(data, decision=None, entity_type: str = "transaction"):
    """
    Extracts structured evidence_for, evidence_against, and deterministic confidence.
    Shared across both single transactions and aggregated network clusters.
    """
    decision = decision or {}
    signals = decision.get("signals", {})
    evidence_for = []
    evidence_against = []

    if entity_type == "cluster":
        # Cluster-level evidence extraction
        senders = data.get("sender_count", len(data.get("senders", [])))
        entity_type_str = data.get("shared_entity_type", "entity")
        entity_id = data.get("shared_entity_id", "unknown")
        txns = data.get("transactions", [])
        tx_count = len(txns) or data.get("tx_count", 0)
        window = data.get("window_minutes", 1.0)
        total_vol = data.get("total_volume_inr", sum(t.get("amount", 0.0) for t in txns))
        devices_count = data.get("devices_count", 1)
        receivers_count = data.get("receivers_count", 1)
        avg_risk = data.get("avg_risk_score", decision.get("risk_score", 0.0))

        # 1. Sender convergence & topology pattern
        if senders >= 2:
            evidence_for.append(f"{senders} distinct sender accounts converged on shared {entity_type_str} {entity_id}")
        else:
            evidence_against.append(f"Single sender activity without distributed account coordination")

        # 2. Velocity burst in cluster window
        if tx_count >= 3 and window <= 30.0:
            evidence_for.append(f"Rapid burst: {tx_count} coordinated transactions completed within an {window:.1f}-minute window")
        elif tx_count > 0:
            evidence_against.append(f"Dispersed transaction timing across an extended {window:.1f}-minute window")

        # 3. Hardware overlap / Device sharing
        if devices_count > 1 and entity_type_str == "device":
            evidence_for.append(f"Hardware multiplexing: device {entity_id} linked to {senders} separate accounts")
        elif devices_count == 1:
            evidence_against.append(f"Isolated device hardware profile with standard single-user binding")

        # 4. Receiver concentration / Mule pooling
        if entity_type_str == "receiver" and senders >= 3:
            evidence_for.append(f"Receiver mule aggregation: {senders} senders pooling funds into counterparty {entity_id}")
        elif receivers_count > 1:
            evidence_against.append(f"Counterparties distributed across {receivers_count} unrelated recipient entities")

        # 5. Volume & Transaction sizing
        low_val_count = sum(1 for t in txns if t.get("amount", 0.0) <= 2000.0)
        if total_vol >= 10000.0:
            evidence_for.append(f"High cumulative exposure: ₹{total_vol:,.2f} total volume in active circulation (avg risk: {avg_risk:.1f})")
        else:
            evidence_against.append(f"Moderate cumulative exposure: ₹{total_vol:,.2f} total volume across cluster")

        if tx_count > 0 and low_val_count >= max(1, tx_count // 2):
            evidence_against.append(f"{low_val_count} of {tx_count} member transactions are individually low-value micro-transfers (≤ ₹2,000)")

        # 6. ML & Guardrail contributions
        ml_score = decision.get("ml_anomaly_component", 0.0)
        if ml_score > 0.4:
            evidence_for.append(f"Unsupervised ML: IsolationForest classified cluster transactions as multivariate outliers (anomaly score: {ml_score:.2f})")
        else:
            evidence_against.append(f"Unsupervised ML: Cluster transactions remain within standard baseline distribution (score: {ml_score:.2f})")

        # Deterministic confidence for cluster aggregate signals
        confidence = decision.get("confidence") or calculate_confidence(signals, ml_score)
        return evidence_for, evidence_against, confidence

    # Default: Transaction-level evidence extraction
    txn = data
    # 1. Velocity
    vel_score = signals.get("velocity", 0.0)
    vel_count = txn.get("user_velocity_1h", 0)
    if vel_score > 0.15 or vel_count > 1:
        evidence_for.append(f"Velocity spike: {vel_count} transactions initiated in the last hour (signal score: {vel_score})")
    else:
        evidence_against.append(f"Normal transaction velocity: {vel_count} transaction(s) in the last hour")

    # 2. Amount deviation
    amt_score = signals.get("amount_deviation", 0.0)
    amount = txn.get("amount", 0.0)
    ratio = txn.get("amount_ratio", 1.0)
    if amt_score > 0.15 or ratio > 1.5:
        evidence_for.append(f"Amount deviation: ₹{amount:,.2f} is {ratio}x sender's typical baseline")
    else:
        evidence_against.append(f"Typical transfer volume: ₹{amount:,.2f} aligns with sender historical average")

    # 3. Device sharing / ring
    dev_score = signals.get("device_ring", 0.0)
    dev_shares = txn.get("device_share_count_1h", 0)
    dev_id = txn.get("device_id", "unknown")
    if dev_score > 0.15 or dev_shares > 1:
        evidence_for.append(f"Device ring pattern: device {dev_id} shared across {dev_shares} distinct accounts in 1h")
    else:
        evidence_against.append(f"Dedicated hardware signature: device {dev_id} shows no multi-account sharing")

    # 4. Receiver concentration / mule
    rcv_score = signals.get("receiver_mule", 0.0)
    rcv_conc = txn.get("receiver_concentration_1h", 0)
    rcv_id = txn.get("receiver_id", "unknown")
    if rcv_score > 0.15 or rcv_conc > 2:
        evidence_for.append(f"Receiver mule aggregation: receiver {rcv_id} collected funds from {rcv_conc} senders in 1h")
    else:
        evidence_against.append(f"Standard counterparty: receiver {rcv_id} exhibits no high-velocity inward concentration")

    # 5. Geo mismatch
    geo_score = signals.get("geo_mismatch", 0.0)
    geo = txn.get("geo", "unknown")
    if geo_score > 0.15:
        evidence_for.append(f"Geographic discrepancy: transaction initiated from unusual region {geo}")
    else:
        evidence_against.append(f"Geographic consistency: transaction origin {geo} matches known user profile")

    # 6. Policy Guardrails
    guardrail = decision.get("guardrail_applied")
    if guardrail:
        evidence_for.append(f"Deterministic policy guardrail: {guardrail} enforced bounded-authority risk override")

    # 7. ML IsolationForest
    ml_score = decision.get("ml_anomaly_component", 0.0)
    if ml_score > 0.5:
        evidence_for.append(f"Unsupervised ML: IsolationForest detected multivariate outlier (anomaly score: {ml_score:.2f})")
    else:
        evidence_against.append(f"Unsupervised ML: IsolationForest placed transaction within nominal baseline cluster (score: {ml_score:.2f})")

    # Deterministic confidence
    confidence = decision.get("confidence") or calculate_confidence(signals, ml_score)
    return evidence_for, evidence_against, confidence


# Backward compatibility alias
_extract_evidence = extract_evidence


def _template_explanation(txn, decision, evidence_for, evidence_against, confidence):
    signals = decision["signals"]
    active = sorted(
        ((k, v) for k, v in signals.items() if v > 0.15),
        key=lambda kv: -kv[1],
    )
    guardrail = decision.get("guardrail_applied")

    if guardrail:
        guardrail_text = {
            "hard_block_amount_inr": "the amount alone exceeds the hard-block guardrail, regardless of what the risk model scored",
            "step_up_amount_inr": "the amount alone exceeds the step-up guardrail, regardless of what the risk model scored",
        }.get(guardrail, "an amount-based guardrail")
        base = active and f" (the model's own signals also pointed to {SIGNAL_LABELS.get(active[0][0], active[0][0])})" or ""
        action = {"BLOCK_AND_REVIEW": "held for manual review", "STEP_UP_VERIFY": "sent for step-up verification"}.get(decision["decision"], decision["decision"])
        return (
            f"Transaction {txn['id']} was {action} because {guardrail_text}{base}. "
            f"This escalation came from a fixed policy rule, not the ML model — the AI cannot waive it."
        )

    if not active:
        return (
            f"Transaction {txn['id']} shows no material risk signals — amount, velocity, "
            f"device, and receiver patterns are all consistent with this sender's normal "
            f"behavior. Risk score {decision['risk_score']}/100, allowed automatically."
        )

    reasons = [SIGNAL_LABELS.get(k, k) for k, _ in active[:3]]
    if len(reasons) == 1:
        reason_text = reasons[0]
    elif len(reasons) == 2:
        reason_text = f"{reasons[0]} and {reasons[1]}"
    else:
        reason_text = f"{reasons[0]}, {reasons[1]}, and {reasons[2]}"

    action = {
        "BLOCK_AND_REVIEW": "held for manual review before it settles",
        "STEP_UP_VERIFY": "sent for a step-up verification challenge",
        "ALLOW": "allowed",
    }.get(decision["decision"], decision["decision"])

    return (
        f"Transaction {txn['id']} scored {decision['risk_score']}/100 primarily because of "
        f"{reason_text}. Under current policy, transactions at this score are {action}. "
        f"This is a recommendation only — a human reviewer makes the final call."
    )


def _llm_explanation(txn, decision, evidence_for, evidence_against, confidence):
    system_prompt = (
        "You are a payments risk analyst assistant. Explain, in 2-3 plain-English "
        "sentences, why a transaction received its risk score, using ONLY the facts "
        "provided in the evidence package. You are strictly forbidden from inventing, "
        "hallucinating, or mentioning any facts, metrics, or signals not explicitly listed "
        "in the provided evidence. Never suggest an action beyond what the policy already "
        "assigned. Be concise, factual, and auditable."
    )
    user_prompt = (
        f"Transaction: {json.dumps({k: txn.get(k) for k in ['id','amount','user_id','receiver_id']})}\n"
        f"Risk score: {decision['risk_score']}/100\n"
        f"Policy decision: {decision['decision']}\n"
        f"Confidence: {confidence}\n"
        f"Evidence for risk:\n" + "\n".join(f"- {e}" for e in evidence_for) + "\n"
        f"Evidence against risk (mitigating factors):\n" + "\n".join(f"- {e}" for e in evidence_against)
    )

    # Route through unified multi-provider fallback engine (Gemini -> Groq -> Claude)
    return call_llm(system_prompt=system_prompt, user_prompt=user_prompt, max_tokens=200, timeout=8)


def explain_decision(txn, decision):
    evidence_for, evidence_against, confidence = extract_evidence(txn, decision, entity_type="transaction")
    llm_text = _llm_explanation(txn, decision, evidence_for, evidence_against, confidence)
    
    text = llm_text if llm_text else _template_explanation(txn, decision, evidence_for, evidence_against, confidence)
    source = "llm" if llm_text else "template"

    return {
        "text": text,
        "source": source,
        "evidence_for": evidence_for,
        "evidence_against": evidence_against,
        "confidence": confidence,
    }


def explain_cluster(cluster_info, decision):
    """
    Produces structured evidence_for, evidence_against, confidence, and natural language
    explanation trace for a network cluster or incident.
    """
    evidence_for, evidence_against, confidence = extract_evidence(cluster_info, decision, entity_type="cluster")

    system_prompt = (
        "You are RISKYN's cluster intelligence analyst. Explain, in 2-3 sentences, "
        "why this network cluster indicates coordinated payments abuse or mule ring behavior, "
        "using ONLY the facts provided in the evidence list. Never invent a number or fact. "
        "Be concise, factual, and auditable."
    )
    user_prompt = (
        f"Incident: {cluster_info.get('incident_id', cluster_info.get('cluster_id'))}\n"
        f"Risk score: {cluster_info.get('avg_risk_score', decision.get('risk_score', 0))}/100\n"
        f"Confidence: {confidence}\n"
        f"Evidence for risk:\n" + "\n".join(f"- {e}" for e in evidence_for) + "\n"
        f"Mitigating factors:\n" + "\n".join(f"- {e}" for e in evidence_against)
    )

    llm_text = call_llm(system_prompt=system_prompt, user_prompt=user_prompt, max_tokens=200, timeout=8)

    if not llm_text:
        # High-credibility deterministic template
        s_count = cluster_info.get("sender_count", 0)
        ent_type = cluster_info.get("shared_entity_type", "entity")
        ent_id = cluster_info.get("shared_entity_id", "unknown")
        vol = cluster_info.get("total_volume_inr", 0.0)
        risk = cluster_info.get("avg_risk_score", decision.get("risk_score", 0.0))
        llm_text = (
            f"Cluster {cluster_info.get('incident_id', cluster_info.get('cluster_id'))} represents {s_count} sender accounts "
            f"converging on shared {ent_type} {ent_id}, generating ₹{vol:,.2f} total volume with an average risk score of {risk:.1f}/100. "
            f"Topology exhibits coordinated behavioral correlation across member transactions."
        )

    return {
        "text": llm_text,
        "source": "llm" if os.environ.get("GEMINI_API_KEY") or os.environ.get("GROQ_API_KEY") or os.environ.get("ANTHROPIC_API_KEY") else "template",
        "evidence_for": evidence_for,
        "evidence_against": evidence_against,
        "confidence": confidence,
    }
