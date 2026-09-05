const API = "";
function sanitize(str) {
  if (str == null) return '';
  const el = document.createElement('div');
  el.textContent = String(str);
  return el.innerHTML;
}
let ws = null;
let feedRunning = false;
const stats = { scored:0, blocked:0, stepup:0, allowed:0 };
const recentTxns = []; 
let sharedFilterNodeId = null; 

let sortField = "time";
let sortOrder = "desc";

let liveRiskChartInstance = null;
const liveRiskBins = [0, 0, 0, 0, 0];
let prCurveChartInstance = null;
let cmBarChartInstance = null;
let nodeChartInstance = null;
let auditChartInstance = null;

// Zoom & Pan State for Abuse Radar
let zoom = 1.0;
let panOffset = { x: 0, y: 0 };
let isDragging = false;
let startDrag = { x: 0, y: 0 };
let lastRadarData = null;

// Force-directed layout physics configuration
const kRepulsion = 2600; // Repulsive force strength between nodes
const kAttraction = 0.05; // Spring attraction strength for edges
const kGravity = 0.02; // Centering force pull
const damping = 0.83; // Velocity damping per tick

let nodesList = [];
let edgesList = [];
let nodesMap = {}; // Maps node.id -> physical node details (x, y, vx, vy)
let draggedNode = null;
let animationFrameId = null;

// Group 6 Abuse Radar & Incident Intelligence State
let showFullNetwork = false;
let activeIncidentId = null;
let expandedHopNodes = new Set();
let radarMinRisk = 0;
let radarEntityType = "ALL";
let incidentActivityChartInstance = null;
let hoveredNode = null;
let selectedNodeId = null;
let mouseDownPos = { x: 0, y: 0 };
let currentSideTab = "incident";

let radarSweepAngle = 0;
let radarPulseTime = 0;

function getThemeColors() {
  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  return {
    isLight,
    textColor: isLight ? "#475569" : "#94A3B8",
    mutedColor: isLight ? "#64748B" : "#64748B",
    gridColor: isLight ? "rgba(0, 0, 0, 0.07)" : "rgba(255, 255, 255, 0.07)",
    amber: isLight ? "#D97706" : "#FFB454",
    amberGlow: isLight ? "rgba(217, 119, 6, 0.22)" : "rgba(255, 180, 84, 0.22)",
    safe: isLight ? "#059669" : "#3DDC97",
    safeGlow: isLight ? "rgba(5, 150, 105, 0.2)" : "rgba(61, 220, 151, 0.2)",
    caution: isLight ? "#D97706" : "#FFD166",
    danger: isLight ? "#E11D48" : "#FF4D6D",
    dangerGlow: isLight ? "rgba(225, 29, 72, 0.22)" : "rgba(255, 77, 109, 0.25)",
    cardBg: isLight ? "#FFFFFF" : "#0A101C",
    cardBorder: isLight ? "#E2E8F0" : "#1E2B47"
  };
}

// ---------------- theme ----------------
const themeToggle = document.getElementById("themeToggle");
function applyTheme(t){
  document.documentElement.setAttribute("data-theme", t);
  themeToggle.textContent = t === "light" ? "☀️" : "🌙";
  localStorage.setItem("riskyn_theme", t);
  
  if (document.getElementById("view-metrics")?.classList.contains("active")) {
    loadMetrics();
  } else if (document.getElementById("view-radar")?.classList.contains("active")) {
    applyRadarFiltersAndRender();
    if (selectedNodeId) loadNodeDetails(selectedNodeId);
  } else if (document.getElementById("view-feed")?.classList.contains("active")) {
    if (liveRiskChartInstance) {
      liveRiskChartInstance.destroy();
      liveRiskChartInstance = null;
      initLiveRiskChart();
    }
  } else if (document.getElementById("view-audit")?.classList.contains("active")) {
    loadAudit();
  }
}
applyTheme(localStorage.getItem("riskyn_theme") || "dark");
themeToggle.addEventListener("click", ()=>{
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "light" ? "dark" : "light");
});

// Mobile hamburger menu toggle
const hamburgerBtn = document.getElementById('hamburgerBtn');
if (hamburgerBtn) {
  hamburgerBtn.addEventListener('click', () => {
    const sidenav = document.getElementById('sidenav');
    if (sidenav) sidenav.classList.toggle('open');
  });
  // Close sidebar when a nav item is clicked on mobile
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const sidenav = document.getElementById('sidenav');
      if (sidenav && window.innerWidth <= 900) sidenav.classList.remove('open');
    });
  });
}

// ---------------- nav ----------------
document.querySelectorAll(".nav-item").forEach(item=>{
  item.addEventListener("click", ()=>{
    document.querySelectorAll(".nav-item").forEach(i=>i.classList.remove("active"));
    document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
    item.classList.add("active");
    const targetView = item.dataset.view;
    document.getElementById("view-"+targetView).classList.add("active");
    if(targetView === "metrics") loadMetrics().catch(err => console.warn('Metrics load error:', err));
    if(targetView === "radar") loadRadar().catch(err => console.warn('Radar load error:', err));
    if(targetView === "audit") loadAudit().catch(err => console.warn('Audit load error:', err));
    if(targetView === "policy") loadPolicy().catch(err => console.warn('Policy load error:', err));
    if(targetView === "settings") loadSettingsStatus();
    
    if (targetView !== "radar" && animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    if (targetView === "feed") {
      renderFeedTable();
    }
  });
});

// Keyboard accessibility for nav items
document.querySelectorAll(".nav-item").forEach(item => {
  item.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      item.click();
    }
  });
});

// ---------------- decision color helpers ----------------
function riskColor(score){
  if(score >= 62) return "var(--danger)";
  if(score >= 37) return "var(--caution)";
  return "var(--safe)";
}
function fmtTime(iso){
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', {hour12:false});
}
function fmtAmt(n){
  return "₹" + Number(n).toLocaleString('en-IN', {maximumFractionDigits:0});
}

// ---------------- fetch helper with panel error display ----------------
async function safeFetch(url, options = {}) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return res;
  } catch (err) {
    console.error("Fetch failure:", err);
    const activeView = document.querySelector(".view.active");
    if (activeView) {
      let errDiv = activeView.querySelector(".panel-error");
      if (!errDiv) {
        errDiv = document.createElement("div");
        errDiv.className = "panel-error";
        activeView.prepend(errDiv);
      }
      errDiv.textContent = `API error: Failed to fetch data from ${url}. Request failed.`;
      errDiv.style.display = "block";
      setTimeout(() => { errDiv.remove(); }, 6000);
    }
    throw err;
  }
}

// ---------------- live feed ----------------
document.getElementById("toggleFeedBtn").addEventListener("click", ()=>{
  if(feedRunning){ stopFeed(); } else { startFeed(); }
});

document.getElementById("wsReconnectBtn").addEventListener("click", () => {
  document.getElementById("wsReconnectBanner").style.display = "none";
  startFeed();
});

