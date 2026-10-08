"use strict";
const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

let SQL = null;

async function getSqlModule() {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
}

class DatabaseAdapter {
  constructor(dbPath, sqlDb) {
    this.dbPath = dbPath;
    this.sqlDb = sqlDb;
    this._saveTimer = null;
  }

  saveNow() {
    if (!this.dbPath || this.dbPath === ":memory:") return;
    try {
      const data = this.sqlDb.export();
      fs.writeFileSync(this.dbPath, Buffer.from(data));
    } catch (err) {
      console.error("[Database] Error writing to disk:", err);
    }
  }

  scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.saveNow();
    }, 150);
  }

  exec(sql) {
    this.sqlDb.run(sql);
    this.scheduleSave();
  }

  pragma(str) {
    try {
      this.sqlDb.run("PRAGMA " + str);
    } catch (_) {}
  }

  prepare(sql) {
    const self = this;
    return {
      get(...args) {
        const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        const stmt = self.sqlDb.prepare(sql);
        try {
          if (params.length) {
            stmt.bind(params.map((p) => (p === undefined ? null : p)));
          }
          if (stmt.step()) {
            return stmt.getAsObject();
          }
          return undefined;
        } finally {
          stmt.free();
        }
      },
      all(...args) {
        const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        const stmt = self.sqlDb.prepare(sql);
        const rows = [];
        try {
          if (params.length) {
            stmt.bind(params.map((p) => (p === undefined ? null : p)));
          }
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          return rows;
        } finally {
          stmt.free();
        }
      },
      run(...args) {
        const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
        const stmt = self.sqlDb.prepare(sql);
        try {
          if (params.length) {
            stmt.bind(params.map((p) => (p === undefined ? null : p)));
          }
          stmt.step();
        } finally {
          stmt.free();
        }
        const changes = self.sqlDb.getRowsModified();
        let lastInsertRowid = 0;
        try {
          const res = self.sqlDb.exec("SELECT last_insert_rowid() AS id");
          if (res && res[0] && res[0].values && res[0].values[0]) {
            lastInsertRowid = res[0].values[0][0];
          }
        } catch (_) {}
        self.scheduleSave();
        return { changes, lastInsertRowid };
      },
    };
  }

  transaction(fn) {
    const self = this;
    return function (...args) {
      self.sqlDb.run("BEGIN TRANSACTION;");
      try {
        const res = fn.apply(this, args);
        self.sqlDb.run("COMMIT;");
        self.scheduleSave();
        return res;
      } catch (err) {
        try {
          self.sqlDb.run("ROLLBACK;");
        } catch (_) {}
        throw err;
      }
    };
  }

  close() {
    this.saveNow();
    this.sqlDb.close();
  }
}

async function openDatabase(dbPath) {
  const SQLModule = await getSqlModule();
  let sqlDb;
  if (dbPath && dbPath !== ":memory:" && fs.existsSync(dbPath)) {
    try {
      const buffer = fs.readFileSync(dbPath);
      sqlDb = new SQLModule.Database(buffer);
    } catch (e) {
      console.warn("[Database] Corrupt or unreadable db file, initializing fresh:", e.message);
      sqlDb = new SQLModule.Database();
    }
  } else {
    sqlDb = new SQLModule.Database();
  }
  return new DatabaseAdapter(dbPath, sqlDb);
}

module.exports = { openDatabase, DatabaseAdapter };
