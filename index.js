// index.js

const express = require('express');
const app = express();

/* Auth vers
// ✅ Basic Auth middleware AFTER app is defined
app.use((req, res, next) => {
  const auth = { login: 'admin', password: 'pianoarchive' };
  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

  if (login === auth.login && password === auth.password) {
    return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="Archive Backend"');
  res.status(401).send('Authentication required.');
});
*/

const cors = require("cors");
const { Pool } = require("pg");

const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');

const upload = multer({ dest: 'uploads/' });
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

  const stats = {
    concerts_added: 0,
    concerts_skipped: 0,
    performers_added: 0,
    performers_skipped: 0,
    works_added: 0,
    works_skipped: 0,
    program_items_added: 0,
  };

  const parsePerformer = (performerNationality) => {
    const [performer, nationality = ''] = (performerNationality || '').split('/').map(s => s.trim());
    return { performer, nationality };
  };

  const readStream = fs.createReadStream(req.file.path).pipe(csv());

  for await (const row of readStream) {
    // Strip BOM from header keys
    Object.keys(row).forEach(key => {
      const cleanKey = key.replace(/^\uFEFF/, '');
      if (cleanKey !== key) {
        row[cleanKey] = row[key];
        delete row[key];
      }
    });
    results.push(row);
  }

  try {
    for (const row of results) {
      const rawDatetime = row['Year/Date/Time'];
      console.log(`RAW DATETIME: ${rawDatetime} | TYPE: ${typeof rawDatetime}`);

      if (!rawDatetime) {
        console.warn('Skipping row due to missing datetime:', row);
        continue; // skip this row safely
      }

      const datetime = cleanDate(rawDatetime);
      console.log(`CLEAN DATETIME: ${datetime}`);

      const concertKey = `${datetime}-${row['Venue']}-${row['Organiser/Sponsor']}`;
      let concertId = concertCache.get(concertKey);

      if (!concertId) {
        const concertResult = await pool.query(
          `INSERT INTO concerts (datetime, concert_title, venue, organiser, note, source)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [
            datetime,
            row['Concert Title'],
            row['Venue'],
            row['Organiser/Sponsor'],
            row['Note'],
            row['Source']
          ]
        );
        concertId = concertResult.rows[0]?.id;

        if (!concertId) {
          stats.concerts_skipped++;
          const lookup = await pool.query(
            `SELECT id FROM concerts WHERE datetime = $1 AND venue = $2 AND organiser = $3`,
            [datetime, row['Venue'], row['Organiser/Sponsor']]
          );
          concertId = lookup.rows[0].id;
        } else {
          stats.concerts_added++;
        }

        concertCache.set(concertKey, concertId);
      }

      const { performer, nationality } = parsePerformer(row['Performer/ Nationality']);
      let performerId = performerCache.get(performer);

      if (!performerId && performer) {
        const performerResult = await pool.query(
          `INSERT INTO performers (performer, nationality)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [performer, nationality]
        );
        performerId = performerResult.rows[0]?.id;

        if (!performerId) {
          stats.performers_skipped++;
          const lookup = await pool.query(
            `SELECT id FROM performers WHERE performer = $1`,
            [performer]
          );
          performerId = lookup.rows[0].id;
        } else {
          stats.performers_added++;
        }

        performerCache.set(performer, performerId);
      }

      const workKey = `${row['Music Title']}-${row['Composer']}`;
      let workId = workCache.get(workKey);

      if (!workId && row['Music Title']) {
        const workResult = await pool.query(
          `INSERT INTO works (work_title, composer)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [row['Music Title'], row['Composer']]
        );
        workId = workResult.rows[0]?.id;

        if (!workId) {
          stats.works_skipped++;
          const lookup = await pool.query(
            `SELECT id FROM works WHERE work_title = $1 AND composer = $2`,
            [row['Music Title'], row['Composer']]
          );
          workId = lookup.rows[0].id;
        } else {
          stats.works_added++;
        }

        workCache.set(workKey, workId);
      }

      const itemOrder = parseInt((row['Program Order number'] || '').replace('Item ', '').trim(), 10) || null;
      const intervalAfter = row['Interval  Y/N'] === 'Y' ? true : null;

      if (concertId && performerId && workId) {
        await pool.query(
          `INSERT INTO program_items (concert_id, performer_id, work_id, item_order, interval_after)
           VALUES ($1, $2, $3, $4, $5)`,
          [concertId, performerId, workId, itemOrder, intervalAfter]
        );
        stats.program_items_added++;
      }
    }

    res.status(200).json(stats);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to process CSV' });
  } finally {
    fs.unlinkSync(req.file.path);
  }
});






// GET /concerts
app.get("/concerts", async (req, res) => {
  const params = [];

  if (req.query.performer) {
    const query = `
      SELECT DISTINCT c.*
      FROM concerts c
      JOIN program_items pi ON pi.concert_id = c.id
      JOIN performers p ON pi.performer_id = p.id
      WHERE p.performer ILIKE $1
      ORDER BY c.datetime
    `;
    params.push(`%${req.query.performer}%`);
    const { rows } = await pool.query(query, params);
    return res.json(rows);
  }

  if (req.query.composer) {
    const query = `
      SELECT DISTINCT c.*
      FROM concerts c
      JOIN program_items pi ON pi.concert_id = c.id
      JOIN works w ON pi.work_id = w.id
      WHERE w.composer ILIKE $1
      ORDER BY c.datetime
    `;
    params.push(`%${req.query.composer}%`);
    const { rows } = await pool.query(query, params);
    return res.json(rows);
  }

  // DEFAULT: return full concert info WITH performers and composers aggregated
  const { rows } = await pool.query(`
    SELECT 
      c.id,
      c.datetime,
      c.venue,
      c.organiser,
      STRING_AGG(DISTINCT p.performer, ', ') AS performers,
      STRING_AGG(DISTINCT w.composer, ', ') AS composers
    FROM concerts c
    LEFT JOIN program_items pi ON pi.concert_id = c.id
    LEFT JOIN performers p ON pi.performer_id = p.id
    LEFT JOIN works w ON pi.work_id = w.id
    GROUP BY c.id
    ORDER BY c.datetime;
  `);
  res.json(rows);
});



// GET /concert/:id
app.get("/concert/:id", async (req, res) => {
  const id = req.params.id;

  const concertQuery = "SELECT * FROM concerts WHERE id = $1";
  const itemsQuery = `
    SELECT pi.item_order, pi.interval_after,
         w.id AS work_id, w.work_title, w.composer,
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

// GET /composers/:name/concerts
app.get("/composers/:name/concerts", async (req, res) => {
    const composer = req.params.name;
    const { rows } = await pool.query(
        `SELECT DISTINCT concerts.* FROM concerts
         JOIN program_items ON program_items.concert_id = concerts.id
         JOIN works ON program_items.work_id = works.id
         WHERE works.composer = $1
         ORDER BY concerts.datetime`,
        [composer]
    );
    res.json(rows);
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

app.get("/works/:id/concerts", async (req, res) => {
    const id = req.params.id;
    try {
        const { rows } = await pool.query(
            `SELECT concerts.* FROM concerts
             JOIN program_items ON program_items.concert_id = concerts.id
             WHERE program_items.work_id = $1`,
            [id]
        );
        res.json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch concerts for work' });
    }
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


