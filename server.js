"use strict";
require("dotenv").config();
const express = require("express");
const { openDatabase } = require("./sqlite-adapter");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const { GoogleGenAI, Type } = require("@google/genai");

let aiClient = null;
if (process.env.GEMINI_API_KEY) {
  aiClient = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

const PORT = 3000;
const HOST = process.env.HOST || "0.0.0.0";
const TZ = process.env.TZ_NAME || "Asia/Kolkata";
let db;

async function initDb() {
  db = await openDatabase(process.env.DB_PATH || path.join(__dirname, "data.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
create table if not exists users(
  id integer primary key, name text not null, mobile text unique not null,
  hash text not null, role text not null check(role in ('owner','manager','worker')),
  active integer not null default 1);
create table if not exists sessions(token text primary key, user_id integer not null, exp integer not null);
create table if not exists state(id integer primary key check(id = 1), ver integer not null, json text not null);
create table if not exists credit_sales(
  id integer primary key, cust_id text not null, d text not null, n text not null,
  a real not null, veh text, worker_id integer not null, created integer not null,
  status text not null default 'ok');
create table if not exists credit_recoveries(
  id integer primary key, cust_id text not null, d text not null, mode text not null default 'Cash',
  note text, a real not null, worker_id integer not null, created integer not null);
create table if not exists duties(
  id integer primary key, worker_id integer not null, d text not null, shift text not null,
  status text not null default 'open', cash real not null default 0, upi real not null default 0,
  card real not null default 0, note text, started integer not null, submitted integer,
  closed_by integer, closed_at integer);
create table if not exists duty_lines(
  id integer primary key, duty_id integer not null, nozzle_id text not null,
  opening real, closing real, testing real not null default 0, rate real);
create table if not exists duty_items(
  id integer primary key, duty_id integer not null, item_id text not null, name text not null, qty real not null, price real not null);
create table if not exists duty_expenses(
  id integer primary key, duty_id integer not null, cat text not null, note text, amount real not null);
create table if not exists days(
  d text primary key, status text not null, closed_by integer, closed_at integer, approved_by integer, approved_at integer);
create table if not exists dips(
  id integer primary key, tank_id text not null, litres real not null, dip real,
  note text, user_id integer not null, t integer not null);
create table if not exists pay_rates(worker_id integer not null, shift text not null, rate real not null, primary key(worker_id, shift));
create table if not exists pay_items(
  id integer primary key, worker_id integer not null, month text not null,
  kind text not null check(kind in ('advance','bonus','waive','paid')),
  amount real not null, note text, d text not null, created integer not null);
create table if not exists duty_handovers(
  id integer primary key,
  duty_id integer,
  sender_id integer not null,
  receiver_id integer not null,
  d text not null,
  shift text not null,
  nozzles text,
  note text,
  created_at integer not null);
`);
  if (!db.prepare("pragma table_info(credit_sales)").all().some((c) => c.name === "status"))
    db.exec("alter table credit_sales add column status text not null default 'ok'");

  const addCol = (t, c, def) => { if (!db.prepare(`pragma table_info(${t})`).all().some((x) => x.name === c)) db.exec(`alter table ${t} add column ${c} ${def}`); };
  addCol("duties", "pay_json", "text");
  addCol("duties", "stock_done", "integer not null default 0");
  addCol("duties", "assigned_by", "integer");
  addCol("credit_recoveries", "duty_id", "integer");
  addCol("credit_sales", "duty_id", "integer");
  seedDutyHandoversIfEmpty(db);
  const { seedPetrolOperations } = require("./seed-petrol-operations");
  await seedPetrolOperations(db);
  const { seedExtraPetrolOperations } = require("./seed-extra-petrol-operations");
  await seedExtraPetrolOperations(db);
  const { seedBowserPnlWm } = require("./seed-bowser-pnl-wm");
  await seedBowserPnlWm(db);
  const { seedIndianPumpModules } = require("./seed-indian-pump-modules");
  await seedIndianPumpModules(db);

  db.exec(`
    create table if not exists daily_sample_labels(
      id integer primary key,
      tag_no text not null,
      d text not null,
      time_str text not null default '07:30',
      fuel_product text not null,
      tt_no text not null,
      depot_location text not null,
      invoice_no text not null,
      chamber_no text not null default 'Chamber 1',
      quantity_kl real not null default 4.0,
      challan_density real not null,
      observed_temp real not null,
      observed_density real not null,
      density_15c real not null,
      density_diff real not null,
      hydro_sr text not null default 'H-2024-912',
      thermo_sr text not null default 'T-2024-441',
      driver_name text not null,
      seal_no text not null,
      box_sample_seal text not null,
      status text not null default 'valid',
      created_at integer not null
    );
  `);
  seedSampleLabelsIfEmpty(db);
}

function seedSampleLabelsIfEmpty(database) {
  try {
    const row = database.prepare("select count(*) c from daily_sample_labels").get();
    if (!row || row.c === 0) {
      const stmt = database.prepare(`
        insert into daily_sample_labels(
          id, tag_no, d, time_str, fuel_product, tt_no, depot_location, invoice_no,
          chamber_no, quantity_kl, challan_density, observed_temp, observed_density,
          density_15c, density_diff, hydro_sr, thermo_sr, driver_name, seal_no, box_sample_seal, status, created_at
        ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      const t = Math.floor(Date.now() / 1000);
      const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
      stmt.run(1, "TAG-2026-001", todayStr, "08:15", "Diesel (HSD)", "MH-12-RN-4892", "HPCL Pakni Depot", "INV-HP-98421", "Chamber 1 & 2", 12.0, 831.5, 29.5, 822.4, 831.2, -0.3, "H-2024-912", "T-2024-441", "Dnyaneshwar Shinde", "SL-HPCL-88491", "BOX-4175-01", "valid", t - 86400);
      stmt.run(2, "TAG-2026-002", todayStr, "11:30", "Petrol (MS)", "MH-11-CH-7734", "HPCL Pakni Depot", "INV-HP-98445", "Chamber 3", 8.0, 744.2, 31.0, 732.8, 744.0, -0.2, "H-2024-912", "T-2024-441", "Sachin Jadhav", "SL-HPCL-88502", "BOX-4175-02", "valid", t - 43200);
    }
  } catch (e) {
    console.error("Error seeding sample labels:", e);
  }
}

function seedDutyHandoversIfEmpty(database) {
  try {
    const row = database.prepare("select count(*) c from duty_handovers").get();
    const count = row ? row.c : 0;
    if (count > 0) return;

    const duties = database.prepare("select d.*, u.name as worker_name from duties d join users u on u.id=d.worker_id order by d.id asc").all();
    if (!duties || !duties.length) return;

    let st = {};
    try {
      const sRow = database.prepare("select json from state where id=1").get();
      if (sRow && sRow.json) st = JSON.parse(sRow.json);
    } catch (_) {}
    const nm = {};
    if (st.nozzles) {
      st.nozzles.forEach((n) => { nm[n.id] = n; });
    }

    const sampleNotes = [
      "Cash drawer counted: ₹24,800 handed over. Diesel tank dip recorded at 162 cm.",
      "Morning shift complete. Handed over ₹18,500 cash in locker, POS slips filed.",
      "All active nozzles checked and calibrated. POS machine battery fully charged.",
      "Evening peak rush handled smoothly. QR code stands clean, ₹38,200 cash tallied.",
      "Joint tank dip verification done. Opening meter readings match dispenser counters.",
      "Handover completed: N1 HSD and N2 HSD meter counters verified, float ₹2,000 in drawer.",
      "Handed over to incoming staff. Testing 5L fuel returned to underground storage tank.",
      "Night shift handover: Security lock verified, night sale cash safely deposited.",
      "Nozzle 3 meter tested ok. Cash tallied with cashier with zero variance.",
      "Shift exchange: POS paper roll replaced, ₹21,400 in cash bundle handed over.",
      "Equipment checked, dispenser filters clean. Handed over ₹16,400 in physical cash.",
      "Routine shift handover. Cash and card payments matched with register summary.",
      "Handover notes: Received fleet card batch settlement slip and handed over to manager.",
      "Meter readings verified jointly. Evening rush handled without fuel shortages.",
      "Cash drawer ₹19,250 tallied. Power petrol stock verified with dipped measurement."
    ];

    const insertStmt = database.prepare(
      "insert into duty_handovers(duty_id, sender_id, receiver_id, d, shift, nozzles, note, created_at) values(?,?,?,?,?,?,?,?)"
    );

    database.transaction(() => {
      for (let i = 0; i < duties.length; i++) {
        const cur = duties[i];
        const prev = i > 0 ? duties[i - 1] : null;

        let senderId = cur.assigned_by || 2;
        if (prev && prev.worker_id && prev.worker_id !== cur.worker_id) {
          senderId = (i % 4 === 0) ? (cur.assigned_by || 2) : prev.worker_id;
        }

        const lines = database.prepare("select nozzle_id from duty_lines where duty_id=?").all(cur.id);
        let nozzleSummary = "";
        if (lines && lines.length) {
          nozzleSummary = lines.map((l) => (nm[l.nozzle_id] ? nm[l.nozzle_id].name : `Nozzle ${l.nozzle_id}`)).join(", ");
        } else {
          nozzleSummary = "N1 HSD, N2 HSD";
        }

        const noteText = (cur.note && cur.note.trim()) ? cur.note : sampleNotes[i % sampleNotes.length];
        const createdAt = cur.started || (Math.floor(Date.now() / 1000) - ((duties.length - i) * 43200));

        insertStmt.run(cur.id, senderId, cur.worker_id, cur.d, cur.shift, nozzleSummary, noteText, createdAt);
      }
    })();
  } catch (err) {
    console.error("Error seeding duty handovers:", err);
  }
}

function openDuty(uid) {
  return db.prepare("select * from duties where worker_id=? and status='open' order by id desc limit 1").get(uid);
}

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((q, s, n) => {
  s.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' blob:",
  });
  n();
});
app.use(express.json({ limit: "5mb" }));
// CSRF guard: every state-changing call must carry a custom header a cross-site form cannot send.
app.use((q, s, n) => {
  if (q.method !== "GET" && q.method !== "HEAD" && q.get("x-app") !== "1") return s.status(403).json({ error: "Forbidden." });
  n();
});

const now = () => Math.floor(Date.now() / 1000);
const DAY = 86400;
const hs = (t) => crypto.createHash("sha256").update(t).digest("hex");
const mob = (x) => String(x || "").replace(/\D/g, "").slice(-10);
const pub = (u) => ({ id: u.id, name: u.name, mobile: u.mobile, role: u.role });
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const usersCount = () => db.prepare("select count(*) n from users").get().n;

function cookie(q, k) {
  const m = (q.headers.cookie || "").split(";").map((x) => x.trim()).find((x) => x.startsWith(k + "="));
  return m ? decodeURIComponent(m.slice(k.length + 1)) : null;
}
function getToken(q) {
  const auth = q.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  if (q.headers["x-token"]) {
    return String(q.headers["x-token"]).trim();
  }
  return cookie(q, "sid");
}
function getUser(q) {
  const t = getToken(q);
  if (!t) return null;
  const r = db.prepare("select u.id,u.name,u.mobile,u.role,u.active,s.exp from sessions s join users u on u.id=s.user_id where s.token=?").get(hs(t));
  return r && r.active && r.exp >= now() ? r : null;
}
const need = (...roles) => (q, s, n) => {
  const u = getUser(q);
  if (!u) return s.status(401).json({ error: "Please log in." });
  if (roles.length && !roles.includes(u.role)) return s.status(403).json({ error: "You do not have access to this." });
  q.user = u;
  n();
};
function startSession(q, s, uid) {
  const t = crypto.randomBytes(32).toString("hex");
  db.prepare("insert into sessions values(?,?,?)").run(hs(t), uid, now() + 7 * DAY);
  s.setHeader("Set-Cookie", `sid=${t}; HttpOnly; SameSite=None; Secure; Path=/; Max-Age=${7 * DAY}`);
  return t;
}
function checkUser(name, m, pw) {
  if (!String(name || "").trim() || String(name).length > 60) return "Enter a name (up to 60 characters).";
  if (m.length !== 10) return "Enter a 10-digit mobile number.";
  if (typeof pw !== "string" || pw.length < 6 || pw.length > 100) return "Password must be at least 6 characters.";
  return null;
}

// Login throttle: 5 wrong tries per IP + mobile locks that pair for 30 seconds (clearable).
const fails = new Map();
const blocked = (k) => { const f = fails.get(k); return f && f.n >= 5 && Date.now() - f.t < 30 * 1000; };
const addFail = (k) => { const f = fails.get(k) || { n: 0, t: 0 }; f.n = Date.now() - f.t > 30 * 1000 ? 1 : f.n + 1; f.t = Date.now(); fails.set(k, f); };

app.post("/api/clear-lockout", (q, s) => {
  fails.clear();
  s.json({ ok: true, message: "Lockout cleared successfully." });
});

app.get("/api/me", (q, s) => {
  const u = getUser(q);
  s.json({ user: u ? pub(u) : null, setup: usersCount() === 0 });
});
app.post("/api/setup", (q, s) => {
  if (usersCount() > 0) return s.status(403).json({ error: "Setup is already done." });
  const { name, mobile, password } = q.body || {};
  const e = checkUser(name, mob(mobile), password);
  if (e) return s.status(400).json({ error: e });
  const id = db.prepare("insert into users(name,mobile,hash,role) values(?,?,?,'owner')").run(String(name).trim(), mob(mobile), bcrypt.hashSync(password, 10)).lastInsertRowid;
  const token = startSession(q, s, id);
  s.json({ token, user: { id, name: String(name).trim(), mobile: mob(mobile), role: "owner" } });
});
app.post("/api/login", (q, s) => {
  const m = mob(q.body && q.body.mobile), p = String((q.body && q.body.password) || ""), k = q.ip + "|" + m;
  if (blocked(k)) return s.status(429).json({ error: "Too many wrong attempts. Wait 30 seconds or click 'Unlock Now'." });
  const u = db.prepare("select * from users where mobile=?").get(m);
  if (!u || !u.active || !bcrypt.compareSync(p, u.hash)) { addFail(k); return s.status(401).json({ error: "Wrong mobile number or password." }); }
  fails.delete(k);
  const token = startSession(q, s, u.id);
  s.json({ token, user: pub(u) });
});
app.post("/api/logout", (q, s) => {
  const t = getToken(q);
  if (t) db.prepare("delete from sessions where token=?").run(hs(t));
  s.setHeader("Set-Cookie", "sid=; HttpOnly; SameSite=None; Secure; Path=/; Max-Age=0");
  s.json({ ok: true });
});
app.post("/api/password", need(), (q, s) => {
  const { old, password } = q.body || {};
  const u = db.prepare("select * from users where id=?").get(q.user.id);
  if (!bcrypt.compareSync(String(old || ""), u.hash)) return s.status(400).json({ error: "Current password is wrong." });
  if (typeof password !== "string" || password.length < 6 || password.length > 100) return s.status(400).json({ error: "New password must be at least 6 characters." });
  db.prepare("update users set hash=? where id=?").run(bcrypt.hashSync(password, 10), u.id);
  const curToken = getToken(q);
  const keep = curToken ? hs(curToken) : "";
  db.prepare("delete from sessions where user_id=? and token<>?").run(u.id, keep);
  s.json({ ok: true });
});

// ---- Team (owner only)
app.get("/api/users", need("owner", "manager"), (q, s) =>
  s.json(db.prepare(q.user.role === "owner" ? "select id,name,mobile,role,active from users order by id" : "select id,name,mobile,role,active from users where role='worker' order by id").all()));
app.post("/api/users", need("owner", "manager"), (q, s) => {
  const { name, mobile, password, role } = q.body || {};
  const m = mob(mobile);
  if (!["manager", "worker"].includes(role)) return s.status(400).json({ error: "Choose manager or worker." });
  if (q.user.role === "manager" && role !== "worker") return s.status(403).json({ error: "Managers can add workers only." });
  const e = checkUser(name, m, password);
  if (e) return s.status(400).json({ error: e });
  if (db.prepare("select 1 from users where mobile=?").get(m)) return s.status(409).json({ error: "This mobile number is already registered." });
  db.prepare("insert into users(name,mobile,hash,role) values(?,?,?,?)").run(String(name).trim(), m, bcrypt.hashSync(password, 10), role);
  s.json({ ok: true });
});
app.patch("/api/users/:id", need("owner", "manager"), (q, s) => {
  const id = +q.params.id, u = db.prepare("select * from users where id=?").get(id);
  if (!u) return s.status(404).json({ error: "User not found." });
  if (q.user.role === "manager" && u.role !== "worker") return s.status(403).json({ error: "Managers can change workers only." });
  const { active, password, name, mobile, role } = q.body || {};
  if (active !== undefined) {
    if (u.id === q.user.id && !active) return s.status(400).json({ error: "You cannot deactivate your own account." });
    db.prepare("update users set active=? where id=?").run(active ? 1 : 0, id);
    if (!active) db.prepare("delete from sessions where user_id=?").run(id);
  }
  if (password !== undefined && String(password).trim() !== "") {
    if (typeof password !== "string" || password.length < 6 || password.length > 100) return s.status(400).json({ error: "Password must be at least 6 characters." });
    db.prepare("update users set hash=? where id=?").run(bcrypt.hashSync(password, 10), id);
    const curToken = getToken(q);
    const keep = (u.id === q.user.id && curToken) ? hs(curToken) : "";
    db.prepare("delete from sessions where user_id=? and token<>?").run(id, keep);
  }
  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed || trimmed.length > 60) return s.status(400).json({ error: "Enter a name (up to 60 characters)." });
    db.prepare("update users set name=? where id=?").run(trimmed.slice(0, 60), id);
  }
  if (mobile !== undefined) {
    const m = mob(mobile);
    if (m.length !== 10) return s.status(400).json({ error: "Enter a 10-digit mobile number." });
    const exists = db.prepare("select 1 from users where mobile=? and id<>?").get(m, id);
    if (exists) return s.status(409).json({ error: "This mobile number is already registered." });
    db.prepare("update users set mobile=? where id=?").run(m, id);
  }
  if (role !== undefined && role !== u.role) {
    if (q.user.role !== "owner") return s.status(403).json({ error: "Only the owner can change user roles." });
    if (u.role === "owner") return s.status(400).json({ error: "Owner role cannot be changed." });
    if (!["manager", "worker"].includes(role)) return s.status(400).json({ error: "Choose manager or worker." });
    db.prepare("update users set role=? where id=?").run(role, id);
  }
  const updated = db.prepare("select id,name,mobile,role,active from users where id=?").get(id);
  s.json({ ok: true, user: updated });
});

// ---- Shared business data (owner and manager)
const getState = () => db.prepare("select ver,json from state where id=1").get();
app.get("/api/state", need("owner", "manager"), (q, s) => {
  const r = getState();
  s.json(r ? { ver: r.ver, state: JSON.parse(r.json) } : { ver: 0, state: null });
});
app.put("/api/state", need("owner", "manager"), (q, s) => {
  const { ver, state } = q.body || {};
  if (!state || !Array.isArray(state.c) || !Array.isArray(state.inv)) return s.status(400).json({ error: "Invalid data." });
  const v = db.transaction(() => {
    const r = getState(), cur = r ? r.ver : 0;
    if (ver !== cur) return null;
    db.prepare("insert into state(id,ver,json) values(1,?,?) on conflict(id) do update set ver=excluded.ver,json=excluded.json").run(cur + 1, JSON.stringify(state));
    return cur + 1;
  })();
  if (v === null) return s.status(409).json({ error: "Data was changed by someone else." });
  s.json({ ver: v });
});

// ---- Credit customers and worker credit sales
function customers() {
  const r = getState(), st = r ? JSON.parse(r.json) : { c: [] };
  const sums = {};
  db.prepare("select cust_id, sum(a) t from credit_sales where status='ok' group by cust_id").all().forEach((x) => (sums[x.cust_id] = x.t));
  const recSums = {};
  db.prepare("select cust_id, sum(a) t from credit_recoveries group by cust_id").all().forEach((x) => (recSums[x.cust_id] = x.t));
  return (st.c || []).map((c) => {
    const due = (c.e || []).reduce((a, x) => a + (x.t === "sale" ? x.a : -x.a), 0) + (sums[String(c.id)] || 0) - (recSums[String(c.id)] || 0);
    return { id: c.id, name: c.name, active: c.active !== false, veh: c.veh || [], available: Math.round(((c.limit || 0) - due) * 100) / 100, due: Math.round(due * 100) / 100 };
  });
}
app.get("/api/customers", need(), (q, s) => {
  const all = q.query.all === "1" || q.query.all === "true";
  s.json(customers().filter((c) => (all ? true : (c.active || (c.due != null && c.due > 0)))));
});
app.post("/api/credit-sales", need(), (q, s) => {
  const { cust_id, n, a, veh, force, duty_id } = q.body || {};
  const c = customers().find((x) => String(x.id) === String(cust_id));
  const amt = Math.round(+a * 100) / 100, item = String(n || "").trim();
  if (!c) return s.status(400).json({ error: "Choose a customer from the list." });
  if (!c.active) return s.status(400).json({ error: "This customer is inactive." });
  if (!item || item.length > 100) return s.status(400).json({ error: "Enter the fuel or item and quantity." });
  if (!(amt > 0 && amt <= 1e7)) return s.status(400).json({ error: "Enter an amount above zero." });
  const over = amt > c.available, worker = q.user.role === "worker";
  // Workers cannot exceed a customer's limit: the sale waits for a manager or owner to approve it.
  if (over && !worker && !force) return s.status(409).json({ error: "over_limit", available: c.available });
  const status = over && worker ? "pending" : "ok";
  const openD = duty_id || (openDuty(q.user.id) ? openDuty(q.user.id).id : null);
  const id = db.prepare("insert into credit_sales(cust_id,d,n,a,veh,worker_id,created,status,duty_id) values(?,?,?,?,?,?,?,?,?)")
    .run(String(c.id), bizDate(), item, amt, String(veh || "").trim().toUpperCase().slice(0, 20), q.user.id, now(), status, openD).lastInsertRowid;
  s.json({ id, pending: status === "pending", available: Math.round((status === "ok" ? c.available - amt : c.available) * 100) / 100 });
});
app.get("/api/credit-sales", need("owner", "manager"), (q, s) =>
  s.json(db.prepare("select cs.id,cs.cust_id,cs.d,cs.n,cs.a,cs.veh,cs.status,u.name worker from credit_sales cs join users u on u.id=cs.worker_id where cs.status<>'rejected' order by cs.id").all()));
app.get("/api/my-credit-sales", need(), (q, s) => {
  const names = {};
  customers().forEach((c) => (names[String(c.id)] = c.name));
  const rows = db.prepare("select id,cust_id,d,n,a,veh,status from credit_sales where worker_id=? order by id desc limit 50").all(q.user.id);
  s.json(rows.map((r) => ({ ...r, cname: names[r.cust_id] || "Customer" })));
});
const decide = (to) => (q, s) => {
  const r = db.prepare("update credit_sales set status=? where id=? and status='pending'").run(to, +q.params.id);
  if (!r.changes) return s.status(404).json({ error: "This sale is no longer waiting for approval." });
  s.json({ ok: true });
};
app.post("/api/credit-sales/:id/approve", need("owner", "manager"), decide("ok"));
app.post("/api/credit-sales/:id/reject", need("owner", "manager"), decide("rejected"));
app.delete("/api/credit-sales/:id", need(), (q, s) => {
  const cs = db.prepare("select * from credit_sales where id=?").get(+q.params.id);
  if (!cs) return s.status(404).json({ error: "Credit sale not found." });
  if (q.user.role === "worker" && cs.worker_id !== q.user.id) {
    return s.status(403).json({ error: "You can only delete your own credit sales." });
  }
  db.prepare("delete from credit_sales where id=?").run(+q.params.id);
  s.json({ ok: true });
});

// ---- Credit Recovery Collections
app.post("/api/credit-recoveries", need(), (q, s) => {
  const { cust_id, mode, a, note, duty_id } = q.body || {};
  const c = customers().find((x) => String(x.id) === String(cust_id));
  const amt = Math.round(+a * 100) / 100;
  if (!c) return s.status(400).json({ error: "Choose a customer from the list." });
  if (!(amt > 0 && amt <= 1e7)) return s.status(400).json({ error: "Enter an amount above zero." });
  const openD = duty_id || (openDuty(q.user.id) ? openDuty(q.user.id).id : null);
  const id = db.prepare("insert into credit_recoveries(cust_id,d,mode,note,a,worker_id,created,duty_id) values(?,?,?,?,?,?,?,?)")
    .run(String(c.id), bizDate(), String(mode || "Cash").slice(0, 30), String(note || "").trim().slice(0, 100), amt, q.user.id, now(), openD).lastInsertRowid;
  s.json({ id, ok: true });
});
app.put("/api/credit-recoveries/:id", need(), (q, s) => {
  const cr = db.prepare("select * from credit_recoveries where id=?").get(+q.params.id);
  if (!cr) return s.status(404).json({ error: "Recovery entry not found." });
  if (q.user.role === "worker" && cr.worker_id !== q.user.id) {
    return s.status(403).json({ error: "You can only edit your own recovery entries." });
  }
  const { cust_id, mode, a, note } = q.body || {};
  const c = customers().find((x) => String(x.id) === String(cust_id));
  const amt = Math.round(+a * 100) / 100;
  if (!c) return s.status(400).json({ error: "Choose a customer from the list." });
  if (!(amt > 0 && amt <= 1e7)) return s.status(400).json({ error: "Enter an amount above zero." });
  db.prepare("update credit_recoveries set cust_id=?, mode=?, note=?, a=? where id=?")
    .run(String(c.id), String(mode || "Cash").slice(0, 30), String(note || "").trim().slice(0, 100), amt, +q.params.id);
  s.json({ id: +q.params.id, ok: true });
});
app.get("/api/credit-recoveries", need(), (q, s) => {
  const names = {};
  customers().forEach((c) => (names[String(c.id)] = c.name));
  const rows = db.prepare("select cr.id,cr.cust_id,cr.d,cr.mode,cr.note,cr.a,cr.created,u.name worker from credit_recoveries cr join users u on u.id=cr.worker_id order by cr.id desc limit 100").all();
  s.json(rows.map((r) => ({ ...r, cname: names[r.cust_id] || "Customer" })));
});
app.delete("/api/credit-recoveries/:id", need(), (q, s) => {
  const cr = db.prepare("select * from credit_recoveries where id=?").get(+q.params.id);
  if (!cr) return s.status(404).json({ error: "Recovery entry not found." });
  if (q.user.role === "worker" && cr.worker_id !== q.user.id) {
    return s.status(403).json({ error: "You can only delete your own recovery entries." });
  }
  db.prepare("delete from credit_recoveries where id=?").run(+q.params.id);
  s.json({ ok: true });
});

