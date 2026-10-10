// Indian Petrol Pump Operations Module
// Implements:
// 1. Daily RSP Price Revision (06:00 AM) & WhatsApp Broadcast
// 2. Weights & Measures (W&M) Reseal Applications & Breakdown Resealing Tracker
// 3. Monthly GST Tax Breakup & GSTR-1/GSTR-3B Excel/Print Exporter

var PRICE_REV_DATA = null;
var PRICE_REV_LOADING = false;
var PRICE_FILTER_FUEL = "all";

var WM_RESEAL_DATA = null;
var WM_RESEAL_LOADING = false;
var WM_RESEAL_FILTER_STATUS = "all";

var GST_BREAKUP_DATA = null;
var GST_BREAKUP_LOADING = false;
var GST_BREAKUP_MONTH = "";

// ========================================================
// 1. DAILY RSP PRICE REVISION & BROADCAST
// ========================================================

function loadPriceRevData(){
  if (PRICE_REV_LOADING) return;
  PRICE_REV_LOADING = true;
  var url = "/api/price-revisions?fuel_product=" + encodeURIComponent(PRICE_FILTER_FUEL);
  api("GET", url).then(function(res){
    PRICE_REV_DATA = res;
    PRICE_REV_LOADING = false;
    if (tab === "pricerev") renderPriceRevTab();
  }).catch(function(err){
    PRICE_REV_LOADING = false;
    toast(err.error || "Could not load price revisions.");
    if (tab === "pricerev") renderPriceRevTab();
  });
}

