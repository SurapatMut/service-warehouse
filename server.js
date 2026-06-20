const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { initDb } = require('./db/schema');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.use('/api/items', require('./routes/items'));
app.use('/api/logs',  require('./routes/logs'));

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'OK', time: new Date().toISOString() });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀  Service Warehouse running at http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
