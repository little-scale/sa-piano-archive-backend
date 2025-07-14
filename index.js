// index.js
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json()); // Ensure this is included to parse JSON POST bodies

console.log("Database URL:", process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: 'db.wgjwdtqyogkstejatymk.supabase.co', // <- required!
  port: 5432,
  ssl: { rejectUnauthorized: false },
  family: 4 // <- forces IPv4!
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



// POST /concerts
app.post("/concerts", async (req, res) => {
  const { datetime, venue, series, note } = req.body;

  try {
    const result = await pool.query(
      "INSERT INTO concerts (datetime, venue, series, note) VALUES ($1, $2, $3, $4) RETURNING *",
      [datetime, venue, series, note]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to add concert" });
  }
});

app.listen(port, () => {
  console.log(`Backend server running on port ${port}`);
});