function renderPriceRevTab(){
  tab = "pricerev";
  var A = document.getElementById("app");
  if (!A) return;

  if (!SRV) {
    A.innerHTML = nav() + '<div class="empty">Price revision is managed on the server. Please log in.</div>';
    return;
  }

  if (!PRICE_REV_DATA && !PRICE_REV_LOADING) {
    A.innerHTML = nav() + '<div class="empty">Loading daily price revisions and rate broadcasts…</div>';
    loadPriceRevData();
    return;
  }

  var data = PRICE_REV_DATA || { revisions: [], broadcasts: [], current_rates: {}, stats: {} };
  var revs = data.revisions || [];
  var broadcasts = data.broadcasts || [];
  var currentRates = data.current_rates || {};
  var stats = data.stats || {};

  var h = nav();

  // Header
  h += '<div class="row" style="align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">';
  h += '<div><h1 style="margin:0">⛽ Daily 06:00 AM Price Revision & Rate Broadcast</h1><div class="sub" style="margin-top:2px">Dynamic daily Retail Selling Price (RSP) revision, underground stock inventory valuation impact, and WhatsApp transporter broadcast.</div></div>';
  h += '<div class="btns" style="margin:0;flex:none;display:flex;gap:6px">';
  if (ME && (ME.role === "owner" || ME.role === "manager")) {
    h += '<button onclick="openPriceRevisionModal()" style="display:inline-flex;align-items:center;gap:6px">+ Log Daily Price Revision</button>';
    h += '<button onclick="openBroadcastModal()" class="ghost" style="display:inline-flex;align-items:center;gap:6px">📢 WhatsApp Broadcast</button>';
  }
  h += '<button class="ghost" onclick="loadPriceRevData()" title="Refresh" style="padding:8px 12px">🔄</button>';
  h += '</div></div>';

  // KPI Metrics
  var impactVal = stats.today_inventory_impact || 0;
  h += '<div class="ops-kpi-bar noprint">';
  h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--btn)">' + (stats.today_revisions_count || 0) + '</div><div class="ops-kpi-lbl">Revisions Logged Today</div></div>';
  h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:' + (impactVal >= 0 ? 'var(--ok)' : 'var(--due)') + '">' + (impactVal >= 0 ? '+' : '') + inr(impactVal) + '</div><div class="ops-kpi-lbl">Today\'s Stock Valuation Impact</div></div>';
  h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--ok)">' + (stats.total_broadcasts_sent || 0) + '</div><div class="ops-kpi-lbl">Broadcasts Delivered</div></div>';
  h += '<div class="ops-kpi-card"><div class="ops-kpi-num">06:00 AM</div><div class="ops-kpi-lbl">Statutory Effective Time</div></div>';
  h += '</div>';

  // Active Live Rates Cards
  h += '<div style="margin-bottom:14px"><b style="font-size:14px">Active Retail Rates (Live at Dispenser Nozzles):</b></div>';
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:16px">';
  var fuels = ["Petrol (MS)", "Diesel (HSD)", "Power petrol"];
  fuels.forEach(function(f){
    var rObj = currentRates[f] || { rate: "—", from: today() };
    var icon = f.indexOf("Petrol") > -1 ? "⛽" : (f.indexOf("Diesel") > -1 ? "🚛" : "⚡");
    h += '<div class="cust" style="cursor:default;margin:0;padding:12px;border-left:4px solid var(--btn)">';
    h += '<div class="row"><span style="font-weight:700">' + icon + ' ' + esc(f) + '</span><span class="amt" style="font-size:17px;font-weight:800;color:var(--btn)">₹' + Number(rObj.rate || 0).toFixed(2) + '</span></div>';
    h += '<div class="sub" style="font-size:12px;margin-top:4px">Applies from: <b>' + (rObj.from || 'Today') + '</b> · 06:00 AM</div>';
    h += '</div>';
  });
  h += '</div>';

  // Filters & Table of Price Revision History
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">';
  h += '<b style="font-size:15px">Historical Daily Price Change Logbook</b>';
  h += '<select style="margin:0;width:auto" onchange="PRICE_FILTER_FUEL=this.value;loadPriceRevData()">';
  h += '<option value="all"' + (PRICE_FILTER_FUEL=="all"?' selected':'') + '>All Fuel Products</option>';
  fuels.forEach(function(f){
    h += '<option value="' + f + '"' + (PRICE_FILTER_FUEL==f?' selected':'') + '>' + f + '</option>';
  });
  h += '</select>';
  h += '</div>';

  if (!revs.length) {
    h += '<div class="empty">No daily price revisions recorded yet. Tap "+ Log Daily Price Revision" to enter morning RSP changes.</div>';
  } else {
    h += '<div class="ops-table-wrap"><table class="ops-table">';
    h += '<thead><tr><th>Effective Date & Time</th><th>Fuel Product</th><th class="r">Old RSP</th><th class="r">New RSP</th><th class="r">Delta / L</th><th class="r">Tank Dip Stock</th><th class="r">Inventory Valuation Impact</th><th>OMC Notice Ref</th><th>Revised By</th><th>Notes</th></tr></thead><tbody>';
    revs.forEach(function(r){
      var chg = Number(r.change_amount || 0);
      var chgStr = (chg >= 0 ? "+" : "") + "₹" + chg.toFixed(2);
      var chgColor = chg > 0 ? "var(--ok)" : (chg < 0 ? "var(--due)" : "var(--mute)");
      var impact = Number(r.inventory_impact_inr || 0);
      var impactStr = (impact >= 0 ? "+" : "") + inr(impact);

      h += '<tr>';
      h += '<td><b>' + r.revision_d + '</b> <span class="sub">' + esc(r.effective_time || '06:00') + '</span></td>';
      h += '<td><b>' + esc(r.fuel_product) + '</b></td>';
      h += '<td class="r">₹' + Number(r.old_rate).toFixed(2) + '</td>';
      h += '<td class="r" style="font-weight:800;color:var(--btn)">₹' + Number(r.new_rate).toFixed(2) + '</td>';
      h += '<td class="r" style="font-weight:700;color:' + chgColor + '">' + chgStr + '</td>';
      h += '<td class="r">' + (r.stock_at_revision ? Number(r.stock_at_revision).toLocaleString("en-IN") + " L" : "—") + '</td>';
      h += '<td class="r" style="font-weight:800;color:' + (impact >= 0 ? 'var(--ok)' : 'var(--due)') + '">' + impactStr + '</td>';
      h += '<td><code style="background:var(--bg);padding:2px 6px;border-radius:4px">' + esc(r.omc_notification_ref || 'OMC Circular') + '</code></td>';
      h += '<td>' + esc(r.revised_by_name || 'Dealer') + '</td>';
      h += '<td class="sub" style="font-size:12px;max-width:240px">' + esc(r.notes || '—') + '</td>';
      h += '</tr>';
    });
    h += '</tbody></table></div>';
  }

  // WhatsApp Broadcast Log Section
  h += '<div style="margin-top:24px;border-top:1px solid var(--line);padding-top:16px">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">';
  h += '<div><b style="font-size:15px">📱 WhatsApp / SMS Fleet Rate Announcements</b><div class="sub" style="font-size:12px">Sent to commercial fleet owners and credit customers when prices update.</div></div>';
  h += '<button class="ghost" onclick="openBroadcastModal()" style="font-size:13px">+ New Announcement</button>';
  h += '</div>';

  if (!broadcasts.length) {
    h += '<div class="empty">No broadcasts recorded. Click "+ New Announcement" to notify transporters of updated diesel/petrol rates.</div>';
  } else {
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px">';
    broadcasts.forEach(function(b){
      h += '<div class="ops-card" style="margin:0;padding:12px">';
      h += '<div class="row" style="margin-bottom:4px"><span style="font-weight:700;font-size:13px;color:var(--btn)">' + esc(b.channel) + '</span><span class="sub" style="font-size:12px">' + b.broadcast_d + '</span></div>';
      h += '<div style="font-size:12.5px;margin-bottom:6px">Audience: <b>' + esc(b.recipient_group) + '</b> (' + b.recipients_count + ' accounts)</div>';
      h += '<div style="background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:8px;font-size:12px;white-space:pre-wrap;font-family:monospace">' + esc(b.message_body) + '</div>';
      h += '<div class="sub" style="margin-top:6px;font-size:11.5px">Delivered by: ' + esc(b.sent_by_name || 'Manager') + ' · <span style="color:var(--ok);font-weight:700">✓ Sent successfully</span></div>';
      h += '</div>';
    });
    h += '</div>';
  }
  h += '</div>';

  A.innerHTML = h;
}

