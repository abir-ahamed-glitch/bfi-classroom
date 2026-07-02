import express from 'express';
import db from '../db/database.js';
import { authenticateToken, sanitizeInput } from '../middleware/auth.js';
import { logTrashAction } from '../utils/trashLogger.js';

const router = express.Router();

function sendCommunityPostNotification(postId, posterId, content, media_url, project_id, audience, isUpdate = false, io) {
  try {
    // 1. Get poster details
    const poster = db.prepare('SELECT first_name, last_name, role, profile_picture FROM users WHERE id = ?').get(posterId);
    const posterName = poster ? `${poster.first_name} ${poster.last_name}` : 'A user';

    // 2. Prepare message snippet & image
    let snippet = (content || '').trim().substring(0, 50);
    if (content && content.length > 50) snippet += '...';
    if (!snippet) snippet = project_id ? 'Shared a project' : 'Shared a media post';

    let messageText;
    const isSnippetDefault = !(content || '').trim();
    if (isUpdate) {
      if (project_id) {
        messageText = isSnippetDefault 
          ? `${posterName} updated their shared project`
          : `${posterName} updated their shared project: "${snippet}"`;
      } else {
        messageText = isSnippetDefault
          ? `${posterName} updated their post`
          : `${posterName} updated their post: "${snippet}"`;
      }
    } else {
      if (project_id) {
        messageText = isSnippetDefault
          ? `${posterName} shared a project`
          : `${posterName} shared a project: "${snippet}"`;
      } else {
        messageText = isSnippetDefault
          ? `${posterName} shared a post`
          : `${posterName} posted: "${snippet}"`;
      }
    }
    
    let imageUrl = null;
    if (project_id) {
      const proj = db.prepare('SELECT thumbnail_url, poster_url FROM projects WHERE id = ?').get(project_id);
      if (proj) imageUrl = proj.thumbnail_url || proj.poster_url;
    } else if (media_url) {
      try {
        const parsed = JSON.parse(media_url);
        if (Array.isArray(parsed) && parsed.length > 0) imageUrl = parsed[0].url;
      } catch {
        imageUrl = media_url;
      }
    }

    const notifTitle = isUpdate ? `Post updated by ${posterName}` : `New post by ${posterName}`;
    const notifLink = `/community#post-${postId}`;

    // 3. Find who to notify
    const alreadyNotifiedRows = db.prepare('SELECT user_id FROM notifications WHERE link = ?').all(notifLink);
    const alreadyNotifiedSet = new Set(alreadyNotifiedRows.map(r => r.user_id));

    // Get all users except poster
    const allUsers = db.prepare('SELECT id, role FROM users WHERE id != ?').all(posterId);

    let posterBatchNumber = null;
    let posterCourses = [];
    if (audience === 'batchmates') {
      const pp = db.prepare('SELECT batch_number FROM student_profiles WHERE user_id = ?').get(posterId);
      posterBatchNumber = pp?.batch_number;
      posterCourses = db.prepare('SELECT course_name FROM student_course_enrollments WHERE user_id = ?').all(posterId).map(e => e.course_name);
    }

    const targetUsers = allUsers.filter(u => {
      // Exclude already notified
      if (alreadyNotifiedSet.has(u.id)) return false;

      // Admin always gets notified
      if (u.role === 'admin') return true;

      // Only me: only admins get notified
      if (audience === 'only_me') return false;

      // Public: everyone gets notified
      if (!audience || audience === 'public') return true;

      // Batchmates: only batchmates get notified
      if (audience === 'batchmates') {
        if (!posterBatchNumber) return false;
        const vp = db.prepare('SELECT batch_number FROM student_profiles WHERE user_id = ?').get(u.id);
        if (!vp || vp.batch_number !== posterBatchNumber) return false;
        const viewerCourses = db.prepare('SELECT course_name FROM student_course_enrollments WHERE user_id = ?').all(u.id).map(e => e.course_name);
        return viewerCourses.some(c => posterCourses.includes(c));
      }

      return true;
    });

    if (targetUsers.length > 0) {
      const insertNotification = db.prepare('INSERT INTO notifications (user_id, type, title, message, link, image_url) VALUES (?, ?, ?, ?, ?, ?)');
      const targetUserNotifications = [];
      const insertMany = db.transaction((users) => {
        for (const user of users) {
          const res = insertNotification.run(user.id, 'community', notifTitle, messageText, notifLink, imageUrl);
          targetUserNotifications.push({ userId: user.id, notifId: res.lastInsertRowid });
        }
      });
      insertMany(targetUsers);

      if (io) {
        for (const item of targetUserNotifications) {
          io.to(`user:${item.userId}`).emit('notification_received', {
            id: item.notifId,
            type: 'community',
            title: notifTitle,
            message: messageText,
            link: notifLink,
            image_url: imageUrl,
            sender_name: posterName,
            sender_avatar: poster ? poster.profile_picture : null,
            created_at: new Date().toISOString()
          });
        }
        io.emit('new_notification');
      }
    }
  } catch (err) {
    console.error('Notification dispatch failed:', err);
  }
}

function getCommentText(content) {
  if (!content) return '';
  if (content.startsWith('{') && content.endsWith('}')) {
    try {
      const parsed = JSON.parse(content);
      return parsed.text || '';
    } catch {
      // ignore
    }
  }
  return content;
}