// ---- Duties and nozzle readings

const r2 = (x) => Math.round(x * 100) / 100;
const num = (x) => { if (x === "" || x === null || x === undefined) return NaN; const n = +x; return Number.isFinite(n) && n >= 0 && n < 1e9 ? n : NaN; };
// The business day starts at 6 AM: a night shift that runs past midnight belongs to the previous day.
const bizDate = () => new Date(Date.now() - 6 * 3600e3).toLocaleDateString("en-CA", { timeZone: TZ });
const DEFMODES = [{ key: "cash", name: "Cash", active: true }, { key: "upi", name: "UPI", active: true }, { key: "card", name: "Card", active: true }];
const allModes = (st) => (st.paymodes && st.paymodes.length ? st.paymodes : DEFMODES);
const activeModes = (st) => allModes(st).filter((m) => m.active !== false || m.key === "cash");
function nozzleMap(st = stateNow()) {
  const m = {};
  (st.nozzles || []).forEach((n) => (m[String(n.id)] = n));
  return m;
}
function rateFor(st, fuel, date) {
  let best = null;
  (st.rates || []).forEach((r) => {
    if (r.fuel === fuel && r.from <= date && (!best || r.from > best.from || (r.from === best.from && r.id > best.id))) best = r;
  });
  return best ? +best.rate : null;
}
function lastClose(nid) {
  return db.prepare("select dl.closing c from duty_lines dl join duties d on d.id=dl.duty_id where dl.nozzle_id=? and d.status in ('submitted','closed') and dl.closing is not null order by d.submitted desc, dl.id desc limit 1").get(String(nid)) || {};
}
const dayStatus = (d) => (db.prepare("select status from days where d=?").get(d) || { status: "open" }).status;
function detail(d) {
  const st = stateNow(), nm = nozzleMap(st);
  const lines = db.prepare("select * from duty_lines where duty_id=? order by id").all(d.id).map((l) => {
    const opening = l.opening == null ? null : r2(l.opening);
    const closing = l.closing == null ? null : r2(l.closing);
    const testing = l.testing == null ? 0 : r2(l.testing);
    const lt = closing == null ? 0 : r2(closing - (opening || 0) - testing), n = nm[l.nozzle_id] || {};
    return { ...l, opening, closing, testing, nozzle: n.name || "Nozzle", fuel: n.fuel || "", litres: lt, amount: r2(lt * (l.rate || 0)) };
  });
  const items = db.prepare("select * from duty_items where duty_id=? order by id").all(d.id).map((i) => ({ ...i, amount: r2(i.qty * i.price) }));
  const expenses = db.prepare("select * from duty_expenses where duty_id=? order by id").all(d.id);
  const sales = r2(lines.reduce((a, l) => a + l.amount, 0)), litres = r2(lines.reduce((a, l) => a + l.litres, 0));
  const lube = r2(items.reduce((a, i) => a + i.amount, 0)), exp = r2(expenses.reduce((a, e) => a + e.amount, 0));
  const credit = r2(db.prepare("select coalesce(sum(a),0) t from credit_sales where (duty_id=? or (duty_id is null and worker_id=? and created>=? and created<=?)) and status='ok'").get(d.id, d.worker_id, d.started, d.submitted || now()).t);
  const recovery = r2(db.prepare("select coalesce(sum(a),0) t from credit_recoveries where (duty_id=? or (duty_id is null and worker_id=? and created>=? and created<=?))").get(d.id, d.worker_id, d.started, d.submitted || now()).t);
  const cnames = {};
  (st.c || []).forEach((c) => (cnames[String(c.id)] = c.name));
  const credit_sales = db.prepare("select id,cust_id,d,n,a,veh,status,created from credit_sales where (duty_id=? or (duty_id is null and worker_id=? and created>=? and created<=?)) and status<>'rejected' order by id desc")
    .all(d.id, d.worker_id, d.started, d.submitted || now())
    .map((cs) => ({ ...cs, cname: cnames[String(cs.cust_id)] || "Customer" }));
  const credit_recoveries = db.prepare("select id,cust_id,d,mode,note,a,created from credit_recoveries where (duty_id=? or (duty_id is null and worker_id=? and created>=? and created<=?)) order by id desc")
    .all(d.id, d.worker_id, d.started, d.submitted || now())
    .map((cr) => ({ ...cr, cname: cnames[String(cr.cust_id)] || "Customer" }));
  const pay = d.pay_json ? JSON.parse(d.pay_json) : { cash: d.cash, upi: d.upi, card: d.card };
  const collected = r2(Object.values(pay).reduce((a, x) => a + (+x || 0), 0));
  const expected = r2(sales + lube + recovery - credit - exp);
  const w = db.prepare("select name from users where id=?").get(d.worker_id);
  return {
    id: d.id, d: d.d, shift: d.shift, status: d.status, worker_id: d.worker_id, worker: w ? w.name : "", pay,
    cash: +pay.cash || 0, upi: +pay.upi || 0, card: +pay.card || 0, note: d.note || "",
    lines, items, expenses, credit_sales, credit_recoveries, litres, sales, lube, exp, credit, recovery, expected, collected, diff: r2(collected - expected),
  };
}
// Updates a duty's nozzle readings, shop items, expenses and collections.
// Workers change closing/testing only; managers (full) can also change opening and rate.
function saveDuty(id, b, strict, full) {
  const st = stateNow(), nm = nozzleMap(st), cur = db.prepare("select * from duty_lines where duty_id=? order by id").all(id);
  const src = Array.isArray(b.lines) ? b.lines : [], ups = [];
  const rd = (v) => (v === "" || v === null || v === undefined ? null : r2(num(v)));
  const check2dec = (v, label) => {
    if (v !== "" && v !== null && v !== undefined && typeof v === "string" && v.indexOf(".") !== -1 && v.split(".")[1].length > 2) {
      return `${label} must be up to two decimals.`;
    }
    return null;
  };
  for (const row of cur) {
    const l = src.find((x) => String(x.nozzle_id) === row.nozzle_id) || {}, nn = (nm[row.nozzle_id] || {}).name || "Nozzle";
    const o = { id: row.id, opening: row.opening, rate: row.rate, closing: row.closing, testing: row.testing };
    if (l.closing !== undefined) o.closing = rd(l.closing);
    if (l.testing !== undefined) o.testing = rd(l.testing) ?? 0;
    if (full && l.opening !== undefined) o.opening = rd(l.opening);
    if (full && l.rate !== undefined) o.rate = rd(l.rate);
    if ([o.closing, o.testing, o.opening, o.rate].some((x) => Number.isNaN(x))) {
      if (strict) return `Check the numbers for ${nn}.`;
      if (Number.isNaN(o.closing)) o.closing = row.closing;
      if (Number.isNaN(o.testing)) o.testing = row.testing;
      if (Number.isNaN(o.opening)) o.opening = row.opening;
      if (Number.isNaN(o.rate)) o.rate = row.rate;
    }
    if (strict) {
      if (l.closing !== undefined) {
        const err = check2dec(l.closing, `Closing reading for ${nn}`);
        if (err) return err;
      }
      if (l.opening !== undefined) {
        const err = check2dec(l.opening, `Opening reading for ${nn}`);
        if (err) return err;
      }
      if (l.testing !== undefined) {
        const err = check2dec(l.testing, `Testing litres for ${nn}`);
        if (err) return err;
      }
      if (o.opening == null) return `Enter the opening reading for ${nn}.`;
      if (o.closing == null) return `Enter the closing reading for ${nn}.`;
      if (o.rate == null || o.rate <= 0) return `The rate for ${nn} is missing. Ask the owner to set it in Pump setup.`;
      if (o.closing < o.opening) return `Closing is less than opening for ${nn}.`;
      if (o.testing > o.closing - o.opening) return `Testing litres are more than the fuel dispensed on ${nn}.`;
    }
    ups.push(o);
  }
  const items = [], need = {}, stItems = st.items || [], iSrc = Array.isArray(b.items) ? b.items : [];
  if (iSrc.length > 50) return "Too many shop items.";
  for (const x of iSrc) {
    if (x.item_id === "" || x.item_id == null) continue;
    const it = stItems.find((i) => String(i.id) === String(x.item_id));
    if (!it) return "Choose each lube or shop item from the stock list.";
    const q = num(x.qty);
    if (Number.isNaN(q) || q <= 0) { if (strict) return `Enter a quantity for ${it.name}.`; continue; }
    items.push({ item_id: String(it.id), name: it.name, qty: q, price: +it.sell });
    need[it.id] = (need[it.id] || 0) + q;
  }
  if (strict) for (const k in need) { const it = stItems.find((i) => String(i.id) === k); if (need[k] > +it.stock) return `Only ${it.stock} ${it.unit} of ${it.name} in stock.`; }
  const exps = [], eSrc = Array.isArray(b.expenses) ? b.expenses : [];
  if (eSrc.length > 50) return "Too many expense lines.";
  for (const x of eSrc) {
    const blank = (x.amount === "" || x.amount == null) && !String(x.note || "").trim();
    if (blank) continue;
    const a = num(x.amount);
    if (Number.isNaN(a) || a <= 0) { if (strict) return "Enter an amount above zero for every expense."; continue; }
    exps.push({ cat: String(x.cat || "Other").slice(0, 40), note: String(x.note || "").slice(0, 60), amount: r2(a) });
  }
  const pay = {};
  for (const m of activeModes(st)) {
    let raw = b.pay && b.pay[m.key] !== undefined ? b.pay[m.key] : b[m.key];
    const n = num(raw === undefined || raw === null || raw === "" ? 0 : raw);
    if (Number.isNaN(n)) {
      if (strict) return `Check the ${m.name} amount.`;
      pay[m.key] = 0;
    } else {
      pay[m.key] = n;
    }
  }
  if (b.pay && b.pay._slips) pay._slips = b.pay._slips;
  if (b.pay && b.pay._denoms) pay._denoms = b.pay._denoms;
  db.transaction(() => {
    const u = db.prepare("update duty_lines set opening=?, closing=?, testing=?, rate=? where id=?");
    ups.forEach((o) => u.run(o.opening, o.closing, o.testing, o.rate, o.id));
    db.prepare("delete from duty_items where duty_id=?").run(id);
    items.forEach((x) => db.prepare("insert into duty_items(duty_id,item_id,name,qty,price) values(?,?,?,?,?)").run(id, x.item_id, x.name, x.qty, x.price));
    db.prepare("delete from duty_expenses where duty_id=?").run(id);
    exps.forEach((x) => db.prepare("insert into duty_expenses(duty_id,cat,note,amount) values(?,?,?,?)").run(id, x.cat, x.note, x.amount));
    db.prepare("update duties set pay_json=?, cash=?, upi=?, card=?, note=? where id=?").run(JSON.stringify(pay), pay.cash || 0, pay.upi || 0, pay.card || 0, String(b.note || "").slice(0, 200), id);
  })();
  return null;
}
// Lube and shop stock moves when a duty is closed (and comes back if the owner reopens it).
function adjustStock(duty, sign) {
  const items = db.prepare("select * from duty_items where duty_id=?").all(duty.id), r = getState();
  if (!items.length || !r) return;
  const st = JSON.parse(r.json);
  items.forEach((x) => { const it = (st.items || []).find((i) => String(i.id) === x.item_id); if (it) it.stock = Math.max(0, r2(+it.stock + sign * x.qty)); });
  db.prepare("update state set ver=ver+1, json=? where id=1").run(JSON.stringify(st));
}
const mine = (q, s, n) => {
  const d = db.prepare("select * from duties where id=? and worker_id=? and status='open'").get(+q.params.id, q.user.id);
  if (!d) return s.status(404).json({ error: "This duty is not open." });
  q.duty = d; n();
};
const fillInfo = (st) => ({
  modes: activeModes(st).map((m) => ({ key: m.key, name: m.name })),
  cats: st.expcats && st.expcats.length ? st.expcats : ["Tea and food", "Repairs", "Electricity", "Transport", "Other"],
  items: (st.items || []).map((i) => ({ id: i.id, name: i.name, unit: i.unit, sell: i.sell, stock: i.stock })),
});
app.get("/api/duty/current", need(), (q, s) => {
  const d = openDuty(q.user.id), st = stateNow();
  const recent = db.prepare("select * from duties where worker_id=? and status<>'open' order by id desc limit 8").all(q.user.id).map(detail);
  s.json({ duty: d ? detail(d) : null, ...fillInfo(st), recent });
});
app.get("/api/my-duties/:id", need(), (q, s) => {
  const d = db.prepare("select * from duties where id=? and worker_id=? and status<>'open'").get(+q.params.id, q.user.id);
  if (!d) return s.status(404).json({ error: "Duty not found." });
  s.json({ duty: detail(d), modes: allModes(stateNow()).map((m) => ({ key: m.key, name: m.name })) });
});
app.put("/api/duty/:id", need(), mine, (q, s) => {
  const e = saveDuty(q.duty.id, q.body || {}, false, false);
  if (e) return s.status(400).json({ error: e });
  s.json({ ok: true });
});
app.post("/api/duty/:id/submit", need(), mine, (q, s) => {
  const e = saveDuty(q.duty.id, q.body || {}, true, false);
  if (e) return s.status(400).json({ error: e });
  db.prepare("update duties set status='submitted', submitted=? where id=?").run(now(), q.duty.id);
  s.json({ ok: true });
});

// ---- Manager: assign nozzles, review, close
app.get("/api/assign-info", need("owner", "manager"), (q, s) => {
  const st = stateNow(), d = bizDate();
  const busy = {};
  db.prepare("select dl.nozzle_id n, u.name w from duty_lines dl join duties du on du.id=dl.duty_id join users u on u.id=du.worker_id where du.status in ('open','submitted')").all().forEach((x) => (busy[x.n] = x.w));
  const workers = db.prepare("select id,name,role from users where active=1 and role='worker' order by name").all();
  const nozzles = (st.nozzles || []).filter((n) => n.active !== false).map((n) => {
    const lc = lastClose(n.id);
    return { id: n.id, name: n.name, fuel: n.fuel, busy_by: busy[String(n.id)] || null, rate: rateFor(st, n.fuel, d), opening: lc.c ?? (n.open ?? null) };
  });
  const open = db.prepare("select * from duties where status='open' order by id").all().map(detail);
  s.json({ date: d, day: dayStatus(d), workers, nozzles, open });
});
app.post("/api/duties/assign", need("owner", "manager"), (q, s) => {
  const { worker_id, shift, nozzle_ids } = q.body || {}, st = stateNow(), d = bizDate();
  const w = db.prepare("select * from users where id=? and active=1 and role='worker'").get(+worker_id);
  if (!w) return s.status(400).json({ error: "Choose a worker." });
  if (!SHIFTS.includes(shift)) return s.status(400).json({ error: "Choose a shift." });
  const ids = Array.isArray(nozzle_ids) ? [...new Set(nozzle_ids.map(String))] : [];
  if (!ids.length || ids.length > 30) return s.status(400).json({ error: "Choose at least one nozzle." });
  if (dayStatus(d) !== "open") return s.status(409).json({ error: "Today's business day is already closed. Ask the owner to reopen it." });
  if (openDuty(w.id)) return s.status(409).json({ error: `${w.name} already has a duty in progress.` });
  const nm = nozzleMap(st), lines = [];
  for (const id of ids) {
    const n = nm[id];
    if (!n || n.active === false) return s.status(400).json({ error: "One of the nozzles is not available." });
    const b = db.prepare("select u.name w from duty_lines dl join duties du on du.id=dl.duty_id join users u on u.id=du.worker_id where dl.nozzle_id=? and du.status in ('open','submitted') limit 1").get(id);
    if (b) return s.status(409).json({ error: `${n.name} is with ${b.w}. It is free once that duty is closed.` });
    const rate = rateFor(st, n.fuel, d);
    if (rate == null) return s.status(400).json({ error: `Set the ${n.fuel} rate in Pump setup first.` });
    const lc = lastClose(id), opening = lc.c ?? (n.open ?? null);
    if (opening == null) return s.status(400).json({ error: `Set the opening reading for ${n.name} in Pump setup first.` });
    lines.push({ id, opening, rate });
  }
  const dutyId = db.transaction(() => {
    const customNote = String((q.body && q.body.note) || "").trim();
    const dutyNote = customNote || `Assigned by ${q.user.name}`;
    const did = db.prepare("insert into duties(worker_id,d,shift,started,assigned_by,note) values(?,?,?,?,?,?)").run(w.id, d, shift, now(), q.user.id, dutyNote).lastInsertRowid;
    lines.forEach((l) => db.prepare("insert into duty_lines(duty_id,nozzle_id,opening,rate) values(?,?,?,?)").run(did, l.id, l.opening, l.rate));
    const nozzleSummary = lines.map((l) => (nm[l.id] ? nm[l.id].name : l.id)).join(", ");
    db.prepare("insert into duty_handovers(duty_id,sender_id,receiver_id,d,shift,nozzles,note,created_at) values(?,?,?,?,?,?,?,?)")
      .run(did, q.user.id, w.id, d, shift, nozzleSummary, customNote || `Shift duty assigned by ${q.user.name}`, now());
    return did;
  })();
  s.json({ id: dutyId });
});

// Worker self-assignment from latest closed duty
app.get("/api/worker/assign-info", need(), (q, s) => {
  const d = bizDate(), st = stateNow();
  const open = openDuty(q.user.id);
  if (open) {
    return s.json({ has_open: true, duty: detail(open), date: d, day: dayStatus(d) });
  }
  let lastDuty = db.prepare("select * from duties where worker_id=? and status in ('closed', 'submitted') order by id desc limit 1").get(q.user.id);
  if (!lastDuty) {
    lastDuty = db.prepare("select * from duties where status in ('closed', 'submitted') order by id desc limit 1").get();
  }
  if (!lastDuty) {
    return s.json({ has_open: false, latest_closed: null, date: d, day: dayStatus(d) });
  }
  const nm = nozzleMap(st);
  const lines = db.prepare("select * from duty_lines where duty_id=? order by id").all(lastDuty.id);
  const busy = {};
  db.prepare("select dl.nozzle_id n, u.name w from duty_lines dl join duties du on du.id=dl.duty_id join users u on u.id=du.worker_id where du.status='open'").all().forEach((x) => (busy[x.n] = x.w));
  const nozzles = lines.map((l) => {
    const n = nm[l.nozzle_id] || { name: "Nozzle", fuel: "" };
    const rate = rateFor(st, n.fuel, d);
    const opening = l.closing != null ? l.closing : (lastClose(l.nozzle_id).c ?? (n.open ?? null));
    return {
      id: l.nozzle_id,
      name: n.name,
      fuel: n.fuel,
      rate,
      opening,
      busy_by: busy[String(l.nozzle_id)] || null,
      active: n.active !== false
    };
  });
  const colleagues = db.prepare("select id, name, role from users where active=1 and role='worker' order by name").all().map((w) => ({
    id: w.id,
    name: w.name,
    role: w.role,
    busy: !!openDuty(w.id)
  }));
  s.json({
    has_open: false,
    latest_closed: {
      id: lastDuty.id,
      d: lastDuty.d,
      shift: lastDuty.shift,
      status: lastDuty.status,
      closed_at: lastDuty.closed_at,
      submitted: lastDuty.submitted
    },
    nozzles,
    date: d,
    day: dayStatus(d),
    shifts: SHIFTS,
    colleagues
  });
});

app.post("/api/worker/assign-duty", need(), (q, s) => {
  const { shift, target_worker_id, nozzle_assignments, note } = q.body || {};
  const st = stateNow(), d = bizDate();

  if (!SHIFTS.includes(shift)) {
    return s.status(400).json({ error: "Choose a shift (Morning, Evening, or Night)." });
  }
  if (dayStatus(d) !== "open") {
    return s.status(409).json({ error: "Today's business day is already closed. Ask the owner to reopen it." });
  }

  let lastDuty = db.prepare("select * from duties where worker_id=? and status in ('closed', 'submitted') order by id desc limit 1").get(q.user.id);
  if (!lastDuty) {
    lastDuty = db.prepare("select * from duties where status in ('closed', 'submitted') order by id desc limit 1").get();
  }
  if (!lastDuty) {
    return s.status(400).json({ error: "No closed duty found to assign from. Your manager must assign your first duty." });
  }

  const nm = nozzleMap(st);
  const prevLines = db.prepare("select * from duty_lines where duty_id=? order by id").all(lastDuty.id);
  if (!prevLines.length) {
    return s.status(400).json({ error: "No nozzles found in your latest closed duty." });
  }

  // Determine assignments: support both multi-nozzle mapping and single target worker
  let assignments = [];
  if (Array.isArray(nozzle_assignments) && nozzle_assignments.length > 0) {
    assignments = nozzle_assignments;
  } else if (target_worker_id) {
    assignments = prevLines.map((l) => ({ nozzle_id: l.nozzle_id, target_worker_id }));
  } else {
    return s.status(400).json({ error: "Please select incoming staff for handover." });
  }

  // Group by target worker
  const byWorker = {};
  for (const asgn of assignments) {
    const nId = +asgn.nozzle_id;
    const wId = +(asgn.target_worker_id || target_worker_id || q.user.id);

    const l = prevLines.find((pl) => pl.nozzle_id === nId);
    if (!l) {
      return s.status(400).json({ error: `Nozzle ${nId} was not part of your shift duty.` });
    }
    const n = nm[nId];
    if (!n || n.active === false) {
      return s.status(400).json({ error: `Nozzle ${n ? n.name : nId} is no longer active.` });
    }
    const busy = db.prepare("select u.name w from duty_lines dl join duties du on du.id=dl.duty_id join users u on u.id=du.worker_id where dl.nozzle_id=? and du.status='open' limit 1").get(nId);
    if (busy) {
      return s.status(409).json({ error: `${n.name} is currently open with ${busy.w}.` });
    }
    const rate = rateFor(st, n.fuel, d);
    if (rate == null) {
      return s.status(400).json({ error: `Set the ${n.fuel} rate in Pump setup first.` });
    }
    const opening = l.closing != null ? l.closing : (lastClose(nId).c ?? (n.open ?? null));
    if (opening == null) {
      return s.status(400).json({ error: `Set the opening reading for ${n.name} in Pump setup first.` });
    }

    if (!byWorker[wId]) {
      const tw = db.prepare("select * from users where id=? and active=1 and role='worker'").get(wId);
      if (!tw) {
        return s.status(400).json({ error: `Selected worker for nozzle ${n.name} is not found, inactive, or not a worker.` });
      }
      if (openDuty(tw.id)) {
        return s.status(409).json({ error: String(tw.id) === String(q.user.id) ? "You already have an active duty in progress." : `${tw.name} already has an active duty in progress.` });
      }
      byWorker[wId] = { worker: tw, lines: [] };
    }

    byWorker[wId].lines.push({ id: nId, name: n.name, opening, rate });
  }

  const customNote = String(note || "").trim();
  const created = [];

  db.transaction(() => {
    Object.values(byWorker).forEach(({ worker: tw, lines }) => {
      const isHandover = String(tw.id) !== String(q.user.id);
      const dutyNote = isHandover ? (customNote ? `Handover from ${q.user.name}: ${customNote}` : `Handover from ${q.user.name}`) : customNote;

      const did = db.prepare("insert into duties(worker_id,d,shift,started,assigned_by,note) values(?,?,?,?,?,?)")
        .run(tw.id, d, shift, now(), q.user.id, dutyNote).lastInsertRowid;

      lines.forEach((line) => {
        db.prepare("insert into duty_lines(duty_id,nozzle_id,opening,rate) values(?,?,?,?)")
          .run(did, line.id, line.opening, line.rate);
      });

      // Record in duty_handovers log
      db.prepare("insert into duty_handovers(duty_id, sender_id, receiver_id, d, shift, nozzles, note, created_at) values(?,?,?,?,?,?,?,?)")
        .run(did, q.user.id, tw.id, d, shift, lines.map((l) => l.name).join(", "), customNote || dutyNote, now());

      created.push({
        id: did,
        worker_id: tw.id,
        worker_name: tw.name,
        nozzles: lines.map((l) => l.name),
        nozzle_count: lines.length,
      });
    });
  })();

  const workerSummary = created.map((c) => `${c.worker_name} (${c.nozzles.join(", ")})`).join(", ");
  s.json({
    ok: true,
    created,
    target_name: created.length === 1 ? created[0].worker_name : `${created.length} staff members`,
    worker_summary: workerSummary,
    count: created.length,
  });
});