function openPriceRevisionModal(){
  var fuels = ["Petrol (MS)", "Diesel (HSD)", "Power petrol"];
  var curRates = (PRICE_REV_DATA && PRICE_REV_DATA.current_rates) ? PRICE_REV_DATA.current_rates : {};

  var h = '<h2>⛽ Daily 06:00 AM Price Revision</h2>'
    + '<div class="sub">Record revised Retail Selling Price (RSP) as communicated by OMC (IOCL, BPCL, HPCL).</div>'
    + '<label>Fuel Product'
    + '<select id="pr_fuel" onchange="onPriceFuelChange()">'
    + fuels.map(function(f){ return '<option value="' + f + '">' + f + '</option>'; }).join("")
    + '</select></label>'
    + '<div class="row">'
    + '<label>Revision Date<input type="date" id="pr_date" value="' + bizToday() + '"></label>'
    + '<label>Effective Time<input type="time" id="pr_time" value="06:00"></label>'
    + '</div>'
    + '<div class="row">'
    + '<label>Current Active Rate (₹/L)<input id="pr_old" disabled style="background:var(--bg)" value="112.00"></label>'
    + '<label>New Revised RSP (₹/L)<input type="number" step="0.01" id="pr_new" placeholder="e.g. 112.50" oninput="calcPriceImpact()"></label>'
    + '</div>'
    + '<div id="pr_impact_preview" style="background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;margin:8px 0;font-size:13px">'
    + '<div>Rate Delta: <b id="pr_delta_txt">₹0.00</b> &nbsp;|&nbsp; Estimated Stock Valuation Impact: <b id="pr_impact_txt">₹0</b></div>'
    + '</div>'
    + '<label>OMC Circular / Circular Reference #<input id="pr_ref" placeholder="e.g. IOCL/RSP/MUM/2026/10-10"></label>'
    + '<label>Revision Notes<input id="pr_notes" placeholder="e.g. Central parity rate adjustment; nozzle totalizers updated at 06:00."></label>'
    + '<label style="display:flex;align-items:center;gap:8px;margin:10px 0">'
    + '<input type="checkbox" id="pr_broadcast" checked style="width:auto;margin:0"> Send instant WhatsApp rate broadcast to active fleet customers'
    + '</label>'
    + '<div class="err" id="pr_err"></div>'
    + '<div class="btns" style="margin-top:14px;display:flex;gap:8px">'
    + '<button class="ghost" onclick="close()">Cancel</button>'
    + '<button style="flex:1" onclick="submitPriceRevision()">Apply New Fuel Rate</button>'
    + '</div>';

  openM(h);
  setTimeout(onPriceFuelChange, 50);
}

function onPriceFuelChange(){
  var fuelEl = document.getElementById("pr_fuel");
  if (!fuelEl) return;
  var f = fuelEl.value;
  var curRates = (PRICE_REV_DATA && PRICE_REV_DATA.current_rates) ? PRICE_REV_DATA.current_rates : {};
  var rObj = curRates[f] || {};
  var oldEl = document.getElementById("pr_old");
  if (oldEl) oldEl.value = (rObj.rate !== undefined ? Number(rObj.rate).toFixed(2) : "100.00");
  calcPriceImpact();
}

function calcPriceImpact(){
  var oldR = parseFloat((document.getElementById("pr_old")||{}).value) || 0;
  var newR = parseFloat((document.getElementById("pr_new")||{}).value);
  var deltaTxt = document.getElementById("pr_delta_txt");
  var impactTxt = document.getElementById("pr_impact_txt");
  if (isNaN(newR)) {
    if (deltaTxt) deltaTxt.textContent = "—";
    if (impactTxt) impactTxt.textContent = "—";
    return;
  }
  var chg = Math.round((newR - oldR) * 100) / 100;
  var chgStr = (chg >= 0 ? "+" : "") + "₹" + chg.toFixed(2) + " /L";
  if (deltaTxt) {
    deltaTxt.textContent = chgStr;
    deltaTxt.style.color = chg >= 0 ? "var(--ok)" : "var(--due)";
  }
  var estStock = 9000;
  var estImpact = Math.round(estStock * chg);
  if (impactTxt) {
    impactTxt.textContent = (estImpact >= 0 ? "+" : "") + inr(estImpact) + " (on ~9,000L tank stock)";
    impactTxt.style.color = estImpact >= 0 ? "var(--ok)" : "var(--due)";
  }
}

function submitPriceRevision(){
  var fuel = v("pr_fuel");
  var d = v("pr_date");
  var time = v("pr_time");
  var newRate = parseFloat(v("pr_new"));
  var ref = v("pr_ref");
  var notes = v("pr_notes");
  var bCast = document.getElementById("pr_broadcast") ? document.getElementById("pr_broadcast").checked : false;
  var errEl = document.getElementById("pr_err");

  if (!(newRate > 0)) {
    if (errEl) errEl.textContent = "Enter a valid new rate above 0.";
    return;
  }

  api("POST", "/api/price-revisions", {
    revision_d: d,
    effective_time: time,
    fuel_product: fuel,
    new_rate: newRate,
    omc_notification_ref: ref,
    notes: notes,
    broadcast_now: bCast
  }).then(function(res){
    close();
    toast("Price revision saved! Active rate for " + fuel + " is now ₹" + newRate.toFixed(2));
    loadPriceRevData();
  }).catch(function(err){
    if (errEl) errEl.textContent = err.error || "Could not save price revision.";
  });
}

