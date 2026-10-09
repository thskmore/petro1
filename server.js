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
`);
  if (!db.prepare("pragma table_info(credit_sales)").all().some((c) => c.name === "status"))
    db.exec("alter table credit_sales add column status text not null default 'ok'");

  const addCol = (t, c, def) => { if (!db.prepare(`pragma table_info(${t})`).all().some((x) => x.name === c)) db.exec(`alter table ${t} add column ${c} ${def}`); };
  addCol("duties", "pay_json", "text");
  addCol("duties", "stock_done", "integer not null default 0");
  addCol("duties", "assigned_by", "integer");
  addCol("credit_recoveries", "duty_id", "integer");
  addCol("credit_sales", "duty_id", "integer");
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
    const did = db.prepare("insert into duties(worker_id,d,shift,started,assigned_by) values(?,?,?,?,?)").run(w.id, d, shift, now(), q.user.id).lastInsertRowid;
    lines.forEach((l) => db.prepare("insert into duty_lines(duty_id,nozzle_id,opening,rate) values(?,?,?,?)").run(did, l.id, l.opening, l.rate));
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

app.use(express.static(path.join(__dirname, "public")));
app.use("/api", (q, s) => s.status(404).json({ error: "Not found." }));
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
