import express from 'express';
import db from '../db/database.js';
import { authenticateToken, sanitizeInput } from '../middleware/auth.js';

const router = express.Router();

// Get all portfolio projects for current user
router.get('/', authenticateToken, (req, res) => {
  try {
    const projects = db.prepare(`
      SELECT p.*,
      (SELECT json_group_array(json_object('role', role, 'name', name)) FROM project_credits WHERE project_id = p.id) as credits,
      (SELECT json_group_array(json_object('award_name', award_name, 'festival_name', festival_name, 'award_year', award_year)) FROM awards WHERE project_id = p.id) as awards
      FROM projects p
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(req.user.id);

    // SQLite json_group_array returns a stringified JSON array, so we parse it
    const formattedProjects = projects.map(p => ({
      ...p,
      credits: JSON.parse(p.credits),
      awards: JSON.parse(p.awards)
    }));

    res.json(formattedProjects);
  } catch (error) {
    console.error('Fetch portfolio error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new portfolio project
router.post('/', authenticateToken, sanitizeInput, (req, res) => {
  try {
    const { 
      title, duration, genre, synopsis, media_link, media_source, 
      poster_url, thumbnail_url, privacy_setting, show_on_dashboard, show_on_community,
      credits, awards 
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Project title is required' });
    }

    const transaction = db.transaction(() => {
      // Insert main project
      const insertProj = db.prepare(`
        INSERT INTO projects (
          user_id, title, duration, genre, synopsis, media_link, media_source, 
          poster_url, thumbnail_url, privacy_setting, show_on_dashboard, show_on_community
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = insertProj.run(
        req.user.id, title, duration, genre, synopsis, media_link, media_source,
        poster_url, thumbnail_url, privacy_setting, show_on_dashboard ? 1 : 0, show_on_community ? 1 : 0
      );
      const projectId = result.lastInsertRowid;

      // Insert credits (Director, Actor, etc.)
      if (credits && Array.isArray(credits)) {
        const insertCredit = db.prepare('INSERT INTO project_credits (project_id, role, name) VALUES (?, ?, ?)');
        for (const c of credits) {
          if (c.role && c.name) insertCredit.run(projectId, c.role, c.name);
        }
      }

      // Insert awards
      if (awards && Array.isArray(awards)) {
        const insertAward = db.prepare(`
          INSERT INTO awards (project_id, user_id, award_name, festival_name, award_year, category) 
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const a of awards) {
          if (a.awardName) {
            insertAward.run(projectId, req.user.id, a.awardName, a.festivalName, a.awardYear, a.category);
          }
        }
      }

      return projectId;
    });

    const newId = transaction();
    res.status(201).json({ message: 'Project added successfully', id: newId });
  } catch (error) {
    console.error('Create portfolio error:', error);
    res.status(500).json({ error: 'Internal server error while saving project' });
  }
});

// Delete a project
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    const result = db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Project not found or unauthorized' });
    }
    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
