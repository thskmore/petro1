"use strict";

async function seedExtraPetrolOperations(db) {
  try {
    // 1. Shift Cash Handover & Cash-Safe Vault Reconciliation
    db.exec(`
      create table if not exists vault_drops(
        id integer primary key,
        d text not null,
        shift text not null,
        worker_id integer not null,
        drop_type text not null default 'attendant_shift_drop',
        amount real not null,
        c500 integer not null default 0,
        c200 integer not null default 0,
        c100 integer not null default 0,
        c50 integer not null default 0,
        c20 integer not null default 0,
        c10 integer not null default 0,
        c5 integer not null default 0,
        coins integer not null default 0,
        digital_upi real not null default 0,
        digital_card real not null default 0,
        fleet_credit real not null default 0,
        expenses_paid real not null default 0,
        expected_cash real not null default 0,
        short_excess real not null default 0,
        received_by integer,
        status text not null default 'verified',
        notes text,
        created_at integer not null
      );

      create table if not exists tank_water_dips(
        id integer primary key,
        d text not null,
        time_str text not null default '06:00 AM',
        tank_id text not null,
        fuel_type text not null,
        water_dip_mm real not null default 0,
        fuel_dip_cm real,
        paste_used text not null default 'Kolor-Kut Water Finding Paste',
        paste_color_result text not null default 'No Water (Remains Gold-Brown)',
        water_drained_litres real not null default 0,
        is_alert integer not null default 0,
        checked_by integer not null,
        notes text,
        created_at integer not null
      );

      create table if not exists statutory_licenses(
        id integer primary key,
        license_type text not null,
        category text not null,
        license_no text not null,
        authority text not null,
        issued_to text not null,
        issue_date text not null,
        expiry_date text not null,
        renewal_reminder_days integer not null default 30,
        status text not null default 'active',
        document_ref text,
        fee_amount real not null default 0,
        notes text,
        created_at integer not null
      );

      create table if not exists equipment_tickets(
        id integer primary key,
        ticket_no text not null unique,
        equipment_name text not null,
        equipment_type text not null,
        island_bay text not null,
        issue_description text not null,
        priority text not null default 'Urgent',
        vendor_name text not null,
        vendor_contact text,
        reported_by integer not null,
        reported_at integer not null,
        assigned_to text,
        status text not null default 'open',
        resolved_at integer,
        downtime_hours real not null default 0,
        repair_cost real not null default 0,
        spares_replaced text,
        notes text,
        created_at integer not null
      );

      create table if not exists driver_loyalty_members(
        id integer primary key,
        member_code text not null unique,
        name text not null,
        mobile text not null,
        vehicle_no text not null,
        vehicle_type text not null,
        tier text not null default 'Silver',
        points_balance real not null default 0,
        total_litres_fuelled real not null default 0,
        khata_balance real not null default 0,
        active integer not null default 1,
        created_at integer not null
      );

      create table if not exists driver_loyalty_transactions(
        id integer primary key,
        driver_id integer not null,
        d text not null,
        txn_type text not null,
        fuel_type text,
        litres real not null default 0,
        amount real not null default 0,
        points_earned real not null default 0,
        points_redeemed real not null default 0,
        notes text,
        created_at integer not null
      );

      create table if not exists generator_power_logs(
        id integer primary key,
        d text not null,
        genset_start_hours real not null,
        genset_end_hours real not null,
        run_hours real not null,
        diesel_consumed_litres real not null,
        fuel_burn_rate_lph real not null,
        power_cut_mins real not null,
        outage_reason text not null,
        battery_voltage real not null default 12.6,
        oil_level_ok integer not null default 1,
        logged_by integer not null,
        notes text,
        created_at integer not null
      );

      create table if not exists amenities_inspections(
        id integer primary key,
        d text not null,
        shift text not null default 'Morning',
        inspector_id integer not null,
        air_nitrogen_working integer not null default 1,
        air_gauge_calibrated integer not null default 1,
        drinking_water_ok integer not null default 1,
        water_dispenser_clean integer not null default 1,
        gents_toilet_clean integer not null default 1,
        ladies_toilet_clean integer not null default 1,
        soap_water_running integer not null default 1,
        windshield_wash_bucket_ok integer not null default 1,
        fire_extinguishers_green integer not null default 1,
        sand_buckets_dry_full integer not null default 1,
        first_aid_stocked integer not null default 1,
        complaint_book_open integer not null default 1,
        canopy_lighting_full integer not null default 1,
        total_score_pct real not null default 100,
        audit_grade text not null default 'A - Outstanding',
        corrective_actions text,
        created_at integer not null
      );
    `);

    // Seed Vault Drops if empty
    const vaultCount = db.prepare("select count(*) c from vault_drops").get()?.c || 0;
    if (vaultCount === 0) {
      console.log("Seeding cash vault drops...");
      const insertDrop = db.prepare(`
        insert into vault_drops(
          d, shift, worker_id, drop_type, amount,
          c500, c200, c100, c50, c20, c10, c5, coins,
          digital_upi, digital_card, fleet_credit, expenses_paid,
          expected_cash, short_excess, received_by, status, notes, created_at
        ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const drops = [
        {
          d: "2026-10-10", shift: "Morning", worker_id: 3, drop_type: "attendant_shift_drop",
          amount: 54300, c500: 84, c200: 42, c100: 35, c50: 6, c20: 5, c10: 0, c5: 0, coins: 0,
          digital_upi: 24800, digital_card: 16200, fleet_credit: 12500, expenses_paid: 250,
          expected_cash: 54300, short_excess: 0, received_by: 2, status: "verified",
          notes: "Morning shift handover counted at cash-safe desk. All bundles checked with note detector.",
          ts: Math.floor(new Date("2026-10-10T14:15:00Z").getTime() / 1000)
        },
        {
          d: "2026-10-09", shift: "Evening", worker_id: 4, drop_type: "attendant_shift_drop",
          amount: 68500, c500: 108, c200: 54, c100: 32, c50: 9, c20: 3, c10: 9, c5: 0, coins: 0,
          digital_upi: 31200, digital_card: 18900, fleet_credit: 15400, expenses_paid: 400,
          expected_cash: 68550, short_excess: -50, received_by: 2, status: "verified",
          notes: "Minor ₹50 short difference debited to attendant ledger note. Rest bundles intact.",
          ts: Math.floor(new Date("2026-10-09T22:20:00Z").getTime() / 1000)
        },
        {
          d: "2026-10-09", shift: "Morning", worker_id: 3, drop_type: "bank_deposit",
          amount: 110000, c500: 200, c200: 50, c100: 0, c50: 0, c20: 0, c10: 0, c5: 0, coins: 0,
          digital_upi: 0, digital_card: 0, fleet_credit: 0, expenses_paid: 0,
          expected_cash: 110000, short_excess: 0, received_by: 1, status: "verified",
          notes: "SBI Current Account cash deposit challan #SBI-2026-904. Cash taken from vault safe.",
          ts: Math.floor(new Date("2026-10-09T16:00:00Z").getTime() / 1000)
        },
        {
          d: "2026-10-08", shift: "Evening", worker_id: 4, drop_type: "attendant_shift_drop",
          amount: 72400, c500: 116, c200: 56, c100: 28, c50: 8, c20: 0, c10: 0, c5: 0, coins: 0,
          digital_upi: 28400, digital_card: 14100, fleet_credit: 18200, expenses_paid: 180,
          expected_cash: 72400, short_excess: 0, received_by: 2, status: "verified",
          notes: "Perfect cash match against dispenser sales register.",
          ts: Math.floor(new Date("2026-10-08T22:10:00Z").getTime() / 1000)
        }
      ];

      db.transaction(() => {
        for (const drop of drops) {
          insertDrop.run(
            drop.d, drop.shift, drop.worker_id, drop.drop_type, drop.amount,
            drop.c500, drop.c200, drop.c100, drop.c50, drop.c20, drop.c10, drop.c5, drop.coins,
            drop.digital_upi, drop.digital_card, drop.fleet_credit, drop.expenses_paid,
            drop.expected_cash, drop.short_excess, drop.received_by, drop.status, drop.notes, drop.ts
          );
        }
      })();
    }

    // Seed Tank Water Dip Logs if empty
    const waterCount = db.prepare("select count(*) c from tank_water_dips").get()?.c || 0;
    if (waterCount === 0) {
      console.log("Seeding tank water dip logs...");
      const insertWater = db.prepare(`
        insert into tank_water_dips(
          d, time_str, tank_id, fuel_type, water_dip_mm, fuel_dip_cm,
          paste_used, paste_color_result, water_drained_litres, is_alert, checked_by, notes, created_at
        ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const waterLogs = [
        {
          d: "2026-10-10", time_str: "06:15 AM", tank_id: "1791451414419", fuel_type: "Petrol (MS)",
          water_dip_mm: 0, fuel_dip_cm: 142.5, paste_used: "Kolor-Kut Water Finding Paste",
          paste_color_result: "No Water (Remains Gold-Brown)", water_drained_litres: 0, is_alert: 0,
          checked_by: 3, notes: "Brass dip rod dipped with Kolor-Kut paste. Zero discoloration at bottom datum plate.",
          ts: Math.floor(new Date("2026-10-10T06:15:00Z").getTime() / 1000)
        },
        {
          d: "2026-10-10", time_str: "06:20 AM", tank_id: "1791451422410", fuel_type: "Diesel (HSD)",
          water_dip_mm: 4, fuel_dip_cm: 188.0, paste_used: "Kolor-Kut Water Finding Paste",
          paste_color_result: "Trace (4 mm Pink Hue)", water_drained_litres: 0, is_alert: 0,
          checked_by: 3, notes: "Trace moisture 4 mm well below safe 25 mm threshold. Suction pipe clearance is 150 mm.",
          ts: Math.floor(new Date("2026-10-10T06:20:00Z").getTime() / 1000)
        },
        {
          d: "2026-10-10", time_str: "06:25 AM", tank_id: "1791451432098", fuel_type: "Power petrol",
          water_dip_mm: 0, fuel_dip_cm: 98.0, paste_used: "Kolor-Kut Water Finding Paste",
          paste_color_result: "No Water (Remains Gold-Brown)", water_drained_litres: 0, is_alert: 0,
          checked_by: 3, notes: "Clean bottom. Manhole gasket sealed tight after recent rains.",
          ts: Math.floor(new Date("2026-10-10T06:25:00Z").getTime() / 1000)
        },
        {
          d: "2026-10-09", time_str: "06:10 AM", tank_id: "1791451422410", fuel_type: "Diesel (HSD)",
          water_dip_mm: 6, fuel_dip_cm: 182.5, paste_used: "Kolor-Kut Water Finding Paste",
          paste_color_result: "Trace (6 mm Pink Hue)", water_drained_litres: 0, is_alert: 0,
          checked_by: 4, notes: "Routine daily test. Safe level.",
          ts: Math.floor(new Date("2026-10-09T06:10:00Z").getTime() / 1000)
        },
        {
          d: "2026-10-08", time_str: "06:15 AM", tank_id: "1791451414419", fuel_type: "Petrol (MS)",
          water_dip_mm: 0, fuel_dip_cm: 151.0, paste_used: "Kolor-Kut Water Finding Paste",
          paste_color_result: "No Water (Remains Gold-Brown)", water_drained_litres: 0, is_alert: 0,
          checked_by: 3, notes: "Zero water bottom detected.",
          ts: Math.floor(new Date("2026-10-08T06:15:00Z").getTime() / 1000)
        }
      ];

      db.transaction(() => {
        for (const w of waterLogs) {
          insertWater.run(
            w.d, w.time_str, w.tank_id, w.fuel_type, w.water_dip_mm, w.fuel_dip_cm,
            w.paste_used, w.paste_color_result, w.water_drained_litres, w.is_alert,
            w.checked_by, w.notes, w.ts
          );
        }
      })();
    }

    // Seed Statutory & PESO Compliance Licenses if empty
    const licCount = db.prepare("select count(*) c from statutory_licenses").get()?.c || 0;
    if (licCount === 0) {
      console.log("Seeding statutory licenses...");
      const insertLic = db.prepare(`
        insert into statutory_licenses(
          license_type, category, license_no, authority, issued_to,
          issue_date, expiry_date, renewal_reminder_days, status, document_ref, fee_amount, notes, created_at
        ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const nowTs = Math.floor(Date.now() / 1000);
      const licenses = [
        {
          license_type: "PESO Storage & Dispensing License (Form XIV)",
          category: "PESO Explosives",
          license_no: "P/WC/MH/14/4819(P88421)",
          authority: "Petroleum & Explosives Safety Organisation (Nagpur Circle)",
          issued_to: "Shree Shiv Petroleum Retail Outlet",
          issue_date: "2024-01-01",
          expiry_date: "2028-12-31",
          renewal_reminder_days: 60,
          status: "active",
          document_ref: "PESO-FORM-XIV-2024.pdf",
          fee_amount: 15000,
          notes: "Approved capacity: 45 KL MS Petrol, 70 KL HSD Diesel. Valid across all 3 underground tanks."
        },
        {
          license_type: "Legal Metrology Dispenser Stamping & Verification",
          category: "Weights & Measures",
          license_no: "MH/LM/SOL/DISP/2026/1042",
          authority: "Legal Metrology Dept, Govt of Maharashtra",
          issued_to: "Shree Shiv Petroleum (8 Dispensing Units)",
          issue_date: "2026-04-10",
          expiry_date: "2027-04-09",
          renewal_reminder_days: 30,
          status: "active",
          document_ref: "W&M-STAMP-ANNUAL-2026.pdf",
          fee_amount: 9600,
          notes: "Annual recalibration & copper lead wire seals verified on all Gilbarco and Tokheim MPD pulsers."
        },
        {
          license_type: "Fire Department No Objection Certificate (NOC)",
          category: "Fire Safety",
          license_no: "CFO/SOL/FIRE-NOC/2026/304",
          authority: "Chief Fire Officer, Municipal Corporation",
          issued_to: "Shree Shiv Petroleum Highway Outlet",
          issue_date: "2026-03-01",
          expiry_date: "2027-02-28",
          renewal_reminder_days: 30,
          status: "active",
          document_ref: "FIRE-NOC-2026-27.pdf",
          fee_amount: 4500,
          notes: "Annual inspection passed: 12x 9kg DCP extinguishers, 4x 50kg wheeled DCP carts, 6 sand buckets dry."
        },
        {
          license_type: "Underground Tank Hydro-Testing & Calibration Chart",
          category: "Tank Integrity",
          license_no: "IOCL/CALIB-HYDRO/T1-T2-T3/2023",
          authority: "Chief Controller of Explosives Approved Testing Agency",
          issued_to: "Tanks T1, T2 & T3",
          issue_date: "2023-08-15",
          expiry_date: "2028-08-14",
          renewal_reminder_days: 90,
          status: "active",
          document_ref: "TANK-HYDROTEST-2023-28.pdf",
          fee_amount: 32000,
          notes: "Mandatory 5-year hydrostatic pressure testing certificate with dip rod datum strapping charts."
        },
        {
          license_type: "State Pollution Control Board Consent (CTO)",
          category: "Environmental",
          license_no: "MPCB/RO-PUN/CONSENT/2025/110",
          authority: "Maharashtra Pollution Control Board (MPCB)",
          issued_to: "Shree Shiv Petroleum",
          issue_date: "2025-06-01",
          expiry_date: "2027-05-31",
          renewal_reminder_days: 45,
          status: "active",
          document_ref: "MPCB-CONSENT-2025-27.pdf",
          fee_amount: 7500,
          notes: "Consent to Operate under Air & Water Acts. Oil-water separator (OWS) basin functioning."
        },
        {
          license_type: "Public Liability & Forecourt Risk Insurance",
          category: "Insurance",
          license_no: "UIIC/POL/PETRO/2026/889140",
          authority: "United India Insurance Co. Ltd.",
          issued_to: "Retail Outlet Assets & Third Party Forecourt",
          issue_date: "2026-05-15",
          expiry_date: "2026-11-14", // Expiring soon to demonstrate UI alert!
          renewal_reminder_days: 45,
          status: "expiring_soon",
          document_ref: "UIIC-INSURANCE-2026.pdf",
          fee_amount: 28400,
          notes: "Includes stock-in-tank cover (₹80 Lakhs) and forecourt third-party liability (₹1 Crore). Renewal due in 35 days!"
        },
        {
          license_type: "Electrical Earthing & Flameproof Inspection Report",
          category: "Electrical Safety",
          license_no: "ELECT-INSP/MH/2026/099",
          authority: "Govt Certified Electrical Inspector (Class-1)",
          issued_to: "Canopy & Tank Farm Earthing Pit Resistance",
          issue_date: "2026-02-10",
          expiry_date: "2027-02-09",
          renewal_reminder_days: 30,
          status: "active",
          document_ref: "EARTH-TEST-2026.pdf",
          fee_amount: 3500,
          notes: "Earthing pit resistance measured at 0.8 Ohms (standard is below 2.0 Ohms). Flameproof glanding intact."
        }
      ];

      db.transaction(() => {
        for (const lic of licenses) {
          insertLic.run(
            lic.license_type, lic.category, lic.license_no, lic.authority, lic.issued_to,
            lic.issue_date, lic.expiry_date, lic.renewal_reminder_days, lic.status,
            lic.document_ref, lic.fee_amount, lic.notes, nowTs
          );
        }
      })();
    }

    // Seed Forecourt Equipment Breakdown Tickets if empty
    const tktCount = db.prepare("select count(*) c from equipment_tickets").get()?.c || 0;
    if (tktCount === 0) {
      console.log("Seeding equipment maintenance tickets...");
      const insertTicket = db.prepare(`
        insert into equipment_tickets(
          ticket_no, equipment_name, equipment_type, island_bay, issue_description,
          priority, vendor_name, vendor_contact, reported_by, reported_at,
          assigned_to, status, resolved_at, downtime_hours, repair_cost, spares_replaced, notes, created_at
        ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const nowTs = Math.floor(Date.now() / 1000);
      const tickets = [
        {
          ticket_no: "TKT-2026-081",
          equipment_name: "MPD Dispenser DU-1 (Nozzle N2 HSD)",
          equipment_type: "Nozzle / Swivel / Breakaway",
          island_bay: "Bay 1 (Island North)",
          issue_description: "OPW automatic nozzle tip shut-off dripping 2-3 drops after trigger release. Swivel slightly tight.",
          priority: "Urgent",
          vendor_name: "Gilbarco Veeder-Root India",
          vendor_contact: "+91 98220 11984 (Service Engg. Nitin)",
          reported_by: 3,
          reported_at: nowTs - 7200,
          assigned_to: "Nitin Patil (Field Tech)",
          status: "in_progress",
          resolved_at: null,
          downtime_hours: 2.0,
          repair_cost: 0,
          spares_replaced: "OPW nozzle seal kit on order",
          notes: "Nozzle temporarily tagged 'Under Maintenance' to avoid customer complaints."
        },
        {
          ticket_no: "TKT-2026-079",
          equipment_name: "Automatic Digital Tyre Inflator Air Tower",
          equipment_type: "Air Compressor / Tower",
          island_bay: "Free Air Service Bay (Exit Point)",
          issue_description: "Digital pressure sensor beeper intermittent; hose chuck clip loose causing air leakage while filling truck tyres.",
          priority: "Medium",
          vendor_name: "ATS Elgi Technical Care",
          vendor_contact: "+91 94220 88201",
          reported_by: 2,
          reported_at: nowTs - 86400,
          assigned_to: "Rajesh Shinde",
          status: "resolved",
          resolved_at: nowTs - 14400,
          downtime_hours: 4.5,
          repair_cost: 1250,
          spares_replaced: "Heavy brass chuck clip + 10m braided polyurethane air hose",
          notes: "Calibrated with master test pressure gauge (32 PSI verified). Working smoothly."
        },
        {
          ticket_no: "TKT-2026-075",
          equipment_name: "Red Jacket Submersible Turbine Pump (STP-1 MS)",
          equipment_type: "STP Pump",
          island_bay: "Tank Farm MS Chamber",
          issue_description: "STP control box capacitor tripped during peak evening hours causing slow delivery across N6 and N7.",
          priority: "Critical",
          vendor_name: "Gilbarco Veeder-Root India",
          vendor_contact: "+91 98220 11984",
          reported_by: 2,
          reported_at: nowTs - 259200,
          assigned_to: "Praveen Deshmukh",
          status: "resolved",
          resolved_at: nowTs - 245000,
          downtime_hours: 3.2,
          repair_cost: 4800,
          spares_replaced: "Single-phase starter run capacitor (50 mfd) + terminal block",
          notes: "Tested delivery flow rate restored to 42 Litres/min. Full pressure verified."
        },
        {
          ticket_no: "TKT-2026-084",
          equipment_name: "125 kVA Kirloskar Silent Diesel Genset",
          equipment_type: "Genset",
          island_bay: "Power Room Enclosure",
          issue_description: "Routine 250-hour B-Check maintenance due: Engine lube oil, diesel filter and air filter replacement.",
          priority: "Routine",
          vendor_name: "Kirloskar Oil Engines Ltd (KOEL Care)",
          vendor_contact: "+91 97650 33412",
          reported_by: 2,
          reported_at: nowTs - 3600,
          assigned_to: "KOEL Care Service Team",
          status: "open",
          resolved_at: null,
          downtime_hours: 0,
          repair_cost: 0,
          spares_replaced: "Service kit booked",
          notes: "Scheduled for tomorrow 11:00 AM."
        }
      ];

      db.transaction(() => {
        for (const t of tickets) {
          insertTicket.run(
            t.ticket_no, t.equipment_name, t.equipment_type, t.island_bay, t.issue_description,
            t.priority, t.vendor_name, t.vendor_contact, t.reported_by, t.reported_at,
            t.assigned_to, t.status, t.resolved_at, t.downtime_hours, t.repair_cost,
            t.spares_replaced, t.notes, nowTs
          );
        }
      })();
    }

    // Seed Driver Loyalty Members & Khata if empty
    const loyCount = db.prepare("select count(*) c from driver_loyalty_members").get()?.c || 0;
    if (loyCount === 0) {
      console.log("Seeding driver loyalty members...");
      const insertLoyMember = db.prepare(`
        insert into driver_loyalty_members(
          member_code, name, mobile, vehicle_no, vehicle_type, tier,
          points_balance, total_litres_fuelled, khata_balance, active, created_at
        ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertLoyTxn = db.prepare(`
        insert into driver_loyalty_transactions(
          driver_id, d, txn_type, fuel_type, litres, amount, points_earned, points_redeemed, notes, created_at
        ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const nowTs = Math.floor(Date.now() / 1000);
      const members = [
        {
          code: "LOY-4011", name: "Suresh Babar (Auto Union)", mobile: "9822451001",
          veh: "MH-12-PA-8821", type: "Auto Rickshaw", tier: "Gold",
          points: 145, litres: 1450, khata: 0, ts: nowTs - 30 * 86400
        },
        {
          code: "LOY-4012", name: "Prakash Jadhav (Kisan Tractor)", mobile: "9850123490",
          veh: "MH-12-TR-4509", type: "Tractor", tier: "Platinum",
          points: 380, litres: 3800, khata: 4500, ts: nowTs - 45 * 86400
        },
        {
          code: "LOY-4013", name: "Raju Gaikwad (City Taxi)", mobile: "9763299102",
          veh: "MH-12-RN-1204", type: "Taxi / Cab", tier: "Gold",
          points: 210, litres: 2100, khata: 0, ts: nowTs - 20 * 86400
        },
        {
          code: "LOY-4014", name: "Vinod Shinde (School Van)", mobile: "9422511400",
          veh: "MH-12-SC-7711", type: "School Van", tier: "Silver",
          points: 95, litres: 950, khata: 1200, ts: nowTs - 15 * 86400
        },
        {
          code: "LOY-4015", name: "Balu Thorat (Pickup Tempo)", mobile: "9881023811",
          veh: "MH-12-VT-3301", type: "Pickup / Tempo", tier: "Gold",
          points: 190, litres: 1900, khata: 0, ts: nowTs - 10 * 86400
        }
      ];

      db.transaction(() => {
        members.forEach((m, idx) => {
          insertLoyMember.run(m.code, m.name, m.mobile, m.veh, m.type, m.tier, m.points, m.litres, m.khata, 1, m.ts);
          const memberId = idx + 1;
          // Seed transactions for member
          insertLoyTxn.run(memberId, "2026-10-10", "fuel_visit", "Diesel (HSD)", 35.0, 3115.0, 3.5, 0, "Full tank fuelling at Bay 2", nowTs - 3600);
          insertLoyTxn.run(memberId, "2026-10-08", "fuel_visit", "Diesel (HSD)", 40.0, 3560.0, 4.0, 0, "Points credited automatically", nowTs - 172800);
          if (m.khata > 0) {
            insertLoyTxn.run(memberId, "2026-10-07", "khata_credit", "Diesel (HSD)", 50.0, m.khata, 5.0, 0, "Short term credit recorded on vehicle khata", nowTs - 259200);
          }
        });
      })();
    }

    // Seed Generator & Forecourt Electricity Power Logs if empty
    const genCount = db.prepare("select count(*) c from generator_power_logs").get()?.c || 0;
    if (genCount === 0) {
      console.log("Seeding generator power logs...");
      const insertGen = db.prepare(`
        insert into generator_power_logs(
          d, genset_start_hours, genset_end_hours, run_hours,
          diesel_consumed_litres, fuel_burn_rate_lph, power_cut_mins,
          outage_reason, battery_voltage, oil_level_ok, logged_by, notes, created_at
        ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const genLogs = [
        {
          d: "2026-10-10", start: 1420.5, end: 1422.5, run: 2.0, diesel: 16.0, rate: 8.0,
          cut: 120, reason: "Grid Outage / MSEDCL Load Shedding", volt: 12.8, oil: 1, by: 2,
          notes: "MSEDCL 33kV feeder trip during noon. Genset auto-started on AMF panel within 15 seconds. All bays powered.",
          ts: Math.floor(new Date("2026-10-10T14:30:00Z").getTime() / 1000)
        },
        {
          d: "2026-10-09", start: 1419.0, end: 1420.5, run: 1.5, diesel: 12.0, rate: 8.0,
          cut: 90, reason: "Transformer Maintenance", volt: 12.7, oil: 1, by: 2,
          notes: "Scheduled transformer line maintenance by electricity board. Stable 415V generator output.",
          ts: Math.floor(new Date("2026-10-09T13:00:00Z").getTime() / 1000)
        },
        {
          d: "2026-10-07", start: 1416.0, end: 1419.0, run: 3.0, diesel: 24.5, rate: 8.17,
          cut: 180, reason: "Storm / Heavy Thunderstorm Line Trip", volt: 12.6, oil: 1, by: 2,
          notes: "Heavy thunderstorm caused feeder shutdown. DG ran seamlessly for 3 hours. Internal diesel logged.",
          ts: Math.floor(new Date("2026-10-07T19:30:00Z").getTime() / 1000)
        },
        {
          d: "2026-10-05", start: 1415.5, end: 1416.0, run: 0.5, diesel: 4.0, rate: 8.0,
          cut: 0, reason: "Weekly Routine Warmup & Battery Run", volt: 12.8, oil: 1, by: 2,
          notes: "Mandatory weekly 30-minute warmup test. Battery charging circuit verified.",
          ts: Math.floor(new Date("2026-10-05T10:00:00Z").getTime() / 1000)
        }
      ];

      db.transaction(() => {
        for (const g of genLogs) {
          insertGen.run(
            g.d, g.start, g.end, g.run, g.diesel, g.rate, g.cut,
            g.reason, g.volt, g.oil, g.by, g.notes, g.ts
          );
        }
      })();
    }

    // Seed Forecourt Amenities & OMC Mystery Audit Checklist if empty
    const amenCount = db.prepare("select count(*) c from amenities_inspections").get()?.c || 0;
    if (amenCount === 0) {
      console.log("Seeding amenities inspection checklists...");
      const insertAmen = db.prepare(`
        insert into amenities_inspections(
          d, shift, inspector_id, air_nitrogen_working, air_gauge_calibrated,
          drinking_water_ok, water_dispenser_clean, gents_toilet_clean, ladies_toilet_clean,
          soap_water_running, windshield_wash_bucket_ok, fire_extinguishers_green,
          sand_buckets_dry_full, first_aid_stocked, complaint_book_open, canopy_lighting_full,
          total_score_pct, audit_grade, corrective_actions, created_at
        ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const amenList = [
        {
          d: "2026-10-10", shift: "Morning (07:00 AM)", inspector_id: 2,
          air_n: 1, air_g: 1, water_ok: 1, water_disp: 1,
          gents_t: 1, ladies_t: 1, soap: 1, windshield: 1,
          fire_ext: 1, sand_b: 1, first_aid: 1, complaint_b: 1, canopy: 1,
          score: 100.0, grade: "A - Outstanding / 100%",
          actions: "All 13 mandatory OMC customer amenities fully compliant. Driveways spotlessly clean.",
          ts: Math.floor(new Date("2026-10-10T07:15:00Z").getTime() / 1000)
        },
        {
          d: "2026-10-09", shift: "Morning (07:00 AM)", inspector_id: 2,
          air_n: 1, air_g: 1, water_ok: 1, water_disp: 1,
          gents_t: 1, ladies_t: 1, soap: 0, windshield: 1,
          fire_ext: 1, sand_b: 1, first_aid: 1, complaint_b: 1, canopy: 1,
          score: 92.3, grade: "B - Good / Minor Fix",
          actions: "Liquid hand soap dispenser in gents washroom refilled immediately by housekeeping staff.",
          ts: Math.floor(new Date("2026-10-09T07:10:00Z").getTime() / 1000)
        },
        {
          d: "2026-10-08", shift: "Morning (07:00 AM)", inspector_id: 2,
          air_n: 1, air_g: 1, water_ok: 1, water_disp: 1,
          gents_t: 1, ladies_t: 1, soap: 1, windshield: 1,
          fire_ext: 1, sand_b: 1, first_aid: 1, complaint_b: 1, canopy: 1,
          score: 100.0, grade: "A - Outstanding / 100%",
          actions: "OMC field officer inspection passed with flying colors. Praise recorded for clean washrooms.",
          ts: Math.floor(new Date("2026-10-08T07:20:00Z").getTime() / 1000)
        }
      ];

      db.transaction(() => {
        for (const a of amenList) {
          insertAmen.run(
            a.d, a.shift, a.inspector_id, a.air_n, a.air_g,
            a.water_ok, a.water_disp, a.gents_t, a.ladies_t, a.soap,
            a.windshield, a.fire_ext, a.sand_b, a.first_aid, a.complaint_b, a.canopy,
            a.score, a.grade, a.actions, a.ts
          );
        }
      })();
    }

    console.log("Extra petrol operations tables and seeds initialized successfully.");
  } catch (err) {
    console.error("Error in seedExtraPetrolOperations:", err);
  }
}

module.exports = {
  seedExtraPetrolOperations
};
