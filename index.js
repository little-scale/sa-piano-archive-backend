const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

app.get('/concerts', async (req, res) => {
  const { data, error } = await supabase
    .from('concerts')
    .select(`
      id,
      datetime,
      title,
      venues(name),
      organisers(name)
    `)
    .order('datetime', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`);
});
