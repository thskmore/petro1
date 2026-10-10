"use strict";

function getDensityConverted(temp, obsDensity, fuel) {
  const isDiesel = String(fuel).toLowerCase().includes("diesel") || String(fuel).toLowerCase().includes("hsd");
  const factor = isDiesel ? 0.67 : 0.70;
  const converted = obsDensity + (temp - 15) * factor;
  return Math.round(converted * 10) / 10;
}

async function seedPetrolOperations(db) {
  try {
    // 1. Tanker Decantation Register & Daily Density Logs
    db.exec(`
      create table if not exists tanker_decantations(
        id integer primary key,
        challan_no text not null,
        tanker_no text not null,
        transporter text,
        oil_company text not null,
        d text not null,
        fuel_type text not null,
        tank_id text not null,
        invoice_qty real not null,
        invoice_density real not null,
        invoice_temp real,
        observed_temp real not null,
        observed_density real not null,
        converted_density_15c real not null,
        density_diff real not null,
        water_paste_ok integer not null default 1,
        before_dip_cm real,
        before_qty real,
        after_dip_cm real,
        after_qty real,
        decanted_qty real not null,
        transit_variance real not null,
        driver_name text,
        manager_id integer,
        notes text,
        created_at integer not null
      );

      create table if not exists daily_density_logs(
        id integer primary key,
        d text not null,
        tank_id text not null,
        fuel_type text not null,
        dip_cm real,
        temp_c real not null,
        observed_density real not null,
        converted_density_15c real not null,
        ref_density real not null,
        variance real not null,
        is_ok integer not null default 1,
        logged_by integer not null,
        notes text,
        created_at integer not null
      );

      create table if not exists fleet_indents(
        id integer primary key,
        indent_no text not null unique,
        cust_id text not null,
        vehicle_no text not null,
        driver_name text,
        driver_mobile text,
        fuel_product text not null,
        req_qty real,
        req_amount real,
        odometer_km real,
        dispensed_qty real,
        dispensed_rate real,
        dispensed_amount real,
        nozzle_id text,
        duty_id integer,
        status text not null default 'pending',
        issued_d text not null,
        dispensed_at integer,
        worker_id integer,
        credit_sale_id integer,
        notes text,
        created_at integer not null
      );

      create table if not exists lube_items(
        id text primary key,
        code text,
        name text not null,
        category text not null,
        grade text,
        pack_size text,
        unit text not null default 'piece',
        buy_price real not null,
        mrp real not null,
        sell_price real not null,
        stock_qty real not null default 0,
        low_alert_qty real not null default 5,
        attendant_incentive real not null default 0,
        created_at integer not null
      );

      create table if not exists lube_sales(
        id integer primary key,
        d text not null,
        item_id text not null,
        qty real not null,
        sell_price real not null,
        total_amount real not null,
        payment_mode text not null default 'Cash',
        cust_id text,
        vehicle_no text,
        duty_id integer,
        worker_id integer not null,
        incentive_amount real not null default 0,
        notes text,
        created_at integer not null
      );

      create table if not exists nozzle_calibrations(
        id integer primary key,
        d text not null,
        shift text not null,
        nozzle_id text not null,
        measure_qty real not null default 5000,
        delivered_ml real not null,
        error_ml real not null,
        tolerance_ml real not null default 25,
        is_passed integer not null default 1,
        returned_to_tank_id text not null,
        stamped_measure_sr text,
        checked_by integer not null,
        notes text,
        created_at integer not null
      );

      create table if not exists calibration_certificates(
        id integer primary key,
        equipment_name text not null,
        serial_no text not null,
        capacity text not null,
        cert_no text not null,
        stamping_date text not null,
        expiry_date text not null,
        inspector_name text,
        department text default 'Legal Metrology Dept, Maharashtra',
        status text default 'valid',
        notes text
      );

      create table if not exists tank_loss_gain_logs(
        id integer primary key,
        d text not null,
        tank_id text not null,
        fuel_type text not null,
        opening_dip_qty real not null,
        receipts_qty real not null default 0,
        sales_dispensed_qty real not null default 0,
        book_stock_qty real not null,
        closing_dip_cm real,
        physical_dip_qty real not null,
        variance_qty real not null,
        variance_pct real not null,
        omc_norm_pct real not null,
        is_within_norm integer not null default 1,
        temp_avg real,
        status_label text not null,
        notes text,
        logged_by integer,
        created_at integer not null
      );
    `);

    // Check if lube items already exist
    const lubeCount = db.prepare("select count(*) c from lube_items").get()?.c || 0;
    if (lubeCount === 0) {
      console.log("Seeding lube items...");
      const lubeInsert = db.prepare(`
        insert into lube_items(id, code, name, category, grade, pack_size, unit, buy_price, mrp, sell_price, stock_qty, low_alert_qty, attendant_incentive, created_at)
        values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const now = Math.floor(Date.now() / 1000);
      const lubes = [
        ["lube_1", "LUB-20W40-1L", "Servo Pride 20W40 Multi-grade Engine Oil", "Engine Oil", "20W40", "1 Litre", "Bottle", 320, 395, 380, 48, 10, 15, now],
        ["lube_2", "LUB-15W40-5L", "Mak Gold 15W40 Heavy Truck Diesel Oil", "Engine Oil", "15W40", "5 Litres", "Bucket", 1450, 1750, 1680, 24, 6, 25, now],
        ["lube_3", "LUB-15W40-15L", "HP Milcy Turbo 15W40 Commercial Fleet Oil", "Engine Oil", "15W40", "15 Litres", "Bucket", 4100, 4980, 4800, 12, 4, 50, now],
        ["lube_4", "LUB-4T-1L", "Castrol Activ 4T 20W40 Motorcycle Oil", "2T/4T Oil", "20W40", "1 Litre", "Bottle", 360, 440, 420, 60, 12, 15, now],
        ["lube_5", "LUB-2T-500M", "Mak 2T Stroke Self-Mixing Scooter Oil", "2T/4T Oil", "2T", "500 ml", "Bottle", 140, 180, 170, 35, 8, 10, now],
        ["lube_6", "LUB-GEAR-1L", "Servo Gear HP 90 Transmission Lubricant", "Gear Oil", "EP-90", "1 Litre", "Bottle", 270, 340, 325, 20, 5, 12, now],
        ["lube_7", "LUB-COOL-1L", "HP Koolgard Green Premium Radiator Coolant", "Coolant", "Concentrate", "1 Litre", "Bottle", 180, 250, 230, 28, 6, 10, now],
        ["lube_8", "DEF-CAN-10L", "ClearBlue AUS32 AdBlue (DEF) Solution Can", "AdBlue DEF", "ISO 22241", "10 Litres", "Can", 420, 580, 550, 38, 8, 20, now],
        ["lube_9", "DEF-CAN-20L", "ClearBlue AUS32 AdBlue (DEF) Heavy Canister", "AdBlue DEF", "ISO 22241", "20 Litres", "Can", 790, 1100, 1050, 18, 5, 30, now],
        ["lube_10", "DEF-BULK-1L", "AdBlue DEF Island Dispenser Bulk Nozzle", "AdBlue DEF", "AUS32", "1 Litre", "Litre", 36, 52, 48, 850, 150, 2, now]
      ];
      db.transaction(() => {
        for (const item of lubes) lubeInsert.run(...item);
      })();
    }

    // Check if calibration certificates exist
    const certCount = db.prepare("select count(*) c from calibration_certificates").get()?.c || 0;
    if (certCount === 0) {
      console.log("Seeding calibration certificates...");
      const certInsert = db.prepare(`
        insert into calibration_certificates(equipment_name, serial_no, capacity, cert_no, stamping_date, expiry_date, inspector_name, department, status, notes)
        values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const certs = [
        ["Standard Conical Brass Measure 5L #1", "W&M-5L-2026-A109", "5 Litres", "MH/SOL/W&M/2026/884", "2026-04-10", "2027-04-09", "S. R. Shinde (Insp. Legal Metrology)", "Legal Metrology Dept, Solapur Division", "valid", "Official government stamped brass measure for daily dispenser verification."],
        ["Standard Conical Brass Measure 5L #2", "W&M-5L-2026-B214", "5 Litres", "MH/SOL/W&M/2026/885", "2026-04-10", "2027-04-09", "S. R. Shinde (Insp. Legal Metrology)", "Legal Metrology Dept, Solapur Division", "valid", "Secondary stamped measure kept in emergency locker."],
        ["Precision Petroleum Hydrometer (MS 700-750)", "HYDRO-MS-749", "700-750 kg/m³", "NABL/CAL/2026/092", "2026-02-15", "2027-02-14", "Regional Metrology Lab Pune", "Legal Metrology Dept, Solapur Division", "valid", "Glass hydrometer for Petrol daily density checks."],
        ["Precision Petroleum Hydrometer (HSD 800-850)", "HYDRO-HSD-822", "800-850 kg/m³", "NABL/CAL/2026/093", "2026-02-15", "2027-02-14", "Regional Metrology Lab Pune", "Legal Metrology Dept, Solapur Division", "valid", "Glass hydrometer for High Speed Diesel daily density checks."],
        ["Thermometer with Brass Casing (0-50°C)", "THERM-CAL-304", "0 to 50 °C", "NABL/CAL/2026/094", "2026-02-15", "2027-02-14", "Regional Metrology Lab Pune", "Legal Metrology Dept, Solapur Division", "valid", "Calibrated thermometer for fuel temperature dip testing."]
      ];
      db.transaction(() => {
        for (const c of certs) certInsert.run(...c);
      })();
    }

    // Seed Tanker Decantation receipts if empty
    const decantCount = db.prepare("select count(*) c from tanker_decantations").get()?.c || 0;
    if (decantCount === 0) {
      console.log("Seeding tanker decantations...");
      const insertDecant = db.prepare(`
        insert into tanker_decantations(
          challan_no, tanker_no, transporter, oil_company, d, fuel_type, tank_id,
          invoice_qty, invoice_density, invoice_temp, observed_temp, observed_density,
          converted_density_15c, density_diff, water_paste_ok, before_dip_cm, before_qty,
          after_dip_cm, after_qty, decanted_qty, transit_variance, driver_name, manager_id,
          notes, created_at
        ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const decants = [
        {
          challan_no: "IOCL/PUN/2026/10492", tanker_no: "MH-12-RN-8842", transporter: "Patil Bulk Carriers",
          oil_company: "IOCL (Indian Oil)", d: "2026-10-08", fuel_type: "Diesel (HSD)", tank_id: "1791451422410",
          invoice_qty: 12000, invoice_density: 829.4, invoice_temp: 29.5,
          observed_temp: 29.0, observed_density: 820.0, converted_density_15c: 829.4, density_diff: 0.0,
          water_paste_ok: 1, before_dip_cm: 78.5, before_qty: 6200, after_dip_cm: 204.0, after_qty: 18182,
          decanted_qty: 11982, transit_variance: -18, driver_name: "Santosh Gaikwad", manager_id: 2,
          notes: "Chamber seals #A99214 & #A99215 checked intact. Water dip paste showed clean negative. Transit variation -18L (-0.15%) within allowable 0.2% OMC transit norm.",
          created_at: 1791460000
        },
        {
          challan_no: "IOCL/PUN/2026/10311", tanker_no: "MH-09-EM-5510", transporter: "Shree Ganesh Roadlines",
          oil_company: "IOCL (Indian Oil)", d: "2026-10-06", fuel_type: "Petrol (MS)", tank_id: "1791451414419",
          invoice_qty: 8000, invoice_density: 742.6, invoice_temp: 28.0,
          observed_temp: 28.5, observed_density: 733.0, converted_density_15c: 742.5, density_diff: -0.1,
          water_paste_ok: 1, before_dip_cm: 64.0, before_qty: 3850, after_dip_cm: 172.5, after_qty: 11838,
          decanted_qty: 7988, transit_variance: -12, driver_name: "Ramesh Pawar", manager_id: 2,
          notes: "Standard density variance only 0.1 kg/m³ vs invoice (tolerance is ±3.0 kg/m³). Earth wire and master drain valve checked. Decanted smoothly in 45 mins.",
          created_at: 1791290000
        },
        {
          challan_no: "IOCL/PUN/2026/10158", tanker_no: "MH-11-AL-3199", transporter: "Maharashtra Petroleum Tankers",
          oil_company: "IOCL (Indian Oil)", d: "2026-10-03", fuel_type: "Diesel (HSD)", tank_id: "1791451422410",
          invoice_qty: 10000, invoice_density: 830.2, invoice_temp: 27.5,
          observed_temp: 28.0, observed_density: 821.5, converted_density_15c: 830.2, density_diff: 0.0,
          water_paste_ok: 1, before_dip_cm: 85.0, before_qty: 7100, after_dip_cm: 191.0, after_qty: 17091,
          decanted_qty: 9991, transit_variance: -9, driver_name: "Kishor Jadhav", manager_id: 2,
          notes: "Compartment dips checked with datum plate. Zero water bottom detected. Safety fire extinguisher placed at bay during decantation.",
          created_at: 1791030000
        },
        {
          challan_no: "IOCL/PUN/2026/09984", tanker_no: "MH-14-GH-7104", transporter: "Patil Bulk Carriers",
          oil_company: "IOCL (Indian Oil)", d: "2026-09-29", fuel_type: "Petrol (MS)", tank_id: "1791451432098",
          invoice_qty: 5000, invoice_density: 744.1, invoice_temp: 29.0,
          observed_temp: 29.0, observed_density: 734.3, converted_density_15c: 744.1, density_diff: 0.0,
          water_paste_ok: 1, before_dip_cm: 45.0, before_qty: 2100, after_dip_cm: 128.0, after_qty: 7094,
          decanted_qty: 4994, transit_variance: -6, driver_name: "Anil Shinde", manager_id: 2,
          notes: "Power petrol receipt into T3 Power. Color distinct and clear. Sampling taken in standard aluminum container for mandatory retention.",
          created_at: 1790680000
        }
      ];

      db.transaction(() => {
        for (const d of decants) {
          insertDecant.run(
            d.challan_no, d.tanker_no, d.transporter, d.oil_company, d.d, d.fuel_type, d.tank_id,
            d.invoice_qty, d.invoice_density, d.invoice_temp, d.observed_temp, d.observed_density,
            d.converted_density_15c, d.density_diff, d.water_paste_ok, d.before_dip_cm, d.before_qty,
            d.after_dip_cm, d.after_qty, d.decanted_qty, d.transit_variance, d.driver_name, d.manager_id,
            d.notes, d.created_at
          );
        }
      })();
    }

    // Seed Daily Density Logs if empty
    const densityCount = db.prepare("select count(*) c from daily_density_logs").get()?.c || 0;
    if (densityCount === 0) {
      console.log("Seeding daily density logs...");
      const insertDensity = db.prepare(`
        insert into daily_density_logs(d, tank_id, fuel_type, dip_cm, temp_c, observed_density, converted_density_15c, ref_density, variance, is_ok, logged_by, notes, created_at)
        values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const days = [
        "2026-10-10", "2026-10-09", "2026-10-08", "2026-10-07", "2026-10-06", "2026-10-05"
      ];
      const tanksConfig = [
        { id: "1791451414419", name: "T1 MS", fuel: "Petrol (MS)", ref: 742.5, dip: 142.5, temp: 26.5, obs: 734.5 },
        { id: "1791451422410", name: "T2 HSD", fuel: "Diesel (HSD)", ref: 829.4, dip: 188.0, temp: 27.0, obs: 821.4 },
        { id: "1791451432098", name: "T3 Power", fuel: "Power petrol", ref: 744.1, dip: 98.0, temp: 26.0, obs: 736.4 }
      ];

      db.transaction(() => {
        days.forEach((day, dayIdx) => {
          tanksConfig.forEach((tc) => {
            const tempVar = (dayIdx * 0.4) - 0.5;
            const temp = Math.round((tc.temp + tempVar) * 10) / 10;
            const obs = Math.round((tc.obs - (temp - 26) * 0.6) * 10) / 10;
            const conv = getDensityConverted(temp, obs, tc.fuel);
            const variance = Math.round((conv - tc.ref) * 10) / 10;
            const isOk = Math.abs(variance) <= 3.0 ? 1 : 0;
            const loggedBy = dayIdx % 2 === 0 ? 3 : 4; // Vikram or Yedage
            const dipCm = Math.round((tc.dip - (dayIdx * 5.2)) * 10) / 10;
            const note = `Morning 06:30 AM statutory check for ${tc.name}. Density ${conv} kg/m³ vs ref ${tc.ref} kg/m³ (Diff ${variance > 0 ? '+' + variance : variance} kg/m³ within ±3.0 limit).`;
            const ts = Math.floor(new Date(`${day}T06:30:00Z`).getTime() / 1000);
            insertDensity.run(day, tc.id, tc.fuel, dipCm, temp, obs, conv, tc.ref, variance, isOk, loggedBy, note, ts);
          });
        });
      })();
    }

    // Seed Daily 5L Nozzle Calibration logs if empty
    const calibCount = db.prepare("select count(*) c from nozzle_calibrations").get()?.c || 0;
    if (calibCount === 0) {
      console.log("Seeding nozzle calibrations...");
      const insertCalib = db.prepare(`
        insert into nozzle_calibrations(d, shift, nozzle_id, measure_qty, delivered_ml, error_ml, tolerance_ml, is_passed, returned_to_tank_id, stamped_measure_sr, checked_by, notes, created_at)
        values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const days = ["2026-10-10", "2026-10-09", "2026-10-08", "2026-10-07", "2026-10-06"];
      const activeNozzles = [
        { id: "1791451493538", name: "N1 HSD", fuel: "Diesel (HSD)", tank: "1791451422410", typicalErr: -5 },
        { id: "1791451510130", name: "N2 HSD", fuel: "Diesel (HSD)", tank: "1791451422410", typicalErr: +10 },
        { id: "1791451524818", name: "N3 HSD", fuel: "Diesel (HSD)", tank: "1791451422410", typicalErr: 0 },
        { id: "1791525247291", name: "N4 Power", fuel: "Power petrol", tank: "1791451432098", typicalErr: +5 },
        { id: "1791525303738", name: "N6", fuel: "Petrol (MS)", tank: "1791451414419", typicalErr: -10 },
        { id: "1791525325251", name: "N7", fuel: "Petrol (MS)", tank: "1791451414419", typicalErr: +5 }
      ];

      db.transaction(() => {
        days.forEach((day, dayIdx) => {
          activeNozzles.forEach((noz) => {
            const variance = ((dayIdx * 3) % 15) - 5;
            const errorMl = noz.typicalErr + variance;
            const delivered = 5000 + errorMl;
            const isPassed = Math.abs(errorMl) <= 25 ? 1 : 0;
            const checker = (dayIdx % 3 === 0) ? 2 : (dayIdx % 2 === 0 ? 3 : 4);
            const note = `Morning 5L conical test on ${noz.name}. Dispensed: ${delivered} ml (Error: ${errorMl > 0 ? '+' + errorMl : errorMl} ml). 5.0 Litres immediately drained back to tank.`;
            const ts = Math.floor(new Date(`${day}T06:15:00Z`).getTime() / 1000);
            insertCalib.run(
              day, "Morning", noz.id, 5000, delivered, errorMl, 25, isPassed,
              noz.tank, "W&M-5L-2026-A109", checker, note, ts
            );
          });
        });
      })();
    }

    // Seed Fleet Indent slips if empty
    const indentCount = db.prepare("select count(*) c from fleet_indents").get()?.c || 0;
    if (indentCount === 0) {
      console.log("Seeding fleet indents...");
      const insertIndent = db.prepare(`
        insert into fleet_indents(
          indent_no, cust_id, vehicle_no, driver_name, driver_mobile, fuel_product,
          req_qty, req_amount, odometer_km, dispensed_qty, dispensed_rate, dispensed_amount,
          nozzle_id, duty_id, status, issued_d, dispensed_at, worker_id, credit_sale_id, notes, created_at
        ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const nowTs = Math.floor(Date.now() / 1000);
      const indents = [
        {
          indent_no: "IND-2026-1042", cust_id: "1791451697033", vehicle_no: "MH-12-Q-4481",
          driver_name: "Ganesh Shinde", driver_mobile: "9822145520", fuel_product: "Diesel (HSD)",
          req_qty: 120, req_amount: 11880, odometer_km: 142850,
          dispensed_qty: 120, dispensed_rate: 99, dispensed_amount: 11880,
          nozzle_id: "1791451493538", duty_id: 140, status: "dispensed",
          issued_d: "2026-10-09", dispensed_at: nowTs - 86400, worker_id: 3, credit_sale_id: null,
          notes: "Xin Transport 10-wheeler truck. Full tank fill verified with driver slip.",
          created_at: nowTs - 90000
        },
        {
          indent_no: "IND-2026-1043", cust_id: "1791451697033", vehicle_no: "MH-12-BT-9021",
          driver_name: "Pandurang Patil", driver_mobile: "9422019933", fuel_product: "Diesel (HSD)",
          req_qty: 85, req_amount: 8415, odometer_km: 98420,
          dispensed_qty: 85, dispensed_rate: 99, dispensed_amount: 8415,
          nozzle_id: "1791451510130", duty_id: 140, status: "dispensed",
          issued_d: "2026-10-09", dispensed_at: nowTs - 72000, worker_id: 4, credit_sale_id: null,
          notes: "Xin Transport container vehicle. Driver signed voucher on bay.",
          created_at: nowTs - 75000
        },
        {
          indent_no: "IND-2026-1044", cust_id: "1791451697033", vehicle_no: "MH-14-CW-1102",
          driver_name: "Mahadev Mane", driver_mobile: "9766542190", fuel_product: "Diesel (HSD)",
          req_qty: 100, req_amount: 9900, odometer_km: 185120,
          dispensed_qty: null, dispensed_rate: 99, dispensed_amount: null,
          nozzle_id: null, duty_id: null, status: "pending",
          issued_d: "2026-10-10", dispensed_at: null, worker_id: null, credit_sale_id: null,
          notes: "Authorized for 100 Litres HSD Diesel. Driver arriving on driveway this afternoon.",
          created_at: nowTs - 14400
        },
        {
          indent_no: "IND-2026-1045", cust_id: "1791451697033", vehicle_no: "MH-12-RN-6234",
          driver_name: "Sanjay Thorat", driver_mobile: "9158772341", fuel_product: "Diesel (HSD)",
          req_qty: 50, req_amount: 4950, odometer_km: 74210,
          dispensed_qty: null, dispensed_rate: 99, dispensed_amount: null,
          nozzle_id: null, duty_id: null, status: "pending",
          issued_d: "2026-10-10", dispensed_at: null, worker_id: null, credit_sale_id: null,
          notes: "Xin Transport delivery tempo. Indent token verified by manager.",
          created_at: nowTs - 7200
        }
      ];

      db.transaction(() => {
        for (const ind of indents) {
          insertIndent.run(
            ind.indent_no, ind.cust_id, ind.vehicle_no, ind.driver_name, ind.driver_mobile,
            ind.fuel_product, ind.req_qty, ind.req_amount, ind.odometer_km, ind.dispensed_qty,
            ind.dispensed_rate, ind.dispensed_amount, ind.nozzle_id, ind.duty_id, ind.status,
            ind.issued_d, ind.dispensed_at, ind.worker_id, ind.credit_sale_id, ind.notes, ind.created_at
          );
        }
      })();
    }

    // Seed Lube Sales if empty
    const lubeSalesCount = db.prepare("select count(*) c from lube_sales").get()?.c || 0;
    if (lubeSalesCount === 0) {
      console.log("Seeding sample lube bay sales...");
      const insertLubeSale = db.prepare(`
        insert into lube_sales(d, item_id, qty, sell_price, total_amount, payment_mode, cust_id, vehicle_no, duty_id, worker_id, incentive_amount, notes, created_at)
        values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const nowTs = Math.floor(Date.now() / 1000);
      const sales = [
        { d: "2026-10-10", item_id: "DEF-CAN-10L", qty: 2, sell_price: 550, total: 1100, mode: "UPI", cust: null, veh: "MH-12-Q-4481", duty: 140, worker: 3, inc: 40, note: "AdBlue 10L bucket filled into truck during diesel refueling.", ts: nowTs - 3600 },
        { d: "2026-10-10", item_id: "LUB-4T-1L", qty: 1, sell_price: 420, total: 420, mode: "Cash", cust: null, veh: "MH-14-AA-7711", duty: 140, worker: 4, inc: 15, note: "Castrol Activ 4T sold to Pulsar rider at island #2.", ts: nowTs - 7200 },
        { d: "2026-10-09", item_id: "LUB-15W40-5L", qty: 1, sell_price: 1680, total: 1680, mode: "Cash", cust: null, veh: "MH-11-T-8920", duty: 139, worker: 5, inc: 25, note: "Mak Gold 5L engine oil for tractor top-up.", ts: nowTs - 86400 },
        { d: "2026-10-09", item_id: "DEF-BULK-1L", qty: 15, sell_price: 48, total: 720, mode: "Credit", cust: "1791451697033", veh: "MH-12-BT-9021", duty: 139, worker: 3, inc: 30, note: "Bulk AdBlue dispenser top-up billed to Xin Transport.", ts: nowTs - 90000 },
        { d: "2026-10-08", item_id: "LUB-COOL-1L", qty: 2, sell_price: 230, total: 460, mode: "UPI", cust: null, veh: "MH-12-EF-3310", duty: 138, worker: 4, inc: 20, note: "Green coolant 2 bottles sold at air pump bay.", ts: nowTs - 172800 }
      ];

      db.transaction(() => {
        for (const s of sales) {
          insertLubeSale.run(s.d, s.item_id, s.qty, s.sell_price, s.total, s.mode, s.cust, s.veh, s.duty, s.worker, s.inc, s.note, s.ts);
        }
      })();
    }

    // Seed Tank Loss / Gain logs if empty
    const lossGainCount = db.prepare("select count(*) c from tank_loss_gain_logs").get()?.c || 0;
    if (lossGainCount === 0) {
      console.log("Seeding tank loss gain logs...");
      const insertLossGain = db.prepare(`
        insert into tank_loss_gain_logs(
          d, tank_id, fuel_type, opening_dip_qty, receipts_qty, sales_dispensed_qty,
          book_stock_qty, closing_dip_cm, physical_dip_qty, variance_qty, variance_pct,
          omc_norm_pct, is_within_norm, temp_avg, status_label, notes, logged_by, created_at
        ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const days = ["2026-10-09", "2026-10-08", "2026-10-07", "2026-10-06", "2026-10-05"];
      const tanks = [
        { id: "1791451414419", name: "T1 MS", fuel: "Petrol (MS)", opening: 10450, sales: 1680, receipts: 0, norm: 0.59, dipCm: 122.0 },
        { id: "1791451422410", name: "T2 HSD", fuel: "Diesel (HSD)", opening: 16800, sales: 3240, receipts: 12000, norm: 0.15, dipCm: 198.5 },
        { id: "1791451432098", name: "T3 Power", fuel: "Power petrol", opening: 5800, sales: 420, receipts: 0, norm: 0.59, dipCm: 88.0 }
      ];

      db.transaction(() => {
        days.forEach((day, idx) => {
          tanks.forEach((tank) => {
            const receipts = (idx === 1 && tank.fuel.includes("Diesel")) ? 12000 : 0;
            const sales = tank.sales + (idx * 60);
            const bookStock = tank.opening + receipts - sales;
            // Realistic evaporation variance: Petrol has slight negative variance (-0.2% to -0.3%), Diesel (-0.05% to +0.02%)
            const isDiesel = tank.fuel.includes("Diesel");
            const variancePct = isDiesel ? -0.06 : -0.28;
            const varianceQty = Math.round((bookStock * (variancePct / 100)) * 10) / 10;
            const physicalStock = Math.round((bookStock + varianceQty) * 10) / 10;
            const isWithinNorm = Math.abs(variancePct) <= tank.norm ? 1 : 0;
            const statusLabel = isWithinNorm ? "Within OMC Norms" : "Excess Variance Alert";
            const avgTemp = 28.2 - (idx * 0.3);
            const note = `Daily dip reconciliation for ${tank.name}. Book stock: ${bookStock} L, Physical dip: ${physicalStock} L. Variance: ${varianceQty} L (${variancePct}%), permissible OMC limit: ±${tank.norm}%.`;
            const ts = Math.floor(new Date(`${day}T22:00:00Z`).getTime() / 1000);

            insertLossGain.run(
              day, tank.id, tank.fuel, tank.opening, receipts, sales,
              bookStock, tank.dipCm, physicalStock, varianceQty, variancePct,
              tank.norm, isWithinNorm, avgTemp, statusLabel, note, 2, ts
            );
          });
        });
      })();
    }

    console.log("Petrol operations tables and seeds initialized successfully.");
  } catch (err) {
    console.error("Error in seedPetrolOperations:", err);
  }
}

module.exports = {
  seedPetrolOperations,
  getDensityConverted
};
