/**
 * DNCChecker - Do Not Call compliance and management
 * Prevents calls to numbers on DNC registry
 */
class DNCChecker {
  constructor(database) {
    this.db = database;
    this.cache = new Map(); // In-memory cache for DNC checks
    this.cacheExpiry = 60 * 60 * 1000; // 1 hour
  }

  /**
   * Check if number is on DNC list
   */
  async isOnDNC(phoneNumber) {
    const normalized = this._normalizePhoneNumber(phoneNumber);

    // Check cache first
    const cached = this.cache.get(normalized);
    if (cached && cached.expiry > Date.now()) {
      return cached.isDNC;
    }

    return new Promise((resolve) => {
      this.db.db.get(
        `SELECT * FROM do_not_call_registry 
         WHERE phone_number = ? AND (expires_at IS NULL OR expires_at > datetime('now'))`,
        [normalized],
        (err, row) => {
          const isDNC = !!row && !err;
          
          // Cache result
          this.cache.set(normalized, {
            isDNC,
            expiry: Date.now() + this.cacheExpiry
          });

          resolve(isDNC);
        }
      );
    });
  }

  /**
   * Add number to DNC registry
   */
  async addToDNC(phoneNumber, options = {}) {
    const {
      name = '',
      reason = 'unknown',
      source = 'manual',
      expiresAt = null,
      notes = ''
    } = options;

    const normalized = this._normalizePhoneNumber(phoneNumber);

    return new Promise((resolve, reject) => {
      const sql = `
        INSERT OR REPLACE INTO do_not_call_registry 
        (phone_number, name, reason, source, expires_at, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `;

      this.db.db.run(
        sql,
        [normalized, name, reason, source, expiresAt, notes],
        (err) => {
          if (err) {
            reject(err);
          } else {
            // Invalidate cache
            this.cache.delete(normalized);
            console.log(`📵 Added to DNC: ${normalized} (${reason})`);
            resolve();
          }
        }
      );
    });
  }

  /**
   * Remove number from DNC registry
   */
  async removeFromDNC(phoneNumber) {
    const normalized = this._normalizePhoneNumber(phoneNumber);

    return new Promise((resolve, reject) => {
      this.db.db.run(
        `DELETE FROM do_not_call_registry WHERE phone_number = ?`,
        [normalized],
        (err) => {
          if (err) {
            reject(err);
          } else {
            this.cache.delete(normalized);
            console.log(`✅ Removed from DNC: ${normalized}`);
            resolve();
          }
        }
      );
    });
  }

  /**
   * Bulk import DNC list from array
   */
  async importDNCList(phoneNumbers, options = {}) {
    const { source = 'import', reason = 'regulatory' } = options;

    return new Promise((resolve) => {
      const insertStmt = this.db.db.prepare(
        `INSERT OR IGNORE INTO do_not_call_registry 
         (phone_number, source, reason) VALUES (?, ?, ?)`
      );

      let added = 0;
      let duplicates = 0;

      phoneNumbers.forEach(phone => {
        const normalized = this._normalizePhoneNumber(phone);
        insertStmt.run([normalized, source, reason], function(err) {
          if (!err) {
            added++;
          } else {
            duplicates++;
          }
        });
      });

      insertStmt.finalize(() => {
        // Clear cache
        this.cache.clear();
        console.log(`📵 DNC import: ${added} added, ${duplicates} duplicates`);
        resolve({ added, duplicates });
      });
    });
  }

  /**
   * Filter contacts against DNC list
   */
  async filterContactsAgainstDNC(contacts) {
    const results = {
      allowed: [],
      blocked: []
    };

    for (const contact of contacts) {
      const isDNC = await this.isOnDNC(contact.phoneNumber);
      if (isDNC) {
        results.blocked.push(contact);
      } else {
        results.allowed.push(contact);
      }
    }

    return results;
  }

  /**
   * Get DNC statistics
   */
  async getDNCStats() {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT 
          reason,
          source,
          COUNT(*) as count,
          COUNT(CASE WHEN expires_at IS NULL THEN 1 END) as permanent_count,
          COUNT(CASE WHEN expires_at IS NOT NULL THEN 1 END) as temporary_count
        FROM do_not_call_registry
        WHERE expires_at IS NULL OR expires_at > datetime('now')
        GROUP BY reason, source
      `;

      this.db.db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const stats = {
            total: 0,
            permanent: 0,
            temporary: 0,
            byReason: {},
            bySource: {}
          };

          rows.forEach(row => {
            stats.total += row.count;
            stats.permanent += row.permanent_count;
            stats.temporary += row.temporary_count;

            stats.byReason[row.reason] = row.count;
            stats.bySource[row.source] = row.count;
          });

          resolve(stats);
        }
      });
    });
  }

  /**
   * Normalize phone number to consistent format
   */
  _normalizePhoneNumber(phone) {
    // Remove non-digit characters, keep only digits
    let normalized = phone.replace(/\D/g, '');
    
    // If starts with 1 (US), keep it; otherwise ensure 10+ digits
    if (normalized.startsWith('1') && normalized.length === 11) {
      return normalized;
    }
    
    // For non-US, just ensure 10+ digits
    if (normalized.length >= 10) {
      return normalized;
    }

    // Fallback: return original digits
    return normalized;
  }
}

module.exports = DNCChecker;
