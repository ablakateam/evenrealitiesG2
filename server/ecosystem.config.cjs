/**
 * pm2 ecosystem config for VOX server.
 * Run: pm2 reload ecosystem.config.cjs --env production
 *
 * The server reads /opt/vox/.env at boot via dotenv.
 * Logs land in ~/.pm2/logs/vox-server-{out,error}.log.
 */
module.exports = {
  apps: [
    {
      name: 'vox-server',
      script: 'dist/index.js',
      cwd: '/opt/vox',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      time: true,
      env: {
        NODE_ENV: 'production',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      kill_timeout: 8000,
      listen_timeout: 8000,
      wait_ready: false,
    },
  ],
};
