const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.resolve(__dirname, '../db/data.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS webhook_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_sid TEXT NOT NULL,
    notification_type TEXT NOT NULL,
    payload TEXT,
    telegram_chat_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed', 'retrying')),
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME,
    delivery_time_ms INTEGER,
    telegram_message_id INTEGER,
    priority TEXT DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high', 'urgent'))
  )`);
});

function fetchPending(limit = 20) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM webhook_notifications WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`,
      [limit],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      }
    );
  });
}

function markNotification(id, status, telegramMessageId = null, error = null) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE webhook_notifications SET status = ?, telegram_message_id = ?, error_message = ?, sent_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, telegramMessageId, error, id],
      function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      }
    );
  });
}

function upsertCallThread(callSid, chatId, messageId) {
  return new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS call_threads (
        call_sid TEXT PRIMARY KEY,
        telegram_chat_id TEXT NOT NULL,
        message_id INTEGER NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (err) => {
        if (err) return reject(err);
        db.run(
          `INSERT INTO call_threads (call_sid, telegram_chat_id, message_id)
           VALUES (?, ?, ?)
           ON CONFLICT(call_sid) DO UPDATE SET message_id = excluded.message_id, telegram_chat_id = excluded.telegram_chat_id, updated_at = CURRENT_TIMESTAMP`,
          [callSid, chatId, messageId],
          function (e) {
            if (e) reject(e);
            else resolve(this.changes);
          }
        );
      }
    );
  });
}

function getCallThread(callSid) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT telegram_chat_id, message_id FROM call_threads WHERE call_sid = ?`, [callSid], (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

module.exports = {
  fetchPending,
  markNotification,
  upsertCallThread,
  getCallThread,
};