function startFeed(){
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/live`);
  ws.onopen = ()=>{
    feedRunning = true;
    document.getElementById("wsReconnectBanner").style.display = "none";
    document.getElementById("liveDot").className = "dot live";
    document.getElementById("liveLabel").textContent = "feed live";
    document.getElementById("toggleFeedBtn").textContent = "Stop Live Feed";
    document.getElementById("feedBody").innerHTML = "";
    initLiveRiskChart();
  };
  ws.onmessage = (evt)=>{
    const txn = JSON.parse(evt.data);
    addFeedRow(txn);
  };
  ws.onclose = ()=>{ resetFeedUI(); showWsReconnect(); };
  ws.onerror = ()=>{ resetFeedUI(); showWsReconnect(); };
}
function stopFeed(){ if(ws) ws.close(); resetFeedUI(); }
function resetFeedUI(){
  feedRunning = false;
  document.getElementById("liveDot").className = "dot";
  document.getElementById("liveLabel").textContent = "feed idle";
  document.getElementById("toggleFeedBtn").textContent = "Start Live Feed";
}
function showWsReconnect() {
  document.getElementById("wsReconnectBanner").style.display = "flex";
}

function initLiveRiskChart() {
  if (liveRiskChartInstance) return;
  const canvas = document.getElementById("liveRiskChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const colors = getThemeColors();
  
  liveRiskChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["0-20", "20-40", "40-60", "60-80", "80-100"],
      datasets: [{
        data: liveRiskBins,
        backgroundColor: colors.amberGlow,
        borderColor: colors.amber,
        borderWidth: 1.5,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: colors.cardBg,
          titleColor: colors.textColor,
          bodyColor: colors.amber,
          borderColor: colors.cardBorder,
          borderWidth: 1,
          padding: 8,
          displayColors: false
        }
      },
      scales: {
        x: { ticks: { color: colors.textColor, font: { family: "var(--mono)", size: 10 } }, grid: { display: false } },
        y: { ticks: { color: colors.textColor, font: { family: "var(--mono)", size: 10 }, stepSize: 1 }, grid: { color: colors.gridColor } }
      }
    }
  });
}

let chartUpdatePending = false;
function updateLiveRiskChart(score) {
  const bin = Math.min(4, Math.floor(score / 20));
  liveRiskBins[bin]++;
  if (!chartUpdatePending) {
    chartUpdatePending = true;
    setTimeout(() => {
      if (liveRiskChartInstance) {
        liveRiskChartInstance.data.datasets[0].data = liveRiskBins;
        liveRiskChartInstance.update();
      }
      chartUpdatePending = false;
    }, 500);
  }
}

let feedRenderPending = false;
function addFeedRow(txn){
  recentTxns.unshift(txn);
  if(recentTxns.length > 200) recentTxns.pop();

  stats.scored++;
  if(txn.decision === "BLOCK_AND_REVIEW") stats.blocked++;
  else if(txn.decision === "STEP_UP_VERIFY") stats.stepup++;
  else stats.allowed++;
  
  document.getElementById("statScored").textContent = stats.scored;
  document.getElementById("statBlocked").textContent = stats.blocked;
  document.getElementById("statStepup").textContent = stats.stepup;
  document.getElementById("statAllowed").textContent = stats.allowed;

  updateLiveRiskChart(txn.risk_score);
  if (!feedRenderPending) {
    feedRenderPending = true;
    requestAnimationFrame(() => {
      renderFeedTable();
      feedRenderPending = false;
    });
  }
  refreshEvidenceDropdown();
}

function renderFeedTable() {
  const filter = document.getElementById("feedFilterSelect").value;
  let txns = [...recentTxns];

  if (sharedFilterNodeId) {
    txns = txns.filter(t => t.user_id === sharedFilterNodeId || t.device_id === sharedFilterNodeId || t.receiver_id === sharedFilterNodeId);
  }

  if (filter !== "ALL") {
    txns = txns.filter(t => t.decision === filter);
  }

  txns.sort((a, b) => {
    let valA, valB;
    if (sortField === "time") {
      valA = a.timestamp; valB = b.timestamp;
    } else {
      valA = a[sortField]; valB = b[sortField];
    }
    
    if (valA < valB) return sortOrder === "asc" ? -1 : 1;
    if (valA > valB) return sortOrder === "asc" ? 1 : -1;
    return 0;
  });

  const body = document.getElementById("feedBody");
  if (sharedFilterNodeId) {
    const filterBanner = document.getElementById('feedFilterBanner');
    if (!filterBanner) {
      const banner = document.createElement('div');
      banner.id = 'feedFilterBanner';
      banner.style.cssText = 'padding:6px 12px; background:rgba(255,180,84,0.08); border:1px solid var(--amber-dim); border-radius:6px; margin-bottom:8px; font-size:11.5px; font-family:var(--mono); display:flex; justify-content:space-between; align-items:center;';
      banner.innerHTML = `<span>Filtered: <b style="color:var(--amber)">${sanitize(sharedFilterNodeId)}</b></span><button class="btn" style="padding:3px 8px; font-size:10px;" onclick="clearRadarFilter()">Clear Filter</button>`;
      const feedPanel = document.querySelector('#view-feed .panel-body');
      if (feedPanel) feedPanel.parentElement.insertBefore(banner, feedPanel);
    }
  } else {
    const existingBanner = document.getElementById('feedFilterBanner');
    if (existingBanner) existingBanner.remove();
  }

  if (txns.length === 0) {
    body.innerHTML = `<tr><td colspan="6" class="empty">No matching transactions in this session.</td></tr>`;
    return;
  }

  body.innerHTML = txns.map(t => {
    const isNew = recentTxns[0] && recentTxns[0].id === t.id && feedRunning;
    return `
      <tr class="${isNew ? 'new-row' : ''} clickable-row" onclick="showSignalDetailById('${t.id}')">
        <td>${fmtTime(t.timestamp)}</td>
        <td>${sanitize(t.user_id)}</td>
        <td>${sanitize(t.receiver_id)}</td>
        <td>${fmtAmt(t.amount)}</td>
        <td><span class="risk-bar-track"><span class="risk-bar-fill" style="width:${t.risk_score}%; background:${riskColor(t.risk_score)}"></span></span>${t.risk_score}</td>
        <td><span class="badge ${t.decision}">${t.decision.replace(/_/g,' ')}</span></td>
      </tr>
    `;
  }).join("");
}

function clearRadarFilter() {
  sharedFilterNodeId = null;
  renderFeedTable();
}

function showSignalDetailById(id) {
  const txn = recentTxns.find(t => t.id === id);
  if (txn) showSignalDetail(txn);
}

function showSignalDetail(txn){
  const s = txn.signals;
  const rows = Object.entries(s).map(([k,v])=>`
    <div class="signal-row">
      <span style="width:120px; color:var(--muted); text-transform:capitalize;">${k.replace(/_/g,' ')}</span>
      <span class="signal-track"><span class="signal-fill" style="width:${v*100}%"></span></span>
      <span>${v.toFixed(2)}</span>
    </div>`).join("");
  document.getElementById("signalDetail").innerHTML = `
    <div style="font-family:var(--mono); font-size:11.5px; color:var(--muted); margin-bottom:10px; line-height:1.6;">
      TXN <span style="color:var(--amber)">${txn.id}</span> · risk <b style="color:${riskColor(txn.risk_score)}">${txn.risk_score}</b> · top signal <b>${txn.top_signal.replace(/_/g,' ')}</b>
      ${txn.decision_fingerprint ? `<br><span style="font-size:10.5px; color:var(--muted);">fingerprint: <b style="color:var(--amber); font-family:var(--mono); background:var(--panel-2); padding:1px 5px; border-radius:3px; border:1px solid var(--line);">${txn.decision_fingerprint}</b></span>` : ''}
    </div>
    ${rows}
    <div id="reasoningBox" class="reasoning-loading">Generating reasoning trace…</div>
    <div style="display:flex; gap:6px; margin-top:10px;">
      <button class="btn" style="flex:1; font-size:11px; padding:5px 8px;" onclick="inlineInspectFusion('${txn.id}')">Inspect Arithmetic</button>
      <button class="btn" style="flex:1; font-size:11px; padding:5px 8px; border-color:var(--safe); color:var(--safe);" onclick="inlineCounterfactual('${txn.id}')">What-If</button>
    </div>
    <div id="feedInlineInspect" style="display:none; margin-top:10px; background:var(--panel-2); border:1px solid var(--line); border-radius:6px; padding:10px; font-family:var(--mono); font-size:11.5px;"></div>
    <button class="btn" style="width:100%; margin-top:8px;" onclick="jumpToEvidence('${txn.id}')">Open in Evidence Responder</button>
  `;
  loadReasoning(txn.id);
}

async function inlineInspectFusion(id) {
  const panel = document.getElementById("feedInlineInspect");
  if (!panel) return;
  if (panel.style.display === "block" && panel.dataset.currId === id && panel.dataset.mode === "fusion") {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "block";
  panel.dataset.currId = id;
  panel.dataset.mode = "fusion";
  panel.innerHTML = "Loading linear arithmetic breakdown...";
  try {
    const res = await fetch(`${API}/api/fusion/${id}`);
    const data = await res.json();
    panel.innerHTML = `
      <div style="color:var(--amber); font-weight:700; margin-bottom:6px;">ARITHMETIC BREAKDOWN · ${data.transaction_id}</div>
      <table style="width:100%; border-collapse:collapse; margin-bottom:6px; font-size:11px;">
        ${data.breakdown.map(b => `<tr><td style="padding:1px 4px;">${b.signal}</td><td style="padding:1px 4px;">${b.raw_value.toFixed(1)} × ${b.weight}</td><td style="padding:1px 4px; text-align:right;">= ${b.contribution.toFixed(2)}</td></tr>`).join("")}
      </table>
      <div style="border-top:1px solid var(--line); padding-top:4px; font-size:11px;">
        Fused: <b>${data.fused_score_before_guardrail}</b> | Final: <b>${data.final_risk_score}</b>
      </div>
      <div style="color:var(--muted); font-size:10px; margin-top:3px;">${data.arithmetic_proof}</div>
    `;
  } catch (err) {
    panel.innerHTML = `<span style="color:var(--danger)">Failed to compute fusion arithmetic.</span>`;
  }
}

async function inlineCounterfactual(id) {
  const panel = document.getElementById("feedInlineInspect");
  if (!panel) return;
  if (panel.style.display === "block" && panel.dataset.currId === id && panel.dataset.mode === "cf") {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "block";
  panel.dataset.currId = id;
  panel.dataset.mode = "cf";
  panel.innerHTML = "Computing counterfactual what-if...";
  try {
    const res = await fetch(`${API}/api/counterfactual/${id}`);
    const data = await res.json();
    panel.innerHTML = `
      <div style="color:var(--safe); font-weight:700; margin-bottom:6px;">COUNTERFACTUAL WATERFALL</div>
      <div style="margin-bottom:6px; font-size:11px;">Risk: <b>${data.current_risk}</b> → Baseline: <b>${data.baseline_neutralized_score}</b> (${data.resulting_decision})</div>
      <ul style="padding-left:14px; margin:0; font-size:10.5px; line-height:1.4;">
        ${data.waterfall.map(w => `<li>${w.description}: <b>${w.from_score} → ${w.to_score}</b></li>`).join("")}
      </ul>
    `;
  } catch (err) {
    panel.innerHTML = `<span style="color:var(--danger)">Failed to compute counterfactual.</span>`;
  }
}

async function loadReasoning(id){
  const box = document.getElementById("reasoningBox");
  try{
    const res = await fetch(`${API}/api/explain/${id}`);
    if(!res.ok) throw new Error();
    const r = await res.json();
    box.className = "reasoning-box";

    const conf = r.confidence || "HIGH";
    const confColor = conf === "HIGH" ? "var(--safe)" : (conf === "MEDIUM" ? "var(--amber)" : "var(--danger)");
    const confBg = conf === "HIGH" ? "rgba(46, 204, 113, 0.12)" : (conf === "MEDIUM" ? "rgba(255, 180, 84, 0.12)" : "rgba(255, 77, 109, 0.12)");

    let html = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="display:inline-flex; align-items:center; gap:5px; font-size:10px; font-family:var(--mono); padding:2px 7px; border-radius:10px; background:${confBg}; color:${confColor}; border:1px solid ${confColor}; font-weight:700;">● ${conf} CONFIDENCE</span>
        <span class="src" style="margin-top:0;">${r.source === 'llm' ? 'AI Assistant' : 'Template (Safe Fallback)'}</span>
      </div>
      <div style="font-size:12.5px; line-height:1.45; margin-bottom:8px;">${r.text}</div>
    `;

    if (r.evidence_for && r.evidence_for.length > 0) {
      html += `
        <div style="font-size:11px; font-weight:700; color:var(--danger); margin:8px 0 4px; font-family:var(--mono);">RISK SIGNALS DETECTED (+)</div>
        <ul style="margin:0 0 6px 0; padding-left:16px; font-size:11.5px; color:var(--text); line-height:1.4;">
          ${r.evidence_for.map(e => `<li style="margin-bottom:3px;">${e}</li>`).join("")}
        </ul>
      `;
    }

    if (r.evidence_against && r.evidence_against.length > 0) {
      html += `
        <div style="font-size:11px; font-weight:700; color:var(--safe); margin:8px 0 4px; font-family:var(--mono);">MITIGATING FACTS (-)</div>
        <ul style="margin:0; padding-left:16px; font-size:11.5px; color:var(--muted); line-height:1.4;">
          ${r.evidence_against.map(e => `<li style="margin-bottom:3px;">${e}</li>`).join("")}
        </ul>
      `;
    }

    box.innerHTML = html;
  }catch(e){
    box.className = "reasoning-loading";
    box.textContent = "Reasoning trace unavailable — transaction may still be saving.";
  }
}

function jumpToEvidence(id){
  document.querySelector('.nav-item[data-view="evidence"]').click();
  document.getElementById("evidenceSelect").value = id;
  document.getElementById("generateEvidenceBtn").click();
}

document.querySelectorAll("th.sortable").forEach(th => {
  th.addEventListener("click", () => {
    const field = th.dataset.sort;
    if (sortField === field) {
      sortOrder = sortOrder === "asc" ? "desc" : "asc";
    } else {
      sortField = field;
      sortOrder = "desc";
    }
    document.querySelectorAll("th.sortable").forEach(h => h.className = "sortable");
    th.classList.add(sortOrder);
    renderFeedTable();
  });
});

document.getElementById("feedFilterSelect").addEventListener("change", renderFeedTable);

// ---------------- policy gate ----------------
async function loadPolicy(){
  const res = await safeFetch(`${API}/api/policy`);
  if(!res.ok) return;
  const p = await res.json();
  document.getElementById("policyBands").innerHTML = p.decision_bands.map(b=>`
    <div class="policy-band" style="cursor:pointer;" onclick="expandPolicyBand('${b.decision}')">
      <div class="pb-label"><span class="badge ${b.decision}">${b.decision.replace(/_/g,' ')}</span></div>
      <div class="pb-range">score ${b.range}</div>
      <div class="pb-col"><span class="h">AI authority</span><p>${b.ai_authority}</p></div>
      <div class="pb-col"><span class="h">Human role</span><p>${b.human_role}</p></div>
    </div>
    <div id="policyBandDetail-${b.decision}" style="display:none; padding:12px 18px; border-bottom:1px solid var(--line); font-family:var(--mono); font-size:11.5px; background:var(--ink);">
      <h4 style="font-family:var(--display); font-size:12px; color:var(--amber); margin-bottom:6px;">Example Scored Transactions</h4>
      <div class="list" id="policyBandList-${b.decision}">Loading examples...</div>
    </div>
  `).join("");
  document.getElementById("policyLimits").innerHTML = p.hard_limits.map(l=>`<li>${l}</li>`).join("");
}

