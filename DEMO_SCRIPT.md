# RISKYN AI — Complete Final Presentation Demo Script 🛰️

> **Target Audience**: Razorpay Buildathon Judges & Technical Reviewers  
> **Track**: Track 02 — AI Risk Manager (Defense-Only & Explainable)  
> **Demo Duration**: 5–7 Minutes (Includes a 3-Minute Rapid Pitch option)  
> **Live URL**: `http://localhost:8000` (or `http://127.0.0.1:8000`)  
> **Core Motto**: *"Catch the fraud. Show your work. Never touch the money."*

---

## ⚡ Executive Summary: The 3-Minute Rapid Pitch
*(Use this if the panel gives you only 3 minutes or asks for the bottom line first)*

1. **The Hook (30s)**:  
   *"Judges, meet **RISKYN AI** — a strictly defense-only AI risk manager engineered for real-time P2P payments. In financial risk, autonomous AI that moves or freezes money on its own is an existential compliance liability. RISKYN solves this with **Bounded AI Authority**: it scores every transaction in under 1 millisecond, explains the exact mathematical drivers in plain English, detects coordinated mule rings on a live radar, and proves its metrics on data it has never seen during training — without ever moving a single rupee on its own."*

2. **The Live Flow (90s)**:  
   - Launch console (`/console`) → Start Live Feed.
   - Click a flagged red transaction (`BLOCK_AND_REVIEW`). Show the **Inspect Arithmetic** button proving the 5 fused rule signals + Isolation Forest anomaly score.
   - Jump to **Abuse Radar** (`/console#radar`). Highlight the rotating radar sweep detecting mule clusters and shared device rings with <3ms topological layout.
   - Jump to **Model Metrics** (`/console#metrics`). Highlight the **60/20/20 train/val/test split** and the automated 4-point **Metric Integrity Audit** with green checkmarks.

3. **The Close (60s)**:  
   - Jump to **Policy Gate** (`/console#policy`). Prove hard limits (e.g. ₹50,000 hard block) override ML scores.
   - Jump to **Evidence Responder** (`/console#evidence`). Generate an auditable, read-only chargeback dispute dossier.
   - *"RISKYN bridges the gap between statistical anomaly detection and regulatory compliance: transparent, reproducible, and strictly defense-only."*

---

## 🎬 Complete 7-Minute Master Demo Walkthrough

```
Timeline Overview:
0:00 - 0:45 | Opening Hook & Philosophy (Landing Page)
0:45 - 1:45 | Live Transaction Stream & Sub-Millisecond Scoring
1:45 - 2:45 | Explainable AI & Linear Fusion Arithmetic Debugger
2:45 - 3:50 | Abuse Radar & Coordinated Mule Ring Intelligence
3:50 - 4:45 | Honest Evaluation, PR Curve & Cost-Benefit Simulator
4:45 - 5:30 | Policy Gate & Enforced Bounded Authority Guardrails
5:30 - 6:15 | Evidence Responder & Decision Replay Verification
6:15 - 6:45 | Grounded AI Investigator & The Grand Finale
```

---

### 📍 Step 0: The Opening Hook & Philosophy (45 seconds)

#### 🖥️ What to show:
- Have **http://localhost:8000** open on screen (Landing Page).
- Hover over the stat strip: **93.2% Precision**, **91.6% Recall**, **2.2% FPR**, and **₹0 Funds AI Can Move**.
- Scroll smoothly down to the **"Bounded AI Authority, Not Autonomous AI"** section.

#### 🎙️ What to say:
> *"Good afternoon, judges. When payment systems adopt AI, they usually make one of two catastrophic mistakes: either they deploy an unexplainable black-box neural net that hallucinates false alarms, or they grant autonomous fund-movement permissions to an agent that risks locking legitimate customer accounts.*
>
> *We built **RISKYN AI** to answer Track 02 with a fundamentally disciplined approach: **Strictly Defense-Only AI**. RISKYN scores, explains, and documents — it never authorizes, reverses, or moves funds on its own. Every decision band has an explicit mathematical ceiling.*
>
> *Notice our headline metric: **₹0 funds the AI is permitted to touch**. Let’s jump directly into the live engine."*

#### 🖱️ Action:
Click the high-contrast button: **"Launch Live Console →"**.

---

### 📍 Step 1: Live Transaction Feed & Sub-Millisecond Scoring (60 seconds)

