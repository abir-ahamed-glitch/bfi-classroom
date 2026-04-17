import express from 'express';
import db from '../db/database.js';
import { authenticateToken, sanitizeInput } from '../middleware/auth.js';

const router = express.Router();

// Get community posts
router.get('/posts', authenticateToken, (req, res) => {
  try {
    const posts = db.prepare(`
      SELECT p.id, p.content, p.image_url as media_url, p.created_at, u.first_name, u.last_name, u.username, u.profile_picture,
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
            'user_id', c.user_id, 'first_name', cu.first_name, 'last_name', cu.last_name
          )
        ) 
       FROM post_comments c 
       JOIN users cu ON c.user_id = cu.id 
       WHERE c.post_id = p.id) as comments,
      json_object(
        'id', proj.id, 'title', proj.title, 'thumbnail_url', proj.thumbnail_url, 'media_source', proj.media_source
      ) as shared_project
      FROM community_posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN projects proj ON p.shared_project_id = proj.id
      ORDER BY p.created_at DESC
      LIMIT 50
    `).all(req.user.id);

    // Format SQLite JSON output
    const formattedPosts = posts.map(post => {
      let comments = [];
      try { comments = JSON.parse(post.comments); } catch (e) { console.warn('Failed to parse comments', e); }
      // Filter out null objects resulting from empty group arrays
      comments = comments.filter(c => c.id !== null);

      let sharedProject = null;
      try { 
        sharedProject = JSON.parse(post.shared_project); 
        if (!sharedProject.id) sharedProject = null;
      } catch (e) {
        console.warn('Failed to parse shared project', e);
      }

      return { ...post, is_liked: !!post.is_liked, comments, shared_project: sharedProject };
    });

    res.json(formattedPosts);
  } catch (error) {
    console.error('Fetch posts error:', error);
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
      INSERT INTO community_posts (user_id, content, image_url, shared_project_id)
      VALUES (?, ?, ?, ?)
    `);

    const result = insertPost.run(req.user.id, content || null, media_url || null, project_id || null);
    
    res.status(201).json({ message: 'Post created successfully', id: result.lastInsertRowid });
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ error: 'Internal server error while creating post' });
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

export default router;
