use rusqlite::{Connection, Result};
use std::path::PathBuf;

pub fn db_path() -> PathBuf {
    let mut path = dirs_data_path();
    std::fs::create_dir_all(&path).ok();
    path.push("stronglifts.db");
    path
}

fn dirs_data_path() -> PathBuf {
    if let Some(home) = std::env::var_os("HOME") {
        let mut p = PathBuf::from(home);
        p.push("Library");
        p.push("Application Support");
        p.push("com.stronglifts.app");
        return p;
    }
    PathBuf::from(".")
}

pub fn open() -> Result<Connection> {
    let conn = Connection::open(db_path())?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    Ok(conn)
}

pub fn initialize(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS program_config (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            default_sets INTEGER NOT NULL DEFAULT 5,
            default_reps INTEGER NOT NULL DEFAULT 5
        );

        CREATE TABLE IF NOT EXISTS exercises (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            workout_type TEXT NOT NULL,
            target_sets INTEGER,
            target_reps INTEGER,
            weight_increment REAL NOT NULL DEFAULT 2.5,
            sort_order INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS exercise_state (
            exercise_id INTEGER PRIMARY KEY REFERENCES exercises(id),
            current_weight REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workouts (
            id INTEGER PRIMARY KEY,
            workout_type TEXT NOT NULL CHECK(workout_type IN ('A', 'B')),
            started_at TEXT NOT NULL,
            completed_at TEXT,
            completed INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS workout_sets (
            id INTEGER PRIMARY KEY,
            workout_id INTEGER NOT NULL REFERENCES workouts(id),
            exercise_id INTEGER NOT NULL REFERENCES exercises(id),
            set_number INTEGER NOT NULL,
            reps_completed INTEGER NOT NULL DEFAULT 0,
            weight REAL NOT NULL,
            completed INTEGER NOT NULL DEFAULT 0
        );
        ",
    )?;

    seed_if_empty(conn)?;
    Ok(())
}

fn seed_if_empty(conn: &Connection) -> Result<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM exercises", [], |r| r.get(0))?;
    if count > 0 {
        return Ok(());
    }

    conn.execute(
        "INSERT OR IGNORE INTO program_config (id, default_sets, default_reps) VALUES (1, 5, 5)",
        [],
    )?;

    let exercises = [
        (1, "Squat", "BOTH", None::<i64>, None::<i64>, 2.5, 1),
        (2, "Bench Press", "A", None, None, 2.5, 2),
        (3, "Barbell Row", "A", None, None, 2.5, 3),
        (4, "Overhead Press", "B", None, None, 2.5, 2),
        (5, "Deadlift", "B", Some(1), Some(5), 5.0, 3),
    ];

    for (id, name, wtype, tsets, treps, incr, order) in &exercises {
        conn.execute(
            "INSERT INTO exercises (id, name, workout_type, target_sets, target_reps, weight_increment, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![id, name, wtype, tsets, treps, incr, order],
        )?;
        conn.execute(
            "INSERT INTO exercise_state (exercise_id, current_weight) VALUES (?1, 20.0)",
            [id],
        )?;
    }

    Ok(())
}
