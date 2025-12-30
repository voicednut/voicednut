/**
 * Admin API Routes
 * Provider management and system configuration
 */

module.exports = function(app, { config, providerRegistry, adminConfig }) {
  const adminToken = adminConfig?.apiToken || process.env.ADMIN_API_TOKEN;

  /**
   * Middleware: Require admin auth
   */
  function requireAdminAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme?.toLowerCase() !== 'bearer' || token !== adminToken) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid admin token'
      });
    }

    next();
  }

  /**
   * GET /admin/provider - Get current provider status
   */
  app.get('/admin/provider', requireAdminAuth, async (req, res) => {
    try {
      const currentProvider = providerRegistry?.getCurrentProvider?.() || 'twilio';
      const supportedProviders = ['twilio', 'aws', 'vonage'];

      const status = {
        current: currentProvider,
        supported: supportedProviders,
        available: supportedProviders,
        timestamp: new Date().toISOString()
      };

      // Add provider-specific status if available
      if (currentProvider === 'twilio') {
        status.twilio = {
          configured: !!process.env.TWILIO_ACCOUNT_SID,
          accountSid: process.env.TWILIO_ACCOUNT_SID ? '***' : 'missing',
          phoneNumber: process.env.FROM_NUMBER || 'not set'
        };
      }

      res.json({
        success: true,
        provider: status
      });
    } catch (error) {
      console.error('❌ Error fetching provider status:', error);
      res.status(500).json({ error: 'Failed to fetch provider status' });
    }
  });

  /**
   * POST /admin/provider - Change provider
   */
  app.post('/admin/provider', requireAdminAuth, async (req, res) => {
    try {
      const { provider } = req.body;
      const supported = ['twilio', 'aws', 'vonage'];

      if (!provider || !supported.includes(provider)) {
        return res.status(400).json({
          error: 'Invalid provider',
          supported
        });
      }

      // Validate provider has required config
      const config = process.env;
      const validations = {
        twilio: () => !!(config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN),
        aws: () => !!(config.AWS_REGION && config.AWS_INSTANCE_CONTACT_FLOW_ID),
        vonage: () => !!(config.VONAGE_API_KEY && config.VONAGE_API_SECRET)
      };

      if (!validations[provider]?.()) {
        return res.status(400).json({
          error: `Provider ${provider} not fully configured`,
          message: `Missing required environment variables for ${provider}`
        });
      }

      // Apply provider switch
      if (providerRegistry?.setProvider) {
        providerRegistry.setProvider(provider);
      }

      console.log(`🔄 Provider switched to: ${provider}`.cyan);

      res.json({
        success: true,
        message: `Provider switched to ${provider}`,
        provider: provider,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ Error switching provider:', error);
      res.status(500).json({
        error: 'Failed to switch provider',
        details: error.message
      });
    }
  });

  /**
   * POST /api/system/cleanup - Trigger cleanup
   */
  app.post('/api/system/cleanup', requireAdminAuth, async (req, res) => {
    try {
      const { type = 'all', days = 30 } = req.body;

      const results = {};

      if (['all', 'old_records'].includes(type)) {
        const cleaned = await db.cleanupOldRecords(days);
        results.oldRecords = cleaned;
      }

      if (['all', 'health_logs'].includes(type)) {
        results.healthLogs = 'pending'; // Would implement
      }

      res.json({
        success: true,
        message: 'Cleanup started',
        results,
        daysRetained: days
      });
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
      res.status(500).json({ error: 'Cleanup failed' });
    }
  });

  console.log('✅ Admin routes registered'.green);
};
