module.exports = {
  apps: [
    {
      name: 'tts-server',
      script: 'server.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      env: { NODE_ENV: 'production', ACTIVE_GAME: 'tts' }
    },
    {
      name: 'tts-bot',
      script: 'telegram-bot.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      env: { NODE_ENV: 'production', ACTIVE_GAME: 'tts' }
    },
    {
      name: 'tts-player-bot',
      script: 'telegram-player-bot.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      env: { NODE_ENV: 'production', ACTIVE_GAME: 'tts' }
    },
    {
      name: 'tts-worker-family100',
      script: 'games/family100/ai-worker.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'tts-worker-susun-kata-acak',
      script: 'games/susun-kata-acak/ai-worker.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'tts-worker-cari-kata',
      script: 'games/cari-kata/ai-worker.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'tts-worker-tts',
      script: 'games/tts/ai-worker.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'tts-worker-trivia',
      script: 'games/trivia/ai-worker.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'tts-worker-sambung-kata',
      script: 'games/sambung-kata/ai-worker.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'tts-worker-susun-kalimat',
      script: 'games/susun-kalimat/ai-worker.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'tts-tiktok',
      script: 'tiktok-connector.js',
      cwd: __dirname,
      autorestart: true,
      // Jangan auto-start pas `pm2 start ecosystem.config.js` atau reboot server.
      // Proses ini cuma boleh nyala lewat command /startlive dari Telegram,
      // karena butuh username yang di-set dulu.
      max_restarts: 5,
      env: { NODE_ENV: 'production', ACTIVE_GAME: 'tts' }
    }
  ]
};
