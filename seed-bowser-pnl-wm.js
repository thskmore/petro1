"use strict";

async function seedBowserPnlWm(db) {
  try {
    // 1. Mobile Fuel Bowser & Doorstep Diesel Delivery (DDD) Tables
    db.exec(`
      create table if not exists bowsers(
        id integer primary key,
        name text not null,
        reg_no text not null unique,
        capacity_litres real not null,
        current_fuel_stock real not null,
        flowmeter_make text not null,
        flowmeter_serial text not null,
        current_totalizer_meter real not null,
        fuel_product text not null default 'Diesel (HSD)',
        driver_name text,
        driver_mobile text,
        peso_license_no text,
        peso_expiry_d text,
        status text not null default 'available',
        notes text,
        created_at integer not null
      );

      create table if not exists bowser_refills(
        id integer primary key,
        bowser_id integer not null,
        d text not null,
        time_str text not null,
        tank_id text not null,
        fuel_product text not null,
        dip_before_cm real,
        dip_after_cm real,
        loaded_qty real not null,
        loaded_density real not null,
        temp_c real,
        attendant_id integer,
        notes text,
        created_at integer not null
      );

      create table if not exists bowser_trips(
        id integer primary key,
        trip_no text not null unique,
        bowser_id integer not null,
        d text not null,
        start_time text not null,
        end_time text,
        driver_name text not null,
        driver_mobile text,
        helper_name text,
        starting_meter real not null,
        ending_meter real,
        starting_fuel_qty real not null,
        total_dispensed_qty real not null default 0,
        ending_fuel_qty real,
        remaining_dip_litres real,
        transit_variance_litres real not null default 0,
        destination_summary text,
        status text not null default 'open',
        notes text,
        created_at integer not null,
        completed_at integer
      );

      create table if not exists bowser_deliveries(
        id integer primary key,
        trip_id integer,
        trip_no text not null,
        bowser_id integer not null,
        d text not null,
        delivery_time text,
        challan_no text not null unique,
        cust_id text,
        client_name text not null,
        site_location text not null,
        asset_type text not null,
        start_meter real not null,
        end_meter real not null,
        qty_litres real not null,
        rate real not null,
        amount real not null,
        payment_mode text not null default 'credit',
        credit_sale_id integer,
        recipient_person text,
        recipient_mobile text,
        gps_coordinates text,
        notes text,
        created_at integer not null
      );

      -- 2. Dealer Commission & Automated Daily Profit & Loss
      create table if not exists dealer_commissions(
        id integer primary key,
        fuel_product text not null unique,
        commission_per_litre real not null,
        company text default 'IOCL',
        updated_at integer not null
      );

      create table if not exists daily_pnl_overheads(
        id integer primary key,
        d text not null unique,
        electricity_expense real not null default 0,
        dg_fuel_expense real not null default 0,
        staff_wages real not null default 0,
        evaporation_shrinkage_cost real not null default 0,
        bank_pos_charges real not null default 0,
        maintenance_misc real not null default 0,
        notes text,
        created_at integer not null
      );

      -- 3. Legal Metrology Weights & Measures (W&M) Stamping Vault
      create table if not exists wm_stamping_vault(
        id integer primary key,
        nozzle_id text not null unique,
        dispenser_make text not null,
        fuel_product text not null,
        island_name text not null,
        serial_no text not null,
        last_stamping_d text not null,
        expiry_d text not null,
        certificate_no text not null,
        inspector_name text not null,
        legal_metrology_office text not null,
        lead_seal_k_factor text,
        pulser_seal_no text,
        totalizer_motherboard_seal_no text,
        status text not null default 'valid',
        notes text,
        updated_at integer not null
      );

      create table if not exists wm_measure_calibrations(
        id integer primary key,
        d text not null,
        time_str text not null,
        nozzle_id text not null,
        fuel_product text not null,
        measure_stamped_capacity real not null default 5.0,
        delivered_volume_ml real not null,
        error_ml real not null,
        allowed_tolerance_ml real not null default 25.0,
        is_pass integer not null default 1,
        seal_intact integer not null default 1,
        returned_to_tank_id text not null,
        tested_by integer not null,
        notes text,
        created_at integer not null
      );

      create table if not exists filter_paper_tests(
        id integer primary key,
        d text not null,
        time_str text not null,
        nozzle_id text not null,
        fuel_product text not null,
        filter_paper_grade text not null default 'Whatman 589/1',
        evaporation_seconds integer not null default 90,
        stain_observed integer not null default 0,
        is_pass integer not null default 1,
        sample_bottle_tag text,
        tested_by integer not null,
        notes text,
        created_at integer not null
      );
    `);

    // Seed Dealer Commissions if empty
    const commCount = db.prepare("select count(*) c from dealer_commissions").get()?.c || 0;
    if (commCount === 0) {
      const nowTs = Math.floor(Date.now() / 1000);
      const insertComm = db.prepare("insert into dealer_commissions(fuel_product, commission_per_litre, company, updated_at) values(?,?,?,?)");
      insertComm.run("Diesel (HSD)", 2.58, "IOCL", nowTs);
      insertComm.run("Petrol (MS)", 3.75, "IOCL", nowTs);
      insertComm.run("Power petrol", 4.15, "IOCL", nowTs);
      insertComm.run("AdBlue (DEF)", 12.00, "IOCL", nowTs);
    }

    // Seed Bowser Fleet if empty
    const bowserCount = db.prepare("select count(*) c from bowsers").get()?.c || 0;
    if (bowserCount === 0) {
      const nowTs = Math.floor(Date.now() / 1000);
      const insertB = db.prepare(`
        insert into bowsers(name, reg_no, capacity_litres, current_fuel_stock, flowmeter_make, flowmeter_serial, current_totalizer_meter, fuel_product, driver_name, driver_mobile, peso_license_no, peso_expiry_d, status, notes, created_at)
        values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);

      insertB.run(
        "Bowser Express-01 (Eicher Pro 2049)",
        "MH-12-BW-1001",
        4000,
        2850,
        "TCS Electronic Register (Model 700-20)",
        "TCS-700-8831",
        154820.5,
        "Diesel (HSD)",
        "Santosh Shinde",
        "9822450011",
        "PESO/A/MH/2023/10488",
        "2027-04-30",
        "available",
        "PESO approved mobile dispenser with calibrated nozzle & auto shut-off gun.",
        nowTs - 86400 * 30
      );

      insertB.run(
        "Bowser Agro-02 (Tata Ultra 1014)",
        "MH-12-BW-2002",
        6000,
        4200,
        "Liquid Controls M-7 Flowmeter with Printer",
        "LC-M7-55102",
        289140.0,
        "Diesel (HSD)",
        "Kiran Jadhav",
        "9822450022",
        "PESO/A/MH/2024/22091",
        "2027-11-15",
        "on_trip",
        "Doorstep diesel delivery for large infra projects and heavy earthmovers.",
        nowTs - 86400 * 20
      );
    }

    // Seed sample Bowser Trips & Deliveries if empty
    const tripCount = db.prepare("select count(*) c from bowser_trips").get()?.c || 0;
    if (tripCount === 0) {
      const nowTs = Math.floor(Date.now() / 1000);
      const insertTrip = db.prepare(`
        insert into bowser_trips(trip_no, bowser_id, d, start_time, end_time, driver_name, driver_mobile, helper_name, starting_meter, ending_meter, starting_fuel_qty, total_dispensed_qty, ending_fuel_qty, remaining_dip_litres, transit_variance_litres, destination_summary, status, notes, created_at, completed_at)
        values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);

      // Completed Trip Yesterday
      insertTrip.run(
        "TRIP-2026-001",
        1,
        "2026-10-09",
        "08:30 AM",
        "04:45 PM",
        "Santosh Shinde",
        "9822450011",
        "Mahesh Patil",
        153620.5,
        154820.5,
        3500,
        1200,
        2298,
        2298,
        -2.0,
        "Pune-Solapur Highway Flyover Construction Site & Kirloskar Gensets",
        "completed",
        "All site deliveries signed by authorized project managers. Zero leakages.",
        nowTs - 86400,
        nowTs - 86400 + 28800
      );

      // Active Trip Today
      insertTrip.run(
        "TRIP-2026-002",
        2,
        "2026-10-10",
        "09:15 AM",
        null,
        "Kiran Jadhav",
        "9822450022",
        "Rahul More",
        289140.0,
        null,
        5000,
        800,
        4200,
        null,
        0,
        "Hinjawadi IT Park Data Center & JCB Fleet Site",
        "open",
        "Trip in progress. Dispensing 800L done at Site 1.",
        nowTs - 14400,
        null
      );

      // Seed Deliveries
      const insertDeliv = db.prepare(`
        insert into bowser_deliveries(trip_id, trip_no, bowser_id, d, delivery_time, challan_no, cust_id, client_name, site_location, asset_type, start_meter, end_meter, qty_litres, rate, amount, payment_mode, recipient_person, recipient_mobile, gps_coordinates, notes, created_at)
        values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);

      insertDeliv.run(
        1, "TRIP-2026-001", 1, "2026-10-09", "10:15 AM", "DDD-2026-0101", "1",
        "Shree Transport", "Hadapsar Depot Yard", "250 kVA Cummins Backup Generator",
        153620.5, 154120.5, 500, 91.50, 45750, "credit",
        "Ramesh Kadam (Site Eng)", "9822001122", "18.5089° N, 73.9260° E",
        "Direct fueling into DG tank. Kolor-Kut water paste tested negative.",
        nowTs - 86400 + 7200
      );

      insertDeliv.run(
        1, "TRIP-2026-001", 1, "2026-10-09", "02:30 PM", "DDD-2026-0102", "2",
        "Patil Agro Services", "Baramati Canal Bridge Site", "2x JCB 3DX Excavators & Batching Plant",
        154120.5, 154820.5, 700, 91.50, 64050, "credit",
        "Sachin Patil (Supervisor)", "9822003344", "18.1517° N, 74.5772° E",
        "Excavator fuel tanks filled to brim. Odometer readings recorded on slip.",
        nowTs - 86400 + 21600
      );

      insertDeliv.run(
        2, "TRIP-2026-002", 2, "2026-10-10", "11:30 AM", "DDD-2026-0103", "3",
        "City Cab Fleet", "Hinjawadi Phase 3 Hub", "500 kVA Data Center Standby DG",
        289140.0, 289940.0, 800, 91.50, 73200, "credit",
        "Amit Verma (Facility Head)", "9822005566", "18.5913° N, 73.7389° E",
        "High-density fuel verified at site before pumping. Flowmeter ticket generated.",
        nowTs - 7200
      );

      // Seed Bowser Refill
      const insertRefill = db.prepare(`
        insert into bowser_refills(bowser_id, d, time_str, tank_id, fuel_product, dip_before_cm, dip_after_cm, loaded_qty, loaded_density, temp_c, attendant_id, notes, created_at)
        values(?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      insertRefill.run(
        1, "2026-10-09", "07:30 AM", "T2", "Diesel (HSD)", 182.0, 168.0, 3500, 831.2, 27.5, 2,
        "Loaded directly from underground Tank 2 HSD via loading arm.", nowTs - 86400
      );
      insertRefill.run(
        2, "2026-10-10", "08:00 AM", "T2", "Diesel (HSD)", 195.0, 175.0, 5000, 832.0, 26.8, 2,
        "Bowser Agro-02 tank topped up for Hinjawadi route.", nowTs - 18000
      );
    }

    // Seed Daily Overheads for P&L if empty
    const pnlCount = db.prepare("select count(*) c from daily_pnl_overheads").get()?.c || 0;
    if (pnlCount === 0) {
      const nowTs = Math.floor(Date.now() / 1000);
      const insertPnl = db.prepare(`
        insert into daily_pnl_overheads(d, electricity_expense, dg_fuel_expense, staff_wages, evaporation_shrinkage_cost, bank_pos_charges, maintenance_misc, notes, created_at)
        values(?,?,?,?,?,?,?,?,?)
      `);
      insertPnl.run("2026-10-10", 680, 732, 2400, 380, 290, 150, "Today estimated operational overheads", nowTs);
      insertPnl.run("2026-10-09", 720, 1098, 2400, 420, 340, 200, "Power cut 2.5 hrs, DG fuel higher", nowTs - 86400);
      insertPnl.run("2026-10-08", 650, 488, 2400, 350, 310, 100, "Normal running day", nowTs - 86400 * 2);
      insertPnl.run("2026-10-07", 690, 610, 2400, 390, 280, 180, "Mid-week operations", nowTs - 86400 * 3);
      insertPnl.run("2026-10-06", 660, 550, 2400, 360, 320, 120, "Regular operations", nowTs - 86400 * 4);
    }

    // Seed Legal Metrology W&M Stamping Vault if empty
    const wmCount = db.prepare("select count(*) c from wm_stamping_vault").get()?.c || 0;
    if (wmCount === 0) {
      const nowTs = Math.floor(Date.now() / 1000);
      const insertWm = db.prepare(`
        insert into wm_stamping_vault(nozzle_id, dispenser_make, fuel_product, island_name, serial_no, last_stamping_d, expiry_d, certificate_no, inspector_name, legal_metrology_office, lead_seal_k_factor, pulser_seal_no, totalizer_motherboard_seal_no, status, notes, updated_at)
        values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);

      insertWm.run(
        "N1", "Gilbarco Veeder-Root Horizon", "Petrol (MS)", "Island 1 (North)", "GVR-HZN-44912-A",
        "2025-11-14", "2026-11-13", "LM/MH/PUN/2025/89201", "V. R. Kulkarni (Insp. Legal Metrology)",
        "Legal Metrology Division Pune Central", "K-58204", "PLS-MH-4401", "MB-GVR-99120", "valid",
        "Annual reverification completed. Lead seal intact on pulser gear.", nowTs
      );

      insertWm.run(
        "N2", "Gilbarco Veeder-Root Horizon", "Petrol (MS)", "Island 1 (North)", "GVR-HZN-44912-B",
        "2025-11-14", "2026-11-13", "LM/MH/PUN/2025/89202", "V. R. Kulkarni (Insp. Legal Metrology)",
        "Legal Metrology Division Pune Central", "K-58205", "PLS-MH-4402", "MB-GVR-99121", "valid",
        "Annual verification certificate valid till Nov 2026.", nowTs
      );

      insertWm.run(
        "N3", "Tokheim Quantium 510", "Diesel (HSD)", "Island 2 (Central)", "TKH-Q510-77140-A",
        "2025-10-25", "2026-10-24", "LM/MH/PUN/2025/78219", "V. R. Kulkarni (Insp. Legal Metrology)",
        "Legal Metrology Division Pune Central", "K-77102", "PLS-MH-3389", "MB-TKH-66014", "warning",
        "Stamping expiry in 14 days! Schedule inspector visit immediately.", nowTs
      );

      insertWm.run(
        "N4", "Tokheim Quantium 510", "Diesel (HSD)", "Island 2 (Central)", "TKH-Q510-77140-B",
        "2025-10-25", "2026-10-24", "LM/MH/PUN/2025/78220", "V. R. Kulkarni (Insp. Legal Metrology)",
        "Legal Metrology Division Pune Central", "K-77103", "PLS-MH-3390", "MB-TKH-66015", "warning",
        "Stamping expiry in 14 days! Mandatory calibration measure required.", nowTs
      );

      insertWm.run(
        "N5", "Wayne Helix 5000", "Power petrol", "Island 3 (South)", "WYN-HLX-19208-A",
        "2026-02-10", "2027-02-09", "LM/MH/PUN/2026/12093", "S. S. Deshmukh (Insp. Legal Metrology)",
        "Legal Metrology Division Pune Central", "K-91040", "PLS-MH-5512", "MB-WYN-33019", "valid",
        "Speed/Power premium nozzle. Sealed with high-security tamper tag.", nowTs
      );

      insertWm.run(
        "N6", "Wayne Helix 5000", "Diesel (HSD)", "Island 3 (South)", "WYN-HLX-19208-B",
        "2026-02-10", "2027-02-09", "LM/MH/PUN/2026/12094", "S. S. Deshmukh (Insp. Legal Metrology)",
        "Legal Metrology Division Pune Central", "K-91041", "PLS-MH-5513", "MB-WYN-33020", "valid",
        "High delivery flow nozzle for trucks and buses. Verified.", nowTs
      );
    }

    // Seed 5L Conical Measure morning calibrations if empty
    const calibCount = db.prepare("select count(*) c from wm_measure_calibrations").get()?.c || 0;
    if (calibCount === 0) {
      const nowTs = Math.floor(Date.now() / 1000);
      const insert5L = db.prepare(`
        insert into wm_measure_calibrations(d, time_str, nozzle_id, fuel_product, measure_stamped_capacity, delivered_volume_ml, error_ml, allowed_tolerance_ml, is_pass, seal_intact, returned_to_tank_id, tested_by, notes, created_at)
        values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);

      insert5L.run("2026-10-10", "06:15 AM", "N1", "Petrol (MS)", 5.0, 5005, 5, 25.0, 1, 1, "T1", 2, "Morning pre-shift calibration passed. Fuel poured back into underground Tank 1.", nowTs - 14400);
      insert5L.run("2026-10-10", "06:20 AM", "N2", "Petrol (MS)", 5.0, 4995, -5, 25.0, 1, 1, "T1", 2, "Tested with 5L government stamped brass conical measure. Tolerance well within ±25 ml.", nowTs - 14100);
      insert5L.run("2026-10-10", "06:25 AM", "N3", "Diesel (HSD)", 5.0, 5000, 0, 25.0, 1, 1, "T2", 2, "Zero error delivery. Totalizer pulser seal verified intact.", nowTs - 13800);
      insert5L.run("2026-10-10", "06:30 AM", "N4", "Diesel (HSD)", 5.0, 5010, 10, 25.0, 1, 1, "T2", 2, "Passed. Fuel returned to storage tank with entry in stock register.", nowTs - 13500);
      insert5L.run("2026-10-10", "06:35 AM", "N5", "Power petrol", 5.0, 4990, -10, 25.0, 1, 1, "T1", 2, "Passed. Nozzle auto cut-off checked and functioning smoothly.", nowTs - 13200);
      insert5L.run("2026-10-10", "06:40 AM", "N6", "Diesel (HSD)", 5.0, 5005, 5, 25.0, 1, 1, "T2", 2, "Passed. Stamped conical measure wiped clean and safely stored in testing vault.", nowTs - 12900);
    }

    // Seed Whatman Filter Paper Quality Checks if empty
    const fpCount = db.prepare("select count(*) c from filter_paper_tests").get()?.c || 0;
    if (fpCount === 0) {
      const nowTs = Math.floor(Date.now() / 1000);
      const insertFp = db.prepare(`
        insert into filter_paper_tests(d, time_str, nozzle_id, fuel_product, filter_paper_grade, evaporation_seconds, stain_observed, is_pass, sample_bottle_tag, tested_by, notes, created_at)
        values(?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      insertFp.run("2026-10-10", "06:18 AM", "N1", "Petrol (MS)", "Whatman 589/1", 75, 0, 1, "SMP-2026-N1-01", 2, "2 drops placed on Whatman 589/1 paper. Evaporated within 75s without leaving pink or oily stain. Passed.", nowTs - 14300);
      insertFp.run("2026-10-10", "06:22 AM", "N2", "Petrol (MS)", "Whatman 589/1", 80, 0, 1, "SMP-2026-N2-01", 2, "Complete evaporation without stain. No kerosene / solvent adulteration detected.", nowTs - 14000);
      insertFp.run("2026-10-10", "06:36 AM", "N5", "Power petrol", "Whatman 589/1", 70, 0, 1, "SMP-2026-N5-01", 2, "Premium Petrol sample evaporated clean in 70s. Filter paper clear and unblemished.", nowTs - 13100);
    }

    console.log("Bowser, P&L, and Weights & Measures tables and seeds initialized successfully.");
  } catch (err) {
    console.error("Error in seedBowserPnlWm:", err);
  }
}

module.exports = {
  seedBowserPnlWm
};
