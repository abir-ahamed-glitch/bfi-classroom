module.exports = {
  apps: [
    {
      name: 'bfi-classroom-backend',
      script: 'server/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
    {
      name: 'bfi-classroom-frontend',
      script: 'node_modules/vite/bin/vite.js',
      args: '',
      env: {
        NODE_ENV: 'development',
      },
    },
  ],
};
