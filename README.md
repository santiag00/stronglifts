# Stronglifts 5×5

A native Mac desktop app for tracking your Stronglifts 5×5 workout program.

Built with **Tauri v2** (Rust backend + vanilla HTML/CSS/JS frontend) and **SQLite** for local persistence.

## Features

- **Workout alternation**: Automatically determines if your next workout is A or B
- **Weight progression**: Auto-increments weight after successful completion (kg)
- **Weight override**: Manually set any exercise weight — becomes the new baseline
- **Rest timer**: 3-minute countdown with macOS system notification when done
- **History**: Browse past workouts and per-exercise weight progression
- **Configurable**: Change default sets/reps (5×5, 5×3, etc.) and per-exercise overrides

## Program

| Workout A | Workout B |
|-----------|-----------|
| Squat 5×5 | Squat 5×5 |
| Bench Press 5×5 | Overhead Press 5×5 |
| Barbell Row 5×5 | Deadlift 1×5 |

## Prerequisites

- [Rust](https://rustup.rs/) (1.77.2+)
- [Node.js](https://nodejs.org/) (18+)

## Development

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

The built `.app` will be in `src-tauri/target/release/bundle/macos/`.