async function expandPolicyBand(decision) {
  const panel = document.getElementById(`policyBandDetail-${decision}`);
  if (panel.style.display === "block") {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "block";
  const list = document.getElementById(`policyBandList-${decision}`);
  try {
    const res = await fetch(`/api/policy/transactions?decision=${decision}`);
    const txns = await res.json();
    if (txns.length === 0) {
      list.innerHTML = `<span style="color:var(--muted)">No transactions have been recorded in this band.</span>`;
      return;
    }
    list.innerHTML = txns.map(t => `
      <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
        <span>TXN <b>${t.id}</b> · amount: ${fmtAmt(t.amount)} · risk: ${t.risk_score}</span>
        <span style="color:var(--muted);">${new Date(t.timestamp).toLocaleTimeString()}</span>
      </div>
    `).join("");
  } catch (err) {
    list.textContent = "Failed to load examples.";
  }
}

// ---------------- manual scoring ----------------
document.getElementById("scoreBtn").addEventListener("click", async ()=>{
  const btn = document.getElementById("scoreBtn");
  btn.disabled = true;
  btn.textContent = "Scoring...";
  try {
    const body = {
      amount: Number(document.getElementById("mAmount").value),
      user_velocity_1h: Number(document.getElementById("mVelocity").value),
      device_share_count_1h: Number(document.getElementById("mDevice").value),
      receiver_concentration_1h: Number(document.getElementById("mReceiver").value),
      geo_mismatch: Number(document.getElementById("mGeo").value),
    };
    const res = await fetch(`${API}/api/score`, {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body)});
    const txn = await res.json();
    recentTxns.unshift(txn);
    refreshEvidenceDropdown();
    document.getElementById("manualResult").innerHTML = `
      <div style="border:1px solid var(--line); border-radius:8px; padding:12px; font-family:var(--mono); font-size:12px;">
        Risk score: <b style="color:${riskColor(txn.risk_score)}">${txn.risk_score}</b><br>
        Decision: <span class="badge ${txn.decision}">${txn.decision.replace(/_/g,' ')}</span><br>
        Top signal: ${txn.top_signal.replace(/_/g,' ')}
      </div>`;
    renderFeedTable();
  } catch (err) {
    document.getElementById("manualResult").innerHTML = `<div style="color:var(--danger)">Error scoring transaction.</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Score Transaction";
  }
});

// ---------------- metrics ----------------
async function loadMetrics(){
  const metricCards = document.getElementById('metricCards');
  if (metricCards && !metricCards.innerHTML.trim()) {
    metricCards.innerHTML = '<div class="metric-card" style="opacity:0.5"><div class="big" style="color:var(--muted)">—</div><div class="lbl">Loading...</div></div>'.repeat(4);
  }
  const res = await safeFetch(`${API}/api/metrics`);
  if(!res.ok) return;
  const m = await res.json();

  document.getElementById("metricCards").innerHTML = `
    <div class="metric-card"><div class="big">${(m.precision*100).toFixed(1)}%</div><div class="lbl">Precision</div><div class="sub">of flagged, actually fraud</div></div>
    <div class="metric-card"><div class="big">${(m.recall*100).toFixed(1)}%</div><div class="lbl">Recall</div><div class="sub">of fraud, successfully caught</div></div>
    <div class="metric-card"><div class="big">${(m.f1*100).toFixed(1)}%</div><div class="lbl">F1 Score</div><div class="sub">precision/recall balance</div></div>
    <div class="metric-card"><div class="big">${(m.false_positive_rate*100).toFixed(2)}%</div><div class="lbl">False Positive Rate</div><div class="sub">clean txns wrongly flagged</div></div>
  `;

  document.getElementById("cmSubtitle").textContent = `n = ${m.test_set_size} · ${m.test_fraud_count} fraud in held-out test`;
  const cm = m.confusion_matrix;
  document.getElementById("cmGrid").innerHTML = `
    <div class="cm-cell cm-tp" style="cursor:pointer;" onclick="loadCmTransactions('tp')"><div class="n">${cm.tp}</div><div class="l">True Positive</div></div>
    <div class="cm-cell cm-fp" style="cursor:pointer;" onclick="loadCmTransactions('fp')"><div class="n">${cm.fp}</div><div class="l">False Positive</div></div>
    <div class="cm-cell cm-fn" style="cursor:pointer;" onclick="loadCmTransactions('fn')"><div class="n">${cm.fn}</div><div class="l">False Negative</div></div>
    <div class="cm-cell cm-tn" style="cursor:pointer;" onclick="loadCmTransactions('tn')"><div class="n">${cm.tn}</div><div class="l">True Negative</div></div>
  `;

  const c = m.cost_model;
  document.getElementById("simReview").value = c.review_cost_inr;
  document.getElementById("simFraud").value = c.avg_fraud_loss_inr;
  document.getElementById("simReviewOut").textContent = fmtAmt(c.review_cost_inr);
  document.getElementById("simFraudOut").textContent = fmtAmt(c.avg_fraud_loss_inr);
  renderCostTable(c);
  
  loadMetricsCharts(m);
  loadMetricIntegrity();
}

async function loadMetricIntegrity() {
  const panel = document.getElementById("metricIntegrityPanel");
  const badge = document.getElementById("integrityStatusBadge");
  if (!panel) return;
  try {
    const res = await fetch(`${API}/api/metrics/integrity`);
    const data = await res.json();
    if (badge) {
      badge.textContent = data.all_passed ? "VERIFIED PASS" : "INTEGRITY WARNING";
      badge.className = `badge ${data.all_passed ? 'ALLOW' : 'BLOCK_AND_REVIEW'}`;
    }
    panel.innerHTML = `
      <div style="font-size:12px; margin-bottom:10px; color:var(--muted); line-height:1.5;">
        Automated code-checked integrity assertions executed against active in-memory model and held-out dataset partitions:
      </div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${data.checks.map(c => `
          <div class="integrity-check-row">
            <span style="font-weight:700; font-size:14px; color:${c.passed ? 'var(--safe)' : 'var(--danger)'}; width:18px;">
              ${c.passed ? '✓' : '✗'}
            </span>
            <div style="flex:1;">
              <div style="font-weight:600; font-size:12px; color:var(--text);">${c.assertion}</div>
              <div style="font-family:var(--mono); font-size:11px; color:var(--muted); margin-top:2px;">${c.detail}</div>
            </div>
            <span class="badge ${c.passed ? 'ALLOW' : 'BLOCK_AND_REVIEW'}" style="font-size:10px;">${c.passed ? 'PASSED' : 'FAILED'}</span>
          </div>
        `).join("")}
      </div>
    `;
  } catch (err) {
    panel.innerHTML = `<span style="color:var(--danger)">Failed to load integrity audit: ${err.message}</span>`;
  }
}

function renderCostTable(c){
  document.getElementById("costTable").innerHTML = `
    <tr><td>Cost with no detection at all</td><td>${fmtAmt(c.cost_no_detection_inr)}</td></tr>
    <tr><td>Cost if flagging every transaction</td><td>${fmtAmt(c.cost_flag_everything_inr)}</td></tr>
    <tr><td>Cost with RISKYN (test set)</td><td>${fmtAmt(c.cost_with_model_inr)}</td></tr>
    <tr class="total"><td>Estimated savings vs. no detection</td><td>${fmtAmt(c.estimated_savings_inr)}</td></tr>
  `;
}

let simDebounce;
async function runCostSimulation(){
  const reviewCost = Number(document.getElementById("simReview").value);
  const fraudLoss = Number(document.getElementById("simFraud").value);
  document.getElementById("simReviewOut").textContent = fmtAmt(reviewCost);
  document.getElementById("simFraudOut").textContent = fmtAmt(fraudLoss);
  
  const simReviewInput = document.getElementById("simReview");
  const simFraudInput = document.getElementById("simFraud");
  simReviewInput.disabled = true;
  simFraudInput.disabled = true;

  clearTimeout(simDebounce);
  simDebounce = setTimeout(async ()=>{
    try {
      const res = await fetch(`${API}/api/metrics/simulate?review_cost=${reviewCost}&fraud_loss=${fraudLoss}`);
      if(res.ok) {
        const c = await res.json();
        renderCostTable(c);
      }
    } finally {
      simReviewInput.disabled = false;
      simFraudInput.disabled = false;
    }
  }, 150);
}
document.getElementById("simReview").addEventListener("input", runCostSimulation);
document.getElementById("simFraud").addEventListener("input", runCostSimulation);

document.getElementById("retrainBtn").addEventListener("click", async ()=>{
  const btn = document.getElementById("retrainBtn");
  btn.textContent = "Training…"; btn.disabled = true;
  try {
    await fetch(`${API}/api/train`, {method:"POST"});
    if(document.getElementById("view-metrics").classList.contains("active")) loadMetrics();
  } catch (err) {
    console.error("Retrain failure", err);
  } finally {
    btn.textContent = "Retrain Model"; btn.disabled = false;
  }
});

async function loadMetricsCharts(metrics) {
  try {
    const prRes = await fetch('/api/metrics/pr-curve');
    const prPoints = await prRes.json();
    const colors = getThemeColors();

    const prCtx = document.getElementById("prCurveChart").getContext("2d");
    if (prCurveChartInstance) prCurveChartInstance.destroy();
    
    if (prPoints && prPoints.length > 0) {
      prPoints.sort((a, b) => a.recall - b.recall);
      prCurveChartInstance = new Chart(prCtx, {
        type: 'line',
        data: {
          datasets: [{
            label: 'PR Curve',
            data: prPoints.map(p => ({ x: p.recall, y: p.precision, threshold: p.threshold })),
            borderColor: colors.amber,
            backgroundColor: colors.amberGlow,
            fill: true,
            tension: 0.2,
            borderWidth: 2.2,
            pointRadius: 2,
            pointHoverRadius: 5
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { type: 'linear', min: 0, max: 1.05, title: { display: true, text: 'Recall', color: colors.textColor }, ticks: { color: colors.textColor }, grid: { color: colors.gridColor } },
            y: { type: 'linear', min: 0, max: 1.05, title: { display: true, text: 'Precision', color: colors.textColor }, ticks: { color: colors.textColor }, grid: { color: colors.gridColor } }
          },
          plugins: {
            tooltip: {
              backgroundColor: colors.cardBg,
              titleColor: colors.textColor,
              bodyColor: colors.amber,
              borderColor: colors.cardBorder,
              borderWidth: 1,
              padding: 8,
              callbacks: {
                label: (ctx) => `Prec: ${ctx.parsed.y.toFixed(2)}, Rec: ${ctx.parsed.x.toFixed(2)}, Thresh: ${ctx.raw.threshold}`
              }
            },
            legend: { display: false }
          }
        }
      });
    } else {
      prCtx.clearRect(0, 0, 300, 200);
      prCtx.fillStyle = colors.textColor;
      prCtx.font = "12px monospace";
      prCtx.textAlign = "center";
      prCtx.fillText("PR Curve points not loaded. Run a training cycle.", 150, 100);
    }

    const cm = metrics.confusion_matrix;
    const cmCtx = document.getElementById("cmBarChart").getContext("2d");
    if (cmBarChartInstance) cmBarChartInstance.destroy();
    cmBarChartInstance = new Chart(cmCtx, {
      type: 'bar',
      data: {
        labels: ['True Pos (TP)', 'False Pos (FP)', 'False Neg (FN)', 'True Neg (TN)'],
        datasets: [{
          data: [cm.tp, cm.fp, cm.fn, cm.tn],
          backgroundColor: [
            colors.safeGlow,
            colors.cautionGlow,
            colors.dangerGlow,
            colors.safeGlow
          ],
          borderColor: [
            colors.safe,
            colors.caution,
            colors.danger,
            colors.safe
          ],
          borderWidth: 1.5,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: colors.cardBg,
            titleColor: colors.textColor,
            bodyColor: colors.amber,
            borderColor: colors.cardBorder,
            borderWidth: 1,
            padding: 8
          }
        },
        scales: {
          x: { ticks: { color: colors.textColor }, grid: { display: false } },
          y: { ticks: { color: colors.textColor }, grid: { color: colors.gridColor } }
        }
      }
    });
  } catch (err) {
    console.error("Failed to render metrics charts", err);
  }
}

async function loadCmTransactions(cell) {
  const panel = document.getElementById("cmTxnDetailPanel");
  const title = document.getElementById("cmTxnDetailTitle");
  const list = document.getElementById("cmTxnDetailList");
  
  panel.style.display = "block";
  title.textContent = `Scored Transactions in Cell: ${cell.toUpperCase()}`;
  list.textContent = "Loading...";

  try {
    const res = await fetch(`/api/metrics/cm-transactions?cell=${cell}`);
    const txns = await res.json();
    if (txns.length === 0) {
      list.innerHTML = `<span style="color:var(--muted)">No transactions matched this cell in DB.</span>`;
      return;
    }
    list.innerHTML = txns.map(t => `
      <div style="display:flex; justify-content:space-between; margin-bottom:4px; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:4px;">
        <span>TXN <b>${t.id}</b> · amount: ${fmtAmt(t.amount)} · risk: ${t.risk_score} · fraud: ${t.fraud_type}</span>
        <button class="btn" style="padding:2px 6px; font-size:10px;" onclick="jumpToEvidence('${t.id}')">Respond</button>
      </div>
    `).join("");
  } catch (err) {
    list.textContent = "Failed to load confusion matrix transactions.";
  }
}

// ---------------- abuse radar & incident intelligence (Group 6) ----------------
document.getElementById("toggleFullGraphBtn")?.addEventListener("click", () => {
  showFullNetwork = !showFullNetwork;
  applyRadarFiltersAndRender();
});

document.getElementById("radarMinRisk")?.addEventListener("input", (e) => {
  radarMinRisk = Number(e.target.value);
  const valSpan = document.getElementById("radarMinRiskVal");
  if (valSpan) valSpan.textContent = radarMinRisk;
  applyRadarFiltersAndRender();
});

document.getElementById("radarEntityType")?.addEventListener("change", (e) => {
  radarEntityType = e.target.value;
  applyRadarFiltersAndRender();
});

document.getElementById("detectRingsBtn")?.addEventListener("click", detectRingsAction);
document.getElementById("expandHopBtn")?.addEventListener("click", expandActiveIncidentHop);

// Side panel tab navigation
document.getElementById("radarTabIncidentBtn")?.addEventListener("click", () => {
  switchRadarSideTab("incident");
  if (activeIncidentId) {
    loadIncidentDetails(activeIncidentId);
  } else if (lastRadarData?.clusters?.length > 0) {
    const topInc = lastRadarData.clusters[0].incident_id || lastRadarData.clusters[0].cluster_id;
    selectIncident(topInc);
  }
});
document.getElementById("radarTabEntityBtn")?.addEventListener("click", () => {
  switchRadarSideTab("entity");
});
document.getElementById("backToIncidentBtn")?.addEventListener("click", () => {
  switchRadarSideTab("incident");
  if (activeIncidentId) {
    loadIncidentDetails(activeIncidentId);
  } else if (lastRadarData?.clusters?.length > 0) {
    const topInc = lastRadarData.clusters[0].incident_id || lastRadarData.clusters[0].cluster_id;
    selectIncident(topInc);
  }
});

function switchRadarSideTab(tab) {
  currentSideTab = tab;
  const incTabBtn = document.getElementById("radarTabIncidentBtn");
  const entTabBtn = document.getElementById("radarTabEntityBtn");
  const incPanel = document.getElementById("radarIncidentPanel");
  const entPanel = document.getElementById("radarNodePanel");

  if (tab === "incident") {
    if (incTabBtn) { incTabBtn.className = "btn primary"; }
    if (entTabBtn) { entTabBtn.className = "btn"; }
    if (incPanel) incPanel.style.display = "block";
    if (entPanel) entPanel.style.display = "none";
  } else {
    if (incTabBtn) { incTabBtn.className = "btn"; }
    if (entTabBtn) { entTabBtn.className = "btn primary"; }
    if (incPanel) incPanel.style.display = "none";
    if (entPanel) entPanel.style.display = "block";
  }
}

async function detectRingsAction() {
  const btn = document.getElementById("detectRingsBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Detecting Rings..."; }
  try {
    const res = await fetch(`${API}/api/network/detect`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      await loadRadar();
      if (data.clusters && data.clusters.length > 0) {
        const topInc = data.clusters[0].incident_id || data.clusters[0].cluster_id;
        selectIncident(topInc);
      }
    }
  } catch (err) {
    console.error("Detect rings failed", err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "⚡ Detect Rings"; }
  }
}

function selectIncident(incidentId) {
  activeIncidentId = incidentId;
  selectedNodeId = null;
  expandedHopNodes.clear();
  switchRadarSideTab("incident");
  applyRadarFiltersAndRender();
  loadIncidentDetails(incidentId);
}

function expandActiveIncidentHop() {
  if (!lastRadarData) return;
  let cluster = (lastRadarData.clusters || []).find(c => c.incident_id === activeIncidentId || c.cluster_id === activeIncidentId);
  if (!cluster && lastRadarData.clusters && lastRadarData.clusters.length > 0) {
    cluster = lastRadarData.clusters[0];
    activeIncidentId = cluster.incident_id || cluster.cluster_id;
  }
  if (!cluster) return;

  const currentMembers = new Set(cluster.member_node_ids);
  expandedHopNodes.forEach(nid => currentMembers.add(nid));

  (lastRadarData.edges || []).forEach(e => {
    if (currentMembers.has(e.source) && !currentMembers.has(e.target)) {
      expandedHopNodes.add(e.target);
    } else if (currentMembers.has(e.target) && !currentMembers.has(e.source)) {
      expandedHopNodes.add(e.source);
    }
  });

  applyRadarFiltersAndRender();
}

let radarAnimationRunning = false;

function startRadarAnimation() {
  if (radarAnimationRunning) return;
  radarAnimationRunning = true;
  function loop(time) {
    if (!radarAnimationRunning) return;
    radarSweepAngle = (radarSweepAngle + 0.012) % (Math.PI * 2);
    radarPulseTime = time || 0;
    renderRadarFrame();
    animationFrameId = requestAnimationFrame(loop);
  }
  animationFrameId = requestAnimationFrame(loop);
}

function stopRadarAnimation() {
  radarAnimationRunning = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

async function loadRadar(){
  // 1. Instant cache render: zero delay when switching to Abuse Radar
  if (lastRadarData) {
    renderTopologies(lastRadarData.clusters);
    const clusterExists = (lastRadarData.clusters || []).some(c => c.incident_id === activeIncidentId || c.cluster_id === activeIncidentId);
    if ((!activeIncidentId || !clusterExists) && lastRadarData.clusters && lastRadarData.clusters.length > 0) {
      activeIncidentId = lastRadarData.clusters[0].incident_id || lastRadarData.clusters[0].cluster_id;
    }
    applyRadarFiltersAndRender();
    if (activeIncidentId) loadIncidentDetails(activeIncidentId);
  }

  startRadarAnimation();

  // 2. Fetch fresh network data in background
  const res = await safeFetch(`${API}/api/network`);
  if (!res.ok) return;
  const data = await res.json();
  lastRadarData = data;

  renderTopologies(data.clusters);
  
  // Auto-focus top 1 cluster if none active or if activeIncidentId is no longer in current clusters
  const clusterExists = (data.clusters || []).some(c => c.incident_id === activeIncidentId || c.cluster_id === activeIncidentId);
  if ((!activeIncidentId || !clusterExists) && data.clusters && data.clusters.length > 0) {
    activeIncidentId = data.clusters[0].incident_id || data.clusters[0].cluster_id;
  }

  applyRadarFiltersAndRender();

  if (activeIncidentId) {
    loadIncidentDetails(activeIncidentId);
  }
}

function applyRadarFiltersAndRender() {
  if (!lastRadarData) return;
  const canvas = document.getElementById("radarCanvas");
  if (!canvas) return;
  const modeLabel = document.getElementById("graphFocusModeLabel");
  const toggleBtn = document.getElementById("toggleFullGraphBtn");

  let focusedNodeIds = new Set();
  if (showFullNetwork) {
    (lastRadarData.nodes || []).forEach(n => focusedNodeIds.add(n.id));
    if (modeLabel) modeLabel.textContent = "Full Network (Unfiltered)";
    if (toggleBtn) toggleBtn.textContent = "Focus Top Incidents";
  } else if (activeIncidentId) {
    const cluster = (lastRadarData.clusters || []).find(c => c.incident_id === activeIncidentId || c.cluster_id === activeIncidentId);
    if (cluster) {
      cluster.member_node_ids.forEach(id => focusedNodeIds.add(id));
      expandedHopNodes.forEach(id => focusedNodeIds.add(id));
    }
    const hopSuffix = expandedHopNodes.size > 0 ? ` (+${expandedHopNodes.size} 1-hop)` : '';
    if (modeLabel) modeLabel.textContent = `Incident ${activeIncidentId}${hopSuffix}`;
    if (toggleBtn) toggleBtn.textContent = "Show Full Network";
  } else {
    // Default Task 1: top 3 clusters by volume
    const top3 = (lastRadarData.clusters || []).slice(0, 3);
    top3.forEach(c => c.member_node_ids.forEach(id => focusedNodeIds.add(id)));
    expandedHopNodes.forEach(id => focusedNodeIds.add(id));
    if (modeLabel) modeLabel.textContent = `Top ${top3.length} Incidents by Exposure (Focused)`;
    if (toggleBtn) toggleBtn.textContent = "Show Full Network";
  }

  // Filter nodes by focus, min-risk, and entity type
  let filteredNodes = (lastRadarData.nodes || []).filter(n => {
    if (!focusedNodeIds.has(n.id)) return false;
    const avgRisk = n.stats ? n.stats.avg_risk_score : 0;
    if (radarMinRisk > 0 && avgRisk < radarMinRisk) return false;
    if (radarEntityType !== "ALL" && n.type !== radarEntityType) return false;
    return true;
  });

  nodesList = filteredNodes;
  const activeIds = new Set(nodesList.map(n => n.id));
  edgesList = (lastRadarData.edges || []).filter(e => activeIds.has(e.source) && activeIds.has(e.target));

  // Dynamic canvas scaling: space increases proportionally as entities increase
  const nNodes = nodesList.length;
  let targetDim = 580;
  if (nNodes > 10) {
    targetDim = Math.min(960, Math.round(580 + Math.sqrt(Math.max(0, nNodes - 8)) * 48));
  }

  const oldDim = Number(canvas.dataset.logicalDim || 580);
  if (oldDim !== targetDim) {
    const oldCx = oldDim / 2, oldCy = oldDim / 2;
    const newCx = targetDim / 2, newCy = targetDim / 2;
    const ratio = targetDim / oldDim;
    Object.values(nodesMap).forEach(p => {
      p.x = newCx + (p.x - oldCx) * ratio;
      p.y = newCy + (p.y - oldCy) * ratio;
      p.vx = 0;
      p.vy = 0;
    });
    canvas.dataset.logicalDim = targetDim;
    zoom = 1.0;
    panOffset = { x: 0, y: 0 };
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(targetDim * dpr);
  const pixelHeight = Math.round(targetDim * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    canvas.style.width = targetDim + "px";
    canvas.style.height = targetDim + "px";
    canvas.dataset.logicalDim = targetDim;
  }

  const cx = targetDim / 2, cy = targetDim / 2;
  const R = targetDim / 2 - 38;

  // Build connected components for topological sector initial placement
  const adj = {};
  nodesList.forEach(n => adj[n.id] = new Set());
  edgesList.forEach(e => {
    if (adj[e.source] && adj[e.target]) {
      adj[e.source].add(e.target);
      adj[e.target].add(e.source);
    }
  });

  const visited = new Set();
  const components = [];
  nodesList.forEach(n => {
    if (!visited.has(n.id)) {
      const comp = [];
      const q = [n.id];
      visited.add(n.id);
      while (q.length > 0) {
        const curr = q.shift();
        comp.push(curr);
        (adj[curr] || []).forEach(nbr => {
          if (!visited.has(nbr)) {
            visited.add(nbr);
            q.push(nbr);
          }
        });
      }
      components.push(comp);
    }
  });

  components.sort((a, b) => b.length - a.length);
  const totalClusters = Math.max(components.length, 1);

  // Sector-based initial placement: groups related ring nodes into immediate spatial harmony
  components.forEach((comp, cIdx) => {
    const baseAngle = (2 * Math.PI * cIdx) / totalClusters - Math.PI / 2;
    const hubId = comp.find(id => {
      const node = nodesList.find(n => n.id === id);
      return node && (node.type === "device" || node.type === "receiver");
    }) || comp[0];

    const nonHubs = comp.filter(id => id !== hubId);
    const m = nonHubs.length;
    const fanSpan = Math.min(0.65, Math.max(0.18, 1.8 / Math.max(m, 1)));

    comp.forEach(nid => {
      const n = nodesList.find(node => node.id === nid);
      if (!n) return;

      const avgRisk = n.stats ? n.stats.avg_risk_score : 0;
      let rMin, rMax, targetR;
      if (avgRisk >= 62) {
        rMin = R * 0.10;
        rMax = R * 0.36;
        targetR = R * 0.22;
      } else if (avgRisk >= 37) {
        rMin = R * 0.38;
        rMax = R * 0.62;
        targetR = R * 0.50;
      } else {
        rMin = R * 0.64;
        rMax = R * 0.94;
        targetR = R * 0.79;
      }

      let nodeAngle = baseAngle;
      if (nid !== hubId && m > 0) {
        const idx = nonHubs.indexOf(nid);
        nodeAngle = baseAngle + (idx - (m - 1) / 2) * fanSpan;
      }

      if (!nodesMap[n.id]) {
        nodesMap[n.id] = {
          x: cx + targetR * Math.cos(nodeAngle),
          y: cy + targetR * Math.sin(nodeAngle),
          vx: 0,
          vy: 0,
          rMin: rMin,
          rMax: rMax,
          targetRadius: targetR
        };
      } else {
        nodesMap[n.id].rMin = rMin;
        nodesMap[n.id].rMax = rMax;
        nodesMap[n.id].targetRadius = targetR;
      }
    });
  });

  Object.keys(nodesMap).forEach(id => {
    if (!activeIds.has(id)) {
      delete nodesMap[id];
    }
  });

  // Fast 18-step vector relaxation settles layout in <3ms
  for (let i = 0; i < 18; i++) {
    runPhysicsStep();
  }

  renderRadarFrame();
}

function runPhysicsStep() {
  const canvas = document.getElementById("radarCanvas");
  if (!canvas) return;
  const targetDim = Number(canvas.dataset.logicalDim || 580);
  const cx = targetDim / 2, cy = targetDim / 2;
  const nNodes = nodesList.length;

  const dynamicRepulsion = Math.max(kRepulsion, kRepulsion * Math.sqrt(Math.max(1, nNodes / 8)));

  // 1. Repulsion between all node pairs
  for (let i = 0; i < nodesList.length; i++) {
    const p1 = nodesMap[nodesList[i].id];
    if (!p1) continue;

    for (let j = i + 1; j < nodesList.length; j++) {
      const p2 = nodesMap[nodesList[j].id];
      if (!p2) continue;

      let dx = p1.x - p2.x;
      let dy = p1.y - p2.y;
      if (dx === 0 && dy === 0) {
        dx = (Math.random() - 0.5) * 4;
        dy = (Math.random() - 0.5) * 4;
      }
      const dist = Math.sqrt(dx * dx + dy * dy);
      const force = dynamicRepulsion / (dist * dist + 25);
      const fx = (dx / (dist || 1)) * force;
      const fy = (dy / (dist || 1)) * force;

      p1.vx += fx;
      p1.vy += fy;
      p2.vx -= fx;
      p2.vy -= fy;
    }
  }

  // 2. Attraction along edges
  edgesList.forEach(edge => {
    const p1 = nodesMap[edge.source];
    const p2 = nodesMap[edge.target];
    if (!p1 || !p2) return;

    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const idealDist = 55;
    const force = (dist - idealDist) * kAttraction;
    const fx = (dx / (dist || 1)) * force;
    const fy = (dy / (dist || 1)) * force;

    p1.vx -= fx;
    p1.vy -= fy;
    p2.vx += fx;
    p2.vy += fy;
  });

  // 3. Elastic Annular Zone Constraints + Velocity Integration
  nodesList.forEach(n => {
    const p = nodesMap[n.id];
    if (!p) return;

    p.vx *= damping;
    p.vy *= damping;

    p.x += p.vx;
    p.y += p.vy;

    const dx = p.x - cx;
    const dy = p.y - cy;
    let r = Math.sqrt(dx * dx + dy * dy) || 1;
    const angle = Math.atan2(dy, dx);

    const dr = r - p.targetRadius;
    p.vx -= (dx / r) * dr * 0.05;
    p.vy -= (dy / r) * dr * 0.05;

    if (r < p.rMin) {
      r = p.rMin;
      p.x = cx + r * Math.cos(angle);
      p.y = cy + r * Math.sin(angle);
    } else if (r > p.rMax) {
      r = p.rMax;
      p.x = cx + r * Math.cos(angle);
      p.y = cy + r * Math.sin(angle);
    }
  });
}

function renderRadarFrame() {
  const canvas = document.getElementById("radarCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const targetDim = Number(canvas.dataset.logicalDim || 580);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = targetDim, H = targetDim, cx = W / 2, cy = H / 2, R = W / 2 - 38;
  const colors = getThemeColors();

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.translate(cx + panOffset.x, cy + panOffset.y);
  ctx.scale(zoom, zoom);
  ctx.translate(-cx, -cy);

  // Concentric Risk Zones background fills and dashed boundaries
  const zones = [
    { r: R, color: colors.isLight ? "rgba(5, 150, 105, 0.02)" : "rgba(61, 220, 151, 0.015)", stroke: colors.isLight ? "rgba(5, 150, 105, 0.22)" : "rgba(61, 220, 151, 0.18)", label: "SAFE BASELINE (Risk < 37)" },
    { r: R * 0.63, color: colors.isLight ? "rgba(217, 119, 6, 0.03)" : "rgba(255, 180, 84, 0.025)", stroke: colors.isLight ? "rgba(217, 119, 6, 0.25)" : "rgba(255, 180, 84, 0.22)", label: "ELEVATED ZONE (Risk 37-62)" },
    { r: R * 0.38, color: colors.isLight ? "rgba(225, 29, 72, 0.045)" : "rgba(255, 77, 109, 0.05)", stroke: colors.isLight ? "rgba(225, 29, 72, 0.32)" : "rgba(255, 77, 109, 0.32)", label: "CRITICAL THREAT CORE (Risk ≥ 62)" }
  ];

  zones.forEach(z => {
    ctx.fillStyle = z.color;
    ctx.beginPath();
    ctx.arc(cx, cy, z.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = z.stroke;
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, z.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  });

  // Display concentric target zone indicators
  ctx.fillStyle = colors.isLight ? "rgba(30, 41, 59, 0.6)" : "rgba(226, 232, 240, 0.45)";
  ctx.font = "bold 8.5px var(--mono)";
  ctx.textAlign = "left";
  zones.forEach(z => {
    ctx.fillText(`⌖ ${z.label}`, cx + 8, cy - z.r + 11);
  });

  // Radar sweep crosshair lines
  ctx.strokeStyle = colors.isLight ? "rgba(0, 0, 0, 0.07)" : "rgba(255, 255, 255, 0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
  ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
  ctx.stroke();

  // Distance range ticks
  const tickSteps = [R * 0.25, R * 0.5, R * 0.75, R];
  ctx.strokeStyle = colors.isLight ? "rgba(0, 0, 0, 0.12)" : "rgba(255, 255, 255, 0.15)";
  tickSteps.forEach(tr => {
    ctx.beginPath();
    ctx.moveTo(cx + tr, cy - 3); ctx.lineTo(cx + tr, cy + 3);
    ctx.moveTo(cx - tr, cy - 3); ctx.lineTo(cx - tr, cy + 3);
    ctx.moveTo(cx - 3, cy + tr); ctx.lineTo(cx + 3, cy + tr);
    ctx.moveTo(cx - 3, cy - tr); ctx.lineTo(cx + 3, cy - tr);
    ctx.stroke();
  });

  // Dynamic rotating radar sweep beam with trailing gradient
  ctx.save();
  ctx.strokeStyle = colors.isLight ? "rgba(217, 119, 6, 0.4)" : "rgba(255, 180, 84, 0.45)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + R * Math.cos(radarSweepAngle), cy + R * Math.sin(radarSweepAngle));
  ctx.stroke();

  ctx.fillStyle = colors.isLight ? "rgba(217, 119, 6, 0.035)" : "rgba(255, 180, 84, 0.045)";
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, R, radarSweepAngle - 0.5, radarSweepAngle, false);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const activeFocusId = selectedNodeId || (hoveredNode ? hoveredNode.id : null);

  // Draw Edges with traffic flow and active focus illumination
  edgesList.forEach(e => {
    const s = nodesMap[e.source];
    const t = nodesMap[e.target];
    if (!s || !t) return;
    const amt = e.amount || 0;
    const isConnectedToActive = activeFocusId && (e.source === activeFocusId || e.target === activeFocusId);
    
    let thickness = Math.max(1.2, Math.min(4.5, 1.2 + Math.sqrt(amt / 7000) * 1.3));
    if (isConnectedToActive) {
      thickness = Math.max(thickness, 2.5);
      ctx.strokeStyle = colors.amber;
    } else if (activeFocusId) {
      ctx.strokeStyle = colors.isLight ? "rgba(0, 0, 0, 0.04)" : "rgba(255, 255, 255, 0.04)";
    } else {
      ctx.strokeStyle = colors.isLight ? "rgba(71, 85, 105, 0.22)" : "rgba(148, 163, 184, 0.18)";
    }
    
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(t.x, t.y);
    ctx.stroke();

    // Moving energy pulse particle along active edges
    if (isConnectedToActive || activeFocusId == null) {
      const pulseT = ((radarPulseTime * 0.0012 + amt * 0.00008) % 1);
      const px = s.x + (t.x - s.x) * pulseT;
      const py = s.y + (t.y - s.y) * pulseT;
      ctx.beginPath();
      ctx.arc(px, py, isConnectedToActive ? 3.0 : 1.8, 0, Math.PI * 2);
      ctx.fillStyle = isConnectedToActive ? colors.amber : (colors.isLight ? "rgba(217, 119, 6, 0.6)" : "rgba(255, 180, 84, 0.5)");
      ctx.fill();
    }
  });

  const nTotal = nodesList.length;

  // Draw Nodes with distinct type geometry, risk color, and glow
  nodesList.forEach(n => {
    const p = nodesMap[n.id];
    if (!p) return;

    const vol = (n.stats && n.stats.total_volume) ? n.stats.total_volume : (n.size * 1200);
    const size = Math.max(5.5, Math.min(15.5, 5.5 + Math.sqrt(vol / 3600) * 1.6));
    const avgRisk = n.stats ? n.stats.avg_risk_score : 0;
    const isSelected = selectedNodeId === n.id;
    const isHovered = hoveredNode && hoveredNode.id === n.id;

    // Node fill color = risk level
    let nodeColor = colors.safe;
    if (avgRisk >= 62) nodeColor = colors.danger;
    else if (avgRisk >= 37) nodeColor = colors.amber;

    // Critical or high-mule pulsing halo
    if (avgRisk >= 62 || (n.stats && n.stats.connected_senders && n.stats.connected_senders.length >= 3)) {
      const pulseRad = size + 4 + (Math.sin(radarPulseTime * 0.004) + 1) * 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, pulseRad, 0, Math.PI * 2);
      ctx.strokeStyle = avgRisk >= 62 ? colors.dangerGlow : colors.amberGlow;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    // Selection or Hover Glow
    if (isSelected || isHovered) {
      ctx.strokeStyle = isSelected ? colors.amber : "#FFFFFF";
      ctx.lineWidth = 2.0;
      const bracketR = size + 7;
      ctx.beginPath();
      ctx.arc(p.x, p.y, bracketR, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? colors.amberGlow : "rgba(255, 255, 255, 0.2)";
      ctx.fill();
      ctx.stroke();
    }

    // Geometric Differentiation:
    if (n.type === "device") {
      const side = size * 1.7;
      const half = side / 2;
      ctx.beginPath();
      ctx.roundRect(p.x - half, p.y - half, side, side, 4);
      ctx.fillStyle = nodeColor;
      ctx.fill();
      ctx.strokeStyle = isSelected ? "#FFFFFF" : colors.amber;
      ctx.lineWidth = isSelected ? 2.2 : 1.5;
      ctx.stroke();

      ctx.fillStyle = "#0A101C";
      ctx.font = `bold ${Math.max(8, Math.round(size * 0.9))}px var(--mono)`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("D", p.x, p.y + 0.5);
      ctx.textBaseline = "alphabetic";
    } else if (n.type === "receiver") {
      const rS = size * 1.25;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - rS);
      ctx.lineTo(p.x + rS, p.y);
      ctx.lineTo(p.x, p.y + rS);
      ctx.lineTo(p.x - rS, p.y);
      ctx.closePath();
      ctx.fillStyle = nodeColor;
      ctx.fill();
      ctx.strokeStyle = isSelected ? "#FFFFFF" : colors.danger;
      ctx.lineWidth = isSelected ? 2.2 : 1.5;
      ctx.stroke();

      ctx.fillStyle = "#FFFFFF";
      ctx.font = `bold ${Math.max(8, Math.round(size * 0.85))}px var(--mono)`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("R", p.x, p.y + 0.5);
      ctx.textBaseline = "alphabetic";
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fillStyle = nodeColor;
      ctx.fill();
      ctx.strokeStyle = isSelected ? "#FFFFFF" : (colors.isLight ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.4)");
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    // High-Readability Anti-Aliased Label with Background Pill
    const shouldLabel = nTotal <= 24 || isSelected || isHovered || avgRisk >= 62 || n.type !== "user";
    if (shouldLabel) {
      const displayId = n.id.length > 9 ? n.id.substring(0, 7) + ".." : n.id;
      ctx.font = isSelected ? "bold 10px var(--mono)" : "bold 9px var(--mono)";
      ctx.textAlign = "center";
      const textWidth = ctx.measureText(displayId).width + 8;
      const textY = p.y - size - 6;

      ctx.fillStyle = colors.isLight ? "rgba(255, 255, 255, 0.92)" : "rgba(10, 16, 28, 0.88)";
      ctx.strokeStyle = isSelected ? colors.amber : (colors.isLight ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.15)");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(p.x - textWidth / 2, textY - 9, textWidth, 13, 3);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isSelected ? colors.amber : colors.textColor;
      ctx.fillText(displayId, p.x, textY + 1);
    }
  });

  // Floating Tactical HUD Tooltip on Hover
  if (hoveredNode) {
    const p = nodesMap[hoveredNode.id];
    if (p) {
      const vol = hoveredNode.stats ? fmtAmt(hoveredNode.stats.total_volume) : '₹0';
      const risk = hoveredNode.stats ? hoveredNode.stats.avg_risk_score : 0;
      const role = (hoveredNode.type || 'entity').toUpperCase();
      const sendersCount = hoveredNode.stats && hoveredNode.stats.connected_senders ? hoveredNode.stats.connected_senders.length : 0;
      const peerStr = sendersCount > 0 ? ` · ${sendersCount} senders` : '';
      const tipText = `${role}: ${hoveredNode.id} · Risk ${risk} · ${vol}${peerStr}`;
      
      ctx.font = "10px var(--mono)";
      const tipWidth = ctx.measureText(tipText).width + 20;
      const tipX = Math.min(W - tipWidth - 10, Math.max(10, p.x - tipWidth / 2));
      const tipY = p.y - 28 < 30 ? p.y + 26 : p.y - 28;

      ctx.fillStyle = colors.isLight ? "rgba(255, 255, 255, 0.96)" : "rgba(10, 16, 28, 0.95)";
      ctx.strokeStyle = colors.amber;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(tipX, tipY - 14, tipWidth, 22, 5);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = colors.isLight ? "#0F172A" : "#F8FAFC";
      ctx.textAlign = "left";
      ctx.fillText(tipText, tipX + 10, tipY + 1);
    }
  }

  ctx.restore();
}

const radarCanvas = document.getElementById("radarCanvas");

// Accurate coordinate calculation helper accounting for CSS scaling & zoom/pan
function getRadarCanvasCoords(clientX, clientY) {
  const rect = radarCanvas.getBoundingClientRect();
  const W = Number(radarCanvas.dataset.logicalDim || 580);
  const H = W;
  const scaleX = W / rect.width;
  const scaleY = H / rect.height;
  const xCanvas = (clientX - rect.left) * scaleX;
  const yCanvas = (clientY - rect.top) * scaleY;

  const cx = W / 2, cy = H / 2;
  const x = (xCanvas - cx - panOffset.x) / zoom + cx;
  const y = (yCanvas - cy - panOffset.y) / zoom + cy;
  return { x, y, xCanvas, yCanvas };
}

radarCanvas.addEventListener("mousemove", (e) => {
  if (!lastRadarData) return;
  const { x, y } = getRadarCanvasCoords(e.clientX, e.clientY);

  if (draggedNode) {
    draggedNode.x = x;
    draggedNode.y = y;
    if (!animationFrameId) renderRadarFrame();
    return;
  }

  if (isDragging) {
    panOffset.x = e.clientX - startDrag.x;
    panOffset.y = e.clientY - startDrag.y;
    if (!animationFrameId) renderRadarFrame();
    return;
  }

  // Hover detection over all nodes
  let closest = null;
  let minD = Infinity;
  for (let n of nodesList) {
    const p = nodesMap[n.id];
    if (!p) continue;
    const vol = (n.stats && n.stats.total_volume) ? n.stats.total_volume : (n.size * 1200);
    const size = Math.max(5, Math.min(15, 5 + Math.sqrt(vol / 4000) * 1.5));
    const dist = Math.sqrt((p.x - x)**2 + (p.y - y)**2);
    if (dist <= Math.max(size + 8, 16) && dist < minD) {
      minD = dist;
      closest = n;
    }
  }

  if (hoveredNode !== closest) {
    hoveredNode = closest;
    radarCanvas.style.cursor = closest ? "pointer" : "crosshair";
    if (!animationFrameId) renderRadarFrame();
  }
});

radarCanvas.addEventListener("mouseleave", () => {
  if (hoveredNode) {
    hoveredNode = null;
    if (!animationFrameId) renderRadarFrame();
  }
});

radarCanvas.addEventListener("mousedown", (e) => {
  if (!lastRadarData) return;
  mouseDownPos = { x: e.clientX, y: e.clientY };
  const { x, y } = getRadarCanvasCoords(e.clientX, e.clientY);

  let clickedId = null;
  nodesList.forEach(n => {
    const p = nodesMap[n.id];
    if (!p) return;
    const vol = (n.stats && n.stats.total_volume) ? n.stats.total_volume : (n.size * 1200);
    const size = Math.max(5, Math.min(15, 5 + Math.sqrt(vol / 4000) * 1.5));
    const dist = Math.sqrt((p.x - x)**2 + (p.y - y)**2);
    if (dist <= Math.max(size + 8, 16)) {
      clickedId = n.id;
    }
  });

  if (clickedId) {
    draggedNode = nodesMap[clickedId];
    draggedNode.id = clickedId;
    radarCanvas.style.cursor = "grabbing";
  } else {
    draggedNode = null;
    isDragging = true;
    startDrag = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
    radarCanvas.style.cursor = "grabbing";
  }
});

window.addEventListener("mouseup", () => {
  draggedNode = null;
  isDragging = false;
  radarCanvas.style.cursor = hoveredNode ? "pointer" : "crosshair";
});

radarCanvas.addEventListener("wheel", (e) => {
  if (!lastRadarData) return;
  e.preventDefault();
  const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
  zoom = Math.max(0.3, Math.min(5.0, zoom * zoomFactor));
  if (!animationFrameId) renderRadarFrame();
});

document.getElementById("radarZoomInBtn")?.addEventListener("click", () => {
  if (!lastRadarData) return;
  zoom = Math.min(5.0, zoom * 1.2);
  if (!animationFrameId) renderRadarFrame();
});

document.getElementById("radarZoomOutBtn")?.addEventListener("click", () => {
  if (!lastRadarData) return;
  zoom = Math.max(0.3, zoom / 1.2);
  if (!animationFrameId) renderRadarFrame();
});

document.getElementById("radarZoomResetBtn")?.addEventListener("click", () => {
  if (!lastRadarData) return;
  zoom = 1.0;
  panOffset = { x: 0, y: 0 };
  if (!animationFrameId) renderRadarFrame();
});

// Interactive entity click handler
radarCanvas.addEventListener("click", (evt) => {
  if (!lastRadarData) return;
  // Ignore click if mouse moved more than 5px (was dragging/panning)
  if (Math.abs(evt.clientX - mouseDownPos.x) > 6 || Math.abs(evt.clientY - mouseDownPos.y) > 6) {
    return;
  }

  const { x, y } = getRadarCanvasCoords(evt.clientX, evt.clientY);

  let clickedNode = null;
  let minD = Infinity;
  nodesList.forEach(n => {
    const p = nodesMap[n.id];
    if (!p) return;
    const vol = (n.stats && n.stats.total_volume) ? n.stats.total_volume : (n.size * 1200);
    const size = Math.max(5, Math.min(15, 5 + Math.sqrt(vol / 4000) * 1.5));
    const dist = Math.sqrt((p.x - x)**2 + (p.y - y)**2);
    if (dist <= Math.max(size + 10, 18) && dist < minD) {
      minD = dist;
      clickedNode = n;
    }
  });

  if (clickedNode) {
    selectedNodeId = clickedNode.id;
    switchRadarSideTab("entity");
    loadNodeDetails(clickedNode.id);
    renderRadarFrame();
  }
});

async function loadNodeDetails(nodeId) {
  selectedNodeId = nodeId;
  switchRadarSideTab("entity");
  if (!animationFrameId) renderRadarFrame();

  const detailPanel = document.getElementById("radarNodeDetail");
  detailPanel.innerHTML = `<span style="font-family:var(--mono); color:var(--muted); font-size:12px;">Loading node ${nodeId} detail...</span>`;
  
  try {
    const res = await safeFetch(`${API}/api/network/node/${nodeId}`);
    const details = await res.json();
    
    const nodeData = nodesList.find(n => n.id === nodeId);
    const stats = nodeData?.stats || { total_txns: 0, total_volume: 0, avg_risk_score: 0, first_seen: '', last_seen: '', connected_senders: [] };
    
    const conLinks = details.connected_node_ids.map(cId => `
      <a href="#" style="color:var(--amber); text-decoration:none; margin-right:8px; font-family:var(--mono);" onclick="loadNodeDetails('${cId}'); return false;">${cId}</a>
    `).join("");

    const hasCluster = details.cluster_ids && details.cluster_ids.length > 0;
    const clusterHtml = hasCluster ? `
      <div style="margin-top:12px; padding:10px; border:1px solid var(--amber-dim); background:rgba(255,180,84,0.05); border-radius:8px;">
        <span style="font-size:11px; color:var(--muted); font-family:var(--mono);">Cluster Member: <b>${details.cluster_ids.join(', ')}</b></span>
        <div style="display:flex; gap:6px; margin-top:8px;">
          <button class="btn primary" style="flex:1; font-size:11px; padding:4px 8px;" onclick="selectIncident('${details.cluster_ids[0]}'); switchRadarSideTab('incident');">Focus Incident Intelligence</button>
          <button class="btn" style="flex:1; font-size:11px; padding:4px 8px;" onclick="explainRadarCluster('${details.cluster_ids[0]}')">AI Analysis</button>
        </div>
        <div id="radarClusterExplain" style="margin-top:8px; display:none; font-size:11.5px; font-family:var(--body); line-height:1.5;"></div>
      </div>
    ` : '';

    detailPanel.innerHTML = `
      <div style="font-family:var(--mono); font-size:12px;">
        <span style="font-size:10px; color:var(--muted); text-transform:uppercase;">Entity</span>
        <h3 style="font-family:var(--display); font-size:16px; color:var(--amber); margin-bottom:10px;">${nodeId}</h3>
        <p><b>Role</b>: <span class="badge ${stats.avg_risk_score >= 62 ? 'BLOCK_AND_REVIEW' : 'ALLOW'}">${details.role.toUpperCase()}</span></p>
        <p><b>Txn Count</b>: ${stats.total_txns}</p>
        <p><b>Total Volume</b>: ${fmtAmt(stats.total_volume)}</p>
        <p><b>Avg Risk Score</b>: <b style="color:${riskColor(stats.avg_risk_score)}">${stats.avg_risk_score}</b></p>
        <p style="font-size:11px; color:var(--muted); margin-top:6px;">First: ${stats.first_seen ? new Date(stats.first_seen).toLocaleString() : 'N/A'}</p>
        <p style="font-size:11px; color:var(--muted);">Last: ${stats.last_seen ? new Date(stats.last_seen).toLocaleString() : 'N/A'}</p>
        
        <div style="margin-top:12px;">
          <b>Connections (${details.connected_node_ids.length})</b>:<br>${conLinks || 'None'}
        </div>

        ${clusterHtml}

        <div style="margin-top:14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-size:10.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em;">Transaction Volume Velocity</span>
            <span style="font-size:10.5px; font-family:var(--mono); color:var(--amber); font-weight:600;">${details.transactions?.length || 0} Events</span>
          </div>
          <div style="height:130px; position:relative; background:var(--panel-2); border:1px solid var(--line); border-radius:8px; padding:8px 8px 4px 8px;">
            <canvas id="nodeVolumeChart"></canvas>
          </div>
        </div>

        <button class="btn" style="width:100%; margin-top:12px;" onclick="filterFeedToNode('${nodeId}')">Filter Live Feed Transactions</button>
      </div>
    `;
    
    renderNodeVolumeChart(details.transactions);

  } catch (err) {
    detailPanel.innerHTML = `<div style="color:var(--danger)">Failed to fetch node details.</div>`;
  }
}

function renderNodeVolumeChart(txns) {
  const canvas = document.getElementById("nodeVolumeChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (nodeChartInstance) {
    nodeChartInstance.destroy();
    nodeChartInstance = null;
  }
  
  if (!txns || txns.length === 0) {
    return;
  }

  const sorted = [...txns].sort((a,b) => a.timestamp.localeCompare(b.timestamp));
  const labels = sorted.map(t => fmtTime(t.timestamp));
  const amounts = sorted.map(t => t.amount);
  
  const colors = getThemeColors();

  // Create smooth vertical gradient fill under line
  const grad = ctx.createLinearGradient(0, 0, 0, 120);
  grad.addColorStop(0, colors.isLight ? "rgba(217, 119, 6, 0.28)" : "rgba(255, 180, 84, 0.32)");
  grad.addColorStop(1, colors.isLight ? "rgba(217, 119, 6, 0.01)" : "rgba(255, 180, 84, 0.01)");

  nodeChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Volume (₹)',
        data: amounts,
        borderColor: colors.amber,
        borderWidth: 2.5,
        backgroundColor: grad,
        fill: true,
        tension: 0.38,
        pointRadius: sorted.length <= 15 ? 4 : 2.5,
        pointHoverRadius: 6,
        pointBackgroundColor: colors.amber,
        pointBorderColor: colors.isLight ? "#FFFFFF" : "#0A101C",
        pointBorderWidth: 1.5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: colors.isLight ? "rgba(255, 255, 255, 0.95)" : "rgba(10, 16, 28, 0.95)",
          titleColor: colors.isLight ? "#1E293B" : "#F1F5F9",
          bodyColor: colors.amber,
          borderColor: colors.cardBorder,
          borderWidth: 1,
          padding: 8,
          boxPadding: 4,
          titleFont: { family: 'JetBrains Mono, monospace', size: 10 },
          bodyFont: { family: 'JetBrains Mono, monospace', size: 11, weight: 'bold' },
          callbacks: {
            label: (item) => `Amount: ₹${Number(item.raw).toLocaleString('en-IN')}`
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: colors.textColor,
            maxTicksLimit: 5,
            font: { family: 'JetBrains Mono, monospace', size: 9.5 }
          },
          grid: { display: false }
        },
        y: {
          ticks: {
            color: colors.textColor,
            maxTicksLimit: 4,
            font: { family: 'JetBrains Mono, monospace', size: 9.5 },
            callback: (val) => {
              if (val >= 100000) return '₹' + (val / 100000).toFixed(1) + 'L';
              if (val >= 1000) return '₹' + (val / 1000).toFixed(0) + 'k';
              return '₹' + val;
            }
          },
          grid: { color: colors.gridColor }
        }
      }
    }
  });
}

function filterFeedToNode(nodeId) {
  sharedFilterNodeId = nodeId;
  document.querySelector('.nav-item[data-view="feed"]').click();
  renderFeedTable();
}

async function explainRadarCluster(clusterId) {
  const container = document.getElementById("radarClusterExplain");
  container.style.display = "block";
  container.className = "reasoning-loading";
  container.textContent = "Analyzing cluster pattern...";

  try {
    const res = await fetch("/api/agent/explain-cluster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cluster_id: clusterId })
    });
    const data = await res.json();
    container.className = "reasoning-box";
    container.innerHTML = `${data.answer}<span class="src">${data.source === 'llm' ? 'Grounded AI Explainer' : 'Template explanation'}</span>`;
  } catch (err) {
    container.className = "panel-error";
    container.textContent = "Error fetching cluster analysis.";
  }
}

function renderTopologies(clusters) {
  const list = document.getElementById("detectedTopologiesList");
  if (!clusters || clusters.length === 0) {
    list.innerHTML = `<div class="empty">No topologies detected yet. Run live feed.</div>`;
    return;
  }

  list.innerHTML = clusters.map(c => `
    <div class="topology-row" style="padding:10px 12px; border-bottom:1px solid var(--line); display:flex; align-items:center; justify-content:space-between; gap:12px; cursor:pointer;" onclick="selectIncident('${c.incident_id || c.cluster_id}')">
      <div style="flex:1;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px; flex-wrap:wrap;">
          <span style="font-family:var(--mono); font-size:10.5px; font-weight:700; background:rgba(255,180,84,0.18); color:var(--amber); border:1px solid var(--amber); padding:2px 6px; border-radius:4px;">${c.incident_id || c.cluster_id}</span>
          <b style="font-size:12px;">${c.cluster_id}</b>
          <span style="font-size:11.5px; color:var(--muted);">· ${c.sender_count} senders · ${c.shared_entity_type} <b style="color:var(--amber);">${c.shared_entity_id}</b></span>
        </div>
        <div style="font-size:11px; color:var(--muted); font-family:var(--mono);">
          Exposure: <b style="color:var(--text);">${fmtAmt(c.total_volume_inr)}</b> · Avg Risk: <b style="color:${riskColor(c.avg_risk_score)}">${c.avg_risk_score}</b> · Window: ${c.window_minutes}m
        </div>
      </div>
      <div style="display:flex; gap:6px;" onclick="event.stopPropagation();">
        <button class="btn primary" style="padding:4px 8px; font-size:11px;" onclick="selectIncident('${c.incident_id || c.cluster_id}')">View Incident</button>
        <button class="btn" style="padding:4px 8px; font-size:11px;" onclick="loadNodeDetails('${c.shared_entity_id}')">Inspect</button>
      </div>
    </div>
  `).join("");
}

async function loadIncidentDetails(incidentId) {
  const panel = document.getElementById("radarIncidentPanel");
  const title = document.getElementById("incidentDetailTitle");
  const body = document.getElementById("incidentDetailBody");
  if (!panel || !body) return;

  panel.style.display = "block";
  body.innerHTML = `<span style="font-family:var(--mono); color:var(--muted); font-size:12px;">Loading incident ${incidentId} details...</span>`;
  
  try {
    const res = await fetch(`${API}/api/network/incident/${incidentId}`);
    if (!res.ok) {
      if (res.status === 404 && lastRadarData?.clusters?.length > 0) {
        const topCluster = lastRadarData.clusters[0];
        const topIncId = topCluster.incident_id || topCluster.cluster_id;
        if (topIncId && topIncId !== incidentId) {
          activeIncidentId = topIncId;
          return loadIncidentDetails(topIncId);
        }
      }
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();

    if (data.incident_id) {
      activeIncidentId = data.incident_id;
    }

    if (title) {
      title.innerHTML = `INCIDENT <span style="color:var(--amber); font-family:var(--mono);">${data.incident_id}</span>`;
    }

    const confBadgeClass = data.confidence === 'HIGH' ? 'ALLOW' : (data.confidence === 'MEDIUM' ? 'FLAG_STEPUP' : 'BLOCK_AND_REVIEW');

    // Risk drivers breakdown (Task 2)
    const driversHtml = (data.risk_drivers || []).map(d => {
      const barWidth = Math.min(100, Math.max(6, (d.points / 35) * 100));
      return `
        <div class="incident-driver-bar">
          <span style="width:175px; color:var(--text); font-size:11px;">${d.name}</span>
          <div class="incident-driver-track">
            <div class="incident-driver-fill" style="width:${barWidth}%;"></div>
          </div>
          <span style="width:42px; text-align:right; font-weight:700; color:var(--amber);">+${d.points.toFixed(0)}</span>
        </div>
      `;
    }).join("");

    // Evidence for / against bullets (Task 3)
    const evForHtml = (data.evidence_for || []).map(e => `<li><span style="color:var(--safe); font-weight:bold;">+</span> <span>${e}</span></li>`).join("");
    const evAgainstHtml = (data.evidence_against || []).map(e => `<li><span style="color:var(--muted); font-weight:bold;">−</span> <span>${e}</span></li>`).join("");

    // Timeline items (Task 5)
    const timelineHtml = (data.timeline || []).slice(0, 15).map(item => {
      const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString('en-IN', {hour12:false}) : '--:--:--';
      const isSystem = item.type === "SYSTEM_EVENT";
      return `
        <div class="timeline-item">
          <span style="color:var(--muted); width:62px;">${timeStr}</span>
          <span class="timeline-badge ${isSystem ? 'FLAG_STEPUP' : 'ALLOW'}">${isSystem ? 'SYS' : 'TXN'}</span>
          <span style="color:${isSystem ? 'var(--amber)' : 'var(--text)'}; font-weight:600; width:130px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.actor}</span>
          <span style="flex:1; color:var(--muted); text-align:right;">${item.detail}</span>
        </div>
      `;
    }).join("");

    body.innerHTML = `
      <div style="font-family:var(--mono); font-size:12px; display:flex; flex-direction:column; gap:12px;">
        <!-- Header summary metrics -->
        <div style="background:var(--panel-2); border:1px solid var(--line); border-radius:8px; padding:10px 12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div>
              Risk: <b style="color:${riskColor(data.risk_score)}; font-size:13.5px;">${data.risk_score.toFixed(0)}/100 — ${data.risk_level}</b>
            </div>
            <div>
              Confidence: <span class="badge ${confBadgeClass}">${data.confidence}</span>
            </div>
          </div>
          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; font-size:11px; color:var(--muted);">
            <div>Accounts: <b style="color:var(--text);">${data.entity_counts.accounts}</b></div>
            <div>Receivers: <b style="color:var(--text);">${data.entity_counts.receivers}</b></div>
            <div>Devices: <b style="color:var(--text);">${data.entity_counts.devices}</b></div>
            <div>Txns: <b style="color:var(--text);">${data.entity_counts.transactions}</b></div>
            <div style="grid-column:span 2;">Exposure: <b style="color:var(--amber);">${fmtAmt(data.entity_counts.total_volume_inr)}</b></div>
          </div>
          <div style="font-size:10.5px; color:var(--muted); margin-top:6px; border-top:1px solid var(--line); padding-top:4px;">
            First detected: <b>${data.first_detected ? new Date(data.first_detected).toLocaleTimeString('en-IN', {hour12:false}) : 'N/A'}</b> (${data.window_minutes}m window)
          </div>
        </div>

        <!-- Task 2: Risk Drivers Breakdown -->
        <div>
          <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--muted); margin-bottom:6px; letter-spacing:0.04em;">
            Risk Drivers Breakdown
          </div>
          ${driversHtml}
          <div style="font-size:10px; color:var(--muted); margin-top:4px;">
            Proof: ${data.risk_drivers_proof}
          </div>
        </div>

        <!-- Task 3: Cluster Evidence For / Against -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; border-top:1px solid var(--line); padding-top:10px;">
          <div>
            <span style="font-size:10.5px; font-weight:700; color:var(--safe); text-transform:uppercase;">Evidence For</span>
            <ul class="evidence-list evidence-for">
              ${evForHtml || '<li>No positive indicators</li>'}
            </ul>
          </div>
          <div>
            <span style="font-size:10.5px; font-weight:700; color:var(--muted); text-transform:uppercase;">Evidence Against</span>
            <ul class="evidence-list evidence-against">
              ${evAgainstHtml || '<li>No mitigating factors</li>'}
            </ul>
          </div>
        </div>

        <!-- Task 4: Activity vs. Baseline Rate -->
        <div style="border-top:1px solid var(--line); padding-top:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-size:10.5px; font-weight:700; color:var(--muted); text-transform:uppercase;">Activity Rate vs. Baseline</span>
            <span style="font-size:11px; font-weight:700; color:${data.activity_rate.deviation_pct > 0 ? 'var(--danger)' : 'var(--safe)'};">
              ${data.activity_rate.deviation_pct > 0 ? '+' : ''}${data.activity_rate.deviation_pct}% deviation
            </span>
          </div>
          <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:6px; background:var(--panel-2); padding:6px 10px; border-radius:6px;">
            <span>Current: <b style="color:var(--amber);">${data.activity_rate.current_rate_per_min} tx/min</b></span>
            <span>Baseline: <b style="color:var(--text);">${data.activity_rate.baseline_rate_per_min} tx/min</b></span>
          </div>
          <div style="height:60px; position:relative;">
            <canvas id="incidentActivityChart"></canvas>
          </div>
        </div>

        <!-- Task 5: Event Timeline -->
        <div style="border-top:1px solid var(--line); padding-top:10px;">
          <div style="font-size:10.5px; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:6px;">
            Incident Event Timeline (Chronological)
          </div>
          <div style="max-height:160px; overflow-y:auto; background:var(--panel-2); border:1px solid var(--line); border-radius:6px; padding:6px 8px;">
            ${timelineHtml || '<div class="empty">No events found.</div>'}
          </div>
        </div>
      </div>
    `;

    renderIncidentActivityChart(data.activity_rate);

  } catch (err) {
    body.innerHTML = `<div style="color:var(--danger)">Failed to load incident detail: ${err.message}</div>`;
  }
}

function renderIncidentActivityChart(rateData) {
  const canvas = document.getElementById("incidentActivityChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (incidentActivityChartInstance) {
    incidentActivityChartInstance.destroy();
    incidentActivityChartInstance = null;
  }

  const colors = getThemeColors();

  incidentActivityChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Baseline Rate', 'Burst Rate'],
      datasets: [{
        data: [rateData.baseline_rate_per_min, rateData.current_rate_per_min],
        backgroundColor: [colors.safeGlow, colors.amberGlow],
        borderColor: [colors.safe, colors.amber],
        borderWidth: 1.5,
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: colors.isLight ? "rgba(255, 255, 255, 0.95)" : "rgba(10, 16, 28, 0.95)",
          titleColor: colors.isLight ? "#1E293B" : "#F1F5F9",
          bodyColor: colors.textColor,
          borderColor: colors.cardBorder,
          borderWidth: 1,
          padding: 6,
          titleFont: { family: 'JetBrains Mono, monospace', size: 10 },
          bodyFont: { family: 'JetBrains Mono, monospace', size: 10 },
          callbacks: {
            label: (item) => `Rate: ${item.raw} tx/min`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: colors.textColor, font: { family: 'JetBrains Mono, monospace', size: 9 } },
          grid: { color: colors.gridColor }
        },
        y: {
          ticks: { color: colors.textColor, font: { family: 'JetBrains Mono, monospace', size: 9.5 } },
          grid: { display: false }
        }
      }
    }
  });
}


// ---------------- evidence ----------------
function refreshEvidenceDropdown(){
  const sel = document.getElementById("evidenceSelect");
  const current = sel.value;
  const flagged = recentTxns.filter(t => t.decision && t.decision !== "ALLOW").slice(0, 25);
  sel.innerHTML = `<option value="">— select a recent transaction —</option>` +
    flagged.map(t => `<option value="${t.id}">${t.id} · ${fmtAmt(t.amount)} · risk ${t.risk_score}</option>`).join("");
  if(current) sel.value = current;
}

document.getElementById("generateEvidenceBtn").addEventListener("click", async ()=>{
  const id = document.getElementById("evidenceSelect").value;
  const out = document.getElementById("evidenceOutput");
  if(!id){ out.innerHTML = `<div class="empty">Select a transaction first.</div>`; return; }
  
  const generateBtn = document.getElementById("generateEvidenceBtn");
  generateBtn.disabled = true;
  generateBtn.textContent = "Generating...";

  try {
    const res = await safeFetch(`${API}/api/evidence/${id}`);
    const p = await res.json();
    out.innerHTML = `
      <div class="packet">
        <div style="font-family:var(--mono); color:var(--muted); font-size:11px;">Generated ${new Date(p.generated_at).toLocaleString()}</div>
        <h4>Transaction</h4>
        ${p.transaction_id} · ${fmtAmt(p.amount_inr)} · authorized at risk score ${p.risk_score_at_authorization} (${p.model_decision_at_authorization.replace(/_/g,' ')})
        <h4>Sender History</h4>
        ${p.sender_history_summary.prior_transactions_reviewed} prior transactions reviewed
        ${p.sender_history_summary.prior_clean_rate_pct !== null ? `, ${p.sender_history_summary.prior_clean_rate_pct}% clean rate` : ''}
        <h4>Supporting Evidence for Merchant</h4>
        <ul>${p.supporting_evidence_for_merchant.map(x=>`<li>${x}</li>`).join('')}</ul>
        <h4>Risk Factors Disclosed</h4>
        <ul>${p.risk_factors_disclosed.map(x=>`<li>${x}</li>`).join('')}</ul>
        <h4>Recommended Action</h4>
        <div class="rec">${p.recommended_action}</div>
        <div class="disclaimer">${p.disclaimer}</div>
      </div>
    `;
  } catch (err) {
    out.innerHTML = `<div class="empty" style="color:var(--danger)">Failed to generate evidence packet.</div>`;
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "Generate Evidence Packet";
  }
});

// ---------------- audit ----------------
document.getElementById("refreshAuditBtn").addEventListener("click", loadAudit);
async function loadAudit(){
  const res = await safeFetch(`${API}/api/audit?limit=60`);
  if (!res.ok) return;
  const rows = await res.json();
  document.getElementById("auditBody").innerHTML = rows.map(r=>`
    <tr><td>${new Date(r.ts).toLocaleString()}</td><td class="ev">${sanitize(r.event)}</td><td>${sanitize(r.detail)}</td></tr>
  `).join("") || `<tr><td colspan="3" class="empty">No events yet.</td></tr>`;
  
  renderAuditFreqChart(rows);
}

function renderAuditFreqChart(rows) {
  const canvas = document.getElementById("auditFreqChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (auditChartInstance) {
    auditChartInstance.destroy();
    auditChartInstance = null;
  }
  
  const counts = {};
  rows.forEach(r => { counts[r.event] = (counts[r.event] || 0) + 1; });
  
  const colors = getThemeColors();

  auditChartInstance = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: Object.keys(counts),
      datasets: [{
        data: Object.values(counts),
        backgroundColor: [
          'rgba(255, 180, 84, 0.75)',
          'rgba(61, 220, 151, 0.75)',
          'rgba(255, 77, 109, 0.75)',
          'rgba(255, 209, 102, 0.75)',
          'rgba(141, 154, 179, 0.75)'
        ],
        borderWidth: 1.5,
        borderColor: colors.isLight ? '#FFFFFF' : '#0F172A'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: colors.textColor,
            font: { size: 9.5, family: 'JetBrains Mono, monospace' }
          }
        }
      }
    }
  });
}

// ---------------- investigator chatbot frontend ----------------
const agentInput = document.getElementById("agentInput");
const agentSendBtn = document.getElementById("agentSendBtn");
const agentChatHistory = document.getElementById("agentChatHistory");

agentSendBtn.addEventListener("click", sendAgentMessage);
agentInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendAgentMessage();
});

async function sendAgentMessage() {
  const text = agentInput.value.trim();
  if (!text) return;
  
  agentInput.value = "";
  agentSendBtn.disabled = true;
  
  const userDiv = document.createElement("div");
  userDiv.className = "chat-msg user";
  userDiv.textContent = text;
  agentChatHistory.appendChild(userDiv);
  agentChatHistory.scrollTop = agentChatHistory.scrollHeight;

  const agentDiv = document.createElement("div");
  agentDiv.className = "chat-msg agent";
  agentDiv.innerHTML = `<span>Thinking...</span>`;
  agentChatHistory.appendChild(agentDiv);
  agentChatHistory.scrollTop = agentChatHistory.scrollHeight;

  try {
    const res = await fetch("/api/agent/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: text })
    });
    const data = await res.json();
    
    const srcText = data.source === 'llm' ? 'Grounded AI Explainer' : 'Template Fallback';
    const factsJSON = JSON.stringify(data.facts_used, null, 2);
    
    agentDiv.innerHTML = `
      <span>${data.answer}</span>
      <span class="src">source: ${srcText}</span>
      <details>
        <summary>Facts Used</summary>
        <pre><code>${factsJSON}</code></pre>
      </details>
    `;
  } catch (err) {
    agentDiv.innerHTML = `<span style="color:var(--danger)">Error querying investigator assistant.</span>`;
  } finally {
    agentSendBtn.disabled = false;
    agentChatHistory.scrollTop = agentChatHistory.scrollHeight;
  }
}

// ---------------- settings config ----------------
async function loadSettingsStatus() {
  try {
    const res = await fetch("/api/config/status");
    if (!res.ok) return;
    const status = await res.json();
    
    updateBadge("geminiStatusBadge", status.gemini_active);
    updateBadge("groqStatusBadge", status.groq_active);
    updateBadge("anthropicStatusBadge", status.anthropic_active);
  } catch (err) {
    console.error("Failed to load settings status", err);
  }
}

function updateBadge(id, active) {
  const badge = document.getElementById(id);
  if (!badge) return;
  if (active) {
    badge.className = "badge ALLOW";
    badge.textContent = "Active / Loaded";
    badge.style.background = "rgba(61,220,151,0.15)";
    badge.style.color = "var(--safe)";
  } else {
    badge.className = "badge BLOCK_AND_REVIEW";
    badge.textContent = "Not Configured";
    badge.style.background = "rgba(255,77,109,0.15)";
    badge.style.color = "var(--danger)";
  }
}

document.getElementById("saveKeysBtn").addEventListener("click", async () => {
  const gemini = document.getElementById("cfgGeminiKey").value.trim();
  const groq = document.getElementById("cfgGroqKey").value.trim();
  const resultDiv = document.getElementById("cfgSaveResult");
  const btn = document.getElementById("saveKeysBtn");

  btn.disabled = true;
  btn.textContent = "Applying...";
  resultDiv.style.display = "none";

  const payload = {};
  if (gemini) payload.gemini_key = gemini;
  if (groq) payload.groq_key = groq;

  try {
    const res = await fetch("/api/config/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const status = await res.json();

    updateBadge("geminiStatusBadge", status.gemini_active);
    updateBadge("groqStatusBadge", status.groq_active);
    updateBadge("anthropicStatusBadge", status.anthropic_active);

    resultDiv.style.display = "block";
    resultDiv.style.color = "var(--safe)";
    resultDiv.textContent = "✓ Keys successfully updated in server memory!";
    
    document.getElementById("cfgGeminiKey").value = "";
    document.getElementById("cfgGroqKey").value = "";
  } catch (err) {
    resultDiv.style.display = "block";
    resultDiv.style.color = "var(--danger)";
    resultDiv.textContent = "✗ Failed to update keys: " + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Save & Apply Keys";
  }
});

document.getElementById("resetSimBtn").addEventListener("click", async () => {
  if (!confirm("Are you sure you want to clear all simulation database records and start fresh?")) return;
  
  const btn = document.getElementById("resetSimBtn");
  btn.disabled = true;
  btn.textContent = "Clearing...";

  try {
    const res = await fetch("/api/db/reset", { method: "POST" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    
    stats.scored = 0;
    stats.blocked = 0;
    stats.stepup = 0;
    stats.allowed = 0;
    document.getElementById("statScored").textContent = "0";
    document.getElementById("statBlocked").textContent = "0";
    document.getElementById("statStepup").textContent = "0";
    document.getElementById("statAllowed").textContent = "0";

    recentTxns.length = 0;
    sharedFilterNodeId = null;
    
    liveRiskBins.fill(0);
    if (liveRiskChartInstance) {
      liveRiskChartInstance.data.datasets[0].data = liveRiskBins;
      liveRiskChartInstance.update();
    }

    lastRadarData = null;
    nodesList = [];
    edgesList = [];
    nodesMap = {};
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    const canvas = document.getElementById("radarCanvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    document.getElementById("detectedTopologiesList").innerHTML = `<div class="empty">No topologies detected yet. Run live feed.</div>`;
    document.getElementById("radarNodeDetail").innerHTML = `<div class="empty">Click a node in the network to inspect detailed stats.</div>`;

    renderFeedTable();
    refreshEvidenceDropdown();
    
    loadMetrics();
    updateAiStatus();
    
    alert("Simulation database records successfully cleared! Ready to start a new simulation.");
  } catch (err) {
    alert("Failed to reset database: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Clear Data";
  }
});

// ---------------- AI KILL-SWITCH VISIBILITY ----------------
async function updateAiStatus() {
  try {
    const res = await fetch(`${API}/api/health`);
    if (res.ok) {
      const data = await res.json();
      const statusText = data.ai_explanations || "TEMPLATE FALLBACK (no provider configured)";
      const pillText = document.getElementById("aiStatusText");
      const pillDot = document.getElementById("aiStatusDot");
      if (pillText) pillText.textContent = "AI Explanations: " + statusText;
      if (pillDot) {
        if (statusText.startsWith("LIVE")) {
          pillDot.style.background = "var(--safe)";
          pillDot.style.boxShadow = "0 0 8px rgba(61,220,151,0.6)";
        } else {
          pillDot.style.background = "var(--amber)";
          pillDot.style.boxShadow = "none";
        }
      }
    }
  } catch (err) { console.warn('AI status check failed:', err); }
}

// ---------------- THRESHOLD / COST SIMULATOR ----------------
const simThInput = document.getElementById("simThreshold");
if (simThInput) {
  simThInput.addEventListener("input", () => {
    const th = Number(simThInput.value);
    const out = document.getElementById("simThresholdOut");
    if (out) out.textContent = th.toFixed(1);
    clearTimeout(simDebounce);
    simDebounce = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/api/metrics/at_threshold?threshold=${th}`);
        if (res.ok) {
          const m = await res.json();
          document.getElementById("metricCards").innerHTML = `
            <div class="metric-card"><div class="big">${(m.precision*100).toFixed(1)}%</div><div class="lbl">Precision</div><div class="sub">of flagged, actually fraud</div></div>
            <div class="metric-card"><div class="big">${(m.recall*100).toFixed(1)}%</div><div class="lbl">Recall</div><div class="sub">of fraud, successfully caught</div></div>
            <div class="metric-card"><div class="big">${(m.f1*100).toFixed(1)}%</div><div class="lbl">F1 Score</div><div class="sub">precision/recall balance</div></div>
            <div class="metric-card"><div class="big">${(m.false_positive_rate*100).toFixed(2)}%</div><div class="lbl">False Positive Rate</div><div class="sub">clean txns wrongly flagged</div></div>
          `;
          const cm = m.confusion_matrix;
          document.getElementById("cmGrid").innerHTML = `
            <div class="cm-cell cm-tp" style="cursor:pointer;" onclick="loadCmTransactions('tp')"><div class="n">${cm.tp}</div><div class="l">True Positive</div></div>
            <div class="cm-cell cm-fp" style="cursor:pointer;" onclick="loadCmTransactions('fp')"><div class="n">${cm.fp}</div><div class="l">False Positive</div></div>
            <div class="cm-cell cm-fn" style="cursor:pointer;" onclick="loadCmTransactions('fn')"><div class="n">${cm.fn}</div><div class="l">False Negative</div></div>
            <div class="cm-cell cm-tn" style="cursor:pointer;" onclick="loadCmTransactions('tn')"><div class="n">${cm.tn}</div><div class="l">True Negative</div></div>
          `;
          renderCostTable(m.cost_model);
        }
      } catch (err) { console.warn('Threshold simulation failed:', err); }
    }, 120);
  });
}

