use crate::db;
use crate::models::*;
use rusqlite::params;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
pub fn get_next_workout_type() -> Result<String, String> {
    let conn = db::open().map_err(err)?;
    let last: Option<String> = conn
        .query_row(
            "SELECT workout_type FROM workouts WHERE completed = 1 ORDER BY id DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .ok();
    Ok(match last.as_deref() {
        Some("A") => "B".into(),
        Some("B") => "A".into(),
        _ => "A".into(),
    })
}

#[tauri::command]
pub fn start_workout(workout_type: String) -> Result<ActiveWorkout, String> {
    let conn = db::open().map_err(err)?;

    let has_active: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM workouts WHERE completed = 0",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    if has_active {
        return get_active_workout();
    }

    let now = chrono::Local::now().to_rfc3339();
    conn.execute(
        "INSERT INTO workouts (workout_type, started_at, completed) VALUES (?1, ?2, 0)",
        params![workout_type, now],
    )
    .map_err(err)?;
    let workout_id = conn.last_insert_rowid();

    let config = load_program_config(&conn).map_err(err)?;

    let mut stmt = conn
        .prepare(
            "SELECT e.id, e.name, e.target_sets, e.target_reps, e.sort_order, es.current_weight
             FROM exercises e
             JOIN exercise_state es ON es.exercise_id = e.id
             WHERE e.workout_type = ?1 OR e.workout_type = 'BOTH'
             ORDER BY e.sort_order",
        )
        .map_err(err)?;

    let exercises: Vec<(i64, String, Option<i64>, Option<i64>, i64, f64)> = stmt
        .query_map([&workout_type], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    for (ex_id, _name, tsets, treps, _order, weight) in &exercises {
        let sets = tsets.unwrap_or(config.default_sets);
        let reps = treps.unwrap_or(config.default_reps);
        for s in 1..=sets {
            conn.execute(
                "INSERT INTO workout_sets (workout_id, exercise_id, set_number, reps_completed, weight, completed)
                 VALUES (?1, ?2, ?3, 0, ?4, 0)",
                params![workout_id, ex_id, s, weight],
            )
            .map_err(err)?;
        }
        let _ = reps; // reps stored in exercise definition, used at completion check
    }

    get_active_workout()
}

#[tauri::command]
pub fn get_active_workout() -> Result<ActiveWorkout, String> {
    let conn = db::open().map_err(err)?;
    let config = load_program_config(&conn).map_err(err)?;

    let workout = conn
        .query_row(
            "SELECT id, workout_type, started_at, completed_at, completed
             FROM workouts WHERE completed = 0 ORDER BY id DESC LIMIT 1",
            [],
            |r| {
                Ok(Workout {
                    id: r.get(0)?,
                    workout_type: r.get(1)?,
                    started_at: r.get(2)?,
                    completed_at: r.get(3)?,
                    completed: r.get::<_, i64>(4)? != 0,
                })
            },
        )
        .map_err(|_| "No active workout".to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT ws.id, ws.workout_id, ws.exercise_id, e.name, ws.set_number,
                    ws.reps_completed, COALESCE(e.target_reps, ?1), ws.weight, ws.completed
             FROM workout_sets ws
             JOIN exercises e ON e.id = ws.exercise_id
             WHERE ws.workout_id = ?2
             ORDER BY e.sort_order, ws.set_number",
        )
        .map_err(err)?;

    let sets: Vec<WorkoutSet> = stmt
        .query_map(params![config.default_reps, workout.id], |r| {
            Ok(WorkoutSet {
                id: r.get(0)?,
                workout_id: r.get(1)?,
                exercise_id: r.get(2)?,
                exercise_name: r.get(3)?,
                set_number: r.get(4)?,
                reps_completed: r.get(5)?,
                target_reps: r.get(6)?,
                weight: r.get(7)?,
                completed: r.get::<_, i64>(8)? != 0,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    let mut exercises: Vec<WorkoutExercise> = Vec::new();
    for s in sets {
        if exercises.last().map_or(true, |e| e.exercise_id != s.exercise_id) {
            exercises.push(WorkoutExercise {
                exercise_id: s.exercise_id,
                exercise_name: s.exercise_name.clone(),
                weight: s.weight,
                sets: Vec::new(),
            });
        }
        exercises.last_mut().unwrap().sets.push(s);
    }

    Ok(ActiveWorkout { workout, exercises })
}

#[tauri::command]
pub fn complete_set(set_id: i64, reps: i64) -> Result<SetCompletion, String> {
    let conn = db::open().map_err(err)?;

    conn.execute(
        "UPDATE workout_sets SET reps_completed = ?1, completed = 1 WHERE id = ?2",
        params![reps, set_id],
    )
    .map_err(err)?;

    let workout_id: i64 = conn
        .query_row(
            "SELECT workout_id FROM workout_sets WHERE id = ?1",
            [set_id],
            |r| r.get(0),
        )
        .map_err(err)?;

    let remaining: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM workout_sets WHERE workout_id = ?1 AND completed = 0",
            [workout_id],
            |r| r.get(0),
        )
        .map_err(err)?;

    Ok(SetCompletion {
        is_last_set_of_last_exercise: remaining == 0,
    })
}

#[tauri::command]
pub fn complete_workout(workout_id: i64) -> Result<(), String> {
    let conn = db::open().map_err(err)?;
    let config = load_program_config(&conn).map_err(err)?;
    let now = chrono::Local::now().to_rfc3339();

    conn.execute(
        "UPDATE workouts SET completed = 1, completed_at = ?1 WHERE id = ?2",
        params![now, workout_id],
    )
    .map_err(err)?;

    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT ws.exercise_id, e.weight_increment, COALESCE(e.target_reps, ?1)
             FROM workout_sets ws
             JOIN exercises e ON e.id = ws.exercise_id
             WHERE ws.workout_id = ?2",
        )
        .map_err(err)?;

    let exercise_info: Vec<(i64, f64, i64)> = stmt
        .query_map(params![config.default_reps, workout_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    for (ex_id, increment, target_reps) in &exercise_info {
        let all_hit: bool = conn
            .query_row(
                "SELECT COUNT(*) = 0 FROM workout_sets
                 WHERE workout_id = ?1 AND exercise_id = ?2 AND reps_completed < ?3",
                params![workout_id, ex_id, target_reps],
                |r| r.get(0),
            )
            .map_err(err)?;

        if all_hit {
            conn.execute(
                "UPDATE exercise_state SET current_weight = current_weight + ?1 WHERE exercise_id = ?2",
                params![increment, ex_id],
            )
            .map_err(err)?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn override_weight(exercise_id: i64, new_weight: f64) -> Result<(), String> {
    let conn = db::open().map_err(err)?;
    conn.execute(
        "UPDATE exercise_state SET current_weight = ?1 WHERE exercise_id = ?2",
        params![new_weight, exercise_id],
    )
    .map_err(err)?;

    // Also update any pending (not completed) sets for this exercise in an active workout
    conn.execute(
        "UPDATE workout_sets SET weight = ?1
         WHERE exercise_id = ?2 AND completed = 0
         AND workout_id IN (SELECT id FROM workouts WHERE completed = 0)",
        params![new_weight, exercise_id],
    )
    .map_err(err)?;

    Ok(())
}

#[tauri::command]
pub fn get_workout_history() -> Result<Vec<WorkoutSummary>, String> {
    let conn = db::open().map_err(err)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, workout_type, started_at, completed_at
             FROM workouts WHERE completed = 1 ORDER BY id DESC LIMIT 20",
        )
        .map_err(err)?;

    let workouts: Vec<(i64, String, String, Option<String>)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    let mut results = Vec::new();
    for (wid, wtype, started, completed) in workouts {
        let mut ex_stmt = conn
            .prepare(
                "SELECT e.name, ws.weight,
                        SUM(CASE WHEN ws.completed = 1 THEN 1 ELSE 0 END),
                        COUNT(*)
                 FROM workout_sets ws
                 JOIN exercises e ON e.id = ws.exercise_id
                 WHERE ws.workout_id = ?1
                 GROUP BY ws.exercise_id
                 ORDER BY e.sort_order",
            )
            .map_err(err)?;

        let exercises: Vec<ExerciseSummary> = ex_stmt
            .query_map([wid], |r| {
                Ok(ExerciseSummary {
                    name: r.get(0)?,
                    weight: r.get(1)?,
                    sets_completed: r.get(2)?,
                    total_sets: r.get(3)?,
                })
            })
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;

        results.push(WorkoutSummary {
            id: wid,
            workout_type: wtype,
            started_at: started,
            completed_at: completed,
            exercises,
        });
    }

    Ok(results)
}

#[tauri::command]
pub fn get_exercise_progression(exercise_id: i64) -> Result<Vec<ExerciseProgression>, String> {
    let conn = db::open().map_err(err)?;
    let mut stmt = conn
        .prepare(
            "SELECT w.started_at, ws.weight
             FROM workout_sets ws
             JOIN workouts w ON w.id = ws.workout_id
             WHERE ws.exercise_id = ?1 AND w.completed = 1
             GROUP BY ws.workout_id
             ORDER BY w.id",
        )
        .map_err(err)?;

    let rows: Vec<ExerciseProgression> = stmt
        .query_map([exercise_id], |r| {
            Ok(ExerciseProgression {
                date: r.get(0)?,
                weight: r.get(1)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    Ok(rows)
}

#[tauri::command]
pub fn get_program_config() -> Result<ProgramConfig, String> {
    let conn = db::open().map_err(err)?;
    load_program_config(&conn).map_err(err)
}

fn load_program_config(conn: &rusqlite::Connection) -> rusqlite::Result<ProgramConfig> {
    conn.query_row(
        "SELECT default_sets, default_reps FROM program_config WHERE id = 1",
        [],
        |r| {
            Ok(ProgramConfig {
                default_sets: r.get(0)?,
                default_reps: r.get(1)?,
            })
        },
    )
}

#[tauri::command]
pub fn update_program_config(default_sets: i64, default_reps: i64) -> Result<(), String> {
    let conn = db::open().map_err(err)?;
    conn.execute(
        "UPDATE program_config SET default_sets = ?1, default_reps = ?2 WHERE id = 1",
        params![default_sets, default_reps],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn get_exercises() -> Result<Vec<Exercise>, String> {
    let conn = db::open().map_err(err)?;
    let mut stmt = conn
        .prepare(
            "SELECT e.id, e.name, e.workout_type, e.target_sets, e.target_reps,
                    e.weight_increment, e.sort_order, es.current_weight
             FROM exercises e
             JOIN exercise_state es ON es.exercise_id = e.id
             ORDER BY e.sort_order",
        )
        .map_err(err)?;

    let rows: Vec<Exercise> = stmt
        .query_map([], |r| {
            Ok(Exercise {
                id: r.get(0)?,
                name: r.get(1)?,
                workout_type: r.get(2)?,
                target_sets: r.get(3)?,
                target_reps: r.get(4)?,
                weight_increment: r.get(5)?,
                sort_order: r.get(6)?,
                current_weight: r.get(7)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;

    Ok(rows)
}

#[tauri::command]
pub fn update_exercise(
    exercise_id: i64,
    target_sets: Option<i64>,
    target_reps: Option<i64>,
    weight_increment: f64,
) -> Result<(), String> {
    let conn = db::open().map_err(err)?;
    conn.execute(
        "UPDATE exercises SET target_sets = ?1, target_reps = ?2, weight_increment = ?3 WHERE id = ?4",
        params![target_sets, target_reps, weight_increment, exercise_id],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn cancel_workout(workout_id: i64) -> Result<(), String> {
    let conn = db::open().map_err(err)?;
    conn.execute("DELETE FROM workout_sets WHERE workout_id = ?1", [workout_id])
        .map_err(err)?;
    conn.execute("DELETE FROM workouts WHERE id = ?1", [workout_id])
        .map_err(err)?;
    Ok(())
}