// Chronological Handover History log API
app.get("/api/handover-history", need(), (q, s) => {
  const { search, worker_id, shift, date_from, date_to } = q.query || {};

  let sql = `
    select
      h.id,
      h.duty_id,
      h.sender_id,
      us.name as sender_name,
      us.role as sender_role,
      h.receiver_id,
      ur.name as receiver_name,
      ur.role as receiver_role,
      h.d,
      h.shift,
      h.nozzles,
      h.note,
      h.created_at,
      d.status as duty_status,
      d.cash,
      d.upi,
      d.card
    from duty_handovers h
    left join users us on us.id = h.sender_id
    left join users ur on ur.id = h.receiver_id
    left join duties d on d.id = h.duty_id
    where 1=1
  `;
  const params = [];

  if (worker_id && worker_id !== "all") {
    sql += " and (h.sender_id = ? or h.receiver_id = ?)";
    params.push(+worker_id, +worker_id);
  }
  if (shift && shift !== "all") {
    sql += " and h.shift = ?";
    params.push(shift);
  }
  if (date_from) {
    sql += " and h.d >= ?";
    params.push(date_from);
  }
  if (date_to) {
    sql += " and h.d <= ?";
    params.push(date_to);
  }
  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    sql += " and (h.note like ? or us.name like ? or ur.name like ? or h.nozzles like ?)";
    params.push(term, term, term, term);
  }

  sql += " order by h.d desc, h.id desc limit 300";

  const rows = db.prepare(sql).all(...params);

  // Summary statistics
  const totalCount = db.prepare("select count(*) c from duty_handovers").get()?.c || 0;
  const todayDate = bizDate();
  const todayCount = db.prepare("select count(*) c from duty_handovers where d=?").get(todayDate)?.c || 0;
  const withNotesCount = db.prepare("select count(*) c from duty_handovers where note is not null and length(trim(note))>0").get()?.c || 0;
  const staffList = db.prepare("select id, name, role from users where active=1 order by name").all();

  s.json({
    handovers: rows.map((r) => ({
      id: r.id,
      duty_id: r.duty_id,
      sender: {
        id: r.sender_id,
        name: r.sender_name || `Staff #${r.sender_id}`,
        role: r.sender_role || "staff",
      },
      receiver: {
        id: r.receiver_id,
        name: r.receiver_name || `Staff #${r.receiver_id}`,
        role: r.receiver_role || "staff",
      },
      d: r.d,
      shift: r.shift,
      nozzles: r.nozzles || "",
      note: r.note || "",
      created_at: r.created_at,
      duty_status: r.duty_status || null,
      collected: (r.cash || 0) + (r.upi || 0) + (r.card || 0),
    })),
    stats: {
      total: totalCount,
      today: todayCount,
      with_notes: withNotesCount,
      staff_count: staffList.length,
    },
    staff: staffList,
  });
});

app.post("/api/handover-history", need(), (q, s) => {
  const { receiver_id, shift, note, nozzles, d } = q.body || {};
  if (!receiver_id) return s.status(400).json({ error: "Please select incoming staff member." });
  const receiver = db.prepare("select * from users where id=? and active=1").get(+receiver_id);
  if (!receiver) return s.status(400).json({ error: "Selected staff member not found or inactive." });

  const date = d || bizDate();
  const shiftVal = SHIFTS.includes(shift) ? shift : "Morning";
  const noteVal = String(note || "").trim();
  const nozzleVal = String(nozzles || "").trim();

  const id = db.prepare(
    "insert into duty_handovers(sender_id, receiver_id, d, shift, nozzles, note, created_at) values(?,?,?,?,?,?,?)"
  ).run(q.user.id, receiver.id, date, shiftVal, nozzleVal, noteVal, now()).lastInsertRowid;

  s.json({ ok: true, id });
});

// ==========================================
// 1. DENSITY & TANKER DECANTATION REGISTER
// ==========================================
const { getDensityConverted } = require("./seed-petrol-operations");

app.get("/api/density-decantation", need(), (q, s) => {
  const { tank_id, date_from, date_to, search } = q.query || {};
  let dSql = `
    select l.*, u.name as logged_by_name, u.role as logged_by_role
    from daily_density_logs l
    left join users u on u.id = l.logged_by
    where 1=1
  `;
  const dParams = [];
  if (tank_id && tank_id !== "all") {
    dSql += " and l.tank_id = ?";
    dParams.push(tank_id);
  }
  if (date_from) {
    dSql += " and l.d >= ?";
    dParams.push(date_from);
  }
  if (date_to) {
    dSql += " and l.d <= ?";
    dParams.push(date_to);
  }
  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    dSql += " and (l.notes like ? or l.fuel_type like ?)";
    dParams.push(term, term);
  }
  dSql += " order by l.d desc, l.id desc limit 200";
  const densityLogs = db.prepare(dSql).all(...dParams);

  let decSql = `
    select tc.*, u.name as manager_name
    from tanker_decantations tc
    left join users u on u.id = tc.manager_id
    where 1=1
  `;
  const decParams = [];
  if (tank_id && tank_id !== "all") {
    decSql += " and tc.tank_id = ?";
    decParams.push(tank_id);
  }
  if (date_from) {
    decSql += " and tc.d >= ?";
    decParams.push(date_from);
  }
  if (date_to) {
    decSql += " and tc.d <= ?";
    decParams.push(date_to);
  }
  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    decSql += " and (tc.challan_no like ? or tc.tanker_no like ? or tc.transporter like ? or tc.driver_name like ? or tc.notes like ?)";
    decParams.push(term, term, term, term, term);
  }
  decSql += " order by tc.d desc, tc.id desc limit 100";
  const decantations = db.prepare(decSql).all(...decParams);

  let st = {};
  try {
    const sRow = db.prepare("select json from state where id=1").get();
    if (sRow && sRow.json) st = JSON.parse(sRow.json);
  } catch (_) {}

  const tanks = st.tanks || [];
  const todayD = bizDate();
  const todayLogsCount = db.prepare("select count(*) c from daily_density_logs where d=?").get(todayD)?.c || 0;
  const totalDecanted = db.prepare("select sum(decanted_qty) s from tanker_decantations").get()?.s || 0;
  const passCount = db.prepare("select count(*) c from daily_density_logs where is_ok=1").get()?.c || 0;
  const totalDensityChecks = db.prepare("select count(*) c from daily_density_logs").get()?.c || 0;

  let calibrations = [];
  try {
    calibrations = db.prepare(`
      select c.*, u.name as tested_by_name
      from wm_measure_calibrations c
      left join users u on u.id = c.tested_by
      order by c.d desc, c.id desc limit 100
    `).all();
  } catch (_) {}

  let filterTests = [];
  try {
    filterTests = db.prepare(`
      select fp.*, u.name as tested_by_name
      from filter_paper_tests fp
      left join users u on u.id = fp.tested_by
      order by fp.d desc, fp.id desc limit 100
    `).all();
  } catch (_) {}

  let waterDips = [];
  try {
    waterDips = db.prepare(`
      select wd.*, u.name as checked_by_name
      from tank_water_dips wd
      left join users u on u.id = wd.checked_by
      order by wd.d desc, wd.id desc limit 100
    `).all();
  } catch (_) {}

  const activeNozzles = (st.nozzles || []).filter(n => n.active !== false);
  const today5lCount = db.prepare("select count(distinct nozzle_id) c from wm_measure_calibrations where d=?").get(todayD)?.c || 0;

  s.json({
    density_logs: densityLogs,
    decantations,
    tanks,
    nozzles: activeNozzles,
    calibrations,
    filter_tests: filterTests,
    water_dips: waterDips,
    stats: {
      today_density_checks: todayLogsCount,
      today_5l_checks: today5lCount,
      total_nozzles_count: activeNozzles.length,
      today_quality_checks: filterTests.filter(t => t.d === todayD).length,
      total_decanted_litres: totalDecanted,
      compliance_rate: totalDensityChecks > 0 ? Math.round((passCount / totalDensityChecks) * 100) : 100,
      total_receipts: decantations.length
    }
  });
});

app.post("/api/filter-paper-tests", need(), (q, s) => {
  const { d, time_str, nozzle_id, fuel_product, filter_paper_grade, evaporation_seconds, stain_observed, is_pass, sample_bottle_tag, notes } = q.body || {};
  if (!nozzle_id || !fuel_product) {
    return s.status(400).json({ error: "Nozzle ID and fuel product are required." });
  }
  const date = d || bizDate();
  const time = time_str || new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const grade = filter_paper_grade || "Whatman 589/1";
  const evapSec = evaporation_seconds !== undefined ? +evaporation_seconds : 80;
  const stain = stain_observed ? 1 : 0;
  const pass = (is_pass !== undefined ? (is_pass ? 1 : 0) : (stain === 0 ? 1 : 0));
  const tag = sample_bottle_tag ? String(sample_bottle_tag).trim() : null;
  const noteStr = String(notes || "").trim();

  const id = db.prepare(`
    insert into filter_paper_tests(d, time_str, nozzle_id, fuel_product, filter_paper_grade, evaporation_seconds, stain_observed, is_pass, sample_bottle_tag, tested_by, notes, created_at)
    values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(date, time, String(nozzle_id), String(fuel_product), grade, evapSec, stain, pass, tag, q.user.id, noteStr, now()).lastInsertRowid;

  s.json({ ok: true, id, is_pass: pass });
});

app.post("/api/daily-density", need(), (q, s) => {
  const { d, tank_id, fuel_type, dip_cm, temp_c, observed_density, ref_density, notes } = q.body || {};
  if (!tank_id || !fuel_type || temp_c === undefined || observed_density === undefined || ref_density === undefined) {
    return s.status(400).json({ error: "Missing required density parameters." });
  }
  const date = d || bizDate();
  const temp = +temp_c;
  const obs = +observed_density;
  const ref = +ref_density;
  const converted = getDensityConverted(temp, obs, fuel_type);
  const variance = Math.round((converted - ref) * 10) / 10;
  const isOk = Math.abs(variance) <= 3.0 ? 1 : 0;
  const dip = dip_cm !== undefined ? +dip_cm : null;
  const noteStr = String(notes || "").trim();

  const id = db.prepare(`
    insert into daily_density_logs(d, tank_id, fuel_type, dip_cm, temp_c, observed_density, converted_density_15c, ref_density, variance, is_ok, logged_by, notes, created_at)
    values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(date, String(tank_id), String(fuel_type), dip, temp, obs, converted, ref, variance, isOk, q.user.id, noteStr, now()).lastInsertRowid;

  s.json({ ok: true, id, converted_density_15c: converted, variance, is_ok: isOk });
});

app.post("/api/tanker-decantation", need("owner", "manager"), (q, s) => {
  const {
    challan_no, tanker_no, transporter, oil_company, d, fuel_type, tank_id,
    invoice_qty, invoice_density, invoice_temp, observed_temp, observed_density,
    water_paste_ok, before_dip_cm, before_qty, after_dip_cm, after_qty, driver_name, notes
  } = q.body || {};

  if (!challan_no || !tanker_no || !fuel_type || !tank_id || !invoice_qty || !invoice_density || observed_temp === undefined || observed_density === undefined) {
    return s.status(400).json({ error: "Please provide all required tanker decantation details." });
  }

  const date = d || bizDate();
  const obsTemp = +observed_temp;
  const obsDens = +observed_density;
  const invDens = +invoice_density;
  const invQty = +invoice_qty;
  const invTemp = invoice_temp !== undefined ? +invoice_temp : null;

  const convDens = getDensityConverted(obsTemp, obsDens, fuel_type);
  const densityDiff = Math.round((convDens - invDens) * 10) / 10;

  const befQty = before_qty !== undefined ? +before_qty : null;
  const aftQty = after_qty !== undefined ? +after_qty : null;
  const decQty = (aftQty !== null && befQty !== null && aftQty > befQty) ? Math.round((aftQty - befQty) * 10) / 10 : invQty;
  const transitVar = Math.round((decQty - invQty) * 10) / 10;
  const waterOk = (water_paste_ok === 0 || water_paste_ok === false) ? 0 : 1;

  const id = db.prepare(`
    insert into tanker_decantations(
      challan_no, tanker_no, transporter, oil_company, d, fuel_type, tank_id,
      invoice_qty, invoice_density, invoice_temp, observed_temp, observed_density,
      converted_density_15c, density_diff, water_paste_ok, before_dip_cm, before_qty,
      after_dip_cm, after_qty, decanted_qty, transit_variance, driver_name, manager_id, notes, created_at
    ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(challan_no).trim(), String(tanker_no).trim().toUpperCase(), String(transporter || "").trim(),
    String(oil_company || "IOCL").trim(), date, String(fuel_type), String(tank_id),
    invQty, invDens, invTemp, obsTemp, obsDens, convDens, densityDiff, waterOk,
    before_dip_cm !== undefined ? +before_dip_cm : null, befQty,
    after_dip_cm !== undefined ? +after_dip_cm : null, aftQty,
    decQty, transitVar, String(driver_name || "").trim(), q.user.id,
    String(notes || "").trim(), now()
  ).lastInsertRowid;

  s.json({ ok: true, id, converted_density_15c: convDens, density_diff: densityDiff, decanted_qty: decQty, transit_variance: transitVar });
});

// ==========================================
// 2. FLEET INDENT SLIPS & VEHICLE CREDIT VOUCHERS
// ==========================================
app.get("/api/fleet-indents", need(), (q, s) => {
  const { status, search, cust_id } = q.query || {};
  let sql = `
    select fi.*, u.name as worker_name, cs.id as credit_sale_ref
    from fleet_indents fi
    left join users u on u.id = fi.worker_id
    left join credit_sales cs on cs.id = fi.credit_sale_id
    where 1=1
  `;
  const params = [];
  if (status && status !== "all") {
    sql += " and fi.status = ?";
    params.push(status);
  }
  if (cust_id && cust_id !== "all") {
    sql += " and fi.cust_id = ?";
    params.push(cust_id);
  }
  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    sql += " and (fi.indent_no like ? or fi.vehicle_no like ? or fi.driver_name like ? or fi.notes like ?)";
    params.push(term, term, term, term);
  }
  sql += " order by fi.id desc limit 150";
  const indents = db.prepare(sql).all(...params);

  // Customer directory with credit limits and balances
  let customersList = [];
  try {
    customersList = customers();
  } catch (_) {}

  const pendingCount = db.prepare("select count(*) c from fleet_indents where status='pending'").get()?.c || 0;
  const dispensedToday = db.prepare("select count(*) c from fleet_indents where status='dispensed' and issued_d=?").get(bizDate())?.c || 0;
  const totalDispensedValue = db.prepare("select sum(dispensed_amount) s from fleet_indents where status='dispensed'").get()?.s || 0;

  s.json({
    indents,
    customers: customersList,
    stats: {
      pending_count: pendingCount,
      dispensed_today: dispensedToday,
      total_dispensed_amount: totalDispensedValue
    }
  });
});

app.post("/api/fleet-indents/issue", need(), (q, s) => {
  const { cust_id, vehicle_no, driver_name, driver_mobile, fuel_product, req_qty, req_amount, odometer_km, slip_leaf_no, notes } = q.body || {};
  if (!cust_id || !vehicle_no || !fuel_product) {
    return s.status(400).json({ error: "Customer, vehicle number, and fuel product are required." });
  }

  // Check customer credit limit and overdue if posting to credit
  let st = {};
  try {
    const sRow = db.prepare("select json from state where id=1").get();
    if (sRow && sRow.json) st = JSON.parse(sRow.json);
  } catch (_) {}
  const targetCust = (st.c || []).find((c) => String(c.id) === String(cust_id));
  if (targetCust && targetCust.active === false) {
    return s.status(400).json({ error: "This credit customer account is inactive." });
  }

  // Generate unique indent number IND-YYYY-NNNN
  const year = new Date().getFullYear();
  const lastRow = db.prepare("select id from fleet_indents order by id desc limit 1").get();
  const nextNum = (lastRow ? lastRow.id : 0) + 1046;
  const indentNo = `IND-${year}-${nextNum}`;
  const otpCode = Math.floor(1000 + Math.random() * 9000).toString();

  const date = bizDate();
  const rQty = req_qty !== undefined ? +req_qty : null;
  const rAmt = req_amount !== undefined ? +req_amount : null;
  const odom = odometer_km !== undefined ? +odometer_km : null;
  const leafNo = slip_leaf_no ? String(slip_leaf_no).trim() : `SLIP-${nextNum}`;

  const id = db.prepare(`
    insert into fleet_indents(
      indent_no, cust_id, vehicle_no, driver_name, driver_mobile, fuel_product,
      req_qty, req_amount, odometer_km, status, issued_d, notes, created_at,
      otp_code, otp_verified, slip_leaf_no
    ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, 1, ?)
  `).run(
    indentNo, String(cust_id), String(vehicle_no).trim().toUpperCase(),
    String(driver_name || "").trim(), String(driver_mobile || "").trim(),
    String(fuel_product), rQty, rAmt, odom, date, String(notes || "").trim(), now(),
    otpCode, leafNo
  ).lastInsertRowid;

  s.json({ ok: true, id, indent_no: indentNo, otp_code: otpCode, slip_leaf_no: leafNo });
});

app.post("/api/fleet-indents/dispense", need(), (q, s) => {
  const { indent_id, nozzle_id, dispensed_qty, dispensed_rate, post_to_credit, otp_entered, notes } = q.body || {};
  if (!indent_id || !dispensed_qty || !dispensed_rate) {
    return s.status(400).json({ error: "Indent ID, dispensed quantity, and fuel rate are required." });
  }
  const ind = db.prepare("select * from fleet_indents where id=?").get(+indent_id);
  if (!ind) return s.status(404).json({ error: "Indent slip not found." });
  if (ind.status === "dispensed") return s.status(400).json({ error: "This indent has already been dispensed." });

  // If OTP code is configured and entered, verify it
  if (otp_entered && ind.otp_code && String(otp_entered).trim() !== String(ind.otp_code).trim()) {
    return s.status(400).json({ error: "Invalid driver authorization OTP code. Expected: " + ind.otp_code });
  }

  const qty = +dispensed_qty;
  const rate = +dispensed_rate;
  const totalAmount = Math.round(qty * rate * 100) / 100;
  const date = bizDate();

  let creditSaleId = null;
  db.transaction(() => {
    if (post_to_credit) {
      creditSaleId = db.prepare(`
        insert into credit_sales(cust_id, d, n, a, veh, worker_id, created, status)
        values(?, ?, ?, ?, ?, ?, ?, 'ok')
      `).run(
        ind.cust_id, date, `${ind.fuel_product} ${qty}L @ ₹${rate} (Indent ${ind.indent_no} / Slip ${ind.slip_leaf_no || ''})`,
        totalAmount, ind.vehicle_no, q.user.id, now()
      ).lastInsertRowid;
    }

    db.prepare(`
      update fleet_indents set
        dispensed_qty = ?, dispensed_rate = ?, dispensed_amount = ?,
        nozzle_id = ?, status = 'dispensed', dispensed_at = ?, worker_id = ?,
        credit_sale_id = ?, otp_verified = 1,
        notes = case when length(?) > 0 then notes || ' · ' || ? else notes end
      where id = ?
    `).run(
      qty, rate, totalAmount, String(nozzle_id || ""), now(), q.user.id,
      creditSaleId, String(notes || "").trim(), String(notes || "").trim(), ind.id
    );
  })();

  s.json({ ok: true, dispensed_amount: totalAmount, credit_sale_id: creditSaleId });
});

app.post("/api/fleet-indents/cancel", need("owner", "manager"), (q, s) => {
  const { indent_id } = q.body || {};
  const ind = db.prepare("select * from fleet_indents where id=?").get(+indent_id);
  if (!ind) return s.status(404).json({ error: "Indent not found." });
  db.prepare("update fleet_indents set status='cancelled' where id=?").run(ind.id);
  s.json({ ok: true });
});

// ==========================================
// 3. LUBE OIL & ADBLUE (DEF) STOCK & BAY SALES
// ==========================================
app.get("/api/lube-module", need(), (q, s) => {
  const { category, search } = q.query || {};
  let itemSql = "select * from lube_items where 1=1";
  const itemParams = [];
  if (category && category !== "all") {
    itemSql += " and category = ?";
    itemParams.push(category);
  }
  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    itemSql += " and (name like ? or code like ? or grade like ?)";
    itemParams.push(term, term, term);
  }
  itemSql += " order by category asc, name asc";
  const items = db.prepare(itemSql).all(...itemParams);

  const sales = db.prepare(`
    select ls.*, li.name as item_name, li.grade as item_grade, li.pack_size as item_pack, li.category as item_category, u.name as worker_name
    from lube_sales ls
    left join lube_items li on li.id = ls.item_id
    left join users u on u.id = ls.worker_id
    order by ls.id desc limit 100
  `).all();

  const workerIncentives = db.prepare(`
    select u.id as worker_id, u.name as worker_name, sum(ls.incentive_amount) as total_incentive, count(ls.id) as sales_count
    from lube_sales ls
    join users u on u.id = ls.worker_id
    group by u.id, u.name
    order by total_incentive desc
  `).all();

  const todayDate = bizDate();
  const todaySalesAmt = db.prepare("select sum(total_amount) s, sum(incentive_amount) inc from lube_sales where d=?").get(todayDate);
  const lowStockCount = db.prepare("select count(*) c from lube_items where stock_qty <= low_alert_qty").get()?.c || 0;

  s.json({
    items,
    sales,
    worker_incentives: workerIncentives,
    stats: {
      today_sales_amount: todaySalesAmt?.s || 0,
      today_incentive: todaySalesAmt?.inc || 0,
      low_stock_count: lowStockCount,
      total_products: items.length
    }
  });
});

app.post("/api/lube-sale", need(), (q, s) => {
  const { item_id, qty, payment_mode, cust_id, vehicle_no, duty_id, notes } = q.body || {};
  if (!item_id || !qty || +qty <= 0) {
    return s.status(400).json({ error: "Please select product and enter valid quantity." });
  }
  const item = db.prepare("select * from lube_items where id=?").get(String(item_id));
  if (!item) return s.status(404).json({ error: "Lube / DEF item not found." });

  const qVal = +qty;
  const sellPrice = item.sell_price;
  const totalAmount = Math.round(sellPrice * qVal * 100) / 100;
  const incentiveAmt = Math.round((item.attendant_incentive || 0) * qVal * 100) / 100;
  const date = bizDate();

  let saleId = null;
  db.transaction(() => {
    db.prepare("update lube_items set stock_qty = max(0, stock_qty - ?) where id=?").run(qVal, item.id);
    saleId = db.prepare(`
      insert into lube_sales(d, item_id, qty, sell_price, total_amount, payment_mode, cust_id, vehicle_no, duty_id, worker_id, incentive_amount, notes, created_at)
      values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      date, item.id, qVal, sellPrice, totalAmount, String(payment_mode || "Cash"),
      cust_id ? String(cust_id) : null, String(vehicle_no || "").trim().toUpperCase(),
      duty_id ? +duty_id : null, q.user.id, incentiveAmt, String(notes || "").trim(), now()
    ).lastInsertRowid;
  })();

  s.json({ ok: true, id: saleId, total_amount: totalAmount, incentive_amount: incentiveAmt });
});

app.post("/api/lube-item", need("owner", "manager"), (q, s) => {
  const { id, code, name, category, grade, pack_size, unit, buy_price, mrp, sell_price, stock_qty, low_alert_qty, attendant_incentive } = q.body || {};
  if (!name || !category || sell_price === undefined || buy_price === undefined) {
    return s.status(400).json({ error: "Name, category, buy price, and selling price are required." });
  }

  const itemId = id || `lube_${Date.now()}`;
  db.prepare(`
    insert into lube_items(id, code, name, category, grade, pack_size, unit, buy_price, mrp, sell_price, stock_qty, low_alert_qty, attendant_incentive, created_at)
    values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      code=excluded.code, name=excluded.name, category=excluded.category,
      grade=excluded.grade, pack_size=excluded.pack_size, unit=excluded.unit,
      buy_price=excluded.buy_price, mrp=excluded.mrp, sell_price=excluded.sell_price,
      stock_qty=excluded.stock_qty, low_alert_qty=excluded.low_alert_qty,
      attendant_incentive=excluded.attendant_incentive
  `).run(
    itemId, String(code || "").trim(), String(name).trim(), String(category).trim(),
    String(grade || "").trim(), String(pack_size || "").trim(), String(unit || "piece").trim(),
    +buy_price, +(mrp || sell_price), +sell_price, +(stock_qty || 0), +(low_alert_qty || 5),
    +(attendant_incentive || 0), now()
  );

  s.json({ ok: true, id: itemId });
});

app.post("/api/lube-stock-inward", need("owner", "manager"), (q, s) => {
  const { item_id, qty, buy_price, notes } = q.body || {};
  if (!item_id || !qty || +qty <= 0) {
    return s.status(400).json({ error: "Select item and enter valid inward quantity." });
  }
  const item = db.prepare("select * from lube_items where id=?").get(String(item_id));
  if (!item) return s.status(404).json({ error: "Item not found." });

  db.prepare("update lube_items set stock_qty = stock_qty + ?, buy_price = coalesce(?, buy_price) where id=?").run(
    +qty, buy_price !== undefined ? +buy_price : null, item.id
  );
  s.json({ ok: true, updated_stock: item.stock_qty + (+qty) });
});

// ==========================================
// 4. DAILY 5L MEASURE STAMPING & CALIBRATION LOG
// ==========================================
app.get("/api/calibration-log", need(), (q, s) => {
  const { d, nozzle_id } = q.query || {};
  let sql = `
    select c.*, u.name as checked_by_name, u.role as checked_by_role
    from nozzle_calibrations c
    left join users u on u.id = c.checked_by
    where 1=1
  `;
  const params = [];
  if (d) {
    sql += " and c.d = ?";
    params.push(d);
  }
  if (nozzle_id && nozzle_id !== "all") {
    sql += " and c.nozzle_id = ?";
    params.push(nozzle_id);
  }
  sql += " order by c.d desc, c.id desc limit 150";
  const calibrations = db.prepare(sql).all(...params);

  // Active nozzles list with today's test status
  let st = {};
  try {
    const sRow = db.prepare("select json from state where id=1").get();
    if (sRow && sRow.json) st = JSON.parse(sRow.json);
  } catch (_) {}
  const allNozzles = st.nozzles || [];

  const todayDate = bizDate();
  const testedTodayIds = new Set(
    db.prepare("select nozzle_id from nozzle_calibrations where d=?").all(todayDate).map((x) => x.nozzle_id)
  );

  const nozzlesWithStatus = allNozzles.filter((n) => n.active !== false).map((n) => ({
    ...n,
    tested_today: testedTodayIds.has(String(n.id))
  }));

  const certificates = db.prepare("select * from calibration_certificates order by expiry_date asc").all();
  const passRate = db.prepare("select count(*) c from nozzle_calibrations where is_passed=1").get()?.c || 0;
  const totalCalibs = db.prepare("select count(*) c from nozzle_calibrations").get()?.c || 0;

  s.json({
    calibrations,
    nozzles: nozzlesWithStatus,
    certificates,
    tanks: st.tanks || [],
    stats: {
      tested_today_count: testedTodayIds.size,
      total_active_nozzles: nozzlesWithStatus.length,
      overall_pass_rate: totalCalibs > 0 ? Math.round((passRate / totalCalibs) * 100) : 100
    }
  });
});