function openBroadcastModal(){
  var curRates = (PRICE_REV_DATA && PRICE_REV_DATA.current_rates) ? PRICE_REV_DATA.current_rates : {};
  var msRate = curRates["Petrol (MS)"] ? curRates["Petrol (MS)"].rate : "112.00";
  var hsdRate = curRates["Diesel (HSD)"] ? curRates["Diesel (HSD)"].rate : "99.00";

  var defaultMsg = "Mahud Auto Fuel Station Rate Update (" + bizToday() + "):\n"
    + "⛽ Petrol (MS): ₹" + Number(msRate).toFixed(2) + "/L\n"
    + "🚛 Diesel (HSD): ₹" + Number(hsdRate).toFixed(2) + "/L\n"
    + "Prompt payment credit cashbacks apply. High-density pure fuel verified daily.";

  var h = '<h2>📢 WhatsApp Rate Broadcast to Fleets</h2>'
    + '<div class="sub">Send automated rate announcement to transporters and corporate credit accounts.</div>'
    + '<label>Channel'
    + '<select id="bc_channel"><option>WhatsApp Broadcast</option><option>SMS Gateway</option></select></label>'
    + '<label>Target Recipient Group'
    + '<input id="bc_group" value="All Active Transporters & Credit Fleet Accounts"></label>'
    + '<label>Announcement Message Body'
    + '<textarea id="bc_body" rows="5" style="width:100%;font-family:monospace;padding:8px">' + esc(defaultMsg) + '</textarea></label>'
    + '<div class="err" id="bc_err"></div>'
    + '<div class="btns" style="margin-top:14px;display:flex;gap:8px">'
    + '<button class="ghost" onclick="close()">Cancel</button>'
    + '<button style="flex:1" onclick="submitBroadcast()">Send Broadcast Now</button>'
    + '</div>';

  openM(h);
}

function submitBroadcast(){
  var chan = v("bc_channel");
  var grp = v("bc_group");
  var body = v("bc_body");
  var errEl = document.getElementById("bc_err");

  if (!body.trim()) {
    if (errEl) errEl.textContent = "Please enter the broadcast message body.";
    return;
  }

  api("POST", "/api/price-broadcast", {
    channel: chan,
    recipient_group: grp,
    message_body: body
  }).then(function(res){
    close();
    toast("Broadcast dispatched to " + (res.sent_count || 12) + " transporter contacts!");
    loadPriceRevData();
  }).catch(function(err){
    if (errEl) errEl.textContent = err.error || "Could not send broadcast.";
  });
}

// ========================================================
// 2. WEIGHTS & MEASURES (W&M) RESEAL REQUEST TRACKER
// ========================================================

function loadWmResealData(){
  if (WM_RESEAL_LOADING) return;
  WM_RESEAL_LOADING = true;
  var url = "/api/wm-reseals?status=" + encodeURIComponent(WM_RESEAL_FILTER_STATUS);
  api("GET", url).then(function(res){
    WM_RESEAL_DATA = res;
    WM_RESEAL_LOADING = false;
    if (tab === "wmreseal") renderWmResealTab();
  }).catch(function(err){
    WM_RESEAL_LOADING = false;
    toast(err.error || "Could not load W&M reseal requests.");
    if (tab === "wmreseal") renderWmResealTab();
  });
}

function renderWmResealTab(){
  tab = "wmreseal";
  var A = document.getElementById("app");
  if (!A) return;

  if (!SRV) {
    A.innerHTML = nav() + '<div class="empty">Legal Metrology resealing is managed on the server. Please log in.</div>';
    return;
  }

  if (!WM_RESEAL_DATA && !WM_RESEAL_LOADING) {
    A.innerHTML = nav() + '<div class="empty">Loading W&M seal breakdown & resealing requests…</div>';
    loadWmResealData();
    return;
  }

  var data = WM_RESEAL_DATA || { requests: [], stats: {} };
  var reqs = data.requests || [];
  var stats = data.stats || {};

  var h = nav();

  // Header
  h += '<div class="row" style="align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">';
  h += '<div><h1 style="margin:0">🔒 W&M Pulser & Meter Reseal Application Register</h1><div class="sub" style="margin-top:2px">Statutory Legal Metrology tracker when seals are broken during dispenser maintenance, totalizer repair, or pulser replacement.</div></div>';
  h += '<div class="btns" style="margin:0;flex:none;display:flex;gap:6px">';
  if (ME && (ME.role === "owner" || ME.role === "manager")) {
    h += '<button onclick="openNewResealRequestModal()" style="display:inline-flex;align-items:center;gap:6px">+ Log Seal Break & Request Reseal</button>';
  }
  h += '<button class="ghost" onclick="loadWmResealData()" title="Refresh" style="padding:8px 12px">🔄</button>';
  h += '</div></div>';

  h += renderWmResealSubView();
  A.innerHTML = h;
}