function sendCommentNotifications(postId, commentId, commenterId, content, parentId, io) {
  try {
    const commenter = db.prepare('SELECT first_name, last_name, profile_picture FROM users WHERE id = ?').get(commenterId);
    if (!commenter) return;
    const commenterName = `${commenter.first_name} ${commenter.last_name}`;

    const textContent = getCommentText(content);
    let snippet = textContent.trim().substring(0, 50);
    if (textContent.length > 50) snippet += '...';

    // Get the post details to find the post owner and image
    const post = db.prepare('SELECT user_id, content, image_url, shared_project_id FROM community_posts WHERE id = ?').get(postId);
    if (!post) return;

    // Resolve post image
    let imageUrl = null;
    if (post.shared_project_id) {
      const proj = db.prepare('SELECT thumbnail_url, poster_url FROM projects WHERE id = ?').get(post.shared_project_id);
      if (proj) imageUrl = proj.thumbnail_url || proj.poster_url;
    } else if (post.image_url) {
      try {
        const parsed = JSON.parse(post.image_url);
        if (Array.isArray(parsed) && parsed.length > 0) imageUrl = parsed[0].url;
      } catch {
        imageUrl = post.image_url;
      }
    }

    const insertNotification = db.prepare(`
      INSERT INTO notifications (user_id, type, title, message, link, image_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const notifiedUserIds = new Set();
    const notifiedUsers = [];

    // 1. Reply Notification
    if (parentId) {
      const parentComment = db.prepare('SELECT user_id, parent_id FROM post_comments WHERE id = ?').get(parentId);
      if (parentComment && parentComment.user_id !== commenterId) {
        const isReply = parentComment.parent_id !== null;
        const targetType = isReply ? 'reply' : 'comment';
        const notifTitle = isReply ? 'New reply to your reply' : 'New reply to your comment';
        const messageText = snippet ? `${commenterName} replied to your ${targetType}: "${snippet}"` : `${commenterName} replied to your ${targetType}`;
        const res = insertNotification.run(
          parentComment.user_id,
          'community',
          notifTitle,
          messageText,
          `/community#post-${postId}`,
          imageUrl
        );
        notifiedUserIds.add(parentComment.user_id);
        notifiedUsers.push({
          userId: parentComment.user_id,
          notifId: res.lastInsertRowid,
          title: notifTitle,
          message: messageText
        });
      }
    }

    // 2. Post Owner Notification (when someone comments on their post)
    if (post.user_id !== commenterId && !notifiedUserIds.has(post.user_id)) {
      const messageText = snippet ? `${commenterName} commented on your post: "${snippet}"` : `${commenterName} commented on your post`;
      const res = insertNotification.run(
        post.user_id,
        'community',
        'New comment on your post',
        messageText,
        `/community#post-${postId}`,
        imageUrl
      );
      notifiedUserIds.add(post.user_id);
      notifiedUsers.push({
        userId: post.user_id,
        notifId: res.lastInsertRowid,
        title: 'New comment on your post',
        message: messageText
      });
    }

    // 3. Previous Commenters Notification (social activity alert)
    const postOwner = db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(post.user_id);
    const postOwnerName = postOwner ? `${postOwner.first_name} ${postOwner.last_name}` : 'a user';

    const previousCommenters = db.prepare(`
      SELECT DISTINCT user_id FROM post_comments 
      WHERE post_id = ? AND user_id != ? AND user_id != ?
    `).all(postId, commenterId, post.user_id);

    for (const c of previousCommenters) {
      if (!notifiedUserIds.has(c.user_id)) {
        let messageText;
        if (commenterId === post.user_id) {
          messageText = snippet ? `${commenterName} also commented on their post: "${snippet}"` : `${commenterName} also commented on their post`;
        } else {
          messageText = snippet ? `${commenterName} also commented on ${postOwnerName}'s post: "${snippet}"` : `${commenterName} also commented on ${postOwnerName}'s post`;
        }
        const res = insertNotification.run(
          c.user_id,
          'community',
          'Activity on post',
          messageText,
          `/community#post-${postId}`,
          imageUrl
        );
        notifiedUserIds.add(c.user_id);
        notifiedUsers.push({
          userId: c.user_id,
          notifId: res.lastInsertRowid,
          title: 'Activity on post',
          message: messageText
        });
      }
    }

    // 4. Mention Notification
    const matches = textContent.match(/@([a-zA-Z0-9._-]+)/g) || [];
    const mentionTokens = matches.map(m => m.slice(1).trim().toLowerCase());

    if (mentionTokens.length > 0) {
      // Find matching users
      const placeholders = mentionTokens.map(() => '?').join(',');
      const users = db.prepare(`
        SELECT id FROM users
        WHERE LOWER(username) IN (${placeholders})
           OR LOWER(first_name) IN (${placeholders})
           OR LOWER(last_name) IN (${placeholders})
      `).all(...mentionTokens, ...mentionTokens, ...mentionTokens);

      for (const u of users) {
        if (u.id !== commenterId && !notifiedUserIds.has(u.id)) {
          const messageText = snippet ? `${commenterName} mentioned you in a comment: "${snippet}"` : `${commenterName} mentioned you in a comment`;
          const res = insertNotification.run(
            u.id,
            'community',
            'You were mentioned',
            messageText,
            `/community#post-${postId}`,
            imageUrl
          );
          notifiedUserIds.add(u.id);
          notifiedUsers.push({
            userId: u.id,
            notifId: res.lastInsertRowid,
            title: 'You were mentioned',
            message: messageText
          });
        }
      }
    }

    // 5. Name-based Mention Notification (for replies prepopulated with user names)
    const nameMentionUsers = db.prepare(`
      SELECT id FROM users
      WHERE ? = (first_name || ' ' || last_name)
         OR ? LIKE (first_name || ' ' || last_name || ' %')
    `).all(textContent, textContent);

    for (const u of nameMentionUsers) {
      if (u.id !== commenterId && !notifiedUserIds.has(u.id)) {
        const messageText = snippet ? `${commenterName} mentioned you in a comment: "${snippet}"` : `${commenterName} mentioned you in a comment`;
        const res = insertNotification.run(
          u.id,
          'community',
          'You were mentioned',
          messageText,
          `/community#post-${postId}`,
          imageUrl
        );
        notifiedUserIds.add(u.id);
        notifiedUsers.push({
          userId: u.id,
          notifId: res.lastInsertRowid,
          title: 'You were mentioned',
          message: messageText
        });
      }
    }

    if (notifiedUsers.length > 0 && io) {
      for (const item of notifiedUsers) {
        io.to(`user:${item.userId}`).emit('notification_received', {
          id: item.notifId,
          type: 'community',
          title: item.title,
          message: item.message,
          link: `/community#post-${postId}`,
          image_url: imageUrl,
          sender_name: commenterName,
          sender_avatar: commenter.profile_picture,
          created_at: new Date().toISOString()
        });
      }
      io.emit('new_notification');
    }
  } catch (err) {
    console.error('Comment notification dispatch failed:', err);
  }
}

