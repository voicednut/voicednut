require('colors');
const express = require('express');
const { validationResult, body } = require('express-validator');
const CampaignManager = require('../services/CampaignManager');
const DNCChecker = require('../services/DNCChecker');

module.exports = function(app, { db }) {
  const campaignManager = new CampaignManager(db);
  const dncChecker = new DNCChecker(db);

  // ============================================================================
  // CAMPAIGN CRUD ENDPOINTS
  // ============================================================================

  /**
   * POST /api/campaigns - Create new campaign
   */
  app.post('/api/campaigns', [
    body('businessId').notEmpty().trim(),
    body('userChatId').notEmpty().trim(),
    body('name').notEmpty().trim(),
    body('persona').optional().trim(),
    body('template').optional().trim()
  ], async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const campaign = await campaignManager.createCampaign(req.body);
      res.status(201).json({
        success: true,
        campaign
      });
    } catch (error) {
      console.error('❌ Error creating campaign:', error);
      res.status(500).json({ error: 'Failed to create campaign', details: error.message });
    }
  });

  /**
   * GET /api/campaigns/:campaignId - Get campaign details
   */
  app.get('/api/campaigns/:campaignId', async (req, res) => {
    try {
      const details = await campaignManager.getCampaignDetails(req.params.campaignId);
      res.json({
        success: true,
        ...details
      });
    } catch (error) {
      console.error('❌ Error fetching campaign:', error);
      res.status(404).json({ error: 'Campaign not found' });
    }
  });

  /**
   * GET /api/campaigns/business/:businessId - List campaigns
   */
  app.get('/api/campaigns/business/:businessId', async (req, res) => {
    try {
      return new Promise((resolve) => {
        db.db.all(
          `SELECT * FROM campaigns WHERE business_id = ? ORDER BY created_at DESC LIMIT 50`,
          [req.params.businessId],
          (err, rows) => {
            if (err) {
              res.status(500).json({ error: 'Failed to fetch campaigns' });
            } else {
              res.json({
                success: true,
                campaigns: rows || [],
                count: rows?.length || 0
              });
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error listing campaigns:', error);
      res.status(500).json({ error: 'Failed to list campaigns' });
    }
  });

  /**
   * PUT /api/campaigns/:campaignId - Update campaign
   */
  app.put('/api/campaigns/:campaignId', async (req, res) => {
    try {
      const { name, description, persona, template, callFrequency, maxRetryAttempts, metadata } = req.body;
      
      return new Promise((resolve) => {
        db.db.run(
          `UPDATE campaigns SET name = ?, description = ?, persona = ?, template = ?,
           call_frequency = ?, max_retry_attempts = ?, metadata = ?, updated_at = ?
           WHERE campaign_id = ?`,
          [name, description, persona, template, callFrequency, maxRetryAttempts, 
           JSON.stringify(metadata || {}), new Date().toISOString(), req.params.campaignId],
          (err) => {
            if (err) {
              res.status(500).json({ error: 'Failed to update campaign' });
            } else {
              res.json({ success: true, message: 'Campaign updated' });
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error updating campaign:', error);
      res.status(500).json({ error: 'Failed to update campaign' });
    }
  });

  /**
   * DELETE /api/campaigns/:campaignId - Delete campaign
   */
  app.delete('/api/campaigns/:campaignId', async (req, res) => {
    try {
      return new Promise((resolve) => {
        db.db.run(
          `DELETE FROM campaigns WHERE campaign_id = ?`,
          [req.params.campaignId],
          (err) => {
            if (err) {
              res.status(500).json({ error: 'Failed to delete campaign' });
            } else {
              res.json({ success: true, message: 'Campaign deleted' });
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error deleting campaign:', error);
      res.status(500).json({ error: 'Failed to delete campaign' });
    }
  });

  // ============================================================================
  // CAMPAIGN CONTACTS ENDPOINTS
  // ============================================================================

  /**
   * POST /api/campaigns/:campaignId/contacts - Add contacts
   */
  app.post('/api/campaigns/:campaignId/contacts', async (req, res) => {
    try {
      const { contacts } = req.body;
      if (!Array.isArray(contacts)) {
        return res.status(400).json({ error: 'Contacts must be an array' });
      }

      const result = await campaignManager.addContacts(req.params.campaignId, contacts);
      res.status(201).json({
        success: true,
        ...result
      });
    } catch (error) {
      console.error('❌ Error adding contacts:', error);
      res.status(500).json({ error: 'Failed to add contacts' });
    }
  });

  /**
   * POST /api/campaigns/:campaignId/contacts/validate - Validate and filter contacts against DNC
   */
  app.post('/api/campaigns/:campaignId/contacts/validate', async (req, res) => {
    try {
      const { contacts } = req.body;
      if (!Array.isArray(contacts)) {
        return res.status(400).json({ error: 'Contacts must be an array' });
      }

      const filtered = await dncChecker.filterContactsAgainstDNC(contacts);
      const dncStats = await dncChecker.getDNCStats();

      res.json({
        success: true,
        allowed: filtered.allowed,
        blocked: filtered.blocked,
        allowedCount: filtered.allowed.length,
        blockedCount: filtered.blocked.length,
        dncRegistry: dncStats
      });
    } catch (error) {
      console.error('❌ Error validating contacts:', error);
      res.status(500).json({ error: 'Failed to validate contacts' });
    }
  });

  /**
   * GET /api/campaigns/:campaignId/contacts - List campaign contacts
   */
  app.get('/api/campaigns/:campaignId/contacts', async (req, res) => {
    try {
      const status = req.query.status || null;
      let sql = `SELECT * FROM campaign_contacts WHERE campaign_id = ?`;
      const params = [req.params.campaignId];

      if (status) {
        sql += ` AND status = ?`;
        params.push(status);
      }

      return new Promise((resolve) => {
        db.db.all(sql + ` LIMIT 100`, params, (err, rows) => {
          if (err) {
            res.status(500).json({ error: 'Failed to fetch contacts' });
          } else {
            res.json({
              success: true,
              contacts: rows || [],
              count: rows?.length || 0
            });
          }
          resolve();
        });
      });
    } catch (error) {
      console.error('❌ Error listing contacts:', error);
      res.status(500).json({ error: 'Failed to list contacts' });
    }
  });

  // ============================================================================
  // CAMPAIGN CONTROL ENDPOINTS
  // ============================================================================

  /**
   * POST /api/campaigns/:campaignId/start - Start campaign
   */
  app.post('/api/campaigns/:campaignId/start', async (req, res) => {
    try {
      const result = await campaignManager.startCampaign(req.params.campaignId);
      
      // Listen for dial events
      campaignManager.on('dial_contact', async (event) => {
        console.log(`📞 Dialing: ${event.contact.phoneNumber}`);
        // This would be handled by the main call endpoint
        // The event is emitted here for the API to process
      });

      res.json({
        success: true,
        message: 'Campaign started',
        ...result
      });
    } catch (error) {
      console.error('❌ Error starting campaign:', error);
      res.status(500).json({ error: 'Failed to start campaign', details: error.message });
    }
  });

  /**
   * POST /api/campaigns/:campaignId/pause - Pause campaign
   */
  app.post('/api/campaigns/:campaignId/pause', async (req, res) => {
    try {
      await campaignManager.pauseCampaign(req.params.campaignId);
      res.json({
        success: true,
        message: 'Campaign paused'
      });
    } catch (error) {
      console.error('❌ Error pausing campaign:', error);
      res.status(500).json({ error: 'Failed to pause campaign' });
    }
  });

  /**
   * POST /api/campaigns/:campaignId/record-call - Record campaign call result
   */
  app.post('/api/campaigns/:campaignId/record-call', async (req, res) => {
    try {
      const { contactId, result } = req.body;
      const callId = await campaignManager.recordCampaignCall(
        req.params.campaignId,
        contactId,
        result
      );
      res.json({
        success: true,
        callId
      });
    } catch (error) {
      console.error('❌ Error recording call:', error);
      res.status(500).json({ error: 'Failed to record call' });
    }
  });

  // ============================================================================
  // DNC MANAGEMENT ENDPOINTS
  // ============================================================================

  /**
   * POST /api/dnc/add - Add number to DNC list
   */
  app.post('/api/dnc/add', async (req, res) => {
    try {
      const { phoneNumber, name, reason, source, expiresAt, notes } = req.body;
      await dncChecker.addToDNC(phoneNumber, { name, reason, source, expiresAt, notes });
      res.json({
        success: true,
        message: `Added to DNC: ${phoneNumber}`
      });
    } catch (error) {
      console.error('❌ Error adding to DNC:', error);
      res.status(500).json({ error: 'Failed to add to DNC' });
    }
  });

  /**
   * POST /api/dnc/remove - Remove number from DNC list
   */
  app.post('/api/dnc/remove', async (req, res) => {
    try {
      const { phoneNumber } = req.body;
      await dncChecker.removeFromDNC(phoneNumber);
      res.json({
        success: true,
        message: `Removed from DNC: ${phoneNumber}`
      });
    } catch (error) {
      console.error('❌ Error removing from DNC:', error);
      res.status(500).json({ error: 'Failed to remove from DNC' });
    }
  });

  /**
   * POST /api/dnc/import - Bulk import DNC list
   */
  app.post('/api/dnc/import', async (req, res) => {
    try {
      const { phoneNumbers, source, reason } = req.body;
      if (!Array.isArray(phoneNumbers)) {
        return res.status(400).json({ error: 'phoneNumbers must be an array' });
      }
      const result = await dncChecker.importDNCList(phoneNumbers, { source, reason });
      res.json({
        success: true,
        ...result
      });
    } catch (error) {
      console.error('❌ Error importing DNC list:', error);
      res.status(500).json({ error: 'Failed to import DNC list' });
    }
  });

  /**
   * GET /api/dnc/stats - Get DNC statistics
   */
  app.get('/api/dnc/stats', async (req, res) => {
    try {
      const stats = await dncChecker.getDNCStats();
      res.json({
        success: true,
        ...stats
      });
    } catch (error) {
      console.error('❌ Error fetching DNC stats:', error);
      res.status(500).json({ error: 'Failed to fetch DNC stats' });
    }
  });

  /**
   * GET /api/dnc/check/:phoneNumber - Check if number is on DNC
   */
  app.get('/api/dnc/check/:phoneNumber', async (req, res) => {
    try {
      const isDNC = await dncChecker.isOnDNC(req.params.phoneNumber);
      res.json({
        success: true,
        phoneNumber: req.params.phoneNumber,
        isDNC
      });
    } catch (error) {
      console.error('❌ Error checking DNC:', error);
      res.status(500).json({ error: 'Failed to check DNC status' });
    }
  });

  // ============================================================================
  // CAMPAIGN ANALYTICS ENDPOINTS
  // ============================================================================

  /**
   * GET /api/campaigns/:campaignId/analytics - Get campaign analytics
   */
  app.get('/api/campaigns/:campaignId/analytics', async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 7;
      const dateFrom = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();

      return new Promise((resolve) => {
        const queries = {
          totalCalls: `SELECT COUNT(*) as count FROM campaign_calls WHERE campaign_id = ? AND created_at >= ?`,
          
          statusBreakdown: `
            SELECT outcome, COUNT(*) as count 
            FROM campaign_calls 
            WHERE campaign_id = ? AND created_at >= ?
            GROUP BY outcome
          `,

          conversionRate: `
            SELECT COUNT(CASE WHEN conversion_result = 1 THEN 1 END) as conversions,
                   COUNT(*) as total
            FROM campaign_calls
            WHERE campaign_id = ? AND created_at >= ?
          `,

          avgDuration: `
            SELECT AVG(duration) as avg_duration, MAX(duration) as max_duration
            FROM campaign_calls
            WHERE campaign_id = ? AND created_at >= ? AND duration > 0
          `,

          sentimentBreakdown: `
            SELECT sentiment, COUNT(*) as count
            FROM campaign_calls
            WHERE campaign_id = ? AND created_at >= ?
            GROUP BY sentiment
          `
        };

        const results = {};
        let completed = 0;
        const total = Object.keys(queries).length;

        for (const [key, query] of Object.entries(queries)) {
          db.db.all(query, [req.params.campaignId, dateFrom], (err, rows) => {
            results[key] = rows || [];
            completed++;
            if (completed === total) {
              res.json({
                success: true,
                campaignId: req.params.campaignId,
                period: { days, from: dateFrom },
                summary: {
                  totalCalls: results.totalCalls[0]?.count || 0,
                  conversions: results.conversionRate[0]?.conversions || 0,
                  conversionRate: results.conversionRate[0] ? 
                    ((results.conversionRate[0].conversions / results.conversionRate[0].total) * 100).toFixed(2) : 0,
                  avgDuration: Math.round(results.avgDuration[0]?.avg_duration || 0)
                },
                breakdown: {
                  byOutcome: results.statusBreakdown,
                  bySentiment: results.sentimentBreakdown
                }
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

  console.log('✅ Campaign routes registered'.green);
};
