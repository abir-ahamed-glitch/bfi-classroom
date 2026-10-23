module.exports = {
  apps: [
    {
      name: 'bfi-classroom',
      script: 'server/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
  ],
};