function renderWmResealSubView(){
  if (!WM_RESEAL_DATA && !WM_RESEAL_LOADING) {
    loadWmResealData();
    return '<div class="empty">Loading W&M seal breakdown & resealing requests…</div>';
  }

  var data = WM_RESEAL_DATA || { requests: [], stats: {} };
  var reqs = data.requests || [];
  var stats = data.stats || {};
  var h = '';

  // KPI Metrics
  h += '<div class="ops-kpi-bar noprint">';
  h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--warn)">' + (stats.pending_reseal_count || 0) + '</div><div class="ops-kpi-lbl">Awaiting Inspector Resealing</div></div>';
  h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--ok)">' + (stats.completed_count || 0) + '</div><div class="ops-kpi-lbl">Inspected & Resealed</div></div>';
  h += '<div class="ops-kpi-card"><div class="ops-kpi-num">₹450</div><div class="ops-kpi-lbl">Standard Govt Challan Fee</div></div>';
  h += '<div class="ops-kpi-card"><div class="ops-kpi-num">' + reqs.length + '</div><div class="ops-kpi-lbl">Total Maintenance Incidents</div></div>';
  h += '</div>';

  // Action header row inside subview if called from vault
  h += '<div class="row noprint" style="justify-content:space-between;align-items:center;margin-bottom:10px">';
  h += '<div class="sub">Log broken seals within 24h of dispenser repair to avoid Legal Metrology penalties.</div>';
  if (ME && (ME.role === "owner" || ME.role === "manager")) {
    h += '<button onclick="openNewResealRequestModal()" style="font-size:12px;padding:6px 12px">+ Log Broken Seal & Request Reseal</button>';
  }
  h += '</div>';

  // Filter Bar
  h += '<div class="ho-filters noprint">';
  h += '<div class="ho-filter-row">';
  h += '<select style="margin:0;min-width:180px" onchange="WM_RESEAL_FILTER_STATUS=this.value;loadWmResealData()">';
  h += '<option value="all"' + (WM_RESEAL_FILTER_STATUS=="all"?' selected':'') + '>All Reseal Requests</option>';
  h += '<option value="pending_reseal"' + (WM_RESEAL_FILTER_STATUS=="pending_reseal"?' selected':'') + '>⏳ Pending Resealing</option>';
  h += '<option value="inspected_resealed"' + (WM_RESEAL_FILTER_STATUS=="inspected_resealed"?' selected':'') + '>✅ Inspected & Resealed</option>';
  h += '</select>';
  h += '<button class="ghost" onclick="printResealRegister()" style="font-size:13px">🖨️ Print Statutory Notice</button>';
  h += '</div></div>';

  if (!reqs.length) {
    h += '<div class="empty">No seal breaking incidents logged. Tap "+ Log Seal Break & Request Reseal" if a technician opens the dispenser for repairs.</div>';
  } else {
    h += '<div class="ops-table-wrap"><table class="ops-table">';
    h += '<thead><tr><th>Request #</th><th>Nozzle & Island</th><th>Product</th><th>Broken Seal Type</th><th>Maintenance Reason</th><th>Technician & Agency</th><th>Date Broken</th><th>Govt Notice Date</th><th>Status</th><th>New Seal #</th><th>Actions</th></tr></thead><tbody>';
    reqs.forEach(function(r){
      var isPending = r.status === "pending_reseal";
      var statusBadge = isPending
        ? '<span class="ops-pill" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a">⏳ Pending Reseal</span>'
        : '<span class="ops-pill ops-pill-ok">✅ Resealed (' + esc(r.new_seal_no || 'Done') + ')</span>';

      h += '<tr>';
      h += '<td><b style="color:var(--btn)">' + esc(r.req_no) + '</b></td>';
      h += '<td><b>Nozzle ' + esc(r.nozzle_id) + '</b><br><span class="sub" style="font-size:11px">' + esc(r.island_name) + '</span></td>';
      h += '<td><b>' + esc(r.fuel_product) + '</b></td>';
      h += '<td><code style="background:var(--bg);padding:2px 6px;border-radius:4px">' + esc(r.seal_type) + '</code></td>';
      h += '<td class="sub" style="font-size:12px;max-width:200px">' + esc(r.broken_reason) + '</td>';
      h += '<td><b>' + esc(r.technician_name) + '</b><br><span class="sub" style="font-size:11px">' + esc(r.technician_agency) + '</span></td>';
      h += '<td>' + r.date_broken + '</td>';
      h += '<td>' + (r.notice_to_wm_d || '—') + '</td>';
      h += '<td>' + statusBadge + '</td>';
      h += '<td><b>' + esc(r.new_seal_no || '—') + '</b>' + (r.resealed_d ? '<br><span class="sub" style="font-size:11px">on ' + r.resealed_d + '</span>' : '') + '</td>';
      h += '<td>';
      if (isPending && ME && (ME.role === "owner" || ME.role === "manager")) {
        h += '<button style="padding:4px 8px;font-size:11.5px" onclick="openCompleteResealModal(' + r.id + ')">Mark Resealed</button>';
      } else {
        h += '<span class="sub" style="font-size:11.5px">Completed</span>';
      }
      h += '</td>';
      h += '</tr>';
    });
    h += '</tbody></table></div>';
  }
  return h;
}
window.renderWmResealSubView = renderWmResealSubView;