// ---------------- DEEP INSPECTION ACTIONS (FUSION / COUNTERFACTUAL / REPLAY) ----------------
const depthPanel = document.getElementById("depthOutputPanel");

document.getElementById("inspectFusionBtn")?.addEventListener("click", async () => {
  const id = document.getElementById("evidenceSelect").value;
  if (!id) { alert("Please select a transaction first from the dropdown"); return; }
  depthPanel.style.display = "block";
  depthPanel.innerHTML = "Computing linear fusion breakdown...";
  try {
    const res = await fetch(`${API}/api/fusion/${id}`);
    const data = await res.json();
    depthPanel.innerHTML = `
      <div style="color:var(--amber); font-weight:600; margin-bottom:6px;">RISK FUSION ARITHMETIC DEBUGGER · ${data.transaction_id}</div>
      <table style="width:100%; border-collapse:collapse; margin-bottom:8px;">
        ${data.breakdown.map(b => `<tr><td style="padding:2px 6px;">${b.signal}</td><td style="padding:2px 6px;">${b.raw_value.toFixed(1)} × weight ${b.weight}</td><td style="padding:2px 6px; text-align:right;">= ${b.contribution.toFixed(2)}</td></tr>`).join("")}
      </table>
      <div style="border-top:1px solid var(--line); padding-top:6px; display:flex; justify-content:space-between;">
        <span>Fused Linear Score: <b>${data.fused_score_before_guardrail}</b></span>
        <span>Guardrail: <b>${data.guardrail_applied || "none"}</b></span>
        <span>Final Risk: <b>${data.final_risk_score}</b></span>
      </div>
      <div style="color:var(--muted); font-size:11px; margin-top:4px;">Arithmetic Proof: ${data.arithmetic_proof}</div>
    `;
  } catch (err) {
    depthPanel.innerHTML = `<span style="color:var(--danger)">Error: ${err.message}</span>`;
  }
});

