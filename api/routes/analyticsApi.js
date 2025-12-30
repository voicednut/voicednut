/**
 * Analytics Routes
 * /api/analytics/* - Call and SMS analytics, reporting
 */

module.exports = function(app, { db }) {
  /**
   * Build time-range SQL WHERE clause
   */
  function getTimeRangeWhere(days = 30) {
    return `datetime('now', '-${days} days')`;
  }

  /**
   * GET /api/analytics/calls - Call analytics
   */
  app.get('/api/analytics/calls', async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;

      return new Promise((resolve) => {
        db.db.all(
          `SELECT 
             DATE(created_at) as date,
             COUNT(*) as total_calls,
             SUM(CASE WHEN call_status = 'completed' THEN 1 ELSE 0 END) as completed,
             SUM(CASE WHEN call_status = 'failed' THEN 1 ELSE 0 END) as failed,
             SUM(CASE WHEN call_status = 'no_answer' THEN 1 ELSE 0 END) as no_answer,
             ROUND(AVG(CAST(duration_seconds AS FLOAT)), 2) as avg_duration_sec,
             MAX(duration_seconds) as max_duration_sec
           FROM call_records
           WHERE created_at > datetime('now', '-${days} days')
           GROUP BY DATE(created_at)
           ORDER BY date DESC`,
          (err, rows) => {
            if (err) {
              res.status(500).json({ error: 'Failed to fetch call analytics' });
            } else {
              res.json({
                success: true,
                period_days: days,
                analytics: rows || [],
                summary: {
                  total_records: rows?.length || 0
                }
              });
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error fetching call analytics:', error);
      res.status(500).json({ error: 'Failed to fetch call analytics' });
    }
  });

  /**
   * GET /api/analytics/sms - SMS analytics
   */
  app.get('/api/analytics/sms', async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;

      return new Promise((resolve) => {
        db.db.all(
          `SELECT 
             DATE(created_at) as date,
             COUNT(*) as total_sms,
             SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
             SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
           FROM sms_records
           WHERE created_at > datetime('now', '-${days} days')
           GROUP BY DATE(created_at)
           ORDER BY date DESC`,
          (err, rows) => {
            if (err) {
              res.status(500).json({ error: 'Failed to fetch SMS analytics' });
            } else {
              res.json({
                success: true,
                period_days: days,
                analytics: rows || [],
                summary: {
                  total_records: rows?.length || 0
                }
              });
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error fetching SMS analytics:', error);
      res.status(500).json({ error: 'Failed to fetch SMS analytics' });
    }
  });

  /**
   * GET /api/analytics/adaptations - LLM adaptation metrics
   */
  app.get('/api/analytics/adaptations', async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;

      return new Promise((resolve) => {
        db.db.all(
          `SELECT 
             adaptation_type,
             COUNT(*) as count,
             AVG(CAST(success_rate AS FLOAT)) as avg_success_rate
           FROM (
             SELECT 
               json_extract(metadata, '$.adaptation_type') as adaptation_type,
               CASE WHEN call_status = 'completed' THEN 100 ELSE 0 END as success_rate
             FROM call_records
             WHERE created_at > datetime('now', '-${days} days')
               AND metadata IS NOT NULL
           )
           GROUP BY adaptation_type
           ORDER BY count DESC`,
          (err, rows) => {
            if (err) {
              res.status(500).json({ error: 'Failed to fetch adaptation metrics' });
            } else {
              res.json({
                success: true,
                period_days: days,
                adaptations: rows || [],
                summary: {
                  total_adaptations: rows?.reduce((sum, r) => sum + r.count, 0) || 0
                }
              });
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error fetching adaptation metrics:', error);
      res.status(500).json({ error: 'Failed to fetch adaptation metrics' });
    }
  });

  /**
   * GET /api/analytics/notifications - Notification delivery stats
   */
  app.get('/api/analytics/notifications', async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;

      return new Promise((resolve) => {
        db.db.all(
          `SELECT 
             notification_type,
             COUNT(*) as total,
             SUM(CASE WHEN delivery_status = 'sent' THEN 1 ELSE 0 END) as sent,
             SUM(CASE WHEN delivery_status = 'failed' THEN 1 ELSE 0 END) as failed,
             ROUND(100.0 * SUM(CASE WHEN delivery_status = 'sent' THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
           FROM notification_log
           WHERE created_at > datetime('now', '-${days} days')
           GROUP BY notification_type
           ORDER BY total DESC`,
          (err, rows) => {
            if (err) {
              res.status(500).json({ error: 'Failed to fetch notification stats' });
            } else {
              res.json({
                success: true,
                period_days: days,
                notifications: rows || [],
                summary: {
                  total_notifications: rows?.reduce((sum, r) => sum + r.total, 0) || 0
                }
              });
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error fetching notification stats:', error);
      res.status(500).json({ error: 'Failed to fetch notification stats' });
    }
  });

  /**
   * GET /api/analytics/providers - Provider usage stats
   */
  app.get('/api/analytics/providers', async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;

      return new Promise((resolve) => {
        db.db.all(
          `SELECT 
             provider,
             COUNT(*) as total_calls,
             SUM(CASE WHEN call_status = 'completed' THEN 1 ELSE 0 END) as completed,
             ROUND(100.0 * SUM(CASE WHEN call_status = 'completed' THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate,
             ROUND(AVG(CAST(duration_seconds AS FLOAT)), 2) as avg_duration_sec
           FROM call_records
           WHERE created_at > datetime('now', '-${days} days')
           GROUP BY provider
           ORDER BY total_calls DESC`,
          (err, rows) => {
            if (err) {
              res.status(500).json({ error: 'Failed to fetch provider stats' });
            } else {
              res.json({
                success: true,
                period_days: days,
                providers: rows || [],
                summary: {
                  total_providers: rows?.length || 0
                }
              });
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error fetching provider stats:', error);
      res.status(500).json({ error: 'Failed to fetch provider stats' });
    }
  });

  /**
   * GET /api/analytics/status-breakdown - Call status breakdown
   */
  app.get('/api/analytics/status-breakdown', async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;

      return new Promise((resolve) => {
        db.db.all(
          `SELECT 
             call_status,
             COUNT(*) as count,
             ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM call_records WHERE created_at > datetime('now', '-${days} days')), 2) as percentage
           FROM call_records
           WHERE created_at > datetime('now', '-${days} days')
           GROUP BY call_status
           ORDER BY count DESC`,
          (err, rows) => {
            if (err) {
              res.status(500).json({ error: 'Failed to fetch status breakdown' });
            } else {
              res.json({
                success: true,
                period_days: days,
                statuses: rows || [],
                summary: {
                  total_calls: rows?.reduce((sum, r) => sum + r.count, 0) || 0
                }
              });
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error fetching status breakdown:', error);
      res.status(500).json({ error: 'Failed to fetch status breakdown' });
    }
  });

  /**
   * GET /api/analytics/peak-hours - Calls by hour
   */
  app.get('/api/analytics/peak-hours', async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 7;

      return new Promise((resolve) => {
        db.db.all(
          `SELECT 
             strftime('%H', created_at) as hour,
             COUNT(*) as total_calls,
             SUM(CASE WHEN call_status = 'completed' THEN 1 ELSE 0 END) as completed,
             ROUND(100.0 * SUM(CASE WHEN call_status = 'completed' THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
           FROM call_records
           WHERE created_at > datetime('now', '-${days} days')
           GROUP BY hour
           ORDER BY hour ASC`,
          (err, rows) => {
            if (err) {
              res.status(500).json({ error: 'Failed to fetch peak hours data' });
            } else {
              res.json({
                success: true,
                period_days: days,
                peak_hours: rows || [],
                summary: {
                  total_calls: rows?.reduce((sum, r) => sum + r.total_calls, 0) || 0
                }
              });
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error fetching peak hours:', error);
      res.status(500).json({ error: 'Failed to fetch peak hours' });
    }
  });

  console.log('✅ Analytics routes registered'.green);
};