function openNewResealRequestModal(){
  var nozzles = (S && S.nozzles) ? S.nozzles : [];

  var h = '<h2>🔒 Log Broken Seal & Request W&M Reseal</h2>'
    + '<div class="sub">Under Legal Metrology Rules, any broken dispenser seal must be reported within 24 hours to the Controller of Legal Metrology.</div>'
    + '<label>Dispenser Nozzle'
    + '<select id="rsl_noz">'
    + nozzles.map(function(n){ return '<option value="' + n.id + '">' + esc(n.name) + ' (' + esc(n.fuel) + ')</option>'; }).join("")
    + '</select></label>'
    + '<div class="row">'
    + '<label>Dispenser Make & Model<input id="rsl_make" placeholder="e.g. Gilbarco Veeder-Root / Tokheim"></label>'
    + '<label>Bay / Island<input id="rsl_island" value="Island 1 (Main Forecourt)"></label>'
    + '</div>'
    + '<div class="row">'
    + '<label>Seal Type Broken'
    + '<select id="rsl_type">'
    + '<option value="pulser_wire">Pulser Unit Lead Wire Seal</option>'
    + '<option value="totalizer_board">Totalizer Motherboard Enclosure</option>'
    + '<option value="meter_k_factor">Electronic Meter K-Factor Calibration Seal</option>'
    + '<option value="du_cabinet">Dispensing Unit Physical Cabinet Seal</option>'
    + '</select></label>'
    + '<label>Date Broken<input type="date" id="rsl_date" value="' + bizToday() + '"></label>'
    + '</div>'
    + '<label>Repair / Breakdown Reason<input id="rsl_reason" placeholder="e.g. Pulser board erratic pulses replaced by authorized OEM engineer."></label>'
    + '<div class="row">'
    + '<label>Authorized Technician Name<input id="rsl_tech" placeholder="e.g. Nilesh Patil"></label>'
    + '<label>Service Agency / OEM<input id="rsl_agency" placeholder="e.g. Wayne Dresser India AMC"></label>'
    + '</div>'
    + '<div class="row">'
    + '<label>Notice Date to Legal Metrology<input type="date" id="rsl_notice" value="' + bizToday() + '"></label>'
    + '<label>Legal Metrology Office<input id="rsl_office" value="Inspector of Legal Metrology, Pandharpur Division"></label>'
    + '</div>'
    + '<div class="err" id="rsl_err"></div>'
    + '<div class="btns" style="margin-top:14px;display:flex;gap:8px">'
    + '<button class="ghost" onclick="close()">Cancel</button>'
    + '<button style="flex:1" onclick="submitResealRequest()">Submit Reseal Application</button>'
    + '</div>';

  openM(h);
}

function submitResealRequest(){
  var nozId = v("rsl_noz");
  var make = v("rsl_make");
  var island = v("rsl_island");
  var sealType = v("rsl_type");
  var dateBroken = v("rsl_date");
  var reason = v("rsl_reason");
  var tech = v("rsl_tech");
  var agency = v("rsl_agency");
  var notice = v("rsl_notice");
  var office = v("rsl_office");
  var errEl = document.getElementById("rsl_err");

  if (!reason.trim() || !tech.trim()) {
    if (errEl) errEl.textContent = "Please enter repair reason and technician name.";
    return;
  }

  var targetNoz = (S && S.nozzles) ? S.nozzles.find(function(n){ return String(n.id) === String(nozId); }) : null;
  var fuelProd = targetNoz ? targetNoz.fuel : "Diesel (HSD)";

  api("POST", "/api/wm-reseals/request", {
    nozzle_id: nozId,
    fuel_product: fuelProd,
    dispenser_make: make,
    island_name: island,
    seal_type: sealType,
    broken_reason: reason,
    technician_name: tech,
    technician_agency: agency,
    date_broken: dateBroken,
    notice_to_wm_d: notice,
    wm_inspector_office: office,
    challan_fee_inr: 450
  }).then(function(res){
    close();
    toast("Reseal application " + res.req_no + " logged successfully!");
    loadWmResealData();
  }).catch(function(err){
    if (errEl) errEl.textContent = err.error || "Could not log reseal request.";
  });
}

function openCompleteResealModal(id){
  var h = '<h2>✅ Record Inspector Resealing Completion</h2>'
    + '<div class="sub">Record newly clamped Legal Metrology lead seal number after government inspector verification.</div>'
    + '<label>New Lead Seal Number / Impression<input id="cmp_seal" placeholder="e.g. LM-PUN-PL-2026-9041"></label>'
    + '<div class="row">'
    + '<label>Resealing Date<input type="date" id="cmp_date" value="' + bizToday() + '"></label>'
    + '</div>'
    + '<label>Inspector Remarks / Verification Certificate #<input id="cmp_remarks" placeholder="e.g. 5L conical measure error verified ±0 ml. Certificate #CERT-8842 issued."></label>'
    + '<div class="err" id="cmp_err"></div>'
    + '<div class="btns" style="margin-top:14px;display:flex;gap:8px">'
    + '<button class="ghost" onclick="close()">Cancel</button>'
    + '<button style="flex:1" onclick="submitCompleteReseal(' + id + ')">Save Resealing Certificate</button>'
    + '</div>';

  openM(h);
}

function submitCompleteReseal(id){
  var sealNo = v("cmp_seal");
  var d = v("cmp_date");
  var remarks = v("cmp_remarks");
  var errEl = document.getElementById("cmp_err");

  if (!sealNo.trim()) {
    if (errEl) errEl.textContent = "Please enter the new seal number.";
    return;
  }

  api("POST", "/api/wm-reseals/complete", {
    id: id,
    new_seal_no: sealNo,
    resealed_d: d,
    inspector_remarks: remarks
  }).then(function(){
    close();
    toast("Nozzle marked as inspected and legally resealed!");
    loadWmResealData();
  }).catch(function(err){
    if (errEl) errEl.textContent = err.error || "Could not update reseal request.";
  });
}

function printResealRegister(){
  window.print();
}

// ========================================================
// 3. MONTHLY GST TAX BREAKUP & GSTR EXPORT
// ========================================================

function loadGstBreakupData(){
  if (GST_BREAKUP_LOADING) return;
  GST_BREAKUP_LOADING = true;
  var targetM = GST_BREAKUP_MONTH || bizToday().slice(0, 7);
  var url = "/api/gst-tax-breakup?month=" + encodeURIComponent(targetM);
  api("GET", url).then(function(res){
    GST_BREAKUP_DATA = res;
    GST_BREAKUP_LOADING = false;
    if (tab === "gstbreakup") renderGstBreakupTab();
  }).catch(function(err){
    GST_BREAKUP_LOADING = false;
    toast(err.error || "Could not load GST tax summary.");
    if (tab === "gstbreakup") renderGstBreakupTab();
  });
}

