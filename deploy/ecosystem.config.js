// Настройки запуска для PM2 (менеджер, который держит сайт включённым и перезапускает после сбоев)
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'obektiv',
      script: 'server.js',
      cwd: path.join(__dirname, '..'),
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // Заказы и фото хранятся ОТДЕЛЬНО от кода — обновления сайта их не трогают
        DATA_DIR: '/var/lib/obektiv',
      },
      max_memory_restart: '500M',
      time: true,
    },
  ],
};
