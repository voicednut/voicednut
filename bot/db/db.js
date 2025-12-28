const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Store DB in project root as data.db
const dbPath = path.resolve(__dirname, '../db/data.db');
const db = new sqlite3.Database(dbPath);

const { userId, username } = require('../config').admin;

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    role TEXT CHECK(role IN ('ADMIN','USER')) NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`INSERT OR IGNORE INTO users (telegram_id, username, role) VALUES (?, ?, 'ADMIN')`, [userId, username]);

  db.run(`CREATE TABLE IF NOT EXISTS call_wizard_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    chat_id INTEGER NOT NULL,
    category TEXT,
    state_json TEXT,
    call_sid TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(telegram_id, chat_id)
  )`);
});

function getUser(id, cb) {
  db.get(`SELECT * FROM users WHERE telegram_id = ?`, [id], (e, r) => {
    if (e) return cb(null);
    cb(r);
  });
}
function addUser(id, username, role = 'USER', cb = () => {}) {
  db.run(`INSERT OR IGNORE INTO users (telegram_id, username, role) VALUES (?, ?, ?)`, [id, username, role], cb);
}
function getUserList(cb) {
  db.all(`SELECT * FROM users ORDER BY role DESC`, [], (e, r) => {
    if (e) {
      console.error('Database error in getUserList:', e);
      return cb(e, null);
    }
    cb(null, r || []);
  });
}
function promoteUser(id, cb = () => {}) {
  db.run(`UPDATE users SET role = 'ADMIN' WHERE telegram_id = ?`, [id], cb);
}
function removeUser(id, cb = () => {}) {
  db.run(`DELETE FROM users WHERE telegram_id = ?`, [id], cb);
}
function isAdmin(id, cb) {
  db.get(`SELECT role FROM users WHERE telegram_id = ?`, [id], (e, r) => {
    if (e) return cb(false);
    cb(r?.role === 'ADMIN');
  });
}
function expireInactiveUsers(days = 30) {
  db.run(`DELETE FROM users WHERE timestamp <= datetime('now', ? || ' days')`, [`-${days}`]);
}

function setWizardState(telegramId, chatId, category, state = {}) {
  return new Promise((resolve, reject) => {
    const payload = state ? JSON.stringify(state) : null;
    db.run(
      `INSERT INTO call_wizard_state (telegram_id, chat_id, category, state_json, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(telegram_id, chat_id) DO UPDATE SET category = excluded.category, state_json = excluded.state_json, updated_at = CURRENT_TIMESTAMP`,
      [telegramId, chatId, category, payload],
      function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      }
    );
  });
}

function setWizardCallSid(telegramId, chatId, callSid) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE call_wizard_state SET call_sid = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ? AND chat_id = ?`,
      [callSid, telegramId, chatId],
      function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      }
    );
  });
}

function clearWizardState(telegramId, chatId) {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM call_wizard_state WHERE telegram_id = ? AND chat_id = ?`,
      [telegramId, chatId],
      function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      }
    );
  });
}

function getWizardState(telegramId, chatId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM call_wizard_state WHERE telegram_id = ? AND chat_id = ?`,
      [telegramId, chatId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      }
    );
  });
}

module.exports = {
  getUser, addUser, getUserList, promoteUser, removeUser,
  isAdmin, expireInactiveUsers,
  setWizardState, setWizardCallSid, clearWizardState, getWizardState
};