#### 🖥️ What to show:
- Console view opens at `/console` with the Live Feed active.
- Point to the top bar: Status badges indicate `feed live`, `simulation mode`, and `AI Explanations`.
- Click **"Start Live Feed"** in the top right.
- Watch simulated transactions stream into the table in real time with smooth row animations.

#### 🎙️ What to say:
> *"Here in the live console, simulated P2P transactions stream across a WebSocket connection. Every single transaction is evaluated and scored in **under 1 millisecond** using local, zero-latency inference.*
>
> *Each record displays the sender, receiver, amount in Rupees, timestamp, and a calculated 0–100 risk score with color-coded badges:*
> - *Green for **ALLOW** (Risk < 37)*
> - *Amber for **STEP_UP_VERIFY** (Risk 37–61)*
> - *Crimson for **BLOCK_AND_REVIEW** (Risk ≥ 62)*
>
> *Let me click on one of these flagged high-risk transactions."*

#### 🖱️ Action:
Click any row with a red **BLOCK_AND_REVIEW** badge.

---

### 📍 Step 2: Signal Breakdown & Mathematical Explainability (60 seconds)

#### 🖥️ What to show:
- The right panel slides open showing **Signal Breakdown**, **Decision Fingerprint**, and **Reasoning Trace**.
- Click the **"Inspect Arithmetic"** button under the signal breakdown.
- Click the **"What-If"** button.

#### 🎙️ What to say:
> *"Look at the right sidebar. Rather than outputting a mystic score, RISKYN breaks the transaction down into **five interpretable risk signals**:*
> 1. ***User Velocity**: Has this sender burst 5+ transactions in the last hour?*
> 2. ***Amount Deviation**: Is this abnormally higher than their historical baseline?*
> 3. ***Device Ring**: Is this hardware fingerprint shared across multiple distinct senders?*
> 4. ***Receiver Concentration**: Is one counterparty pooling funds from dozens of accounts?*
> 5. ***Geo Mismatch**: Did this transfer originate from an anomalous IP location?*
>
> *Notice this 12-character hex hash: the **Decision Fingerprint**. This is a cryptographic SHA-256 digest of the exact feature vector, model version, and policy state at that millisecond. It guarantees 100% auditability for regulatory compliance.*
>
> *When I click **'Inspect Arithmetic'**, you see the linear fusion debugger: each signal multiplied by its exact weight, summed to the final score. No hidden layers. No mystery.*
>
> *And with **'What-If'**, counterfactual analysis tells the compliance analyst: 'If this device had been dedicated, the score would drop from 74 to 38, changing the decision to ALLOW.' This pinpoints the exact driver of friction."*

---

### 📍 Step 3: Abuse Radar & Coordinated Mule Rings (65 seconds)

#### 🖥️ What to show:
- Click **"Abuse Radar"** in the left sidebar navigation (`data-view="radar"`).
- Show the tactical radar console with rotating sweep beam, concentric risk rings, and energy pulses along active transaction links.
- Click **"⚡ Detect Rings"** button.
- Click any amber device node (`dev_xxxx`) or red receiver node (`rcv_xxxx`).
- Point out the **Transaction Volume Velocity** chart in the Entity Inspector on the right.

#### 🎙️ What to say:
> *"Fraudsters rarely act alone. Looking at single transactions one-by-one is how mule networks slip past traditional rules. This is **Abuse Radar**.*
>
> *Our graph engine performs real-time connected-component clustering. Notice the distinct tactical geometry:*
> - *Senders are green circular blips.*
> - *Shared hardware devices are amber chips marked with a **'D'**.*
> - *Concentrated mule cash-out receivers are diamonds marked with an **'R'**.*
>
> *Our topological clustering algorithm positions connected rings into angular sectors in **under 3 milliseconds**, eliminating visual clutter.*
>
> *Look at this cluster: `RING-A`. Four distinct user accounts from different locations are funneling money through a single shared device into one receiver. When I click **'Focus Incident Intelligence'**, RISKYN synthesizes an incident dossier with total monetary exposure, an evidence balance sheet, and burst velocity vs baseline.*
>
> *And look at the **Transaction Volume Velocity** chart at the bottom right — a smooth cubic spline curve showing the temporal burst cadence of the ring in Rupees."*

---

### 📍 Step 4: Model Metrics & Evaluation Integrity (55 seconds)

