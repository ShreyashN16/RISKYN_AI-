"""
evidence.py — Chargeback evidence packet assembler.

Strictly defense-only: this compiles existing transaction/device/history data
into a structured, human-readable packet a merchant can submit to a payment
processor's dispute process. It NEVER contacts a customer, a bank, or an
acquirer, and it never authorizes, reverses, or moves funds — it only reads
data already produced by the risk engine and formats it for a human to use.
"""

from datetime import datetime, timezone


def build_evidence_packet(txn, history, decision):
    prior_count = len(history)
    prior_clean = sum(1 for h in history if h.get("decision") == "ALLOW")
    clean_rate = round((prior_clean / prior_count) * 100, 1) if prior_count else None

    strength_points = []
    if prior_count >= 3 and clean_rate and clean_rate >= 80:
        strength_points.append(
            f"Sender has {prior_count} prior transactions with a {clean_rate}% clean history — "
            "supports legitimate usage pattern."
        )
    if txn["signals"]["device_ring"] < 0.2:
        strength_points.append("Device fingerprint not associated with other sender accounts.")
    if txn["signals"]["geo_mismatch"] == 0:
        strength_points.append("Sending location consistent with sender's historical geography.")
    if decision["risk_score"] < 40:
        strength_points.append("Independent risk model scored this transaction as low-risk at time of authorization.")

    risk_points = []
    if txn["signals"]["velocity"] > 0.4:
        risk_points.append("Elevated transaction velocity observed in the hour preceding this transaction.")
    if txn["signals"]["amount_deviation"] > 0.4:
        risk_points.append("Transaction amount deviates materially from sender's historical average.")
    if txn["signals"]["device_ring"] > 0.4:
        risk_points.append("Device associated with multiple distinct sender accounts.")
    if txn["signals"]["receiver_mule"] > 0.4:
        risk_points.append("Receiver has an elevated concentration of distinct senders in a short window.")

    packet = {
        # Strip tzinfo to consistently maintain naive datetime formats across DB writes
        "generated_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
        "transaction_id": txn["id"],
        "amount_inr": txn["amount"],
        "timestamp": txn["ts"],
        "risk_score_at_authorization": decision["risk_score"],
        "model_decision_at_authorization": decision["decision"],
        "sender_history_summary": {
            "prior_transactions_reviewed": prior_count,
            "prior_clean_rate_pct": clean_rate,
        },
        "supporting_evidence_for_merchant": strength_points or [
            "No strong compensating evidence found — recommend manual underwriting review before submission."
        ],
        "risk_factors_disclosed": risk_points or ["None material — transaction was low-risk across all signals."],
        "recommended_action": (
            "Submit as compelling evidence for representment"
            if len(strength_points) >= 2 and decision["risk_score"] < 50
            else "Escalate to human fraud analyst before responding to the dispute"
        ),
        "disclaimer": (
            "This packet is a documentation aid assembled from existing records. "
            "It takes no automated action and must be reviewed by an authorized "
            "person before submission to any processor or acquirer."
        ),
    }
    return packet
