/**
 * Call Template Management Routes
 * /api/call-templates/* - CRUD operations for call templates
 */

const { v4: uuidv4 } = require('uuid');

module.exports = function(app, { db }) {
  /**
   * Normalize template payload
   */
  function normalizeTemplatePayload(body) {
    return {
      name: (body.name || '').trim(),
      description: (body.description || '').trim(),
      category: (body.category || 'general').trim(),
      variant: (body.variant || 'default').trim(),
      prompt: (body.prompt || '').trim(),
      firstMessage: (body.firstMessage || body.first_message || '').trim(),
      tags: Array.isArray(body.tags)
        ? body.tags.map(t => String(t).trim()).join(',')
        : (body.tags || '').trim(),
      metadata: typeof body.metadata === 'object' ? body.metadata : {}
    };
  }

  /**
   * Check if error is name constraint
   */
  function isTemplateNameConstraint(error) {
    return error?.message?.includes('UNIQUE constraint failed') ||
           error?.message?.includes('call_templates.name');
  }

  /**
   * Suggest unique template name
   */
  async function suggestTemplateName(baseName = 'template') {
    const maxAttempts = 10;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const candidate = attempts === 0
        ? baseName
        : `${baseName}-${uuidv4().substring(0, 8)}`;

      return new Promise((resolve) => {
        db.db.get(
          'SELECT COUNT(*) as count FROM call_templates WHERE name = ?',
          [candidate],
          (err, row) => {
            if (err || !row || row.count === 0) {
              resolve(candidate);
            } else {
              attempts++;
              if (attempts < maxAttempts) {
                suggestTemplateName(baseName).then(resolve);
              } else {
                resolve(`${baseName}-${Date.now()}`);
              }
            }
          }
        );
      });
    }

    return `${baseName}-${Date.now()}`;
  }

  /**
   * GET /api/call-templates - List templates
   */
  app.get('/api/call-templates', async (req, res) => {
    try {
      return new Promise((resolve) => {
        db.db.all(
          'SELECT * FROM call_templates ORDER BY created_at DESC LIMIT 100',
          (err, rows) => {
            if (err) {
              res.status(500).json({ error: 'Failed to fetch templates' });
            } else {
              res.json({
                success: true,
                templates: rows || [],
                count: rows?.length || 0
              });
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error listing templates:', error);
      res.status(500).json({ error: 'Failed to list templates' });
    }
  });

  /**
   * GET /api/call-templates/:id - Get template details
   */
  app.get('/api/call-templates/:id', async (req, res) => {
    try {
      return new Promise((resolve) => {
        db.db.get(
          'SELECT * FROM call_templates WHERE id = ?',
          [req.params.id],
          (err, row) => {
            if (err || !row) {
              res.status(404).json({ error: 'Template not found' });
            } else {
              res.json({
                success: true,
                template: row
              });
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error fetching template:', error);
      res.status(500).json({ error: 'Failed to fetch template' });
    }
  });

  /**
   * POST /api/call-templates - Create template
   */
  app.post('/api/call-templates', async (req, res) => {
    try {
      const normalized = normalizeTemplatePayload(req.body);

      if (!normalized.name || !normalized.prompt) {
        return res.status(400).json({
          error: 'Missing required fields: name, prompt'
        });
      }

      return new Promise((resolve) => {
        db.db.run(
          `INSERT INTO call_templates (name, description, category, variant, prompt, first_message, tags, metadata, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          [
            normalized.name,
            normalized.description,
            normalized.category,
            normalized.variant,
            normalized.prompt,
            normalized.firstMessage,
            typeof normalized.tags === 'string' ? normalized.tags : '',
            JSON.stringify(normalized.metadata)
          ],
          function(err) {
            if (err) {
              if (isTemplateNameConstraint(err)) {
                res.status(409).json({
                  error: 'Template name already exists',
                  suggestion: suggestTemplateName(normalized.name)
                });
              } else {
                res.status(500).json({ error: 'Failed to create template' });
              }
            } else {
              res.status(201).json({
                success: true,
                id: this.lastID,
                message: 'Template created'
              });
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error creating template:', error);
      res.status(500).json({ error: 'Failed to create template' });
    }
  });

  /**
   * PUT /api/call-templates/:id - Update template
   */
  app.put('/api/call-templates/:id', async (req, res) => {
    try {
      const normalized = normalizeTemplatePayload(req.body);

      return new Promise((resolve) => {
        db.db.run(
          `UPDATE call_templates 
           SET name=?, description=?, category=?, variant=?, prompt=?, 
               first_message=?, tags=?, metadata=?, updated_at=datetime('now')
           WHERE id=?`,
          [
            normalized.name,
            normalized.description,
            normalized.category,
            normalized.variant,
            normalized.prompt,
            normalized.firstMessage,
            typeof normalized.tags === 'string' ? normalized.tags : '',
            JSON.stringify(normalized.metadata),
            req.params.id
          ],
          function(err) {
            if (err) {
              res.status(500).json({ error: 'Failed to update template' });
            } else if (this.changes === 0) {
              res.status(404).json({ error: 'Template not found' });
            } else {
              res.json({ success: true, message: 'Template updated' });
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error updating template:', error);
      res.status(500).json({ error: 'Failed to update template' });
    }
  });

  /**
   * POST /api/call-templates/:id/clone - Clone template
   */
  app.post('/api/call-templates/:id/clone', async (req, res) => {
    try {
      return new Promise((resolve) => {
        db.db.get(
          'SELECT * FROM call_templates WHERE id = ?',
          [req.params.id],
          (err, template) => {
            if (err || !template) {
              res.status(404).json({ error: 'Template not found' });
              resolve();
              return;
            }

            const newName = req.body.name || `${template.name}-copy`;

            db.db.run(
              `INSERT INTO call_templates (name, description, category, variant, prompt, first_message, tags, metadata, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
              [
                newName,
                template.description,
                template.category,
                template.variant,
                template.prompt,
                template.first_message,
                template.tags,
                template.metadata
              ],
              function(err) {
                if (err) {
                  res.status(500).json({ error: 'Failed to clone template' });
                } else {
                  res.status(201).json({
                    success: true,
                    id: this.lastID,
                    message: 'Template cloned'
                  });
                }
                resolve();
              }
            );
          }
        );
      });
    } catch (error) {
      console.error('❌ Error cloning template:', error);
      res.status(500).json({ error: 'Failed to clone template' });
    }
  });

  /**
   * DELETE /api/call-templates/:id - Delete template
   */
  app.delete('/api/call-templates/:id', async (req, res) => {
    try {
      return new Promise((resolve) => {
        db.db.run(
          'DELETE FROM call_templates WHERE id = ?',
          [req.params.id],
          function(err) {
            if (err) {
              res.status(500).json({ error: 'Failed to delete template' });
            } else if (this.changes === 0) {
              res.status(404).json({ error: 'Template not found' });
            } else {
              res.json({ success: true, message: 'Template deleted' });
            }
            resolve();
          }
        );
      });
    } catch (error) {
      console.error('❌ Error deleting template:', error);
      res.status(500).json({ error: 'Failed to delete template' });
    }
  });

  console.log('✅ Template routes registered'.green);
};
