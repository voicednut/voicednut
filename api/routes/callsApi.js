/**
 * Call Management API Routes
 * GET /api/calls/* - Retrieve call data
 */

const { getStatusIcon } = require('../core/utils');

module.exports = function(app, { db, getCallHandler, getAllCallHandlers }) {
  /**
   * GET /api/calls/:callSid - Get call details
   */
  app.get('/api/calls/:callSid', async (req, res) => {
    try {
      const callSid = req.params.callSid;
      const callRecord = await db.getCall(callSid);
      
      if (!callRecord) {
        return res.status(404).json({ error: 'Call not found' });
      }

      const transcripts = await db.getEnhancedTranscripts(callSid);
      const handler = getCallHandler(callSid);
      const health = handler?.getHealthStatus?.() || {};

      res.json({
        success: true,
        call: callRecord,
        transcripts: transcripts || [],
        health: {
          callSid: health.callSid,
          phase: health.conversationPhase,
          gptActive: health.gptServiceActive,
          interactionCount: health.interactionCount
        }
      });
    } catch (error) {
      console.error('❌ Error fetching call:', error);
      res.status(500).json({ error: 'Failed to fetch call' });
    }
  });

  /**
   * GET /api/calls/:callSid/status - Real-time call status
   */
  app.get('/api/calls/:callSid/status', async (req, res) => {
    try {
      const callSid = req.params.callSid;
      const callRecord = await db.getCall(callSid);
      
      if (!callRecord) {
        return res.status(404).json({ error: 'Call not found' });
      }

      const handler = getCallHandler(callSid);
      const health = handler?.getHealthStatus?.() || {};
      const state = handler?.getState?.() || {};

      res.json({
        success: true,
        callSid,
        status: callRecord.status,
        duration: callRecord.duration,
        phase: health.conversationPhase,
        interactions: health.interactionCount,
        errors: state.errors || [],
        lastUpdate: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ Error fetching call status:', error);
      res.status(500).json({ error: 'Failed to fetch status' });
    }
  });

  /**
   * GET /api/calls - List recent calls
   */
  app.get('/api/calls', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const calls = await db.getCallsWithTranscripts(limit);
      
      res.json({
        success: true,
        calls: calls || [],
        count: calls?.length || 0
      });
    } catch (error) {
      console.error('❌ Error listing calls:', error);
      res.status(500).json({ error: 'Failed to list calls' });
    }
  });

  /**
   * GET /api/calls/list - Enhanced calls list with filters
   */
  app.get('/api/calls/list', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;
      const status = req.query.status || null;
      const days = parseInt(req.query.days) || 7;
      const dateFrom = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();

      return new Promise((resolve) => {
        let sql = `
          SELECT 
            id, call_sid, phone_number, status, duration, 
            created_at, started_at, completed_at
          FROM calls
          WHERE created_at >= ?
        `;
        const params = [dateFrom];

        if (status) {
          sql += ` AND status = ?`;
          params.push(status);
        }

        sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        db.db.all(sql, params, (err, rows) => {
          if (err) {
            res.status(500).json({ error: 'Database error' });
            resolve();
            return;
          }

          const calls = (rows || []).map(row => ({
            ...row,
            statusIcon: getStatusIcon(row.status)
          }));

          res.json({
            success: true,
            calls,
            count: calls.length,
            limit,
            offset
          });
          resolve();
        });
      });
    } catch (error) {
      console.error('❌ Error listing calls:', error);
      res.status(500).json({ error: 'Failed to list calls' });
    }
  });

  /**
   * GET /api/calls/analytics - Call analytics
   */
  app.get('/api/calls/analytics', async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 7;
      const dateFrom = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();

      return new Promise((resolve) => {
        const queries = {
          totalCalls: `SELECT COUNT(*) as count FROM calls WHERE created_at >= ?`,
          
          statusBreakdown: `
            SELECT status, COUNT(*) as count 
            FROM calls 
            WHERE created_at >= ? 
            GROUP BY status 
            ORDER BY count DESC
          `,
          
          avgDuration: `
            SELECT AVG(duration) as avg_duration, MAX(duration) as max_duration
            FROM calls 
            WHERE created_at >= ? AND duration > 0
          `,
          
          dailyVolume: `
            SELECT DATE(created_at) as date, COUNT(*) as count
            FROM calls
            WHERE created_at >= ?
            GROUP BY DATE(created_at)
            ORDER BY date DESC
          `
        };

        const results = {};
        let completed = 0;
        const total = Object.keys(queries).length;

        for (const [key, query] of Object.entries(queries)) {
          db.db.all(query, [dateFrom], (err, rows) => {
            results[key] = rows || [];
            completed++;
            if (completed === total) {
              const summary = {
                totalCalls: results.totalCalls[0]?.count || 0,
                avgDuration: Math.round(results.avgDuration[0]?.avg_duration || 0),
                statusBreakdown: results.statusBreakdown,
                dailyVolume: results.dailyVolume
              };

              res.json({
                success: true,
                period: { days, from: dateFrom },
                summary
              });
            }
          });
        }
      });
    } catch (error) {
      console.error('❌ Error fetching analytics:', error);
      res.status(500).json({ error: 'Failed to fetch analytics' });
    }
  });

  /**
   * GET /api/calls/search - Search calls
   */
  app.get('/api/calls/search', async (req, res) => {
    try {
      const query = req.query.q || '';
      const limit = parseInt(req.query.limit) || 20;

      if (!query || query.length < 3) {
        return res.status(400).json({ error: 'Search query too short' });
      }

      return new Promise((resolve) => {
        const searchPattern = `%${query}%`;
        db.db.all(
          `
            SELECT * FROM calls 
            WHERE phone_number LIKE ? OR call_sid LIKE ?
            LIMIT ?
          `,
          [searchPattern, searchPattern, limit],
          (err, rows) => {
            if (err) {
              res.status(500).json({ error: 'Search failed' });
            } else {
              res.json({
                success: true,
                query,
                results: rows || [],
                count: rows?.length || 0
              });
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error searching calls:', error);
      res.status(500).json({ error: 'Failed to search' });
    }
  });

  /**
   * POST /api/calls/:callSid/notify - Manual notification
   */
  app.post('/api/calls/:callSid/notify', async (req, res) => {
    try {
      const callSid = req.params.callSid;
      const { message, type = 'info' } = req.body;

      if (!message) {
        return res.status(400).json({ error: 'Message required' });
      }

      const callRecord = await db.getCall(callSid);
      if (!callRecord) {
        return res.status(404).json({ error: 'Call not found' });
      }

      const status = await db.createEnhancedWebhookNotification(
        callSid,
        `manual_${type}`,
        callRecord.user_chat_id,
        'normal',
        JSON.stringify({ message, type })
      );

      res.json({
        success: true,
        message: 'Notification sent',
        status
      });
    } catch (error) {
      console.error('❌ Error sending notification:', error);
      res.status(500).json({ error: 'Failed to send notification' });
    }
  });

  console.log('✅ Call routes registered'.green);
};
