const express = require('express');
const { Pool } = require('pg');

const PORT = process.env.PORT || 8085;
const HOST = process.env.HOST || '0.0.0.0';

// Параметры подключения pg берёт сам из стандартных переменных окружения PostgreSQL:
// PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE.
const pool = new Pool({ connectionTimeoutMillis: 3000 });
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err.message);
});

const app = express();
app.use(express.json());

const wrap = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const parseId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const parseDate = (value) => {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date : null;
};

const hasOverlap = async (room, startAt, endAt, excludeId = 0) => {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM bookings WHERE room = $1 AND id <> $4 AND start_at < $3 AND end_at > $2 LIMIT 1',
    [room, startAt, endAt, excludeId]
  );
  return rowCount > 0;
};

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get(
  '/health/db',
  wrap(async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', database: 'reachable' });
    } catch (err) {
      res.status(503).json({ error: 'Database is unavailable' });
    }
  })
);

app.post(
  '/bookings',
  wrap(async (req, res) => {
    const { room, booked_by: bookedBy } = req.body;
    const startAt = parseDate(req.body.start_at);
    const endAt = parseDate(req.body.end_at);

    if (!room || !bookedBy || !startAt || !endAt) {
      return res.status(400).json({ error: 'room, booked_by, start_at, end_at are required' });
    }
    if (endAt <= startAt) {
      return res.status(400).json({ error: 'end_at must be later than start_at' });
    }
    if (await hasOverlap(room, startAt, endAt)) {
      return res.status(409).json({ error: 'Room is already booked for this time' });
    }

    const { rows } = await pool.query(
      'INSERT INTO bookings (room, booked_by, start_at, end_at) VALUES ($1, $2, $3, $4) RETURNING *',
      [room, bookedBy, startAt, endAt]
    );
    res.status(201).json(rows[0]);
  })
);

app.get(
  '/bookings',
  wrap(async (req, res) => {
    const params = [];
    let sql = 'SELECT * FROM bookings';
    if (req.query.room) {
      params.push(req.query.room);
      sql += ' WHERE room = $1';
    }
    sql += ' ORDER BY start_at, id';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  })
);

app.get(
  '/bookings/:id',
  wrap(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'Invalid id format' });
    }
    const { rows } = await pool.query('SELECT * FROM bookings WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    res.json(rows[0]);
  })
);

app.patch(
  '/bookings/:id',
  wrap(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'Invalid id format' });
    }
    const current = await pool.query('SELECT * FROM bookings WHERE id = $1', [id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const existing = current.rows[0];
    const room = req.body.room || existing.room;
    const bookedBy = req.body.booked_by || existing.booked_by;
    const startAt = req.body.start_at ? parseDate(req.body.start_at) : existing.start_at;
    const endAt = req.body.end_at ? parseDate(req.body.end_at) : existing.end_at;

    if (!startAt || !endAt) {
      return res.status(400).json({ error: 'Invalid date format' });
    }
    if (endAt <= startAt) {
      return res.status(400).json({ error: 'end_at must be later than start_at' });
    }
    if (await hasOverlap(room, startAt, endAt, id)) {
      return res.status(409).json({ error: 'Room is already booked for this time' });
    }

    const { rows } = await pool.query(
      'UPDATE bookings SET room = $1, booked_by = $2, start_at = $3, end_at = $4 WHERE id = $5 RETURNING *',
      [room, bookedBy, startAt, endAt, id]
    );
    res.json(rows[0]);
  })
);

app.delete(
  '/bookings/:id',
  wrap(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'Invalid id format' });
    }
    const { rowCount } = await pool.query('DELETE FROM bookings WHERE id = $1', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    res.status(204).send();
  })
);

// Приложение не стартует, пока база не отвечает: пусть оркестратор (restart policy) перезапускает.
pool
  .query('SELECT 1')
  .then(() => {
    app.listen(PORT, HOST, () => {
      console.log(`meeting-rooms-api listening on http://${HOST}:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Cannot connect to PostgreSQL:', err.message);
    process.exit(1);
  });