document.getElementById("counterfactualBtn")?.addEventListener("click", async () => {
  const id = document.getElementById("evidenceSelect").value;
  if (!id) { alert("Please select a transaction first from the dropdown"); return; }
  depthPanel.style.display = "block";
  depthPanel.innerHTML = "Evaluating counterfactual waterfall...";
  try {
    const res = await fetch(`${API}/api/counterfactual/${id}`);
    const data = await res.json();
    depthPanel.innerHTML = `
      <div style="color:var(--safe); font-weight:600; margin-bottom:6px;">COUNTERFACTUAL WHAT-IF ANALYSIS · ${data.transaction_id}</div>
      <div style="margin-bottom:8px;">Current Risk: <b>${data.current_risk} (${data.current_decision})</b></div>
      <div style="margin-bottom:8px;"><b>Sequential Signal Neutralization (Waterfall):</b></div>
      <ul style="padding-left:18px; margin-bottom:8px;">
        ${data.waterfall.map(w => `<li>${w.description}: <b>${w.from_score} → ${w.to_score}</b> (${w.to_decision})</li>`).join("")}
      </ul>
      <div style="border-top:1px solid var(--line); padding-top:6px; color:var(--safe)">
        Resulting Shift: <b>${data.resulting_decision}</b> (Baseline Neutralized Score: ${data.baseline_neutralized_score})
      </div>
    `;
  } catch (err) {
    depthPanel.innerHTML = `<span style="color:var(--danger)">Error: ${err.message}</span>`;
  }
});