#### 🖥️ What to show:
- Click **"Model Metrics"** in the sidebar.
- Point to the 4 KPI cards: **Precision**, **Recall**, **F1 Score**, **False Positive Rate**.
- Point to the **Precision-Recall Curve** and **Confusion Matrix**.
- Drag the **Decision Risk Threshold** slider (e.g., from 62 down to 45).
- Scroll to the bottom panel: **"Metric Integrity Audit"**.

#### 🎙️ What to say:
> *"In machine learning demos, anyone can claim 99% accuracy by evaluating on the training data. RISKYN adheres strictly to scientific evaluation integrity.*
>
> *Our dataset is partitioned with a strict **60/20/20 train/validation/test split**:*
> - *60% trains our scikit-learn Isolation Forest anomaly detector.*
> - *20% validation tunes the optimal decision threshold by maximizing F1.*
> - *20% held-out test data is **strictly untouched**. The 93.2% precision and 91.6% recall you see here were computed exclusively on data the model had never seen.*
>
> *Watch what happens when I drag the **Threshold Simulator**: as I lower the threshold to catch more fraud, recall climbs, but review costs rise. The interactive cost table recomputes expected net savings in real time based on ₹45 analyst review cost vs ₹3,200 fraud loss.*
>
> *Best of all, scroll to the **Metric Integrity Audit** at the bottom: four automated code assertions that run at boot time, validating sample partition sums, zero test leakage, and version tracking. All four show green checks."*

#### 🔑 Key Judge Punchline:
> *"We don't ask judges to take our metrics on faith. The integrity audit is verified directly by runtime unit tests."*

---

### 📍 Step 5: Policy Gate & Enforced Bounded Authority (45 seconds)

#### 🖥️ What to show:
- Click **"Policy Gate"** in the sidebar.
- Point to the three decision bands: ALLOW, STEP_UP_VERIFY, BLOCK_AND_REVIEW.
- Show the **Amount Guardrails** and **Hard Limits** list.

#### 🎙️ What to say:
> *"This is the heart of our compliance philosophy: the **Policy Gate**.*
>
> *The AI’s authority is strictly bounded by code:*
> - *The AI can recommend approval on low scores.*
> - *The AI can trigger step-up multi-factor verification on medium scores.*
> - *The AI can flag and hold on high scores — but **it cannot unilaterally seize or cancel**.*
>
> *Even more importantly: look at our **Hard Guardrails**. Regardless of what a machine learning model scores, any transaction over ₹15,000 mandates step-up verification. Any transaction over ₹50,000 is hard-blocked for human sign-off. A statistical model can never be manipulated by an adversarial prompt or feature attack to bypass these merchant guardrails."*

---

### 📍 Step 6: Evidence Responder & Decision Replay (45 seconds)

#### 🖥️ What to show:
- Click **"Evidence Responder"** in the sidebar.
- Select a transaction from the dropdown and click **"Generate Evidence Packet"**.
- Point to the structured packet: Sender History, Supporting Merchant Evidence, Risk Disclosures, Recommended Action, and Disclaimer.
- Click **"Verify Replay"**.

#### 🎙️ What to say:
> *"When a disputed chargeback lands 45 days after a payment, merchants usually lose because evidence is scattered across log files. The **Evidence Responder** instantly generates a structured, read-only dispute dossier.*
>
> *It pulls sender tenure, prior clean transaction rates, device telemetry, and full risk factor disclosures into a standardized format ready for bank submission.*
>
> *And notice this button: **'Verify Replay'**. It re-executes the historical feature snapshot against the model version and verifies a bitwise-identical risk score and fingerprint. If compliance audits your system two years later, you can prove why every decision was made."*

---

### 📍 Step 7: Grounded AI Investigator & The Grand Finale (45 seconds)

#### 🖥️ What to show:
- Click **"Investigator"** in the sidebar.
- Type in the input: `Why was transaction [ID] flagged?` or click Send on a question like `What is the current model threshold?`.
- Expand the **"Facts Used"** dropdown showing the raw SQLite query JSON.
- Click the **🌙/☀️ Theme Toggle** to show the polished light mode.

