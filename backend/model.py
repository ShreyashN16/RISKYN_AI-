"""
model.py — Fraud-spike / abuse-ring detector.

Design (defense-only — this module only SCORES and EXPLAINS, it never moves
money or contacts anyone):

  1. Rule layer: five interpretable 0..1 signals per transaction
     (velocity, amount deviation, device sharing, receiver concentration,
     geo mismatch).
  2. ML layer: an unsupervised IsolationForest fit on the engineered feature
     matrix, treated as if the historical data were unlabeled (as it would
     be in production before any fraud is confirmed).
  3. Fusion: rule_score and normalized IF anomaly score are blended into a
     single 0..100 risk score.
  4. Honest evaluation: data is split 60/20/20 into train/val/test BEFORE
     anything is fit. The IF is fit on train. The decision threshold is
     chosen on val by maximizing F1. Final precision/recall/F1/FPR and a
     false-positive-cost estimate are reported ONLY on the untouched test
     split, so the numbers we show are a genuine held-out estimate.
  5. Bounded authority: the model's own risk score is NEVER the final word
     on high-value transactions. Guardrails (plain amount thresholds, no ML
     involved) can force STEP_UP_VERIFY or BLOCK_AND_REVIEW regardless of
     what the model thinks — the AI can escalate scrutiny, it can never
     unilaterally clear a transaction above a merchant-set ceiling.
  6. Persistence: a trained model is saved to disk (joblib) after every
     train_and_evaluate() call, so a fresh boot can load a prior model
     instantly instead of always retraining from a cold start.
"""

import joblib
import numpy as np
from pathlib import Path
from sklearn.ensemble import IsolationForest
from sklearn.model_selection import train_test_split
from sklearn.metrics import precision_recall_curve, confusion_matrix

MODEL_VERSION = "1.1.0"
MODEL_PATH = Path(__file__).resolve().parent / "artifacts" / "risk_model.joblib"

FEATURES = [
    "amount_ratio",
    "user_velocity_1h",
    "device_share_count_1h",
    "receiver_concentration_1h",
    "geo_mismatch",
]

DEFAULT_GUARDRAILS = {
    "step_up_amount_inr": 15000,   # above this, never auto-ALLOW — at least step-up
    "hard_block_amount_inr": 50000,  # above this, always BLOCK_AND_REVIEW — model score irrelevant
}


def _amount_dev_feature(ratio):
    """Fraud risk is one-sided on amount: spending *less* than usual is not
    a risk signal, only spending unusually *more* is. Feed the ML layer the
    same one-sided view the rule layer uses, instead of the raw ratio."""
    return max(ratio - 1.0, 0.0)

# Cost assumptions, stated explicitly so the metrics are auditable, not black-box.
REVIEW_COST_INR = 45        # analyst time to clear one false-positive alert
AVG_FRAUD_LOSS_INR = 3200   # average confirmed-fraud amount if a true fraud is missed


def _rule_scores(row):
    velocity = min(row["user_velocity_1h"] / 8.0, 1.0)
    amount_dev = min(max(row["amount_ratio"] - 1.0, 0) / 6.0, 1.0)
    device_ring = min(row["device_share_count_1h"] / 6.0, 1.0)
    receiver_mule = min(row["receiver_concentration_1h"] / 10.0, 1.0)
    geo = float(row["geo_mismatch"])
    return {
        "velocity": round(velocity, 3),
        "amount_deviation": round(amount_dev, 3),
        "device_ring": round(device_ring, 3),
        "receiver_mule": round(receiver_mule, 3),
        "geo_mismatch": round(geo, 3),
    }


def _feature_matrix(rows):
    return np.array([
        [_amount_dev_feature(r["amount_ratio"]), r["user_velocity_1h"],
         r["device_share_count_1h"], r["receiver_concentration_1h"], r["geo_mismatch"]]
        for r in rows
    ], dtype=float)


# Named weights defining the linear fusion of rule heuristics and ML anomaly score.
# Sum of weights equals 1.0 (5 rule heuristics * 0.11 = 0.55 rule layer, 0.45 ML IsolationForest).
FUSION_WEIGHTS = {
    "velocity": 0.11,
    "amount_deviation": 0.11,
    "device_ring": 0.11,
    "receiver_mule": 0.11,
    "geo_mismatch": 0.11,
    "ml_anomaly": 0.45,
}


