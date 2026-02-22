use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ProgramConfig {
    pub default_sets: i64,
    pub default_reps: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Exercise {
    pub id: i64,
    pub name: String,
    pub workout_type: String,
    pub target_sets: Option<i64>,
    pub target_reps: Option<i64>,
    pub weight_increment: f64,
    pub sort_order: i64,
    pub current_weight: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Workout {
    pub id: i64,
    pub workout_type: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub completed: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkoutSet {
    pub id: i64,
    pub workout_id: i64,
    pub exercise_id: i64,
    pub exercise_name: String,
    pub set_number: i64,
    pub reps_completed: i64,
    pub target_reps: i64,
    pub weight: f64,
    pub completed: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ActiveWorkout {
    pub workout: Workout,
    pub exercises: Vec<WorkoutExercise>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkoutExercise {
    pub exercise_id: i64,
    pub exercise_name: String,
    pub weight: f64,
    pub sets: Vec<WorkoutSet>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkoutSummary {
    pub id: i64,
    pub workout_type: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub exercises: Vec<ExerciseSummary>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExerciseSummary {
    pub name: String,
    pub weight: f64,
    pub sets_completed: i64,
    pub total_sets: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExerciseProgression {
    pub date: String,
    pub weight: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SetCompletion {
    pub is_last_set_of_last_exercise: bool,
}
