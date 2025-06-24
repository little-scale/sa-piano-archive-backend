// index.js
import express from "express";
import cors from "cors";
import pkg from "pg";

const { Pool } = pkg;
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // from Render environment variable
  ssl: { rejectUnauthorized: false },
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
           w.work_title, w.composer, w.instrumentation,
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
  const { rows } = await pool.query("SELECT * FROM works ORDER BY composer, title");
  res.json(rows);
});

// GET /search?q=...
app.get("/search", async (req, res) => {
  const q = `%${req.query.q?.toLowerCase() || ""}%`;
  const concerts = await pool.query(
    "SELECT * FROM concerts WHERE LOWER(venue) LIKE $1 OR LOWER(series) LIKE $1 OR LOWER(note) LIKE $1",
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

  res.json({ concerts: concerts.rows, performers: performers.rows, works: works.rows });
});

app.listen(port, () => {
  console.log(`Backend server running on port ${port}`);
});
