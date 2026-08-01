// Config de PM2 para mantener el bot corriendo con auto-restart (Fase 3).
// Uso: npm run build && pm2 start ecosystem.config.cjs
//
// Dos detalles no obvios, documentados acá para no perderlos:
//
// 1. `node_args: "--env-file=.env"` — PM2 invoca `dist/server.js` directo, sin
//    pasar por el script "start" de package.json (que sí carga --env-file). Sin
//    esto, el proceso arranca sin ninguna variable de entorno.
// 2. `cwd: __dirname` — DATABASE_URL es una ruta relativa (file:./data/bot.db).
//    Si PM2 arrancara desde otro directorio de trabajo, crearía una base vacía
//    en otro lado en vez de fallar: sería una falla silenciosa, la peor clase.
module.exports = {
  apps: [
    {
      name: "whatsapp-bot",
      script: "dist/server.js",
      cwd: __dirname,
      node_args: "--env-file=.env",
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 2000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
