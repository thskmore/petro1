// bowser-pnl-wm.js - 3 Major Petrol Pump Operational Modules:
// 1. Mobile Fuel Bowser & Doorstep Diesel Delivery (DDD)
// 2. Automated Daily Profit & Loss Breakdown with Dealer Margins & Overheads
// 3. Statutory Weights & Measures (W&M) Stamping & Calibration Vault
// + Enhanced Fleet Indent Mileage & Slip Voucher Generator

(function(window){
  "use strict";

  // State caches
  var BOWSER_DATA = null, BOWSER_LOADING = false, BOWSER_SUBTAB = "trips", BOWSER_SEARCH = "", BOWSER_STATUS = "all";
  var PNL_DATA = null, PNL_LOADING = false, PNL_RANGE = "7days", PNL_DATE_FROM = "", PNL_DATE_TO = "";
  var WM_DATA = null, WM_LOADING = false, WM_SUBTAB = "stamping", WM_SEARCH = "";

  // Helper date
  function getTodayIso(){
    return new Date().toISOString().slice(0, 10);
  }

  // ==========================================
  // 1. MOBILE FUEL BOWSER & DOORSTEP DELIVERY (DDD)
  // ==========================================
  function loadBowserData(){
    BOWSER_LOADING = true;
    api("GET", "/api/bowsers")
      .then(function(res){
        BOWSER_DATA = res;
        BOWSER_LOADING = false;
        if (tab === "bowser") renderBowserTab();
      })
      .catch(function(err){
        BOWSER_LOADING = false;
        toast(err.error || "Could not load bowser operations.");
        if (tab === "bowser") renderBowserTab();
      });
  }

  function renderBowserTab(){
    tab = "bowser";
    var A = document.getElementById("app");
    if (!A) return;

    if (!SRV) {
      A.innerHTML = nav() + '<div class="empty">Bowser doorstep delivery operations are managed on the server. Please log in.</div>';
      return;
    }

    if (!BOWSER_DATA && !BOWSER_LOADING) {
      A.innerHTML = nav() + '<div class="empty">Loading Mobile Bowser & Doorstep Refueling data…</div>';
      loadBowserData();
      return;
    }

    var data = BOWSER_DATA || { bowsers: [], trips: [], deliveries: [], refills: [], stats: {}, customers: [] };
    var stats = data.stats || {};
    var bowsers = data.bowsers || [];
    var trips = data.trips || [];
    var deliveries = data.deliveries || [];
    var refills = data.refills || [];

    var h = nav();

    // Header
    h += '<div class="row" style="align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">';
    h += '<div><h1 style="margin:0">🚛 Fuel Bowser & Doorstep Delivery</h1><div class="sub" style="margin-top:2px">PESO-approved mobile dispensers, doorstep diesel delivery (DDD) trips, and site refueling challans.</div></div>';
    h += '<div class="btns" style="margin:0;flex:none">';
    if (ME && (ME.role === "owner" || ME.role === "manager")) {
      h += '<button onclick="openAddBowserModal()" class="ghost" style="font-size:13px">+ Add Bowser</button>';
    }
    h += '<button onclick="openBowserRefillModal()" class="ghost" style="font-size:13px">⛽ Top-up Bowser Tank</button>';
    h += '<button onclick="openStartBowserTripModal()" style="display:inline-flex;align-items:center;gap:6px">+ Start Dispatch Trip</button>';
    h += '<button class="ghost" onclick="loadBowserData()" title="Refresh" style="padding:8px 12px">🔄</button>';
    h += '</div></div>';

    // Metrics Bar
    h += '<div class="ops-kpi-bar noprint">';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--ok)">' + (stats.active_trips || 0) + '</div><div class="ops-kpi-lbl">Active Dispatch Trips</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num">' + ((stats.today_delivered_litres || 0).toLocaleString("en-IN")) + ' L</div><div class="ops-kpi-lbl">Doorstep Diesel Delivered Today</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num">' + inr(stats.today_delivered_amount || 0) + '</div><div class="ops-kpi-lbl">Today Billed DDD Revenue</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num">' + ((stats.current_mobile_stock || 0).toLocaleString("en-IN")) + ' / ' + ((stats.total_fleet_capacity || 0).toLocaleString("en-IN")) + ' L</div><div class="ops-kpi-lbl">Current Bowser Stock / Capacity</div></div>';
    h += '</div>';

    // Subtabs
    h += '<div class="ops-subtabs noprint">';
    h += '<button class="ops-subtab-btn ' + (BOWSER_SUBTAB==="trips"?"active":"") + '" onclick="setBowserSubtab(\'trips\')">🚀 Dispatch Trips (' + trips.length + ')</button>';
    h += '<button class="ops-subtab-btn ' + (BOWSER_SUBTAB==="fleet"?"active":"") + '" onclick="setBowserSubtab(\'fleet\')">🚛 Mobile Bowser Fleet (' + bowsers.length + ')</button>';
    h += '<button class="ops-subtab-btn ' + (BOWSER_SUBTAB==="deliveries"?"active":"") + '" onclick="setBowserSubtab(\'deliveries\')">📋 Site Refueling Challans (' + deliveries.length + ')</button>';
    h += '<button class="ops-subtab-btn ' + (BOWSER_SUBTAB==="refills"?"active":"") + '" onclick="setBowserSubtab(\'refills\')">⛽ Tank Refill Logs (' + refills.length + ')</button>';
    h += '</div>';

    // Subtab content
    if (BOWSER_SUBTAB === "trips") {
      h += renderBowserTripsView(trips, bowsers);
    } else if (BOWSER_SUBTAB === "fleet") {
      h += renderBowserFleetView(bowsers);
    } else if (BOWSER_SUBTAB === "deliveries") {
      h += renderBowserDeliveriesView(deliveries);
    } else if (BOWSER_SUBTAB === "refills") {
      h += renderBowserRefillsView(refills);
    }

    A.innerHTML = h;
  }

  function setBowserSubtab(st){
    BOWSER_SUBTAB = st;
    renderBowserTab();
  }

  function renderBowserTripsView(trips, bowsers){
    var h = '';
    if (!trips.length) {
      return '<div class="empty">No bowser trips recorded yet. Tap "+ Start Dispatch Trip" to deploy a mobile dispenser unit.</div>';
    }

    trips.forEach(function(t){
      var isOpen = t.status === "open";
      var isCompleted = t.status === "completed";

      h += '<div class="ops-card" style="border-left:4px solid ' + (isOpen ? 'var(--ok)' : 'var(--line)') + '">';
      h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;padding-bottom:10px;border-bottom:1px solid var(--line)">';
      h += '<div>';
      h += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">';
      h += '<span style="font-weight:800;font-size:16px;color:var(--btn)">' + esc(t.trip_no) + '</span>';
      h += '<span class="ho-nozzle-badge" style="background:#0284c7;color:#fff;font-weight:700">' + esc(t.bowser_reg || 'Bowser') + '</span>';
      h += '<span style="font-weight:600;color:var(--ink)">' + esc(t.bowser_name || '') + '</span>';
      h += '</div>';
      h += '<div class="sub" style="font-size:12px;margin-top:4px">';
      h += 'Date: <b>' + t.d + '</b> · Departure: <b>' + esc(t.start_time) + '</b>' + (t.end_time ? ' · Return: <b>' + esc(t.end_time) + '</b>' : '') + ' · Driver: <b>' + esc(t.driver_name) + '</b> (' + esc(t.driver_mobile || 'N/A') + ')';
      h += '</div>';
      h += '</div>';

      h += '<div style="display:flex;align-items:center;gap:6px">';
      if (isOpen) {
        h += '<span class="ops-pill ops-pill-ok">🚚 En Route / On Trip</span>';
      } else {
        h += '<span class="ops-pill ops-pill-info">✅ Trip Completed</span>';
      }
      h += '</div>';
      h += '</div>';

      // Trip details
      h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:12px 0;background:var(--bg);padding:10px 14px;border-radius:8px">';
      h += '<div><div class="sub" style="font-size:11px">Destination / Route</div><div style="font-weight:700;font-size:13px;color:var(--ink)">' + esc(t.destination_summary || 'Local industrial site') + '</div></div>';
      h += '<div><div class="sub" style="font-size:11px">Starting Fuel / Meter</div><div style="font-weight:700;font-size:13px">' + (t.starting_fuel_qty || 0).toLocaleString("en-IN") + ' L &nbsp;·&nbsp; ' + (t.starting_meter || 0).toLocaleString("en-IN") + '</div></div>';
      h += '<div><div class="sub" style="font-size:11px">Total Delivered to Sites</div><div style="font-weight:800;font-size:14px;color:var(--ok)">' + (t.total_dispensed_qty || 0).toLocaleString("en-IN") + ' Litres</div></div>';
      if (isCompleted) {
        h += '<div><div class="sub" style="font-size:11px">Closing Dip & Transit Variance</div><div style="font-weight:700;font-size:13px;color:' + (t.transit_variance_litres < 0 ? 'var(--due)' : 'var(--ink)') + '">' + (t.remaining_dip_litres || 0).toLocaleString("en-IN") + ' L (' + (t.transit_variance_litres >= 0 ? '+' : '') + t.transit_variance_litres + ' L)</div></div>';
      }
      h += '</div>';

      // Actions
      h += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">';
      h += '<div class="sub" style="font-size:12px">' + (t.notes ? 'Note: ' + esc(t.notes) : '') + '</div>';
      h += '<div class="btns" style="margin:0">';
      if (isOpen) {
        h += '<button onclick="openBowserDeliveryModal(' + t.id + ')" style="font-size:13px;padding:7px 12px;display:inline-flex;align-items:center;gap:5px">⛽ + Log Site Refueling</button>';
        h += '<button class="ghost" onclick="openCompleteBowserTripModal(' + t.id + ')" style="font-size:13px;padding:7px 12px;color:var(--ok)">🏁 Close & Reconcile Trip</button>';
      }
      h += '<button class="ghost" onclick="printTripChallanSheet(' + t.id + ')" style="font-size:13px;padding:7px 12px">📄 Trip Sheet</button>';
      h += '</div>';
      h += '</div>';

      h += '</div>';
    });

    return h;
  }

  function renderBowserFleetView(bowsers){
    var h = '<div class="ops-prod-grid">';
    bowsers.forEach(function(b){
      var pct = Math.min(100, Math.round(((b.current_fuel_stock || 0) / (b.capacity_litres || 1)) * 100));
      var isAvailable = b.status === "available";
      var isOnTrip = b.status === "on_trip";

      h += '<div class="ops-prod-card">';
      h += '<div>';
      h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">';
      h += '<div>';
      h += '<div style="font-weight:800;font-size:15px;color:var(--ink)">' + esc(b.name) + '</div>';
      h += '<div class="ho-nozzle-badge" style="background:#1e293b;color:#fff;font-weight:700;margin-top:3px;display:inline-block">' + esc(b.reg_no) + '</div>';
      h += '</div>';
      if (isOnTrip) h += '<span class="ops-pill ops-pill-ok">🚚 En Route</span>';
      else if (isAvailable) h += '<span class="ops-pill ops-pill-info">🟢 Ready at Pump</span>';
      else h += '<span class="ops-pill ops-pill-warn">🟡 Maintenance</span>';
      h += '</div>';

      // Tank visual gauge
      h += '<div style="margin:12px 0">';
      h += '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">';
      h += '<span>Fuel Stock Level</span>';
      h += '<b>' + (b.current_fuel_stock || 0).toLocaleString("en-IN") + ' / ' + (b.capacity_litres || 0).toLocaleString("en-IN") + ' L (' + pct + '%)</b>';
      h += '</div>';
      h += '<div class="ops-bar-bg"><div class="ops-bar-fill" style="width:' + pct + '%;background:' + (pct < 20 ? 'var(--due)' : pct < 50 ? 'var(--warn)' : 'var(--ok)') + '"></div></div>';
      h += '</div>';

      h += '<div style="font-size:12px;color:var(--mute);line-height:1.6">';
      h += '<div>Flowmeter: <b style="color:var(--ink)">' + esc(b.flowmeter_make) + '</b> (' + esc(b.flowmeter_serial) + ')</div>';
      h += '<div>Totalizer Reading: <b style="color:var(--ink)">' + (b.current_totalizer_meter || 0).toLocaleString("en-IN") + '</b></div>';
      h += '<div>Assigned Driver: <b style="color:var(--ink)">' + esc(b.driver_name || 'Driver') + '</b> (' + esc(b.driver_mobile || 'N/A') + ')</div>';
      if (b.peso_license_no) h += '<div>PESO License: <b>' + esc(b.peso_license_no) + '</b> (Exp: ' + esc(b.peso_expiry_d || 'N/A') + ')</div>';
      h += '</div>';
      h += '</div>';

      h += '<div class="btns" style="margin-top:14px;display:flex;gap:6px">';
      h += '<button class="ghost" style="flex:1;font-size:12px;padding:7px 8px" onclick="openBowserRefillModal(' + b.id + ')">⛽ Refill Tank</button>';
      if (isAvailable) {
        h += '<button style="flex:1;font-size:12px;padding:7px 8px" onclick="openStartBowserTripModal(' + b.id + ')">🚀 Start Trip</button>';
      }
      h += '</div>';

      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  function renderBowserDeliveriesView(deliveries){
    var h = '<div class="ops-table-wrap"><table class="ops-table">';
    h += '<thead><tr><th>Challan #</th><th>Date & Time</th><th>Client & Site</th><th>Asset / Machinery</th><th class="r">Meter Start - End</th><th class="r">Litres</th><th class="r">Rate</th><th class="r">Total Amount</th><th>Mode</th><th class="noprint"></th></tr></thead><tbody>';

    if (!deliveries.length) {
      h += '<tr><td colspan="10" class="empty">No doorstep diesel deliveries logged yet.</td></tr>';
    } else {
      deliveries.forEach(function(d){
        h += '<tr>';
        h += '<td><b style="color:var(--btn)">' + esc(d.challan_no) + '</b><div class="sub" style="font-size:10.5px">' + esc(d.trip_no) + '</div></td>';
        h += '<td>' + d.d + '<div class="sub" style="font-size:11px">' + esc(d.delivery_time || '') + '</div></td>';
        h += '<td><b>' + esc(d.client_name) + '</b><div class="sub" style="font-size:11px">📍 ' + esc(d.site_location) + '</div></td>';
        h += '<td><span class="ho-nozzle-badge" style="background:#334155;color:#fff;font-size:11px">' + esc(d.asset_type) + '</span></td>';
        h += '<td class="r" style="font-size:12px">' + (d.start_meter || 0).toLocaleString("en-IN") + ' → ' + (d.end_meter || 0).toLocaleString("en-IN") + '</td>';
        h += '<td class="r" style="font-weight:800;color:var(--ok);font-size:14px">' + (d.qty_litres || 0).toLocaleString("en-IN") + ' L</td>';
        h += '<td class="r">₹' + (d.rate || 0) + '</td>';
        h += '<td class="r" style="font-weight:800">' + inr(d.amount || 0) + '</td>';
        h += '<td><span class="ops-pill ' + (d.payment_mode === "credit" ? "ops-pill-warn" : "ops-pill-ok") + '">' + esc(d.payment_mode) + '</span></td>';
        h += '<td class="noprint" style="white-space:nowrap"><button class="ghost" style="padding:4px 8px;font-size:12px" onclick="printBowserChallan(' + d.id + ')">📄 Challan</button></td>';
        h += '</tr>';
      });
    }

    h += '</tbody></table></div>';
    return h;
  }

  function renderBowserRefillsView(refills){
    var h = '<div class="ops-table-wrap"><table class="ops-table">';
    h += '<thead><tr><th>Date & Time</th><th>Bowser Unit</th><th>Source Tank</th><th class="r">Loaded Litres</th><th class="r">Density @ 15°C</th><th>Attendant</th><th>Notes</th></tr></thead><tbody>';

    if (!refills.length) {
      h += '<tr><td colspan="7" class="empty">No tank top-up refills logged yet.</td></tr>';
    } else {
      refills.forEach(function(r){
        h += '<tr>';
        h += '<td><b>' + r.d + '</b> <span class="sub">' + esc(r.time_str) + '</span></td>';
        h += '<td><b>' + esc(r.bowser_reg || 'Bowser') + '</b><div class="sub" style="font-size:11px">' + esc(r.bowser_name || '') + '</div></td>';
        h += '<td><span class="ho-nozzle-badge" style="background:#059669;color:#fff">' + esc(r.tank_id) + ' HSD</span></td>';
        h += '<td class="r" style="font-weight:800;color:var(--btn);font-size:14px">' + (r.loaded_qty || 0).toLocaleString("en-IN") + ' L</td>';
        h += '<td class="r">' + (r.loaded_density || 0) + ' kg/m³' + (r.temp_c ? ' (' + r.temp_c + '°C)' : '') + '</td>';
        h += '<td>' + esc(r.attendant_name || 'Staff') + '</td>';
        h += '<td class="sub">' + esc(r.notes || 'Underground storage loading') + '</td>';
        h += '</tr>';
      });
    }

    h += '</tbody></table></div>';
    return h;
  }

  // Modals for Bowser
  function openAddBowserModal(){
    var h = '<h2>🚛 Register Mobile Bowser Unit</h2>'
      + '<div class="sub">PESO compliant mobile diesel dispensing refueler for Doorstep Diesel Delivery.</div>'
      + '<div class="row" style="margin-top:12px">'
      + '<label>Bowser Name / Model<input id="bw_name" placeholder="e.g. Bowser Express-03 (Eicher Pro)"></label>'
      + '<label>Vehicle Reg Number<input id="bw_reg" placeholder="e.g. MH-12-BW-3003" style="text-transform:uppercase"></label>'
      + '</div>'
      + '<div class="row">'
      + '<label>Tank Capacity (Litres)<input type="number" id="bw_cap" placeholder="e.g. 4000"></label>'
      + '<label>Starting Meter Reading<input type="number" id="bw_start_meter" placeholder="e.g. 1000"></label>'
      + '</div>'
      + '<div class="row">'
      + '<label>Flowmeter Make & Model<input id="bw_fm_make" placeholder="e.g. TCS 700 Electronic / Liquid Controls"></label>'
      + '<label>Flowmeter Serial Number<input id="bw_fm_serial" placeholder="e.g. FM-TCS-99120"></label>'
      + '</div>'
      + '<div class="row">'
      + '<label>Driver Name<input id="bw_driver" placeholder="e.g. Santosh Shinde"></label>'
      + '<label>Driver Mobile<input id="bw_mobile" placeholder="e.g. 9822450011"></label>'
      + '</div>'
      + '<div class="row">'
      + '<label>PESO License Number<input id="bw_peso" placeholder="e.g. PESO/A/MH/2025/11029"></label>'
      + '<label>PESO Expiry Date<input type="date" id="bw_peso_exp" value="' + getTodayIso() + '"></label>'
      + '</div>'
      + '<label>Notes & Safety Equipment<input id="bw_notes" placeholder="e.g. 2x 10kg DCP Fire extinguishers fitted, spark arrestor certified."></label>'
      + '<div class="err" id="bw_err"></div>'
      + '<div class="btns" style="margin-top:14px;display:flex;gap:8px">'
      + '<button class="ghost" onclick="close()">Cancel</button>'
      + '<button style="flex:1" onclick="submitAddBowser()">Register Bowser</button>'
      + '</div>';

    openM(h);
  }

  function submitAddBowser(){
    var name = v("bw_name");
    var reg = v("bw_reg");
    var cap = v("bw_cap");
    var meter = v("bw_start_meter");
    var fmMake = v("bw_fm_make");
    var fmSerial = v("bw_fm_serial");
    var driver = v("bw_driver");
    var mobile = v("bw_mobile");
    var peso = v("bw_peso");
    var pesoExp = v("bw_peso_exp");
    var notes = v("bw_notes");
    var errEl = document.getElementById("bw_err");

    if (!name || !reg || !cap || !fmMake) {
      if (errEl) errEl.textContent = "Please fill name, registration no, capacity, and flowmeter.";
      return;
    }

    api("POST", "/api/bowsers/create", {
      name: name,
      reg_no: reg,
      capacity_litres: parseFloat(cap),
      starting_meter: meter ? parseFloat(meter) : 0,
      flowmeter_make: fmMake,
      flowmeter_serial: fmSerial,
      driver_name: driver,
      driver_mobile: mobile,
      peso_license_no: peso,
      peso_expiry_d: pesoExp,
      notes: notes
    }).then(function(){
      close();
      toast("Bowser registered successfully!");
      loadBowserData();
    }).catch(function(e){
      if (errEl) errEl.textContent = e.error || "Could not register bowser.";
    });
  }

  function openStartBowserTripModal(bowserId){
    var bowsers = (BOWSER_DATA && BOWSER_DATA.bowsers) ? BOWSER_DATA.bowsers : [];
    var selBowser = bowsers.find(function(b){ return b.id === bowserId; }) || bowsers[0];
    if (!selBowser) { toast("No bowser available."); return; }

    var h = '<h2>🚀 Start Bowser Dispatch Trip</h2>'
      + '<div class="sub">Deploy mobile diesel dispenser to customer sites, farms, or generator plants.</div>'
      + '<label style="margin-top:12px">Select Mobile Bowser'
      + '<select id="tr_bowser" onchange="updateTripBowserInfo()">'
      + bowsers.map(function(b){
          var sel = (selBowser && b.id === selBowser.id) ? ' selected' : '';
          return '<option value="' + b.id + '"' + sel + '>' + esc(b.reg_no) + ' - ' + esc(b.name) + ' (' + (b.current_fuel_stock||0) + 'L in tank)</option>';
        }).join("")
      + '</select></label>'
      + '<div id="tr_bowser_info" style="background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:8px 0;font-size:12.5px"></div>'
      + '<div class="row">'
      + '<label>Driver Name<input id="tr_driver" value="' + esc(selBowser.driver_name || '') + '"></label>'
      + '<label>Driver Phone<input id="tr_mobile" value="' + esc(selBowser.driver_mobile || '') + '"></label>'
      + '</div>'
      + '<div class="row">'
      + '<label>Helper / Operator<input id="tr_helper" placeholder="e.g. Rahul More"></label>'
      + '<label>Starting Flowmeter Counter<input type="number" step="0.1" id="tr_meter" value="' + (selBowser.current_totalizer_meter || 0) + '"></label>'
      + '</div>'
      + '<label>Destination Sites / Route Summary<input id="tr_dest" placeholder="e.g. Pune-Solapur Highway Construction, Serum Institute DG Set, Kirloskar Site"></label>'
      + '<label>Trip Notes / Safety Clearance<input id="tr_notes" placeholder="e.g. Driver verified all earthing cables and nozzle auto shut-off."></label>'
      + '<div class="err" id="tr_err"></div>'
      + '<div class="btns" style="margin-top:14px;display:flex;gap:8px">'
      + '<button class="ghost" onclick="close()">Cancel</button>'
      + '<button style="flex:1" onclick="submitStartBowserTrip()">Start Trip & Dispatch</button>'
      + '</div>';

    openM(h);
    updateTripBowserInfo();
  }

  function updateTripBowserInfo(){
    var bId = v("tr_bowser");
    var bowsers = (BOWSER_DATA && BOWSER_DATA.bowsers) ? BOWSER_DATA.bowsers : [];
    var b = bowsers.find(function(x){ return String(x.id) === String(bId); });
    var infoEl = document.getElementById("tr_bowser_info");
    if (!infoEl || !b) return;

    infoEl.innerHTML = 'Current Diesel Stock: <b>' + (b.current_fuel_stock || 0).toLocaleString("en-IN") + ' L</b> &nbsp;|&nbsp; Flowmeter: <b>' + esc(b.flowmeter_make) + '</b> &nbsp;|&nbsp; Status: <b>' + esc(b.status) + '</b>';
    var driverEl = document.getElementById("tr_driver");
    var mobEl = document.getElementById("tr_mobile");
    var meterEl = document.getElementById("tr_meter");
    if (driverEl && b.driver_name) driverEl.value = b.driver_name;
    if (mobEl && b.driver_mobile) mobEl.value = b.driver_mobile;
    if (meterEl && b.current_totalizer_meter) meterEl.value = b.current_totalizer_meter;
  }

  function submitStartBowserTrip(){
    var bId = v("tr_bowser");
    var driver = v("tr_driver");
    var mobile = v("tr_mobile");
    var helper = v("tr_helper");
    var meter = v("tr_meter");
    var dest = v("tr_dest");
    var notes = v("tr_notes");
    var errEl = document.getElementById("tr_err");

    if (!bId || !driver) {
      if (errEl) errEl.textContent = "Please select bowser and enter driver name.";
      return;
    }

    api("POST", "/api/bowser-trip/start", {
      bowser_id: parseInt(bId),
      driver_name: driver,
      driver_mobile: mobile,
      helper_name: helper,
      starting_meter: meter ? parseFloat(meter) : undefined,
      destination_summary: dest,
      notes: notes
    }).then(function(res){
      close();
      toast("Trip " + res.trip_no + " started successfully!");
      loadBowserData();
    }).catch(function(e){
      if (errEl) errEl.textContent = e.error || "Could not start trip.";
    });
  }

  function openBowserDeliveryModal(tripId){
    var trips = (BOWSER_DATA && BOWSER_DATA.trips) ? BOWSER_DATA.trips : [];
    var openTrips = trips.filter(function(t){ return t.status === "open"; });
    var selTrip = trips.find(function(t){ return t.id === tripId; }) || openTrips[0];
    if (!selTrip) { toast("No active open trip available."); return; }

    var customers = (BOWSER_DATA && BOWSER_DATA.customers) ? BOWSER_DATA.customers : [];
    var curMeter = (selTrip.starting_meter || 0) + (selTrip.total_dispensed_qty || 0);

    var h = '<h2>⛽ Log Doorstep Refueling Delivery</h2>'
      + '<div class="sub">Trip: <b>' + esc(selTrip.trip_no) + '</b> (' + esc(selTrip.bowser_reg) + ')</div>'
      + '<label style="margin-top:12px">Client / Transporter / Account'
      + '<select id="dlv_cust" onchange="autoFillBowserClient()">'
      + '<option value="">-- Direct / Walk-in Customer --</option>'
      + customers.map(function(c){ return '<option value="' + c.id + '" data-name="' + esc(c.name) + '">' + esc(c.name) + ' (Limit: ' + inr(c.limit||0) + ')</option>'; }).join("")
      + '</select></label>'
      + '<div class="row">'
      + '<label>Client / Company Name<input id="dlv_client" placeholder="e.g. Shree Transport / Kirloskar Site"></label>'
      + '<label>Site / GPS Location<input id="dlv_site" placeholder="e.g. Hadapsar Depot Yard / Pune Metro Pillar 42"></label>'
      + '</div>'
      + '<div class="row">'
      + '<label>Machinery / Asset Refueled<input id="dlv_asset" placeholder="e.g. 250 kVA Perkins DG / CAT 320D Excavator"></label>'
      + '<label>Payment Mode<select id="dlv_mode"><option value="credit">Credit Ledger (Post to Account)</option><option value="cash">Cash Received</option><option value="upi">UPI / Online QR</option></select></label>'
      + '</div>'
      + '<div class="row">'
      + '<label>Flowmeter Start Meter<input type="number" step="0.1" id="dlv_start_meter" value="' + curMeter + '" oninput="calcBowserDeliveryAmt()"></label>'
      + '<label>Flowmeter End Meter<input type="number" step="0.1" id="dlv_end_meter" value="' + (curMeter + 200) + '" oninput="calcBowserDeliveryAmt()"></label>'
      + '</div>'
      + '<div class="row">'
      + '<label>Dispensed Litres (calculated)<input type="number" step="0.1" id="dlv_qty" value="200" oninput="calcBowserDeliveryAmt(true)"></label>'
      + '<label>Rate (₹/L)<input type="number" step="0.01" id="dlv_rate" value="91.50" oninput="calcBowserDeliveryAmt()"></label>'
      + '</div>'
      + '<div style="background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px;margin:10px 0;text-align:center">'
      + '<div class="sub" style="font-size:12px">Total Billed Doorstep Refueling Amount</div>'
      + '<div style="font-size:24px;font-weight:800;color:var(--ok)" id="dlv_total_txt">₹18,300</div>'
      + '</div>'
      + '<div class="row">'
      + '<label>Site Recipient Person<input id="dlv_rec_name" placeholder="e.g. Ramesh Kadam (Site Eng)"></label>'
      + '<label>Recipient Mobile<input id="dlv_rec_mob" placeholder="e.g. 9822001122"></label>'
      + '</div>'
      + '<label>Delivery Notes & Safety Verification<input id="dlv_notes" placeholder="e.g. Clean fuel verified, Kolor-Kut water paste test shown to site supervisor."></label>'
      + '<div class="err" id="dlv_err"></div>'
      + '<div class="btns" style="margin-top:14px;display:flex;gap:8px">'
      + '<button class="ghost" onclick="close()">Cancel</button>'
      + '<button style="flex:1" onclick="submitBowserDelivery(' + selTrip.id + ')">Generate Challan & Save</button>'
      + '</div>';

    openM(h);
    calcBowserDeliveryAmt();
  }

  function autoFillBowserClient(){
    var custSel = document.getElementById("dlv_cust");
    if (!custSel) return;
    var opt = custSel.options[custSel.selectedIndex];
    if (opt && opt.value) {
      var clientEl = document.getElementById("dlv_client");
      if (clientEl) clientEl.value = opt.getAttribute("data-name") || "";
    }
  }

  function calcBowserDeliveryAmt(manualQty){
    var sM = parseFloat(v("dlv_start_meter") || 0);
    var eM = parseFloat(v("dlv_end_meter") || 0);
    var rate = parseFloat(v("dlv_rate") || 0);
    var qtyEl = document.getElementById("dlv_qty");
    var totalTxt = document.getElementById("dlv_total_txt");

    var qty = 0;
    if (manualQty) {
      qty = parseFloat(v("dlv_qty") || 0);
      var endEl = document.getElementById("dlv_end_meter");
      if (endEl) endEl.value = Math.round((sM + qty) * 10) / 10;
    } else {
      qty = Math.max(0, Math.round((eM - sM) * 10) / 10);
      if (qtyEl) qtyEl.value = qty;
    }

    var total = Math.round(qty * rate * 100) / 100;
    if (totalTxt) totalTxt.textContent = inr(total);
  }

  function submitBowserDelivery(tripId){
    var custId = v("dlv_cust");
    var client = v("dlv_client");
    var site = v("dlv_site");
    var asset = v("dlv_asset");
    var mode = v("dlv_mode");
    var sM = v("dlv_start_meter");
    var eM = v("dlv_end_meter");
    var qty = v("dlv_qty");
    var rate = v("dlv_rate");
    var recName = v("dlv_rec_name");
    var recMob = v("dlv_rec_mob");
    var notes = v("dlv_notes");
    var errEl = document.getElementById("dlv_err");

    if (!client || !asset || !qty || !rate) {
      if (errEl) errEl.textContent = "Please fill client name, asset refueled, litres, and rate.";
      return;
    }

    api("POST", "/api/bowser-delivery", {
      trip_id: tripId,
      cust_id: custId || null,
      client_name: client,
      site_location: site || "On-site",
      asset_type: asset,
      payment_mode: mode,
      start_meter: parseFloat(sM),
      end_meter: parseFloat(eM),
      qty_litres: parseFloat(qty),
      rate: parseFloat(rate),
      recipient_person: recName,
      recipient_mobile: recMob,
      notes: notes
    }).then(function(res){
      close();
      toast("Delivery Challan " + res.challan_no + " logged!");
      loadBowserData();
    }).catch(function(e){
      if (errEl) errEl.textContent = e.error || "Could not log delivery.";
    });
  }

  function openCompleteBowserTripModal(tripId){
    var trips = (BOWSER_DATA && BOWSER_DATA.trips) ? BOWSER_DATA.trips : [];
    var t = trips.find(function(x){ return x.id === tripId; });
    if (!t) return;

    var curMeter = (t.starting_meter || 0) + (t.total_dispensed_qty || 0);
    var expectedRem = Math.max(0, (t.starting_fuel_qty || 0) - (t.total_dispensed_qty || 0));

    var h = '<h2>🏁 Close & Reconcile Bowser Trip</h2>'
      + '<div class="sub">Trip: <b>' + esc(t.trip_no) + '</b> · Unit: <b>' + esc(t.bowser_reg) + '</b></div>'
      + '<div style="background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px;margin:12px 0">'
      + '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><span>Starting Bowser Stock:</span><b>' + (t.starting_fuel_qty||0).toLocaleString("en-IN") + ' L</b></div>'
      + '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><span>Total Dispensed at Sites:</span><b style="color:var(--ok)">' + (t.total_dispensed_qty||0).toLocaleString("en-IN") + ' L</b></div>'
      + '<div style="display:flex;justify-content:space-between;font-size:13px;border-top:1px dashed var(--line);padding-top:6px"><span>Calculated Balance in Tank:</span><b>' + expectedRem.toLocaleString("en-IN") + ' L</b></div>'
      + '</div>'
      + '<div class="row">'
      + '<label>Ending Flowmeter Reading<input type="number" step="0.1" id="cl_meter" value="' + curMeter + '"></label>'
      + '<label>Remaining Physical Dip (Litres)<input type="number" step="0.1" id="cl_dip" value="' + expectedRem + '"></label>'
      + '</div>'
      + '<label>Trip Completion Notes / Driver Clearance<input id="cl_notes" placeholder="e.g. Returned to petrol pump station safely, all challans signed."></label>'
      + '<div class="err" id="cl_err"></div>'
      + '<div class="btns" style="margin-top:14px;display:flex;gap:8px">'
      + '<button class="ghost" onclick="close()">Cancel</button>'
      + '<button style="flex:1" onclick="submitCompleteBowserTrip(' + t.id + ')">Complete Trip & Save</button>'
      + '</div>';

    openM(h);
  }

  function submitCompleteBowserTrip(tripId){
    var meter = v("cl_meter");
    var dip = v("cl_dip");
    var notes = v("cl_notes");
    var errEl = document.getElementById("cl_err");

    api("POST", "/api/bowser-trip/complete", {
      trip_id: tripId,
      ending_meter: meter ? parseFloat(meter) : undefined,
      remaining_dip_litres: dip ? parseFloat(dip) : undefined,
      notes: notes
    }).then(function(){
      close();
      toast("Trip closed and reconciled!");
      loadBowserData();
    }).catch(function(e){
      if (errEl) errEl.textContent = e.error || "Could not complete trip.";
    });
  }

  function openBowserRefillModal(bowserId){
    var bowsers = (BOWSER_DATA && BOWSER_DATA.bowsers) ? BOWSER_DATA.bowsers : [];
    var sel = bowsers.find(function(b){ return b.id === bowserId; }) || bowsers[0];

    var h = '<h2>⛽ Refill Bowser Tank (Loading)</h2>'
      + '<div class="sub">Load diesel into mobile bowser from underground storage tank.</div>'
      + '<label style="margin-top:12px">Select Mobile Bowser'
      + '<select id="rf_bowser">'
      + bowsers.map(function(b){
          var s = (sel && b.id === sel.id) ? ' selected' : '';
          return '<option value="' + b.id + '"' + s + '>' + esc(b.reg_no) + ' - ' + esc(b.name) + ' (Cap: ' + b.capacity_litres + 'L)</option>';
        }).join("")
      + '</select></label>'
      + '<div class="row">'
      + '<label>Source Underground Tank<select id="rf_tank"><option value="T2">Tank 2 (Diesel HSD)</option><option value="T3">Tank 3 (Diesel HSD)</option></select></label>'
      + '<label>Loaded Diesel Quantity (Litres)<input type="number" step="0.1" id="rf_qty" placeholder="e.g. 3000"></label>'
      + '</div>'
      + '<div class="row">'
      + '<label>Fuel Density @ 15°C (kg/m³)<input type="number" step="0.1" id="rf_dens" value="832.0"></label>'
      + '<label>Temperature (°C)<input type="number" step="0.1" id="rf_temp" value="27.0"></label>'
      + '</div>'
      + '<div class="row">'
      + '<label>Main Tank Dip Before Loading (cm)<input type="number" step="0.1" id="rf_dip_before" placeholder="e.g. 195.0"></label>'
      + '<label>Main Tank Dip After Loading (cm)<input type="number" step="0.1" id="rf_dip_after" placeholder="e.g. 175.0"></label>'
      + '</div>'
      + '<label>Refill Notes<input id="rf_notes" placeholder="e.g. Loaded via pump gantry arm into bowser compartment 1 & 2."></label>'
      + '<div class="err" id="rf_err"></div>'
      + '<div class="btns" style="margin-top:14px;display:flex;gap:8px">'
      + '<button class="ghost" onclick="close()">Cancel</button>'
      + '<button style="flex:1" onclick="submitBowserRefill()">Record Bowser Refill</button>'
      + '</div>';

    openM(h);
  }

  function submitBowserRefill(){
    var bId = v("rf_bowser");
    var tank = v("rf_tank");
    var qty = v("rf_qty");
    var dens = v("rf_dens");
    var temp = v("rf_temp");
    var dBef = v("rf_dip_before");
    var dAft = v("rf_dip_after");
    var notes = v("rf_notes");
    var errEl = document.getElementById("rf_err");

    if (!bId || !qty || !dens) {
      if (errEl) errEl.textContent = "Please fill bowser, quantity, and density.";
      return;
    }

    api("POST", "/api/bowser-refill", {
      bowser_id: parseInt(bId),
      tank_id: tank,
      loaded_qty: parseFloat(qty),
      loaded_density: parseFloat(dens),
      temp_c: temp ? parseFloat(temp) : null,
      dip_before_cm: dBef ? parseFloat(dBef) : null,
      dip_after_cm: dAft ? parseFloat(dAft) : null,
      notes: notes
    }).then(function(){
      close();
      toast("Bowser tank refilled successfully!");
      loadBowserData();
    }).catch(function(e){
      if (errEl) errEl.textContent = e.error || "Could not record refill.";
    });
  }

  function printBowserChallan(deliveryId){
    var deliveries = (BOWSER_DATA && BOWSER_DATA.deliveries) ? BOWSER_DATA.deliveries : [];
    var d = deliveries.find(function(x){ return x.id === deliveryId; });
    if (!d) return;

    var biz = (S && S.biz) ? S.biz : { name: "Petrol Pump Management", addr: "Highway Station", gst: "" };

    var h = '<div class="ops-voucher noprint" style="max-width:500px;font-family:sans-serif">'
      + '<div style="text-align:center;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:12px">'
      + '<div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#0369a1">GOVERNMENT APPROVED DOORSTEP DIESEL DELIVERY (DDD)</div>'
      + '<div style="font-size:18px;font-weight:800;color:#000">' + esc(biz.name || 'PETROL PUMP') + '</div>'
      + '<div style="font-size:11px;color:#555">' + esc(biz.addr || '') + (biz.gst ? ' | GSTIN: ' + esc(biz.gst) : '') + '</div>'
      + '<div style="display:inline-block;border:1px solid #000;padding:2px 8px;font-size:11px;font-weight:700;margin-top:4px">MOBILE REFUELLING DELIVERY CHALLAN</div>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;margin-bottom:10px">'
      + '<div>Challan No: <b>' + esc(d.challan_no) + '</b></div>'
      + '<div>Date & Time: <b>' + d.d + ' ' + esc(d.delivery_time||'') + '</b></div>'
      + '<div>Trip Ref: <b>' + esc(d.trip_no) + '</b></div>'
      + '<div>Bowser Reg: <b>' + esc(d.bowser_reg || 'Bowser') + '</b></div>'
      + '</div>'
      + '<div style="border:1px solid #ccc;padding:8px;border-radius:6px;font-size:12px;margin-bottom:10px;background:#f8fafc">'
      + '<div>Customer / Client: <b style="font-size:13px">' + esc(d.client_name) + '</b></div>'
      + '<div>Site Location: 📍 ' + esc(d.site_location) + '</div>'
      + '<div>Equipment / Asset: <b style="color:#0284c7">' + esc(d.asset_type) + '</b></div>'
      + '<div>Site Recipient: ' + esc(d.recipient_person || 'Supervisor') + (d.recipient_mobile ? ' (' + esc(d.recipient_mobile) + ')' : '') + '</div>'
      + '</div>'
      + '<table style="width:100%;font-size:12px;border-collapse:collapse;margin-bottom:12px">'
      + '<tr style="border-bottom:1px solid #ccc"><th style="text-align:left;padding:4px">Description</th><th style="text-align:right;padding:4px">Details</th></tr>'
      + '<tr><td style="padding:4px">Product Fuel</td><td style="text-align:right;font-weight:700">Diesel (HSD BS-VI)</td></tr>'
      + '<tr><td style="padding:4px">Flowmeter Starting Reading</td><td style="text-align:right">' + (d.start_meter||0).toLocaleString("en-IN") + '</td></tr>'
      + '<tr><td style="padding:4px">Flowmeter Ending Reading</td><td style="text-align:right">' + (d.end_meter||0).toLocaleString("en-IN") + '</td></tr>'
      + '<tr style="font-weight:800;border-top:1px solid #000"><td style="padding:6px 4px;font-size:14px">Delivered Volume</td><td style="text-align:right;font-size:15px;color:#0284c7">' + (d.qty_litres||0).toLocaleString("en-IN") + ' Litres</td></tr>'
      + '<tr><td style="padding:4px">Unit Price (₹/L)</td><td style="text-align:right">₹' + (d.rate||0) + '</td></tr>'
      + '<tr style="font-weight:800;font-size:16px;border-top:2px solid #000;border-bottom:2px solid #000"><td style="padding:8px 4px">Total Billed Amount</td><td style="text-align:right">' + inr(d.amount||0) + '</td></tr>'
      + '</table>'
      + '<div style="font-size:11px;color:#666;margin-bottom:16px">'
      + 'Payment Mode: <b style="text-transform:uppercase">' + esc(d.payment_mode) + '</b>. PESO Statutory Certificate Verified. Product meets ASTM D975 / IS 1460 specifications.'
      + '</div>'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:30px;font-size:12px;border-top:1px dashed #ccc;padding-top:16px">'
      + '<div style="text-align:center"><div style="border-top:1px solid #000;width:140px;margin-bottom:4px"></div>Bowser Operator Sign</div>'
      + '<div style="text-align:center"><div style="border-top:1px solid #000;width:140px;margin-bottom:4px"></div>Customer Receiver Sign</div>'
      + '</div>'
      + '</div>'
      + '<div class="row noprint" style="margin-top:14px;display:flex;gap:8px">'
      + '<button class="ghost" onclick="close()">Close</button>'
      + '<button style="flex:1" onclick="window.print()">🖨️ Print Delivery Challan</button>'
      + '</div>';

    openM(h);
  }

  function printTripChallanSheet(tripId){
    var trips = (BOWSER_DATA && BOWSER_DATA.trips) ? BOWSER_DATA.trips : [];
    var t = trips.find(function(x){ return x.id === tripId; });
    if (!t) return;

    var deliveries = (BOWSER_DATA && BOWSER_DATA.deliveries) ? BOWSER_DATA.deliveries.filter(function(d){ return d.trip_id === tripId; }) : [];
    var biz = (S && S.biz) ? S.biz : { name: "Petrol Pump Management", addr: "Highway Station", gst: "" };

    var h = '<div class="ops-voucher noprint" style="max-width:550px;font-family:sans-serif">'
      + '<div style="text-align:center;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:12px">'
      + '<div style="font-size:18px;font-weight:800">' + esc(biz.name || 'PETROL PUMP') + '</div>'
      + '<div style="font-size:12px;font-weight:700">BOWSER DISPATCH & TRIP SETTLEMENT SHEET</div>'
      + '<div style="font-size:11px;color:#555">Trip Ref: ' + esc(t.trip_no) + ' · Date: ' + t.d + '</div>'
      + '</div>'
      + '<div style="font-size:12px;line-height:1.6;margin-bottom:10px">'
      + '<div>Bowser: <b>' + esc(t.bowser_reg) + ' (' + esc(t.bowser_name) + ')</b></div>'
      + '<div>Driver: <b>' + esc(t.driver_name) + '</b> · Helper: <b>' + esc(t.helper_name || 'N/A') + '</b></div>'
      + '<div>Route / Destination: <b>' + esc(t.destination_summary || 'General Route') + '</b></div>'
      + '<div>Flowmeter Start: <b>' + (t.starting_meter||0).toLocaleString("en-IN") + '</b>' + (t.ending_meter ? ' · End: <b>' + (t.ending_meter||0).toLocaleString("en-IN") + '</b>' : '') + '</div>'
      + '</div>'
      + '<div style="font-weight:700;font-size:12px;margin:8px 0">Deliveries Completed on this Trip (' + deliveries.length + '):</div>'
      + '<table style="width:100%;font-size:11px;border-collapse:collapse;margin-bottom:12px;border:1px solid #ccc">'
      + '<tr style="background:#f1f5f9;border-bottom:1px solid #ccc"><th style="padding:4px;text-align:left">Challan</th><th style="padding:4px;text-align:left">Client & Asset</th><th style="padding:4px;text-align:right">Litres</th><th style="padding:4px;text-align:right">Amount</th></tr>';

    var totL = 0, totAmt = 0;
    deliveries.forEach(function(d){
      totL += (d.qty_litres || 0);
      totAmt += (d.amount || 0);
      h += '<tr style="border-bottom:1px solid #eee"><td style="padding:4px">' + esc(d.challan_no) + '</td><td style="padding:4px"><b>' + esc(d.client_name) + '</b><br><span style="color:#666">' + esc(d.asset_type) + '</span></td><td style="padding:4px;text-align:right;font-weight:700">' + (d.qty_litres||0) + 'L</td><td style="padding:4px;text-align:right">' + inr(d.amount||0) + '</td></tr>';
    });

    h += '<tr style="font-weight:800;background:#f8fafc"><td colspan="2" style="padding:6px 4px">Total Delivered</td><td style="padding:6px 4px;text-align:right;color:#0284c7">' + totL.toLocaleString("en-IN") + ' L</td><td style="padding:6px 4px;text-align:right">' + inr(totAmt) + '</td></tr>'
      + '</table>'
      + '<div style="display:flex;justify-content:space-between;margin-top:30px;font-size:12px">'
      + '<div style="text-align:center"><div style="border-top:1px solid #000;width:120px;margin-bottom:4px"></div>Driver Signature</div>'
      + '<div style="text-align:center"><div style="border-top:1px solid #000;width:120px;margin-bottom:4px"></div>Manager Settlement</div>'
      + '</div>'
      + '</div>'
      + '<div class="row noprint" style="margin-top:14px;display:flex;gap:8px">'
      + '<button class="ghost" onclick="close()">Close</button>'
      + '<button style="flex:1" onclick="window.print()">🖨️ Print Trip Summary</button>'
      + '</div>';

    openM(h);
  }

  // ==========================================
  // 2. AUTOMATED DAILY PROFIT & LOSS BREAKDOWN
  // ==========================================
  function loadPnLData(){
    PNL_LOADING = true;
    var q = "?date_from=" + encodeURIComponent(PNL_DATE_FROM) + "&date_to=" + encodeURIComponent(PNL_DATE_TO);
    api("GET", "/api/pnl-analytics" + q)
      .then(function(res){
        PNL_DATA = res;
        PNL_LOADING = false;
        if (tab === "pnl") renderPnLTab();
      })
      .catch(function(err){
        PNL_LOADING = false;
        toast(err.error || "Could not load Profit & Loss data.");
        if (tab === "pnl") renderPnLTab();
      });
  }

  function renderPnLTab(){
    tab = "pnl";
    var A = document.getElementById("app");
    if (!A) return;

    if (!SRV) {
      A.innerHTML = nav() + '<div class="empty">Profit & Loss analytics are managed on the server. Please log in.</div>';
      return;
    }

    if (!PNL_DATA && !PNL_LOADING) {
      A.innerHTML = nav() + '<div class="empty">Calculating dealer profit & loss margins and overheads…</div>';
      loadPnLData();
      return;
    }

    var data = PNL_DATA || { daily: [], summary: {}, commissions: {} };
    var summary = data.summary || {};
    var daily = data.daily || [];
    var comms = data.commissions || {};

    var h = nav();

    // Header
    h += '<div class="row" style="align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">';
    h += '<div><h1 style="margin:0">💰 Automated Daily Profit & Loss</h1><div class="sub" style="margin-top:2px">Dealer commission earnings, lube profits, operating overheads, evaporation shrinkage, and net dealer profit.</div></div>';
    h += '<div class="btns" style="margin:0;flex:none">';
    if (ME && ME.role === "owner") {
      h += '<button onclick="openDealerCommissionsModal()" class="ghost" style="font-size:13px">⚙️ Dealer Commission Rates</button>';
    }
    h += '<button onclick="openLogDailyOverheadsModal()" class="ghost" style="font-size:13px">📝 Log Daily Expenses</button>';
    h += '<button class="ghost" onclick="printPnLReport()" style="font-size:13px">🖨️ Print P&L Statement</button>';
    h += '<button class="ghost" onclick="loadPnLData()" title="Refresh" style="padding:8px 12px">🔄</button>';
    h += '</div></div>';

    // Date range filter buttons
    h += '<div class="row noprint" style="gap:8px;align-items:center;margin-bottom:12px">';
    h += '<span class="sub" style="font-size:12px;font-weight:700">Timeframe:</span>';
    h += '<button class="' + (PNL_RANGE==="today"?"":"ghost") + '" style="padding:6px 12px;font-size:12px" onclick="setPnLRange(\'today\')">Today</button>';
    h += '<button class="' + (PNL_RANGE==="7days"?"":"ghost") + '" style="padding:6px 12px;font-size:12px" onclick="setPnLRange(\'7days\')">Last 7 Days</button>';
    h += '<button class="' + (PNL_RANGE==="month"?"":"ghost") + '" style="padding:6px 12px;font-size:12px" onclick="setPnLRange(\'month\')">This Month (30d)</button>';
    h += '<div style="display:flex;align-items:center;gap:6px;margin-left:auto">';
    h += '<label style="margin:0;font-size:12px">From<input type="date" value="' + PNL_DATE_FROM + '" onchange="PNL_DATE_FROM=this.value;PNL_RANGE=\'custom\';loadPnLData()" style="padding:4px 8px;font-size:12px"></label>';
    h += '<label style="margin:0;font-size:12px">To<input type="date" value="' + PNL_DATE_TO + '" onchange="PNL_DATE_TO=this.value;PNL_RANGE=\'custom\';loadPnLData()" style="padding:4px 8px;font-size:12px"></label>';
    h += '</div>';
    h += '</div>';

    // Primary KPI cards
    var isNetPositive = (summary.total_net_profit || 0) >= 0;
    h += '<div class="ops-kpi-bar noprint">';
    h += '<div class="ops-kpi-card">';
    h += '<div class="ops-kpi-num" style="color:#0284c7">' + inr(summary.total_fuel_gross_margin || 0) + '</div>';
    h += '<div class="ops-kpi-lbl">Fuel Gross Margin (' + (summary.total_fuel_litres || 0).toLocaleString("en-IN") + ' L)</div>';
    h += '</div>';

    h += '<div class="ops-kpi-card">';
    h += '<div class="ops-kpi-num" style="color:#059669">' + inr(summary.total_lube_profit || 0) + '</div>';
    h += '<div class="ops-kpi-lbl">Lubricants & DEF Profit</div>';
    h += '</div>';

    h += '<div class="ops-kpi-card">';
    h += '<div class="ops-kpi-num" style="color:#dc2626">−' + inr(summary.total_expenses || 0) + '</div>';
    h += '<div class="ops-kpi-lbl">Operating Overheads & Losses</div>';
    h += '</div>';

    h += '<div class="ops-kpi-card" style="background:' + (isNetPositive ? 'rgba(5,150,105,0.08)' : 'rgba(220,38,38,0.08)') + ';border:2px solid ' + (isNetPositive ? 'var(--ok)' : 'var(--due)') + '">';
    h += '<div class="ops-kpi-num" style="color:' + (isNetPositive ? 'var(--ok)' : 'var(--due)') + ';font-size:22px">' + inr(summary.total_net_profit || 0) + '</div>';
    h += '<div class="ops-kpi-lbl" style="font-weight:700">NET DEALER PROFIT (' + (summary.net_margin_pct || 0) + '%)</div>';
    h += '</div>';
    h += '</div>';

    // Commission Rates pill bar
    h += '<div style="background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px" class="noprint">';
    h += '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:12.5px">';
    h += '<span style="font-weight:700">Active Dealer Commissions:</span>';
    h += '<span class="ho-nozzle-badge" style="background:#0284c7;color:#fff">MS Petrol: ₹' + (comms["Petrol (MS)"] || 3.75) + '/L</span>';
    h += '<span class="ho-nozzle-badge" style="background:#059669;color:#fff">HSD Diesel: ₹' + (comms["Diesel (HSD)"] || 2.58) + '/L</span>';
    h += '<span class="ho-nozzle-badge" style="background:#7c3aed;color:#fff">Power MS: ₹' + (comms["Power petrol"] || 4.15) + '/L</span>';
    h += '<span class="ho-nozzle-badge" style="background:#ea580c;color:#fff">AdBlue (DEF): ₹' + (comms["AdBlue (DEF)"] || 12.00) + '/L</span>';
    h += '</div>';
    h += '<div class="sub" style="font-size:12px">Breakeven Daily Fuel Volume: <b>' + (summary.breakeven_volume_per_day || 814).toLocaleString("en-IN") + ' Litres/day</b></div>';
    h += '</div>';

    // Daily breakdown table
    h += '<div class="ops-table-wrap"><table class="ops-table">';
    h += '<thead><tr><th>Date</th><th class="r">MS Petrol (L)</th><th class="r">HSD Diesel (L)</th><th class="r">Total Fuel (L)</th><th class="r">Fuel Commission</th><th class="r">Lube Profit</th><th class="r" style="color:var(--ok)">Total Gross Profit</th><th class="r" style="color:var(--due)">Operating Overheads</th><th class="r">Net Dealer Profit</th><th class="r">Margin %</th></tr></thead><tbody>';

    if (!daily.length) {
      h += '<tr><td colspan="10" class="empty">No daily sales or expense records found for this period.</td></tr>';
    } else {
      daily.forEach(function(d){
        var isPos = d.net_dealer_profit >= 0;
        h += '<tr>';
        h += '<td><b>' + d.date + '</b></td>';
        h += '<td class="r">' + (d.ms_litres || 0).toLocaleString("en-IN") + '</td>';
        h += '<td class="r">' + (d.hsd_litres || 0).toLocaleString("en-IN") + '</td>';
        h += '<td class="r" style="font-weight:700">' + (d.total_fuel_litres || 0).toLocaleString("en-IN") + ' L</td>';
        h += '<td class="r">' + inr(d.fuel_gross_margin || 0) + '</td>';
        h += '<td class="r">' + inr(d.lube_profit || 0) + '</td>';
        h += '<td class="r" style="font-weight:700;color:var(--ok)">' + inr(d.total_gross_profit || 0) + '</td>';
        h += '<td class="r" style="color:var(--due)">−' + inr(d.overheads.total || 0) + '</td>';
        h += '<td class="r" style="font-weight:800;color:' + (isPos ? 'var(--ok)' : 'var(--due)') + '">' + inr(d.net_dealer_profit || 0) + '</td>';
        h += '<td class="r" style="font-weight:600">' + (d.net_margin_pct || 0) + '%</td>';
        h += '</tr>';
      });
    }

    h += '</tbody></table></div>';
    A.innerHTML = h;
  }

  function setPnLRange(preset){
    PNL_RANGE = preset;
    var today = getTodayIso();
    if (preset === "today") {
      PNL_DATE_FROM = today;
      PNL_DATE_TO = today;
    } else if (preset === "7days") {
      PNL_DATE_FROM = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
      PNL_DATE_TO = today;
    } else if (preset === "month") {
      PNL_DATE_FROM = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
      PNL_DATE_TO = today;
    }
    loadPnLData();
  }

  function openDealerCommissionsModal(){
    var comms = (PNL_DATA && PNL_DATA.commissions) ? PNL_DATA.commissions : {};
    var h = '<h2>⚙️ Configure Dealer Commissions (₹/L)</h2>'
      + '<div class="sub">Set the per-litre dealer commission fixed by Oil Marketing Companies (IOCL/BPCL/HPCL/Shell).</div>'
      + '<div class="row" style="margin-top:12px">'
      + '<label>Petrol (MS) Commission (₹/L)<input type="number" step="0.01" id="comm_ms" value="' + (comms["Petrol (MS)"] || 3.75) + '"></label>'
      + '<label>Diesel (HSD) Commission (₹/L)<input type="number" step="0.01" id="comm_hsd" value="' + (comms["Diesel (HSD)"] || 2.58) + '"></label>'
      + '</div>'
      + '<div class="row">'
      + '<label>Power / Speed MS Commission (₹/L)<input type="number" step="0.01" id="comm_pwr" value="' + (comms["Power petrol"] || 4.15) + '"></label>'
      + '<label>AdBlue (DEF) Margin (₹/L)<input type="number" step="0.01" id="comm_def" value="' + (comms["AdBlue (DEF)"] || 12.00) + '"></label>'
      + '</div>'
      + '<div class="err" id="comm_err"></div>'
      + '<div class="btns" style="margin-top:14px;display:flex;gap:8px">'
      + '<button class="ghost" onclick="close()">Cancel</button>'
      + '<button style="flex:1" onclick="submitDealerCommissions()">Save Commissions</button>'
      + '</div>';

    openM(h);
  }

  function submitDealerCommissions(){
    var ms = parseFloat(v("comm_ms") || 0);
    var hsd = parseFloat(v("comm_hsd") || 0);
    var pwr = parseFloat(v("comm_pwr") || 0);
    var def = parseFloat(v("comm_def") || 0);
    var errEl = document.getElementById("comm_err");

    if (!ms || !hsd) {
      if (errEl) errEl.textContent = "Please enter valid commission rates for MS and HSD.";
      return;
    }

    api("POST", "/api/pnl-commissions", {
      commissions: {
        "Petrol (MS)": ms,
        "Diesel (HSD)": hsd,
        "Power petrol": pwr,
        "AdBlue (DEF)": def
      }
    }).then(function(){
      close();
      toast("Dealer commission rates saved!");
      loadPnLData();
    }).catch(function(e){
      if (errEl) errEl.textContent = e.error || "Could not save commissions.";
    });
  }

  function openLogDailyOverheadsModal(){
    var today = getTodayIso();
    var h = '<h2>📝 Log Daily Operating Overheads</h2>'
      + '<div class="sub">Record electricity power bills, DG fuel cost, staff daily wages, and shrinkage deductions.</div>'
      + '<label style="margin-top:12px">Date<input type="date" id="ov_date" value="' + today + '"></label>'
      + '<div class="row">'
      + '<label>Staff Daily Wages & Shifts (₹)<input type="number" id="ov_wages" value="2400"></label>'
      + '<label>Electricity Power Bill (₹)<input type="number" id="ov_elec" value="680"></label>'
      + '</div>'
      + '<div class="row">'
      + '<label>DG Generator Diesel Burn (₹)<input type="number" id="ov_dg" value="732"></label>'
      + '<label>Evaporation / Shrinkage Loss (₹)<input type="number" id="ov_shrink" value="380"></label>'
      + '</div>'
      + '<div class="row">'
      + '<label>Card Swipe / Bank Interchange (₹)<input type="number" id="ov_pos" value="290"></label>'
      + '<label>Maintenance & Misc Costs (₹)<input type="number" id="ov_misc" value="150"></label>'
      + '</div>'
      + '<label>Notes & Cost Center<input id="ov_notes" placeholder="e.g. DG ran for 2 hours during MSEDCL grid outage."></label>'
      + '<div class="err" id="ov_err"></div>'
      + '<div class="btns" style="margin-top:14px;display:flex;gap:8px">'
      + '<button class="ghost" onclick="close()">Cancel</button>'
      + '<button style="flex:1" onclick="submitDailyOverheads()">Save Overheads</button>'
      + '</div>';

    openM(h);
  }

  function submitDailyOverheads(){
    var dt = v("ov_date");
    var wages = v("ov_wages");
    var elec = v("ov_elec");
    var dg = v("ov_dg");
    var shrink = v("ov_shrink");
    var pos = v("ov_pos");
    var misc = v("ov_misc");
    var notes = v("ov_notes");
    var errEl = document.getElementById("ov_err");

    api("POST", "/api/pnl-overheads", {
      d: dt,
      staff_wages: parseFloat(wages || 0),
      electricity_expense: parseFloat(elec || 0),
      dg_fuel_expense: parseFloat(dg || 0),
      evaporation_shrinkage_cost: parseFloat(shrink || 0),
      bank_pos_charges: parseFloat(pos || 0),
      maintenance_misc: parseFloat(misc || 0),
      notes: notes
    }).then(function(){
      close();
      toast("Daily overheads saved for " + dt);
      loadPnLData();
    }).catch(function(e){
      if (errEl) errEl.textContent = e.error || "Could not save overheads.";
    });
  }

  function printPnLReport(){
    var data = PNL_DATA || { daily: [], summary: {} };
    var s = data.summary || {};
    var biz = (S && S.biz) ? S.biz : { name: "Petrol Pump Management", addr: "Highway Station", gst: "" };

    var h = '<div class="ops-voucher noprint" style="max-width:560px;font-family:sans-serif">'
      + '<div style="text-align:center;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:12px">'
      + '<div style="font-size:18px;font-weight:800">' + esc(biz.name || 'PETROL PUMP') + '</div>'
      + '<div style="font-size:12px;font-weight:700">DEALER OPERATING PROFIT & LOSS STATEMENT</div>'
      + '<div style="font-size:11px;color:#555">Period: ' + (PNL_DATE_FROM || 'Start') + ' to ' + (PNL_DATE_TO || 'Present') + '</div>'
      + '</div>'
      + '<table style="width:100%;font-size:12px;border-collapse:collapse;margin-bottom:14px">'
      + '<tr style="border-bottom:1px solid #ccc"><th style="text-align:left;padding:6px">Operating Head</th><th style="text-align:right;padding:6px">Amount (₹)</th></tr>'
      + '<tr><td style="padding:6px">Total Fuel Dispensed</td><td style="text-align:right;font-weight:700">' + (s.total_fuel_litres || 0).toLocaleString("en-IN") + ' Litres</td></tr>'
      + '<tr><td style="padding:6px">Fuel Gross Dealer Commission</td><td style="text-align:right;color:#0284c7;font-weight:700">' + inr(s.total_fuel_gross_margin || 0) + '</td></tr>'
      + '<tr><td style="padding:6px">Lube & Shop Gross Profit</td><td style="text-align:right;color:#059669;font-weight:700">' + inr(s.total_lube_profit || 0) + '</td></tr>'
      + '<tr style="background:#f1f5f9;font-weight:800"><td style="padding:8px 6px">TOTAL GROSS OPERATING MARGIN</td><td style="text-align:right">' + inr(s.total_gross_profit || 0) + '</td></tr>'
      + '<tr><td style="padding:6px;color:#dc2626">Less: Operating Overheads (Wages, Power, DG, Shrinkage)</td><td style="text-align:right;color:#dc2626;font-weight:700">−' + inr(s.total_expenses || 0) + '</td></tr>'
      + '<tr style="font-size:16px;font-weight:800;border-top:2px solid #000;border-bottom:2px solid #000"><td style="padding:10px 6px">NET DEALER PROFIT</td><td style="text-align:right;color:' + (s.total_net_profit >= 0 ? '#059669' : '#dc2626') + '">' + inr(s.total_net_profit || 0) + '</td></tr>'
      + '</table>'
      + '<div style="font-size:11px;color:#666;margin-bottom:20px">'
      + 'Net Profit Margin: <b>' + (s.net_margin_pct || 0) + '% of Gross Turnover</b>. Breakeven Volume: <b>' + (s.breakeven_volume_per_day || 814) + ' L/day</b>.'
      + '</div>'
      + '<div style="display:flex;justify-content:space-between;margin-top:40px;font-size:12px">'
      + '<div style="text-align:center"><div style="border-top:1px solid #000;width:120px;margin-bottom:4px"></div>Prepared by Manager</div>'
      + '<div style="text-align:center"><div style="border-top:1px solid #000;width:120px;margin-bottom:4px"></div>Dealership Owner Sign</div>'
      + '</div>'
      + '</div>'
      + '<div class="row noprint" style="margin-top:14px;display:flex;gap:8px">'
      + '<button class="ghost" onclick="close()">Close</button>'
      + '<button style="flex:1" onclick="window.print()">🖨️ Print Statement</button>'
      + '</div>';

    openM(h);
  }

  // ==========================================
  // 3. WEIGHTS & MEASURES (W&M) STAMPING VAULT
  // ==========================================
  function loadWmVaultData(){
    WM_LOADING = true;
    api("GET", "/api/wm-vault")
      .then(function(res){
        WM_DATA = res;
        WM_LOADING = false;
        if (tab === "wmvault") renderWmVaultTab();
      })
      .catch(function(err){
        WM_LOADING = false;
        toast(err.error || "Could not load Weights & Measures vault.");
        if (tab === "wmvault") renderWmVaultTab();
      });
  }

  function renderWmVaultTab(){
    tab = "wmvault";
    var A = document.getElementById("app");
    if (!A) return;

    if (!SRV) {
      A.innerHTML = nav() + '<div class="empty">Weights & Measures compliance is managed on the server. Please log in.</div>';
      return;
    }

    if (!WM_DATA && !WM_LOADING) {
      A.innerHTML = nav() + '<div class="empty">Loading Legal Metrology Stamping Vault & 5L Measure checks…</div>';
      loadWmVaultData();
      return;
    }

    var data = WM_DATA || { stamping_records: [], measure_calibrations: [], stats: {} };
    var stats = data.stats || {};
    var stamping = data.stamping_records || [];
    var calibs = data.measure_calibrations || [];

    var h = nav();

    // Header
    h += '<div class="row" style="align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">';
    h += '<div><h1 style="margin:0">⚖️ Weights & Measures Stamping Vault</h1><div class="sub" style="margin-top:2px">Legal Metrology Act 2009 compliance, nozzle verification certificates, pulser lead seals, and 5L conical measure tests.</div></div>';
    h += '<div class="btns" style="margin:0;flex:none">';
    h += '<button onclick="openLog5LMeasureModal()" style="display:inline-flex;align-items:center;gap:6px">+ Log 5L Measure Test</button>';
    if (ME && (ME.role === "owner" || ME.role === "manager")) {
      h += '<button onclick="openUpdateStampingModal()" class="ghost" style="font-size:13px">📜 Update W&M Certificate</button>';
    }
    h += '<button class="ghost" onclick="printWMLogbook()" style="font-size:13px">🖨️ W&M Logbook</button>';
    h += '<button class="ghost" onclick="loadWmVaultData()" title="Refresh" style="padding:8px 12px">🔄</button>';
    h += '</div></div>';

    // Metrics Bar
    h += '<div class="ops-kpi-bar noprint">';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--ok)">' + (stats.total_nozzles_stamped || 0) + '</div><div class="ops-kpi-lbl">Total Dispenser Nozzles Stamped</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:var(--btn)">' + (stats.today_5l_checks_done || 0) + '</div><div class="ops-kpi-lbl">5L Calibrations Passed Today</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:' + (stats.expiring_soon_count > 0 ? 'var(--warn)' : 'var(--ink)') + '">' + (stats.expiring_soon_count || 0) + '</div><div class="ops-kpi-lbl">Stamping Expiring Soon (≤30 Days)</div></div>';
    h += '<div class="ops-kpi-card"><div class="ops-kpi-num" style="color:' + (stats.expired_count > 0 ? 'var(--due)' : 'var(--ok)') + '">' + (stats.expired_count || 0) + '</div><div class="ops-kpi-lbl">Expired / Action Required</div></div>';
    h += '</div>';

    // Alert Banner if nozzles expiring soon
    if (stats.expiring_soon_count > 0) {
      h += '<div style="background:rgba(217,119,6,0.12);border:1px solid rgba(217,119,6,0.3);border-radius:10px;padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;gap:12px" class="noprint">';
      h += '<span style="font-size:24px">⚠️</span>';
      h += '<div><b style="color:#d97706">Legal Metrology Stamping Expiry Notice!</b><div class="sub" style="font-size:12px">' + stats.expiring_soon_count + ' dispensing nozzle(s) require government reverification stamping within 30 days. Schedule the Inspector of Legal Metrology visit to avoid mandatory nozzle shutdown.</div></div>';
      h += '</div>';
    }

    // Subtabs
    h += '<div class="ops-subtabs noprint">';
    h += '<button class="ops-subtab-btn ' + (WM_SUBTAB==="daily5l"?"active":"") + '" onclick="setWmSubtab(\'daily5l\')">📏 Daily 5L Measure & RTT (' + calibs.length + ')</button>';
    h += '<button class="ops-subtab-btn ' + (WM_SUBTAB==="stamping"?"active":"") + '" onclick="setWmSubtab(\'stamping\')">📜 Stamping Certificates (' + stamping.length + ')</button>';
    h += '<button class="ops-subtab-btn ' + (WM_SUBTAB==="reseal"?"active":"") + '" onclick="setWmSubtab(\'reseal\')">🔒 Meter & Pulser Reseals</button>';
    h += '<button class="ops-subtab-btn ' + (WM_SUBTAB==="seals"?"active":"") + '" onclick="setWmSubtab(\'seals\')">🛡️ Lead Seals & Inspector Log</button>';
    h += '</div>';

    if (WM_SUBTAB === "stamping") {
      h += renderWmStampingView(stamping);
    } else if (WM_SUBTAB === "daily5l") {
      h += renderWmMeasureView(calibs);
    } else if (WM_SUBTAB === "reseal") {
      if (typeof window.renderWmResealSubView === "function") {
        h += window.renderWmResealSubView();
      } else {
        h += '<div class="empty">Reseal management ready. Tap button above to log broken seals.</div>';
      }
    } else if (WM_SUBTAB === "seals") {
      h += renderWmSealsView(stamping);
    }

    A.innerHTML = h;
  }

  function setWmSubtab(st){
    WM_SUBTAB = st;
    window.WM_SUBTAB = st;
    renderWmVaultTab();
  }

  function renderWmStampingView(stamping){
    var h = '<div class="ops-prod-grid">';
    var today = getTodayIso();

    stamping.forEach(function(s){
      var diffDays = Math.ceil((new Date(s.expiry_d) - new Date(today)) / 864e5);
      var isExp = diffDays < 0;
      var isWarn = diffDays >= 0 && diffDays <= 30;

      h += '<div class="ops-prod-card" style="border-top:4px solid ' + (isExp ? 'var(--due)' : isWarn ? 'var(--warn)' : 'var(--ok)') + '">';
      h += '<div>';
      h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">';
      h += '<div>';
      h += '<div style="font-weight:800;font-size:16px;color:var(--ink)">' + esc(s.nozzle_id) + ' · ' + esc(s.fuel_product) + '</div>';
      h += '<div class="sub" style="font-size:12px">' + esc(s.island_name) + '</div>';
      h += '</div>';
      if (isExp) h += '<span class="ops-pill ops-pill-err">🔴 Expired ' + Math.abs(diffDays) + 'd ago</span>';
      else if (isWarn) h += '<span class="ops-pill ops-pill-warn">🟡 Expires in ' + diffDays + 'd</span>';
      else h += '<span class="ops-pill ops-pill-ok">🟢 Valid (' + diffDays + 'd left)</span>';
      h += '</div>';

      h += '<div style="font-size:12px;line-height:1.6;margin:10px 0;background:var(--bg);padding:10px 12px;border-radius:8px">';
      h += '<div>Dispenser Make: <b>' + esc(s.dispenser_make) + '</b></div>';
      h += '<div>Serial No: <b>' + esc(s.serial_no) + '</b></div>';
      h += '<div>Certificate #: <b style="color:var(--btn)">' + esc(s.certificate_no) + '</b></div>';
      h += '<div>Verified by: <b>' + esc(s.inspector_name) + '</b></div>';
      h += '<div>Office: <span class="sub">' + esc(s.legal_metrology_office) + '</span></div>';
      h += '<div>Last Stamping: <b>' + s.last_stamping_d + '</b></div>';
      h += '<div>Valid Till: <b style="color:' + (isExp ? 'var(--due)' : isWarn ? 'var(--warn)' : 'var(--ink)') + '">' + s.expiry_d + '</b></div>';
      h += '</div>';

      h += '<div class="sub" style="font-size:11.5px">' + (s.notes ? esc(s.notes) : 'Lead seals verified intact.') + '</div>';
      h += '</div>';

      h += '<div class="btns" style="margin-top:12px;display:flex;gap:6px">';
      h += '<button class="ghost" style="flex:1;font-size:12px;padding:6px 8px" onclick="openLog5LMeasureModal(\'' + s.nozzle_id + '\',\'' + s.fuel_product + '\')">📏 Test 5L</button>';
      h += '<button class="ghost" style="flex:1;font-size:12px;padding:6px 8px" onclick="openUpdateStampingModal(\'' + s.nozzle_id + '\')">📜 Re-Stamp</button>';
      h += '</div>';

      h += '</div>';
    });

    h += '</div>';
    return h;
  }

  function renderWmMeasureView(calibs){
    var h = '<div class="ops-table-wrap"><table class="ops-table">';
    h += '<thead><tr><th>Date & Time</th><th>Nozzle</th><th>Product</th><th class="r">5L Measure Delivered</th><th class="r">Error (ml)</th><th class="r">Permissible Limit</th><th>Status</th><th>Returned To Tank</th><th>Tested By</th></tr></thead><tbody>';

    if (!calibs.length) {
      h += '<tr><td colspan="9" class="empty">No 5L stamped measure calibrations recorded yet.</td></tr>';
    } else {
      calibs.forEach(function(c){
        var isPass = c.is_pass === 1;
        h += '<tr>';
        h += '<td><b>' + c.d + '</b> <span class="sub">' + esc(c.time_str) + '</span></td>';
        h += '<td><span class="ho-nozzle-badge" style="background:#0284c7;color:#fff">' + esc(c.nozzle_id) + '</span></td>';
        h += '<td><b>' + esc(c.fuel_product) + '</b></td>';
        h += '<td class="r" style="font-weight:700;font-size:13.5px">' + (c.delivered_volume_ml || 5000) + ' ml</td>';
        h += '<td class="r" style="font-weight:800;color:' + (isPass ? 'var(--ok)' : 'var(--due)') + '">' + (c.error_ml >= 0 ? '+' : '') + c.error_ml + ' ml</td>';
        h += '<td class="r sub">±25 ml (0.5%)</td>';
        h += '<td><span class="ops-pill ' + (isPass ? 'ops-pill-ok' : 'ops-pill-err') + '">' + (isPass ? '✅ PASSED' : '❌ OUT OF TOLERANCE') + '</span></td>';
        h += '<td>Tank ' + esc(c.returned_to_tank_id) + '</td>';
        h += '<td>' + esc(c.tested_by_name || 'Staff') + '</td>';
        h += '</tr>';
      });
    }

    h += '</tbody></table></div>';
    return h;
  }

  function renderWmSealsView(stamping){
    var h = '<div class="ops-table-wrap"><table class="ops-table">';
    h += '<thead><tr><th>Nozzle ID</th><th>Dispenser Make</th><th>Island</th><th>Pulser Lead Seal Tag #</th><th>Motherboard Seal Tag #</th><th>K-Factor Seal</th><th>Seal Integrity</th><th>Action</th></tr></thead><tbody>';

    stamping.forEach(function(s){
      h += '<tr>';
      h += '<td><span class="ho-nozzle-badge" style="background:#1e293b;color:#fff">' + esc(s.nozzle_id) + '</span></td>';
      h += '<td><b>' + esc(s.dispenser_make) + '</b></td>';
      h += '<td>' + esc(s.island_name) + '</td>';
      h += '<td><code style="background:var(--bg);padding:3px 6px;border-radius:4px;border:1px solid var(--line);font-weight:700">' + esc(s.pulser_seal_no || 'PLS-MH-0000') + '</code></td>';
      h += '<td><code style="background:var(--bg);padding:3px 6px;border-radius:4px;border:1px solid var(--line);font-weight:700">' + esc(s.totalizer_motherboard_seal_no || 'MB-TAG-0000') + '</code></td>';
      h += '<td>' + esc(s.lead_seal_k_factor || 'K-Factor Sealed') + '</td>';
      h += '<td><span class="ops-pill ops-pill-ok">🔒 Lead Wire Intact</span></td>';
      h += '<td><button class="ghost" style="padding:4px 8px;font-size:12px" onclick="openUpdateStampingModal(\'' + s.nozzle_id + '\')">Update Seals</button></td>';
      h += '</tr>';
    });

    h += '</tbody></table></div>';
    return h;
  }

  function openLog5LMeasureModal(nozzleId, fuelProduct){
    var nozzles = (S && S.nozzles) ? S.nozzles.filter(function(n){ return n.active !== false; }) : [];
    var selNid = nozzleId || (nozzles[0] ? nozzles[0].id : "N1");

    var h = '<h2>📏 Morning 5-Liter Measure Calibration</h2>'
      + '<div class="sub">Statutory test using government stamped conical brass measure. Permissible tolerance is ±25 ml.</div>'
      + '<label style="margin-top:12px">Dispensing Nozzle'
      + '<select id="cal_nozzle">'
      + nozzles.map(function(n){
          var sel = (n.id === selNid) ? ' selected' : '';
          return '<option value="' + n.id + '" data-fuel="' + esc(n.fuel) + '"' + sel + '>' + esc(n.id) + ' - ' + esc(n.name) + ' (' + esc(n.fuel) + ')</option>';
        }).join("")
      + '</select></label>'
      + '<div class="row">'
      + '<label>Measure Capacity<input value="5.0 Litres (5000 ml)" disabled></label>'
      + '<label>Actual Delivered Volume (ml)<input type="number" id="cal_deliv" value="5000" oninput="calc5LError()"></label>'
      + '</div>'
      + '<div id="cal_error_box" style="background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px;margin:10px 0;text-align:center">'
      + '<div class="sub" style="font-size:12px">Measurement Error vs Tolerance</div>'
      + '<div style="font-size:22px;font-weight:800;color:var(--ok)" id="cal_error_txt">0 ml (PASSED)</div>'
      + '<div class="sub" style="font-size:11.5px;margin-top:2px">Legal Metrology limit: ±25 ml (4975 ml to 5025 ml)</div>'
      + '</div>'
      + '<div class="row">'
      + '<label>Returned to Storage Tank<select id="cal_tank"><option value="T1">Tank 1 (Petrol MS)</option><option value="T2">Tank 2 (Diesel HSD)</option></select></label>'
      + '<label style="display:flex;align-items:center;gap:8px;margin-top:24px"><input type="checkbox" id="cal_seal_ok" checked style="width:auto;margin:0"> Lead Seals Verified Intact</label>'
      + '</div>'
      + '<label>Notes & Verification<input id="cal_notes" placeholder="e.g. Test fuel poured back into tank. Nozzle auto shut-off verified."></label>'
      + '<div class="err" id="cal_err"></div>'
      + '<div class="btns" style="margin-top:14px;display:flex;gap:8px">'
      + '<button class="ghost" onclick="close()">Cancel</button>'
      + '<button style="flex:1" onclick="submit5LMeasureCalib()">Save 5L Measure Record</button>'
      + '</div>';

    openM(h);
    calc5LError();
  }

  function calc5LError(){
    var deliv = parseFloat(v("cal_deliv") || 5000);
    var err = Math.round((deliv - 5000) * 10) / 10;
    var isPass = Math.abs(err) <= 25.0;
    var box = document.getElementById("cal_error_txt");
    if (!box) return;

    if (isPass) {
      box.style.color = "var(--ok)";
      box.textContent = (err >= 0 ? "+" : "") + err + " ml (PASSED)";
    } else {
      box.style.color = "var(--due)";
      box.textContent = (err >= 0 ? "+" : "") + err + " ml (OUT OF TOLERANCE!)";
    }
  }

  function submit5LMeasureCalib(){
    var nid = v("cal_nozzle");
    var deliv = v("cal_deliv");
    var tank = v("cal_tank");
    var sealOk = document.getElementById("cal_seal_ok") ? document.getElementById("cal_seal_ok").checked : true;
    var notes = v("cal_notes");
    var errEl = document.getElementById("cal_err");

    var nozSel = document.getElementById("cal_nozzle");
    var opt = nozSel ? nozSel.options[nozSel.selectedIndex] : null;
    var fuel = opt ? opt.getAttribute("data-fuel") : "Diesel (HSD)";

    if (!nid || !deliv || !tank) {
      if (errEl) errEl.textContent = "Please fill all required calibration fields.";
      return;
    }

    api("POST", "/api/wm-calibrations/log", {
      nozzle_id: nid,
      fuel_product: fuel,
      delivered_volume_ml: parseFloat(deliv),
      returned_to_tank_id: tank,
      seal_intact: sealOk ? 1 : 0,
      notes: notes
    }).then(function(){
      close();
      toast("5-Liter calibration record saved for Nozzle " + nid);
      loadWmVaultData();
      if (typeof loadDensityData === "function") loadDensityData();
    }).catch(function(e){
      if (errEl) errEl.textContent = e.error || "Could not log calibration.";
    });
  }

  function openUpdateStampingModal(nozzleId){
    var stamping = (WM_DATA && WM_DATA.stamping_records) ? WM_DATA.stamping_records : [];
    var s = stamping.find(function(x){ return x.nozzle_id === nozzleId; }) || stamping[0] || {};

    var today = getTodayIso();
    var defaultExp = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);

    var h = '<h2>📜 Update Legal Metrology Stamping Certificate</h2>'
      + '<div class="sub">Record annual/quarterly verification stamping by Government Legal Metrology Officer.</div>'
      + '<div class="row" style="margin-top:12px">'
      + '<label>Nozzle ID<input id="us_nid" value="' + esc(s.nozzle_id || 'N1') + '"></label>'
      + '<label>Fuel Product<input id="us_fuel" value="' + esc(s.fuel_product || 'Diesel (HSD)') + '"></label>'
      + '</div>'
      + '<div class="row">'
      + '<label>Dispenser Make & Model<input id="us_make" value="' + esc(s.dispenser_make || 'Gilbarco / Tokheim') + '"></label>'
      + '<label>Dispenser Serial Number<input id="us_sn" value="' + esc(s.serial_no || 'SN-001') + '"></label>'
      + '</div>'
      + '<div class="row">'
      + '<label>Verification Date<input type="date" id="us_last_d" value="' + (s.last_stamping_d || today) + '"></label>'
      + '<label>Next Expiry Date<input type="date" id="us_exp_d" value="' + (s.expiry_d || defaultExp) + '"></label>'
      + '</div>'
      + '<div class="row">'
      + '<label>Verification Certificate #<input id="us_cert" value="' + esc(s.certificate_no || 'LM/MH/PUN/2026/0000') + '"></label>'
      + '<label>Inspector Name<input id="us_insp" value="' + esc(s.inspector_name || 'Inspector Legal Metrology') + '"></label>'
      + '</div>'
      + '<label>Legal Metrology Division Office<input id="us_office" value="' + esc(s.legal_metrology_office || 'Legal Metrology Division') + '"></label>'
      + '<div class="row">'
      + '<label>Pulser Lead Seal Tag #<input id="us_pulser_seal" value="' + esc(s.pulser_seal_no || '') + '"></label>'
      + '<label>Motherboard Seal Tag #<input id="us_mb_seal" value="' + esc(s.totalizer_motherboard_seal_no || '') + '"></label>'
      + '</div>'
      + '<label>Inspector Remarks<input id="us_notes" value="' + esc(s.notes || '') + '"></label>'
      + '<div class="err" id="us_err"></div>'
      + '<div class="btns" style="margin-top:14px;display:flex;gap:8px">'
      + '<button class="ghost" onclick="close()">Cancel</button>'
      + '<button style="flex:1" onclick="submitUpdateStamping()">Save Stamping Certificate</button>'
      + '</div>';

    openM(h);
  }

  function submitUpdateStamping(){
    var nid = v("us_nid");
    var fuel = v("us_fuel");
    var make = v("us_make");
    var sn = v("us_sn");
    var lastD = v("us_last_d");
    var expD = v("us_exp_d");
    var cert = v("us_cert");
    var insp = v("us_insp");
    var office = v("us_office");
    var pulser = v("us_pulser_seal");
    var mb = v("us_mb_seal");
    var notes = v("us_notes");
    var errEl = document.getElementById("us_err");

    if (!nid || !cert || !expD) {
      if (errEl) errEl.textContent = "Please fill nozzle ID, certificate #, and expiry date.";
      return;
    }

    api("POST", "/api/wm-stamping/update", {
      nozzle_id: nid,
      fuel_product: fuel,
      dispenser_make: make,
      serial_no: sn,
      last_stamping_d: lastD,
      expiry_d: expD,
      certificate_no: cert,
      inspector_name: insp,
      legal_metrology_office: office,
      pulser_seal_no: pulser,
      totalizer_motherboard_seal_no: mb,
      notes: notes
    }).then(function(){
      close();
      toast("Weights & Measures certificate updated for Nozzle " + nid);
      loadWmVaultData();
    }).catch(function(e){
      if (errEl) errEl.textContent = e.error || "Could not save certificate.";
    });
  }

  function printWMLogbook(){
    var data = WM_DATA || { stamping_records: [], measure_calibrations: [] };
    var stamping = data.stamping_records || [];
    var calibs = data.measure_calibrations || [];
    var biz = (S && S.biz) ? S.biz : { name: "Petrol Pump Management", addr: "Highway Station", gst: "" };

    var h = '<div class="ops-voucher noprint" style="max-width:600px;font-family:sans-serif">'
      + '<div style="text-align:center;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:12px">'
      + '<div style="font-size:18px;font-weight:800">' + esc(biz.name || 'PETROL PUMP') + '</div>'
      + '<div style="font-size:12px;font-weight:700">LEGAL METROLOGY ACT 2009 - WEIGHTS & MEASURES LOGBOOK</div>'
      + '<div style="font-size:11px;color:#555">' + esc(biz.addr || '') + ' | Inspection Register</div>'
      + '</div>'
      + '<div style="font-weight:700;font-size:12px;margin:8px 0">1. Dispensing Nozzle Stamping Certificates & Seals:</div>'
      + '<table style="width:100%;font-size:11px;border-collapse:collapse;margin-bottom:14px;border:1px solid #ccc">'
      + '<tr style="background:#f1f5f9;border-bottom:1px solid #ccc"><th style="padding:4px;text-align:left">Nozzle</th><th style="padding:4px;text-align:left">Make / S/N</th><th style="padding:4px;text-align:left">Certificate #</th><th style="padding:4px;text-align:left">Valid Till</th><th style="padding:4px;text-align:left">Pulser Seal</th></tr>';

    stamping.forEach(function(s){
      h += '<tr style="border-bottom:1px solid #eee"><td style="padding:4px"><b>' + esc(s.nozzle_id) + '</b> (' + esc(s.fuel_product) + ')</td><td style="padding:4px">' + esc(s.dispenser_make) + '</td><td style="padding:4px">' + esc(s.certificate_no) + '</td><td style="padding:4px"><b>' + s.expiry_d + '</b></td><td style="padding:4px">' + esc(s.pulser_seal_no || 'Sealed') + '</td></tr>';
    });

    h += '</table>'
      + '<div style="font-weight:700;font-size:12px;margin:8px 0">2. Pre-Shift 5-Liter Stamped Measure Check Register (Recent):</div>'
      + '<table style="width:100%;font-size:11px;border-collapse:collapse;margin-bottom:14px;border:1px solid #ccc">'
      + '<tr style="background:#f1f5f9;border-bottom:1px solid #ccc"><th style="padding:4px;text-align:left">Date</th><th style="padding:4px;text-align:left">Nozzle</th><th style="padding:4px;text-align:right">Delivered (ml)</th><th style="padding:4px;text-align:right">Error (ml)</th><th style="padding:4px;text-align:center">Result</th></tr>';

    calibs.slice(0, 8).forEach(function(c){
      h += '<tr style="border-bottom:1px solid #eee"><td style="padding:4px">' + c.d + ' ' + esc(c.time_str) + '</td><td style="padding:4px">' + esc(c.nozzle_id) + ' ' + esc(c.fuel_product) + '</td><td style="padding:4px;text-align:right">' + c.delivered_volume_ml + ' ml</td><td style="padding:4px;text-align:right">' + (c.error_ml >= 0 ? '+' : '') + c.error_ml + ' ml</td><td style="padding:4px;text-align:center"><b>' + (c.is_pass ? 'PASSED' : 'FAILED') + '</b></td></tr>';
    });

    h += '</table>'
      + '<div style="display:flex;justify-content:space-between;margin-top:30px;font-size:12px">'
      + '<div style="text-align:center"><div style="border-top:1px solid #000;width:120px;margin-bottom:4px"></div>Station Manager Sign</div>'
      + '<div style="text-align:center"><div style="border-top:1px solid #000;width:120px;margin-bottom:4px"></div>Legal Metrology Officer</div>'
      + '</div>'
      + '</div>'
      + '<div class="row noprint" style="margin-top:14px;display:flex;gap:8px">'
      + '<button class="ghost" onclick="close()">Close</button>'
      + '<button style="flex:1" onclick="window.print()">🖨️ Print W&M Logbook</button>'
      + '</div>';

    openM(h);
  }

  // ==========================================
  // 4. ENHANCED FLEET INDENT SLIP & MILEAGE VOUCHER
  // ==========================================
  function viewEnhancedIndentSlipModal(indentId){
    api("GET", "/api/fleet-indents/" + indentId + "/slip")
      .then(function(res){
        var ind = res.indent;
        var prev = res.previous_reading;
        var kmTravelled = res.km_travelled;
        var mileage = res.mileage_km_per_litre;
        var biz = res.station || (S && S.biz ? S.biz : { name: "Petrol Pump Management", addr: "Highway Station", gst: "" });

        var h = '<div class="ops-voucher noprint" style="max-width:480px;font-family:sans-serif">'
          + '<div style="text-align:center;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:12px">'
          + '<div style="font-size:18px;font-weight:800">' + esc(biz.name || 'PETROL PUMP') + '</div>'
          + '<div style="font-size:11px;color:#555">' + esc(biz.addr || '') + (biz.gst ? ' | GSTIN: ' + esc(biz.gst) : '') + '</div>'
          + '<div style="display:inline-block;border:1px solid #000;padding:2px 8px;font-size:11px;font-weight:700;margin-top:4px">COMMERCIAL FLEET FUEL DISPENSE INDENT SLIP</div>'
          + '</div>'
          + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;margin-bottom:10px">'
          + '<div>Slip Token #: <b style="color:#0284c7">' + esc(ind.indent_no) + '</b></div>'
          + '<div>Date: <b>' + ind.issued_d + '</b></div>'
          + '<div>Vehicle Reg: <b style="background:#1e293b;color:#fff;padding:1px 6px;border-radius:3px">' + esc(ind.vehicle_no) + '</b></div>'
          + '<div>Status: <b style="text-transform:uppercase">' + esc(ind.status) + '</b></div>'
          + '<div>Driver: <b>' + esc(ind.driver_name || 'Driver') + '</b></div>'
          + '<div>Driver Mobile: <b>' + esc(ind.driver_mobile || 'N/A') + '</b></div>'
          + '</div>';

        // Odometer & Mileage card
        h += '<div style="border:1px solid #ccc;padding:8px 10px;border-radius:6px;font-size:12px;margin-bottom:12px;background:#f8fafc">';
        h += '<div style="display:flex;justify-content:space-between;margin-bottom:3px">';
        h += '<span>Current Odometer Reading:</span>';
        h += '<b>' + (ind.odometer_km ? ind.odometer_km.toLocaleString("en-IN") + ' km' : 'Not recorded') + '</b>';
        h += '</div>';

        if (prev && prev.odometer_km && kmTravelled > 0) {
          h += '<div style="display:flex;justify-content:space-between;margin-bottom:3px;color:#555">';
          h += '<span>Previous Fill Odometer:</span>';
          h += '<span>' + prev.odometer_km.toLocaleString("en-IN") + ' km (Trip: +' + kmTravelled.toLocaleString("en-IN") + ' km)</span>';
          h += '</div>';
          if (mileage) {
            h += '<div style="display:flex;justify-content:space-between;border-top:1px dashed #ccc;padding-top:3px;font-weight:700;color:#059669">';
            h += '<span>Vehicle Fuel Economy (Mileage):</span>';
            h += '<span>' + mileage + ' km / Litre</span>';
            h += '</div>';
          }
        }
        h += '</div>';

        // Fuel Details Table
        h += '<table style="width:100%;font-size:12px;border-collapse:collapse;margin-bottom:12px">'
          + '<tr style="border-bottom:1px solid #ccc"><th style="text-align:left;padding:4px">Product & Authorization</th><th style="text-align:right;padding:4px">Details</th></tr>'
          + '<tr><td style="padding:4px">Fuel Product</td><td style="text-align:right;font-weight:700">' + esc(ind.fuel_product) + '</td></tr>'
          + '<tr><td style="padding:4px">Authorized Limit</td><td style="text-align:right">' + (ind.req_qty ? ind.req_qty + ' Litres' : inr(ind.req_amount||0)) + '</td></tr>';

        if (ind.status === "dispensed") {
          h += '<tr><td style="padding:4px">Dispensed Fuel Litres</td><td style="text-align:right;font-weight:800;color:#0284c7">' + ind.dispensed_qty + ' L</td></tr>'
            + '<tr><td style="padding:4px">Applicable Rate</td><td style="text-align:right">₹' + ind.dispensed_rate + ' / L</td></tr>'
            + '<tr style="font-weight:800;font-size:15px;border-top:2px solid #000;border-bottom:2px solid #000"><td style="padding:6px 4px">Total Amount Billed</td><td style="text-align:right">' + inr(ind.dispensed_amount||0) + '</td></tr>';
        }

        h += '</table>';

        h += '<div style="display:flex;justify-content:space-between;align-items:center;background:#f1f5f9;padding:6px 10px;border-radius:6px;font-size:11px;margin-bottom:16px">';
        h += '<div>Verification Token: <code style="font-weight:700">' + esc(res.verification_token) + '</code></div>';
        h += '<div>Attendant: ' + esc(ind.worker_name || 'Staff') + '</div>';
        h += '</div>';

        h += '<div style="display:flex;justify-content:space-between;margin-top:24px;font-size:12px">'
          + '<div style="text-align:center"><div style="border-top:1px solid #000;width:120px;margin-bottom:4px"></div>Driver Signature</div>'
          + '<div style="text-align:center"><div style="border-top:1px solid #000;width:120px;margin-bottom:4px"></div>Pump Cashier Stamp</div>'
          + '</div>'
          + '</div>'
          + '<div class="row noprint" style="margin-top:14px;display:flex;gap:8px">'
          + '<button class="ghost" onclick="close()">Close</button>'
          + '<button class="ghost" onclick="shareIndentWhatsApp(' + ind.id + ',\'' + esc(ind.driver_mobile||'') + '\',\'' + esc(ind.indent_no) + '\',\'' + esc(ind.vehicle_no) + '\')">📲 Share WhatsApp</button>'
          + '<button style="flex:1" onclick="window.print()">🖨️ Print Indent Slip</button>'
          + '</div>';

        openM(h);
      })
      .catch(function(e){
        toast(e.error || "Could not load indent slip details.");
      });
  }

  function shareIndentWhatsApp(indentId, mobile, indentNo, vehicleNo){
    var text = "Fuel Indent Slip: " + indentNo + "\nVehicle: " + vehicleNo + "\nIssued by Petrol Pump.\nPlease present this digital token to pump attendant for refueling.";
    var phone = mobile ? mobile.replace(/\D/g, "") : "";
    var url = "https://wa.me/" + (phone.length === 10 ? "91" + phone : phone) + "?text=" + encodeURIComponent(text);
    window.open(url, "_blank");
  }

  // Export to window
  window.renderBowserTab = renderBowserTab;
  window.loadBowserData = loadBowserData;
  window.setBowserSubtab = setBowserSubtab;
  window.openAddBowserModal = openAddBowserModal;
  window.submitAddBowser = submitAddBowser;
  window.openStartBowserTripModal = openStartBowserTripModal;
  window.updateTripBowserInfo = updateTripBowserInfo;
  window.submitStartBowserTrip = submitStartBowserTrip;
  window.openBowserDeliveryModal = openBowserDeliveryModal;
  window.autoFillBowserClient = autoFillBowserClient;
  window.calcBowserDeliveryAmt = calcBowserDeliveryAmt;
  window.submitBowserDelivery = submitBowserDelivery;
  window.openCompleteBowserTripModal = openCompleteBowserTripModal;
  window.submitCompleteBowserTrip = submitCompleteBowserTrip;
  window.openBowserRefillModal = openBowserRefillModal;
  window.submitBowserRefill = submitBowserRefill;
  window.printBowserChallan = printBowserChallan;
  window.printTripChallanSheet = printTripChallanSheet;

  window.renderPnLTab = renderPnLTab;
  window.loadPnLData = loadPnLData;
  window.setPnLRange = setPnLRange;
  window.openDealerCommissionsModal = openDealerCommissionsModal;
  window.submitDealerCommissions = submitDealerCommissions;
  window.openLogDailyOverheadsModal = openLogDailyOverheadsModal;
  window.submitDailyOverheads = submitDailyOverheads;
  window.printPnLReport = printPnLReport;

  window.renderWmVaultTab = renderWmVaultTab;
  window.loadWmVaultData = loadWmVaultData;
  window.setWmSubtab = setWmSubtab;
  window.openLog5LMeasureModal = openLog5LMeasureModal;
  window.calc5LError = calc5LError;
  window.submit5LMeasureCalib = submit5LMeasureCalib;
  window.openUpdateStampingModal = openUpdateStampingModal;
  window.submitUpdateStamping = submitUpdateStamping;
  window.printWMLogbook = printWMLogbook;

  window.viewEnhancedIndentSlipModal = viewEnhancedIndentSlipModal;
  window.shareIndentWhatsApp = shareIndentWhatsApp;

})(window);