function sendCommentReactionNotification(postId, commentId, likerId, rxType, io) {
  try {
    const comment = db.prepare('SELECT user_id, content, parent_id FROM post_comments WHERE id = ?').get(commentId);
    if (!comment) return;
    
    // Don't notify if reacting to own comment/reply
    if (comment.user_id === likerId) return;

    const liker = db.prepare('SELECT first_name, last_name, profile_picture FROM users WHERE id = ?').get(likerId);
    if (!liker) return;
    const likerName = `${liker.first_name} ${liker.last_name}`;

    const textContent = getCommentText(comment.content);
    let snippet = textContent.trim().substring(0, 40);
    if (textContent.length > 40) snippet += '...';

    const rxLabel = rxType.charAt(0).toUpperCase() + rxType.slice(1);

    // Get the post details to find the post image
    const post = db.prepare('SELECT image_url, shared_project_id FROM community_posts WHERE id = ?').get(postId);
    let imageUrl = null;
    if (post) {
      if (post.shared_project_id) {
        const proj = db.prepare('SELECT thumbnail_url, poster_url FROM projects WHERE id = ?').get(post.shared_project_id);
        if (proj) imageUrl = proj.thumbnail_url || proj.poster_url;
      } else if (post.image_url) {
        try {
          const parsed = JSON.parse(post.image_url);
          if (Array.isArray(parsed) && parsed.length > 0) imageUrl = parsed[0].url;
        } catch {
          imageUrl = post.image_url;
        }
      }
    }

    const isReply = comment.parent_id !== null;
    const targetType = isReply ? 'reply' : 'comment';
    const notifTitle = isReply ? 'New reaction on your reply' : 'New reaction on your comment';

    const insertNotification = db.prepare(`
      INSERT INTO notifications (user_id, type, title, message, link, image_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const messageText = snippet ? `${likerName} reacted with "${rxLabel}" to your ${targetType}: "${snippet}"` : `${likerName} reacted with "${rxLabel}" to your ${targetType}`;

    const res = insertNotification.run(
      comment.user_id,
      'community',
      notifTitle,
      messageText,
      `/community#post-${postId}`,
      imageUrl
    );

    if (io) {
      io.to(`user:${comment.user_id}`).emit('notification_received', {
        id: res.lastInsertRowid,
        type: 'community',
        title: notifTitle,
        message: messageText,
        link: `/community#post-${postId}`,
        image_url: imageUrl,
        sender_name: likerName,
        sender_avatar: liker.profile_picture,
        created_at: new Date().toISOString()
      });
      io.emit('new_notification');
    }
  } catch (err) {
    console.error('Comment reaction notification dispatch failed:', err);
  }
}

function sendPostReactionNotification(postId, likerId, rxType, io) {
  try {
    const post = db.prepare('SELECT user_id, content, image_url, shared_project_id FROM community_posts WHERE id = ?').get(postId);
    if (!post) return;
    
    // Don't notify if reacting to own post
    if (post.user_id === likerId) return;

    const liker = db.prepare('SELECT first_name, last_name, profile_picture FROM users WHERE id = ?').get(likerId);
    if (!liker) return;
    const likerName = `${liker.first_name} ${liker.last_name}`;

    let snippet = (post.content || '').trim().substring(0, 40);
    if (post.content && post.content.length > 40) snippet += '...';

    // Resolve post image
    let imageUrl = null;
    if (post.shared_project_id) {
      const proj = db.prepare('SELECT thumbnail_url, poster_url FROM projects WHERE id = ?').get(post.shared_project_id);
      if (proj) imageUrl = proj.thumbnail_url || proj.poster_url;
    } else if (post.image_url) {
      try {
        const parsed = JSON.parse(post.image_url);
        if (Array.isArray(parsed) && parsed.length > 0) imageUrl = parsed[0].url;
      } catch {
        imageUrl = post.image_url;
      }
    }

    const rxLabel = rxType.charAt(0).toUpperCase() + rxType.slice(1);

    const insertNotification = db.prepare(`
      INSERT INTO notifications (user_id, type, title, message, link, image_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const messageText = snippet ? `${likerName} reacted with "${rxLabel}" to your post: "${snippet}"` : `${likerName} reacted with "${rxLabel}" to your post`;

    const res = insertNotification.run(
      post.user_id,
      'community',
      'New reaction on your post',
      messageText,
      `/community#post-${postId}`,
      imageUrl
    );

    if (io) {
      io.to(`user:${post.user_id}`).emit('notification_received', {
        id: res.lastInsertRowid,
        type: 'community',
        title: 'New reaction on your post',
        message: messageText,
        link: `/community#post-${postId}`,
        image_url: imageUrl,
        sender_name: likerName,
        sender_avatar: liker.profile_picture,
        created_at: new Date().toISOString()
      });
      io.emit('new_notification');
    }
  } catch (err) {
    console.error('Post reaction notification dispatch failed:', err);
  }
}

