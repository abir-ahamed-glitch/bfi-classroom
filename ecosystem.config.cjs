module.exports = {
  apps: [
    {
      name: 'bfi-classroom',
      script: 'server/server.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '4G',
      restart_delay: 2000,
      min_uptime: '10s',
      max_restarts: 50,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
  ],
};
