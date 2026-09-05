"""
data_gen.py — Synthetic P2P transaction generator.

Generates labeled transactions so the detector can be evaluated honestly on a
held-out test set. Labels are used ONLY for evaluation and threshold tuning —
the anomaly model itself is fit on data treated as unlabeled, the way a real
deployment would work against mostly-clean historical logs.

Fraud patterns modeled (each is a class of loss a real risk team fights):
  1. velocity_spike   — account suddenly fires many transactions in a burst
  2. amount_deviation — transaction far exceeds the sender's own baseline
  3. device_ring       — many distinct senders share one device (mule farm)
  4. receiver_mule     — many distinct senders funnel into one receiver fast
  5. geo_mismatch       — sending IP/geo suddenly differs from the norm
"""

import random
import uuid
from datetime import datetime, timezone, timedelta

random.seed(42)

N_USERS = 400
N_DEVICES = 420
N_RECEIVERS = 260

USERS = [f"usr_{i:04d}" for i in range(N_USERS)]
DEVICES = [f"dev_{i:04d}" for i in range(N_DEVICES)]
RECEIVERS = [f"rcv_{i:04d}" for i in range(N_RECEIVERS)]
GEOS = ["IN-MH", "IN-KA", "IN-DL", "IN-TN", "IN-WB", "IN-GJ", "IN-UP"]

# stable per-user baseline behaviour, mimics historical profile
USER_PROFILE = {
    u: {
        "avg_amount": round(random.uniform(300, 6000), 2),
        "home_geo": random.choice(GEOS),
        "home_device": random.choice(DEVICES),
    }
    for u in USERS
}


def _base_txn(ts, user, amount, device, receiver, geo):
    profile = USER_PROFILE[user]
    return {
        "id": str(uuid.uuid4())[:8],
        "timestamp": ts.isoformat(),
        "user_id": user,
        "receiver_id": receiver,
        "amount": round(amount, 2),
        "device_id": device,
        "geo": geo,
        "user_avg_amount": profile["avg_amount"],
        "amount_ratio": round(amount / max(profile["avg_amount"], 1), 3),
        "geo_mismatch": int(geo != profile["home_geo"]),
        "is_new_receiver": random.random() < 0.35,
    }


