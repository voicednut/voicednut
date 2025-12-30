/**
 * Health & System Routes
 * /health, /api/system/* - System monitoring and maintenance
 */

const os = require('os');

module.exports = function(app, { db, config, callManagement }) {
  /**
   * GET /health - Health check endpoint
   */
  app.get('/health', async (req, res) => {
    try {
      const memUsage = process.memoryUsage();
      const dbHealthy = db && typeof db.query === 'function';

      return new Promise((resolve) => {
        // Quick DB check
        db.db.get('SELECT 1', (err) => {
          const health = {
            status: err ? 'degraded' : 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: {
              rss_mb: Math.round(memUsage.rss / 1024 / 1024),
              heapTotal_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
              heapUsed_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
              external_mb: Math.round(memUsage.external / 1024 / 1024)
            },
            database: {
              connected: dbHealthy && !err,
              error: err?.message
            },
            activeCallHandlers: callManagement ? Object.keys(callManagement.callHandlers || {}).length : 0,
            providers: {
              configured: config?.CALL_PROVIDER || 'twilio',
              fallbacks: ['twilio', 'aws', 'vonage']
            }
          };

          res.json(health);
          resolve();
        });
      });
    } catch (error) {
      console.error('❌ Health check error:', error);
      res.status(500).json({
        status: 'unhealthy',
        error: error.message
      });
    }
  });

  /**
   * GET /api/system/resources - Detailed resource usage
   */
  app.get('/api/system/resources', async (req, res) => {
    try {
      const memUsage = process.memoryUsage();
      const uptime = process.uptime();
      const cpuUsage = process.cpuUsage();

      res.json({
        success: true,
        process: {
          pid: process.pid,
          nodeVersion: process.version,
          platform: process.platform,
          uptime_seconds: Math.round(uptime),
          uptime_hours: (uptime / 3600).toFixed(2)
        },
        memory: {
          rss_mb: Math.round(memUsage.rss / 1024 / 1024),
          heapTotal_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
          heapUsed_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
          heapUsed_percent: ((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(2),
          external_mb: Math.round(memUsage.external / 1024 / 1024),
          arrayBuffers_mb: Math.round(memUsage.arrayBuffers / 1024 / 1024)
        },
        cpu: {
          user_ms: cpuUsage.user,
          system_ms: cpuUsage.system,
          total_ms: cpuUsage.user + cpuUsage.system
        },
        system: {
          cpus: os.cpus().length,
          totalMemory_mb: Math.round(os.totalmem() / 1024 / 1024),
          freeMemory_mb: Math.round(os.freemem() / 1024 / 1024),
          loadAverage: os.loadavg()
        },
        calls: {
          activeHandlers: callManagement ? Object.keys(callManagement.callHandlers || {}).length : 0,
          dtmfBuffers: callManagement ? Object.keys(callManagement.dtmfBuffers || {}).length : 0,
          inputPhases: callManagement ? Object.keys(callManagement.inputPhases || {}).length : 0
        }
      });
    } catch (error) {
      console.error('❌ Error fetching system resources:', error);
      res.status(500).json({ error: 'Failed to fetch system resources' });
    }
  });

  /**
   * GET /api/system/status - Detailed system status
   */
  app.get('/api/system/status', async (req, res) => {
    try {
      return new Promise((resolve) => {
        // Gather stats from database
        db.db.all(
          `SELECT 
             'call_records' as table_name,
             COUNT(*) as row_count
           FROM call_records
           UNION ALL
           SELECT 'sms_records', COUNT(*) FROM sms_records
           UNION ALL
           SELECT 'call_templates', COUNT(*) FROM call_templates
           UNION ALL
           SELECT 'personas', COUNT(*) FROM personas
           UNION ALL
           SELECT 'call_status_history', COUNT(*) FROM call_status_history`,
          (err, tableStats) => {
            const stats = {
              timestamp: new Date().toISOString(),
              provider: config?.CALL_PROVIDER || 'twilio',
              database: {
                healthy: !err,
                tables: tableStats || []
              },
              handlers: {
                total: callManagement ? Object.keys(callManagement.callHandlers || {}).length : 0,
                byType: callManagement ? groupHandlersByType(callManagement.callHandlers) : {}
              }
            };

            res.json({
              success: true,
              status: stats
            });
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error fetching system status:', error);
      res.status(500).json({ error: 'Failed to fetch system status' });
    }
  });

  /**
   * POST /api/system/cleanup - Cleanup stale data and handlers
   */
  app.post('/api/system/cleanup', async (req, res) => {
    try {
      const ageHours = parseInt(req.query.age_hours) || 24;

      return new Promise((resolve) => {
        db.db.run(
          `DELETE FROM call_status_history 
           WHERE created_at < datetime('now', '-${ageHours} hours')
           AND call_sid NOT IN (
             SELECT call_sid FROM call_records WHERE created_at > datetime('now', '-${ageHours * 2} hours')
           )`,
          function(err) {
            if (err) {
              console.error('❌ Cleanup error:', err);
              res.status(500).json({ error: 'Cleanup failed' });
            } else {
              // Also clean up orphaned handlers
              const initialCount = callManagement ? Object.keys(callManagement.callHandlers || {}).length : 0;
              if (callManagement && callManagement.cleanupAllHandlers) {
                callManagement.cleanupAllHandlers();
              }
              const finalCount = callManagement ? Object.keys(callManagement.callHandlers || {}).length : 0;

              res.json({
                success: true,
                cleanup: {
                  history_records_deleted: this.changes,
                  handlers_cleaned: initialCount - finalCount,
                  age_hours: ageHours
                }
              });
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error running cleanup:', error);
      res.status(500).json({ error: 'Failed to run cleanup' });
    }
  });

  /**
   * GET /api/system/stats - Basic statistics summary
   */
  app.get('/api/system/stats', async (req, res) => {
    try {
      return new Promise((resolve) => {
        db.db.all(
          `SELECT 
             (SELECT COUNT(*) FROM call_records) as total_calls,
             (SELECT COUNT(*) FROM call_records WHERE call_status = 'completed') as completed_calls,
             (SELECT COUNT(*) FROM sms_records) as total_sms,
             (SELECT COUNT(*) FROM call_templates) as total_templates,
             (SELECT COUNT(*) FROM personas) as total_personas`,
          (err, result) => {
            if (err || !result?.[0]) {
              res.status(500).json({ error: 'Failed to fetch stats' });
            } else {
              const stats = result[0];
              res.json({
                success: true,
                summary: {
                  calls: {
                    total: stats.total_calls || 0,
                    completed: stats.completed_calls || 0,
                    success_rate: stats.total_calls > 0 
                      ? ((stats.completed_calls / stats.total_calls) * 100).toFixed(2)
                      : 0
                  },
                  sms: {
                    total: stats.total_sms || 0
                  },
                  templates: stats.total_templates || 0,
                  personas: stats.total_personas || 0
                }
              });
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error fetching stats:', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  /**
   * GET /api/system/config - Public config info (sanitized)
   */
  app.get('/api/system/config', (req, res) => {
    try {
      res.json({
        success: true,
        config: {
          provider: config?.CALL_PROVIDER || 'twilio',
          environment: process.env.NODE_ENV || 'development',
          deepgramEnabled: Boolean(process.env.DEEPGRAM_API_KEY),
          openRouterEnabled: Boolean(process.env.OPENROUTER_API_KEY),
          openAiEnabled: Boolean(process.env.OPENAI_API_KEY),
          telegramBotEnabled: Boolean(process.env.TELEGRAM_BOT_TOKEN),
          twilioEnabled: Boolean(process.env.TWILIO_ACCOUNT_SID),
          awsEnabled: Boolean(process.env.AWS_ACCESS_KEY_ID),
          vonageEnabled: Boolean(process.env.VONAGE_API_KEY)
        }
      });
    } catch (error) {
      console.error('❌ Error fetching config:', error);
      res.status(500).json({ error: 'Failed to fetch config' });
    }
  });

  /**
   * Helper: Group handlers by type
   */
  function groupHandlersByType(handlers) {
    const groups = {};
    Object.values(handlers || {}).forEach(handler => {
      const type = handler?.constructor?.name || 'Unknown';
      groups[type] = (groups[type] || 0) + 1;
    });
    return groups;
  }

  console.log('✅ Health & System routes registered'.green);
};
