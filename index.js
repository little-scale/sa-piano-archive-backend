// index.js
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');

const upload = multer({ dest: 'uploads/' });

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json()); // Ensure this is included to parse JSON POST bodies

const cleanDate = (dirtyDate) => {
  if (!dirtyDate) return null;
  // If the string has two '-' in the first 10 characters and another '-', replace the last '-' with ' '
  return dirtyDate.replace(/^(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2})$/, '$1 $2') + ':00';
};

console.log("Database URL logging:", process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: 'db.wgjwdtqyogkstejatymk.supabase.co', // <- required!
  port: 5432,
  ssl: { rejectUnauthorized: false },
  family: 4 // <- forces IPv4!
});

app.post('/upload-csv', upload.single('file'), async (req, res) => {
  const results = [];
  const concertCache = new Map();
  const performerCache = new Map();
  const workCache = new Map();

  const parsePerformer = (performerNationality) => {
    const [performer, nationality = ''] = performerNationality.split('/').map(s => s.trim());
    return { performer, nationality };
  };

  const readStream = fs.createReadStream(req.file.path).pipe(csv());

  

  for await (const row of readStream) {
    results.push(row);
  }

  try {
    for (const row of results) {
      // Insert or lookup concert
      const concertKey = `${row['Year/Date/Time']}-${row['Venue']}-${row['Organiser/Sponsor']}`;
      let concertId = concertCache.get(concertKey);

      if (!concertId) {
        console.log("Original datetime:", row['Year/Date/Time']);
        const datetime = cleanDate(row['Year/Date/Time']);
        console.log("Clean datetime:", datetime);
        
        const concertResult = await pool.query(
          `INSERT INTO concerts (datetime, concert_title, venue, organiser, note)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING
           RETURNING id`,
  [
    datetime,
    row['Concert Title'],
    row['Venue'],
    row['Organiser/Sponsor'],
    row['Note']
  ]
);

        concertId = concertResult.rows[0]?.id;

        if (!concertId) {
          // Lookup existing if conflict prevented insert
          const lookup = await pool.query(
            `SELECT id FROM concerts WHERE datetime = $1 AND venue = $2 AND organiser = $3`,
            [
              row['Year/Date/Time'],
              row['Venue'],
              row['Organiser/Sponsor']
            ]
          );
          concertId = lookup.rows[0].id;
        }

        concertCache.set(concertKey, concertId);
      }

      // Insert or lookup performer
      const { performer, nationality } = parsePerformer(row['Performer/ Nationality']);
      let performerId = performerCache.get(performer);

      if (!performerId) {
        const performerResult = await pool.query(
          `INSERT INTO performers (performer, nationality)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [performer, nationality]
        );
        performerId = performerResult.rows[0]?.id;

        if (!performerId) {
          const lookup = await pool.query(
            `SELECT id FROM performers WHERE performer = $1`,
            [performer]
          );
          performerId = lookup.rows[0].id;
        }

        performerCache.set(performer, performerId);
      }

      // Insert or lookup work
      const workKey = `${row['Music Title']}-${row['Composer']}`;
      let workId = workCache.get(workKey);

      if (!workId) {
        const workResult = await pool.query(
          `INSERT INTO works (work_title, composer)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [row['Music Title'], row['Composer']]
        );
        workId = workResult.rows[0]?.id;

        if (!workId) {
          const lookup = await pool.query(
            `SELECT id FROM works WHERE work_title = $1 AND composer = $2`,
            [row['Music Title'], row['Composer']]
          );
          workId = lookup.rows[0].id;
        }

        workCache.set(workKey, workId);
      }

      // Insert program item
      const itemOrder = parseInt(row['Program Order number'].replace('Item ', '').trim(), 10);
      const intervalAfter = row['Interval Y/N'] === 'Y' ? true : null;

      await pool.query(
        `INSERT INTO program_items (concert_id, performer_id, work_id, item_order, interval_after)
         VALUES ($1, $2, $3, $4, $5)`,
        [concertId, performerId, workId, itemOrder, intervalAfter]
      );
    }

    res.status(200).json({ message: 'CSV processed and data inserted.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to process CSV' });
  } finally {
    fs.unlinkSync(req.file.path);
  }
});




// GET /concerts
app.get("/concerts", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM concerts ORDER BY datetime");
  res.json(rows);
});

// GET /concert/:id
app.get("/concert/:id", async (req, res) => {
  const id = req.params.id;

  const concertQuery = "SELECT * FROM concerts WHERE id = $1";
  const itemsQuery = `
    SELECT pi.item_order, pi.interval_after,
         w.work_title, w.composer,
         p.performer
    FROM program_items pi
    JOIN works w ON pi.work_id = w.id
    JOIN performers p ON pi.performer_id = p.id
    WHERE pi.concert_id = $1
    ORDER BY pi.item_order
  `;

  const [concert, items] = await Promise.all([
    pool.query(concertQuery, [id]),
    pool.query(itemsQuery, [id]),
  ]);

  res.json({ ...concert.rows[0], program: items.rows });
});

// GET /performers
app.get("/performers", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM performers ORDER BY performer");
  res.json(rows);
});

// GET /works
app.get("/works", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM works ORDER BY composer, work_title");
  res.json(rows);
});

// GET /search?q=...
app.get("/search", async (req, res) => {
  const q = `%${req.query.q?.toLowerCase() || ""}%`;

  const concerts = await pool.query(
    "SELECT * FROM concerts WHERE LOWER(venue) LIKE $1 OR LOWER(note) LIKE $1",
    [q]
  );

  const performers = await pool.query(
    "SELECT * FROM performers WHERE LOWER(performer) LIKE $1 OR LOWER(nationality) LIKE $1",
    [q]
  );

  const works = await pool.query(
    "SELECT * FROM works WHERE LOWER(composer) LIKE $1 OR LOWER(work_title) LIKE $1",
    [q]
  );

  res.json({
    concerts: concerts.rows,
    performers: performers.rows,
    works: works.rows,
  });
});







app.listen(port, () => {
  console.log(`Backend server running on port ${port}`);
});