function renderGstBreakupTab(){
  tab = "gstbreakup";
  var A = document.getElementById("app");
  if (!A) return;

  if (!SRV) {
    A.innerHTML = nav() + '<div class="empty">GST tax reporting is managed on the server. Please log in.</div>';
    return;
  }

  if (!GST_BREAKUP_DATA && !GST_BREAKUP_LOADING) {
    A.innerHTML = nav() + '<div class="empty">Calculating monthly GST vs non-GST fuel turnover breakdown…</div>';
    loadGstBreakupData();
    return;
  }

  var data = GST_BREAKUP_DATA || { month: "", gst_turnover_summary: {}, b2b_invoices: [], b2c_invoices: [] };
  var summary = data.gst_turnover_summary || {};
  var b2b = data.b2b_invoices || [];
  var b2c = data.b2c_invoices || [];
  var stn = data.station || { name: "Mahud Auto Fuel Station", gst: "" };

  var h = nav();

  // Top Clubbed Switcher
  h += '<div class="ops-subtabs noprint" style="margin-bottom:14px;background:rgba(0,0,0,0.03);padding:4px;border-radius:10px">';
  h += '<button class="ops-subtab-btn" onclick="window.INV_SUBTAB=\'invoices\';renderInv()">🧾 Tax Invoices (Lubricants & Shop)</button>';
  h += '<button class="ops-subtab-btn active" onclick="window.INV_SUBTAB=\'gstreturn\';renderGstBreakupTab()">📑 Monthly GST Return & Tax Breakup</button>';
  h += '</div>';

  // Header
  h += '<div class="row" style="align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">';
  h += '<div><h1 style="margin:0">📑 Monthly GST Return & Fuel Tax Breakup</h1><div class="sub" style="margin-top:2px">Tax separation between GST-taxable Lubricants/DEF (18%/28%) and non-GST Motor Fuel (VAT/Excise). GSTR-1 Table 4 & Table 8 export.</div></div>';
  h += '<div class="btns" style="margin:0;flex:none;display:flex;gap:6px">';
  h += '<button onclick="exportGstToExcel()" style="display:inline-flex;align-items:center;gap:6px">📥 Export GSTR Excel (CSV)</button>';
  h += '<button class="ghost" onclick="window.print()" style="display:inline-flex;align-items:center;gap:6px">🖨️ Print Tax Statement</button>';
  h += '<button class="ghost" onclick="loadGstBreakupData()" title="Refresh" style="padding:8px 12px">🔄</button>';
  h += '</div></div>';

  // Month selector
  var curM = GST_BREAKUP_MONTH || bizToday().slice(0, 7);
  h += '<div class="noprint" style="display:flex;align-items:center;gap:10px;margin-bottom:14px;background:var(--card);padding:10px 14px;border-radius:8px;border:1px solid var(--line)">';
  h += '<span style="font-weight:700;font-size:13.5px">Select Tax Period (Month):</span>';
  h += '<input type="month" value="' + curM + '" style="margin:0;width:auto" onchange="GST_BREAKUP_MONTH=this.value;loadGstBreakupData()">';
  h += '<span class="sub" style="font-size:12px">Station GSTIN: <b>' + esc(stn.gst || '27ABCDE1234F1Z5') + '</b></span>';
  h += '</div>';

  // KPI Metrics Summary
  h += '<div class="ops-kpi-bar noprint">';
  h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--btn)">' + inr(summary.total_taxable_gst_value || 0) + '</div><div class="ops-kpi-lbl">GST Taxable Lubricants (18%)</div></div>';
  h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--ok)">' + inr(summary.total_gst_tax || 0) + '</div><div class="ops-kpi-lbl">Total GST Collected (CGST+SGST)</div></div>';
  h += '<div class="ops-kpi-card"><div class="ops-kpi-num">' + inr(summary.non_gst_fuel_turnover || 0) + '</div><div class="ops-kpi-lbl">Non-GST Fuel Turnover (VAT/Excise)</div></div>';
  h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="font-weight:800">' + inr(summary.total_gross_turnover || 0) + '</div><div class="ops-kpi-lbl">Total Station Gross Turnover</div></div>';
  h += '</div>';

  // Detailed Statutory Table: GSTR-1 Breakdown
  h += '<div style="background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:16px">';
  h += '<b style="font-size:15px">GSTR-1 Monthly Return Table Mapping:</b>';
  h += '<div class="ops-table-wrap" style="margin-top:10px"><table class="ops-table">';
  h += '<thead><tr><th>GSTR-1 Table</th><th>Description</th><th class="r">Taxable Value</th><th class="r">CGST (9%)</th><th class="r">SGST (9%)</th><th class="r">IGST (18%)</th><th class="r">Total Invoice Value</th></tr></thead><tbody>';

  h += '<tr>';
  h += '<td><b>Table 4A</b></td>';
  h += '<td>B2B Invoices (Registered Transporters with GSTIN)</td>';
  h += '<td class="r" style="font-weight:700">' + inr(summary.b2b_taxable_value || 0) + '</td>';
  h += '<td class="r">' + inr(b2b.reduce(function(a,x){return a+x.cgst},0)) + '</td>';
  h += '<td class="r">' + inr(b2b.reduce(function(a,x){return a+x.sgst},0)) + '</td>';
  h += '<td class="r">' + inr(b2b.reduce(function(a,x){return a+x.igst},0)) + '</td>';
  h += '<td class="r" style="font-weight:800">' + inr(b2b.reduce(function(a,x){return a+x.total_amount},0)) + '</td>';
  h += '</tr>';

  h += '<tr>';
  h += '<td><b>Table 7</b></td>';
  h += '<td>B2C Small Supplies (Walk-in Cash & Retail Lube Invoices)</td>';
  h += '<td class="r" style="font-weight:700">' + inr(summary.b2c_taxable_value || 0) + '</td>';
  h += '<td class="r">' + inr(b2c.reduce(function(a,x){return a+x.cgst},0)) + '</td>';
  h += '<td class="r">' + inr(b2c.reduce(function(a,x){return a+x.sgst},0)) + '</td>';
  h += '<td class="r">' + inr(b2c.reduce(function(a,x){return a+x.igst},0)) + '</td>';
  h += '<td class="r" style="font-weight:800">' + inr(b2c.reduce(function(a,x){return a+x.total_amount},0)) + '</td>';
  h += '</tr>';

  h += '<tr style="background:var(--bg)">';
  h += '<td><b>Table 8</b></td>';
  h += '<td><b>Non-GST Outward Supplies</b> (Motor Spirit Petrol & High Speed Diesel)</td>';
  h += '<td class="r" style="font-weight:800">' + inr(summary.non_gst_fuel_turnover || 0) + '</td>';
  h += '<td class="r">₹0</td><td class="r">₹0</td><td class="r">₹0</td>';
  h += '<td class="r" style="font-weight:800">' + inr(summary.non_gst_fuel_turnover || 0) + '</td>';
  h += '</tr>';

  h += '</tbody></table></div>';
  h += '</div>';

  // B2B Invoices List for Accountant Filing
  h += '<div style="margin-top:14px">';
  h += '<b style="font-size:14.5px">B2B Registered Invoices (Table 4A Filing Schedule) (' + b2b.length + '):</b>';
  if (!b2b.length) {
    h += '<div class="empty" style="margin-top:8px">No B2B invoices with customer GSTIN recorded for this month.</div>';
  } else {
    h += '<div class="ops-table-wrap" style="margin-top:8px"><table class="ops-table">';
    h += '<thead><tr><th>Invoice #</th><th>Date</th><th>Customer Name</th><th>Customer GSTIN</th><th class="r">Taxable</th><th class="r">CGST</th><th class="r">SGST</th><th class="r">Total</th></tr></thead><tbody>';
    b2b.forEach(function(inv){
      h += '<tr>';
      h += '<td><b>' + esc(inv.invoice_no) + '</b></td>';
      h += '<td>' + inv.date + '</td>';
      h += '<td><b>' + esc(inv.customer_name) + '</b></td>';
      h += '<td><code style="background:var(--bg);padding:2px 6px;border-radius:4px">' + esc(inv.customer_gstin) + '</code></td>';
      h += '<td class="r">' + inr(inv.taxable_value) + '</td>';
      h += '<td class="r">' + inr(inv.cgst) + '</td>';
      h += '<td class="r">' + inr(inv.sgst) + '</td>';
      h += '<td class="r" style="font-weight:800">' + inr(inv.total_amount) + '</td>';
      h += '</tr>';
    });
    h += '</tbody></table></div>';
  }
  h += '</div>';

  A.innerHTML = h;
}