// Get list of reactors for a post
router.get('/posts/:id/reactors', authenticateToken, (req, res) => {
  try {
    const postId = req.params.id;
    const reactors = db.prepare(`
      SELECT pl.user_id, pl.reaction_type,
             u.first_name, u.last_name, u.username, u.profile_picture, u.role
      FROM post_likes pl
      JOIN users u ON pl.user_id = u.id
      WHERE pl.post_id = ?
    `).all(postId);
    res.json(reactors);
  } catch (err) {
    console.error('Error fetching post reactors:', err);
    res.status(500).json({ error: 'Failed to fetch reactors' });
  }
});

// Get list of reactors for a comment/reply
router.get('/comments/:id/reactors', authenticateToken, (req, res) => {
  try {
    const commentId = req.params.id;
    const reactors = db.prepare(`
      SELECT cl.user_id, cl.reaction_type,
             u.first_name, u.last_name, u.username, u.profile_picture, u.role
      FROM comment_likes cl
      JOIN users u ON cl.user_id = u.id
      WHERE cl.comment_id = ?
    `).all(commentId);
    res.json(reactors);
  } catch (err) {
    console.error('Error fetching comment reactors:', err);
    res.status(500).json({ error: 'Failed to fetch reactors' });
  }
});

// Get a single community post by ID
router.get('/posts/:id', authenticateToken, (req, res) => {
  try {
    const postId = req.params.id;
    const post = db.prepare(`
      SELECT p.id, p.user_id, p.content, p.image_url as media_url, p.created_at, p.is_pinned, p.audience, p.shares_count, p.scheduled_at,
      u.first_name, u.last_name, u.username, u.profile_picture, u.role,
      EXISTS(SELECT 1 FROM awards WHERE user_id = p.user_id) OR EXISTS(SELECT 1 FROM student_experiences WHERE user_id = p.user_id AND experience_type = 'Award') as has_awards,
      ip.subjects as instructor_subjects,
      CASE 
        WHEN p.shared_project_id IS NOT NULL THEN 'project' 
        WHEN p.image_url IS NOT NULL THEN 'image' 
        ELSE 'text' 
      END as media_type,
      (SELECT count(*) FROM post_likes WHERE post_id = p.id) as likes_count,
      EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND user_id = :viewerId) as is_liked,
      (SELECT reaction_type FROM post_likes WHERE post_id = p.id AND user_id = :viewerId) as user_reaction,
      (SELECT json_group_array(DISTINCT reaction_type) FROM post_likes WHERE post_id = p.id) as post_reactions,
      (SELECT json_group_array(
          json_object(
            'id', c.id, 
            'parent_id', c.parent_id,
            'content', c.content, 
            'created_at', c.created_at, 
            'user_id', c.user_id, 
            'first_name', cu.first_name, 
            'last_name', cu.last_name,
            'profile_picture', cu.profile_picture,
            'has_awards', EXISTS(SELECT 1 FROM awards WHERE user_id = c.user_id) OR EXISTS(SELECT 1 FROM student_experiences WHERE user_id = c.user_id AND experience_type = 'Award'),
            'likes_count', (SELECT count(*) FROM comment_likes WHERE comment_id = c.id),
            'is_liked', EXISTS(SELECT 1 FROM comment_likes WHERE comment_id = c.id AND user_id = :viewerId),
            'user_reaction', (SELECT reaction_type FROM comment_likes WHERE comment_id = c.id AND user_id = :viewerId),
            'reactions', (SELECT json_group_array(DISTINCT reaction_type) FROM comment_likes WHERE comment_id = c.id)
          )
        ) 
       FROM post_comments c 
       JOIN users cu ON c.user_id = cu.id 
       WHERE c.post_id = p.id) as comments,
      json_object(
        'id', proj.id, 'title', proj.title, 'thumbnail_url', proj.thumbnail_url, 
        'poster_url', proj.poster_url, 'media_link', proj.media_link, 'media_source', proj.media_source,
        'genre', proj.genre, 'duration', proj.duration, 'synopsis', proj.synopsis,
        'has_awards', EXISTS(SELECT 1 FROM awards WHERE project_id = proj.id),
        'credits', (SELECT json_group_array(json_object('role', rc.role, 'name', rc.name)) FROM project_credits rc WHERE rc.project_id = proj.id),
        'awards', (SELECT json_group_array(json_object('award_name', a.award_name, 'festival_name', a.festival_name, 'award_year', a.award_year)) FROM awards a WHERE a.project_id = proj.id)
      ) as shared_project
      FROM community_posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN projects proj ON p.shared_project_id = proj.id
      LEFT JOIN instructor_profiles ip ON p.user_id = ip.user_id
      WHERE p.id = :postId
        AND (p.scheduled_at IS NULL OR datetime(p.scheduled_at) <= datetime('now') OR p.user_id = :viewerId OR :viewerRole = 'admin')
    `).get({ viewerId: req.user.id, postId, viewerRole: req.user.role });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Format SQLite JSON output
    let comments = [];
    try { comments = JSON.parse(post.comments); } catch (e) { console.warn('Failed to parse comments', e); }
    comments = comments.filter(c => c.id !== null).map(c => {
      let parsedReactions = [];
      try {
        if (c.reactions) {
          parsedReactions = typeof c.reactions === 'string' ? JSON.parse(c.reactions) : c.reactions;
        }
      } catch {
        // ignore
      }
      parsedReactions = (parsedReactions || []).filter(r => r !== null);
      return { ...c, reactions: parsedReactions };
    });

    let sharedProject = null;
    try { 
      sharedProject = JSON.parse(post.shared_project); 
      if (!sharedProject.id) {
        sharedProject = null;
      } else {
        if (typeof sharedProject.credits === 'string') {
          try { sharedProject.credits = JSON.parse(sharedProject.credits); } catch { sharedProject.credits = []; }
        }
        if (typeof sharedProject.awards === 'string') {
          try { sharedProject.awards = JSON.parse(sharedProject.awards); } catch { sharedProject.awards = []; }
        }
      }
    } catch (e) {
      console.warn('Failed to parse shared project', e);
    }

    let postReactions = [];
    try {
      if (post.post_reactions) {
        postReactions = typeof post.post_reactions === 'string' ? JSON.parse(post.post_reactions) : post.post_reactions;
      }
    } catch {
      // ignore
    }
    postReactions = (postReactions || []).filter(r => r !== null);

    const formattedPost = { 
      ...post, 
      is_liked: !!post.is_liked, 
      is_pinned: !!post.is_pinned, 
      user_reaction: post.user_reaction || null, 
      reactions: postReactions, 
      comments, 
      shared_project: sharedProject, 
      shares_count: post.shares_count || 0,
      scheduled_at: post.scheduled_at || null
    };

    res.json(formattedPost);
  } catch (err) {
    console.error('Error fetching single post:', err);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});


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
      SELECT p.id, p.user_id, p.content, p.image_url as media_url, p.created_at, p.is_pinned, p.audience, p.shares_count, p.scheduled_at,
      u.first_name, u.last_name, u.username, u.profile_picture, u.role,
      EXISTS(SELECT 1 FROM awards WHERE user_id = p.user_id) OR EXISTS(SELECT 1 FROM student_experiences WHERE user_id = p.user_id AND experience_type = 'Award') as has_awards,
      ip.subjects as instructor_subjects,
      CASE 
        WHEN p.shared_project_id IS NOT NULL THEN 'project' 
        WHEN p.image_url IS NOT NULL THEN 'image' 
        ELSE 'text' 
      END as media_type,
      (SELECT count(*) FROM post_likes WHERE post_id = p.id) as likes_count,
      EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND user_id = :viewerId) as is_liked,
      (SELECT reaction_type FROM post_likes WHERE post_id = p.id AND user_id = :viewerId) as user_reaction,
      (SELECT json_group_array(DISTINCT reaction_type) FROM post_likes WHERE post_id = p.id) as post_reactions,
      (SELECT json_group_array(
          json_object(
            'id', c.id, 
            'parent_id', c.parent_id,
            'content', c.content, 
            'created_at', c.created_at, 
            'user_id', c.user_id, 
            'first_name', cu.first_name, 
            'last_name', cu.last_name,
            'profile_picture', cu.profile_picture,
            'has_awards', EXISTS(SELECT 1 FROM awards WHERE user_id = c.user_id) OR EXISTS(SELECT 1 FROM student_experiences WHERE user_id = c.user_id AND experience_type = 'Award'),
            'likes_count', (SELECT count(*) FROM comment_likes WHERE comment_id = c.id),
            'is_liked', EXISTS(SELECT 1 FROM comment_likes WHERE comment_id = c.id AND user_id = :viewerId),
            'user_reaction', (SELECT reaction_type FROM comment_likes WHERE comment_id = c.id AND user_id = :viewerId),
            'reactions', (SELECT json_group_array(DISTINCT reaction_type) FROM comment_likes WHERE comment_id = c.id)
          )
        ) 
       FROM post_comments c 
       JOIN users cu ON c.user_id = cu.id 
       WHERE c.post_id = p.id) as comments,
      json_object(
        'id', proj.id, 'title', proj.title, 'thumbnail_url', proj.thumbnail_url, 
        'poster_url', proj.poster_url, 'media_link', proj.media_link, 'media_source', proj.media_source,
        'genre', proj.genre, 'duration', proj.duration, 'synopsis', proj.synopsis,
        'has_awards', EXISTS(SELECT 1 FROM awards WHERE project_id = proj.id),
        'credits', (SELECT json_group_array(json_object('role', rc.role, 'name', rc.name)) FROM project_credits rc WHERE rc.project_id = proj.id),
        'awards', (SELECT json_group_array(json_object('award_name', a.award_name, 'festival_name', a.festival_name, 'award_year', a.award_year)) FROM awards a WHERE a.project_id = proj.id)
      ) as shared_project
      FROM community_posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN projects proj ON p.shared_project_id = proj.id
      LEFT JOIN instructor_profiles ip ON p.user_id = ip.user_id
      WHERE p.deleted_at IS NULL AND (p.scheduled_at IS NULL OR datetime(p.scheduled_at) <= datetime('now') OR p.user_id = :viewerId)
      ORDER BY p.is_pinned DESC, p.created_at DESC, p.id DESC
      LIMIT 100
    `).all({ viewerId: req.user.id });

    // Format SQLite JSON output
    const formattedPosts = posts.map(post => {
      let comments = [];
      try { comments = JSON.parse(post.comments); } catch (e) { console.warn('Failed to parse comments', e); }
      comments = comments.filter(c => c.id !== null).map(c => {
        let parsedReactions = [];
        try {
          if (c.reactions) {
            parsedReactions = typeof c.reactions === 'string' ? JSON.parse(c.reactions) : c.reactions;
          }
        } catch {
          // ignore
        }
        parsedReactions = (parsedReactions || []).filter(r => r !== null);
        return { ...c, reactions: parsedReactions };
      });

      let sharedProject = null;
      try { 
        sharedProject = JSON.parse(post.shared_project); 
        if (!sharedProject.id) {
          sharedProject = null;
        } else {
          // Parse credits inside shared project
          if (typeof sharedProject.credits === 'string') {
            try { sharedProject.credits = JSON.parse(sharedProject.credits); } catch { sharedProject.credits = []; }
          }
          if (typeof sharedProject.awards === 'string') {
            try { sharedProject.awards = JSON.parse(sharedProject.awards); } catch { sharedProject.awards = []; }
          }
        }
      } catch (e) {
        console.warn('Failed to parse shared project', e);
      }

      // Parse post reactions
      let postReactions = [];
      try {
        if (post.post_reactions) {
          postReactions = typeof post.post_reactions === 'string' ? JSON.parse(post.post_reactions) : post.post_reactions;
        }
      } catch {
        // ignore
      }
      postReactions = (postReactions || []).filter(r => r !== null);

      return { ...post, is_liked: !!post.is_liked, is_pinned: !!post.is_pinned, user_reaction: post.user_reaction || null, reactions: postReactions, comments, shared_project: sharedProject, shares_count: post.shares_count || 0, scheduled_at: post.scheduled_at || null };
    });

    // Filter posts by audience
    const viewerRole = req.user.role;
    let viewerBatchNumber = null;
    let viewerCourses = [];

    if (viewerRole === 'student') {
      const vp = db.prepare('SELECT batch_number FROM student_profiles WHERE user_id = ?').get(req.user.id);
      viewerBatchNumber = vp?.batch_number;
      viewerCourses = db.prepare('SELECT course_name FROM student_course_enrollments WHERE user_id = ?').all(req.user.id).map(e => e.course_name);
    }

    const filteredPosts = formattedPosts.filter(post => {
      // Admin sees everything
      if (viewerRole === 'admin') return true;
      // Own posts always visible
      if (post.user_id === req.user.id) return true;
      // Public posts visible to all
      if (!post.audience || post.audience === 'public') return true;
      // Only Me posts hidden from others
      if (post.audience === 'only_me') return false;
      // Batchmates: check if same batch + shared course
      if (post.audience === 'batchmates') {
        if (!viewerBatchNumber) return false;
        const posterProfile = db.prepare('SELECT batch_number FROM student_profiles WHERE user_id = ?').get(post.user_id);
        if (!posterProfile || posterProfile.batch_number !== viewerBatchNumber) return false;
        const posterCourses = db.prepare('SELECT course_name FROM student_course_enrollments WHERE user_id = ?').all(post.user_id).map(e => e.course_name);
        return posterCourses.some(c => viewerCourses.includes(c));
      }
      return true;
    });

    res.json(filteredPosts);
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
    const { content, media_url, project_id, audience, scheduled_at } = req.body;
    
    const postAudience = audience || 'public';
    const validAudience = ['public', 'batchmates', 'only_me'];
    if (!validAudience.includes(postAudience)) {
      return res.status(400).json({ error: 'Invalid audience' });
    }
    
    if (!content && !media_url && !project_id) {
      return res.status(400).json({ error: 'Post cannot be empty.' });
    }

    // Validate scheduled_at if provided
    let scheduledAtValue = null;
    if (scheduled_at) {
      const scheduledDate = new Date(scheduled_at);
      if (isNaN(scheduledDate.getTime())) {
        return res.status(400).json({ error: 'Invalid scheduled_at date.' });
      }
      if (scheduledDate <= new Date()) {
        return res.status(400).json({ error: 'Scheduled time must be in the future.' });
      }
      scheduledAtValue = scheduledDate.toISOString();
    }

    const insertPost = db.prepare(`
      INSERT INTO community_posts (user_id, content, image_url, shared_project_id, post_type, audience, scheduled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    let postType = 'text';
    if (project_id) postType = 'project_share';
    else if (media_url) postType = 'image';

    const result = insertPost.run(req.user.id, content || null, media_url || null, project_id || null, postType, postAudience, scheduledAtValue);
    
    // If it's a project share, ensure the project itself is marked as show_on_community
    if (project_id) {
      db.prepare('UPDATE projects SET show_on_community = 1 WHERE id = ?').run(project_id);
    }
      
    // Only send notifications and socket events for immediate posts (not scheduled)
    if (!scheduledAtValue) {
      sendCommunityPostNotification(result.lastInsertRowid, req.user.id, content, media_url, project_id, postAudience, false, req.app.get('io'));

      const io = req.app.get('io');
      if (io) {
        io.emit('new_post');
      }
    }
    
    res.status(201).json({ message: scheduledAtValue ? 'Post scheduled successfully' : 'Post created successfully', id: result.lastInsertRowid, scheduled_at: scheduledAtValue });
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

    const io = req.app.get('io');
    if (io) io.emit('new_post');

    res.json({ message: pin ? 'Post pinned' : 'Post unpinned' });
  } catch (error) {
    console.error('Pin error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Like / Unlike a post (with emoji reactions)
router.post('/posts/:id/like', authenticateToken, (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;
    const { reaction_type } = req.body || {};

    const validReactions = ['like', 'love', 'care', 'haha', 'wow', 'sad', 'angry'];
    const rxType = (reaction_type && validReactions.includes(reaction_type)) ? reaction_type : 'like';

    const existing = db.prepare('SELECT id, reaction_type FROM post_likes WHERE post_id = ? AND user_id = ?').get(postId, userId);

    let liked = false;
    let currentReaction = null;

    if (existing) {
      if (existing.reaction_type === rxType) {
        // Same reaction, remove it (unlike)
        db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(postId, userId);
        liked = false;
      } else {
        // Different reaction, update it
        db.prepare('UPDATE post_likes SET reaction_type = ? WHERE post_id = ? AND user_id = ?').run(rxType, postId, userId);
        liked = true;
        currentReaction = rxType;
      }
    } else {
      // New reaction, insert it
      db.prepare('INSERT INTO post_likes (post_id, user_id, reaction_type) VALUES (?, ?, ?)').run(postId, userId, rxType);
      liked = true;
      currentReaction = rxType;
    }

    const io = req.app.get('io');
    if (io) io.emit('new_post');

    if (liked) {
      sendPostReactionNotification(postId, userId, rxType, io);
    }

    res.json({ 
      message: liked ? `Post reacted with ${rxType}` : 'Post reaction removed', 
      liked, 
      reaction_type: currentReaction 
    });
  } catch (error) {
    console.error('Like error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add a comment
router.post('/posts/:id/comments', authenticateToken, sanitizeInput, (req, res) => {
  try {
    const { content, parent_id } = req.body;
    const postId = req.params.id;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment cannot be empty.' });
    }

    if (parent_id) {
      const parentComment = db.prepare('SELECT post_id FROM post_comments WHERE id = ?').get(parent_id);
      if (!parentComment) {
        return res.status(404).json({ error: 'Parent comment not found.' });
      }
      if (parentComment.post_id != postId) {
        return res.status(400).json({ error: 'Parent comment does not belong to this post.' });
      }
    }

    const result = db.prepare('INSERT INTO post_comments (post_id, user_id, content, parent_id) VALUES (?, ?, ?, ?)')
      .run(postId, req.user.id, content.trim(), parent_id || null);
      
    const io = req.app.get('io');
    if (io) io.emit('new_post');

    // Send notifications for replies and/or mentions
    sendCommentNotifications(postId, result.lastInsertRowid, req.user.id, content.trim(), parent_id || null, io);

    res.status(201).json({ message: 'Comment added', id: result.lastInsertRowid });
  } catch (error) {
    console.error('Comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Edit a comment
router.put('/posts/:id/comments/:commentId', authenticateToken, sanitizeInput, (req, res) => {
  try {
    const { content } = req.body;
    const { commentId } = req.params;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment content cannot be empty.' });
    }

    const result = db.prepare('UPDATE post_comments SET content = ? WHERE id = ? AND user_id = ?')
      .run(content.trim(), commentId, req.user.id);

    if (result.changes === 0) {
      return res.status(403).json({ error: 'Unauthorized to edit this comment or comment not found.' });
    }

    const io = req.app.get('io');
    if (io) io.emit('new_post');

    res.json({ message: 'Comment updated successfully.' });
  } catch (error) {
    console.error('Edit comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a comment
router.delete('/posts/:id/comments/:commentId', authenticateToken, (req, res) => {
  try {
    const { commentId, id: postId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role?.toLowerCase();

    // Check if user is the comment author, post author, or admin
    const comment = db.prepare('SELECT user_id FROM post_comments WHERE id = ?').get(commentId);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found.' });
    }

    const post = db.prepare('SELECT user_id FROM community_posts WHERE id = ?').get(postId);
    const isPostAuthor = post && post.user_id == userId;
    const isCommentAuthor = comment.user_id == userId;
    const isAdmin = userRole === 'admin';

    if (!isCommentAuthor && !isPostAuthor && !isAdmin) {
      return res.status(403).json({ error: 'Unauthorized to delete this comment.' });
    }

    db.prepare('DELETE FROM post_comments WHERE id = ?').run(commentId);
    
    const io = req.app.get('io');
    if (io) io.emit('new_post');

    res.json({ message: 'Comment deleted successfully.' });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Toggle like on a comment
router.post('/posts/:id/comments/:commentId/like', authenticateToken, (req, res) => {
  try {
    const { commentId } = req.params;
    const { reaction_type } = req.body;
    const userId = req.user.id;

    const validReactions = ['like', 'love', 'care', 'haha', 'wow', 'sad', 'angry'];
    const rxType = (reaction_type && validReactions.includes(reaction_type)) ? reaction_type : 'like';

    // Verify comment exists
    const comment = db.prepare('SELECT id FROM post_comments WHERE id = ?').get(commentId);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found.' });
    }

    // Check if already liked
    const existing = db.prepare('SELECT id, reaction_type FROM comment_likes WHERE comment_id = ? AND user_id = ?').get(commentId, userId);
    
    let liked = false;
    let currentReaction = null;

    if (existing) {
      if (existing.reaction_type === rxType) {
        // Same reaction, remove it (unlike)
        db.prepare('DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?').run(commentId, userId);
        liked = false;
      } else {
        // Different reaction, update it
        db.prepare('UPDATE comment_likes SET reaction_type = ? WHERE comment_id = ? AND user_id = ?').run(rxType, commentId, userId);
        liked = true;
        currentReaction = rxType;
      }
    } else {
      // New reaction, insert it
      db.prepare('INSERT INTO comment_likes (comment_id, user_id, reaction_type) VALUES (?, ?, ?)').run(commentId, userId, rxType);
      liked = true;
      currentReaction = rxType;
    }

    const io = req.app.get('io');
    if (io) io.emit('new_post');

    if (liked) {
      sendCommentReactionNotification(req.params.id, commentId, userId, rxType, io);
    }

    res.json({ 
      message: liked ? `Comment reacted with ${rxType}` : 'Comment reaction removed', 
      liked, 
      reaction_type: currentReaction 
    });
  } catch (error) {
    console.error('Comment like error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Report a comment
router.post('/posts/:id/comments/:commentId/report', authenticateToken, (req, res) => {
  try {
    const { commentId } = req.params;
    const reporterId = req.user.id;

    // Check if comment exists
    const comment = db.prepare('SELECT id FROM post_comments WHERE id = ?').get(commentId);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found.' });
    }

    db.prepare(`
      INSERT INTO comment_reports (comment_id, reporter_id)
      VALUES (?, ?)
      ON CONFLICT(comment_id, reporter_id) DO NOTHING
    `).run(commentId, reporterId);

    res.json({ message: 'Comment reported successfully.' });
  } catch (error) {
    console.error('Report comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Edit a post (content, audience, and/or media_url)
router.put('/posts/:id', authenticateToken, sanitizeInput, (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const userId = req.user.id;
    const userRole = req.user.role?.toLowerCase();
    const { content, audience, media_url } = req.body;

    if (isNaN(postId)) {
      return res.status(400).json({ error: 'Invalid post ID.' });
    }

    // Check if post exists
    const post = db.prepare('SELECT user_id FROM community_posts WHERE id = ?').get(postId);
    if (!post) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    // Check authorization (only owner or admin)
    if (post.user_id != userId && userRole !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized to edit this post.' });
    }

    // Validate audience if provided
    if (audience) {
      const validAudience = ['public', 'batchmates', 'only_me'];
      if (!validAudience.includes(audience)) {
        return res.status(400).json({ error: 'Invalid audience value.' });
      }
    }

    // Fetch previous post details
    const prevPost = db.prepare('SELECT content, image_url as media_url, shared_project_id as project_id, audience FROM community_posts WHERE id = ?').get(postId);

    let finalMediaUrl = prevPost.media_url;
    if (media_url !== undefined) {
      finalMediaUrl = media_url || null;
    }

    let postType = 'text';
    if (prevPost.project_id) {
      postType = 'project_share';
    } else if (finalMediaUrl) {
      postType = 'image';
    }

    // Update post
    db.prepare('UPDATE community_posts SET content = ?, audience = ?, image_url = ?, post_type = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(
        content !== undefined ? (content || null) : prevPost.content,
        audience !== undefined ? audience : prevPost.audience,
        finalMediaUrl,
        postType,
        postId
      );


    // Check if we turned an Only Me or Batchmates post to Public
    const newAudience = audience !== undefined ? audience : prevPost.audience;
    const oldAudience = prevPost.audience || 'public';
    const isTurnedToPublic = (oldAudience === 'only_me' || oldAudience === 'batchmates') && newAudience === 'public';

    if (isTurnedToPublic) {
      const finalContent = content !== undefined ? content : prevPost.content;
      sendCommunityPostNotification(postId, userId, finalContent, finalMediaUrl, prevPost.project_id, 'public', true, req.app.get('io'));
    }

    const io = req.app.get('io');
    if (io) io.emit('new_post');

    res.json({ message: 'Post updated successfully.' });
  } catch (error) {
    console.error('Edit post error:', error);
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
    const post = db.prepare('SELECT user_id, shared_project_id, content FROM community_posts WHERE id = ?').get(postId);
    
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
      
      db.prepare("UPDATE community_posts SET deleted_at = datetime('now'), deleted_by_admin_id = ? WHERE id = ?").run(req.user.id, postId);
    });

    transaction();
    logTrashAction('posts', postId, String(post.content || '').substring(0, 50) + '...', 'deleted', req.user.id);
    console.log(`Successfully deleted post ${postId} and updated associated project visibility`);
    
    const io = req.app.get('io');
    if (io) io.emit('new_post');

    res.json({ message: 'Post deleted successfully.' });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Share a post (increment share count)
router.post('/posts/:id/share', authenticateToken, (req, res) => {
  try {
    const postId = req.params.id;
    const result = db.prepare('UPDATE community_posts SET shares_count = COALESCE(shares_count, 0) + 1 WHERE id = ?').run(postId);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    const io = req.app.get('io');
    if (io) io.emit('new_post');

    res.json({ success: true, message: 'Post share count incremented' });
  } catch (error) {
    console.error('Share post error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export function startCommunityScheduler(io) {
  // Check every 10 seconds for scheduled posts that are due to be published
  setInterval(() => {
    try {
      const pendingPosts = db.prepare(`
        SELECT id, user_id, content, image_url as media_url, shared_project_id as project_id, audience
        FROM community_posts
        WHERE scheduled_at IS NOT NULL
          AND datetime(scheduled_at) <= datetime('now')
          AND scheduled_notified = 0
      `).all();

      if (pendingPosts.length > 0) {
        console.log(`[Scheduler] Publishing ${pendingPosts.length} scheduled posts...`);
        const updateNotified = db.prepare(`
          UPDATE community_posts
          SET scheduled_notified = 1
          WHERE id = ?
        `);

        for (const post of pendingPosts) {
          sendCommunityPostNotification(post.id, post.user_id, post.content, post.media_url, post.project_id, post.audience, false, io);
          updateNotified.run(post.id);
        }

        if (io) {
          io.emit('new_post');
        }
      }
    } catch (error) {
      console.error('[Scheduler] Error processing scheduled posts:', error);
    }
  }, 10000);
}

export default router;
