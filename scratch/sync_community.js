import db from '../server/db/database.js';

try {
  const standaloneProjects = db.prepare(`
    SELECT id, user_id, created_at 
    FROM projects 
    WHERE show_on_community = 1 
    AND id NOT IN (SELECT shared_project_id FROM community_posts WHERE shared_project_id IS NOT NULL)
  `).all();

  if (standaloneProjects.length > 0) {
    console.log(`Syncing ${standaloneProjects.length} standalone projects...`);
    const insertPost = db.prepare(`
      INSERT INTO community_posts (user_id, shared_project_id, post_type, created_at)
      VALUES (?, ?, 'project_share', ?)
    `);
    
    db.transaction(() => {
      for (const p of standaloneProjects) {
        insertPost.run(p.user_id, p.id, p.created_at || new Date().toISOString());
      }
    })();
    console.log('✅ Sync complete');
  } else {
    console.log('No projects to sync.');
  }
} catch (err) {
  console.error('Sync failed:', err);
}
