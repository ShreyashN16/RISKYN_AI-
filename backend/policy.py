"""
policy.py — Bounded AI authority, made inspectable.

The point of this file: nothing the model is allowed to do is implicit or
buried in code. A reviewer can read this one file and know exactly what
RISKYN can and cannot decide on its own.
"""

POLICY_VERSION = "1.0.0"

def get_policy(model):
    return {
        "policy_version": POLICY_VERSION,
        "authority_model": "bounded",
        "description": (
            "The AI scores and classifies. It never authorizes, reverses, holds, "
            "or moves funds, and never contacts a customer or a processor directly. "
            "Every action beyond scoring requires a human in the loop."
        ),
        "decision_bands": [
            {
                "decision": "ALLOW",
                "range": f"0 – {round(model.threshold * 0.6, 1)}",
                "ai_authority": "Full — no human step required",
                "human_role": "None; visible in audit log for spot-checking",
            },
            {
                "decision": "STEP_UP_VERIFY",
                "range": f"{round(model.threshold * 0.6, 1)} – {round(model.threshold, 1)}",
                "ai_authority": "Can request additional verification (e.g. OTP)",
                "human_role": "None required, but flagged for review queue",
            },
            {
                "decision": "BLOCK_AND_REVIEW",
                "range": f"{round(model.threshold, 1)} – 100",
                "ai_authority": "Can hold the transaction from auto-settling",
                "human_role": "Required — an analyst approves, reverses, or releases",
            },
        ],
        "amount_guardrails": {
            "description": (
                "These are plain amount thresholds, independent of the ML model. "
                "They can only escalate scrutiny, never reduce it — the AI cannot use "
                "a low risk score to bypass them."
            ),
            "step_up_amount_inr": model.guardrails["step_up_amount_inr"],
            "hard_block_amount_inr": model.guardrails["hard_block_amount_inr"],
        },
        "hard_limits": [
            "Cannot move, refund, or reverse funds under any decision band.",
            "Cannot contact the customer, bank, or acquirer directly.",
            "Cannot submit chargeback evidence — only assembles it for a human to submit.",
            "Cannot change its own threshold or policy bands without a retrain event, which is logged.",
            "Cannot use a low ML risk score to override an amount guardrail.",
        ],
        "current_threshold": round(model.threshold, 1),
    }