function exportGstToExcel(){
  if (!GST_BREAKUP_DATA) {
    toast("No data to export.");
    return;
  }
  var data = GST_BREAKUP_DATA;
  var b2b = data.b2b_invoices || [];
  var b2c = data.b2c_invoices || [];
  var s = data.gst_turnover_summary || {};
  var month = data.month || "Current";

  var csv = "GST RETURN & TAX BREAKUP - " + month + "\n";
  csv += "Station:," + (data.station ? data.station.name : "Petrol Pump") + "\n";
  csv += "GSTIN:," + (data.station ? data.station.gst : "") + "\n\n";

  csv += "TURNOVER SUMMARY\n";
  csv += "Category,Taxable Value,CGST,SGST,IGST,Total Value\n";
  csv += "B2B Lubes & Care," + (s.b2b_taxable_value||0) + ",,\n";
  csv += "B2C Retail Lubes," + (s.b2c_taxable_value||0) + ",,\n";
  csv += "Non-GST Fuel (MS & HSD)," + (s.non_gst_fuel_turnover||0) + ",0,0,0," + (s.non_gst_fuel_turnover||0) + "\n";
  csv += "Total Station Turnover," + (s.total_gross_turnover||0) + "\n\n";

  csv += "GSTR-1 TABLE 4A (B2B INVOICES)\n";
  csv += "Invoice No,Date,Customer Name,GSTIN,Taxable Value,CGST,SGST,IGST,Invoice Total\n";
  b2b.forEach(function(i){
    csv += [
      i.invoice_no, i.date, '"' + (i.customer_name||"").replace(/"/g, '""') + '"',
      i.customer_gstin, i.taxable_value, i.cgst, i.sgst, i.igst, i.total_amount
    ].join(",") + "\n";
  });

  var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "GSTR_Breakup_" + month + ".csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast("GSTR monthly tax summary downloaded!");
}
