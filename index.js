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

app.get('/performers', async (req, res) => {
  const { data, error } = await supabase
    .from('performers')
    .select('id, name, nationality')
    .order('name', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/works', async (req, res) => {
  const { data, error } = await supabase
    .from('works')
    .select(`
      id,
      title,
      composer_id,
      composers(name)
    `)
    .order('title', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/concerts/:id', async (req, res) => {
  const concertId = req.params.id;

  const { data, error } = await supabase
    .from('program_items')
    .select(`
      item_order,
      performers(name, nationality),
      works(title, composers(name)),
      concerts(id, datetime, title, venues(name), organisers(name))
    `)
    .eq('concert_id', concertId)
    .order('item_order');

  if (error) return res.status(500).json({ error: error.message });

  if (!data.length) return res.status(404).json({ error: 'Concert not found' });

  const concertMeta = data[0].concerts;

  const concert = {
    ...concertMeta,
    program_items: data.map((item) => ({
      item_order: item.item_order,
      performers: item.performers,
      works: item.works,
    })),
  };

  res.json(concert);
});


app.get('/search', async (req, res) => {
  const { performer, year } = req.query;

  // Start building the query
  let query = supabase
    .from('program_items')
    .select(`
      concerts(id, datetime, title, venues(name), organisers(name)),
      performers(name),
      works(title, composers(name))
    `);

  if (performer) {
    query = query.ilike('performers.name', `%${performer}%`);
  }

  const { data, error } = await query;

  if (error) return res.status(500).json({ error: error.message });

  // Filter by year if needed
  const filtered = year
    ? data.filter(item =>
        item.concerts?.datetime?.startsWith(year)
      )
    : data;

  res.json(filtered);
});

app.get('/search', async (req, res) => {
  const { performer, composer, year } = req.query;

  // Build base query
  let query = supabase
    .from('program_items')
    .select(`
      concerts(id, datetime, title, venues(name), organisers(name)),
      performers(name),
      works(title, composers(name))
    `);

  // Apply optional filters
  if (performer) {
    query = query.ilike('performers.name', `%${performer}%`);
  }
  if (composer) {
    query = query.ilike('works.composers.name', `%${composer}%`);
  }

  const { data, error } = await query;

  if (error) return res.status(500).json({ error: error.message });

  // Filter by year if needed
  const filtered = year
    ? data.filter(item =>
        item.concerts?.datetime?.startsWith(year)
      )
    : data;

  res.json(filtered);
});
