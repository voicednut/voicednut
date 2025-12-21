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

module.exports = {
  fetchPending,
  markNotification,
};
