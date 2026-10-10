"use strict";

async function seedIndianPumpModules(db) {
  try {
    // 1. Daily RSP Price Revision Logs & Broadcast History
    db.exec(`
      create table if not exists daily_price_revisions(
        id integer primary key,
        revision_d text not null,
        effective_time text not null default '06:00',
        fuel_product text not null,
        old_rate real not null,
        new_rate real not null,
        change_amount real not null,
        stock_at_revision real not null default 0,
        inventory_impact_inr real not null default 0,
        omc_notification_ref text,
        revised_by integer,
        notes text,
        created_at integer not null
      );

      create table if not exists price_broadcast_logs(
        id integer primary key,
        revision_id integer,
        broadcast_d text not null,
        channel text not null default 'WhatsApp',
        recipient_group text not null,
        recipients_count integer not null default 0,
        message_body text not null,
        sent_by integer,
        status text not null default 'sent',
        created_at integer not null
      );
    `);

    // 2. Add OTP and verification columns to fleet_indents if not present
    const indentCols = db.prepare("pragma table_info(fleet_indents)").all().map(c => c.name);
    if (!indentCols.includes("otp_code")) {
      db.exec("alter table fleet_indents add column otp_code text default '8492'");
    }
    if (!indentCols.includes("otp_verified")) {
      db.exec("alter table fleet_indents add column otp_verified integer default 1");
    }
    if (!indentCols.includes("slip_leaf_no")) {
      db.exec("alter table fleet_indents add column slip_leaf_no text");
    }

    // 3. W&M Reseal Applications & Breakdown Resealing Tracker
    db.exec(`
      create table if not exists wm_reseal_requests(
        id integer primary key,
        req_no text not null unique,
        nozzle_id text not null,
        fuel_product text not null,
        dispenser_make text not null,
        island_name text not null,
        seal_type text not null check(seal_type in ('pulser_wire','totalizer_board','meter_k_factor','du_cabinet')),
        broken_reason text not null,
        technician_name text not null,
        technician_agency text not null,
        date_broken text not null,
        notice_to_wm_d text,
        wm_inspector_office text not null,
        challan_fee_inr real not null default 450,
        status text not null default 'pending_reseal' check(status in ('pending_reseal','inspected_resealed','cancelled')),
        new_seal_no text,
        resealed_d text,
        inspector_remarks text,
        created_at integer not null
      );
    `);

    // 4. Seed initial Price Revisions if empty
    const pRevCount = db.prepare("select count(*) c from daily_price_revisions").get()?.c || 0;
    if (pRevCount === 0) {
      console.log("Seeding daily price revisions...");
      const insP = db.prepare(`
        insert into daily_price_revisions(
          revision_d, effective_time, fuel_product, old_rate, new_rate,
          change_amount, stock_at_revision, inventory_impact_inr, omc_notification_ref,
          revised_by, notes, created_at
        ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const nowTs = Math.floor(Date.now() / 1000);
      const revs = [
        {
          d: "2026-10-10", time: "06:00", fuel: "Petrol (MS)", old: 111.45, newRate: 112.00,
          chg: 0.55, stock: 8420, impact: 4631.00, ref: "IOCL/MD/RSP/2026/10-10", by: 1,
          notes: "Dynamic 06:00 AM daily price revision communicated via IOCL e-portal.", created: nowTs - 14400
        },
        {
          d: "2026-10-10", time: "06:00", fuel: "Diesel (HSD)", old: 98.70, newRate: 99.00,
          chg: 0.30, stock: 15640, impact: 4692.00, ref: "IOCL/MD/RSP/2026/10-10", by: 1,
          notes: "HSD revised up by 30 paise/L based on crude revision circular.", created: nowTs - 14400
        },
        {
          d: "2026-10-09", time: "06:00", fuel: "Petrol (MS)", old: 111.80, newRate: 111.45,
          chg: -0.35, stock: 9150, impact: -3202.50, ref: "IOCL/MD/RSP/2026/10-09", by: 1,
          notes: "International parity rate softening passed through.", created: nowTs - 100800
        },
        {
          d: "2026-10-09", time: "06:00", fuel: "Diesel (HSD)", old: 98.70, newRate: 98.70,
          chg: 0.00, stock: 16200, impact: 0.00, ref: "IOCL/MD/RSP/2026/10-09", by: 1,
          notes: "HSD rate held steady overnight.", created: nowTs - 100800
        },
        {
          d: "2026-10-08", time: "06:00", fuel: "Power petrol", old: 121.50, newRate: 122.00,
          chg: 0.50, stock: 4500, impact: 2250.00, ref: "IOCL/MD/RSP/2026/10-08", by: 1,
          notes: "XP95 Premium high-octane revision.", created: nowTs - 187200
        }
      ];

      for (const r of revs) {
        insP.run(r.d, r.time, r.fuel, r.old, r.newRate, r.chg, r.stock, r.impact, r.ref, r.by, r.notes, r.created);
      }

      // Seed Broadcast log
      const insB = db.prepare(`
        insert into price_broadcast_logs(
          revision_id, broadcast_d, channel, recipient_group, recipients_count,
          message_body, sent_by, status, created_at
        ) values(?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insB.run(
        1, "2026-10-10", "WhatsApp Broadcast", "Key Commercial Transporters & Fleet Owners (14 Accounts)",
        14, "Mahud Auto Fuels Daily RSP Notice (10-Oct-2026 06:00 AM): Petrol (MS) ₹112.00/L, Diesel (HSD) ₹99.00/L. Fleet discount applied on invoice settlement.",
        1, "sent", nowTs - 13800
      );
    }

    // 5. Seed initial W&M Reseal requests if empty
    const resealCount = db.prepare("select count(*) c from wm_reseal_requests").get()?.c || 0;
    if (resealCount === 0) {
      console.log("Seeding W&M reseal requests...");
      const insRes = db.prepare(`
        insert into wm_reseal_requests(
          req_no, nozzle_id, fuel_product, dispenser_make, island_name, seal_type,
          broken_reason, technician_name, technician_agency, date_broken, notice_to_wm_d,
          wm_inspector_office, challan_fee_inr, status, new_seal_no, resealed_d,
          inspector_remarks, created_at
        ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const nowTs = Math.floor(Date.now() / 1000);
      insRes.run(
        "WM-RSL-2026-081", "1791451510130", "Diesel (HSD)", "Gilbarco Veeder-Root Horizon", "Island 2 (Highway Bay)",
        "pulser_wire", "Dispenser pulser unit erratic pulse calibration error replaced by authorized OEM technician.",
        "Sachin More", "Gilbarco India Technical Services Ltd.", "2026-10-06", "2026-10-07",
        "Inspector of Legal Metrology, Pandharpur Division", 450, "inspected_resealed",
        "LM-PUN-PL-9921", "2026-10-08", "5L measure test verified at ±0 ml error. Resealed with lead stamp LM-26-PND.",
        nowTs - 200000
      );

      insRes.run(
        "WM-RSL-2026-082", "1791451493538", "Diesel (HSD)", "Tokheim Quantium 510", "Island 1 (Front Bay)",
        "meter_k_factor", "Totalizer calibration drifted by +35ml during high-flow dispensing; electronic calibration recalibrated.",
        "Kishore Salve", "Wayne Dresser India AMC Team", "2026-10-09", "2026-10-10",
        "Inspector of Legal Metrology, Pandharpur Division", 450, "pending_reseal",
        null, null, null,
        nowTs - 40000
      );
    }
  } catch (err) {
    console.error("Error seeding Indian pump modules:", err);
  }
}

module.exports = { seedIndianPumpModules };
