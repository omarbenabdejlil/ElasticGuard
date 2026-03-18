require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/cluster',      require('./routes/cluster'));
app.use('/api/indices',      require('./routes/indices'));
app.use('/api/ilm',          require('./routes/ilm'));
app.use('/api/snapshots',    require('./routes/snapshots'));
app.use('/api/diagnostics',  require('./routes/diagnostics'));
app.use('/api/codec',        require('./routes/codec'));
app.use('/api/ilm-health',   require('./routes/ilm-health'));
app.use('/api/simulator',    require('./routes/simulator'));
app.use('/api/cost',         require('./routes/cost'));
app.use('/api/policy-audit', require('./routes/policy-audit'));
app.use('/', require('./routes/ilm-control'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🛡️  ElasticGuard running at http://localhost:${PORT}\n`);
});
