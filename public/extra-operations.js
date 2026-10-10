// extra-operations.js - 7 Advanced Petrol Pump Management Modules
// 1. Shift Cash Handover & Cash-Safe Vault Reconciliation
// 2. Underground Tank Water Paste & Dip Log
// 3. Statutory & PESO Compliance & License Expiry Tracker
// 4. Forecourt Equipment Breakdown & Maintenance Log
// 5. Driver Loyalty & Local Commercial Customer Khata
// 6. Generator & Forecourt Electricity Power Log
// 7. Forecourt Customer Amenities & OMC Mystery Audit Checklist

(function(window){
  "use strict";

  // State caches
  var VAULT_DATA = null, VAULT_LOADING = false, VAULT_SUBTAB = "drops", VAULT_SEARCH = "", VAULT_SHIFT = "all";
  var WATER_DATA = null, WATER_LOADING = false, WATER_FILTER_TANK = "all", WATER_SEARCH = "";
  var COMPLIANCE_DATA = null, COMPLIANCE_LOADING = false, COMPLIANCE_CAT = "all", COMPLIANCE_STATUS = "all";
  var EQUIP_DATA = null, EQUIP_LOADING = false, EQUIP_SUBTAB = "active", EQUIP_SEARCH = "", EQUIP_PRIORITY = "all";
  var LOYALTY_DATA = null, LOYALTY_LOADING = false, LOYALTY_SUBTAB = "members", LOYALTY_SEARCH = "", LOYALTY_TYPE = "all";
  var GEN_DATA = null, GEN_LOADING = false, GEN_SEARCH = "";
  var AMEN_DATA = null, AMEN_LOADING = false, AMEN_SUBTAB = "checklist";

  // ==========================================
  // 1. SHIFT CASH HANDOVER & VAULT RECONCILIATION
  // ==========================================
  function loadVaultData(){
    VAULT_LOADING = true;
    api("GET", "/api/vault-drops?shift=" + encodeURIComponent(VAULT_SHIFT) + "&search=" + encodeURIComponent(VAULT_SEARCH))
      .then(function(res){
        VAULT_DATA = res;
        VAULT_LOADING = false;
        if (tab === "vault") renderVaultTab();
      })
      .catch(function(err){
        VAULT_LOADING = false;
        toast(err.error || "Could not load vault records.");
        if (tab === "vault") renderVaultTab();
      });
  }

  function renderVaultTab(){
    tab = "vault";
    var A = document.getElementById("app");
    if (!A) return;

    if (!SRV) {
      A.innerHTML = nav() + '<div class="empty">Cash vault records are managed on the server. Please log in.</div>';
      return;
    }

    if (!VAULT_DATA && !VAULT_LOADING) {
      A.innerHTML = nav() + '<div class="empty">Loading cash vault and shift handover register…</div>';
      loadVaultData();
      return;
    }

    var data = VAULT_DATA || { drops: [], stats: {} };
    var stats = data.stats || {};
    var drops = data.drops || [];

    var h = nav();

    // Header
    h += '<div class="row" style="align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">';
    h += '<div><h1 style="margin:0">🔒 Cash-Safe Vault & Shift Handover</h1><div class="sub" style="margin-top:2px">Attendant back-office vault drops, currency denomination counter, digital settlement reconciliation and bank deposits.</div></div>';
    h += '<div class="btns" style="margin:0;flex:none">';
    h += '<button onclick="openAttendantDropModal()" style="display:inline-flex;align-items:center;gap:6px">💵 Attendant Safe Drop</button>';
    if (ME && (ME.role === "owner" || ME.role === "manager")) {
      h += '<button onclick="openBankDepositModal()" class="ghost" style="display:inline-flex;align-items:center;gap:6px">🏦 Record Bank Deposit</button>';
    }
    h += '<button class="ghost" onclick="loadVaultData()" title="Refresh records" style="padding:8px 12px">🔄</button>';
    h += '</div></div>';

    // KPI Metrics
    h += '<div class="ops-kpi-bar noprint">';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--ok)">' + inr(stats.safe_cash_balance || 0) + '</div><div class="ops-kpi-lbl">Current Cash-in-Vault</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num">' + inr(stats.today_drops_amount || 0) + '</div><div class="ops-kpi-lbl">Today\'s Shift Cash Drops</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--btn)">' + inr(stats.today_bank_deposited || 0) + '</div><div class="ops-kpi-lbl">Bank Deposited Today</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:' + ((stats.pending_verification || 0) > 0 ? 'var(--warn)' : 'var(--ok)') + '">' + (stats.pending_verification || 0) + '</div><div class="ops-kpi-lbl">Pending Drops Verification</div></div>';
    h += '</div>';

    // Subtabs Switcher
    h += '<div class="ops-subtabs noprint">';
    h += '<button class="ops-subtab-btn ' + (VAULT_SUBTAB === "drops" ? 'active' : '') + '" onclick="VAULT_SUBTAB=\'drops\';renderVaultTab()">📥 Shift Cash Handover Drops (' + drops.filter(function(x){return x.drop_type !== "bank_deposit"}).length + ')</button>';
    h += '<button class="ops-subtab-btn ' + (VAULT_SUBTAB === "bank" ? 'active' : '') + '" onclick="VAULT_SUBTAB=\'bank\';renderVaultTab()">🏦 Bank Deposits & Transfers (' + drops.filter(function(x){return x.drop_type === "bank_deposit"}).length + ')</button>';
    h += '</div>';

    // Filters
    h += '<div class="ho-filters noprint">';
    h += '<div class="ho-filter-row">';
    h += '<div class="ho-search-wrap">';
    h += '<span class="ho-search-icon">🔍</span>';
    h += '<input type="text" placeholder="Search by attendant, notes, drop type..." value="' + esc(VAULT_SEARCH) + '" oninput="VAULT_SEARCH=this.value;loadVaultData()">';
    h += '</div>';
    h += '<select style="margin:0;min-width:140px" onchange="VAULT_SHIFT=this.value;loadVaultData()">';
    h += '<option value="all"' + (VAULT_SHIFT==="all"?" selected":"") + '>All Shifts</option>';
    h += '<option value="Morning"' + (VAULT_SHIFT==="Morning"?" selected":"") + '>Morning Shift</option>';
    h += '<option value="Evening"' + (VAULT_SHIFT==="Evening"?" selected":"") + '>Evening Shift</option>';
    h += '<option value="Night"' + (VAULT_SHIFT==="Night"?" selected":"") + '>Night Shift</option>';
    h += '</select>';
    h += '</div></div>';

    var filteredDrops = drops.filter(function(d){
      if (VAULT_SUBTAB === "bank") return d.drop_type === "bank_deposit";
      return d.drop_type !== "bank_deposit";
    });

    if (!filteredDrops.length) {
      h += '<div class="empty">No vault entries found for this filter. Tap "Attendant Safe Drop" to record physical cash deposited in the safe.</div>';
    } else {
      h += '<div class="ops-table-wrap">';
      h += '<table class="ops-table">';
      h += '<thead><tr>';
      h += '<th>Date & Shift</th><th>Attendant / Depositor</th><th>Type</th><th style="text-align:right">Physical Cash Deposited</th><th>Denominations Breakdown</th><th>Digital & Credit</th><th>Difference (Short/Excess)</th><th>Status</th><th>Verified By</th><th class="noprint">Actions</th>';
      h += '</tr></thead><tbody>';

      filteredDrops.forEach(function(row){
        var diff = Number(row.short_excess || 0);
        var diffClass = diff === 0 ? 'color:var(--ok)' : (diff < 0 ? 'color:var(--due)' : 'color:var(--btn)');
        var diffText = diff === 0 ? 'Exact Match (₹0)' : (diff < 0 ? 'Short ' + inr(Math.abs(diff)) : 'Excess +' + inr(diff));

        // Denominations brief
        var denoms = [];
        if (row.c500) denoms.push('500×' + row.c500);
        if (row.c200) denoms.push('200×' + row.c200);
        if (row.c100) denoms.push('100×' + row.c100);
        if (row.c50) denoms.push('50×' + row.c50);
        if (row.c20) denoms.push('20×' + row.c20);
        if (row.c10) denoms.push('10×' + row.c10);
        if (row.coins) denoms.push('Coins ₹' + row.coins);
        var denomSummary = denoms.length ? denoms.slice(0, 4).join(', ') + (denoms.length > 4 ? '…' : '') : '—';

        // Digital summary
        var digiParts = [];
        if (row.digital_upi) digiParts.push('UPI: ' + inr(row.digital_upi));
        if (row.digital_card) digiParts.push('Card: ' + inr(row.digital_card));
        if (row.fleet_credit) digiParts.push('Indent: ' + inr(row.fleet_credit));
        var digiStr = digiParts.join(' | ') || 'None';

        var isPending = row.status === "pending";

        h += '<tr>';
        h += '<td style="font-weight:700;white-space:nowrap">' + esc(row.d) + '<br><span class="sub" style="font-size:11px">' + esc(row.shift) + '</span></td>';
        h += '<td><b>' + esc(row.worker_name || 'Staff #' + row.worker_id) + '</b></td>';
        h += '<td><span class="ops-pill ' + (row.drop_type === "bank_deposit" ? 'ops-pill-info' : 'ops-pill-ok') + '">' + (row.drop_type === "bank_deposit" ? 'Bank Deposit' : 'Shift Drop') + '</span></td>';
        h += '<td style="text-align:right;font-weight:800;font-size:15px;color:var(--ink)">' + inr(row.amount) + '</td>';
        h += '<td class="sub" style="font-size:12px;font-family:monospace">' + esc(denomSummary) + '</td>';
        h += '<td class="sub" style="font-size:11px">' + esc(digiStr) + '</td>';
        h += '<td style="font-weight:700;' + diffClass + '">' + esc(diffText) + '</td>';
        h += '<td><span class="ops-pill ' + (isPending ? 'ops-pill-warn' : 'ops-pill-ok') + '">' + (isPending ? 'Pending Check' : 'Verified in Safe') + '</span></td>';
        h += '<td class="sub">' + (row.receiver_name ? esc(row.receiver_name) : '—') + '</td>';
        h += '<td class="noprint" style="white-space:nowrap">';
        if (isPending && ME && (ME.role === "owner" || ME.role === "manager")) {
          h += '<button onclick="verifyVaultDrop(' + row.id + ')" style="padding:4px 8px;font-size:11px">Verify Drop</button> ';
        }
        h += '<button class="ghost" onclick="viewVaultDropDetails(' + row.id + ')" style="padding:4px 8px;font-size:11px">Receipt</button>';
        h += '</td></tr>';
      });

      h += '</tbody></table></div>';
    }

    A.innerHTML = h;
  }

  function verifyVaultDrop(id){
    api("POST", "/api/vault-drops/" + id + "/verify")
      .then(function(){
        toast("Vault drop marked as verified.");
        loadVaultData();
      })
      .catch(function(e){ toast(e.error || "Could not verify drop."); });
  }

  function viewVaultDropDetails(id){
    if (!VAULT_DATA || !VAULT_DATA.drops) return;
    var row = VAULT_DATA.drops.find(function(x){ return x.id === id; });
    if (!row) return;

    var h = '<div style="max-width:440px">';
    h += '<h2>💵 Safe Vault Drop Voucher</h2>';
    h += '<div class="ops-card" style="margin-top:12px">';
    h += '<div class="row" style="justify-content:space-between"><b>Voucher #' + row.id + '</b><span class="sub">' + row.d + ' (' + row.shift + ')</span></div>';
    h += '<div class="sub" style="margin-top:4px">Attendant: <b>' + esc(row.worker_name || 'Staff') + '</b></div>';
    h += '<div class="total" style="margin:12px 0 6px">' + inr(row.amount) + '</div>';
    h += '<div class="sub">Status: <span class="ops-pill ' + (row.status === "verified" ? 'ops-pill-ok' : 'ops-pill-warn') + '">' + esc(row.status) + '</span></div>';
    h += '</div>';

    h += '<h4 style="margin:14px 0 6px">Physical Cash Denominations</h4>';
    h += '<div class="tbl" style="margin-bottom:12px"><table>';
    h += '<tr><th>Denomination</th><th class="r">Notes Count</th><th class="r">Amount (₹)</th></tr>';
    var dList = [
      { n: "₹500 Note", c: row.c500, v: 500 },
      { n: "₹200 Note", c: row.c200, v: 200 },
      { n: "₹100 Note", c: row.c100, v: 100 },
      { n: "₹50 Note", c: row.c50, v: 50 },
      { n: "₹20 Note", c: row.c20, v: 20 },
      { n: "₹10 Note", c: row.c10, v: 10 },
      { n: "₹5 Note", c: row.c5, v: 5 },
      { n: "Coins Total", c: row.coins ? 1 : 0, v: row.coins || 0, isCoin: true }
    ];
    dList.forEach(function(item){
      if (!item.c && !item.isCoin) return;
      var amt = item.isCoin ? item.v : (item.c * item.v);
      if (amt <= 0) return;
      h += '<tr><td>' + item.n + '</td><td class="r">' + (item.isCoin ? '—' : item.c) + '</td><td class="r" style="font-weight:700">' + inr(amt) + '</td></tr>';
    });
    h += '<tr style="font-weight:800;background:var(--bg)"><td colspan="2">Total Physical Handover</td><td class="r" style="color:var(--ok)">' + inr(row.amount) + '</td></tr>';
    h += '</table></div>';

    if (row.notes) {
      h += '<div class="sub" style="margin-top:8px"><b>Notes:</b> ' + esc(row.notes) + '</div>';
    }

    h += '<div class="row noprint" style="margin-top:16px"><button onclick="closeM()">Close</button><button class="ghost" onclick="window.print()">Print Slip</button></div>';
    h += '</div>';

    openM(h);
  }

  function openAttendantDropModal(){
    var nowD = today();
    var h = '<div style="max-width:540px">';
    h += '<h2>💵 Log Shift Cash Handover to Vault Safe</h2>';
    h += '<div class="sub" style="margin-bottom:12px">Forecourt attendants deposit collected cash into the back-office cash safe at end-of-shift.</div>';

    h += '<div class="row">';
    h += '<label style="flex:1">Shift Date<input id="vd_date" type="date" value="' + nowD + '"></label>';
    h += '<label style="flex:1">Duty Shift<select id="vd_shift"><option value="Morning">Morning Shift</option><option value="Evening">Evening Shift</option><option value="Night">Night Shift</option></select></label>';
    h += '</div>';

    h += '<h4 style="margin:12px 0 6px">Physical Cash Denomination Counter</h4>';
    h += '<div style="background:var(--bg);padding:10px 12px;border-radius:10px;border:1px solid var(--line);margin-bottom:12px">';
    h += '<div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:8px">';

    var denoms = [
      { id: "c500", label: "₹500 Notes", val: 500 },
      { id: "c200", label: "₹200 Notes", val: 200 },
      { id: "c100", label: "₹100 Notes", val: 100 },
      { id: "c50", label: "₹50 Notes", val: 50 },
      { id: "c20", label: "₹20 Notes", val: 20 },
      { id: "c10", label: "₹10 Notes", val: 10 },
      { id: "c5", label: "₹5 Notes", val: 5 },
      { id: "coins", label: "Coins Total (₹)", val: 1 }
    ];

    denoms.forEach(function(d){
      h += '<div style="display:flex;align-items:center;gap:6px">';
      h += '<span style="font-size:12px;font-weight:700;width:95px">' + d.label + '</span>';
      h += '<input id="vd_' + d.id + '" type="number" min="0" placeholder="0" style="margin:0;padding:6px 8px;font-weight:700" oninput="window.calcVaultDenoms()">';
      h += '</div>';
    });

    h += '</div>';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding-top:8px;border-top:1px dashed var(--line)">';
    h += '<span style="font-size:13px;font-weight:700">Total Physical Cash:</span>';
    h += '<span id="vd_total_calc" style="font-size:20px;font-weight:800;color:var(--ok)">₹0</span>';
    h += '</div>';
    h += '</div>';

    h += '<h4 style="margin:12px 0 6px">Digital Collections & Reconciliation (Optional)</h4>';
    h += '<div class="row">';
    h += '<label style="flex:1">UPI QR (₹)<input id="vd_upi" type="number" min="0" placeholder="0" oninput="window.calcVaultDenoms()"></label>';
    h += '<label style="flex:1">EDC POS Card (₹)<input id="vd_card" type="number" min="0" placeholder="0" oninput="window.calcVaultDenoms()"></label>';
    h += '<label style="flex:1">Fleet Credit Indents (₹)<input id="vd_fleet" type="number" min="0" placeholder="0" oninput="window.calcVaultDenoms()"></label>';
    h += '</div>';

    h += '<div class="row">';
    h += '<label style="flex:1">Expenses Paid from Till (₹)<input id="vd_exp" type="number" min="0" placeholder="0" oninput="window.calcVaultDenoms()"></label>';
    h += '<label style="flex:1">Expected Net Cash (₹)<input id="vd_expected" type="number" min="0" placeholder="From duty reading" oninput="window.calcVaultDenoms()"></label>';
    h += '</div>';

    h += '<div id="vd_diff_box" style="display:none;padding:8px 12px;border-radius:8px;font-size:13px;font-weight:700;margin-bottom:10px"></div>';

    h += '<label>Notes / Handover Memo<textarea id="vd_notes" rows="2" placeholder="e.g. Note bundle verified, ₹500 notes counter checked."></textarea></label>';

    h += '<div class="err" id="vd_err"></div>';
    h += '<div class="row" style="margin-top:12px">';
    h += '<button class="ghost" onclick="closeM()">Cancel</button>';
    h += '<button onclick="submitAttendantDrop()" style="flex:1">Deposit to Safe Vault</button>';
    h += '</div>';
    h += '</div>';

    openM(h);
    setTimeout(window.calcVaultDenoms, 100);
  }

  window.calcVaultDenoms = function(){
    var c500 = parseInt((document.getElementById("vd_c500")||{}).value) || 0;
    var c200 = parseInt((document.getElementById("vd_c200")||{}).value) || 0;
    var c100 = parseInt((document.getElementById("vd_c100")||{}).value) || 0;
    var c50  = parseInt((document.getElementById("vd_c50")||{}).value) || 0;
    var c20  = parseInt((document.getElementById("vd_c20")||{}).value) || 0;
    var c10  = parseInt((document.getElementById("vd_c10")||{}).value) || 0;
    var c5   = parseInt((document.getElementById("vd_c5")||{}).value) || 0;
    var coins= parseFloat((document.getElementById("vd_coins")||{}).value) || 0;

    var totalCash = (c500 * 500) + (c200 * 200) + (c100 * 100) + (c50 * 50) + (c20 * 20) + (c10 * 10) + (c5 * 5) + coins;
    var calcEl = document.getElementById("vd_total_calc");
    if (calcEl) calcEl.textContent = inr(totalCash);

    var expEl = document.getElementById("vd_expected");
    var expVal = expEl ? parseFloat(expEl.value) : NaN;
    var diffBox = document.getElementById("vd_diff_box");

    if (diffBox && !isNaN(expVal) && expVal > 0) {
      var diff = totalCash - expVal;
      diffBox.style.display = "block";
      if (diff === 0) {
        diffBox.style.background = "rgba(11,122,95,0.12)";
        diffBox.style.color = "var(--ok)";
        diffBox.innerHTML = "✅ Perfect Tally: Physical cash matches expected amount exactly.";
      } else if (diff < 0) {
        diffBox.style.background = "rgba(220,38,38,0.12)";
        diffBox.style.color = "var(--due)";
        diffBox.innerHTML = "⚠️ Cash Shortage: " + inr(Math.abs(diff)) + " less than expected net cash.";
      } else {
        diffBox.style.background = "rgba(37,99,235,0.12)";
        diffBox.style.color = "#2563eb";
        diffBox.innerHTML = "ℹ️ Cash Excess: +" + inr(diff) + " above expected net cash.";
      }
    } else if (diffBox) {
      diffBox.style.display = "none";
    }
  };

  function submitAttendantDrop(){
    var c500 = parseInt((document.getElementById("vd_c500")||{}).value) || 0;
    var c200 = parseInt((document.getElementById("vd_c200")||{}).value) || 0;
    var c100 = parseInt((document.getElementById("vd_c100")||{}).value) || 0;
    var c50  = parseInt((document.getElementById("vd_c50")||{}).value) || 0;
    var c20  = parseInt((document.getElementById("vd_c20")||{}).value) || 0;
    var c10  = parseInt((document.getElementById("vd_c10")||{}).value) || 0;
    var c5   = parseInt((document.getElementById("vd_c5")||{}).value) || 0;
    var coins= parseFloat((document.getElementById("vd_coins")||{}).value) || 0;

    var totalCash = (c500 * 500) + (c200 * 200) + (c100 * 100) + (c50 * 50) + (c20 * 20) + (c10 * 10) + (c5 * 5) + coins;
    var errEl = document.getElementById("vd_err");

    if (totalCash <= 0) {
      if (errEl) errEl.textContent = "Please enter cash denomination note counts.";
      return;
    }

    var d = v("vd_date");
    var shift = v("vd_shift");
    var upi = parseFloat(v("vd_upi")) || 0;
    var card = parseFloat(v("vd_card")) || 0;
    var fleet = parseFloat(v("vd_fleet")) || 0;
    var exp = parseFloat(v("vd_exp")) || 0;
    var expected = parseFloat(v("vd_expected")) || totalCash;
    var shortExcess = totalCash - expected;
    var notes = v("vd_notes");

    api("POST", "/api/vault-drops", {
      d: d, shift: shift, drop_type: "attendant_shift_drop",
      amount: totalCash,
      c500: c500, c200: c200, c100: c100, c50: c50, c20: c20, c10: c10, c5: c5, coins: coins,
      digital_upi: upi, digital_card: card, fleet_credit: fleet, expenses_paid: exp,
      expected_cash: expected, short_excess: shortExcess, notes: notes
    }).then(function(){
      closeM();
      toast("Cash shift drop deposited into safe vault!");
      loadVaultData();
    }).catch(function(e){
      if (errEl) errEl.textContent = e.error || "Could not save vault drop.";
    });
  }

  function openBankDepositModal(){
    var nowD = today();
    var h = '<div style="max-width:440px">';
    h += '<h2>🏦 Record Bank Cash Deposit</h2>';
    h += '<div class="sub" style="margin-bottom:12px">Cash taken out of the back-office safe and deposited into station current account (e.g. SBI/HDFC).</div>';

    h += '<label>Date<input id="bd_date" type="date" value="' + nowD + '"></label>';
    h += '<label>Deposit Amount (₹)<input id="bd_amount" type="number" min="1" placeholder="e.g. 100000"></label>';
    h += '<label>Bank Name & Account<input id="bd_bank" type="text" value="State Bank of India (Current A/c)"></label>';
    h += '<label>Bank Pay-in-Slip / Challan Reference #<input id="bd_ref" type="text" placeholder="e.g. SBI-CH-2026-9042"></label>';
    h += '<label>Notes<textarea id="bd_notes" rows="2" placeholder="Deposited by Manager Santosh"></textarea></label>';

    h += '<div class="err" id="bd_err"></div>';
    h += '<div class="row" style="margin-top:12px">';
    h += '<button class="ghost" onclick="closeM()">Cancel</button>';
    h += '<button onclick="submitBankDeposit()" style="flex:1">Deduct from Safe & Record</button>';
    h += '</div>';
    h += '</div>';

    openM(h);
  }

  function submitBankDeposit(){
    var amt = parseFloat(v("bd_amount"));
    var errEl = document.getElementById("bd_err");
    if (!amt || amt <= 0) {
      if (errEl) errEl.textContent = "Please enter valid bank deposit amount.";
      return;
    }
    var d = v("bd_date");
    var bank = v("bd_bank");
    var ref = v("bd_ref");
    var notes = (bank ? "Bank: " + bank + ". " : "") + (ref ? "Slip #: " + ref + ". " : "") + v("bd_notes");

    api("POST", "/api/vault-drops", {
      d: d, shift: "General", drop_type: "bank_deposit", amount: amt, notes: notes
    }).then(function(){
      closeM();
      toast("Bank deposit recorded from vault safe!");
      loadVaultData();
    }).catch(function(e){
      if (errEl) errEl.textContent = e.error || "Could not record deposit.";
    });
  }

  // ==========================================
  // 2. UNDERGROUND TANK WATER PASTE & DIP LOG
  // ==========================================
  function loadWaterDipData(){
    WATER_LOADING = true;
    api("GET", "/api/tank-water-dips?tank_id=" + encodeURIComponent(WATER_FILTER_TANK) + "&search=" + encodeURIComponent(WATER_SEARCH))
      .then(function(res){
        WATER_DATA = res;
        WATER_LOADING = false;
        if (tab === "waterdip") renderWaterDipTab();
      })
      .catch(function(err){
        WATER_LOADING = false;
        toast(err.error || "Could not load water dip data.");
        if (tab === "waterdip") renderWaterDipTab();
      });
  }

  function renderWaterDipTab(){
    tab = "waterdip";
    var A = document.getElementById("app");
    if (!A) return;

    if (!WATER_DATA && !WATER_LOADING) {
      A.innerHTML = nav() + '<div class="empty">Loading tank water finding paste register…</div>';
      loadWaterDipData();
      return;
    }

    var data = WATER_DATA || { water_logs: [], stats: {} };
    var stats = data.stats || {};
    var logs = data.water_logs || [];
    var tanks = (S && S.tanks) || [
      { id: "1791451414419", name: "T1 MS", fuel: "Petrol (MS)" },
      { id: "1791451422410", name: "T2 HSD", fuel: "Diesel (HSD)" },
      { id: "1791451432098", name: "T3 Power", fuel: "Power petrol" }
    ];

    var h = nav();

    // Top Subtabs Switcher
    h += '<div class="ops-subtabs noprint" style="margin-bottom:14px">';
    h += '<button class="ops-subtab-btn" onclick="DENSITY_SUBTAB=\'density\';renderDensityTab()">🌅 15°C Hydrometer Density Log</button>';
    h += '<button class="ops-subtab-btn active" onclick="renderWaterDipTab()">💧 Tank Water Dip & Paste Log (' + logs.length + ')</button>';
    h += '<button class="ops-subtab-btn" onclick="DENSITY_SUBTAB=\'quality\';renderDensityTab()">🧪 Filter Paper & Purity</button>';
    h += '<button class="ops-subtab-btn" onclick="DENSITY_SUBTAB=\'decant\';renderDensityTab()">🚛 Tanker Decantation Register</button>';
    h += '</div>';

    // Header
    h += '<div class="row" style="align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">';
    h += '<div><h1 style="margin:0">🧪 Tank Water Dip & Paste Log</h1><div class="sub" style="margin-top:2px">Daily Kolor-Kut water detecting paste checks to prevent water ingress, phase separation, and suction pipe contamination.</div></div>';
    h += '<div class="btns" style="margin:0;flex:none">';
    h += '<button onclick="openWaterDipModal()" style="display:inline-flex;align-items:center;gap:6px">💧 Log Daily Water Dip</button>';
    h += '<button class="ghost" onclick="loadWaterDipData()" title="Refresh" style="padding:8px 12px">🔄</button>';
    h += '</div></div>';

    // OMC Water Standard Callout Banner
    h += '<div style="background:rgba(11,122,95,0.06);border:1px solid rgba(11,122,95,0.25);border-radius:10px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;gap:12px">';
    h += '<div style="font-size:24px">ℹ️</div>';
    h += '<div style="font-size:12.5px;color:var(--ink);line-height:1.4">';
    h += '<b>OMC Technical Norm:</b> Apply Kolor-Kut water finding paste on the lower 10 cm of the brass dip rod. Safe water level is <b>0 mm (Nil)</b>. Trace moisture below <b>25 mm</b> is permissible. If water dip reaches <b>≥ 50 mm</b>, immediately halt dispenser delivery to prevent water entry into vehicle tanks and drain bottom water immediately.';
    h += '</div></div>';

    // KPI Metrics
    h += '<div class="ops-kpi-bar noprint">';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--ok)">' + (stats.today_checks || 0) + ' / ' + (tanks.length || 3) + '</div><div class="ops-kpi-lbl">Tanks Tested Today</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:' + ((stats.active_water_alerts || 0) > 0 ? 'var(--due)' : 'var(--ok)') + '">' + (stats.active_water_alerts || 0) + '</div><div class="ops-kpi-lbl">Water Contamination Alerts</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num">' + (stats.max_water_mm || 0) + ' mm</div><div class="ops-kpi-lbl">Max Water Level Recorded</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--btn)">' + (stats.total_checks || logs.length) + '</div><div class="ops-kpi-lbl">Total Logged Dips</div></div>';
    h += '</div>';

    // Filters
    h += '<div class="ho-filters noprint">';
    h += '<div class="ho-filter-row">';
    h += '<div class="ho-search-wrap">';
    h += '<span class="ho-search-icon">🔍</span>';
    h += '<input type="text" placeholder="Search by fuel, notes, paste result..." value="' + esc(WATER_SEARCH) + '" oninput="WATER_SEARCH=this.value;loadWaterDipData()">';
    h += '</div>';
    h += '<select style="margin:0;min-width:160px" onchange="WATER_FILTER_TANK=this.value;loadWaterDipData()">';
    h += '<option value="all">⛽ All Storage Tanks</option>';
    tanks.forEach(function(t){
      var sel = (WATER_FILTER_TANK == t.id) ? ' selected' : '';
      h += '<option value="' + t.id + '"' + sel + '>' + esc(t.name) + ' (' + esc(t.fuel) + ')</option>';
    });
    h += '</select>';
    h += '</div></div>';

    if (!logs.length) {
      h += '<div class="empty">No water dip records found for this filter. Tap "+ Log Daily Water Dip" to record morning Kolor-Kut testing.</div>';
    } else {
      h += '<div class="ops-table-wrap">';
      h += '<table class="ops-table">';
      h += '<thead><tr>';
      h += '<th>Date & Time</th><th>Tank & Product</th><th>Fuel Dip</th><th>Water Dip (mm)</th><th>Kolor-Kut Color Change</th><th>Drained (L)</th><th>Compliance Status</th><th>Tested By</th><th>Inspection Remarks</th>';
      h += '</tr></thead><tbody>';

      logs.forEach(function(row){
        var tObj = tanks.find(function(t){ return String(t.id) === String(row.tank_id); }) || { name: "Tank " + row.tank_id };
        var wMm = Number(row.water_dip_mm || 0);

        var pillClass = 'ops-pill-ok', statusLabel = 'Clean / Nil Water';
        if (wMm >= 50) {
          pillClass = 'ops-pill-err';
          statusLabel = 'CRITICAL: Suction Pipe Cutoff!';
        } else if (wMm >= 25) {
          pillClass = 'ops-pill-warn';
          statusLabel = 'Warning: Drain Water Bottom';
        } else if (wMm > 0) {
          pillClass = 'ops-pill-ok';
          statusLabel = 'Trace Moisture (' + wMm + ' mm)';
        }

        h += '<tr>';
        h += '<td style="font-weight:700;white-space:nowrap">' + esc(row.d) + '<br><span class="sub" style="font-size:11px">' + esc(row.time_str || '') + '</span></td>';
        h += '<td><b>' + esc(tObj.name) + '</b><br><span class="sub" style="font-size:11px">' + esc(row.fuel_type) + '</span></td>';
        h += '<td>' + (row.fuel_dip_cm ? row.fuel_dip_cm + ' cm' : '—') + '</td>';
        h += '<td style="font-weight:800;font-size:14px;' + (wMm >= 25 ? 'color:var(--due)' : 'color:var(--ink)') + '">' + wMm + ' mm</td>';
        h += '<td style="font-size:12px">' + esc(row.paste_color_result || 'Gold-Brown (No Water)') + '</td>';
        h += '<td>' + (row.water_drained_litres ? row.water_drained_litres + ' L' : '0 L') + '</td>';
        h += '<td><span class="ops-pill ' + pillClass + '">' + esc(statusLabel) + '</span></td>';
        h += '<td class="sub">' + esc(row.checked_by_name || 'Staff') + '</td>';
        h += '<td class="sub" style="max-width:240px">' + esc(row.notes || 'Routine check OK') + '</td>';
        h += '</tr>';
      });

      h += '</tbody></table></div>';
    }

    A.innerHTML = h;
  }

  function openWaterDipModal(){
    var nowD = today();
    var tanks = (S && S.tanks) || [
      { id: "1791451414419", name: "T1 MS", fuel: "Petrol (MS)" },
      { id: "1791451422410", name: "T2 HSD", fuel: "Diesel (HSD)" },
      { id: "1791451432098", name: "T3 Power", fuel: "Power petrol" }
    ];

    var h = '<div style="max-width:480px">';
    h += '<h2>🧪 Log Daily Tank Water Dip (Kolor-Kut)</h2>';
    h += '<div class="sub" style="margin-bottom:12px">Record morning bottom water check using calibrated brass dip rod with water finding paste.</div>';

    h += '<div class="row">';
    h += '<label style="flex:1">Date<input id="wd_date" type="date" value="' + nowD + '"></label>';
    h += '<label style="flex:1">Check Time<input id="wd_time" type="text" value="06:30 AM"></label>';
    h += '</div>';

    h += '<label>Storage Tank & Fuel<select id="wd_tank" onchange="window.updateWaterDipFuel()">';
    tanks.forEach(function(t){
      h += '<option value="' + t.id + '" data-fuel="' + esc(t.fuel) + '">' + esc(t.name) + ' (' + esc(t.fuel) + ')</option>';
    });
    h += '</select></label>';

    h += '<div class="row">';
    h += '<label style="flex:1">Fuel Dip Level (cm)<input id="wd_dip_cm" type="number" step="0.1" placeholder="e.g. 142.5"></label>';
    h += '<label style="flex:1">Water Dip (mm) *<input id="wd_mm" type="number" step="1" min="0" value="0" placeholder="0 if clean" oninput="window.calcWaterAlertPreview()"></label>';
    h += '</div>';

    h += '<div id="wd_preview_alert" style="display:none;padding:8px 12px;border-radius:8px;font-size:12.5px;font-weight:700;margin-bottom:10px"></div>';

    h += '<label>Kolor-Kut Paste Reaction<select id="wd_result">';
    h += '<option value="No Water (Remains Gold-Brown)">No Water (Remains Gold-Brown) - Clean</option>';
    h += '<option value="Trace Moisture (<10 mm Light Pink)">Trace Moisture (<10 mm Light Pink)</option>';
    h += '<option value="Distinct Water Layer (Bright Scarlet Red)">Distinct Water Layer (Bright Scarlet Red) - Action Needed</option>';
    h += '</select></label>';

    h += '<label>Water Drained (Litres)<input id="wd_drain" type="number" step="0.5" min="0" value="0" placeholder="0"></label>';
    h += '<label>Remarks / Datum Check<textarea id="wd_notes" rows="2" placeholder="e.g. Datum plate clean, Kolor-Kut paste check verified."></textarea></label>';

    h += '<div class="err" id="wd_err"></div>';
    h += '<div class="row" style="margin-top:12px">';
    h += '<button class="ghost" onclick="closeM()">Cancel</button>';
    h += '<button onclick="submitWaterDip()" style="flex:1">Save Water Dip Record</button>';
    h += '</div>';
    h += '</div>';

    openM(h);
    setTimeout(window.calcWaterAlertPreview, 100);
  }

  window.calcWaterAlertPreview = function(){
    var mm = parseFloat((document.getElementById("wd_mm")||{}).value) || 0;
    var pEl = document.getElementById("wd_preview_alert");
    if (!pEl) return;
    pEl.style.display = "block";
    if (mm === 0) {
      pEl.style.background = "rgba(11,122,95,0.12)";
      pEl.style.color = "var(--ok)";
      pEl.innerHTML = "✅ 0 mm: Completely clean tank bottom. Zero water contamination.";
    } else if (mm < 25) {
      pEl.style.background = "rgba(217,119,6,0.12)";
      pEl.style.color = "#b45309";
      pEl.innerHTML = "⚠️ " + mm + " mm: Minor condensation moisture. Permissible, monitor closely tomorrow.";
    } else if (mm < 50) {
      pEl.style.background = "rgba(220,38,38,0.12)";
      pEl.style.color = "var(--due)";
      pEl.innerHTML = "🚨 " + mm + " mm: Water approaching caution line! Schedule water pumping drain immediately.";
    } else {
      pEl.style.background = "rgba(220,38,38,0.2)";
      pEl.style.color = "var(--due)";
      pEl.innerHTML = "🛑 " + mm + " mm: CRITICAL ALERT! Suction cutoff threshold reached. Halt dispensing from this tank immediately!";
    }
  };

  function submitWaterDip(){
    var tankEl = document.getElementById("wd_tank");
    var opt = tankEl ? tankEl.options[tankEl.selectedIndex] : null;
    var tankId = tankEl ? tankEl.value : "";
    var fuel = opt ? opt.getAttribute("data-fuel") : "Diesel (HSD)";
    var d = v("wd_date");
    var timeStr = v("wd_time");
    var dipCm = v("wd_dip_cm");
    var mm = v("wd_mm");
    var res = v("wd_result");
    var drain = v("wd_drain");
    var notes = v("wd_notes");
    var errEl = document.getElementById("wd_err");

    if (mm === "" || isNaN(parseFloat(mm))) {
      if (errEl) errEl.textContent = "Please enter water dip measurement in mm (0 if clean).";
      return;
    }

    api("POST", "/api/tank-water-dips", {
      d: d, time_str: timeStr, tank_id: tankId, fuel_type: fuel,
      fuel_dip_cm: dipCm ? parseFloat(dipCm) : null,
      water_dip_mm: parseFloat(mm),
      paste_color_result: res,
      water_drained_litres: drain ? parseFloat(drain) : 0,
      notes: notes
    }).then(function(){
      closeM();
      toast("Tank water dip check logged successfully!");
      loadWaterDipData();
    }).catch(function(e){
      if (errEl) errEl.textContent = e.error || "Could not save water dip.";
    });
  }

  // ==========================================
  // 3. STATUTORY & PESO COMPLIANCE TRACKER
  // ==========================================
  function loadComplianceData(){
    COMPLIANCE_LOADING = true;
    api("GET", "/api/statutory-licenses?category=" + encodeURIComponent(COMPLIANCE_CAT) + "&status=" + encodeURIComponent(COMPLIANCE_STATUS))
      .then(function(res){
        COMPLIANCE_DATA = res;
        COMPLIANCE_LOADING = false;
        if (tab === "compliance") renderComplianceTab();
      })
      .catch(function(err){
        COMPLIANCE_LOADING = false;
        toast(err.error || "Could not load statutory licenses.");
        if (tab === "compliance") renderComplianceTab();
      });
  }

  function renderComplianceTab(){
    tab = "compliance";
    var A = document.getElementById("app");
    if (!A) return;

    if (!COMPLIANCE_DATA && !COMPLIANCE_LOADING) {
      A.innerHTML = nav() + '<div class="empty">Loading PESO and statutory compliance licenses…</div>';
      loadComplianceData();
      return;
    }

    var data = COMPLIANCE_DATA || { licenses: [], stats: {} };
    var stats = data.stats || {};
    var licenses = data.licenses || [];

    var h = nav();

    // Header
    h += '<div class="row" style="align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">';
    h += '<div><h1 style="margin:0">📜 Statutory & PESO Compliance Tracker</h1><div class="sub" style="margin-top:2px">Petroleum storage & dispensing licenses, Legal Metrology stamping, Fire NOC, Tank hydro-testing & environmental consents.</div></div>';
    h += '<div class="btns" style="margin:0;flex:none">';
    if (ME && (ME.role === "owner" || ME.role === "manager")) {
      h += '<button onclick="openAddLicenseModal()" style="display:inline-flex;align-items:center;gap:6px">➕ Add License / Certificate</button>';
    }
    h += '<button class="ghost" onclick="loadComplianceData()" title="Refresh" style="padding:8px 12px">🔄</button>';
    h += '</div></div>';

    // Expiry Notice Banner if any license expiring soon
    if (stats.expiring_soon > 0 || stats.expired > 0) {
      h += '<div style="background:rgba(217,119,6,0.12);border:1px solid rgba(217,119,6,0.3);border-radius:10px;padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px">';
      h += '<div style="display:flex;align-items:center;gap:10px">';
      h += '<div style="font-size:24px">⚠️</div>';
      h += '<div style="font-size:13px;color:#92400e;line-height:1.4"><b>Statutory Renewal Attention Required:</b> You have <b>' + (stats.expiring_soon || 0) + '</b> certificate(s) expiring within the next 45 days and <b>' + (stats.expired || 0) + '</b> expired. Ensure renewal filings are submitted to prevent penalties or sales halts.</div>';
      h += '</div>';
      h += '</div>';
    }

    // KPI Metrics
    h += '<div class="ops-kpi-bar noprint">';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--ink)">' + (stats.total || licenses.length) + '</div><div class="ops-kpi-lbl">Total Regulatory Licenses</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--ok)">' + (stats.active || 0) + '</div><div class="ops-kpi-lbl">Active & Fully Compliant</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:#b45309">' + (stats.expiring_soon || 0) + '</div><div class="ops-kpi-lbl">Expiring in &lt; 45 Days</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:' + ((stats.expired || 0) > 0 ? 'var(--due)' : 'var(--ok)') + '">' + (stats.expired || 0) + '</div><div class="ops-kpi-lbl">Expired / Overdue</div></div>';
    h += '</div>';

    // Filters
    h += '<div class="ho-filters noprint">';
    h += '<div class="ho-filter-row">';
    h += '<select style="margin:0;min-width:160px" onchange="COMPLIANCE_CAT=this.value;loadComplianceData()">';
    h += '<option value="all">📂 All License Categories</option>';
    h += '<option value="PESO Explosives"' + (COMPLIANCE_CAT==="PESO Explosives"?" selected":"") + '>PESO Explosives</option>';
    h += '<option value="Weights & Measures"' + (COMPLIANCE_CAT==="Weights & Measures"?" selected":"") + '>Weights & Measures (Legal Metrology)</option>';
    h += '<option value="Fire Safety"' + (COMPLIANCE_CAT==="Fire Safety"?" selected":"") + '>Fire Department NOC</option>';
    h += '<option value="Tank Integrity"' + (COMPLIANCE_CAT==="Tank Integrity"?" selected":"") + '>Tank Hydro-Testing</option>';
    h += '<option value="Environmental"' + (COMPLIANCE_CAT==="Environmental"?" selected":"") + '>State PCB Consent</option>';
    h += '<option value="Insurance"' + (COMPLIANCE_CAT==="Insurance"?" selected":"") + '>Insurance Policies</option>';
    h += '</select>';
    h += '<select style="margin:0;min-width:140px" onchange="COMPLIANCE_STATUS=this.value;loadComplianceData()">';
    h += '<option value="all">Status: All</option>';
    h += '<option value="active"' + (COMPLIANCE_STATUS==="active"?" selected":"") + '>Active Only</option>';
    h += '<option value="expiring_soon"' + (COMPLIANCE_STATUS==="expiring_soon"?" selected":"") + '>Expiring Soon</option>';
    h += '</select>';
    h += '</div></div>';

    if (!licenses.length) {
      h += '<div class="empty">No statutory licenses recorded for this filter. Tap "+ Add License / Certificate" to record regulatory approvals.</div>';
    } else {
      h += '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:14px;margin-bottom:16px">';
      licenses.forEach(function(lic){
        var days = lic.days_left;
        var pillClass = 'ops-pill-ok', statusText = 'Active · ' + days + ' days left';
        if (days < 0) {
          pillClass = 'ops-pill-err';
          statusText = 'EXPIRED (' + Math.abs(days) + ' days ago)';
        } else if (days <= (lic.renewal_reminder_days || 30)) {
          pillClass = 'ops-pill-warn';
          statusText = 'EXPIRING SOON · ' + days + ' days left';
        }

        h += '<div class="ops-card" style="display:flex;flex-direction:column;justify-content:space-between">';
        h += '<div>';
        h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">';
        h += '<span class="ops-pill ' + (lic.category.indexOf("PESO")>-1?'ops-pill-info':'ops-pill-ok') + '" style="font-size:10px">' + esc(lic.category) + '</span>';
        h += '<span class="ops-pill ' + pillClass + '" style="font-size:10.5px">' + esc(statusText) + '</span>';
        h += '</div>';

        h += '<h3 style="margin:0 0 4px;font-size:15px;color:var(--ink)">' + esc(lic.license_type) + '</h3>';
        h += '<div style="font-size:12px;font-weight:700;color:var(--btn);font-family:monospace;margin-bottom:8px">' + esc(lic.license_no) + '</div>';
        h += '<div class="sub" style="font-size:12px;margin-bottom:4px"><b>Authority:</b> ' + esc(lic.authority) + '</div>';
        h += '<div class="sub" style="font-size:12px;margin-bottom:4px"><b>Issued to:</b> ' + esc(lic.issued_to) + '</div>';
        h += '<div class="sub" style="font-size:12px;margin-bottom:6px"><b>Validity:</b> ' + esc(lic.issue_date) + ' to <b>' + esc(lic.expiry_date) + '</b></div>';

        if (lic.notes) {
          h += '<div style="font-size:11.5px;color:var(--mute);background:var(--bg);padding:6px 10px;border-radius:6px;margin-top:6px;line-height:1.3">' + esc(lic.notes) + '</div>';
        }
        h += '</div>';

        h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid var(--line)">';
        h += '<span class="sub" style="font-size:11px">' + (lic.document_ref ? '📎 ' + esc(lic.document_ref) : '') + '</span>';
        if (ME && (ME.role === "owner" || ME.role === "manager")) {
          h += '<button class="ghost" onclick="openRenewLicenseModal(' + lic.id + ')" style="padding:4px 10px;font-size:11px">🔄 Renew Certificate</button>';
        }
        h += '</div>';
        h += '</div>';
      });
      h += '</div>';
    }

    A.innerHTML = h;
  }

  function openAddLicenseModal(){
    var nowD = today();
    var h = '<div style="max-width:500px">';
    h += '<h2>📜 Register Statutory / PESO License</h2>';
    h += '<div class="sub" style="margin-bottom:12px">Add a regulatory license with automatic renewal reminders and countdowns.</div>';

    h += '<label>License / Certificate Title *<input id="lic_type" type="text" placeholder="e.g. PESO Storage License Form XIV"></label>';

    h += '<div class="row">';
    h += '<label style="flex:1">Category<select id="lic_cat"><option value="PESO Explosives">PESO Explosives</option><option value="Weights & Measures">Weights & Measures</option><option value="Fire Safety">Fire Safety</option><option value="Tank Integrity">Tank Integrity</option><option value="Environmental">State PCB Consent</option><option value="Insurance">Insurance Policy</option><option value="Electrical Safety">Electrical Safety</option></select></label>';
    h += '<label style="flex:1">License / Reg Number *<input id="lic_no" type="text" placeholder="e.g. P/WC/MH/14/4819"></label>';
    h += '</div>';

    h += '<label>Issuing Authority<input id="lic_auth" type="text" placeholder="e.g. Petroleum & Explosives Safety Organisation (Nagpur)"></label>';
    h += '<label>Issued In Favor Of<input id="lic_to" type="text" placeholder="Retail Outlet Name"></label>';

    h += '<div class="row">';
    h += '<label style="flex:1">Issue Date<input id="lic_issue" type="date" value="' + nowD + '"></label>';
    h += '<label style="flex:1">Expiry Date *<input id="lic_exp" type="date"></label>';
    h += '</div>';

    h += '<div class="row">';
    h += '<label style="flex:1">Reminder (Days Before)<input id="lic_remind" type="number" value="30"></label>';
    h += '<label style="flex:1">Govt / Stamping Fee (₹)<input id="lic_fee" type="number" placeholder="0"></label>';
    h += '</div>';

    h += '<label>Document File Reference<input id="lic_ref" type="text" placeholder="e.g. PESO-RENEWAL-2026.pdf"></label>';
    h += '<label>Scope / Tank Capacities / Remarks<textarea id="lic_notes" rows="2" placeholder="e.g. Valid for 45 KL MS and 70 KL HSD storage tanks."></textarea></label>';

    h += '<div class="err" id="lic_err"></div>';
    h += '<div class="row" style="margin-top:12px">';
    h += '<button class="ghost" onclick="closeM()">Cancel</button>';
    h += '<button onclick="submitLicense()" style="flex:1">Save License Record</button>';
    h += '</div>';
    h += '</div>';

    openM(h);
  }

  function submitLicense(){
    var type = v("lic_type");
    var cat = v("lic_cat");
    var no = v("lic_no");
    var auth = v("lic_auth");
    var to = v("lic_to");
    var issue = v("lic_issue");
    var exp = v("lic_exp");
    var remind = v("lic_remind");
    var fee = v("lic_fee");
    var ref = v("lic_ref");
    var notes = v("lic_notes");
    var errEl = document.getElementById("lic_err");

    if (!type || !no || !exp) {
      if (errEl) errEl.textContent = "Please enter License Title, License Number, and Expiry Date.";
      return;
    }

    api("POST", "/api/statutory-licenses", {
      license_type: type, category: cat, license_no: no, authority: auth,
      issued_to: to, issue_date: issue, expiry_date: exp,
      renewal_reminder_days: remind ? parseInt(remind) : 30,
      fee_amount: fee ? parseFloat(fee) : 0, document_ref: ref, notes: notes
    }).then(function(){
      closeM();
      toast("Statutory license registered successfully!");
      loadComplianceData();
    }).catch(function(e){
      if (errEl) errEl.textContent = e.error || "Could not save license.";
    });
  }

  function openRenewLicenseModal(id){
    if (!COMPLIANCE_DATA || !COMPLIANCE_DATA.licenses) return;
    var lic = COMPLIANCE_DATA.licenses.find(function(x){ return x.id === id; });
    if (!lic) return;

    var h = '<div style="max-width:440px">';
    h += '<h2>🔄 Renew Statutory Certificate</h2>';
    h += '<div class="ops-card" style="margin:10px 0">';
    h += '<b>' + esc(lic.license_type) + '</b><br><span class="sub">Current Exp: ' + lic.expiry_date + ' (#' + lic.license_no + ')</span>';
    h += '</div>';

    h += '<label>New Validity / Expiry Date *<input id="ren_exp" type="date"></label>';
    h += '<label>Updated Certificate / Receipt Number (if changed)<input id="ren_no" type="text" placeholder="' + esc(lic.license_no) + '"></label>';
    h += '<label>Renewal Fee Paid (₹)<input id="ren_fee" type="number" placeholder="e.g. 5000"></label>';
    h += '<label>Renewal Endorsement Notes<textarea id="ren_notes" rows="2" placeholder="e.g. Stamping officer visited forecourt, lead seals verified intact."></textarea></label>';

    h += '<div class="err" id="ren_err"></div>';
    h += '<div class="row" style="margin-top:12px">';
    h += '<button class="ghost" onclick="closeM()">Cancel</button>';
    h += '<button onclick="submitRenewLicense(' + lic.id + ')" style="flex:1">Update Renewal</button>';
    h += '</div>';
    h += '</div>';

    openM(h);
  }

  function submitRenewLicense(id){
    var newExp = v("ren_exp");
    var newNo = v("ren_no");
    var fee = v("ren_fee");
    var notes = v("ren_notes");
    var errEl = document.getElementById("ren_err");

    if (!newExp) {
      if (errEl) errEl.textContent = "Please enter new validity expiry date.";
      return;
    }

    api("POST", "/api/statutory-licenses/" + id + "/renew", {
      new_expiry_date: newExp, new_license_no: newNo,
      fee_amount: fee ? parseFloat(fee) : 0, notes: notes
    }).then(function(){
      closeM();
      toast("License renewed successfully!");
      loadComplianceData();
    }).catch(function(e){
      if (errEl) errEl.textContent = e.error || "Could not renew license.";
    });
  }

  // ==========================================
  // 4. FORECOURT EQUIPMENT BREAKDOWN & TICKETING
  // ==========================================
  function loadEquipmentData(){
    EQUIP_LOADING = true;
    api("GET", "/api/equipment-tickets?status=" + encodeURIComponent(EQUIP_SUBTAB === "all" ? "all" : (EQUIP_SUBTAB === "active" ? "open" : "resolved")) + "&priority=" + encodeURIComponent(EQUIP_PRIORITY) + "&search=" + encodeURIComponent(EQUIP_SEARCH))
      .then(function(res){
        EQUIP_DATA = res;
        EQUIP_LOADING = false;
        if (tab === "equipment") renderEquipmentTab();
      })
      .catch(function(err){
        EQUIP_LOADING = false;
        toast(err.error || "Could not load equipment tickets.");
        if (tab === "equipment") renderEquipmentTab();
      });
  }

  function renderEquipmentTab(){
    tab = "equipment";
    var A = document.getElementById("app");
    if (!A) return;

    if (!EQUIP_DATA && !EQUIP_LOADING) {
      A.innerHTML = nav() + '<div class="empty">Loading equipment maintenance records…</div>';
      loadEquipmentData();
      return;
    }

    var data = EQUIP_DATA || { tickets: [], stats: {} };
    var stats = data.stats || {};
    var tickets = data.tickets || [];

    var mainTab = window.EQUIP_MAINT_SUBTAB || "equipment";
    if (mainTab === "generator") {
      return renderGeneratorTab();
    }

    var h = nav();

    // Top Module Clubbed Switcher
    h += '<div class="ops-subtabs noprint" style="margin-bottom:14px;background:rgba(0,0,0,0.03);padding:4px;border-radius:10px">';
    h += '<button class="ops-subtab-btn active" onclick="window.EQUIP_MAINT_SUBTAB=\'equipment\';renderEquipmentTab()">🔧 Forecourt Equipment Breakdown (' + tickets.length + ')</button>';
    h += '<button class="ops-subtab-btn" onclick="window.EQUIP_MAINT_SUBTAB=\'generator\';renderEquipmentTab()">⚡ DG Generator & Power Log</button>';
    h += '</div>';

    // Header
    h += '<div class="row" style="align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">';
    h += '<div><h1 style="margin:0">🔧 Forecourt Equipment & Breakdown Log</h1><div class="sub" style="margin-top:2px">Dispensers (DU), nozzles, hoses, STP submersible turbine pumps, air inflator tower & vendor service SLAs.</div></div>';
    h += '<div class="btns" style="margin:0;flex:none">';
    h += '<button onclick="openReportTicketModal()" style="display:inline-flex;align-items:center;gap:6px">🚨 Report Breakdown Ticket</button>';
    h += '<button class="ghost" onclick="loadEquipmentData()" title="Refresh" style="padding:8px 12px">🔄</button>';
    h += '</div></div>';

    // KPI Metrics
    h += '<div class="ops-kpi-bar noprint">';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:' + ((stats.open_tickets || 0) > 0 ? 'var(--warn)' : 'var(--ok)') + '">' + (stats.open_tickets || 0) + '</div><div class="ops-kpi-lbl">Active Breakdown Tickets</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:' + ((stats.critical_tickets || 0) > 0 ? 'var(--due)' : 'var(--ok)') + '">' + (stats.critical_tickets || 0) + '</div><div class="ops-kpi-lbl">Critical / Bay Down</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num">' + (stats.avg_downtime_hours || 0) + ' hrs</div><div class="ops-kpi-lbl">Avg Resolution Downtime</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--btn)">' + inr(stats.total_repair_cost || 0) + '</div><div class="ops-kpi-lbl">Total Maintenance Cost</div></div>';
    h += '</div>';

    // Subtabs Switcher
    h += '<div class="ops-subtabs noprint">';
    h += '<button class="ops-subtab-btn ' + (EQUIP_SUBTAB === "active" ? 'active' : '') + '" onclick="EQUIP_SUBTAB=\'active\';renderEquipmentTab()">🚨 Active Tickets (Open / In Progress)</button>';
    h += '<button class="ops-subtab-btn ' + (EQUIP_SUBTAB === "resolved" ? 'active' : '') + '" onclick="EQUIP_SUBTAB=\'resolved\';renderEquipmentTab()">✅ Resolved History (' + tickets.filter(function(x){return x.status==="resolved"}).length + ')</button>';
    h += '<button class="ops-subtab-btn ' + (EQUIP_SUBTAB === "all" ? 'active' : '') + '" onclick="EQUIP_SUBTAB=\'all\';renderEquipmentTab()">📋 All Tickets (' + tickets.length + ')</button>';
    h += '</div>';

    // Filters
    h += '<div class="ho-filters noprint">';
    h += '<div class="ho-filter-row">';
    h += '<div class="ho-search-wrap">';
    h += '<span class="ho-search-icon">🔍</span>';
    h += '<input type="text" placeholder="Search by ticket #, equipment, vendor, issue..." value="' + esc(EQUIP_SEARCH) + '" oninput="EQUIP_SEARCH=this.value;loadEquipmentData()">';
    h += '</div>';
    h += '<select style="margin:0;min-width:140px" onchange="EQUIP_PRIORITY=this.value;loadEquipmentData()">';
    h += '<option value="all">All Priorities</option>';
    h += '<option value="Critical"' + (EQUIP_PRIORITY==="Critical"?" selected":"") + '>Critical Priority</option>';
    h += '<option value="Urgent"' + (EQUIP_PRIORITY==="Urgent"?" selected":"") + '>Urgent</option>';
    h += '<option value="Routine"' + (EQUIP_PRIORITY==="Routine"?" selected":"") + '>Routine / Preventive</option>';
    h += '</select>';
    h += '</div></div>';

    var filtered = tickets.filter(function(t){
      if (EQUIP_SUBTAB === "active") return t.status === "open" || t.status === "in_progress";
      if (EQUIP_SUBTAB === "resolved") return t.status === "resolved";
      return true;
    });

    if (!filtered.length) {
      h += '<div class="empty">No equipment tickets found for this view. Forecourt equipment is running smoothly!</div>';
    } else {
      h += '<div style="display:flex;flex-direction:column;gap:12px;margin-bottom:16px">';
      filtered.forEach(function(t){
        var isCritical = t.priority === "Critical";
        var isResolved = t.status === "resolved";
        var priorClass = isCritical ? 'ops-pill-err' : (t.priority === "Urgent" ? 'ops-pill-warn' : 'ops-pill-info');
        var statClass = isResolved ? 'ops-pill-ok' : (t.status === "in_progress" ? 'ops-pill-warn' : 'ops-pill-err');

        h += '<div class="ops-card" style="border-left:4px solid ' + (isCritical ? 'var(--due)' : (isResolved ? 'var(--ok)' : '#d97706')) + '">';
        h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:6px">';
        h += '<div>';
        h += '<span style="font-size:12px;font-weight:800;color:var(--btn);font-family:monospace;margin-right:8px">' + esc(t.ticket_no) + '</span>';
        h += '<b style="font-size:15px;color:var(--ink)">' + esc(t.equipment_name) + '</b>';
        h += '<div class="sub" style="font-size:12px;margin-top:2px">📍 ' + esc(t.island_bay) + ' · Type: ' + esc(t.equipment_type) + '</div>';
        h += '</div>';

        h += '<div style="display:flex;gap:6px;align-items:center">';
        h += '<span class="ops-pill ' + priorClass + '">' + esc(t.priority) + '</span>';
        h += '<span class="ops-pill ' + statClass + '">' + (isResolved ? 'Resolved' : (t.status === 'in_progress' ? 'In Progress' : 'Open Ticket')) + '</span>';
        h += '</div>';
        h += '</div>';

        h += '<div style="font-size:13px;color:var(--ink);background:var(--bg);padding:8px 12px;border-radius:8px;margin:8px 0;line-height:1.4">';
        h += '<b>Issue:</b> ' + esc(t.issue_description);
        h += '</div>';

        h += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;font-size:12px;color:var(--mute)">';
        h += '<div>';
        h += '👤 <b>Vendor:</b> ' + esc(t.vendor_name) + (t.vendor_contact ? ' (' + esc(t.vendor_contact) + ')' : '') + '<br>';
        h += 'Reported by ' + esc(t.reported_by_name || 'Staff') + (isResolved ? ' · Downtime: <b>' + t.downtime_hours + ' hrs</b> · Cost: <b>' + inr(t.repair_cost) + '</b>' : '');
        h += '</div>';

        if (!isResolved) {
          h += '<button onclick="openResolveTicketModal(' + t.id + ')" style="padding:6px 12px;font-size:12px">Mark as Resolved</button>';
        } else if (t.spares_replaced) {
          h += '<span class="sub" style="font-size:11px">Spares: ' + esc(t.spares_replaced) + '</span>';
        }
        h += '</div>';
        h += '</div>';
      });
      h += '</div>';
    }

    A.innerHTML = h;
  }

  function openReportTicketModal(){
    var h = '<div style="max-width:480px">';
    h += '<h2>🚨 Log Forecourt Equipment Breakdown</h2>';
    h += '<div class="sub" style="margin-bottom:12px">Create a maintenance service ticket for dispensing units, nozzles, pumps or air towers.</div>';

    h += '<label>Equipment Name *<input id="eq_name" type="text" placeholder="e.g. Dispenser DU-2 (Nozzle N3 Diesel)"></label>';

    h += '<div class="row">';
    h += '<label style="flex:1">Equipment Type<select id="eq_type"><option value="Dispenser / DU">Dispenser / MPD (DU)</option><option value="Nozzle / Swivel / Breakaway">Nozzle / Swivel / Breakaway</option><option value="Delivery Hose">Delivery Hose</option><option value="STP Pump">Submersible Turbine Pump (STP)</option><option value="Air Compressor / Tower">Digital Air Tower</option><option value="Genset">Generator / DG</option><option value="Automation / POS">Automation / POS Console</option></select></label>';
    h += '<label style="flex:1">Island / Bay Location *<input id="eq_bay" type="text" placeholder="e.g. Bay 2 (Highway Exit)"></label>';
    h += '</div>';

    h += '<div class="row">';
    h += '<label style="flex:1">Priority<select id="eq_prior"><option value="Urgent">Urgent (Bay partially down)</option><option value="Critical">Critical (Complete bay halted)</option><option value="Routine">Routine / Minor leak</option></select></label>';
    h += '<label style="flex:1">Service Vendor<select id="eq_vendor"><option value="Gilbarco Veeder-Root">Gilbarco Veeder-Root</option><option value="Midco Services">Midco Services</option><option value="Tokheim India">Tokheim India</option><option value="ATS Elgi Technical">ATS Elgi (Air Tower)</option><option value="KOEL Care">KOEL Kirloskar (Genset)</option><option value="Local Pump Tech">Local Outlet Electrician</option></select></label>';
    h += '</div>';

    h += '<label>Vendor Tech Contact Phone<input id="eq_phone" type="text" placeholder="+91 98220 11984"></label>';
    h += '<label>Issue Description & Symptoms *<textarea id="eq_desc" rows="3" placeholder="Describe the fault: e.g. Automatic nozzle cutoff trigger sticking, fuel weeping from swivel joint."></textarea></label>';

    h += '<div class="err" id="eq_err"></div>';
    h += '<div class="row" style="margin-top:12px">';
    h += '<button class="ghost" onclick="closeM()">Cancel</button>';
    h += '<button onclick="submitEquipmentTicket()" style="flex:1">Create Ticket & Dispatch</button>';
    h += '</div>';
    h += '</div>';

    openM(h);
  }

  function submitEquipmentTicket(){
    var name = v("eq_name");
    var type = v("eq_type");
    var bay = v("eq_bay");
    var prior = v("eq_prior");
    var vendor = v("eq_vendor");
    var phone = v("eq_phone");
    var desc = v("eq_desc");
    var errEl = document.getElementById("eq_err");

    if (!name || !desc) {
      if (errEl) errEl.textContent = "Please enter Equipment Name and Issue Description.";
      return;
    }

    api("POST", "/api/equipment-tickets", {
      equipment_name: name, equipment_type: type, island_bay: bay,
      priority: prior, vendor_name: vendor, vendor_contact: phone,
      issue_description: desc
    }).then(function(){
      closeM();
      toast("Equipment breakdown ticket logged!");
      loadEquipmentData();
    }).catch(function(e){
      if (errEl) errEl.textContent = e.error || "Could not create ticket.";
    });
  }

  function openResolveTicketModal(id){
    if (!EQUIP_DATA || !EQUIP_DATA.tickets) return;
    var t = EQUIP_DATA.tickets.find(function(x){ return x.id === id; });
    if (!t) return;

    var h = '<div style="max-width:440px">';
    h += '<h2>✅ Close & Resolve Equipment Ticket</h2>';
    h += '<div class="ops-card" style="margin:10px 0">';
    h += '<b>' + esc(t.equipment_name) + '</b><br><span class="sub">Ticket #' + t.ticket_no + ' · ' + esc(t.island_bay) + '</span>';
    h += '</div>';

    h += '<div class="row">';
    h += '<label style="flex:1">Downtime Duration (Hours)<input id="res_down" type="number" step="0.5" placeholder="e.g. 2.5"></label>';
    h += '<label style="flex:1">Repair / Invoice Cost (₹)<input id="res_cost" type="number" placeholder="0"></label>';
    h += '</div>';

    h += '<label>Spare Parts Replaced / Serviced<input id="res_spares" type="text" placeholder="e.g. Swivel joint seal kit + O-rings"></label>';
    h += '<label>Technician Resolution Notes<textarea id="res_notes" rows="2" placeholder="Tested with 5L measure, nozzle shut-off verified. Bay reopened."></textarea></label>';

    h += '<div class="err" id="res_err"></div>';
    h += '<div class="row" style="margin-top:12px">';
    h += '<button class="ghost" onclick="closeM()">Cancel</button>';
    h += '<button onclick="submitResolveTicket(' + t.id + ')" style="flex:1">Mark Ticket as Resolved</button>';
    h += '</div>';
    h += '</div>';

    openM(h);
  }

  function submitResolveTicket(id){
    var down = v("res_down");
    var cost = v("res_cost");
    var spares = v("res_spares");
    var notes = v("res_notes");

    api("POST", "/api/equipment-tickets/" + id + "/resolve", {
      downtime_hours: down ? parseFloat(down) : 0,
      repair_cost: cost ? parseFloat(cost) : 0,
      spares_replaced: spares, notes: notes
    }).then(function(){
      closeM();
      toast("Equipment ticket closed and operational!");
      loadEquipmentData();
    }).catch(function(e){
      var errEl = document.getElementById("res_err");
      if (errEl) errEl.textContent = e.error || "Could not resolve ticket.";
    });
  }

  // ==========================================
  // 5. DRIVER LOYALTY & COMMERCIAL KHATA
  // ==========================================
  function loadLoyaltyData(){
    LOYALTY_LOADING = true;
    api("GET", "/api/driver-loyalty?type=" + encodeURIComponent(LOYALTY_TYPE) + "&search=" + encodeURIComponent(LOYALTY_SEARCH))
      .then(function(res){
        LOYALTY_DATA = res;
        LOYALTY_LOADING = false;
        if (tab === "loyalty") renderLoyaltyTab();
      })
      .catch(function(err){
        LOYALTY_LOADING = false;
        toast(err.error || "Could not load driver loyalty data.");
        if (tab === "loyalty") renderLoyaltyTab();
      });
  }

  function renderLoyaltyTab(){
    tab = "loyalty";
    var A = document.getElementById("app");
    if (!A) return;

    if (!LOYALTY_DATA && !LOYALTY_LOADING) {
      A.innerHTML = nav() + '<div class="empty">Loading driver loyalty and commercial khata…</div>';
      loadLoyaltyData();
      return;
    }

    var data = LOYALTY_DATA || { members: [], recent_transactions: [], stats: {} };
    var stats = data.stats || {};
    var members = data.members || [];
    var txns = data.recent_transactions || [];

    var h = nav();

    // Top Clubbed Switcher
    h += '<div class="ops-subtabs noprint" style="margin-bottom:14px;background:rgba(0,0,0,0.03);padding:4px;border-radius:10px">';
    h += '<button class="ops-subtab-btn" onclick="window.INDENTS_SUBTAB=\'indents\';renderIndentsTab()">🎫 Fleet Indents & Driver OTP</button>';
    h += '<button class="ops-subtab-btn active" onclick="window.INDENTS_SUBTAB=\'loyalty\';renderLoyaltyTab()">⭐ Driver Loyalty & Commercial Khata</button>';
    h += '</div>';

    // Header
    h += '<div class="row" style="align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">';
    h += '<div><h1 style="margin:0">⭐ Driver Loyalty & Commercial Khata</h1><div class="sub" style="margin-top:2px">Frequent driver rewards program (Auto unions, taxis, tractors, tempos) with points-per-litre and instant balance statements.</div></div>';
    h += '<div class="btns" style="margin:0;flex:none">';
    h += '<button onclick="openRegisterDriverModal()" style="display:inline-flex;align-items:center;gap:6px">➕ Register Driver</button>';
    h += '<button class="ghost" onclick="loadLoyaltyData()" title="Refresh" style="padding:8px 12px">🔄</button>';
    h += '</div></div>';

    // KPI Metrics
    h += '<div class="ops-kpi-bar noprint">';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--ink)">' + (stats.total_members || members.length) + '</div><div class="ops-kpi-lbl">Enrolled Drivers</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--ok)">' + (stats.total_points_bank || 0) + ' pts</div><div class="ops-kpi-lbl">Active Loyalty Points</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--btn)">' + (stats.total_litres_rewarded ? (stats.total_litres_rewarded).toLocaleString("en-IN") + ' L' : '0 L') + '</div><div class="ops-kpi-lbl">Volume Fuelled by Members</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:' + ((stats.total_khata_due || 0) > 0 ? 'var(--warn)' : 'var(--ok)') + '">' + inr(stats.total_khata_due || 0) + '</div><div class="ops-kpi-lbl">Driver Khata Balance Dues</div></div>';
    h += '</div>';

    // Subtabs Switcher
    h += '<div class="ops-subtabs noprint">';
    h += '<button class="ops-subtab-btn ' + (LOYALTY_SUBTAB === "members" ? 'active' : '') + '" onclick="LOYALTY_SUBTAB=\'members\';renderLoyaltyTab()">🚗 Driver Directory (' + members.length + ')</button>';
    h += '<button class="ops-subtab-btn ' + (LOYALTY_SUBTAB === "txns" ? 'active' : '') + '" onclick="LOYALTY_SUBTAB=\'txns\';renderLoyaltyTab()">📜 Transaction Ledger (' + txns.length + ')</button>';
    h += '</div>';

    // Filters
    h += '<div class="ho-filters noprint">';
    h += '<div class="ho-filter-row">';
    h += '<div class="ho-search-wrap">';
    h += '<span class="ho-search-icon">🔍</span>';
    h += '<input type="text" placeholder="Search by name, mobile, vehicle #, card code..." value="' + esc(LOYALTY_SEARCH) + '" oninput="LOYALTY_SEARCH=this.value;loadLoyaltyData()">';
    h += '</div>';
    h += '<select style="margin:0;min-width:150px" onchange="LOYALTY_TYPE=this.value;loadLoyaltyData()">';
    h += '<option value="all">All Vehicles</option>';
    h += '<option value="Auto Rickshaw"' + (LOYALTY_TYPE==="Auto Rickshaw"?" selected":"") + '>Auto Rickshaw</option>';
    h += '<option value="Taxi / Cab"' + (LOYALTY_TYPE==="Taxi / Cab"?" selected":"") + '>Taxi / Cab</option>';
    h += '<option value="Tractor"' + (LOYALTY_TYPE==="Tractor"?" selected":"") + '>Tractor</option>';
    h += '<option value="Pickup / Tempo"' + (LOYALTY_TYPE==="Pickup / Tempo"?" selected":"") + '>Pickup / Tempo</option>';
    h += '<option value="School Van"' + (LOYALTY_TYPE==="School Van"?" selected":"") + '>School Van</option>';
    h += '</select>';
    h += '</div></div>';

    if (LOYALTY_SUBTAB === "members") {
      if (!members.length) {
        h += '<div class="empty">No registered drivers found. Tap "+ Register Driver" to enroll local drivers and issue loyalty cards.</div>';
      } else {
        h += '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(310px, 1fr));gap:14px;margin-bottom:16px">';
        members.forEach(function(m){
          var tierClass = m.tier === "Platinum" ? 'ops-pill-info' : (m.tier === "Gold" ? 'ops-pill-warn' : 'ops-pill-ok');
          var due = Number(m.khata_balance || 0);

          h += '<div class="ops-card">';
          h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">';
          h += '<div>';
          h += '<span style="font-size:11px;font-weight:800;color:var(--btn);font-family:monospace">' + esc(m.member_code) + '</span>';
          h += '<h3 style="margin:2px 0 0;font-size:16px;color:var(--ink)">' + esc(m.name) + '</h3>';
          h += '<div class="sub" style="font-size:12px">🚙 <b>' + esc(m.vehicle_no) + '</b> · ' + esc(m.vehicle_type) + '</div>';
          h += '</div>';

          h += '<span class="ops-pill ' + tierClass + '">' + esc(m.tier) + '</span>';
          h += '</div>';

          h += '<div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:6px;background:var(--bg);padding:8px 10px;border-radius:8px;margin:10px 0;text-align:center">';
          h += '<div><div style="font-size:15px;font-weight:800;color:var(--btn)">' + m.points_balance + '</div><div style="font-size:10px;color:var(--mute);text-transform:uppercase">Points</div></div>';
          h += '<div><div style="font-size:15px;font-weight:800;color:var(--ink)">' + Math.round(m.total_litres_fuelled) + ' L</div><div style="font-size:10px;color:var(--mute);text-transform:uppercase">Total Fuel</div></div>';
          h += '<div><div style="font-size:15px;font-weight:800;color:' + (due > 0 ? 'var(--due)' : 'var(--ok)') + '">' + (due > 0 ? inr(due) : '₹0') + '</div><div style="font-size:10px;color:var(--mute);text-transform:uppercase">Khata Due</div></div>';
          h += '</div>';

          h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding-top:8px;border-top:1px solid var(--line);gap:6px">';
          h += '<button onclick="openDriverTxnModal(' + m.id + ')" style="padding:5px 10px;font-size:11px;flex:1">⛽ Log Fuel / Txn</button>';
          h += '<button class="ghost" onclick="shareDriverStatementWhatsApp(' + m.id + ')" style="padding:5px 10px;font-size:11px;display:inline-flex;align-items:center;gap:4px">📱 WhatsApp</button>';
          h += '</div>';
          h += '</div>';
        });
        h += '</div>';
      }
    } else {
      // Transaction Ledger
      if (!txns.length) {
        h += '<div class="empty">No recent transactions recorded.</div>';
      } else {
        h += '<div class="ops-table-wrap">';
        h += '<table class="ops-table">';
        h += '<thead><tr><th>Date</th><th>Driver & Vehicle</th><th>Transaction Type</th><th>Product & Litres</th><th>Amount (₹)</th><th>Points</th><th>Notes</th></tr></thead><tbody>';
        txns.forEach(function(tx){
          h += '<tr>';
          h += '<td style="font-weight:700">' + esc(tx.d) + '</td>';
          h += '<td><b>' + esc(tx.driver_name) + '</b><br><span class="sub" style="font-size:11px">' + esc(tx.vehicle_no) + '</span></td>';
          h += '<td><span class="ops-pill ' + (tx.txn_type==="fuel_visit"?'ops-pill-ok':(tx.txn_type==="khata_credit"?'ops-pill-warn':'ops-pill-info')) + '">' + esc(tx.txn_type) + '</span></td>';
          h += '<td>' + (tx.litres ? tx.litres + ' L (' + esc(tx.fuel_type || '') + ')' : '—') + '</td>';
          h += '<td style="font-weight:700">' + (tx.amount ? inr(tx.amount) : '—') + '</td>';
          h += '<td style="font-weight:800;color:var(--btn)">' + (tx.points_earned ? '+' + tx.points_earned + ' pts' : (tx.points_redeemed ? '−' + tx.points_redeemed + ' pts' : '—')) + '</td>';
          h += '<td class="sub">' + esc(tx.notes || '') + '</td>';
          h += '</tr>';
        });
        h += '</tbody></table></div>';
      }
    }

    A.innerHTML = h;
  }

  function openRegisterDriverModal(){
    var h = '<div style="max-width:440px">';
    h += '<h2>➕ Register Commercial Driver / Vehicle</h2>';
    h += '<div class="sub" style="margin-bottom:12px">Enrolls commercial driver into the station loyalty program and creates digital khata.</div>';

    h += '<label>Driver / Owner Name *<input id="dm_name" type="text" placeholder="e.g. Balu Pawar"></label>';
    h += '<label>Mobile Number (WhatsApp) *<input id="dm_mob" type="tel" maxlength="10" placeholder="10-digit number"></label>';
    h += '<label>Vehicle Number *<input id="dm_veh" type="text" placeholder="e.g. MH-12-PA-9912"></label>';

    h += '<label>Vehicle Category<select id="dm_type">';
    h += '<option value="Auto Rickshaw">Auto Rickshaw</option>';
    h += '<option value="Taxi / Cab">Taxi / Cab</option>';
    h += '<option value="Tractor">Tractor / Agriculture</option>';
    h += '<option value="Pickup / Tempo">Pickup / Mini Truck (Tempo)</option>';
    h += '<option value="School Van">School Bus / Van</option>';
    h += '<option value="Heavy Truck">Heavy Commercial Truck</option>';
    h += '</select></label>';

    h += '<div class="err" id="dm_err"></div>';
    h += '<div class="row" style="margin-top:12px">';
    h += '<button class="ghost" onclick="closeM()">Cancel</button>';
    h += '<button onclick="submitRegisterDriver()" style="flex:1">Enroll & Generate ID</button>';
    h += '</div>';
    h += '</div>';

    openM(h);
  }

  function submitRegisterDriver(){
    var name = v("dm_name");
    var mob = v("dm_mob").replace(/\D/g, "");
    var veh = v("dm_veh");
    var type = v("dm_type");
    var errEl = document.getElementById("dm_err");

    if (!name || mob.length !== 10 || !veh) {
      if (errEl) errEl.textContent = "Please enter Name, valid 10-digit Mobile, and Vehicle Number.";
      return;
    }

    api("POST", "/api/driver-loyalty/register", {
      name: name, mobile: mob, vehicle_no: veh, vehicle_type: type
    }).then(function(res){
      closeM();
      toast("Driver registered! Loyalty Code: " + res.member_code);
      loadLoyaltyData();
    }).catch(function(e){
      if (errEl) errEl.textContent = e.error || "Could not register driver.";
    });
  }

  function openDriverTxnModal(id){
    if (!LOYALTY_DATA || !LOYALTY_DATA.members) return;
    var m = LOYALTY_DATA.members.find(function(x){ return x.id === id; });
    if (!m) return;

    var h = '<div style="max-width:440px">';
    h += '<h2>⛽ Log Transaction: ' + esc(m.name) + '</h2>';
    h += '<div class="ops-card" style="margin:10px 0">';
    h += '<b>' + esc(m.vehicle_no) + ' (' + esc(m.vehicle_type) + ')</b><br>';
    h += '<span class="sub">Points: <b style="color:var(--btn)">' + m.points_balance + '</b> · Khata Due: <b style="color:' + (m.khata_balance>0?'var(--due)':'var(--ok)') + '">' + inr(m.khata_balance) + '</b></span>';
    h += '</div>';

    h += '<label>Transaction Type<select id="dtx_type">';
    h += '<option value="fuel_visit">⛽ Fuel Dispensed (Award Loyalty Points)</option>';
    h += '<option value="points_redemption">🎁 Redeem Points Discount</option>';
    h += '<option value="khata_credit">📝 Add Khata Dues (Fuel on Credit)</option>';
    h += '<option value="khata_payment">💵 Khata Payment Received</option>';
    h += '</select></label>';

    h += '<div class="row">';
    h += '<label style="flex:1">Fuel Product<select id="dtx_fuel"><option value="Diesel (HSD)">Diesel (HSD)</option><option value="Petrol (MS)">Petrol (MS)</option><option value="Power petrol">Power petrol</option><option value="AdBlue DEF">AdBlue DEF</option></select></label>';
    h += '<label style="flex:1">Litres Fuelled<input id="dtx_lit" type="number" step="0.1" placeholder="e.g. 40" oninput="window.calcDriverPointsPreview()"></label>';
    h += '</div>';

    h += '<div class="row">';
    h += '<label style="flex:1">Amount (₹)<input id="dtx_amt" type="number" placeholder="₹ Amount"></label>';
    h += '<label style="flex:1">Redeem Points (Max ' + m.points_balance + ')<input id="dtx_pts" type="number" min="0" max="' + m.points_balance + '" placeholder="0"></label>';
    h += '</div>';

    h += '<div id="dtx_pts_preview" style="font-size:12px;font-weight:700;color:var(--btn);margin-bottom:8px"></div>';
    h += '<label>Notes<input id="dtx_notes" type="text" placeholder="e.g. Bay 2 dispenser visit"></label>';

    h += '<div class="err" id="dtx_err"></div>';
    h += '<div class="row" style="margin-top:12px">';
    h += '<button class="ghost" onclick="closeM()">Cancel</button>';
    h += '<button onclick="submitDriverTxn(' + m.id + ')" style="flex:1">Record Transaction</button>';
    h += '</div>';
    h += '</div>';

    openM(h);
  }

  window.calcDriverPointsPreview = function(){
    var lit = parseFloat((document.getElementById("dtx_lit")||{}).value) || 0;
    var el = document.getElementById("dtx_pts_preview");
    if (!el) return;
    if (lit > 0) {
      var pts = Math.round((lit / 10) * 10) / 10;
      el.textContent = "✨ Will award +" + pts + " Loyalty Points (1 pt per 10 Litres)";
    } else {
      el.textContent = "";
    }
  };

  function submitDriverTxn(id){
    var type = v("dtx_type");
    var fuel = v("dtx_fuel");
    var lit = v("dtx_lit");
    var amt = v("dtx_amt");
    var pts = v("dtx_pts");
    var notes = v("dtx_notes");
    var errEl = document.getElementById("dtx_err");

    api("POST", "/api/driver-loyalty/txn", {
      driver_id: id, txn_type: type, fuel_type: fuel,
      litres: lit ? parseFloat(lit) : 0,
      amount: amt ? parseFloat(amt) : 0,
      points_redeemed: pts ? parseFloat(pts) : 0,
      notes: notes
    }).then(function(){
      closeM();
      toast("Driver transaction recorded!");
      loadLoyaltyData();
    }).catch(function(e){
      if (errEl) errEl.textContent = e.error || "Could not record transaction.";
    });
  }

  function shareDriverStatementWhatsApp(id){
    if (!LOYALTY_DATA || !LOYALTY_DATA.members) return;
    var m = LOYALTY_DATA.members.find(function(x){ return x.id === id; });
    if (!m) return;

    var biz = (S && S.biz && S.biz.name) ? S.biz.name : "Petrol Pump";
    var text = "⛽ *" + biz + " - Driver Loyalty Statement*\n\n" +
      "Driver: *" + m.name + "*\n" +
      "Vehicle: *" + m.vehicle_no + "* (" + m.vehicle_type + ")\n" +
      "Membership: *" + m.tier + " Tier* (#" + m.member_code + ")\n" +
      "⭐ Loyalty Points Balance: *" + m.points_balance + " pts*\n" +
      "Total Fuelled: *" + Math.round(m.total_litres_fuelled) + " Litres*\n" +
      "Khata Balance Due: *" + inr(m.khata_balance) + "*\n\n" +
      "Thank you for fuelling with us! Show this message at bay for rewards.";

    var cleanMob = "91" + m.mobile.replace(/\D/g, "");
    var url = "https://wa.me/" + cleanMob + "?text=" + encodeURIComponent(text);
    window.open(url, "_blank");
  }

  // ==========================================
  // 6. GENERATOR & FORECOURT ELECTRICITY POWER LOG
  // ==========================================
  function loadGeneratorData(){
    GEN_LOADING = true;
    api("GET", "/api/generator-power-logs")
      .then(function(res){
        GEN_DATA = res;
        GEN_LOADING = false;
        if (tab === "generator") renderGeneratorTab();
      })
      .catch(function(err){
        GEN_LOADING = false;
        toast(err.error || "Could not load generator logs.");
        if (tab === "generator") renderGeneratorTab();
      });
  }

  function renderGeneratorTab(){
    tab = "generator";
    var A = document.getElementById("app");
    if (!A) return;

    if (!GEN_DATA && !GEN_LOADING) {
      A.innerHTML = nav() + '<div class="empty">Loading diesel generator running log…</div>';
      loadGeneratorData();
      return;
    }

    var data = GEN_DATA || { logs: [], stats: {} };
    var stats = data.stats || {};
    var logs = data.logs || [];

    var h = nav();

    // Top Module Clubbed Switcher
    h += '<div class="ops-subtabs noprint" style="margin-bottom:14px;background:rgba(0,0,0,0.03);padding:4px;border-radius:10px">';
    h += '<button class="ops-subtab-btn" onclick="window.EQUIP_MAINT_SUBTAB=\'equipment\';renderEquipmentTab()">🔧 Forecourt Equipment Breakdown</button>';
    h += '<button class="ops-subtab-btn active" onclick="window.EQUIP_MAINT_SUBTAB=\'generator\';renderEquipmentTab()">⚡ DG Generator & Power Log</button>';
    h += '</div>';

    // Header
    h += '<div class="row" style="align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">';
    h += '<div><h1 style="margin:0">⚡ DG Generator & Power Log</h1><div class="sub" style="margin-top:2px">Diesel generator (DG) hour-meter runs, fuel consumption from station stock, and grid power outage tracking.</div></div>';
    h += '<div class="btns" style="margin:0;flex:none">';
    h += '<button onclick="openLogGeneratorModal()" style="display:inline-flex;align-items:center;gap:6px">⚡ Log Generator Run</button>';
    h += '<button class="ghost" onclick="loadGeneratorData()" title="Refresh" style="padding:8px 12px">🔄</button>';
    h += '</div></div>';

    // KPI Metrics
    h += '<div class="ops-kpi-bar noprint">';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--ink)">' + (stats.total_run_hours || 0) + ' hrs</div><div class="ops-kpi-lbl">Total Generator Run Time</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--btn)">' + (stats.total_diesel_consumed || 0) + ' L</div><div class="ops-kpi-lbl">Diesel Consumed by DG</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num">' + (stats.avg_burn_rate_lph || 0) + ' L/hr</div><div class="ops-kpi-lbl">Average Fuel Burn Rate</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--warn)">' + (stats.total_outage_hours || 0) + ' hrs</div><div class="ops-kpi-lbl">Grid Outage Time</div></div>';
    h += '</div>';

    if (!logs.length) {
      h += '<div class="empty">No generator runs logged yet. Tap "+ Log Generator Run" to record DG hour meter readings and fuel usage.</div>';
    } else {
      h += '<div class="ops-table-wrap">';
      h += '<table class="ops-table">';
      h += '<thead><tr>';
      h += '<th>Date</th><th>Start Meter</th><th>End Meter</th><th>Run Hours</th><th>Diesel Used (L)</th><th>Burn Rate (L/hr)</th><th>Power Cut (Mins)</th><th>Outage Cause</th><th>Battery & Oil</th><th>Logged By</th><th>Notes</th>';
      h += '</tr></thead><tbody>';

      logs.forEach(function(row){
        h += '<tr>';
        h += '<td style="font-weight:700;white-space:nowrap">' + esc(row.d) + '</td>';
        h += '<td>' + row.genset_start_hours + '</td>';
        h += '<td>' + row.genset_end_hours + '</td>';
        h += '<td style="font-weight:800;color:var(--ink)">' + row.run_hours + ' hrs</td>';
        h += '<td style="font-weight:800;color:var(--btn)">' + row.diesel_consumed_litres + ' L</td>';
        h += '<td>' + row.fuel_burn_rate_lph + ' L/hr</td>';
        h += '<td>' + (row.power_cut_mins ? row.power_cut_mins + ' mins' : '—') + '</td>';
        h += '<td class="sub">' + esc(row.outage_reason) + '</td>';
        h += '<td><span class="ops-pill ops-pill-ok">' + row.battery_voltage + 'V · Oil OK</span></td>';
        h += '<td class="sub">' + esc(row.logged_by_name || 'Staff') + '</td>';
        h += '<td class="sub" style="max-width:200px">' + esc(row.notes || '') + '</td>';
        h += '</tr>';
      });

      h += '</tbody></table></div>';
    }

    A.innerHTML = h;
  }

  function openLogGeneratorModal(){
    var nowD = today();
    var h = '<div style="max-width:480px">';
    h += '<h2>⚡ Record Diesel Generator Run</h2>';
    h += '<div class="sub" style="margin-bottom:12px">Log DG hour-meter readings, internal diesel consumption, and electricity board grid cuts.</div>';

    h += '<label>Run Date<input id="gn_date" type="date" value="' + nowD + '"></label>';

    h += '<div class="row">';
    h += '<label style="flex:1">Hour Meter Start *<input id="gn_start" type="number" step="0.1" placeholder="e.g. 1420.5" oninput="window.calcGenRunHours()"></label>';
    h += '<label style="flex:1">Hour Meter End *<input id="gn_end" type="number" step="0.1" placeholder="e.g. 1422.5" oninput="window.calcGenRunHours()"></label>';
    h += '</div>';

    h += '<div id="gn_calc_box" style="display:none;background:var(--bg);padding:8px 12px;border-radius:8px;font-size:13px;font-weight:700;color:var(--ink);margin-bottom:10px"></div>';

    h += '<div class="row">';
    h += '<label style="flex:1">Diesel Drawn from Station (L)<input id="gn_diesel" type="number" step="0.5" placeholder="e.g. 16.0"></label>';
    h += '<label style="flex:1">Grid Outage Duration (Mins)<input id="gn_cut" type="number" placeholder="e.g. 120"></label>';
    h += '</div>';

    h += '<label>Outage Reason<select id="gn_reason">';
    h += '<option value="Grid Outage / MSEDCL Load Shedding">Grid Outage / MSEDCL Load Shedding</option>';
    h += '<option value="Feeder Line Trip">Feeder Line Trip</option>';
    h += '<option value="Scheduled Transformer Maintenance">Scheduled Transformer Maintenance</option>';
    h += '<option value="Storm / Rain Line Fault">Storm / Rain Line Fault</option>';
    h += '<option value="Weekly Routine Warmup Run">Weekly Routine Warmup Run</option>';
    h += '</select></label>';

    h += '<div class="row">';
    h += '<label style="flex:1">Battery Voltage (V)<input id="gn_volt" type="number" step="0.1" value="12.8"></label>';
    h += '<label style="flex:1">Engine Lube Oil Level<select id="gn_oil"><option value="1">Normal (Between Min & Max)</option><option value="0">Low (Needs Top-up)</option></select></label>';
    h += '</div>';

    h += '<label>Operating Remarks<textarea id="gn_notes" rows="2" placeholder="e.g. AMF auto-switchover within 15 seconds. Frequency stable at 50 Hz."></textarea></label>';

    h += '<div class="err" id="gn_err"></div>';
    h += '<div class="row" style="margin-top:12px">';
    h += '<button class="ghost" onclick="closeM()">Cancel</button>';
    h += '<button onclick="submitGeneratorLog()" style="flex:1">Save Generator Log</button>';
    h += '</div>';
    h += '</div>';

    openM(h);
  }

  window.calcGenRunHours = function(){
    var start = parseFloat((document.getElementById("gn_start")||{}).value);
    var end = parseFloat((document.getElementById("gn_end")||{}).value);
    var box = document.getElementById("gn_calc_box");
    if (!box) return;
    if (!isNaN(start) && !isNaN(end) && end >= start) {
      var diff = Math.round((end - start) * 10) / 10;
      box.style.display = "block";
      box.textContent = "⏱️ Net Run Time: " + diff + " Hours";
    } else {
      box.style.display = "none";
    }
  };

  function submitGeneratorLog(){
    var d = v("gn_date");
    var start = v("gn_start");
    var end = v("gn_end");
    var diesel = v("gn_diesel");
    var cut = v("gn_cut");
    var reason = v("gn_reason");
    var volt = v("gn_volt");
    var oil = v("gn_oil");
    var notes = v("gn_notes");
    var errEl = document.getElementById("gn_err");

    if (!start || !end || parseFloat(end) < parseFloat(start)) {
      if (errEl) errEl.textContent = "Please enter valid Start and End hour meter readings.";
      return;
    }

    api("POST", "/api/generator-power-logs", {
      d: d, genset_start_hours: parseFloat(start), genset_end_hours: parseFloat(end),
      diesel_consumed_litres: diesel ? parseFloat(diesel) : 0,
      power_cut_mins: cut ? parseInt(cut) : 0,
      outage_reason: reason, battery_voltage: volt ? parseFloat(volt) : 12.6,
      oil_level_ok: parseInt(oil), notes: notes
    }).then(function(){
      closeM();
      toast("Generator run logged successfully!");
      loadGeneratorData();
    }).catch(function(e){
      if (errEl) errEl.textContent = e.error || "Could not save generator log.";
    });
  }

  // ==========================================
  // 7. CUSTOMER AMENITIES & OMC MYSTERY AUDIT
  // ==========================================
  function loadAmenitiesData(){
    AMEN_LOADING = true;
    api("GET", "/api/amenities-inspections")
      .then(function(res){
        AMEN_DATA = res;
        AMEN_LOADING = false;
        if (tab === "amenities") renderAmenitiesTab();
      })
      .catch(function(err){
        AMEN_LOADING = false;
        toast(err.error || "Could not load amenities inspection records.");
        if (tab === "amenities") renderAmenitiesTab();
      });
  }

  function renderAmenitiesTab(){
    tab = "amenities";
    var A = document.getElementById("app");
    if (!A) return;

    if (!AMEN_DATA && !AMEN_LOADING) {
      A.innerHTML = nav() + '<div class="empty">Loading customer amenities and audit inspection checklist…</div>';
      loadAmenitiesData();
      return;
    }

    var data = AMEN_DATA || { inspections: [], today_inspection: null, stats: {} };
    var stats = data.stats || {};
    var list = data.inspections || [];
    var todayInsp = data.today_inspection;

    var h = nav();

    // Header
    h += '<div class="row" style="align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">';
    h += '<div><h1 style="margin:0">✨ Forecourt Customer Amenities & OMC Audit</h1><div class="sub" style="margin-top:2px">Daily compliance checklist for free digital air, RO drinking water, clean washrooms, and OMC mystery inspection readiness.</div></div>';
    h += '<div class="btns" style="margin:0;flex:none">';
    h += '<button onclick="openAmenitiesAuditModal()" style="display:inline-flex;align-items:center;gap:6px">📋 Conduct Daily Amenities Audit</button>';
    h += '<button class="ghost" onclick="loadAmenitiesData()" title="Refresh" style="padding:8px 12px">🔄</button>';
    h += '</div></div>';

    // KPI Metrics
    h += '<div class="ops-kpi-bar noprint">';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:' + (todayInsp ? 'var(--ok)' : 'var(--warn)') + '">' + (todayInsp ? '✅ Completed' : '⚠️ Pending') + '</div><div class="ops-kpi-lbl">Today\'s Inspection Status</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--ok)">' + (todayInsp ? todayInsp.total_score_pct + '%' : '—') + '</div><div class="ops-kpi-lbl">Today\'s Audit Score</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--btn)">' + (stats.average_omc_score || 100) + '%</div><div class="ops-kpi-lbl">Lifetime OMC Audit Avg</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num">' + (stats.total_audits || list.length) + '</div><div class="ops-kpi-lbl">Audits Completed</div></div>';
    h += '</div>';

    // 13-Point Amenities Compliance Checklist Grid
    h += '<h3 style="margin:16px 0 8px">Mandatory 13-Point OMC Standards Status</h3>';
    var checks = [
      { t: "Free Digital Air / Nitrogen Tower", desc: "Compressor running, digital gauge calibrated" },
      { t: "RO Drinking Water Dispenser", desc: "Chilled clean water available, hygienic cup area" },
      { t: "Clean Gents Washroom", desc: "Flushing, clean basin, mirror, waste bin" },
      { t: "Clean Ladies Washroom", desc: "Inside latch working, clean, sanitary bin" },
      { t: "Liquid Hand Soap & Running Water", desc: "Soap dispensers refilled at all basins" },
      { t: "Windshield Wash Kit at Fuel Bays", desc: "Clean water buckets with squeegees on islands" },
      { t: "DCP Fire Extinguishers Pressure", desc: "All pressure gauges strictly in Green Zone" },
      { t: "Sand Buckets Dry & Full", desc: "No water or cigarette butts inside buckets" },
      { t: "Stocked Forecourt First Aid Kit", desc: "Antiseptic, bandages, burn cream verified" },
      { t: "Customer Complaint / Suggestion Book", desc: "Kept visible on manager desk with pen" },
      { t: "Canopy & Totem Price Board Lights", desc: "100% LED canopy lights operational" },
      { t: "Driveway Surface Free of Oil Spills", desc: "Dry, clean concrete / paver blocks" },
      { t: "Staff Safety Uniform & Badges", desc: "Forecourt attendants in neat OMC uniform" }
    ];

    h += '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:10px;margin-bottom:18px">';
    checks.forEach(function(c, i){
      h += '<div style="background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;display:flex;align-items:flex-start;gap:10px">';
      h += '<div style="font-size:16px;color:var(--ok)">✅</div>';
      h += '<div>';
      h += '<div style="font-size:13px;font-weight:700;color:var(--ink)">' + (i+1) + '. ' + c.t + '</div>';
      h += '<div style="font-size:11px;color:var(--mute)">' + c.desc + '</div>';
      h += '</div>';
      h += '</div>';
    });
    h += '</div>';

    // Past Inspection Table
    h += '<h3 style="margin:16px 0 8px">Daily Mystery Audit Inspection History</h3>';
    if (!list.length) {
      h += '<div class="empty">No past inspection records found. Conduct your first audit today!</div>';
    } else {
      h += '<div class="ops-table-wrap">';
      h += '<table class="ops-table">';
      h += '<thead><tr>';
      h += '<th>Inspection Date</th><th>Shift</th><th>OMC Audit Score</th><th>Compliance Grade</th><th>Inspector</th><th>Actions / Corrective Remarks</th>';
      h += '</tr></thead><tbody>';

      list.forEach(function(row){
        var is100 = row.total_score_pct >= 95;
        h += '<tr>';
        h += '<td style="font-weight:700">' + esc(row.d) + '</td>';
        h += '<td class="sub">' + esc(row.shift) + '</td>';
        h += '<td style="font-weight:800;font-size:15px;' + (is100 ? 'color:var(--ok)' : 'color:#d97706') + '">' + row.total_score_pct + '%</td>';
        h += '<td><span class="ops-pill ' + (is100 ? 'ops-pill-ok' : 'ops-pill-warn') + '">' + esc(row.audit_grade) + '</span></td>';
        h += '<td class="sub">' + esc(row.inspector_name || 'Manager') + '</td>';
        h += '<td class="sub" style="max-width:280px">' + esc(row.corrective_actions || 'All parameters fully compliant.') + '</td>';
        h += '</tr>';
      });

      h += '</tbody></table></div>';
    }

    A.innerHTML = h;
  }

  function openAmenitiesAuditModal(){
    var nowD = today();
    var h = '<div style="max-width:540px">';
    h += '<h2>📋 Conduct Daily OMC Customer Amenities Audit</h2>';
    h += '<div class="sub" style="margin-bottom:12px">Inspect all 13 mandatory forecourt amenities and verify compliance.</div>';

    h += '<div class="row">';
    h += '<label style="flex:1">Date<input id="am_date" type="date" value="' + nowD + '"></label>';
    h += '<label style="flex:1">Shift<input id="am_shift" type="text" value="Morning (07:00 AM)"></label>';
    h += '</div>';

    h += '<h4 style="margin:12px 0 6px">13-Point Verification Checklist (Toggle all that are OK)</h4>';
    h += '<div style="background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:12px;display:flex;flex-direction:column;gap:8px;max-height:280px;overflow-y:auto">';

    var items = [
      { id: "am_1", label: "Free Digital Air / Nitrogen Inflator tower operational" },
      { id: "am_2", label: "Air pressure gauge calibrated with master tester" },
      { id: "am_3", label: "Clean drinking RO water dispenser working & chilled" },
      { id: "am_4", label: "Water dispenser area hygienic with clean cups" },
      { id: "am_5", label: "Gents washroom clean, flushed & floor dry" },
      { id: "am_6", label: "Ladies washroom clean with functional inside latch" },
      { id: "am_7", label: "Liquid hand soap refilled and running tap water" },
      { id: "am_8", label: "Windshield wash buckets and squeegees at fuel bays" },
      { id: "am_9", label: "All DCP Fire Extinguishers pressure in green safe zone" },
      { id: "am_10", label: "Fire sand buckets dry, full & free of trash" },
      { id: "am_11", label: "Customer First Aid kit stocked and accessible" },
      { id: "am_12", label: "Customer Suggestion / Complaint book available" },
      { id: "am_13", label: "100% forecourt canopy & price totem LED lighting working" }
    ];

    items.forEach(function(it){
      h += '<label style="display:flex;align-items:center;gap:8px;font-size:12.5px;margin:0;cursor:pointer">';
      h += '<input type="checkbox" id="' + it.id + '" checked style="width:auto;margin:0" onchange="window.calcAmenitiesLiveScore()">';
      h += '<span>' + it.label + '</span>';
      h += '</label>';
    });

    h += '</div>';

    h += '<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(11,122,95,0.08);padding:10px 14px;border-radius:8px;margin-bottom:12px">';
    h += '<span style="font-weight:700">Audit Score:</span>';
    h += '<span id="am_score_val" style="font-size:18px;font-weight:800;color:var(--ok)">100% (Grade A - Outstanding)</span>';
    h += '</div>';

    h += '<label>Corrective Actions & Observations<textarea id="am_notes" rows="2" placeholder="e.g. Washroom soap dispenser topped up. All amenities in top condition."></textarea></label>';

    h += '<div class="err" id="am_err"></div>';
    h += '<div class="row" style="margin-top:12px">';
    h += '<button class="ghost" onclick="closeM()">Cancel</button>';
    h += '<button onclick="submitAmenitiesAudit()" style="flex:1">Submit Inspection Sign-off</button>';
    h += '</div>';
    h += '</div>';

    openM(h);
    setTimeout(window.calcAmenitiesLiveScore, 100);
  }

  window.calcAmenitiesLiveScore = function(){
    var checked = 0;
    for (var i = 1; i <= 13; i++) {
      var el = document.getElementById("am_" + i);
      if (el && el.checked) checked++;
    }
    var pct = Math.round((checked / 13) * 1000) / 10;
    var scoreEl = document.getElementById("am_score_val");
    if (!scoreEl) return;
    if (pct >= 95) {
      scoreEl.style.color = "var(--ok)";
      scoreEl.textContent = pct + "% (Grade A - Outstanding)";
    } else if (pct >= 80) {
      scoreEl.style.color = "#d97706";
      scoreEl.textContent = pct + "% (Grade B - Minor Fixes Needed)";
    } else {
      scoreEl.style.color = "var(--due)";
      scoreEl.textContent = pct + "% (Grade C - OMC Deficiencies Alert)";
    }
  };

  function submitAmenitiesAudit(){
    var d = v("am_date");
    var shift = v("am_shift");
    var notes = v("am_notes");
    var errEl = document.getElementById("am_err");

    var body = {
      d: d, shift: shift, corrective_actions: notes,
      air_nitrogen_working: (document.getElementById("am_1")||{}).checked ? 1 : 0,
      air_gauge_calibrated: (document.getElementById("am_2")||{}).checked ? 1 : 0,
      drinking_water_ok: (document.getElementById("am_3")||{}).checked ? 1 : 0,
      water_dispenser_clean: (document.getElementById("am_4")||{}).checked ? 1 : 0,
      gents_toilet_clean: (document.getElementById("am_5")||{}).checked ? 1 : 0,
      ladies_toilet_clean: (document.getElementById("am_6")||{}).checked ? 1 : 0,
      soap_water_running: (document.getElementById("am_7")||{}).checked ? 1 : 0,
      windshield_wash_bucket_ok: (document.getElementById("am_8")||{}).checked ? 1 : 0,
      fire_extinguishers_green: (document.getElementById("am_9")||{}).checked ? 1 : 0,
      sand_buckets_dry_full: (document.getElementById("am_10")||{}).checked ? 1 : 0,
      first_aid_stocked: (document.getElementById("am_11")||{}).checked ? 1 : 0,
      complaint_book_open: (document.getElementById("am_12")||{}).checked ? 1 : 0,
      canopy_lighting_full: (document.getElementById("am_13")||{}).checked ? 1 : 0
    };

    api("POST", "/api/amenities-inspections", body)
      .then(function(res){
        closeM();
        toast("OMC amenities inspection saved! Score: " + res.score_pct + "%");
        loadAmenitiesData();
      })
      .catch(function(e){
        if (errEl) errEl.textContent = e.error || "Could not save audit inspection.";
      });
  }

  // Export functions to window
  window.renderVaultTab = renderVaultTab;
  window.loadVaultData = loadVaultData;
  window.openAttendantDropModal = openAttendantDropModal;
  window.openBankDepositModal = openBankDepositModal;
  window.verifyVaultDrop = verifyVaultDrop;
  window.viewVaultDropDetails = viewVaultDropDetails;
  window.submitAttendantDrop = submitAttendantDrop;
  window.submitBankDeposit = submitBankDeposit;

  window.renderWaterDipTab = renderWaterDipTab;
  window.loadWaterDipData = loadWaterDipData;
  window.openWaterDipModal = openWaterDipModal;
  window.submitWaterDip = submitWaterDip;

  window.renderComplianceTab = renderComplianceTab;
  window.loadComplianceData = loadComplianceData;
  window.openAddLicenseModal = openAddLicenseModal;
  window.openRenewLicenseModal = openRenewLicenseModal;
  window.submitLicense = submitLicense;
  window.submitRenewLicense = submitRenewLicense;

  window.renderEquipmentTab = renderEquipmentTab;
  window.loadEquipmentData = loadEquipmentData;
  window.openReportTicketModal = openReportTicketModal;
  window.openResolveTicketModal = openResolveTicketModal;
  window.submitEquipmentTicket = submitEquipmentTicket;
  window.submitResolveTicket = submitResolveTicket;

  window.renderLoyaltyTab = renderLoyaltyTab;
  window.loadLoyaltyData = loadLoyaltyData;
  window.openRegisterDriverModal = openRegisterDriverModal;
  window.openDriverTxnModal = openDriverTxnModal;
  window.submitRegisterDriver = submitRegisterDriver;
  window.submitDriverTxn = submitDriverTxn;
  window.shareDriverStatementWhatsApp = shareDriverStatementWhatsApp;

  window.renderGeneratorTab = renderGeneratorTab;
  window.loadGeneratorData = loadGeneratorData;
  window.openLogGeneratorModal = openLogGeneratorModal;
  window.submitGeneratorLog = submitGeneratorLog;

  window.renderAmenitiesTab = renderAmenitiesTab;
  window.loadAmenitiesData = loadAmenitiesData;
  window.openAmenitiesAuditModal = openAmenitiesAuditModal;
  window.submitAmenitiesAudit = submitAmenitiesAudit;

})(window);