def calculate_confidence(rules: dict, if_norm: float) -> str:
    """
    Computes deterministic decision confidence (HIGH / MEDIUM / LOW).
    Rationale:
      - Disagreement is measured by comparing the consensus between rule heuristics (mean of rules)
        and the unsupervised ML anomaly score (if_norm), combined with the standard deviation across
        all individual signals.
      - When rule indicators and ML anomaly score align (disagreement < 0.22), confidence is HIGH.
      - When there is moderate divergence (e.g. an isolated single-signal spike, 0.22 <= d < 0.40),
        confidence is MEDIUM.
      - When rule signals strongly contradict the ML anomaly score (d >= 0.40), confidence is LOW.
    """
    rule_vals = [float(v) for v in rules.values()]
    rule_mean = float(np.mean(rule_vals))
    all_vals = rule_vals + [float(if_norm)]

    pillar_delta = abs(rule_mean - float(if_norm))
    signal_std = float(np.std(all_vals))

    disagreement = 0.6 * pillar_delta + 0.4 * (signal_std * 2.0)
    if disagreement < 0.22:
        return "HIGH"
    elif disagreement < 0.40:
        return "MEDIUM"
    else:
        return "LOW"


class RiskModel:
    def __init__(self):
        self.iforest = None
        self.threshold = 62.0  # risk score (0-100) above which a txn is flagged
        self.if_score_min = 0.0
        self.if_score_range = 1.0
        self.metrics = None
        self.trained_at = None
        self.version = MODEL_VERSION
        self.guardrails = dict(DEFAULT_GUARDRAILS)

    # ---------------------------------------------------------------
    def fuse(self, row, if_anomaly_raw=None):
        rules = _rule_scores(row)
        rule_component = np.mean(list(rules.values()))

        if if_anomaly_raw is None and self.iforest is not None:
            X = _feature_matrix([row])
            if_anomaly_raw = -self.iforest.score_samples(X)[0]  # higher = more anomalous

        if if_anomaly_raw is not None and self.if_score_range > 0:
            if_norm = (if_anomaly_raw - self.if_score_min) / self.if_score_range
            if_norm = float(np.clip(if_norm, 0, 1))
        else:
            if_norm = rule_component

        # Compute risk using named FUSION_WEIGHTS (0.11*5 = 0.55 rule layer, 0.45 ml anomaly)
        risk = 100 * (0.55 * rule_component + 0.45 * if_norm)
        risk = float(np.clip(risk, 0, 100))

        confidence = calculate_confidence(rules, if_norm)
        top_signal = max(rules, key=rules.get)
        decision = "BLOCK_AND_REVIEW" if risk >= self.threshold else (
            "STEP_UP_VERIFY" if risk >= self.threshold * 0.6 else "ALLOW"
        )

        # ---- bounded authority guardrail: amount-based, model-independent ----
        guardrail_applied = None
        amount = row.get("amount", 0)
        if amount >= self.guardrails["hard_block_amount_inr"] and decision != "BLOCK_AND_REVIEW":
            decision = "BLOCK_AND_REVIEW"
            guardrail_applied = "hard_block_amount_inr"
        elif amount >= self.guardrails["step_up_amount_inr"] and decision == "ALLOW":
            decision = "STEP_UP_VERIFY"
            guardrail_applied = "step_up_amount_inr"

        return {
            "risk_score": round(risk, 1),
            "decision": decision,
            "signals": rules,
            "top_signal": top_signal,
            "ml_anomaly_component": round(if_norm, 3),
            "guardrail_applied": guardrail_applied,
            "confidence": confidence,
        }

    # ---------------------------------------------------------------
    def train_and_evaluate(self, rows):
        train_rows, temp_rows = train_test_split(rows, test_size=0.4, random_state=7,
                                                   stratify=[r["label"] for r in rows])
        val_rows, test_rows = train_test_split(temp_rows, test_size=0.5, random_state=7,
                                                stratify=[r["label"] for r in temp_rows])

        X_train = _feature_matrix(train_rows)
        self.iforest = IsolationForest(
            n_estimators=200, contamination=0.1, random_state=7
        ).fit(X_train)

        # Use robust percentiles rather than min/max so a single extreme
        # training outlier can't compress the whole normal range.
        raw_train_scores = -self.iforest.score_samples(X_train)
        p_lo, p_hi = np.percentile(raw_train_scores, [2, 90])
        self.if_score_min = float(p_lo)
        self.if_score_range = float(p_hi - p_lo) or 1.0

        def score_rows(split_rows):
            X = _feature_matrix(split_rows)
            raw = -self.iforest.score_samples(X)
            return [self.fuse(r, if_anomaly_raw=raw[i])["risk_score"] for i, r in enumerate(split_rows)]

        val_scores = np.array(score_rows(val_rows))
        val_labels = np.array([r["label"] for r in val_rows])

        precisions, recalls, thresholds = precision_recall_curve(val_labels, val_scores)
        f1s = np.where((precisions + recalls) > 0, 2 * precisions * recalls / (precisions + recalls + 1e-9), 0)
        best_idx = int(np.argmax(f1s[:-1])) if len(thresholds) else 0
        self.threshold = float(thresholds[best_idx]) if len(thresholds) else 62.0

        step = max(1, len(precisions) // 50)
        pr_curve = []
        for i in range(0, len(precisions), step):
            t_val = float(thresholds[i]) if i < len(thresholds) else float(self.threshold)
            pr_curve.append({
                "threshold": round(t_val, 1),
                "precision": round(float(precisions[i]), 3),
                "recall": round(float(recalls[i]), 3)
            })

        test_scores = np.array(score_rows(test_rows))
        test_labels = np.array([r["label"] for r in test_rows])
        test_preds = (test_scores >= self.threshold).astype(int)

        tn, fp, fn, tp = confusion_matrix(test_labels, test_preds, labels=[0, 1]).ravel()
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
        fpr = fp / (fp + tn) if (fp + tn) else 0.0

        cost_with_model = fp * REVIEW_COST_INR + fn * AVG_FRAUD_LOSS_INR
        cost_no_detection = (tp + fn) * AVG_FRAUD_LOSS_INR
        cost_flag_all = len(test_labels) * REVIEW_COST_INR
        savings_vs_no_detection = cost_no_detection - cost_with_model

        self.test_scores = test_scores
        self.test_labels = test_labels

        self.metrics = {
            "test_set_size": int(len(test_labels)),
            "test_fraud_count": int(test_labels.sum()),
            "threshold_used": round(self.threshold, 1),
            "precision": round(precision, 3),
            "recall": round(recall, 3),
            "f1": round(f1, 3),
            "false_positive_rate": round(fpr, 4),
            "confusion_matrix": {"tp": int(tp), "fp": int(fp), "fn": int(fn), "tn": int(tn)},
            "cost_model": {
                "review_cost_inr": REVIEW_COST_INR,
                "avg_fraud_loss_inr": AVG_FRAUD_LOSS_INR,
                "cost_with_model_inr": int(cost_with_model),
                "cost_no_detection_inr": int(cost_no_detection),
                "cost_flag_everything_inr": int(cost_flag_all),
                "estimated_savings_inr": int(savings_vs_no_detection),
            },
            "train_size": len(train_rows),
            "val_size": len(val_rows),
            "pr_curve": pr_curve
        }
        self.save()
        return self.metrics

    # ---------------------------------------------------------------
    def evaluate_at_threshold(self, threshold: float):
        """Recomputes evaluation metrics on the untouched test split for any arbitrary threshold."""
        if not hasattr(self, "test_scores") or self.test_scores is None or self.test_labels is None:
            return None
        test_preds = (self.test_scores >= threshold).astype(int)
        tn, fp, fn, tp = confusion_matrix(self.test_labels, test_preds, labels=[0, 1]).ravel()
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
        fpr = fp / (fp + tn) if (fp + tn) else 0.0

        cost_with_model = fp * REVIEW_COST_INR + fn * AVG_FRAUD_LOSS_INR
        cost_no_detection = (tp + fn) * AVG_FRAUD_LOSS_INR
        cost_flag_all = len(self.test_labels) * REVIEW_COST_INR
        savings_vs_no_detection = cost_no_detection - cost_with_model

        return {
            "threshold": round(float(threshold), 1),
            "precision": round(precision, 3),
            "recall": round(recall, 3),
            "f1": round(f1, 3),
            "false_positive_rate": round(fpr, 4),
            "confusion_matrix": {"tp": int(tp), "fp": int(fp), "fn": int(fn), "tn": int(tn)},
            "cost_model": {
                "review_cost_inr": REVIEW_COST_INR,
                "avg_fraud_loss_inr": AVG_FRAUD_LOSS_INR,
                "cost_with_model_inr": int(cost_with_model),
                "cost_no_detection_inr": int(cost_no_detection),
                "cost_flag_everything_inr": int(cost_flag_all),
                "estimated_savings_inr": int(savings_vs_no_detection),
            },
            "test_set_size": int(len(self.test_labels)),
            "official_threshold": round(self.threshold, 1),
        }

    # ---------------------------------------------------------------
    def save(self):
        MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({
            "iforest": self.iforest,
            "threshold": self.threshold,
            "if_score_min": self.if_score_min,
            "if_score_range": self.if_score_range,
            "metrics": self.metrics,
            "version": self.version,
            "guardrails": self.guardrails,
            "test_scores": getattr(self, "test_scores", None),
            "test_labels": getattr(self, "test_labels", None),
        }, MODEL_PATH)

    def load(self):
        """Returns True if a saved model was found and loaded."""
        if not MODEL_PATH.exists():
            return False
        try:
            state = joblib.load(MODEL_PATH)
            if state.get("version") != self.version:
                return False  # schema changed since this artifact was saved — retrain instead
            self.iforest = state["iforest"]
            self.threshold = state["threshold"]
            self.if_score_min = state["if_score_min"]
            self.if_score_range = state["if_score_range"]
            self.metrics = state["metrics"]
            self.guardrails = state.get("guardrails", dict(DEFAULT_GUARDRAILS))
            self.test_scores = state.get("test_scores")
            self.test_labels = state.get("test_labels")
            return True
        except Exception:
            return False