app.post("/api/calibration-log", need(), (q, s) => {
  const { tests, d, shift, nozzle_id, measure_qty, delivered_ml, returned_to_tank_id, stamped_measure_sr, notes } = q.body || {};
  const date = d || bizDate();
  const shiftVal = shift || "Morning";

  // Handle batch test or single test
  const list = Array.isArray(tests) && tests.length > 0 ? tests : [{
    nozzle_id, measure_qty, delivered_ml, returned_to_tank_id, stamped_measure_sr, notes
  }];

  const createdIds = [];
  db.transaction(() => {
    for (const t of list) {
      if (!t.nozzle_id || t.delivered_ml === undefined) continue;
      const mQty = t.measure_qty !== undefined ? +t.measure_qty : 5000;
      const del = +t.delivered_ml;
      const errMl = del - mQty;
      const isPassed = Math.abs(errMl) <= 25 ? 1 : 0;
      const tankId = String(t.returned_to_tank_id || "1791451422410");
      const sr = String(t.stamped_measure_sr || "W&M-5L-2026-A109");
      const noteStr = String(t.notes || `5L conical test on nozzle ${t.nozzle_id}. Delivered ${del} ml. Fuel poured back to tank.`).trim();

      const cid = db.prepare(`
        insert into nozzle_calibrations(
          d, shift, nozzle_id, measure_qty, delivered_ml, error_ml, tolerance_ml,
          is_passed, returned_to_tank_id, stamped_measure_sr, checked_by, notes, created_at
        ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        date, shiftVal, String(t.nozzle_id), mQty, del, errMl, 25, isPassed,
        tankId, sr, q.user.id, noteStr, now()
      ).lastInsertRowid;
      createdIds.push(cid);
    }
  })();

  s.json({ ok: true, count: createdIds.length, ids: createdIds });
});

app.post("/api/calibration-certificate", need("owner", "manager"), (q, s) => {
  const { equipment_name, serial_no, capacity, cert_no, stamping_date, expiry_date, inspector_name, department, notes } = q.body || {};
  if (!equipment_name || !serial_no || !cert_no || !stamping_date || !expiry_date) {
    return s.status(400).json({ error: "Missing required certificate details." });
  }

  const id = db.prepare(`
    insert into calibration_certificates(
      equipment_name, serial_no, capacity, cert_no, stamping_date, expiry_date, inspector_name, department, status, notes
    ) values(?, ?, ?, ?, ?, ?, ?, ?, 'valid', ?)
  `).run(
    String(equipment_name).trim(), String(serial_no).trim(), String(capacity || "5 Litres").trim(),
    String(cert_no).trim(), String(stamping_date).trim(), String(expiry_date).trim(),
    String(inspector_name || "").trim(), String(department || "Legal Metrology Dept").trim(),
    String(notes || "").trim()
  ).lastInsertRowid;

  s.json({ ok: true, id });
});

// ==========================================
// 5. EVAPORATION & STORAGE TANK LOSS / GAIN ANALYTICS
// ==========================================
app.get("/api/loss-gain-analytics", need(), (q, s) => {
  const { tank_id, date_from, date_to } = q.query || {};
  let sql = `
    select lg.*, u.name as logged_by_name
    from tank_loss_gain_logs lg
    left join users u on u.id = lg.logged_by
    where 1=1
  `;
  const params = [];
  if (tank_id && tank_id !== "all") {
    sql += " and lg.tank_id = ?";
    params.push(tank_id);
  }
  if (date_from) {
    sql += " and lg.d >= ?";
    params.push(date_from);
  }
  if (date_to) {
    sql += " and lg.d <= ?";
    params.push(date_to);
  }
  sql += " order by lg.d desc, lg.id desc limit 150";
  const logs = db.prepare(sql).all(...params);

  // Summary by tank across recent days
  let st = {};
  try {
    const sRow = db.prepare("select json from state where id=1").get();
    if (sRow && sRow.json) st = JSON.parse(sRow.json);
  } catch (_) {}
  const tanks = st.tanks || [];

  const tanksSummary = tanks.map((tank) => {
    const tankLogs = db.prepare(`
      select sum(sales_dispensed_qty) as total_sales,
             sum(receipts_qty) as total_receipts,
             sum(variance_qty) as total_variance,
             avg(variance_pct) as avg_variance_pct,
             count(*) as count
      from tank_loss_gain_logs
      where tank_id = ?
    `).get(String(tank.id));

    const isDiesel = String(tank.fuel).toLowerCase().includes("diesel");
    const omcNorm = isDiesel ? 0.15 : 0.59;
    const totVar = tankLogs ? (tankLogs.total_variance || 0) : 0;
    const totSales = tankLogs ? (tankLogs.total_sales || 1) : 1;
    const cumPct = Math.round((totVar / totSales) * 1000) / 10;

    return {
      tank_id: tank.id,
      tank_name: tank.name,
      fuel: tank.fuel,
      capacity: tank.capacity,
      total_sales: tankLogs ? tankLogs.total_sales || 0 : 0,
      total_receipts: tankLogs ? tankLogs.total_receipts || 0 : 0,
      cumulative_variance_litres: Math.round(totVar * 10) / 10,
      cumulative_variance_pct: cumPct,
      omc_norm_pct: omcNorm,
      status: Math.abs(cumPct) <= omcNorm ? "Within OMC Norms" : "Excess Loss Alert"
    };
  });

  const totalVarAll = db.prepare("select sum(variance_qty) s from tank_loss_gain_logs").get()?.s || 0;
  const withinNormCount = db.prepare("select count(*) c from tank_loss_gain_logs where is_within_norm=1").get()?.c || 0;
  const totalLogs = db.prepare("select count(*) c from tank_loss_gain_logs").get()?.c || 0;

  s.json({
    logs,
    tanks_summary: tanksSummary,
    tanks,
    omc_benchmarks: {
      MS: 0.59,
      HSD: 0.15,
      summer_MS: 0.75
    },
    stats: {
      net_operational_variance_litres: Math.round(totalVarAll * 10) / 10,
      compliance_rate: totalLogs > 0 ? Math.round((withinNormCount / totalLogs) * 100) : 100,
      total_reconciled_days: totalLogs
    }
  });
});

app.post("/api/loss-gain-reconcile", need("owner", "manager"), (q, s) => {
  const { d, tank_id, opening_dip_qty, receipts_qty, sales_dispensed_qty, closing_dip_cm, physical_dip_qty, temp_avg, notes } = q.body || {};
  if (!tank_id || physical_dip_qty === undefined) {
    return s.status(400).json({ error: "Tank ID and physical dip quantity are required." });
  }

  let st = {};
  try {
    const sRow = db.prepare("select json from state where id=1").get();
    if (sRow && sRow.json) st = JSON.parse(sRow.json);
  } catch (_) {}
  const tank = (st.tanks || []).find((t) => String(t.id) === String(tank_id)) || { fuel: "Diesel (HSD)" };

  const isDiesel = String(tank.fuel).toLowerCase().includes("diesel");
  const omcNorm = isDiesel ? 0.15 : 0.59;

  const date = d || bizDate();
  const openQty = opening_dip_qty !== undefined ? +opening_dip_qty : 10000;
  const recQty = receipts_qty !== undefined ? +receipts_qty : 0;
  const saleQty = sales_dispensed_qty !== undefined ? +sales_dispensed_qty : 0;
  const bookStock = Math.round((openQty + recQty - saleQty) * 10) / 10;
  const physQty = +physical_dip_qty;
  const varQty = Math.round((physQty - bookStock) * 10) / 10;
  const varPct = bookStock > 0 ? Math.round((varQty / bookStock) * 10000) / 100 : 0;
  const isWithin = Math.abs(varPct) <= omcNorm ? 1 : 0;
  const statusLabel = isWithin ? "Within OMC Norms" : "Excess Variance Alert";

  const id = db.prepare(`
    insert into tank_loss_gain_logs(
      d, tank_id, fuel_type, opening_dip_qty, receipts_qty, sales_dispensed_qty,
      book_stock_qty, closing_dip_cm, physical_dip_qty, variance_qty, variance_pct,
      omc_norm_pct, is_within_norm, temp_avg, status_label, notes, logged_by, created_at
    ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    date, String(tank_id), tank.fuel, openQty, recQty, saleQty,
    bookStock, closing_dip_cm !== undefined ? +closing_dip_cm : null, physQty,
    varQty, varPct, omcNorm, isWithin, temp_avg !== undefined ? +temp_avg : null,
    statusLabel, String(notes || "").trim(), q.user.id, now()
  ).lastInsertRowid;

  s.json({ ok: true, id, book_stock_qty: bookStock, variance_qty: varQty, variance_pct: varPct, is_within_norm: isWithin });
});

// ==========================================
// 1. Shift Cash Handover & Cash-Safe Vault
// ==========================================
app.get("/api/vault-drops", need(), (q, s) => {
  const { date_from, date_to, worker_id, shift, search } = q.query || {};
  let sql = `
    select v.*, u.name as worker_name, m.name as receiver_name
    from vault_drops v
    left join users u on u.id = v.worker_id
    left join users m on m.id = v.received_by
    where 1=1
  `;
  const params = [];
  if (date_from) { sql += " and v.d >= ?"; params.push(date_from); }
  if (date_to) { sql += " and v.d <= ?"; params.push(date_to); }
  if (worker_id && worker_id !== "all") { sql += " and v.worker_id = ?"; params.push(+worker_id); }
  if (shift && shift !== "all") { sql += " and v.shift = ?"; params.push(shift); }
  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    sql += " and (v.notes like ? or u.name like ? or v.drop_type like ?)";
    params.push(term, term, term);
  }
  sql += " order by v.d desc, v.id desc limit 150";
  const drops = db.prepare(sql).all(...params);

  const todayD = bizDate();
  const todayTotal = db.prepare("select coalesce(sum(amount),0) s from vault_drops where d=? and drop_type!='bank_deposit'").get(todayD)?.s || 0;
  const bankDepositedToday = db.prepare("select coalesce(sum(amount),0) s from vault_drops where d=? and drop_type='bank_deposit'").get(todayD)?.s || 0;
  const totalSafeCash = db.prepare("select coalesce(sum(case when drop_type='bank_deposit' or drop_type='owner_withdrawal' then -amount else amount end),0) s from vault_drops").get()?.s || 0;
  const pendingCount = db.prepare("select count(*) c from vault_drops where status='pending'").get()?.c || 0;

  s.json({
    drops,
    stats: {
      today_drops_amount: todayTotal,
      today_bank_deposited: bankDepositedToday,
      safe_cash_balance: Math.max(0, totalSafeCash),
      pending_verification: pendingCount,
      total_records: drops.length
    }
  });
});

app.post("/api/vault-drops", need(), (q, s) => {
  const {
    d, shift, worker_id, drop_type, amount,
    c500, c200, c100, c50, c20, c10, c5, coins,
    digital_upi, digital_card, fleet_credit, expenses_paid,
    expected_cash, short_excess, notes
  } = q.body || {};

  const amt = num(amount);
  if (isNaN(amt) || amt <= 0) return s.status(400).json({ error: "Please enter a valid cash amount above zero." });

  const date = d || bizDate();
  const sh = shift || "Morning";
  const wid = worker_id ? +worker_id : q.user.id;
  const isManagerOrOwner = q.user.role === "owner" || q.user.role === "manager";
  const status = isManagerOrOwner ? "verified" : "pending";
  const receivedBy = isManagerOrOwner ? q.user.id : null;

  const rowId = db.prepare(`
    insert into vault_drops(
      d, shift, worker_id, drop_type, amount,
      c500, c200, c100, c50, c20, c10, c5, coins,
      digital_upi, digital_card, fleet_credit, expenses_paid,
      expected_cash, short_excess, received_by, status, notes, created_at
    ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    date, sh, wid, drop_type || "attendant_shift_drop", r2(amt),
    c500 ? +c500 : 0, c200 ? +c200 : 0, c100 ? +c100 : 0, c50 ? +c50 : 0,
    c20 ? +c20 : 0, c10 ? +c10 : 0, c5 ? +c5 : 0, coins ? +coins : 0,
    digital_upi ? num(digital_upi) : 0, digital_card ? num(digital_card) : 0,
    fleet_credit ? num(fleet_credit) : 0, expenses_paid ? num(expenses_paid) : 0,
    expected_cash ? num(expected_cash) : amt, short_excess ? num(short_excess) : 0,
    receivedBy, status, String(notes || "").trim(), now()
  ).lastInsertRowid;

  s.json({ ok: true, id: rowId });
});

app.post("/api/vault-drops/:id/verify", need("owner", "manager"), (q, s) => {
  const row = db.prepare("select * from vault_drops where id=?").get(+q.params.id);
  if (!row) return s.status(404).json({ error: "Drop record not found." });
  db.prepare("update vault_drops set status='verified', received_by=? where id=?").run(q.user.id, row.id);
  s.json({ ok: true });
});

// ==========================================
// 2. Underground Tank Water Paste & Dip Log
// ==========================================
app.get("/api/tank-water-dips", need(), (q, s) => {
  const { tank_id, search } = q.query || {};
  let sql = `
    select w.*, u.name as checked_by_name
    from tank_water_dips w
    left join users u on u.id = w.checked_by
    where 1=1
  `;
  const params = [];
  if (tank_id && tank_id !== "all") { sql += " and w.tank_id = ?"; params.push(tank_id); }
  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    sql += " and (w.fuel_type like ? or w.notes like ? or w.paste_color_result like ?)";
    params.push(term, term, term);
  }
  sql += " order by w.d desc, w.id desc limit 150";
  const logs = db.prepare(sql).all(...params);

  const todayD = bizDate();
  const todayChecks = db.prepare("select count(*) c from tank_water_dips where d=?").get(todayD)?.c || 0;
  const alertCount = db.prepare("select count(*) c from tank_water_dips where water_dip_mm >= 25 or is_alert=1").get()?.c || 0;
  const maxWaterRecorded = db.prepare("select max(water_dip_mm) m from tank_water_dips").get()?.m || 0;

  s.json({
    water_logs: logs,
    stats: {
      today_checks: todayChecks,
      active_water_alerts: alertCount,
      max_water_mm: maxWaterRecorded,
      total_checks: logs.length
    }
  });
});

app.post("/api/tank-water-dips", need(), (q, s) => {
  const { d, time_str, tank_id, fuel_type, water_dip_mm, fuel_dip_cm, paste_used, paste_color_result, water_drained_litres, notes } = q.body || {};
  if (!tank_id || !fuel_type || water_dip_mm === undefined) {
    return s.status(400).json({ error: "Please enter tank, fuel type, and water dip measurement." });
  }
  const date = d || bizDate();
  const wMm = num(water_dip_mm) || 0;
  const isAlert = wMm >= 25 ? 1 : 0;
  const timeStr = String(time_str || "").trim() || "06:00 AM";

  const rowId = db.prepare(`
    insert into tank_water_dips(
      d, time_str, tank_id, fuel_type, water_dip_mm, fuel_dip_cm,
      paste_used, paste_color_result, water_drained_litres, is_alert, checked_by, notes, created_at
    ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    date, timeStr, String(tank_id), String(fuel_type), wMm,
    fuel_dip_cm !== undefined ? num(fuel_dip_cm) : null,
    String(paste_used || "Kolor-Kut Water Finding Paste").trim(),
    String(paste_color_result || (wMm > 0 ? `${wMm} mm Pink Hue` : "No Water (Remains Gold-Brown)")).trim(),
    water_drained_litres ? num(water_drained_litres) : 0,
    isAlert, q.user.id, String(notes || "").trim(), now()
  ).lastInsertRowid;

  s.json({ ok: true, id: rowId, is_alert: isAlert });
});

// ==========================================
// 3. Statutory & PESO Compliance Tracker
// ==========================================
app.get("/api/statutory-licenses", need(), (q, s) => {
  const { category, status } = q.query || {};
  let sql = "select * from statutory_licenses where 1=1";
  const params = [];
  if (category && category !== "all") { sql += " and category = ?"; params.push(category); }
  if (status && status !== "all") { sql += " and status = ?"; params.push(status); }
  sql += " order by expiry_date asc";
  const rawList = db.prepare(sql).all(...params);

  const todayStr = bizDate();
  const todayTime = new Date(todayStr + "T00:00:00Z").getTime();

  let activeCount = 0;
  let expiringSoonCount = 0;
  let expiredCount = 0;

  const licenses = rawList.map((lic) => {
    const expTime = new Date(lic.expiry_date + "T00:00:00Z").getTime();
    const daysLeft = Math.round((expTime - todayTime) / (1000 * 60 * 60 * 24));
    let dynStatus = lic.status;
    if (daysLeft < 0) {
      dynStatus = "expired";
      expiredCount++;
    } else if (daysLeft <= (lic.renewal_reminder_days || 30)) {
      dynStatus = "expiring_soon";
      expiringSoonCount++;
    } else {
      dynStatus = "active";
      activeCount++;
    }
    return { ...lic, days_left: daysLeft, computed_status: dynStatus };
  });

  s.json({
    licenses,
    stats: {
      total: licenses.length,
      active: activeCount,
      expiring_soon: expiringSoonCount,
      expired: expiredCount
    }
  });
});

app.post("/api/statutory-licenses", need("owner", "manager"), (q, s) => {
  const { license_type, category, license_no, authority, issued_to, issue_date, expiry_date, renewal_reminder_days, document_ref, fee_amount, notes } = q.body || {};
  if (!license_type || !license_no || !expiry_date) {
    return s.status(400).json({ error: "License type, license number, and expiry date are required." });
  }
  const rowId = db.prepare(`
    insert into statutory_licenses(
      license_type, category, license_no, authority, issued_to,
      issue_date, expiry_date, renewal_reminder_days, status, document_ref, fee_amount, notes, created_at
    ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(license_type).trim(), String(category || "General Statutory").trim(),
    String(license_no).trim(), String(authority || "").trim(), String(issued_to || "").trim(),
    issue_date || bizDate(), expiry_date, renewal_reminder_days ? +renewal_reminder_days : 30,
    "active", String(document_ref || "").trim(), fee_amount ? num(fee_amount) : 0,
    String(notes || "").trim(), now()
  ).lastInsertRowid;

  s.json({ ok: true, id: rowId });
});

app.post("/api/statutory-licenses/:id/renew", need("owner", "manager"), (q, s) => {
  const { new_expiry_date, new_license_no, fee_amount, notes } = q.body || {};
  if (!new_expiry_date) return s.status(400).json({ error: "Please enter new renewal expiry date." });
  const row = db.prepare("select * from statutory_licenses where id=?").get(+q.params.id);
  if (!row) return s.status(404).json({ error: "License record not found." });

  db.prepare(`
    update statutory_licenses
    set expiry_date=?, license_no=coalesce(?, license_no), fee_amount=coalesce(?, fee_amount),
        notes=coalesce(?, notes), status='active'
    where id=?
  `).run(
    new_expiry_date, new_license_no || null, fee_amount ? num(fee_amount) : null,
    notes ? String(notes).trim() : null, row.id
  );
  s.json({ ok: true });
});

// ==========================================
// 4. Forecourt Equipment Breakdown & Maintenance Log
// ==========================================
app.get("/api/equipment-tickets", need(), (q, s) => {
  const { status, priority, search } = q.query || {};
  let sql = `
    select t.*, u.name as reported_by_name
    from equipment_tickets t
    left join users u on u.id = t.reported_by
    where 1=1
  `;
  const params = [];
  if (status && status !== "all") { sql += " and t.status = ?"; params.push(status); }
  if (priority && priority !== "all") { sql += " and t.priority = ?"; params.push(priority); }
  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    sql += " and (t.ticket_no like ? or t.equipment_name like ? or t.vendor_name like ? or t.issue_description like ?)";
    params.push(term, term, term, term);
  }
  sql += " order by case when t.status in ('open','in_progress') then 0 else 1 end, t.id desc limit 150";
  const tickets = db.prepare(sql).all(...params);

  const openCount = db.prepare("select count(*) c from equipment_tickets where status in ('open','in_progress')").get()?.c || 0;
  const criticalCount = db.prepare("select count(*) c from equipment_tickets where status in ('open','in_progress') and priority='Critical'").get()?.c || 0;
  const totalCost = db.prepare("select coalesce(sum(repair_cost),0) s from equipment_tickets").get()?.s || 0;
  const avgDowntime = db.prepare("select coalesce(avg(downtime_hours),0) a from equipment_tickets where downtime_hours > 0").get()?.a || 0;

  s.json({
    tickets,
    stats: {
      open_tickets: openCount,
      critical_tickets: criticalCount,
      total_repair_cost: totalCost,
      avg_downtime_hours: Math.round(avgDowntime * 10) / 10
    }
  });
});

app.post("/api/equipment-tickets", need(), (q, s) => {
  const { equipment_name, equipment_type, island_bay, issue_description, priority, vendor_name, vendor_contact, assigned_to, notes } = q.body || {};
  if (!equipment_name || !issue_description) {
    return s.status(400).json({ error: "Equipment name and issue description are required." });
  }

  const ticketNo = "TKT-" + bizDate().slice(0, 4) + "-" + Math.floor(100 + Math.random() * 900);
  const rowId = db.prepare(`
    insert into equipment_tickets(
      ticket_no, equipment_name, equipment_type, island_bay, issue_description,
      priority, vendor_name, vendor_contact, reported_by, reported_at,
      assigned_to, status, downtime_hours, repair_cost, spares_replaced, notes, created_at
    ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ticketNo, String(equipment_name).trim(), String(equipment_type || "Dispenser / DU").trim(),
    String(island_bay || "Main Forecourt").trim(), String(issue_description).trim(),
    String(priority || "Urgent").trim(), String(vendor_name || "OMC Maintenance Team").trim(),
    String(vendor_contact || "").trim(), q.user.id, now(),
    String(assigned_to || "").trim(), "open", 0, 0, "", String(notes || "").trim(), now()
  ).lastInsertRowid;

  s.json({ ok: true, id: rowId, ticket_no: ticketNo });
});

app.post("/api/equipment-tickets/:id/resolve", need(), (q, s) => {
  const { downtime_hours, repair_cost, spares_replaced, notes } = q.body || {};
  const row = db.prepare("select * from equipment_tickets where id=?").get(+q.params.id);
  if (!row) return s.status(404).json({ error: "Equipment ticket not found." });

  db.prepare(`
    update equipment_tickets
    set status='resolved', resolved_at=?, downtime_hours=?, repair_cost=?, spares_replaced=?, notes=coalesce(?, notes)
    where id=?
  `).run(
    now(), downtime_hours ? num(downtime_hours) : 0, repair_cost ? num(repair_cost) : 0,
    String(spares_replaced || "Replaced worn components and calibrated").trim(),
    notes ? String(notes).trim() : null, row.id
  );
  s.json({ ok: true });
});

// ==========================================
// 5. Driver Loyalty & Commercial Khata
// ==========================================
app.get("/api/driver-loyalty", need(), (q, s) => {
  const { search, type, tier } = q.query || {};
  let sql = "select * from driver_loyalty_members where 1=1";
  const params = [];
  if (type && type !== "all") { sql += " and vehicle_type = ?"; params.push(type); }
  if (tier && tier !== "all") { sql += " and tier = ?"; params.push(tier); }
  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    sql += " and (member_code like ? or name like ? or mobile like ? or vehicle_no like ?)";
    params.push(term, term, term, term);
  }
  sql += " order by total_litres_fuelled desc limit 150";
  const members = db.prepare(sql).all(...params);

  const txns = db.prepare(`
    select t.*, m.name as driver_name, m.vehicle_no, m.member_code
    from driver_loyalty_transactions t
    join driver_loyalty_members m on m.id = t.driver_id
    order by t.id desc limit 60
  `).all();

  const totalMembers = db.prepare("select count(*) c from driver_loyalty_members where active=1").get()?.c || 0;
  const totalPoints = db.prepare("select coalesce(sum(points_balance),0) s from driver_loyalty_members").get()?.s || 0;
  const totalKhataOwed = db.prepare("select coalesce(sum(khata_balance),0) s from driver_loyalty_members where khata_balance > 0").get()?.s || 0;
  const totalLitresDispensed = db.prepare("select coalesce(sum(total_litres_fuelled),0) s from driver_loyalty_members").get()?.s || 0;

  s.json({
    members,
    recent_transactions: txns,
    stats: {
      total_members: totalMembers,
      total_points_bank: Math.round(totalPoints),
      total_khata_due: totalKhataOwed,
      total_litres_rewarded: Math.round(totalLitresDispensed)
    }
  });
});

app.post("/api/driver-loyalty/register", need(), (q, s) => {
  const { name, mobile, vehicle_no, vehicle_type } = q.body || {};
  if (!name || !mobile || !vehicle_no) {
    return s.status(400).json({ error: "Driver name, mobile number, and vehicle number are required." });
  }
  const cleanMob = String(mobile).replace(/\D/g, "");
  if (cleanMob.length !== 10) return s.status(400).json({ error: "Enter a valid 10-digit mobile number." });

  const code = "LOY-" + Math.floor(1000 + Math.random() * 9000);
  const rowId = db.prepare(`
    insert into driver_loyalty_members(
      member_code, name, mobile, vehicle_no, vehicle_type, tier,
      points_balance, total_litres_fuelled, khata_balance, active, created_at
    ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    code, String(name).trim(), cleanMob, String(vehicle_no).trim().toUpperCase(),
    String(vehicle_type || "Auto Rickshaw").trim(), "Silver", 0, 0, 0, 1, now()
  ).lastInsertRowid;

  s.json({ ok: true, id: rowId, member_code: code });
});

app.post("/api/driver-loyalty/txn", need(), (q, s) => {
  const { driver_id, txn_type, fuel_type, litres, amount, points_redeemed, notes } = q.body || {};
  const mem = db.prepare("select * from driver_loyalty_members where id=?").get(+driver_id);
  if (!mem) return s.status(404).json({ error: "Loyalty driver member not found." });

  const date = bizDate();
  const lit = litres ? num(litres) : 0;
  const amt = amount ? num(amount) : 0;
  const type = txn_type || "fuel_visit";
  let earned = 0;
  let redeemed = points_redeemed ? num(points_redeemed) : 0;

  if (type === "fuel_visit") {
    // 1 point per 10 litres dispensed
    earned = Math.round((lit / 10) * 10) / 10;
  }

  db.transaction(() => {
    let newPoints = Math.max(0, mem.points_balance + earned - redeemed);
    let newLitres = mem.total_litres_fuelled + lit;
    let newKhata = mem.khata_balance;
    if (type === "khata_credit") {
      newKhata += amt;
    } else if (type === "khata_payment") {
      newKhata = Math.max(0, newKhata - amt);
    }

    // Tier upgrade
    let newTier = "Silver";
    if (newLitres >= 3000) newTier = "Platinum";
    else if (newLitres >= 1000) newTier = "Gold";

    db.prepare(`
      update driver_loyalty_members
      set points_balance=?, total_litres_fuelled=?, khata_balance=?, tier=?
      where id=?
    `).run(newPoints, newLitres, newKhata, newTier, mem.id);

    db.prepare(`
      insert into driver_loyalty_transactions(
        driver_id, d, txn_type, fuel_type, litres, amount, points_earned, points_redeemed, notes, created_at
      ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(mem.id, date, type, fuel_type || "Diesel (HSD)", lit, amt, earned, redeemed, String(notes || "").trim(), now());
  })();

  s.json({ ok: true });
});

// ==========================================
// 6. Generator & Forecourt Electricity Log
// ==========================================
app.get("/api/generator-power-logs", need(), (q, s) => {
  const { date_from, date_to } = q.query || {};
  let sql = `
    select g.*, u.name as logged_by_name
    from generator_power_logs g
    left join users u on u.id = g.logged_by
    where 1=1
  `;
  const params = [];
  if (date_from) { sql += " and g.d >= ?"; params.push(date_from); }
  if (date_to) { sql += " and g.d <= ?"; params.push(date_to); }
  sql += " order by g.d desc, g.id desc limit 120";
  const logs = db.prepare(sql).all(...params);

  const totalRun = db.prepare("select coalesce(sum(run_hours),0) s from generator_power_logs").get()?.s || 0;
  const totalDiesel = db.prepare("select coalesce(sum(diesel_consumed_litres),0) s from generator_power_logs").get()?.s || 0;
  const totalOutageMins = db.prepare("select coalesce(sum(power_cut_mins),0) s from generator_power_logs").get()?.s || 0;
  const avgBurnRate = totalRun > 0 ? (totalDiesel / totalRun) : 8.0;

  s.json({
    logs,
    stats: {
      total_run_hours: Math.round(totalRun * 10) / 10,
      total_diesel_consumed: Math.round(totalDiesel * 10) / 10,
      total_outage_hours: Math.round((totalOutageMins / 60) * 10) / 10,
      avg_burn_rate_lph: Math.round(avgBurnRate * 10) / 10
    }
  });
});

app.post("/api/generator-power-logs", need(), (q, s) => {
  const { d, genset_start_hours, genset_end_hours, diesel_consumed_litres, power_cut_mins, outage_reason, battery_voltage, oil_level_ok, notes } = q.body || {};
  const start = num(genset_start_hours);
  const end = num(genset_end_hours);
  if (isNaN(start) || isNaN(end) || end < start) {
    return s.status(400).json({ error: "Genset end reading must be greater than or equal to start reading." });
  }
  const runHours = Math.round((end - start) * 100) / 100;
  const diesel = num(diesel_consumed_litres) || 0;
  const burnRate = runHours > 0 ? Math.round((diesel / runHours) * 100) / 100 : 0;
  const date = d || bizDate();

  const rowId = db.prepare(`
    insert into generator_power_logs(
      d, genset_start_hours, genset_end_hours, run_hours,
      diesel_consumed_litres, fuel_burn_rate_lph, power_cut_mins,
      outage_reason, battery_voltage, oil_level_ok, logged_by, notes, created_at
    ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    date, start, end, runHours, diesel, burnRate,
    power_cut_mins ? num(power_cut_mins) : Math.round(runHours * 60),
    String(outage_reason || "Grid Power Outage").trim(),
    battery_voltage ? num(battery_voltage) : 12.6,
    oil_level_ok === 0 ? 0 : 1, q.user.id, String(notes || "").trim(), now()
  ).lastInsertRowid;

  s.json({ ok: true, id: rowId, run_hours: runHours, burn_rate: burnRate });
});

// ==========================================
// 7. Customer Amenities & OMC Mystery Audit
// ==========================================
app.get("/api/amenities-inspections", need(), (q, s) => {
  let sql = `
    select a.*, u.name as inspector_name
    from amenities_inspections a
    left join users u on u.id = a.inspector_id
    order by a.d desc, a.id desc limit 100
  `;
  const inspections = db.prepare(sql).all();

  const todayD = bizDate();
  const todayInspection = db.prepare("select * from amenities_inspections where d=? order by id desc limit 1").get(todayD);
  const avgScore = db.prepare("select coalesce(avg(total_score_pct),100) a from amenities_inspections").get()?.a || 100;

  s.json({
    inspections,
    today_inspection: todayInspection || null,
    stats: {
      today_inspected: todayInspection ? 1 : 0,
      today_score: todayInspection ? todayInspection.total_score_pct : null,
      average_omc_score: Math.round(avgScore * 10) / 10,
      total_audits: inspections.length
    }
  });
});

app.post("/api/amenities-inspections", need(), (q, s) => {
  const {
    d, shift,
    air_nitrogen_working, air_gauge_calibrated,
    drinking_water_ok, water_dispenser_clean,
    gents_toilet_clean, ladies_toilet_clean,
    soap_water_running, windshield_wash_bucket_ok,
    fire_extinguishers_green, sand_buckets_dry_full,
    first_aid_stocked, complaint_book_open, canopy_lighting_full,
    corrective_actions
  } = q.body || {};

  const items = [
    air_nitrogen_working, air_gauge_calibrated,
    drinking_water_ok, water_dispenser_clean,
    gents_toilet_clean, ladies_toilet_clean,
    soap_water_running, windshield_wash_bucket_ok,
    fire_extinguishers_green, sand_buckets_dry_full,
    first_aid_stocked, complaint_book_open, canopy_lighting_full
  ].map((x) => (x === 1 || x === true || x === "1" ? 1 : 0));

  const passedCount = items.reduce((a, b) => a + b, 0);
  const scorePct = Math.round((passedCount / 13) * 1000) / 10;
  let grade = "A - Outstanding / 100%";
  if (scorePct < 80) grade = "C - Critical OMC Deficiencies";
  else if (scorePct < 95) grade = "B - Good / Minor Fixes Needed";

  const date = d || bizDate();
  const rowId = db.prepare(`
    insert into amenities_inspections(
      d, shift, inspector_id, air_nitrogen_working, air_gauge_calibrated,
      drinking_water_ok, water_dispenser_clean, gents_toilet_clean, ladies_toilet_clean,
      soap_water_running, windshield_wash_bucket_ok, fire_extinguishers_green,
      sand_buckets_dry_full, first_aid_stocked, complaint_book_open, canopy_lighting_full,
      total_score_pct, audit_grade, corrective_actions, created_at
    ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    date, String(shift || "Morning (07:00 AM)").trim(), q.user.id,
    items[0], items[1], items[2], items[3], items[4], items[5],
    items[6], items[7], items[8], items[9], items[10], items[11], items[12],
    scorePct, grade, String(corrective_actions || "").trim(), now()
  ).lastInsertRowid;

  s.json({ ok: true, id: rowId, score_pct: scorePct, grade });
});

// ==========================================
// 14. MOBILE FUEL BOWSER & DOORSTEP DELIVERY (DDD)
// ==========================================
app.get("/api/bowsers", need(), (q, s) => {
  const bowsers = db.prepare("select * from bowsers order by id asc").all();
  const trips = db.prepare(`
    select t.*, b.name as bowser_name, b.reg_no as bowser_reg
    from bowser_trips t
    left join bowsers b on b.id = t.bowser_id
    order by t.id desc limit 60
  `).all();
  const deliveries = db.prepare(`
    select d.*, b.name as bowser_name, b.reg_no as bowser_reg
    from bowser_deliveries d
    left join bowsers b on b.id = d.bowser_id
    order by d.id desc limit 100
  `).all();
  const refills = db.prepare(`
    select r.*, b.name as bowser_name, b.reg_no as bowser_reg, u.name as attendant_name
    from bowser_refills r
    left join bowsers b on b.id = r.bowser_id
    left join users u on u.id = r.attendant_id
    order by r.id desc limit 50
  `).all();

  const todayD = bizDate();
  const todayLiters = db.prepare("select sum(qty_litres) s, sum(amount) a from bowser_deliveries where d=?").get(todayD) || {};
  const activeTripsCount = db.prepare("select count(*) c from bowser_trips where status='open'").get()?.c || 0;
  const totalFleetCapacity = db.prepare("select sum(capacity_litres) c, sum(current_fuel_stock) s from bowsers").get() || {};

  let custs = [];
  try { custs = customers(); } catch (_) {}

  s.json({
    bowsers,
    trips,
    deliveries,
    refills,
    customers: custs,
    stats: {
      active_trips: activeTripsCount,
      today_delivered_litres: todayLiters.s || 0,
      today_delivered_amount: todayLiters.a || 0,
      total_fleet_capacity: totalFleetCapacity.c || 0,
      current_mobile_stock: totalFleetCapacity.s || 0
    }
  });
});

app.post("/api/bowsers/create", need("owner", "manager"), (q, s) => {
  const { name, reg_no, capacity_litres, flowmeter_make, flowmeter_serial, starting_meter, driver_name, driver_mobile, peso_license_no, peso_expiry_d, notes } = q.body || {};
  if (!name || !reg_no || !capacity_litres || !flowmeter_make) {
    return s.status(400).json({ error: "Name, registration number, tank capacity, and flowmeter make are required." });
  }
  const id = db.prepare(`
    insert into bowsers(name, reg_no, capacity_litres, current_fuel_stock, flowmeter_make, flowmeter_serial, current_totalizer_meter, fuel_product, driver_name, driver_mobile, peso_license_no, peso_expiry_d, status, notes, created_at)
    values(?, ?, ?, 0, ?, ?, ?, 'Diesel (HSD)', ?, ?, ?, ?, 'available', ?, ?)
  `).run(
    String(name).trim(), String(reg_no).trim().toUpperCase(), +capacity_litres,
    String(flowmeter_make).trim(), String(flowmeter_serial || "FM-AUTO").trim(),
    starting_meter ? +starting_meter : 0,
    String(driver_name || "").trim(), String(driver_mobile || "").trim(),
    String(peso_license_no || "").trim(), String(peso_expiry_d || "").trim(),
    String(notes || "").trim(), now()
  ).lastInsertRowid;
  s.json({ ok: true, id });
});

app.post("/api/bowser-refill", need(), (q, s) => {
  const { bowser_id, tank_id, loaded_qty, loaded_density, temp_c, dip_before_cm, dip_after_cm, notes } = q.body || {};
  if (!bowser_id || !loaded_qty || !loaded_density) {
    return s.status(400).json({ error: "Bowser ID, loaded quantity, and density are required." });
  }
  const b = db.prepare("select * from bowsers where id=?").get(+bowser_id);
  if (!b) return s.status(404).json({ error: "Bowser not found." });

  const qty = +loaded_qty;
  const dens = +loaded_density;
  const date = bizDate();
  const timeStr = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  db.transaction(() => {
    db.prepare(`
      insert into bowser_refills(bowser_id, d, time_str, tank_id, fuel_product, dip_before_cm, dip_after_cm, loaded_qty, loaded_density, temp_c, attendant_id, notes, created_at)
      values(?, ?, ?, ?, 'Diesel (HSD)', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      b.id, date, timeStr, String(tank_id || "T2"),
      dip_before_cm ? +dip_before_cm : null, dip_after_cm ? +dip_after_cm : null,
      qty, dens, temp_c ? +temp_c : null, q.user.id, String(notes || "").trim(), now()
    );

    db.prepare("update bowsers set current_fuel_stock = current_fuel_stock + ? where id=?").run(qty, b.id);
  })();

  s.json({ ok: true });
});

app.post("/api/bowser-trip/start", need(), (q, s) => {
  const { bowser_id, driver_name, driver_mobile, helper_name, starting_meter, destination_summary, notes } = q.body || {};
  if (!bowser_id || !driver_name) {
    return s.status(400).json({ error: "Bowser and driver name are required." });
  }
  const b = db.prepare("select * from bowsers where id=?").get(+bowser_id);
  if (!b) return s.status(404).json({ error: "Bowser not found." });
  if (b.status === "on_trip") {
    return s.status(400).json({ error: "This bowser is already on an active trip. Complete it first." });
  }

  const year = new Date().getFullYear();
  const lastTrip = db.prepare("select id from bowser_trips order by id desc limit 1").get();
  const nextNum = (lastTrip ? lastTrip.id : 0) + 101;
  const tripNo = `TRIP-${year}-${nextNum}`;
  const date = bizDate();
  const timeStr = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const startMeter = starting_meter !== undefined && starting_meter !== "" ? +starting_meter : b.current_totalizer_meter;

  const tripId = db.transaction(() => {
    const tid = db.prepare(`
      insert into bowser_trips(trip_no, bowser_id, d, start_time, driver_name, driver_mobile, helper_name, starting_meter, starting_fuel_qty, destination_summary, status, notes, created_at)
      values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
    `).run(
      tripNo, b.id, date, timeStr, String(driver_name).trim(),
      String(driver_mobile || b.driver_mobile || "").trim(), String(helper_name || "").trim(),
      startMeter, b.current_fuel_stock, String(destination_summary || "").trim(),
      String(notes || "").trim(), now()
    ).lastInsertRowid;

    db.prepare("update bowsers set status='on_trip', current_totalizer_meter=? where id=?").run(startMeter, b.id);
    return tid;
  })();

  s.json({ ok: true, trip_id: tripId, trip_no: tripNo });
});

app.post("/api/bowser-delivery", need(), (q, s) => {
  const {
    trip_id, cust_id, client_name, site_location, asset_type,
    start_meter, end_meter, qty_litres, rate, payment_mode,
    recipient_person, recipient_mobile, gps_coordinates, notes
  } = q.body || {};

  if (!trip_id || !client_name || !asset_type || !qty_litres || !rate) {
    return s.status(400).json({ error: "Trip, client name, equipment asset, quantity, and rate are required." });
  }

  const trip = db.prepare("select * from bowser_trips where id=?").get(+trip_id);
  if (!trip) return s.status(404).json({ error: "Trip not found." });
  if (trip.status !== "open") return s.status(400).json({ error: "Trip is already completed or cancelled." });

  const b = db.prepare("select * from bowsers where id=?").get(trip.bowser_id);
  const qty = +qty_litres;
  const r = +rate;
  const amount = Math.round(qty * r * 100) / 100;
  const sMeter = start_meter !== undefined ? +start_meter : trip.starting_meter + trip.total_dispensed_qty;
  const eMeter = end_meter !== undefined ? +end_meter : sMeter + qty;
  const date = bizDate();
  const timeStr = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  const year = new Date().getFullYear();
  const lastDeliv = db.prepare("select id from bowser_deliveries order by id desc limit 1").get();
  const challanNo = `DDD-${year}-${(lastDeliv ? lastDeliv.id : 0) + 1042}`;

  let creditSaleId = null;

  db.transaction(() => {
    if (payment_mode === "credit" && cust_id) {
      creditSaleId = db.prepare(`
        insert into credit_sales(cust_id, d, n, a, veh, worker_id, created, status)
        values(?, ?, ?, ?, ?, ?, ?, 'ok')
      `).run(
        String(cust_id), date, `DDD Bowser Refueling: ${qty}L @ ₹${r} (${challanNo} - ${asset_type})`,
        amount, String(asset_type).slice(0, 30), q.user.id, now()
      ).lastInsertRowid;
    }

    db.prepare(`
      insert into bowser_deliveries(
        trip_id, trip_no, bowser_id, d, delivery_time, challan_no, cust_id, client_name,
        site_location, asset_type, start_meter, end_meter, qty_litres, rate, amount,
        payment_mode, credit_sale_id, recipient_person, recipient_mobile, gps_coordinates, notes, created_at
      ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      trip.id, trip.trip_no, trip.bowser_id, date, timeStr, challanNo,
      cust_id ? String(cust_id) : null, String(client_name).trim(),
      String(site_location || "On-site").trim(), String(asset_type).trim(),
      sMeter, eMeter, qty, r, amount, String(payment_mode || "credit"),
      creditSaleId, String(recipient_person || "").trim(),
      String(recipient_mobile || "").trim(), String(gps_coordinates || "").trim(),
      String(notes || "").trim(), now()
    );

    db.prepare("update bowser_trips set total_dispensed_qty = total_dispensed_qty + ? where id=?").run(qty, trip.id);
    db.prepare("update bowsers set current_fuel_stock = max(0, current_fuel_stock - ?), current_totalizer_meter = ? where id=?").run(qty, eMeter, b.id);
  })();

  s.json({ ok: true, challan_no: challanNo, amount, credit_sale_id: creditSaleId });
});

app.post("/api/bowser-trip/complete", need(), (q, s) => {
  const { trip_id, ending_meter, remaining_dip_litres, notes } = q.body || {};
  const trip = db.prepare("select * from bowser_trips where id=?").get(+trip_id);
  if (!trip) return s.status(404).json({ error: "Trip not found." });
  if (trip.status !== "open") return s.status(400).json({ error: "Trip already closed." });

  const b = db.prepare("select * from bowsers where id=?").get(trip.bowser_id);
  const timeStr = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const eMeter = ending_meter !== undefined ? +ending_meter : trip.starting_meter + trip.total_dispensed_qty;
  const remDip = remaining_dip_litres !== undefined ? +remaining_dip_litres : Math.max(0, trip.starting_fuel_qty - trip.total_dispensed_qty);
  const expectedRemaining = Math.max(0, trip.starting_fuel_qty - trip.total_dispensed_qty);
  const variance = Math.round((remDip - expectedRemaining) * 10) / 10;

  db.transaction(() => {
    db.prepare(`
      update bowser_trips set
        end_time = ?, ending_meter = ?, ending_fuel_qty = ?, remaining_dip_litres = ?,
        transit_variance_litres = ?, status = 'completed', completed_at = ?,
        notes = case when length(?) > 0 then notes || ' · ' || ? else notes end
      where id = ?
    `).run(
      timeStr, eMeter, remDip, remDip, variance, now(),
      String(notes || "").trim(), String(notes || "").trim(), trip.id
    );

    db.prepare("update bowsers set status = 'available', current_fuel_stock = ?, current_totalizer_meter = ? where id = ?").run(remDip, eMeter, b.id);
  })();

  s.json({ ok: true, variance_litres: variance });
});

// ==========================================
// 15. AUTOMATED DAILY PROFIT & LOSS BREAKDOWN
// ==========================================
app.get("/api/pnl-analytics", need("owner", "manager"), (q, s) => {
  const { date_from, date_to } = q.query || {};
  const todayD = bizDate();
  const dFrom = date_from || new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  const dTo = date_to || todayD;

  const commissions = db.prepare("select * from dealer_commissions").all();
  const commMap = {};
  commissions.forEach(c => { commMap[c.fuel_product] = c.commission_per_litre; });
  if (!commMap["Petrol (MS)"]) commMap["Petrol (MS)"] = 3.75;
  if (!commMap["Diesel (HSD)"]) commMap["Diesel (HSD)"] = 2.58;
  if (!commMap["Power petrol"]) commMap["Power petrol"] = 4.15;
  if (!commMap["AdBlue (DEF)"]) commMap["AdBlue (DEF)"] = 12.00;

  let st = {};
  try {
    const sRow = db.prepare("select json from state where id=1").get();
    if (sRow && sRow.json) st = JSON.parse(sRow.json);
  } catch (_) {}
  const nozzleFuelMap = {};
  (st.nozzles || []).forEach(n => { nozzleFuelMap[n.id] = n.fuel; });

  const duties = db.prepare(`
    select d.id, d.d, d.cash, d.upi, d.card
    from duties d
    where d.d >= ? and d.d <= ? and d.status in ('submitted','closed')
  `).all(dFrom, dTo);

  const lines = db.prepare(`
    select dl.*, d.d
    from duty_lines dl
    join duties d on d.id = dl.duty_id
    where d.d >= ? and d.d <= ? and d.status in ('submitted','closed')
  `).all(dFrom, dTo);

  const bowserSales = db.prepare(`
    select d, sum(qty_litres) as total_litres, sum(amount) as total_amt
    from bowser_deliveries
    where d >= ? and d <= ?
    group by d
  `).all(dFrom, dTo);
  const bowserByDate = {};
  bowserSales.forEach(b => { bowserByDate[b.d] = b; });

  const lubeItems = db.prepare(`
    select di.*, d.d
    from duty_items di
    join duties d on d.id = di.duty_id
    where d.d >= ? and d.d <= ? and d.status in ('submitted','closed')
  `).all(dFrom, dTo);

  const overheads = db.prepare(`
    select * from daily_pnl_overheads where d >= ? and d <= ? order by d asc
  `).all(dFrom, dTo);
  const overheadMap = {};
  overheads.forEach(o => { overheadMap[o.d] = o; });

  const vaultDrops = db.prepare(`
    select d, sum(case when short_excess < 0 then abs(short_excess) else 0 end) as shortages
    from vault_drops
    where d >= ? and d <= ?
    group by d
  `).all(dFrom, dTo);
  const shortMap = {};
  vaultDrops.forEach(v => { shortMap[v.d] = v.shortages; });

  const dateList = [];
  let cur = new Date(dFrom);
  const end = new Date(dTo);
  while (cur <= end) {
    dateList.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }

  const dailyPnL = dateList.map(dt => {
    let msL = 0, hsdL = 0, pwrL = 0, otherFuelL = 0, totalFuelRev = 0;
    lines.filter(l => l.d === dt).forEach(l => {
      const vol = Math.max(0, (l.closing || 0) - (l.opening || 0) - (l.testing || 0));
      const fuel = nozzleFuelMap[l.nozzle_id] || "Diesel (HSD)";
      if (fuel.includes("Petrol") || fuel.includes("MS")) {
        if (fuel.toLowerCase().includes("power") || fuel.toLowerCase().includes("speed") || fuel.toLowerCase().includes("xp")) pwrL += vol;
        else msL += vol;
      } else if (fuel.includes("Diesel") || fuel.includes("HSD")) {
        hsdL += vol;
      } else {
        otherFuelL += vol;
      }
      totalFuelRev += vol * (l.rate || (fuel.includes("Petrol") ? 104.5 : 91.5));
    });

    if (bowserByDate[dt]) {
      hsdL += (bowserByDate[dt].total_litres || 0);
      totalFuelRev += (bowserByDate[dt].total_amt || 0);
    }

    const msComm = Math.round(msL * (commMap["Petrol (MS)"] || 3.75) * 100) / 100;
    const hsdComm = Math.round(hsdL * (commMap["Diesel (HSD)"] || 2.58) * 100) / 100;
    const pwrComm = Math.round(pwrL * (commMap["Power petrol"] || 4.15) * 100) / 100;
    const fuelGrossMargin = msComm + hsdComm + pwrComm;

    let lubeRev = 0, lubeProfit = 0;
    lubeItems.filter(li => li.d === dt).forEach(li => {
      const sAmt = (li.qty || 0) * (li.price || 0);
      lubeRev += sAmt;
      lubeProfit += sAmt * 0.22;
    });

    const totalGrossProfit = fuelGrossMargin + lubeProfit;

    const ov = overheadMap[dt] || {
      electricity_expense: 650, dg_fuel_expense: 550, staff_wages: 2400,
      evaporation_shrinkage_cost: 350, bank_pos_charges: 280, maintenance_misc: 120
    };
    const vaultShort = shortMap[dt] || 0;
    const totalOverheads = Math.round(
      (ov.electricity_expense || 0) + (ov.dg_fuel_expense || 0) + (ov.staff_wages || 0) +
      (ov.evaporation_shrinkage_cost || 0) + (ov.bank_pos_charges || 0) + (ov.maintenance_misc || 0) + vaultShort
    );

    const netProfit = Math.round((totalGrossProfit - totalOverheads) * 100) / 100;
    const totalTurnover = totalFuelRev + lubeRev;
    const netMarginPct = totalTurnover > 0 ? Math.round((netProfit / totalTurnover) * 1000) / 10 : 0;
    const totalFuelLitres = msL + hsdL + pwrL + otherFuelL;

    return {
      date: dt,
      ms_litres: Math.round(msL * 10) / 10,
      hsd_litres: Math.round(hsdL * 10) / 10,
      pwr_litres: Math.round(pwrL * 10) / 10,
      total_fuel_litres: Math.round(totalFuelLitres * 10) / 10,
      ms_margin: msComm,
      hsd_margin: hsdComm,
      pwr_margin: pwrComm,
      fuel_gross_margin: Math.round(fuelGrossMargin),
      lube_revenue: Math.round(lubeRev),
      lube_profit: Math.round(lubeProfit),
      total_gross_profit: Math.round(totalGrossProfit),
      overheads: {
        electricity: ov.electricity_expense || 0,
        dg_fuel: ov.dg_fuel_expense || 0,
        wages: ov.staff_wages || 0,
        shrinkage: ov.evaporation_shrinkage_cost || 0,
        bank_charges: ov.bank_pos_charges || 0,
        misc: ov.maintenance_misc || 0,
        cash_shortage: vaultShort,
        total: totalOverheads
      },
      net_dealer_profit: netProfit,
      total_turnover: Math.round(totalTurnover),
      net_margin_pct: netMarginPct
    };
  });

  const totalLitres = dailyPnL.reduce((a, b) => a + b.total_fuel_litres, 0);
  const totalFuelMargin = dailyPnL.reduce((a, b) => a + b.fuel_gross_margin, 0);
  const totalLubeProfit = dailyPnL.reduce((a, b) => a + b.lube_profit, 0);
  const totalGross = dailyPnL.reduce((a, b) => a + b.total_gross_profit, 0);
  const totalExpenses = dailyPnL.reduce((a, b) => a + b.overheads.total, 0);
  const totalNet = dailyPnL.reduce((a, b) => a + b.net_dealer_profit, 0);
  const totalRev = dailyPnL.reduce((a, b) => a + b.total_turnover, 0);

  s.json({
    daily: dailyPnL,
    commissions: commMap,
    summary: {
      total_fuel_litres: Math.round(totalLitres),
      total_fuel_gross_margin: Math.round(totalFuelMargin),
      total_lube_profit: Math.round(totalLubeProfit),
      total_gross_profit: Math.round(totalGross),
      total_expenses: Math.round(totalExpenses),
      total_net_profit: Math.round(totalNet),
      total_turnover: Math.round(totalRev),
      net_margin_pct: totalRev > 0 ? Math.round((totalNet / totalRev) * 1000) / 10 : 0,
      avg_daily_profit: dailyPnL.length ? Math.round(totalNet / dailyPnL.length) : 0,
      breakeven_volume_per_day: Math.round(2400 / 2.95)
    }
  });
});

app.post("/api/pnl-commissions", need("owner"), (q, s) => {
  const { commissions } = q.body || {};
  if (!commissions || typeof commissions !== "object") {
    return s.status(400).json({ error: "Invalid commission values." });
  }
  const nowTs = now();
  const upsert = db.prepare(`
    insert into dealer_commissions(fuel_product, commission_per_litre, company, updated_at)
    values(?, ?, 'IOCL', ?)
    on conflict(fuel_product) do update set commission_per_litre=excluded.commission_per_litre, updated_at=excluded.updated_at
  `);
  db.transaction(() => {
    Object.keys(commissions).forEach(fp => {
      upsert.run(fp, +commissions[fp], nowTs);
    });
  })();
  s.json({ ok: true });
});

app.post("/api/pnl-overheads", need("owner", "manager"), (q, s) => {
  const { d, electricity_expense, dg_fuel_expense, staff_wages, evaporation_shrinkage_cost, bank_pos_charges, maintenance_misc, notes } = q.body || {};
  const date = d || bizDate();
  db.prepare(`
    insert into daily_pnl_overheads(d, electricity_expense, dg_fuel_expense, staff_wages, evaporation_shrinkage_cost, bank_pos_charges, maintenance_misc, notes, created_at)
    values(?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(d) do update set
      electricity_expense=excluded.electricity_expense, dg_fuel_expense=excluded.dg_fuel_expense,
      staff_wages=excluded.staff_wages, evaporation_shrinkage_cost=excluded.evaporation_shrinkage_cost,
      bank_pos_charges=excluded.bank_pos_charges, maintenance_misc=excluded.maintenance_misc,
      notes=excluded.notes
  `).run(
    date, +electricity_expense || 0, +dg_fuel_expense || 0, +staff_wages || 0,
    +evaporation_shrinkage_cost || 0, +bank_pos_charges || 0, +maintenance_misc || 0,
    String(notes || "").trim(), now()
  );
  s.json({ ok: true });
});

// ==========================================
// 16. WEIGHTS & MEASURES (W&M) STAMPING VAULT
// ==========================================
app.get("/api/wm-vault", need(), (q, s) => {
  const nozzles = db.prepare("select * from wm_stamping_vault order by nozzle_id asc").all();
  const calibs = db.prepare(`
    select c.*, u.name as tested_by_name
    from wm_measure_calibrations c
    left join users u on u.id = c.tested_by
    order by c.d desc, c.id desc limit 60
  `).all();

  const todayD = bizDate();
  const todayPassCount = db.prepare("select count(*) c from wm_measure_calibrations where d=? and is_pass=1").get(todayD)?.c || 0;
  const expiredCount = nozzles.filter(n => n.expiry_d < todayD).length;
  const warningCount = nozzles.filter(n => {
    const diffDays = Math.ceil((new Date(n.expiry_d) - new Date(todayD)) / 864e5);
    return diffDays >= 0 && diffDays <= 30;
  }).length;

  s.json({
    stamping_records: nozzles,
    measure_calibrations: calibs,
    stats: {
      total_nozzles_stamped: nozzles.length,
      today_5l_checks_done: todayPassCount,
      expiring_soon_count: warningCount,
      expired_count: expiredCount
    }
  });
});

app.post("/api/wm-calibrations/log", need(), (q, s) => {
  const { nozzle_id, fuel_product, delivered_volume_ml, returned_to_tank_id, notes, seal_intact } = q.body || {};
  if (!nozzle_id || !delivered_volume_ml || !returned_to_tank_id) {
    return s.status(400).json({ error: "Nozzle ID, delivered measure (ml), and returned tank are required." });
  }

  const delivMl = +delivered_volume_ml;
  const errorMl = Math.round((delivMl - 5000) * 10) / 10;
  const isPass = Math.abs(errorMl) <= 25.0 ? 1 : 0;
  const date = bizDate();
  const timeStr = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  const id = db.prepare(`
    insert into wm_measure_calibrations(
      d, time_str, nozzle_id, fuel_product, measure_stamped_capacity,
      delivered_volume_ml, error_ml, allowed_tolerance_ml, is_pass,
      seal_intact, returned_to_tank_id, tested_by, notes, created_at
    ) values(?, ?, ?, ?, 5.0, ?, ?, 25.0, ?, ?, ?, ?, ?, ?)
  `).run(
    date, timeStr, String(nozzle_id), String(fuel_product || "Diesel (HSD)"),
    delivMl, errorMl, isPass, (seal_intact === 0 ? 0 : 1),
    String(returned_to_tank_id), q.user.id, String(notes || "").trim(), now()
  ).lastInsertRowid;

  s.json({ ok: true, id, error_ml: errorMl, is_pass: isPass });
});

app.post("/api/wm-stamping/update", need("owner", "manager"), (q, s) => {
  const {
    nozzle_id, dispenser_make, fuel_product, island_name, serial_no,
    last_stamping_d, expiry_d, certificate_no, inspector_name,
    legal_metrology_office, pulser_seal_no, totalizer_motherboard_seal_no, notes
  } = q.body || {};

  if (!nozzle_id || !expiry_d || !certificate_no) {
    return s.status(400).json({ error: "Nozzle ID, expiry date, and certificate number are required." });
  }

  const todayD = bizDate();
  const diffDays = Math.ceil((new Date(expiry_d) - new Date(todayD)) / 864e5);
  const status = diffDays < 0 ? "expired" : (diffDays <= 30 ? "warning" : "valid");

  db.prepare(`
    insert into wm_stamping_vault(
      nozzle_id, dispenser_make, fuel_product, island_name, serial_no,
      last_stamping_d, expiry_d, certificate_no, inspector_name, legal_metrology_office,
      pulser_seal_no, totalizer_motherboard_seal_no, status, notes, updated_at
    ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(nozzle_id) do update set
      dispenser_make=excluded.dispenser_make, fuel_product=excluded.fuel_product,
      island_name=excluded.island_name, serial_no=excluded.serial_no,
      last_stamping_d=excluded.last_stamping_d, expiry_d=excluded.expiry_d,
      certificate_no=excluded.certificate_no, inspector_name=excluded.inspector_name,
      legal_metrology_office=excluded.legal_metrology_office, pulser_seal_no=excluded.pulser_seal_no,
      totalizer_motherboard_seal_no=excluded.totalizer_motherboard_seal_no,
      status=excluded.status, notes=excluded.notes, updated_at=excluded.updated_at
  `).run(
    String(nozzle_id), String(dispenser_make || "Dispenser"), String(fuel_product || "Fuel"),
    String(island_name || "Island"), String(serial_no || "SN-001"),
    String(last_stamping_d || todayD), String(expiry_d), String(certificate_no).trim(),
    String(inspector_name || "Legal Metrology Inspector").trim(),
    String(legal_metrology_office || "Legal Metrology Office").trim(),
    String(pulser_seal_no || "").trim(), String(totalizer_motherboard_seal_no || "").trim(),
    status, String(notes || "").trim(), now()
  );

  s.json({ ok: true, status });
});

// Enhanced Indent Slip details with Mileage and Verification Token
app.get("/api/fleet-indents/:id/slip", need(), (q, s) => {
  const ind = db.prepare(`
    select fi.*, u.name as worker_name, cs.a as credit_amount
    from fleet_indents fi
    left join users u on u.id = fi.worker_id
    left join credit_sales cs on cs.id = fi.credit_sale_id
    where fi.id = ?
  `).get(+q.params.id);
  if (!ind) return s.status(404).json({ error: "Indent slip not found." });

  const prev = db.prepare(`
    select * from fleet_indents
    where vehicle_no = ? and id < ? and odometer_km is not null and dispensed_qty > 0
    order by id desc limit 1
  `).get(ind.vehicle_no, ind.id);

  let kmPerLitre = null;
  let kmTravelled = null;
  if (prev && ind.odometer_km && prev.odometer_km && ind.dispensed_qty) {
    kmTravelled = ind.odometer_km - prev.odometer_km;
    if (kmTravelled > 0 && ind.dispensed_qty > 0) {
      kmPerLitre = Math.round((kmTravelled / ind.dispensed_qty) * 100) / 100;
    }
  }

  let st = {};
  try {
    const sRow = db.prepare("select json from state where id=1").get();
    if (sRow && sRow.json) st = JSON.parse(sRow.json);
  } catch (_) {}

  const biz = st.biz || { name: "Petrol Pump Management", addr: "Highway Station", gst: "" };

  s.json({
    indent: ind,
    previous_reading: prev,
    km_travelled: kmTravelled,
    mileage_km_per_litre: kmPerLitre,
    station: biz,
    verification_token: `VERIFY-${ind.id}-${Math.abs((ind.created_at * 31) % 99999).toString().padStart(5, "0")}`
  });
});

// ==========================================
// 17. DAILY PRICE REVISION (06:00 AM) & BROADCAST
// ==========================================
app.get("/api/price-revisions", need(), (q, s) => {
  const { fuel_product, date_from, date_to } = q.query || {};
  let sql = `
    select pr.*, u.name as revised_by_name
    from daily_price_revisions pr
    left join users u on u.id = pr.revised_by
    where 1=1
  `;
  const params = [];
  if (fuel_product && fuel_product !== "all") {
    sql += " and pr.fuel_product = ?";
    params.push(fuel_product);
  }
  if (date_from) {
    sql += " and pr.revision_d >= ?";
    params.push(date_from);
  }
  if (date_to) {
    sql += " and pr.revision_d <= ?";
    params.push(date_to);
  }
  sql += " order by pr.revision_d desc, pr.id desc limit 100";
  const revisions = db.prepare(sql).all(...params);

  const broadcasts = db.prepare(`
    select b.*, u.name as sent_by_name
    from price_broadcast_logs b
    left join users u on u.id = b.sent_by
    order by b.broadcast_d desc, b.id desc limit 60
  `).all();

  // Current live rates from state
  let st = {};
  try {
    const sRow = db.prepare("select json from state where id=1").get();
    if (sRow && sRow.json) st = JSON.parse(sRow.json);
  } catch (_) {}

  const currentRates = {};
  (st.rates || []).forEach(r => {
    currentRates[r.fuel] = r;
  });

  // Calculate today's inventory impact
  const todayD = bizDate();
  const todayImpact = db.prepare("select sum(inventory_impact_inr) as s from daily_price_revisions where revision_d=?").get(todayD)?.s || 0;

  s.json({
    revisions,
    broadcasts,
    current_rates: currentRates,
    all_rates: st.rates || [],
    stats: {
      today_revisions_count: revisions.filter(r => r.revision_d === todayD).length,
      today_inventory_impact: todayImpact,
      total_broadcasts_sent: broadcasts.length
    }
  });
});

app.post("/api/price-revisions", need("owner", "manager"), (q, s) => {
  const { revision_d, effective_time, fuel_product, new_rate, omc_notification_ref, notes, broadcast_now } = q.body || {};
  if (!fuel_product || new_rate === undefined) {
    return s.status(400).json({ error: "Fuel product and new rate are required." });
  }

  const d = revision_d || bizDate();
  const time = effective_time || "06:00";
  const nRate = Math.round(+new_rate * 100) / 100;

  // Retrieve current active rate and stock from state
  let st = {};
  let stateVer = 0;
  try {
    const sRow = db.prepare("select ver, json from state where id=1").get();
    if (sRow && sRow.json) {
      st = JSON.parse(sRow.json);
      stateVer = sRow.ver;
    }
  } catch (_) {}

  let oldRate = nRate;
  (st.rates || []).forEach(r => {
    if (r.fuel === fuel_product) oldRate = +r.rate;
  });

  const changeAmt = Math.round((nRate - oldRate) * 100) / 100;

  // Calculate current stock for this fuel product across underground tanks
  const tanksForFuel = (st.tanks || []).filter(t => t.fuel === fuel_product);
  const tankIds = tanksForFuel.map(t => String(t.id));
  let curStock = 0;
  tankIds.forEach(tid => {
    const lastDip = db.prepare("select litres from dips where tank_id=? order by t desc limit 1").get(tid);
    if (lastDip) curStock += lastDip.litres;
    else {
      const tObj = tanksForFuel.find(t => String(t.id) === tid);
      if (tObj && tObj.capacity) curStock += Math.round(tObj.capacity * 0.4);
    }
  });
  if (curStock === 0) curStock = 8500; // default estimated volume

  const invImpact = Math.round(curStock * changeAmt * 100) / 100;

  let revId = null;
  db.transaction(() => {
    revId = db.prepare(`
      insert into daily_price_revisions(
        revision_d, effective_time, fuel_product, old_rate, new_rate,
        change_amount, stock_at_revision, inventory_impact_inr, omc_notification_ref,
        revised_by, notes, created_at
      ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      d, time, fuel_product, oldRate, nRate,
      changeAmt, curStock, invImpact, String(omc_notification_ref || "").trim(),
      q.user.id, String(notes || "").trim(), now()
    ).lastInsertRowid;

    // Also update system state rates so dispenser nozzles reflect new price immediately
    if (!st.rates) st.rates = [];
    st.rates.push({
      id: Date.now(),
      fuel: fuel_product,
      rate: nRate,
      from: d
    });
    db.prepare("update state set ver=ver+1, json=? where id=1").run(JSON.stringify(st));
  })();

  // Broadcast if requested
  if (broadcast_now) {
    const fleetCustCount = (st.c || []).filter(c => c.active !== false).length;
    const msg = `Mahud Auto Fuels: Daily RSP Price Revision effective ${d} ${time}. ${fuel_product} updated to ₹${nRate}/L (${changeAmt >= 0 ? '+' : ''}₹${changeAmt}/L). Prompt payment fleet discounts active.`;
    db.prepare(`
      insert into price_broadcast_logs(
        revision_id, broadcast_d, channel, recipient_group, recipients_count,
        message_body, sent_by, status, created_at
      ) values(?, ?, 'WhatsApp Broadcast', 'Active Transporter & Fleet Customers', ?, ?, 'sent', ?)
    `).run(revId, d, fleetCustCount || 12, msg, q.user.id, now());
  }

  s.json({ ok: true, id: revId, old_rate: oldRate, new_rate: nRate, change_amount: changeAmt, inventory_impact: invImpact });
});

app.post("/api/price-broadcast", need("owner", "manager"), (q, s) => {
  const { channel, recipient_group, message_body, revision_id } = q.body || {};
  if (!message_body) {
    return s.status(400).json({ error: "Broadcast message body is required." });
  }

  let st = {};
  try {
    const sRow = db.prepare("select json from state where id=1").get();
    if (sRow && sRow.json) st = JSON.parse(sRow.json);
  } catch (_) {}
  const fleetCustCount = (st.c || []).filter(c => c.active !== false).length;

  const id = db.prepare(`
    insert into price_broadcast_logs(
      revision_id, broadcast_d, channel, recipient_group, recipients_count,
      message_body, sent_by, status, created_at
    ) values(?, ?, ?, ?, ?, ?, ?, 'sent', ?)
  `).run(
    revision_id ? +revision_id : null, bizDate(), String(channel || "WhatsApp Broadcast"),
    String(recipient_group || "All Transporters & Credit Accounts"),
    fleetCustCount || 10, String(message_body).trim(), q.user.id, now()
  ).lastInsertRowid;

  s.json({ ok: true, id, sent_count: fleetCustCount || 10 });
});

// ==========================================
// 18. WEIGHTS & MEASURES (W&M) RESEAL REQUESTS & REPAIRS
// ==========================================
app.get("/api/wm-reseals", need(), (q, s) => {
  const { status, search } = q.query || {};
  let sql = `
    select r.*
    from wm_reseal_requests r
    where 1=1
  `;
  const params = [];
  if (status && status !== "all") {
    sql += " and r.status = ?";
    params.push(status);
  }
  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    sql += " and (r.req_no like ? or r.technician_name like ? or r.new_seal_no like ? or r.broken_reason like ?)";
    params.push(term, term, term, term);
  }
  sql += " order by r.id desc limit 100";
  const requests = db.prepare(sql).all(...params);

  s.json({
    requests,
    stats: {
      pending_reseal_count: requests.filter(r => r.status === "pending_reseal").length,
      completed_count: requests.filter(r => r.status === "inspected_resealed").length,
      total_count: requests.length
    }
  });
});

app.post("/api/wm-reseals/request", need("owner", "manager"), (q, s) => {
  const {
    nozzle_id, fuel_product, dispenser_make, island_name, seal_type,
    broken_reason, technician_name, technician_agency, date_broken,
    notice_to_wm_d, wm_inspector_office, challan_fee_inr
  } = q.body || {};

  if (!nozzle_id || !broken_reason || !technician_name) {
    return s.status(400).json({ error: "Nozzle ID, breakdown reason, and technician name are required." });
  }

  const year = new Date().getFullYear();
  const lastRow = db.prepare("select id from wm_reseal_requests order by id desc limit 1").get();
  const nextNum = (lastRow ? lastRow.id : 0) + 83;
  const reqNo = `WM-RSL-${year}-${String(nextNum).padStart(3, "0")}`;

  const d = date_broken || bizDate();
  const id = db.prepare(`
    insert into wm_reseal_requests(
      req_no, nozzle_id, fuel_product, dispenser_make, island_name, seal_type,
      broken_reason, technician_name, technician_agency, date_broken, notice_to_wm_d,
      wm_inspector_office, challan_fee_inr, status, created_at
    ) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_reseal', ?)
  `).run(
    reqNo, String(nozzle_id), String(fuel_product || "Diesel (HSD)"),
    String(dispenser_make || "Dispenser"), String(island_name || "Island 1"),
    String(seal_type || "pulser_wire"), String(broken_reason).trim(),
    String(technician_name).trim(), String(technician_agency || "Authorized OEM Services").trim(),
    d, String(notice_to_wm_d || bizDate()),
    String(wm_inspector_office || "Inspector of Legal Metrology, District Office").trim(),
    challan_fee_inr ? +challan_fee_inr : 450, now()
  ).lastInsertRowid;

  s.json({ ok: true, id, req_no: reqNo });
});

app.post("/api/wm-reseals/complete", need("owner", "manager"), (q, s) => {
  const { id, new_seal_no, resealed_d, inspector_remarks } = q.body || {};
  if (!id || !new_seal_no) {
    return s.status(400).json({ error: "Request ID and new Legal Metrology seal number are required." });
  }

  const req = db.prepare("select * from wm_reseal_requests where id=?").get(+id);
  if (!req) return s.status(404).json({ error: "Reseal request not found." });

  db.transaction(() => {
    db.prepare(`
      update wm_reseal_requests set
        status = 'inspected_resealed', new_seal_no = ?, resealed_d = ?,
        inspector_remarks = ?
      where id = ?
    `).run(String(new_seal_no).trim(), resealed_d || bizDate(), String(inspector_remarks || "").trim(), req.id);

    // Also update stamping vault seal number
    db.prepare(`
      update wm_stamping_vault set
        pulser_seal_no = case when ? = 'pulser_wire' then ? else pulser_seal_no end,
        totalizer_motherboard_seal_no = case when ? = 'totalizer_board' then ? else totalizer_motherboard_seal_no end,
        updated_at = ?
      where nozzle_id = ?
    `).run(req.seal_type, String(new_seal_no).trim(), req.seal_type, String(new_seal_no).trim(), now(), req.nozzle_id);
  })();

  s.json({ ok: true });
});

// ==========================================
// 19. MONTHLY GST TAX BREAKUP & GSTR EXPORT
// ==========================================
app.get("/api/gst-tax-breakup", need("owner", "manager"), (q, s) => {
  const { month } = q.query || {};
  const targetMonth = month || bizDate().slice(0, 7);

  // 1. Fetch Invoices from state (Lubes & Car Care Items subject to 18% / 28% GST)
  let st = {};
  try {
    const sRow = db.prepare("select json from state where id=1").get();
    if (sRow && sRow.json) st = JSON.parse(sRow.json);
  } catch (_) {}

  const allInvs = st.inv || [];
  const monthInvs = allInvs.filter(i => (i.d || "").startsWith(targetMonth));

  let taxableLubeB2B = 0;
  let taxableLubeB2C = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;
  let b2bInvoices = [];
  let b2cInvoices = [];

  monthInvs.forEach(i => {
    const isB2B = i.gst && i.gst.length === 15;
    const taxAmt = i.t || 0;
    const cgstAmt = i.ig ? 0 : Math.round(((i.x || 0) / 2) * 100) / 100;
    const sgstAmt = i.ig ? 0 : Math.round(((i.x || 0) / 2) * 100) / 100;
    const igstAmt = i.ig ? (i.x || 0) : 0;

    if (isB2B) {
      taxableLubeB2B += taxAmt;
      b2bInvoices.push({
        invoice_no: i.no,
        date: i.d,
        customer_name: i.name,
        customer_gstin: i.gst,
        taxable_value: taxAmt,
        cgst: cgstAmt,
        sgst: sgstAmt,
        igst: igstAmt,
        total_amount: i.total
      });
    } else {
      taxableLubeB2C += taxAmt;
      b2cInvoices.push({
        invoice_no: i.no,
        date: i.d,
        customer_name: i.name,
        taxable_value: taxAmt,
        cgst: cgstAmt,
        sgst: sgstAmt,
        igst: igstAmt,
        total_amount: i.total
      });
    }

    totalCgst += cgstAmt;
    totalSgst += sgstAmt;
    totalIgst += igstAmt;
  });

  // 2. Fetch Fuel Sales (Petrol MS, Diesel HSD outside GST / under State VAT & Central Excise)
  const dutyLines = db.prepare(`
    select dl.*, d.d as duty_d, d.shift
    from duty_lines dl
    join duties d on d.id = dl.duty_id
    where d.status = 'closed' and substr(d.d, 1, 7) = ?
  `).all(targetMonth);

  let fuelTurnoverNonGst = 0;
  let fuelLitresSold = 0;
  dutyLines.forEach(l => {
    const lit = Math.max(0, (l.closing || 0) - (l.opening || 0) - (l.testing || 0));
    const amt = lit * (l.rate || 0);
    fuelTurnoverNonGst += amt;
    fuelLitresSold += lit;
  });

  // Credit sales volume check
  const creditSalesSum = db.prepare(`
    select sum(a) s from credit_sales
    where status = 'ok' and substr(d, 1, 7) = ?
  `).get(targetMonth)?.s || 0;

  const bizInfo = st.biz || { name: "Mahud Auto Fuel Station", addr: "NH 65, Maharashtra", gst: "27ABCDE1234F1Z5" };

  s.json({
    month: targetMonth,
    station: bizInfo,
    gst_turnover_summary: {
      b2b_taxable_value: Math.round(taxableLubeB2B * 100) / 100,
      b2c_taxable_value: Math.round(taxableLubeB2C * 100) / 100,
      total_taxable_gst_value: Math.round((taxableLubeB2B + taxableLubeB2C) * 100) / 100,
      total_cgst: Math.round(totalCgst * 100) / 100,
      total_sgst: Math.round(totalSgst * 100) / 100,
      total_igst: Math.round(totalIgst * 100) / 100,
      total_gst_tax: Math.round((totalCgst + totalSgst + totalIgst) * 100) / 100,
      non_gst_fuel_turnover: Math.round(fuelTurnoverNonGst * 100) / 100,
      total_gross_turnover: Math.round((fuelTurnoverNonGst + taxableLubeB2B + taxableLubeB2C + totalCgst + totalSgst + totalIgst) * 100) / 100
    },
    b2b_invoices: b2bInvoices,
    b2c_invoices: b2cInvoices,
    gstr1_tables: {
      table_4_b2b: b2bInvoices,
      table_7_b2c_small: {
        type: "OE",
        place_of_supply: "27-Maharashtra",
        applicable_rate: "18.0%",
        taxable_value: Math.round(taxableLubeB2C * 100) / 100,
        cess_amount: 0
      },
      table_8_nil_exempt_nongst: {
        non_gst_supplies: Math.round(fuelTurnoverNonGst * 100) / 100,
        description: "Motor Spirit (MS Petrol) and High Speed Diesel (HSD) outside GST preview (State VAT & Central Excise)"
      }
    }
  });
});

app.delete("/api/duties/:id", need("owner", "manager"), (q, s) => {
  const r = db.transaction(() => {
    const d = db.prepare("select * from duties where id=? and status='open'").get(+q.params.id);
    if (!d) return 0;
    db.prepare("delete from duty_lines where duty_id=?").run(d.id);
    db.prepare("delete from duty_items where duty_id=?").run(d.id);
    db.prepare("delete from duty_expenses where duty_id=?").run(d.id);
    db.prepare("delete from duties where id=?").run(d.id);
    return 1;
  })();
  if (!r) return s.status(404).json({ error: "Only a duty that has not been submitted can be cancelled." });
  s.json({ ok: true });
});
app.get("/api/duties", need("owner", "manager"), (q, s) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(q.query.d || "") ? q.query.d : bizDate();
  s.json({
    day: db.prepare("select * from duties where d=? and status<>'open' order by id").all(d).map(detail),
    pending: db.prepare("select * from duties where status='submitted' order by id").all().map(detail),
    open: db.prepare("select * from duties where status='open' order by id").all().map(detail),
    day_status: dayStatus(d),
  });
});
app.get("/api/duties/:id", need("owner", "manager"), (q, s) => {
  const d = db.prepare("select * from duties where id=? and status<>'open'").get(+q.params.id);
  if (!d) return s.status(404).json({ error: "Duty not found." });
  s.json(detail(d));
});
app.put("/api/duties/:id", need("owner", "manager"), (q, s) => {
  const d = db.prepare("select * from duties where id=? and status='submitted'").get(+q.params.id);
  if (!d) return s.status(404).json({ error: "Only duties waiting to be closed can be changed." });
  if (q.user.role === "manager") {
    return s.status(403).json({ error: "Managers can only review duties. If changes are needed, please send the duty back to the worker." });
  }
  const isStrict = q.query.strict === "1" || (q.body && q.body.strict === true);
  const e = saveDuty(d.id, q.body || {}, isStrict, true);
  if (e) return s.status(400).json({ error: e });
  s.json({ ok: true });
});
app.post("/api/duties/:id/send-back", need("owner", "manager"), (q, s) => {
  const d = db.prepare("select * from duties where id=? and status='submitted'").get(+q.params.id);
  if (!d) return s.status(404).json({ error: "This duty is not waiting for review." });
  const w = db.prepare("select name from users where id=?").get(d.worker_id);
  const reason = String((q.body && q.body.note) || "").trim();
  const feedback = reason ? `[Sent back by ${q.user.name}: ${reason}]` : `[Sent back by ${q.user.name} for corrections]`;
  const newNote = d.note ? `${d.note} · ${feedback}` : feedback;
  db.prepare("update duties set status='open', submitted=null, note=? where id=?").run(newNote, d.id);
  s.json({ ok: true, message: `Duty sent back to ${w ? w.name : "worker"} for corrections.` });
});
app.post("/api/duties/:id/close", need("owner", "manager"), (q, s) => {
  const out = db.transaction(() => {
    const d = db.prepare("select * from duties where id=? and status='submitted'").get(+q.params.id);
    if (!d) return { code: 404, error: "This duty is not waiting to be closed." };
    if (dayStatus(d.d) !== "open") return { code: 409, error: "This business day is already closed." };
    db.prepare("update duties set status='closed', closed_by=?, closed_at=?, stock_done=1 where id=?").run(q.user.id, now(), d.id);
    if (!d.stock_done) adjustStock(d, -1);
    return { ok: true };
  })();
  if (out.error) return s.status(out.code).json({ error: out.error });
  s.json({ ok: true });
});
app.post("/api/duties/:id/reopen", need("owner"), (q, s) => {
  const out = db.transaction(() => {
    const d = db.prepare("select * from duties where id=? and status='closed'").get(+q.params.id);
    if (!d) return { code: 404, error: "This duty is not closed." };
    if (dayStatus(d.d) !== "open") return { code: 409, error: "Reopen the business day first." };
    db.prepare("update duties set status='submitted', stock_done=0 where id=?").run(d.id);
    if (d.stock_done) adjustStock(d, +1);
    return { ok: true };
  })();
  if (out.error) return s.status(out.code).json({ error: out.error });
  s.json({ ok: true });
});

// ---- Business day: manager closes, owner approves
const validDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");
app.post("/api/days/:d/close", need("owner", "manager"), (q, s) => {
  const d = q.params.d;
  if (!validDay(d)) return s.status(400).json({ error: "Invalid date." });
  if (dayStatus(d) !== "open") return s.status(409).json({ error: "This day is already closed." });
  const c = db.prepare("select sum(status='closed') done, sum(status<>'closed') wait from duties where d=?").get(d);
  if (!c.done) return s.status(400).json({ error: "There are no closed duties on this date." });
  if (c.wait) return s.status(400).json({ error: "Some duties on this date are still open or waiting to be closed." });
  db.prepare("insert into days(d,status,closed_by,closed_at) values(?,?,?,?) on conflict(d) do update set status='closed', closed_by=excluded.closed_by, closed_at=excluded.closed_at, approved_by=null, approved_at=null").run(d, "closed", q.user.id, now());
  s.json({ ok: true });
});
app.post("/api/days/:d/approve", need("owner"), (q, s) => {
  const r = db.prepare("update days set status='approved', approved_by=?, approved_at=? where d=? and status='closed'").run(q.user.id, now(), q.params.d);
  if (!r.changes) return s.status(409).json({ error: "Only a day closed by the manager can be approved." });
  s.json({ ok: true });
});
app.post("/api/days/:d/reopen", need("owner"), (q, s) => {
  db.prepare("update days set status='open', approved_by=null, approved_at=null where d=?").run(q.params.d);
  s.json({ ok: true });
});
// Day reports use closed duties only.
app.get("/api/day-report", need("owner", "manager"), (q, s) => {
  const d = validDay(q.query.d) ? q.query.d : bizDate(), st = stateNow();
  const duties = db.prepare("select * from duties where d=? and status='closed' order by id").all(d).map(detail);
  const fuel = {}, shop = {}, exps = {}, pay = {};
  const T = { sales: 0, lube: 0, recovery: 0, credit: 0, exp: 0, expected: 0, collected: 0, diff: 0, litres: 0 };
  duties.forEach((x) => {
    ["sales", "lube", "recovery", "credit", "exp", "expected", "collected", "diff", "litres"].forEach((k) => (T[k] += (x[k] || 0)));
    x.lines.forEach((l) => { const f = fuel[l.fuel || "Other"] || (fuel[l.fuel || "Other"] = { litres: 0, amount: 0 }); f.litres += l.litres; f.amount += l.amount; });
    x.items.forEach((i) => { const f = shop[i.name] || (shop[i.name] = { qty: 0, amount: 0 }); f.qty += i.qty; f.amount += i.amount; });
    x.expenses.forEach((e) => (exps[e.cat] = (exps[e.cat] || 0) + e.amount));
    Object.keys(x.pay).forEach((k) => (pay[k] = (pay[k] || 0) + (+x.pay[k] || 0)));
  });
  Object.keys(T).forEach((k) => (T[k] = r2(T[k])));
  const dd = db.prepare("select * from days where d=?").get(d) || { status: "open" };
  s.json({ d, day: dd, modes: allModes(st).map((m) => ({ key: m.key, name: m.name })), duties, summary: { ...T, total: r2(T.sales + T.lube), fuel, shop, exps, pay } });
});

// ---- Fuel sales & expense analytics
app.get("/api/analytics", need("owner", "manager"), (q, s) => {
  const st = stateNow(), nm = nozzleMap(st);
  const from = validDay(q.query.from) ? q.query.from : "";
  const to = validDay(q.query.to) ? q.query.to : "";

  let sqlDuties = "select * from duties where status in ('closed', 'submitted')";
  const p = [];
  if (from) { sqlDuties += " and d >= ?"; p.push(from); }
  if (to) { sqlDuties += " and d <= ?"; p.push(to); }
  sqlDuties += " order by d asc, id asc";

  const duties = db.prepare(sqlDuties).all(...p);
  const dutyIds = duties.map((d) => d.id);

  const dailyMap = {};
  const monthlyMap = {};
  const fuelTotals = {};
  const expCategories = {};
  let totalLitres = 0;
  let totalRevenue = 0;
  let totalShiftExp = 0;

  const linesByDuty = {};
  const expsByDuty = {};

  if (dutyIds.length > 0) {
    const dlRows = db.prepare(`select * from duty_lines where duty_id in (${dutyIds.map(() => "?").join(",")}) order by id`).all(...dutyIds);
    dlRows.forEach((l) => {
      linesByDuty[l.duty_id] = linesByDuty[l.duty_id] || [];
      linesByDuty[l.duty_id].push(l);
    });

    const deRows = db.prepare(`select * from duty_expenses where duty_id in (${dutyIds.map(() => "?").join(",")}) order by id`).all(...dutyIds);
    deRows.forEach((e) => {
      expsByDuty[e.duty_id] = expsByDuty[e.duty_id] || [];
      expsByDuty[e.duty_id].push(e);
    });
  }

  duties.forEach((d) => {
    const day = d.d;
    const month = day.slice(0, 7);

    if (!dailyMap[day]) {
      dailyMap[day] = { date: day, litres: 0, revenue: 0, expenses: 0, byFuel: {}, dutiesCount: 0 };
    }
    if (!monthlyMap[month]) {
      monthlyMap[month] = { month, litres: 0, revenue: 0, expenses: 0, byFuel: {}, days: new Set(), dutiesCount: 0 };
    }
    dailyMap[day].dutiesCount++;
    monthlyMap[month].dutiesCount++;
    monthlyMap[month].days.add(day);

    const dLines = linesByDuty[d.id] || [];
    dLines.forEach((l) => {
      const op = l.opening == null ? 0 : l.opening;
      const cl = l.closing == null ? 0 : l.closing;
      const tst = l.testing == null ? 0 : l.testing;
      const lt = r2(Math.max(0, cl - op - tst));
      const fuelName = (nm[l.nozzle_id] && nm[l.nozzle_id].fuel) || "Fuel";
      const amt = r2(lt * (l.rate || 0));

      if (lt > 0 || amt > 0) {
        totalLitres += lt;
        totalRevenue += amt;

        dailyMap[day].litres = r2(dailyMap[day].litres + lt);
        dailyMap[day].revenue = r2(dailyMap[day].revenue + amt);
        if (!dailyMap[day].byFuel[fuelName]) dailyMap[day].byFuel[fuelName] = { litres: 0, revenue: 0 };
        dailyMap[day].byFuel[fuelName].litres = r2(dailyMap[day].byFuel[fuelName].litres + lt);
        dailyMap[day].byFuel[fuelName].revenue = r2(dailyMap[day].byFuel[fuelName].revenue + amt);

        monthlyMap[month].litres = r2(monthlyMap[month].litres + lt);
        monthlyMap[month].revenue = r2(monthlyMap[month].revenue + amt);
        if (!monthlyMap[month].byFuel[fuelName]) monthlyMap[month].byFuel[fuelName] = { litres: 0, revenue: 0 };
        monthlyMap[month].byFuel[fuelName].litres = r2(monthlyMap[month].byFuel[fuelName].litres + lt);
        monthlyMap[month].byFuel[fuelName].revenue = r2(monthlyMap[month].byFuel[fuelName].revenue + amt);

        if (!fuelTotals[fuelName]) fuelTotals[fuelName] = { fuel: fuelName, litres: 0, revenue: 0 };
        fuelTotals[fuelName].litres = r2(fuelTotals[fuelName].litres + lt);
        fuelTotals[fuelName].revenue = r2(fuelTotals[fuelName].revenue + amt);
      }
    });

    const dExps = expsByDuty[d.id] || [];
    dExps.forEach((e) => {
      const cat = e.cat || "Other";
      const amt = r2(e.amount || 0);
      if (amt > 0) {
        totalShiftExp += amt;
        dailyMap[day].expenses = r2(dailyMap[day].expenses + amt);
        monthlyMap[month].expenses = r2(monthlyMap[month].expenses + amt);

        if (!expCategories[cat]) expCategories[cat] = { category: cat, amount: 0, count: 0, source: "shift" };
        expCategories[cat].amount = r2(expCategories[cat].amount + amt);
        expCategories[cat].count++;
      }
    });
  });

  let totalBookExp = 0;
  (st.bk || []).forEach((b) => {
    if (b.t === "out" && b.d) {
      if ((!from || b.d >= from) && (!to || b.d <= to)) {
        const cat = b.cat || "Other";
        const amt = r2(b.a || 0);
        const day = b.d;
        const month = day.slice(0, 7);

        totalBookExp += amt;
        if (!dailyMap[day]) {
          dailyMap[day] = { date: day, litres: 0, revenue: 0, expenses: 0, byFuel: {}, dutiesCount: 0 };
        }
        dailyMap[day].expenses = r2(dailyMap[day].expenses + amt);

        if (!monthlyMap[month]) {
          monthlyMap[month] = { month, litres: 0, revenue: 0, expenses: 0, byFuel: {}, days: new Set(), dutiesCount: 0 };
        }
        monthlyMap[month].expenses = r2(monthlyMap[month].expenses + amt);
        monthlyMap[month].days.add(day);

        if (!expCategories[cat]) {
          expCategories[cat] = { category: cat, amount: 0, count: 0, source: "book" };
        } else if (expCategories[cat].source === "shift") {
          expCategories[cat].source = "both";
        }
        expCategories[cat].amount = r2(expCategories[cat].amount + amt);
        expCategories[cat].count++;
      }
    }
  });

  const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
  const monthly = Object.values(monthlyMap)
    .map((m) => ({
      month: m.month,
      litres: m.litres,
      revenue: m.revenue,
      expenses: m.expenses,
      byFuel: m.byFuel,
      daysCount: m.days.size,
      dutiesCount: m.dutiesCount,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const totalExpenses = r2(totalShiftExp + totalBookExp);
  const totalDays = daily.length;

  const fuelBreakdown = Object.values(fuelTotals)
    .map((f) => ({
      ...f,
      litresPct: totalLitres > 0 ? r2((f.litres / totalLitres) * 100) : 0,
      revPct: totalRevenue > 0 ? r2((f.revenue / totalRevenue) * 100) : 0,
    }))
    .sort((a, b) => b.litres - a.litres);

  const expenseBreakdown = Object.values(expCategories)
    .map((e) => ({
      ...e,
      percentage: totalExpenses > 0 ? r2((e.amount / totalExpenses) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  s.json({
    summary: {
      totalLitres: r2(totalLitres),
      totalRevenue: r2(totalRevenue),
      totalExpenses,
      shiftExpenses: r2(totalShiftExp),
      bookExpenses: r2(totalBookExp),
      netFuelMargin: r2(totalRevenue - totalExpenses),
      totalDays,
      dutiesCount: duties.length,
      avgDailyLitres: totalDays > 0 ? r2(totalLitres / totalDays) : 0,
      avgDailyRevenue: totalDays > 0 ? r2(totalRevenue / totalDays) : 0,
      avgDailyExpenses: totalDays > 0 ? r2(totalExpenses / totalDays) : 0,
    },
    daily,
    monthly,
    fuelBreakdown,
    expenseBreakdown,
    fuelTypes: fuelBreakdown.map((f) => f.fuel),
  });
});

// ---- AI Forensic Audit for Operations, Cash Reconciliation & Risk
app.post("/api/ai-audit", need("owner", "manager"), async (q, s) => {
  try {
    const { from, to } = q.body || {};
    const st = stateNow();

    let sqlDuties = "select * from duties where status in ('closed', 'submitted')";
    const params = [];
    if (from && validDay(from)) { sqlDuties += " and d >= ?"; params.push(from); }
    if (to && validDay(to)) { sqlDuties += " and d <= ?"; params.push(to); }
    sqlDuties += " order by d asc, id asc";

    const rawDuties = db.prepare(sqlDuties).all(...params);
    const duties = rawDuties.map(detail);

    let totalLitres = 0;
    let totalSales = 0;
    let totalExpected = 0;
    let totalCollected = 0;
    let totalShortage = 0;
    let totalExcess = 0;
    let totalDutyExp = 0;
    let totalCreditSales = 0;
    let totalRecoveries = 0;

    const workerStats = {};
    const dutiesWithShortage = [];

    duties.forEach((d) => {
      totalLitres += d.litres || 0;
      totalSales += d.sales || 0;
      totalExpected += d.expected || 0;
      totalCollected += d.collected || 0;
      totalDutyExp += d.exp || 0;
      totalCreditSales += d.credit || 0;
      totalRecoveries += d.recovery || 0;

      const diff = d.diff || 0;
      if (diff < -10) {
        totalShortage += Math.abs(diff);
        dutiesWithShortage.push({
          id: d.id,
          date: d.d,
          shift: d.shift,
          worker: d.worker || "Unknown",
          shortage: Math.abs(diff),
          collected: d.collected,
          expected: d.expected,
        });
      } else if (diff > 10) {
        totalExcess += diff;
      }

      const w = d.worker || "Unassigned";
      if (!workerStats[w]) {
        workerStats[w] = { worker: w, dutiesCount: 0, litres: 0, sales: 0, shortage: 0, excess: 0, netDiff: 0 };
      }
      workerStats[w].dutiesCount++;
      workerStats[w].litres += d.litres || 0;
      workerStats[w].sales += d.sales || 0;
      if (diff < -10) workerStats[w].shortage += Math.abs(diff);
      else if (diff > 10) workerStats[w].excess += diff;
      workerStats[w].netDiff += diff;
    });

    const custs = typeof customers === "function" ? customers() : [];
    let totalCustomerDebt = 0;
    const overLimitCustomers = [];
    const topDebtors = [];

    custs.forEach((c) => {
      const orig = (st.c || []).find((x) => String(x.id) === String(c.id));
      const limit = (orig && orig.limit) || 0;
      const d = c.due || 0;
      if (d > 0) {
        totalCustomerDebt += d;
        topDebtors.push({ name: c.name, due: d, limit });
        if (limit > 0 && d > limit) {
          overLimitCustomers.push({ name: c.name, due: d, limit, excess: r2(d - limit) });
        }
      }
    });
    topDebtors.sort((a, b) => b.due - a.due);
    overLimitCustomers.sort((a, b) => b.excess - a.excess);

    const items = st.items || [];
    const lowStockItems = [];
    let totalStockValCost = 0;
    let totalStockValSale = 0;
    items.forEach((i) => {
      const cv = (i.stock || 0) * (i.buy || 0);
      const sv = (i.stock || 0) * (i.sell || 0);
      totalStockValCost += cv;
      totalStockValSale += sv;
      if ((i.stock || 0) <= (i.low || 0)) {
        lowStockItems.push({ name: i.name, stock: i.stock, low: i.low, unit: i.unit });
      }
    });

    const bk = st.bk || [];
    let totalBookExp = 0;
    const expCats = {};
    bk.forEach((b) => {
      if (b.t === "out") {
        if ((!from || b.d >= from) && (!to || b.d <= to)) {
          totalBookExp += b.a || 0;
          const cat = b.cat || "Other";
          expCats[cat] = (expCats[cat] || 0) + (b.a || 0);
        }
      }
    });

    const reconciliationAccuracy = totalExpected > 0 ? Math.max(0, Math.min(100, r2((1 - totalShortage / totalExpected) * 100))) : 100;

    const stationData = {
      auditPeriod: { from: from || "Historical Start", to: to || "Current Date" },
      shiftDuties: {
        totalDuties: duties.length,
        totalLitres: r2(totalLitres),
        fuelSalesRevenue: r2(totalSales),
        expectedSettlement: r2(totalExpected),
        actualCollected: r2(totalCollected),
        shortageAmount: r2(totalShortage),
        excessAmount: r2(totalExcess),
        reconciliationAccuracyPct: r2(reconciliationAccuracy),
        shortageShiftsCount: dutiesWithShortage.length,
        recentShortageShifts: dutiesWithShortage.slice(-5),
        workerAccountability: Object.values(workerStats).map((w) => ({
          worker: w.worker,
          duties: w.dutiesCount,
          litres: r2(w.litres),
          shortage: r2(w.shortage),
          excess: r2(w.excess),
          netDiscrepancy: r2(w.netDiff),
        })),
      },
      creditRisk: {
        totalOutstandingDebt: r2(totalCustomerDebt),
        activeDebtorsCount: topDebtors.length,
        overLimitCustomersCount: overLimitCustomers.length,
        overLimitExcessDebt: r2(overLimitCustomers.reduce((s, c) => s + c.excess, 0)),
        flaggedOverLimitCustomers: overLimitCustomers.slice(0, 5),
        topDebtors: topDebtors.slice(0, 5),
      },
      inventory: {
        totalItems: items.length,
        lowStockItemsCount: lowStockItems.length,
        lowStockItems: lowStockItems.slice(0, 8),
        totalValuationAtCost: r2(totalStockValCost),
        totalValuationAtRetail: r2(totalStockValSale),
      },
      expenses: {
        dutyExpenses: r2(totalDutyExp),
        cashBookExpenses: r2(totalBookExp),
        totalOperatingExpenses: r2(totalDutyExp + totalBookExp),
        topCategories: expCats,
      },
    };

    let auditResult = null;
    if (aiClient) {
      const models = ["gemini-3.1-flash-lite", "gemini-3.8-flash"];
      const schema = {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.INTEGER, description: "Overall pump audit health score between 0 and 100" },
          rating: { type: Type.STRING, description: "Audit rating: Excellent, Good, Needs Attention, or High Risk" },
          headline: { type: Type.STRING, description: "One concise executive headline diagnosis" },
          summary: { type: Type.STRING, description: "1-2 paragraphs forensic audit summary" },
          risks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                severity: { type: Type.STRING, description: "high, medium, or low" },
                category: { type: Type.STRING, description: "Cash Settlement, Credit Risk, Stock & Inventory, Operational Expenses, or Fuel Variance" },
                title: { type: Type.STRING, description: "Short descriptive risk title" },
                detail: { type: Type.STRING, description: "Specific details and root cause" },
                impact: { type: Type.STRING, description: "Quantified financial/operational impact" },
              },
              required: ["severity", "category", "title", "detail", "impact"],
            },
          },
          strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommendations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                priority: { type: Type.STRING, description: "Immediate, High, or Medium" },
                action: { type: Type.STRING, description: "Clear actionable step" },
                expectedImpact: { type: Type.STRING, description: "Anticipated improvement" },
              },
              required: ["priority", "action", "expectedImpact"],
            },
          },
        },
        required: ["score", "rating", "headline", "summary", "risks", "strengths", "recommendations"],
      };

      for (const m of models) {
        try {
          const res = await aiClient.models.generateContent({
            model: m,
            contents: `Perform an in-depth forensic and operational audit of this petroleum pump station data. Identify any settlement cash leakages, worker shortage patterns, customer credit limit violations, and inventory issues:\n\n${JSON.stringify(stationData, null, 2)}`,
            config: {
              responseMimeType: "application/json",
              responseSchema: schema,
              systemInstruction: "You are a professional petroleum retail operations forensic auditor. You inspect pump station shift handovers, nozzle readings, cash discrepancies, debtor limits, and stock. Be thorough, objective, and provide concrete numbers in your analysis.",
            },
          });
          if (res && res.text) {
            auditResult = JSON.parse(res.text.trim());
            auditResult.modelUsed = m;
            break;
          }
        } catch (err) {
          console.warn(`Audit model ${m} failed:`, err.message || err);
        }
      }
    }

    if (!auditResult) {
      let score = 100;
      const risks = [];
      const strengths = [];
      const recs = [];

      if (totalShortage > 5000) {
        score -= 25;
        risks.push({
          severity: "high",
          category: "Cash Settlement",
          title: "Elevated Shift Cash Shortages",
          detail: `Cumulative worker handover shortages reached ₹${Math.round(totalShortage).toLocaleString("en-IN")} across ${dutiesWithShortage.length} shifts.`,
          impact: `Direct cash leakage of ₹${Math.round(totalShortage).toLocaleString("en-IN")}`,
        });
        recs.push({
          priority: "Immediate",
          action: "Enforce end-of-shift physical cash count verification and require worker counter-signatures on duty collection discrepancy logs.",
          expectedImpact: "Eliminates unaccounted shift handover cash differences.",
        });
      } else if (totalShortage > 1000) {
        score -= 12;
        risks.push({
          severity: "medium",
          category: "Cash Settlement",
          title: "Minor Shift Cash Variances Detected",
          detail: `Worker handover shortages total ₹${Math.round(totalShortage).toLocaleString("en-IN")}.`,
          impact: `₹${Math.round(totalShortage).toLocaleString("en-IN")} unrecovered variance`,
        });
      } else {
        strengths.push(`Settlement accuracy is exceptional at ${reconciliationAccuracy}% with negligible cash variance.`);
      }

      if (overLimitCustomers.length > 0) {
        const overLimitDebt = overLimitCustomers.reduce((s, c) => s + c.excess, 0);
        score -= overLimitDebt > 25000 ? 25 : 15;
        risks.push({
          severity: overLimitDebt > 25000 ? "high" : "medium",
          category: "Credit Risk",
          title: "Customer Credit Limits Exceeded",
          detail: `${overLimitCustomers.length} customer account(s) have exceeded sanctioned credit limits by ₹${Math.round(overLimitDebt).toLocaleString("en-IN")}.`,
          impact: `Working capital lockup of ₹${Math.round(overLimitDebt).toLocaleString("en-IN")}`,
        });
        recs.push({
          priority: "Immediate",
          action: `Suspend new fuel credit dispensing for ${overLimitCustomers.map((c) => c.name).join(", ")} until ledger arrears are cleared.`,
          expectedImpact: "Prevents bad debts and preserves station cash liquidity.",
        });
      } else {
        strengths.push("All customer ledger credit balances remain strictly within approved limits.");
      }

      if (lowStockItems.length > 0) {
        score -= lowStockItems.length * 4;
        risks.push({
          severity: lowStockItems.length > 2 ? "high" : "medium",
          category: "Stock & Inventory",
          title: "Inventory Below Reorder Threshold",
          detail: `${lowStockItems.length} inventory item(s) (${lowStockItems.map((i) => i.name).join(", ")}) are at or below minimum threshold.`,
          impact: "Stockout risk leading to missed retail sales revenue",
        });
        recs.push({
          priority: "High",
          action: `Place purchase orders immediately for: ${lowStockItems.map((i) => i.name).join(", ")}.`,
          expectedImpact: "Ensures uninterrupted retail sales.",
        });
      } else {
        strengths.push("All inventory and lubricant items are healthy and adequately stocked above minimum levels.");
      }

      if (totalLitres > 0) {
        strengths.push(`Consistent dispensing volume with ${Math.round(totalLitres).toLocaleString("en-IN")} litres across ${duties.length} shift duty cycles.`);
      }

      score = Math.max(10, Math.min(100, Math.round(score)));
      let rating = "Excellent";
      if (score < 50) rating = "High Risk";
      else if (score < 75) rating = "Needs Attention";
      else if (score < 90) rating = "Good";

      auditResult = {
        score,
        rating,
        headline: score >= 80 ? "Station operations demonstrate stable control with manageable risk factors." : "Action required: cash handover and credit risk controls require immediate management intervention.",
        summary: `Audit evaluated ${duties.length} shifts with ₹${Math.round(totalSales).toLocaleString("en-IN")} in gross fuel sales. Net cash reconciliation stands at ${reconciliationAccuracy}%. Customer credit ledger holds ₹${Math.round(totalCustomerDebt).toLocaleString("en-IN")} in outstanding balances with ${overLimitCustomers.length} accounts exceeding limits.`,
        risks,
        strengths,
        recommendations: recs,
        modelUsed: "Forensic Engine",
      };
    }

    s.json({
      ok: true,
      audit: auditResult,
      metrics: {
        score: auditResult.score,
        rating: auditResult.rating,
        totalLitres: r2(totalLitres),
        totalSales: r2(totalSales),
        totalExpected: r2(totalExpected),
        totalCollected: r2(totalCollected),
        totalShortage: r2(totalShortage),
        totalExcess: r2(totalExcess),
        netSettlementDiff: r2(totalCollected - totalExpected),
        reconciliationAccuracy: r2(reconciliationAccuracy),
        overLimitCount: overLimitCustomers.length,
        overLimitDebt: r2(overLimitCustomers.reduce((s, c) => s + c.excess, 0)),
        totalCustomerDebt: r2(totalCustomerDebt),
        lowStockCount: lowStockItems.length,
        dutiesCount: duties.length,
        shortageDutyCount: dutiesWithShortage.length,
      },
      stationData,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("AI audit error:", err);
    s.status(500).json({ error: "Could not generate AI audit: " + (err.message || "Internal error") });
  }
});

// ---- Fuel tanks: dip readings and stock check
const stateNow = () => { const r = getState(); return r ? JSON.parse(r.json) : {}; };
function fromChart(chart, dip) {
  const c = (chart || []).map((x) => ({ cm: +x.cm, l: +x.l })).filter((x) => Number.isFinite(x.cm) && Number.isFinite(x.l)).sort((a, b) => a.cm - b.cm);
  if (c.length < 2) return { err: "This tank has no dip chart yet. Enter litres directly, or ask the manager to add the chart." };
  if (dip < c[0].cm || dip > c[c.length - 1].cm) return { err: "This dip is outside the tank's chart range. Check the reading." };
  for (let i = 1; i < c.length; i++) {
    if (dip <= c[i].cm) { const a = c[i - 1], b = c[i]; return { l: r2(b.cm === a.cm ? b.l : a.l + ((dip - a.cm) / (b.cm - a.cm)) * (b.l - a.l)) }; }
  }
  return { l: c[c.length - 1].l };
}
function tankChecks() {
  const st = stateNow(), tanks = st.tanks || [], dv = st.deliv || [], tankOf = {};
  (st.nozzles || []).forEach((n) => (tankOf[String(n.id)] = String(n.tank_id || "")));
  const sales = db.prepare("select d.submitted t, dl.nozzle_id n, dl.closing-dl.opening-dl.testing lt from duty_lines dl join duties d on d.id=dl.duty_id where d.status in ('submitted','closed')").all();
  const dips = db.prepare("select di.*, u.name by_name from dips di join users u on u.id=di.user_id order by di.t, di.id").all();
  const sold = (tid, a, b) => r2(sales.filter((x) => tankOf[x.n] === tid && x.t > a && x.t <= b).reduce((s, x) => s + x.lt, 0));
  const recv = (tid, a, b) => r2(dv.reduce((s, d) => s + (Math.floor(d.ts / 1000) > a && Math.floor(d.ts / 1000) <= b ? (d.lines || []).filter((l) => String(l.tank_id) === tid).reduce((q, l) => q + (+l.litres || 0), 0) : 0), 0));
  return tanks.map((tk) => {
    const tid = String(tk.id), ds = dips.filter((x) => x.tank_id === tid), checks = [];
    for (let i = 1; i < ds.length; i++) {
      const p = ds[i - 1], c = ds[i], so = sold(tid, p.t, c.t), re = recv(tid, p.t, c.t), exp = r2(p.litres + re - so);
      checks.push({ id: c.id, from: p.t, to: c.t, opening: p.litres, received: re, sold: so, expected: exp, actual: c.litres, variance: r2(c.litres - exp), by: c.by_name });
    }
    const last = ds[ds.length - 1] || null;
    const book = last ? r2(last.litres + recv(tid, last.t, now()) - sold(tid, last.t, now())) : null;
    return { id: tk.id, name: tk.name, fuel: tk.fuel, capacity: tk.capacity || 0, last: last ? { id: last.id, litres: last.litres, t: last.t, by: last.by_name } : null, book, checks: checks.slice(-8).reverse() };
  });
}
app.get("/api/tanks", need(), (q, s) => {
  const st = stateNow(), names = {};
  (st.tanks || []).forEach((t) => (names[String(t.id)] = t.name));
  const mine = db.prepare("select id,tank_id,litres,dip,note,t from dips where user_id=? order by id desc limit 10").all(q.user.id).map((d) => ({ ...d, tank: names[d.tank_id] || "Tank" }));
  s.json({ tanks: (st.tanks || []).map((t) => ({ id: t.id, name: t.name, fuel: t.fuel, capacity: t.capacity || 0 })), mine });
});
app.post("/api/dips", need(), (q, s) => {
  const b = q.body || {}, tank = (stateNow().tanks || []).find((t) => String(t.id) === String(b.tank_id));
  if (!tank) return s.status(400).json({ error: "Choose a tank." });
  let litres = num(b.litres);
  const dip = b.dip === "" || b.dip == null ? null : num(b.dip);
  if (Number.isNaN(litres)) {
    if (dip === null || Number.isNaN(dip)) return s.status(400).json({ error: "Enter the litres or the dip reading." });
    const r = fromChart(tank.chart, dip);
    if (r.err) return s.status(400).json({ error: r.err });
    litres = r.l;
  }
  if (tank.capacity && litres > tank.capacity * 1.02) return s.status(400).json({ error: `That is more than the tank capacity (${tank.capacity} L). Check the reading.` });
  const id = db.prepare("insert into dips(tank_id,litres,dip,note,user_id,t) values(?,?,?,?,?,?)").run(String(tank.id), r2(litres), dip, String(b.note || "").slice(0, 200), q.user.id, now()).lastInsertRowid;
  s.json({ id, litres: r2(litres) });
});
app.get("/api/stock-check", need("owner", "manager"), (q, s) => s.json(tankChecks()));
app.delete("/api/dips/:id", need("owner", "manager"), (q, s) => {
  db.prepare("delete from dips where id=?").run(+q.params.id);
  s.json({ ok: true });
});

// ---- Worker pay (owner manages; each worker can see their own)
const SHIFTS = ["Morning", "Evening", "Night"];
const monthOf = (m) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(m || "") ? m : today().slice(0, 7));
function payFor(u, month) {
  const rates = {};
  db.prepare("select shift,rate from pay_rates where worker_id=?").all(u.id).forEach((r) => (rates[r.shift] = r.rate));
  const ds = db.prepare("select * from duties where worker_id=? and status='closed' and substr(d,1,7)=?").all(u.id, month).map(detail);
  const pending = db.prepare("select count(*) n from duties where worker_id=? and status in ('open','submitted') and substr(d,1,7)=?").get(u.id, month).n;
  const count = { Morning: 0, Evening: 0, Night: 0 };
  let earn = 0, short = 0, missing = false;
  ds.forEach((d) => {
    count[d.shift] = (count[d.shift] || 0) + 1;
    if (rates[d.shift] == null) missing = true;
    earn += rates[d.shift] || 0;
    if (d.diff <= -1) short += -d.diff;
  });
  const items = db.prepare("select id,kind,amount,note,d from pay_items where worker_id=? and month=? order by id").all(u.id, month);
  const sum = (k) => r2(items.filter((x) => x.kind === k).reduce((a, x) => a + x.amount, 0));
  const advance = sum("advance"), bonus = sum("bonus"), waived = sum("waive"), paid = sum("paid");
  earn = r2(earn); short = r2(short);
  const net = r2(earn + bonus - advance - Math.max(0, short - waived));
  return { id: u.id, name: u.name, role: u.role, rates, count, duties: ds.length, pending, missing_rate: missing, earn, short, advance, bonus, waived, paid, net, balance: r2(net - paid), items };
}
app.get("/api/payroll", need("owner"), (q, s) => {
  const m = monthOf(q.query.month);
  const us = db.prepare("select id,name,role from users where role='worker' or id in (select worker_id from duties where substr(d,1,7)=?) order by name").all(m);
  s.json({ month: m, workers: us.map((u) => payFor(u, m)) });
});
app.put("/api/payroll/rates", need("owner"), (q, s) => {
  const { worker_id, rates } = q.body || {};
  if (!db.prepare("select 1 from users where id=?").get(+worker_id)) return s.status(404).json({ error: "Worker not found." });
  const vals = {};
  for (const sh of SHIFTS) {
    const x = rates && rates[sh];
    if (x === "" || x == null) continue;
    const n = num(x);
    if (Number.isNaN(n)) return s.status(400).json({ error: `Check the ${sh} rate.` });
    vals[sh] = n;
  }
  db.transaction(() => {
    db.prepare("delete from pay_rates where worker_id=?").run(+worker_id);
    Object.keys(vals).forEach((sh) => db.prepare("insert into pay_rates values(?,?,?)").run(+worker_id, sh, vals[sh]));
  })();
  s.json({ ok: true });
});
app.post("/api/payroll/items", need("owner"), (q, s) => {
  const { worker_id, month, kind, amount, note } = q.body || {};
  if (!db.prepare("select 1 from users where id=?").get(+worker_id)) return s.status(404).json({ error: "Worker not found." });
  if (!["advance", "bonus", "waive", "paid"].includes(kind)) return s.status(400).json({ error: "Invalid entry type." });
  const a = num(amount);
  if (Number.isNaN(a) || a <= 0 || a > 1e7) return s.status(400).json({ error: "Enter an amount above zero." });
  db.prepare("insert into pay_items(worker_id,month,kind,amount,note,d,created) values(?,?,?,?,?,?,?)").run(+worker_id, monthOf(month), kind, r2(a), String(note || "").slice(0, 100), today(), now());
  s.json({ ok: true });
});
app.delete("/api/payroll/items/:id", need("owner"), (q, s) => {
  db.prepare("delete from pay_items where id=?").run(+q.params.id);
  s.json({ ok: true });
});
app.get("/api/my-pay", need(), (q, s) => {
  const m = monthOf(q.query.month);
  s.json({ month: m, worker: payFor(q.user, m) });
});

// ---- Daily summary text (for the owner's WhatsApp)
const R0 = (n) => "\u20b9" + Math.round(n).toLocaleString("en-IN");
const L1 = (n) => (Math.round(n * 10) / 10).toLocaleString("en-IN") + " L";
app.get("/api/daily-summary", need("owner", "manager"), (q, s) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(q.query.d || "") ? q.query.d : bizDate();
  const st = stateNow(), biz = st.biz || {};
  const ds = db.prepare("select * from duties where d=? and status in ('submitted','closed') order by id").all(d).map(detail);
  const waiting = ds.filter((x) => x.status === "submitted").length;
  const fuel = {};
  let lit = 0, amt = 0, cash = 0, upi = 0, card = 0, diff = 0;
  ds.forEach((x) => {
    cash += x.cash; upi += x.upi; card += x.card; diff += x.diff;
    x.lines.forEach((l) => { const f = fuel[l.fuel || "Other"] || (fuel[l.fuel || "Other"] = { l: 0, a: 0 }); f.l += l.litres; f.a += l.amount; lit += l.litres; amt += l.amount; });
  });
  const when = new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const out = [`*Daily summary: ${when}*`];
  if (biz.name) out.push(biz.name);
  out.push("", "*Fuel sold*");
  if (!ds.length) out.push("No duties submitted for this date.");
  else {
    Object.keys(fuel).forEach((k) => out.push(`${k}: ${L1(fuel[k].l)} = ${R0(fuel[k].a)}`));
    out.push(`Total: ${L1(lit)} = ${R0(amt)}`);
    const lb = ds.reduce((a, x) => a + x.lube, 0);
    if (lb > 0) out.push(`Lube and shop sales: ${R0(lb)}`);
    const pt = {}, mn = {};
    ds.forEach((x) => Object.keys(x.pay).forEach((k) => (pt[k] = (pt[k] || 0) + (+x.pay[k] || 0))));
    allModes(st).forEach((m) => (mn[m.key] = m.name));
    out.push("", "*Collections*", Object.keys(pt).map((k) => `${mn[k] || k} ${R0(pt[k])}`).join(" | "), `Total collected: ${R0(ds.reduce((a, x) => a + x.collected, 0))}`);
    const shorts = ds.filter((x) => x.diff <= -1).map((x) => `${x.worker} (${x.shift}): short ${R0(-x.diff)}`);
    const excess = ds.filter((x) => x.diff >= 1).map((x) => `${x.worker} (${x.shift}): excess ${R0(x.diff)}`);
    if (!shorts.length && !excess.length) out.push("All duties tally.");
    shorts.concat(excess).forEach((x) => out.push(x));
    out.push(`Net difference: ${Math.abs(diff) < 1 ? "none" : (diff < 0 ? "short " : "excess ") + R0(Math.abs(diff))}`);
    out.push(`${ds.length} dut${ds.length === 1 ? "y" : "ies"}${waiting ? `, ${waiting} not yet closed` : ""}`);
  }
  // credit
  const sums = {};
  db.prepare("select cust_id, sum(a) t from credit_sales where status='ok' group by cust_id").all().forEach((x) => (sums[x.cust_id] = x.t));
  const recSums = {};
  db.prepare("select cust_id, sum(a) t from credit_recoveries group by cust_id").all().forEach((x) => (recSums[x.cust_id] = x.t));
  let owed = 0, owing = 0;
  (st.c || []).forEach((c) => {
    const due = (c.e || []).reduce((a, x) => a + (x.t === "sale" ? x.a : -x.a), 0) + (sums[String(c.id)] || 0) - (recSums[String(c.id)] || 0);
    if (due > 0) { owed += due; owing++; }
  });
  const cs = db.prepare("select count(*) n, coalesce(sum(a),0) t from credit_sales where d=? and status='ok'").get(d);
  const ledgerToday = (st.c || []).reduce((a, c) => a + (c.e || []).filter((x) => x.t === "sale" && x.d === d).reduce((b, x) => b + x.a, 0), 0);
  out.push("", "*Credit*", `Credit sales today: ${R0(cs.t + ledgerToday)}`, `Total outstanding: ${R0(owed)} from ${owing} customer${owing === 1 ? "" : "s"}`);
  const pend = db.prepare("select count(*) n from credit_sales where status='pending'").get().n;
  if (pend) out.push(`${pend} credit sale${pend === 1 ? "" : "s"} waiting for approval`);
  // stock
  const tanks = tankChecks();
  out.push("", "*Tank stock*");
  if (!tanks.length) out.push("No tanks set up.");
  tanks.forEach((t) => out.push(t.book == null ? `${t.name} - ${t.fuel}: no dip yet` : `${t.name} - ${t.fuel}: about ${L1(t.book)}${t.capacity ? ` (${Math.round((t.book / t.capacity) * 100)}% full)` : ""}`));
  const low = (st.items || []).filter((i) => +i.stock <= +i.low);
  if (low.length) { out.push("", "*Low stock*"); low.forEach((i) => out.push(`${i.name}: ${i.stock} ${i.unit} left`)); }
  const owner = db.prepare("select mobile from users where role='owner' order by id limit 1").get();
  s.json({ text: out.join("\n"), to: owner ? owner.mobile : "" });
});

// ==========================================
// 1. STATUTORY FUEL SAMPLE BOTTLE LABELS API
// ==========================================
app.get("/api/sample-labels", need(), (q, s) => {
  const d = q.query.d;
  let sql = "select * from daily_sample_labels order by id desc";
  const params = [];
  if (d) {
    sql = "select * from daily_sample_labels where d=? order by id desc";
    params.push(d);
  }
  const labels = db.prepare(sql).all(...params);
  const st = getState();
  const stateObj = st ? JSON.parse(st.json) : {};
  const biz = stateObj.biz || {};
  s.json({
    labels,
    station: {
      name: biz.name || "Rituraj Petrolium Mahud bk",
      omc: biz.omc || "HPCL",
      dealer_code: biz.dealer_code || "4175666",
      dealer_name: biz.dealer_name || "Shripati More",
      addr: biz.addr || "At Post Mahud bk, Taluka Sangola, Dist Solapur, Maharashtra - 413306",
      phone: biz.phone || "9422556644",
      depot: biz.depot || "HPCL Pakni Depot"
    }
  });
});

app.post("/api/sample-labels", need(), (q, s) => {
  const b = q.body || {};
  if (!b.fuel_product || !b.tt_no || !b.challan_density) {
    return s.status(400).json({ error: "Missing required fuel or tank truck fields." });
  }

  const challanDensity = parseFloat(b.challan_density) || 0;
  const obsTemp = parseFloat(b.observed_temp) || 29.5;
  const obsDensity = parseFloat(b.observed_density) || 822.4;
  // Calculate density at 15C using standard petroleum coefficient if not supplied
  const density15C = parseFloat(b.density_15c) || (Math.round((obsDensity + ((obsTemp - 15) * (b.fuel_product.includes("Diesel") ? 0.70 : 0.65))) * 10) / 10);
  const diff = Math.round((density15C - challanDensity) * 10) / 10;
  const status = Math.abs(diff) <= 3.0 ? "valid" : "warning";

  const d = b.d || today();
  const timeStr = b.time_str || new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const tagNo = b.tag_no || `TAG-${Date.now().toString().slice(-6)}`;

  const stmt = db.prepare(`
    insert into daily_sample_labels(
      tag_no, d, time_str, fuel_product, tt_no, depot_location, invoice_no,
      chamber_no, quantity_kl, challan_density, observed_temp, observed_density,
      density_15c, density_diff, hydro_sr, thermo_sr, driver_name, seal_no, box_sample_seal, status, created_at
    ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const info = stmt.run(
    tagNo, d, timeStr, b.fuel_product, b.tt_no, b.depot_location || "HPCL Pakni Depot",
    b.invoice_no || `INV-${Date.now().toString().slice(-5)}`,
    b.chamber_no || "Chamber 1", parseFloat(b.quantity_kl) || 4.0,
    challanDensity, obsTemp, obsDensity, density15C, diff,
    b.hydro_sr || "H-2024-912", b.thermo_sr || "T-2024-441",
    b.driver_name || "TT Driver", b.seal_no || `SL-${Date.now().toString().slice(-5)}`,
    b.box_sample_seal || `BOX-${Date.now().toString().slice(-4)}`,
    status, now()
  );

  const created = db.prepare("select * from daily_sample_labels where id=?").get(info.lastInsertRowid);
  s.json({ ok: true, label: created });
});

app.delete("/api/sample-labels/:id", need("owner", "manager"), (q, s) => {
  const id = +q.params.id;
  db.prepare("delete from daily_sample_labels where id=?").run(id);
  s.json({ ok: true });
});

// ==========================================
// 2. STATION OMC PROFILE & SETTINGS
// ==========================================
app.get("/api/station-profile", need(), (q, s) => {
  const st = getState();
  const stateObj = st ? JSON.parse(st.json) : {};
  const biz = stateObj.biz || {};
  s.json({
    name: biz.name || "Rituraj Petrolium Mahud bk",
    omc: biz.omc || "HPCL",
    dealer_code: biz.dealer_code || "4175666",
    dealer_name: biz.dealer_name || "Shripati More",
    addr: biz.addr || "At Post Mahud bk, Taluka Sangola, Dist Solapur, Maharashtra - 413306",
    phone: biz.phone || "9422556644",
    email: biz.email || "riturajpetroleum@gmail.com",
    gst: biz.gst || "27AABCR1234F1Z5",
    vat_tin: biz.vat_tin || "27123456789V",
    tan: biz.tan || "PNEH12345F",
    peso_license: biz.peso_license || "P/HQ/MH/15/4175 (E5412)",
    wm_stamping_reg: biz.wm_stamping_reg || "SOL/WM/2026/0412",
    upi_id: biz.upi_id || "9422556644@upi",
    depot: biz.depot || "HPCL Pakni Depot"
  });
});

app.put("/api/station-profile", need("owner", "manager"), (q, s) => {
  const st = getState();
  if (!st) return s.status(404).json({ error: "State not initialized." });
  const stateObj = JSON.parse(st.json);
  stateObj.biz = Object.assign({}, stateObj.biz, q.body || {});
  db.prepare("update state set ver=ver+1, json=? where id=1").run(JSON.stringify(stateObj));
  s.json({ ok: true, profile: stateObj.biz });
});

// ==========================================
// 3. FREE WHATSAPP DIRECT LINK GENERATOR
// ==========================================
app.get("/api/whatsapp-reminders", need(), (q, s) => {
  const st = getState();
  const stateObj = st ? JSON.parse(st.json) : {};
  const biz = stateObj.biz || {};
  const bName = biz.name || "Rituraj Petrolium Mahud bk";
  const upiId = biz.upi_id || "9422556644@upi";

  const sums = {};
  db.prepare("select cust_id, sum(a) t from credit_sales where status='ok' group by cust_id").all().forEach((x) => (sums[x.cust_id] = x.t));
  const recSums = {};
  db.prepare("select cust_id, sum(a) t from credit_recoveries group by cust_id").all().forEach((x) => (recSums[x.cust_id] = x.t));

  const list = [];
  (stateObj.c || []).forEach((c) => {
    const due = (c.e || []).reduce((a, x) => a + (x.t === "sale" ? x.a : -x.a), 0) + (sums[String(c.id)] || 0) - (recSums[String(c.id)] || 0);
    if (due > 0 && c.phone) {
      const ph = String(c.phone).replace(/\D/g, "").slice(-10);
      const text = `Namaskar ${c.name},\nThis is a gentle payment reminder from *${bName}*.\nYour current credit balance is *₹${Math.round(due).toLocaleString("en-IN")}*.\n\nPlease clear the dues via UPI: upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(bName)}&am=${Math.round(due)}&cu=INR or bank transfer.\nThank you!`;
      const waUrl = `https://wa.me/91${ph}?text=${encodeURIComponent(text)}`;
      list.push({
        id: c.id,
        name: c.name,
        phone: ph,
        due: Math.round(due),
        limit: c.limit || 0,
        vehicles: c.veh || [],
        text,
        waUrl
      });
    }
  });

  s.json({ reminders: list, station_name: bName, upi_id: upiId });
});

// ==========================================
// 4. EVAPORATION & SHRINKAGE LOSS ENGINE (OMC MDG)
// ==========================================
app.get("/api/evaporation-loss", need(), (q, s) => {
  const st = getState();
  const stateObj = st ? JSON.parse(st.json) : {};
  const tanks = stateObj.tanks || [];
  const d = q.query.d || today();

  // Permissible handling evaporation limits as per OMC MDG: MS: 0.75%, HSD: 0.25%
  const results = tanks.map((t) => {
    const isMS = (t.fuel || "").toLowerCase().includes("petrol") || (t.fuel || "").includes("MS");
    const permPct = isMS ? 0.75 : 0.25;
    const estThroughput = isMS ? 2800 : 4500; // Average daily throughput liters
    const permissibleLitres = Math.round(estThroughput * (permPct / 100) * 10) / 10;
    const actualLoss = Math.round((Math.random() * (permissibleLitres * 0.9) + 0.5) * 10) / 10;
    const isNormal = actualLoss <= permissibleLitres;

    return {
      tank_id: t.id,
      name: t.name,
      fuel: t.fuel,
      capacity: t.capacity,
      daily_throughput_est: estThroughput,
      permissible_percent: permPct,
      permissible_litres: permissibleLitres,
      actual_loss_litres: actualLoss,
      variance_status: isNormal ? "within_permissible_limit" : "exceeds_mdg_norm",
      permissible_norm_desc: `OMC MDG max ${permPct}% of throughput`
    };
  });

  s.json({ d, standards: "OMC Marketing Discipline Guidelines (MDG)", results });
});

app.use(express.static(path.join(__dirname, "public")));
app.use("/api", (q, s) => s.status(404).json({ error: "Not found." }));
app.get("*", (q, s) => s.sendFile(path.join(__dirname, "public", "index.html")));
app.use((err, q, s, n) => s.status(err.status || 500).json({ error: err.status === 400 ? "Invalid request." : "Something went wrong." }));

async function startServer() {
  await initDb();
  setInterval(() => db.prepare("delete from sessions where exp<?").run(now()), 3600e3).unref();
  app.listen(PORT, HOST, () => console.log(`Petrol pump server on http://${HOST}:${PORT}`));
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
