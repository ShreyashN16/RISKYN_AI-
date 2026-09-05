import pytest
import sqlite3
from contextlib import closing
from pathlib import Path
from main import app, abuse_network, get_db_connection

def test_abuse_network_clustering():
    # Setup test transactions with known shared device and receiver
    with closing(get_db_connection()) as conn:
        conn.execute("DELETE FROM transactions")
        
        # Ring 1: Shared device d_mule across 3 users (requires >= 2 senders)
        for i, user in enumerate(["user_a", "user_b", "user_c"]):
            conn.execute(
                """INSERT INTO transactions (id, ts, user_id, receiver_id, amount, device_id, geo, risk_score, decision, top_signal, signals, fraud_type)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (f"t_dev_{i}", f"2026-08-31T10:0{i}:00", user, f"rcv_{i}", 1500.0, "d_mule", "IN-MH", 45.0, "BLOCK_AND_REVIEW", "device_ring", "{}", "device_ring")
            )
            
        # Ring 2: Concentrated receiver r_mule collecting from 3 users (requires >= 3 senders)
        for i, user in enumerate(["user_x", "user_y", "user_z"]):
            conn.execute(
                """INSERT INTO transactions (id, ts, user_id, receiver_id, amount, device_id, geo, risk_score, decision, top_signal, signals, fraud_type)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (f"t_rcv_{i}", f"2026-08-31T11:0{i}:00", user, "r_mule", 2000.0, f"dev_clean_{i}", "IN-DL", 50.0, "BLOCK_AND_REVIEW", "receiver_mule", "{}", "receiver_mule")
            )
        conn.commit()

    graph = abuse_network(limit=50)
    
    assert "nodes" in graph
    assert "edges" in graph
    assert "clusters" in graph
    
    clusters = graph["clusters"]
    assert len(clusters) == 2
    
    # Identify device ring cluster
    dev_cluster = next(c for c in clusters if c["shared_entity_id"] == "d_mule")
    assert dev_cluster["shared_entity_type"] == "device"
    assert dev_cluster["sender_count"] == 3
    assert set(dev_cluster["member_node_ids"]) == {"d_mule", "user_a", "user_b", "user_c"}
    assert dev_cluster["total_volume_inr"] == 4500.0
    assert dev_cluster["window_minutes"] >= 0.0
    
    # Identify receiver mule cluster
    rcv_cluster = next(c for c in clusters if c["shared_entity_id"] == "r_mule")
    assert rcv_cluster["shared_entity_type"] == "receiver"
    assert rcv_cluster["sender_count"] == 3
    assert set(rcv_cluster["member_node_ids"]) == {"r_mule", "user_x", "user_y", "user_z"}
    assert rcv_cluster["total_volume_inr"] == 6000.0
    assert rcv_cluster["window_minutes"] >= 0.0
