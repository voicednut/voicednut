/**
 * Persona Management Routes
 * /api/personas/* - CRUD operations for personas
 */

const slugify = (str) => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

module.exports = function(app, { db, PersonaComposer }) {
  /**
   * Normalize persona payload
   */
  function normalizePersonaPayload(body) {
    return {
      name: (body.name || '').trim(),
      slug: (body.slug || slugify(body.name || '')).trim(),
      purpose: (body.purpose || 'general').trim(),
      channel: (body.channel || 'voice').trim(),
      tone: (body.tone || 'professional').trim(),
      mood: (body.mood || 'neutral').trim(),
      urgency: (body.urgency || 'normal').trim(),
      technicalLevel: (body.technical_level || body.technicalLevel || 'general').trim(),
      systemPrompt: (body.system_prompt || body.systemPrompt || '').trim(),
      customBehaviors: Array.isArray(body.custom_behaviors || body.customBehaviors)
        ? (body.custom_behaviors || body.customBehaviors).join(',')
        : ((body.custom_behaviors || body.customBehaviors) || '').trim(),
      keywords: Array.isArray(body.keywords)
        ? body.keywords.join(',')
        : (body.keywords || '').trim(),
      isDefault: Boolean(body.is_default || body.isDefault),
      metadata: typeof body.metadata === 'object' ? body.metadata : {}
    };
  }

  /**
   * Check if error is slug constraint
   */
  function isPersonaSlugConstraint(error) {
    return error?.message?.includes('UNIQUE constraint failed') ||
           error?.message?.includes('personas.slug');
  }

  /**
   * GET /api/personas - List personas
   */
  app.get('/api/personas', async (req, res) => {
    try {
      const includeSystem = req.query.include_system === 'true';
      const sql = includeSystem
        ? 'SELECT * FROM personas ORDER BY created_at DESC LIMIT 100'
        : 'SELECT * FROM personas WHERE is_default=0 ORDER BY created_at DESC LIMIT 100';

      return new Promise((resolve) => {
        db.db.all(sql, (err, rows) => {
          if (err) {
            res.status(500).json({ error: 'Failed to fetch personas' });
          } else {
            res.json({
              success: true,
              personas: rows || [],
              count: rows?.length || 0
            });
          }
          resolve();
        });
      });
    } catch (error) {
      console.error('❌ Error listing personas:', error);
      res.status(500).json({ error: 'Failed to list personas' });
    }
  });

  /**
   * GET /api/personas/:id - Get persona details
   */
  app.get('/api/personas/:id', async (req, res) => {
    try {
      return new Promise((resolve) => {
        db.db.get(
          'SELECT * FROM personas WHERE id = ? OR slug = ?',
          [req.params.id, req.params.id],
          (err, row) => {
            if (err || !row) {
              res.status(404).json({ error: 'Persona not found' });
            } else {
              res.json({
                success: true,
                persona: row
              });
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error fetching persona:', error);
      res.status(500).json({ error: 'Failed to fetch persona' });
    }
  });

  /**
   * POST /api/personas - Create persona
   */
  app.post('/api/personas', async (req, res) => {
    try {
      const normalized = normalizePersonaPayload(req.body);

      if (!normalized.name) {
        return res.status(400).json({
          error: 'Missing required field: name'
        });
      }

      if (!normalized.slug) {
        return res.status(400).json({
          error: 'Invalid or missing slug'
        });
      }

      return new Promise((resolve) => {
        db.db.run(
          `INSERT INTO personas (name, slug, purpose, channel, tone, mood, urgency, technical_level, system_prompt, custom_behaviors, keywords, is_default, metadata, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          [
            normalized.name,
            normalized.slug,
            normalized.purpose,
            normalized.channel,
            normalized.tone,
            normalized.mood,
            normalized.urgency,
            normalized.technicalLevel,
            normalized.systemPrompt,
            normalized.customBehaviors,
            normalized.keywords,
            normalized.isDefault ? 1 : 0,
            JSON.stringify(normalized.metadata)
          ],
          function(err) {
            if (err) {
              if (isPersonaSlugConstraint(err)) {
                res.status(409).json({
                  error: 'Persona slug already exists',
                  suggestion: `${normalized.slug}-${Date.now()}`
                });
              } else {
                console.error('❌ Create persona error:', err);
                res.status(500).json({ error: 'Failed to create persona' });
              }
            } else {
              res.status(201).json({
                success: true,
                id: this.lastID,
                slug: normalized.slug,
                message: 'Persona created'
              });
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error creating persona:', error);
      res.status(500).json({ error: 'Failed to create persona' });
    }
  });

  /**
   * PUT /api/personas/:id - Update persona
   */
  app.put('/api/personas/:id', async (req, res) => {
    try {
      const normalized = normalizePersonaPayload(req.body);

      return new Promise((resolve) => {
        db.db.run(
          `UPDATE personas 
           SET name=?, slug=?, purpose=?, channel=?, tone=?, mood=?, urgency=?, 
               technical_level=?, system_prompt=?, custom_behaviors=?, keywords=?, 
               is_default=?, metadata=?, updated_at=datetime('now')
           WHERE id=?`,
          [
            normalized.name,
            normalized.slug,
            normalized.purpose,
            normalized.channel,
            normalized.tone,
            normalized.mood,
            normalized.urgency,
            normalized.technicalLevel,
            normalized.systemPrompt,
            normalized.customBehaviors,
            normalized.keywords,
            normalized.isDefault ? 1 : 0,
            JSON.stringify(normalized.metadata),
            req.params.id
          ],
          function(err) {
            if (err) {
              if (isPersonaSlugConstraint(err)) {
                res.status(409).json({ error: 'Persona slug already in use' });
              } else {
                res.status(500).json({ error: 'Failed to update persona' });
              }
            } else if (this.changes === 0) {
              res.status(404).json({ error: 'Persona not found' });
            } else {
              res.json({ success: true, message: 'Persona updated' });
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error updating persona:', error);
      res.status(500).json({ error: 'Failed to update persona' });
    }
  });

  /**
   * POST /api/personas/:id/test - Test persona with sample input
   */
  app.post('/api/personas/:id/test', async (req, res) => {
    try {
      return new Promise((resolve) => {
        db.db.get(
          'SELECT * FROM personas WHERE id = ? OR slug = ?',
          [req.params.id, req.params.id],
          (err, persona) => {
            if (err || !persona) {
              res.status(404).json({ error: 'Persona not found' });
              resolve();
              return;
            }

            try {
              // Generate test prompt using PersonaComposer if available
              let testPrompt = persona.system_prompt || '';
              if (PersonaComposer && req.body.businessContext) {
                const composer = new PersonaComposer();
                testPrompt = composer.compose({
                  businessId: req.body.businessId || 'test',
                  customPrompt: persona.system_prompt,
                  purpose: persona.purpose,
                  channel: persona.channel,
                  urgency: persona.urgency
                });
              }

              res.json({
                success: true,
                persona: {
                  id: persona.id,
                  name: persona.name,
                  slug: persona.slug,
                  purpose: persona.purpose,
                  channel: persona.channel,
                  tone: persona.tone
                },
                testPrompt,
                sampleMessage: req.body.message || 'Hello, how can I help you today?'
              });
            } catch (composeError) {
              console.error('❌ Persona test error:', composeError);
              res.status(500).json({ error: 'Failed to test persona' });
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error testing persona:', error);
      res.status(500).json({ error: 'Failed to test persona' });
    }
  });

  /**
   * DELETE /api/personas/:id - Delete persona
   */
  app.delete('/api/personas/:id', async (req, res) => {
    try {
      return new Promise((resolve) => {
        db.db.get(
          'SELECT is_default FROM personas WHERE id = ?',
          [req.params.id],
          (err, persona) => {
            if (err || !persona) {
              res.status(404).json({ error: 'Persona not found' });
              resolve();
              return;
            }

            if (persona.is_default) {
              res.status(403).json({ error: 'Cannot delete default persona' });
              resolve();
              return;
            }

            db.db.run(
              'DELETE FROM personas WHERE id = ?',
              [req.params.id],
              function(err) {
                if (err) {
                  res.status(500).json({ error: 'Failed to delete persona' });
                } else {
                  res.json({ success: true, message: 'Persona deleted' });
                }
                resolve();
              }
            );
          }
        );
      });
    } catch (error) {
      console.error('❌ Error deleting persona:', error);
      res.status(500).json({ error: 'Failed to delete persona' });
    }
  });

  console.log('✅ Persona routes registered'.green);
};
