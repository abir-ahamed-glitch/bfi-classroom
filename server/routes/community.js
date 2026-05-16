import express from 'express';
import db from '../db/database.js';
import { authenticateToken, sanitizeInput } from '../middleware/auth.js';

const router = express.Router();

// Get unified community feed (posts + published projects)
router.get('/posts', authenticateToken, (req, res) => {
  try {
    // We'll use a UNION to get both regular posts and "standalone" published projects
    // regular posts already include shared projects, so we just need to add projects 
    // that were published but don't have a specific post entry.
    // Actually, to keep it simple and interleaved as requested:
    // We'll fetch all community_posts (which include shared projects) 
    // and we'll ensure standalone published projects are also included.
    
    // Step 1: Ensure all published projects have a corresponding community_post if they don't already
    // This maintains the "interleaved" requirement easily.
    const standaloneProjects = db.prepare(`
      SELECT id, user_id, created_at 
      FROM projects 
      WHERE show_on_community = 1 
      AND id NOT IN (SELECT shared_project_id FROM community_posts WHERE shared_project_id IS NOT NULL)
    `).all();

    if (standaloneProjects.length > 0) {
      console.log(`Syncing ${standaloneProjects.length} standalone projects to community feed...`);
      const insertPost = db.prepare(`
        INSERT INTO community_posts (user_id, shared_project_id, post_type, created_at)
        VALUES (?, ?, 'project_share', ?)
      `);
      
      const transaction = db.transaction((projs) => {
        for (const p of projs) {
          insertPost.run(p.user_id, p.id, p.created_at || new Date().toISOString());
        }
      });
      transaction(standaloneProjects);
    }

    const posts = db.prepare(`
      SELECT p.id, p.user_id, p.content, p.image_url as media_url, p.created_at, p.is_pinned,
      u.first_name, u.last_name, u.username, u.profile_picture, u.role,
      ip.subjects as instructor_subjects,
      CASE 
        WHEN p.shared_project_id IS NOT NULL THEN 'project' 
        WHEN p.image_url IS NOT NULL THEN 'image' 
        ELSE 'text' 
      END as media_type,
      (SELECT count(*) FROM post_likes WHERE post_id = p.id) as likes_count,
      EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND user_id = ?) as is_liked,
      (SELECT json_group_array(
          json_object(
            'id', c.id, 'content', c.content, 'created_at', c.created_at, 
            'user_id', c.user_id, 'first_name', cu.first_name, 'last_name', cu.last_name,
            'profile_picture', cu.profile_picture
          )
        ) 
       FROM post_comments c 
       JOIN users cu ON c.user_id = cu.id 
       WHERE c.post_id = p.id) as comments,
      json_object(
        'id', proj.id, 'title', proj.title, 'thumbnail_url', proj.thumbnail_url, 
        'poster_url', proj.poster_url, 'media_link', proj.media_link, 'media_source', proj.media_source,
        'genre', proj.genre, 'duration', proj.duration, 'synopsis', proj.synopsis,
        'credits', (SELECT json_group_array(json_object('role', rc.role, 'name', rc.name)) FROM project_credits rc WHERE rc.project_id = proj.id)
      ) as shared_project
      FROM community_posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN projects proj ON p.shared_project_id = proj.id
      LEFT JOIN instructor_profiles ip ON p.user_id = ip.user_id
      ORDER BY p.is_pinned DESC, p.created_at DESC, p.id DESC
      LIMIT 100
    `).all(req.user.id);

    // Format SQLite JSON output
    const formattedPosts = posts.map(post => {
      let comments = [];
      try { comments = JSON.parse(post.comments); } catch (e) { console.warn('Failed to parse comments', e); }
      comments = comments.filter(c => c.id !== null);

      let sharedProject = null;
      try { 
        sharedProject = JSON.parse(post.shared_project); 
        if (!sharedProject.id) {
          sharedProject = null;
        } else {
          // Parse credits inside shared project
          try { sharedProject.credits = JSON.parse(sharedProject.credits); } catch { sharedProject.credits = []; }
        }
      } catch (e) {
        console.warn('Failed to parse shared project', e);
      }

      return { ...post, is_liked: !!post.is_liked, is_pinned: !!post.is_pinned, comments, shared_project: sharedProject };
    });

    res.json(formattedPosts);
  } catch (error) {
    console.error('Fetch posts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get portfolio projects shared to community (Legacy - now unified, but keep for fallback)
router.get('/projects', authenticateToken, (req, res) => {
  try {
    const projects = db.prepare(`
      SELECT p.id, p.title, p.duration, p.genre, p.synopsis, p.media_link, p.media_source,
             p.poster_url, p.thumbnail_url, p.created_at,
             u.first_name, u.last_name,
             (SELECT json_group_array(json_object('role', role, 'name', name)) FROM project_credits WHERE project_id = p.id) as credits
      FROM projects p
      JOIN users u ON p.user_id = u.id
      WHERE p.show_on_community = 1 AND p.privacy_setting != 'private'
      ORDER BY p.created_at DESC, p.id DESC
    `).all();

    const formatted = projects.map(p => ({
      ...p,
      credits: (() => { try { return JSON.parse(p.credits); } catch { return []; } })()
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Community projects error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new post
router.post('/posts', authenticateToken, sanitizeInput, (req, res) => {
  try {
    const { content, media_url, project_id } = req.body;
    
    if (!content && !media_url && !project_id) {
      return res.status(400).json({ error: 'Post cannot be empty.' });
    }

    const insertPost = db.prepare(`
      INSERT INTO community_posts (user_id, content, image_url, shared_project_id, post_type)
      VALUES (?, ?, ?, ?, ?)
    `);

    let postType = 'text';
    if (project_id) postType = 'project_share';
    else if (media_url) postType = 'image';

    const result = insertPost.run(req.user.id, content || null, media_url || null, project_id || null, postType);
    
    // If it's a project share, ensure the project itself is marked as show_on_community
    if (project_id) {
      db.prepare('UPDATE projects SET show_on_community = 1 WHERE id = ?').run(project_id);
    }
    
    res.status(201).json({ message: 'Post created successfully', id: result.lastInsertRowid });
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ error: 'Internal server error while creating post' });
  }
});

// Pin/Unpin a post (Admin only)
router.post('/posts/:id/pin', authenticateToken, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can pin posts.' });
    }

    const postId = req.params.id;
    const { pin } = req.body; // boolean

    db.prepare('UPDATE community_posts SET is_pinned = ?, pinned_at = ? WHERE id = ?')
      .run(pin ? 1 : 0, pin ? new Date().toISOString() : null, postId);

    res.json({ message: pin ? 'Post pinned' : 'Post unpinned' });
  } catch (error) {
    console.error('Pin error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Like / Unlike a post
router.post('/posts/:id/like', authenticateToken, (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;

    const existingLike = db.prepare('SELECT id FROM post_likes WHERE post_id = ? AND user_id = ?').get(postId, userId);

    if (existingLike) {
      db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(postId, userId);
      res.json({ liked: false });
    } else {
      db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)').run(postId, userId);
      res.json({ liked: true });
    }
  } catch (error) {
    console.error('Like error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add a comment
router.post('/posts/:id/comments', authenticateToken, sanitizeInput, (req, res) => {
  try {
    const { content } = req.body;
    const postId = req.params.id;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment cannot be empty.' });
    }

    const result = db.prepare('INSERT INTO post_comments (post_id, user_id, content) VALUES (?, ?, ?)')
      .run(postId, req.user.id, content.trim());
      
    res.status(201).json({ message: 'Comment added', id: result.lastInsertRowid });
  } catch (error) {
    console.error('Comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a post
router.delete('/posts/:id', authenticateToken, (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const userId = req.user.id;
    const userRole = req.user.role?.toLowerCase();

    if (isNaN(postId)) {
      return res.status(400).json({ error: 'Invalid post ID.' });
    }

    // Check if user is owner or admin
    const post = db.prepare('SELECT user_id, shared_project_id FROM community_posts WHERE id = ?').get(postId);
    
    if (!post) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    if (post.user_id != userId && userRole !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized to delete this post.' });
    }

    const transaction = db.transaction(() => {
      // If it was a project share, also unpublish the project from community
      if (post.shared_project_id) {
        db.prepare('UPDATE projects SET show_on_community = 0 WHERE id = ?').run(post.shared_project_id);
      }
      
      db.prepare('DELETE FROM community_posts WHERE id = ?').run(postId);
    });

    transaction();
    console.log(`Successfully deleted post ${postId} and updated associated project visibility`);
    res.json({ message: 'Post deleted successfully.' });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