#### 🎙️ What to say:
> *"Finally, we provide the **Grounded AI Investigator** — an AI assistant built for fraud analysts. Unlike generic ChatGPT interfaces, this investigator is **strictly grounded in SQLite database facts**.*
>
> *When an analyst asks 'Why was this transaction flagged?', it extracts the exact facts and decision drivers. Expand 'Facts Used' and you see the verifiable data payload. It cannot hallucinate numbers.*
>
> *And if external LLM APIs like Gemini or Groq are offline, RISKYN automatically fails over to deterministic templated explanations with zero disruption.*
>
> *To summarize:*
> - *Real-time P2P fraud scoring in **< 1ms**.*
> - *Live network intelligence on **Abuse Radar**.*
> - *Honest metrics on **untouched held-out test data**.*
> - *Verifiable **linear fusion and decision replay**.*
> - *And **Bounded Authority** that keeps humans in control.*
>
> *Thank you, judges! We are excited to take your questions."*

---

## 🛡️ Judge Q&A Defense Strategy (The Hard Questions)

### Q1: "Is this just an LLM wrapper making arbitrary guesses?"
> **Answer**: *"Absolutely not. 100% of the risk scoring is performed locally in Python using a hybrid ensemble: 5 deterministic rule signals fused with an unsupervised scikit-learn Isolation Forest anomaly model. The scoring executes in under 1 millisecond with zero external API calls. The LLM is used strictly as a natural-language explainer for human analysts, completely grounded by structured database facts."*

### Q2: "Why not let the AI automatically freeze accounts and reverse transactions?"
> **Answer**: *"Because in payments, autonomous fund seizure creates catastrophic legal and customer experience liabilities. A false positive freezing a legitimate user’s rent payment destroys trust. By designing RISKYN as strictly defense-only with Bounded Authority, we empower human analysts with instant evidence while guaranteeing that no rupee moves without human sign-off."*

### Q3: "How do you guarantee your 93% precision isn't just overfitting?"
> **Answer**: *"We enforce a strict 60/20/20 train/validation/test split. The Isolation Forest model trains on the 60% split. The decision threshold is tuned exclusively on the 20% validation split. The reported metrics are calculated only once on the untouched 20% test set. Furthermore, our built-in Metric Integrity Audit executes automated runtime assertions to verify zero test-data leakage."*

### Q4: "What happens if Gemini, Claude, or Groq goes down?"
> **Answer**: *"RISKYN has zero hard dependencies on external cloud APIs. The entire scoring pipeline, abuse radar, and decision engine run locally. If all LLM providers are unreachable, our explainer seamlessly falls back to deterministic rule templates. The status pill in the top bar instantly updates to reflect fallback mode with zero downtime."*

### Q5: "How does the Abuse Radar handle high transaction volumes without lagging?"
> **Answer**: *"Our Abuse Radar leverages breadth-first search (BFS) topological sector clustering. Connected entities are clustered into angular sectors before rendering, settling the layout in under 3 milliseconds (18 physics steps). The canvas utilizes High-DPI Retina scaling and requestAnimationFrame hardware acceleration for smooth 60fps interaction."*

---

## 🗺️ Feature-to-Click Quick Reference

| Feature | Sidebar Tab | Key Action / Button |
| :--- | :--- | :--- |
| **Real-time Scoring** | Live Feed | Click `"Start Live Feed"`, click any flagged row |
| **Arithmetic Proof** | Live Feed | Click `"Inspect Arithmetic"` under Signal Breakdown |
| **Counterfactual What-If** | Live Feed | Click `"What-If"` button under Signal Breakdown |
| **Hard Guardrails Test** | Live Feed | Under "Test a Transaction", enter ₹60,000 → `"Score Transaction"` |
| **Network Mule Detection** | Abuse Radar | Click `"⚡ Detect Rings"`, click any node |
| **Incident Dossier** | Abuse Radar | Click `"Focus Incident Intelligence"` on right panel |
| **PR Curve & Metrics** | Model Metrics | View 4 metric cards, PR curve, and confusion matrix |
| **Cost Simulator** | Model Metrics | Drag "Decision Risk Threshold" slider or cost sliders |
| **Integrity Checks** | Model Metrics | Scroll down to "Metric Integrity Audit" (4 green checkmarks) |
| **Bounded Authority** | Policy Gate | Inspect ALLOW / STEP_UP / BLOCK bands & Hard Limits |
| **Chargeback Packet** | Evidence Responder | Select txn → `"Generate Evidence Packet"` |
| **Decision Replay** | Evidence Responder | Click `"Verify Replay"` for bitwise fingerprint check |
| **Grounded Q&A** | Investigator | Type query → `"Send"` → expand `"Facts Used"` |
| **Audit Trail** | Audit Log | View timestamped event table & event frequency chart |
| **Theme Customization** | Top Header | Click 🌙/☀️ toggle button |
