require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const oauthRoutes = require('./routes/oauth');
const apiRoutes = require('./routes/api');
const { runStopCranForAllProjects } = require('./guardrails/stopCranRunner');
const { requireAuth } = require('./middleware/auth');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(requireAuth); // до всех роутов и статики: дашборд, /api и /oauth закрыты авторизацией

app.use('/oauth', oauthRoutes);
app.use('/api', apiRoutes);
app.use(express.static(path.join(__dirname, 'dashboard', 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SHADS dashboard: http://localhost:${PORT}`);
});

// Стоп-кран проверяется независимо от MCP-агента — раз в 5 минут для всех активных проектов.
const STOP_CRAN_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  runStopCranForAllProjects().catch((err) => console.error('[STOP-CRAN] Фоновая проверка упала:', err));
}, STOP_CRAN_INTERVAL_MS);