document.getElementById("replayBtn")?.addEventListener("click", async () => {
  const id = document.getElementById("evidenceSelect").value;
  if (!id) { alert("Please select a transaction first from the dropdown"); return; }
  depthPanel.style.display = "block";
  depthPanel.innerHTML = "Replaying decision snapshot...";
  try {
    const res = await fetch(`${API}/api/replay/${id}`);
    const data = await res.json();
    const isOk = data.reproducible === true;
    depthPanel.innerHTML = `
      <div style="font-weight:600; margin-bottom:6px;">DECISION REPLAY & REPRODUCIBILITY AUDIT · ${data.transaction_id}</div>
      <div>Original Snapshot: <b>${data.original_risk_score} (${data.original_decision})</b> · Version: ${data.original_model_version}</div>
      <div>Replayed Result: <b>${data.replayed_risk_score} (${data.replayed_decision})</b> · Version: ${data.current_model_version}</div>
      <div style="font-family:var(--mono); font-size:11px; margin-top:4px; color:var(--muted);">
        Decision Fingerprint: <b style="color:var(--amber);">${data.decision_fingerprint || data.replayed_fingerprint || 'N/A'}</b>
      </div>
      <div style="margin-top:6px; color:${isOk ? 'var(--safe)' : 'var(--danger)'};">
        Reproducibility: <b>${data.reproducible}</b> ${isOk ? '✓ (100% Bitwise Match)' : '⚠ (Version mismatch or deviation)'}
      </div>
    `;
  } catch (err) {
    depthPanel.innerHTML = `<span style="color:var(--danger)">Error: ${err.message}</span>`;
  }
});

// initial load
loadMetrics().catch(err => console.warn('Initial metrics load failed:', err));
updateAiStatus();
