module.exports = {
  apps: [
    {
      name: 'schedule-bot',
      script: './telegram-sakhgu-schedule-auto-weeks.mjs',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 3000,
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