def generate_dataset(n_normal=3600, n_fraud=400, start=None):
    """Returns a list of transaction dicts, each carrying a hidden `label`
    (1 = fraud, 0 = normal) plus derived velocity/ring features computed in a
    second pass so they reflect the whole generated stream, not just one row.
    """
    # Strip tzinfo consistently to avoid offset-aware vs offset-naive type comparison mismatch errors
    start = start or (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=10))
    rows = []

    # ---- normal traffic ---------------------------------------------
    for _ in range(n_normal):
        user = random.choice(USERS)
        profile = USER_PROFILE[user]
        ts = start + timedelta(minutes=random.uniform(0, 10 * 24 * 60))
        amount = max(10, random.gauss(profile["avg_amount"], profile["avg_amount"] * 0.25))
        row = _base_txn(ts, user, amount, profile["home_device"], random.choice(RECEIVERS), profile["home_geo"])
        row["label"] = 0
        row["fraud_type"] = "none"
        rows.append(row)

    # ---- fraud pattern 1: velocity spike ------------------------------
    for _ in range(n_fraud // 5):
        user = random.choice(USERS)
        profile = USER_PROFILE[user]
        burst_start = start + timedelta(minutes=random.uniform(0, 10 * 24 * 60))
        for k in range(random.randint(5, 11)):
            ts = burst_start + timedelta(seconds=k * random.uniform(5, 40))
            amount = profile["avg_amount"] * random.uniform(1.5, 3.5)
            row = _base_txn(ts, user, amount, profile["home_device"], random.choice(RECEIVERS), profile["home_geo"])
            row["label"] = 1
            row["fraud_type"] = "velocity_spike"
            rows.append(row)

    # ---- fraud pattern 2: amount deviation ----------------------------
    for _ in range(n_fraud // 5):
        user = random.choice(USERS)
        profile = USER_PROFILE[user]
        ts = start + timedelta(minutes=random.uniform(0, 10 * 24 * 60))
        amount = profile["avg_amount"] * random.uniform(6, 15)
        row = _base_txn(ts, user, amount, profile["home_device"], random.choice(RECEIVERS), profile["home_geo"])
        row["label"] = 1
        row["fraud_type"] = "amount_deviation"
        rows.append(row)

    # ---- fraud pattern 3: device ring (mule farm) ---------------------
    for _ in range(n_fraud // 5 // 4):
        shared_device = f"dev_ring_{uuid.uuid4().hex[:5]}"
        ring_users = random.sample(USERS, k=random.randint(6, 10))
        window_start = start + timedelta(minutes=random.uniform(0, 10 * 24 * 60))
        for u in ring_users:
            profile = USER_PROFILE[u]
            ts = window_start + timedelta(minutes=random.uniform(0, 25))
            amount = profile["avg_amount"] * random.uniform(0.8, 2.0)
            row = _base_txn(ts, u, amount, shared_device, random.choice(RECEIVERS), profile["home_geo"])
            row["label"] = 1
            row["fraud_type"] = "device_ring"
            rows.append(row)

    # ---- fraud pattern 4: receiver mule (funnel) -----------------------
    for _ in range(n_fraud // 5 // 4):
        mule_receiver = f"rcv_mule_{uuid.uuid4().hex[:5]}"
        senders = random.sample(USERS, k=random.randint(8, 14))
        window_start = start + timedelta(minutes=random.uniform(0, 10 * 24 * 60))
        for u in senders:
            profile = USER_PROFILE[u]
            ts = window_start + timedelta(minutes=random.uniform(0, 40))
            amount = profile["avg_amount"] * random.uniform(0.5, 1.8)
            row = _base_txn(ts, u, amount, profile["home_device"], mule_receiver, profile["home_geo"])
            row["label"] = 1
            row["fraud_type"] = "receiver_mule"
            rows.append(row)

    # ---- fraud pattern 5: geo mismatch --------------------------------
    for _ in range(n_fraud // 5):
        user = random.choice(USERS)
        profile = USER_PROFILE[user]
        ts = start + timedelta(minutes=random.uniform(0, 10 * 24 * 60))
        odd_geo = random.choice([g for g in GEOS if g != profile["home_geo"]])
        amount = profile["avg_amount"] * random.uniform(1.2, 3.0)
        row = _base_txn(ts, user, amount, f"dev_new_{uuid.uuid4().hex[:5]}", random.choice(RECEIVERS), odd_geo)
        row["label"] = 1
        row["fraud_type"] = "geo_mismatch"
        rows.append(row)

    # ---- fraud pattern 6: structured smurfing (AML/KYC bypass) --------
    for _ in range(n_fraud // 10):
        smurf_receiver = f"rcv_smurf_{uuid.uuid4().hex[:5]}"
        senders = random.sample(USERS, k=random.randint(6, 12))
        window_start = start + timedelta(minutes=random.uniform(0, 10 * 24 * 60))
        for u in senders:
            profile = USER_PROFILE[u]
            ts = window_start + timedelta(minutes=random.uniform(0, 30))
            amount = random.choice([9900.0, 9950.0, 9990.0])
            row = _base_txn(ts, u, amount, profile["home_device"], smurf_receiver, profile["home_geo"])
            row["label"] = 1
            row["fraud_type"] = "structured_smurfing"
            rows.append(row)

    # ---- fraud pattern 7: carding verification micro-funnels ---------
    for _ in range(n_fraud // 10):
        shared_device = f"dev_carding_{uuid.uuid4().hex[:5]}"
        mule_receiver = f"rcv_funnel_{uuid.uuid4().hex[:5]}"
        senders = random.sample(USERS, k=random.randint(5, 10))
        window_start = start + timedelta(minutes=random.uniform(0, 10 * 24 * 60))
        for u in senders:
            profile = USER_PROFILE[u]
            ts = window_start + timedelta(seconds=random.uniform(0, 90))
            amount = round(random.uniform(50.0, 150.0), 2)
            row = _base_txn(ts, u, amount, shared_device, mule_receiver, profile["home_geo"])
            row["label"] = 1
            row["fraud_type"] = "card_verification"
            rows.append(row)

    rows.sort(key=lambda r: r["timestamp"])
    _annotate_velocity_and_ring_features(rows)
    random.shuffle(rows)
    return rows


def _annotate_velocity_and_ring_features(rows):
    """Second pass: compute rolling velocity / device-share / receiver-
    concentration features using only prior data in time order, the way a
    real streaming feature store would."""
    from collections import deque, defaultdict

    user_hist = defaultdict(deque)
    device_hist = defaultdict(deque)
    receiver_hist = defaultdict(deque)

    window_min = 60

    for row in rows:
        ts = datetime.fromisoformat(row["timestamp"])
        u, d, r = row["user_id"], row["device_id"], row["receiver_id"]

        # user_hist: deque of timestamps for this user (velocity)
        dq = user_hist[u]
        while dq and (ts - dq[0]).total_seconds() > window_min * 60:
            dq.popleft()
        row["user_velocity_1h"] = len(dq)
        dq.append(ts)

        # device_hist / receiver_hist: deque of (timestamp, user) pairs,
        # counted as distinct users seen in the trailing window
        dq_d = device_hist[d]
        while dq_d and (ts - dq_d[0][0]).total_seconds() > window_min * 60:
            dq_d.popleft()
        row["device_share_count_1h"] = len({x[1] for x in dq_d})
        dq_d.append((ts, u))

        dq_r = receiver_hist[r]
        while dq_r and (ts - dq_r[0][0]).total_seconds() > window_min * 60:
            dq_r.popleft()
        row["receiver_concentration_1h"] = len({x[1] for x in dq_r})
        dq_r.append((ts, u))
