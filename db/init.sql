CREATE TABLE IF NOT EXISTS bookings (
    id         SERIAL PRIMARY KEY,
    room       VARCHAR(100) NOT NULL,
    booked_by  VARCHAR(255) NOT NULL,
    start_at   TIMESTAMPTZ  NOT NULL,
    end_at     TIMESTAMPTZ  NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT bookings_time_check CHECK (end_at > start_at)
);

CREATE INDEX IF NOT EXISTS idx_bookings_room_start ON bookings (room, start_at);
