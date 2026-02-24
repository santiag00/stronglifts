const { invoke } = window.__TAURI__.core;
const { sendNotification, isPermissionGranted, requestPermission } =
  window.__TAURI__.notification;
const { getCurrentWindow } = window.__TAURI__.window;

let currentView = "dashboard";
let timerInterval = null;
let timerSeconds = 0;
let timerExpired = false;
let timerNotified = false;

async function ensureNotificationPermission() {
  let granted = await isPermissionGranted();
  if (!granted) {
    const perm = await requestPermission();
    granted = perm === "granted";
  }
  return granted;
}

// ─── Router ───

function navigate(view) {
  currentView = view;
  clearTimer();
  render();
}

async function render() {
  const app = document.getElementById("app");
  try {
    switch (currentView) {
      case "dashboard":
        app.innerHTML = await renderDashboard();
        break;
      case "workout":
        app.innerHTML = await renderWorkout();
        break;
      case "history":
        app.innerHTML = await renderHistory();
        break;
      case "settings":
        app.innerHTML = await renderSettings();
        break;
      case "congrats":
        app.innerHTML = renderCongrats();
        break;
      case "progression":
        app.innerHTML = await renderProgression();
        break;
    }
    bindEvents();
  } catch (e) {
    app.innerHTML = `<div class="empty-state"><p>Error: ${e}</p>
      <button class="btn btn-secondary mt-16" onclick="navigate('dashboard')">Back</button></div>`;
  }
}

// ─── Dashboard ───

async function renderDashboard() {
  const nextType = await invoke("get_next_workout_type");
  const history = await invoke("get_workout_history");
  const recent = history.slice(0, 3);

  let activeHtml = "";
  try {
    const active = await invoke("get_active_workout");
    if (active) {
      activeHtml = `
        <div class="card" style="border-color: var(--accent);">
          <div class="card-header">
            <h3>Workout in progress</h3>
            <span class="badge badge-${active.workout.workout_type.toLowerCase()}">
              Workout ${active.workout.workout_type}
            </span>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-small" data-action="resume-workout">Resume</button>
            <button class="btn btn-danger btn-small" data-action="cancel-workout"
              data-workout-id="${active.workout.id}">Cancel</button>
          </div>
        </div>`;
    }
  } catch (_) {}

  const exerciseList = getWorkoutExercises(nextType);

  const recentHtml = recent.length
    ? recent
        .map(
          (w) => `
      <div class="card history-item">
        <div class="card-header">
          <span class="history-date">${formatDate(w.started_at)}</span>
          <span class="badge badge-${w.workout_type.toLowerCase()}">Workout ${w.workout_type}</span>
        </div>
        <div class="history-exercises">
          ${w.exercises.map((e) => `${e.name}: ${e.weight} kg (${e.sets_completed}/${e.total_sets})`).join("<br>")}
        </div>
      </div>`
        )
        .join("")
    : '<div class="text-muted text-sm text-center">No workouts yet</div>';

  return `
    <h1>Stronglifts</h1>
    <p class="subtitle">5×5 Workout Tracker</p>
    ${activeHtml}
    ${
      !activeHtml
        ? `
    <div class="hero">
      <div>Next Workout</div>
      <div class="workout-letter type-${nextType.toLowerCase()}">${nextType}</div>
      <div class="text-muted text-sm">${exerciseList}</div>
    </div>
    <button class="btn btn-primary" data-action="start-workout" data-type="${nextType}">
      Start Workout ${nextType}
    </button>`
        : ""
    }
    <div class="recent-list">
      <h2 class="mt-16">Recent</h2>
      ${recentHtml}
    </div>
    <div class="nav mt-16">
      <button class="active" data-nav="dashboard">Home</button>
      <button data-nav="history">History</button>
      <button data-nav="settings">Settings</button>
    </div>`;
}

function getWorkoutExercises(type) {
  if (type === "A") return "Squat, Bench Press, Barbell Row";
  return "Squat, Overhead Press, Deadlift";
}

// ─── Active Workout ───

async function renderWorkout() {
  const data = await invoke("get_active_workout");
  const w = data.workout;
  const exercises = data.exercises;

  const allDone = exercises.every((ex) => ex.sets.every((s) => s.completed));
  if (allDone && !timerInterval) {
    currentView = "congrats";
    await invoke("complete_workout", { workoutId: w.id });
    return renderCongrats();
  }

  let currentExIdx = exercises.findIndex((ex) => ex.sets.some((s) => !s.completed));
  if (currentExIdx === -1) currentExIdx = exercises.length - 1;

  const exercisesHtml = exercises
    .map((ex, exIdx) => {
      const isDone = ex.sets.every((s) => s.completed);
      const isCurrent = exIdx === currentExIdx;
      const nextSet = ex.sets.find((s) => !s.completed);

      const setsHtml = ex.sets
        .map((s) => {
          const classes = ["set-circle"];
          if (s.completed) classes.push("done");
          else if (isCurrent && s.id === nextSet?.id) classes.push("current");
          else if (!isCurrent) classes.push("disabled");
          return `<div class="${classes.join(" ")}"
            data-action="complete-set" data-set-id="${s.id}"
            data-reps="${s.target_reps}"
            ${s.completed || (!isCurrent && s.id !== nextSet?.id) ? 'data-no-click="true"' : ""}>
            ${s.completed ? s.reps_completed : s.set_number}
          </div>`;
        })
        .join("");

      const cardClass = isDone
        ? "card exercise-card completed-exercise"
        : isCurrent
          ? "card exercise-card active-exercise"
          : "card exercise-card";

      return `
        <div class="${cardClass}">
          <div class="exercise-info">
            <span class="exercise-name">${ex.exercise_name}</span>
            <div class="weight-display">
              <span class="weight-value weight-editable"
                data-action="edit-weight"
                data-exercise-id="${ex.exercise_id}"
                data-current="${ex.weight}">${ex.weight}</span>
              <span class="weight-unit">kg</span>
            </div>
          </div>
          <div class="sets-label">${ex.sets.length} sets × ${ex.sets[0]?.target_reps || 5} reps</div>
          <div class="sets-grid">${setsHtml}</div>
        </div>`;
    })
    .join("");

  let timerClass = "";
  if (timerSeconds <= 0 && isTimerRunning()) timerClass = "overdue";
  else if (timerSeconds <= 30 && isTimerRunning()) timerClass = "urgent";

  const timerHtml = isTimerRunning()
    ? `<div class="timer-container ${timerClass}">
        <div class="timer-display">${formatTimer(timerSeconds)}</div>
        <div class="timer-label">${timerSeconds <= 0 ? "Go! You're past rest time" : "Rest timer"}</div>
       </div>`
    : "";

  return `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h2>Workout ${w.workout_type}</h2>
      <button class="btn btn-danger btn-small" data-action="cancel-workout"
        data-workout-id="${w.id}">Cancel</button>
    </div>
    ${timerHtml}
    ${exercisesHtml}`;
}

// ─── Congratulations ───

function renderCongrats() {
  setTimeout(launchConfetti, 100);
  return `
    <div class="congrats">
      <canvas id="confetti-canvas"></canvas>
      <div class="congrats-content">
        <div class="trophy animate-trophy">🏋️</div>
        <h2 class="animate-fade-up" style="animation-delay:0.3s">Workout Complete!</h2>
        <p class="animate-fade-up" style="animation-delay:0.5s">Great job! Rest up and come back stronger next time.</p>
        <button class="btn btn-primary animate-fade-up" style="animation-delay:0.7s" data-action="go-dashboard">Done</button>
      </div>
    </div>`;
}

function launchConfetti() {
  const canvas = document.getElementById("confetti-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  canvas.width = canvas.parentElement.offsetWidth;
  canvas.height = canvas.parentElement.offsetHeight;

  const colors = ["#e94560", "#2ed573", "#ffa502", "#3742fa", "#ff6b81", "#70a1ff", "#eccc68"];
  const pieces = [];

  for (let i = 0; i < 120; i++) {
    pieces.push({
      x: canvas.width / 2,
      y: canvas.height / 2 - 60,
      vx: (Math.random() - 0.5) * 16,
      vy: Math.random() * -14 - 4,
      w: Math.random() * 8 + 4,
      h: Math.random() * 6 + 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 12,
      gravity: 0.25 + Math.random() * 0.15,
      opacity: 1,
    });
  }

  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of pieces) {
      p.x += p.vx;
      p.vy += p.gravity;
      p.y += p.vy;
      p.vx *= 0.99;
      p.rotation += p.rotSpeed;
      if (frame > 60) p.opacity -= 0.01;
      if (p.opacity <= 0) continue;
      alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    frame++;
    if (alive && frame < 200) requestAnimationFrame(draw);
  }
  draw();
}

// ─── History ───

async function renderHistory() {
  const history = await invoke("get_workout_history");

  const listHtml = history.length
    ? history
        .map(
          (w) => `
      <div class="card history-item">
        <div class="card-header">
          <span class="history-date">${formatDate(w.started_at)}</span>
          <span class="badge badge-${w.workout_type.toLowerCase()}">Workout ${w.workout_type}</span>
        </div>
        <div class="history-exercises">
          ${w.exercises
            .map(
              (e) =>
                `<span data-action="show-progression" data-exercise-name="${e.name}"
                  style="cursor:pointer;text-decoration:underline dotted var(--text-muted)">${e.name}</span>: ${e.weight} kg (${e.sets_completed}/${e.total_sets})`
            )
            .join("<br>")}
        </div>
      </div>`
        )
        .join("")
    : '<div class="empty-state"><p>No completed workouts yet.</p></div>';

  return `
    <h1>History</h1>
    <p class="subtitle">Past workouts</p>
    ${listHtml}
    <div class="nav mt-16">
      <button data-nav="dashboard">Home</button>
      <button class="active" data-nav="history">History</button>
      <button data-nav="settings">Settings</button>
    </div>`;
}

// ─── Progression ───

async function renderProgression() {
  const exercises = await invoke("get_exercises");
  const ex = exercises.find((e) => e.name === window._progressionExercise);
  if (!ex) return renderHistory();

  const data = await invoke("get_exercise_progression", { exerciseId: ex.id });
  if (!data.length) {
    return `
      <span class="back-link" data-action="go-history">&larr; Back</span>
      <h2>${ex.name} Progression</h2>
      <div class="empty-state"><p>No data yet.</p></div>`;
  }

  const maxW = Math.max(...data.map((d) => d.weight));
  const barsHtml = data
    .map(
      (d) =>
        `<div class="progression-point"
          style="height: ${Math.max(8, (d.weight / maxW) * 100)}%"
          data-label="${d.weight} kg — ${formatDate(d.date)}"></div>`
    )
    .join("");

  return `
    <span class="back-link" data-action="go-history">&larr; Back</span>
    <h2>${ex.name}</h2>
    <p class="subtitle">Weight progression (kg)</p>
    <div class="card">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span class="text-sm text-muted">${formatDate(data[0].date)}</span>
        <span class="text-sm text-muted">${formatDate(data[data.length - 1].date)}</span>
      </div>
      <div class="progression-bar">${barsHtml}</div>
      <div style="display:flex;justify-content:space-between;margin-top:8px">
        <span class="text-sm">${data[0].weight} kg</span>
        <span class="text-sm">${data[data.length - 1].weight} kg</span>
      </div>
    </div>`;
}

// ─── Settings ───

async function renderSettings() {
  const config = await invoke("get_program_config");
  const exercises = await invoke("get_exercises");

  const exerciseRows = exercises
    .map(
      (e) => `
    <tr>
      <td>${e.name}</td>
      <td>
        <input type="number" step="0.5" value="${e.current_weight}"
          data-action="save-weight" data-exercise-id="${e.id}">
      </td>
      <td>
        <input type="number" min="1" value="${e.target_sets ?? ""}" placeholder="def"
          data-action="save-exercise" data-field="sets" data-exercise-id="${e.id}">
      </td>
      <td>
        <input type="number" step="0.5" value="${e.weight_increment}"
          data-action="save-exercise" data-field="increment" data-exercise-id="${e.id}">
      </td>
    </tr>`
    )
    .join("");

  return `
    <h1>Settings</h1>
    <p class="subtitle">Program configuration</p>

    <div class="card">
      <h3 style="margin-bottom:12px">Program Defaults</h3>
      <div class="setting-row">
        <span class="setting-label">Default sets per exercise</span>
        <div class="setting-value">
          <input type="number" min="1" value="${config.default_sets}" id="cfg-sets">
        </div>
      </div>
      <div class="setting-row">
        <span class="setting-label">Default reps per set</span>
        <div class="setting-value">
          <input type="number" min="1" value="${config.default_reps}" id="cfg-reps">
        </div>
      </div>
      <button class="btn btn-secondary btn-small mt-16" data-action="save-config">Save Defaults</button>
    </div>

    <div class="card">
      <h3 style="margin-bottom:12px">Exercises</h3>
      <table class="config-table">
        <thead>
          <tr><th>Exercise</th><th>Weight</th><th>Sets</th><th>+kg</th></tr>
        </thead>
        <tbody>${exerciseRows}</tbody>
      </table>
    </div>

    <div class="nav mt-16">
      <button data-nav="dashboard">Home</button>
      <button data-nav="history">History</button>
      <button class="active" data-nav="settings">Settings</button>
    </div>`;
}

// ─── Timer ───

function startTimer() {
  clearTimer();
  timerSeconds = 180;
  timerExpired = false;
  timerNotified = false;
  timerInterval = setInterval(async () => {
    timerSeconds--;
    updateTimerDisplay();
    if (timerSeconds <= 0 && !timerNotified) {
      timerNotified = true;
      timerExpired = true;
      playTimerSound();
      const granted = await ensureNotificationPermission();
      if (granted) {
        sendNotification({
          title: "Stronglifts",
          body: "Rest is over — time for your next set!",
        });
      }
      try {
        await getCurrentWindow().requestUserAttention(2);
      } catch (_) {}
    }
  }, 1000);
  render();
}

function clearTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  timerSeconds = 0;
  timerExpired = false;
  timerNotified = false;
}

function isTimerRunning() {
  return timerInterval !== null;
}

function updateTimerDisplay() {
  const el = document.querySelector(".timer-display");
  const container = document.querySelector(".timer-container");
  if (el) {
    el.textContent = formatTimer(timerSeconds);
    if (container) {
      if (timerSeconds <= 0) {
        container.classList.add("overdue");
        container.classList.remove("urgent");
      } else if (timerSeconds <= 30) {
        container.classList.add("urgent");
        container.classList.remove("overdue");
      } else {
        container.classList.remove("urgent");
        container.classList.remove("overdue");
      }
    }
  }
}

function formatTimer(sec) {
  if (sec < 0) {
    const abs = Math.abs(sec);
    const m = Math.floor(abs / 60);
    const s = abs % 60;
    return `-${m}:${String(s).padStart(2, "0")}`;
  }
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function playTimerSound() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [880, 1108.73, 1318.51];
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + i * 0.15 + 0.4);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + i * 0.15);
      osc.stop(audioCtx.currentTime + i * 0.15 + 0.4);
    });
  } catch (_) {}
}

// ─── Event Binding ───

function bindEvents() {
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.nav));
  });

  document.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", (e) => handleAction(e, el));
    if (el.tagName === "INPUT") {
      el.addEventListener("change", (e) => handleAction(e, el));
    }
  });
}

async function handleAction(event, el) {
  const action = el.dataset.action;

  switch (action) {
    case "start-workout": {
      await invoke("start_workout", { workoutType: el.dataset.type });
      navigate("workout");
      break;
    }
    case "resume-workout": {
      navigate("workout");
      break;
    }
    case "cancel-workout": {
      const id = parseInt(el.dataset.workoutId);
      await invoke("cancel_workout", { workoutId: id });
      clearTimer();
      navigate("dashboard");
      break;
    }
    case "complete-set": {
      if (el.dataset.noClick) return;
      const setId = parseInt(el.dataset.setId);
      const reps = parseInt(el.dataset.reps);
      const result = await invoke("complete_set", { setId, reps });
      if (result.is_last_set_of_last_exercise) {
        clearTimer();
        await invoke("complete_workout", {
          workoutId: (await invoke("get_active_workout")).workout.id,
        });
        navigate("congrats");
      } else {
        startTimer();
      }
      break;
    }
    case "edit-weight": {
      const exId = parseInt(el.dataset.exerciseId);
      const current = el.dataset.current;
      const input = document.createElement("input");
      input.type = "number";
      input.step = "0.5";
      input.value = current;
      input.className = "inline-edit";
      input.style.cssText =
        "width:80px;padding:4px 8px;border:1px solid var(--accent);border-radius:6px;background:var(--bg);color:var(--text);font-size:16px;font-weight:700;text-align:center";

      const parent = el.parentElement;
      el.replaceWith(input);
      input.focus();
      input.select();

      const save = async () => {
        const val = parseFloat(input.value);
        if (!isNaN(val) && val > 0) {
          await invoke("override_weight", {
            exerciseId: exId,
            newWeight: val,
          });
        }
        render();
      };
      input.addEventListener("blur", save);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") render();
      });
      break;
    }
    case "save-config": {
      const sets = parseInt(document.getElementById("cfg-sets").value);
      const reps = parseInt(document.getElementById("cfg-reps").value);
      if (sets > 0 && reps > 0) {
        await invoke("update_program_config", {
          defaultSets: sets,
          defaultReps: reps,
        });
      }
      render();
      break;
    }
    case "save-weight": {
      const exId = parseInt(el.dataset.exerciseId);
      const val = parseFloat(el.value);
      if (!isNaN(val) && val > 0) {
        await invoke("override_weight", {
          exerciseId: exId,
          newWeight: val,
        });
      }
      break;
    }
    case "save-exercise": {
      const exId = parseInt(el.dataset.exerciseId);
      const exercises = await invoke("get_exercises");
      const ex = exercises.find((e) => e.id === exId);
      if (!ex) break;

      const row = el.closest("tr");
      const setsInput = row.querySelector('[data-field="sets"]');
      const incrInput = row.querySelector('[data-field="increment"]');

      const sets = setsInput.value ? parseInt(setsInput.value) : null;
      const incr = parseFloat(incrInput.value) || ex.weight_increment;

      await invoke("update_exercise", {
        exerciseId: exId,
        targetSets: sets > 0 ? sets : null,
        targetReps: ex.target_reps,
        weightIncrement: incr,
      });
      break;
    }
    case "go-dashboard": {
      navigate("dashboard");
      break;
    }
    case "go-history": {
      navigate("history");
      break;
    }
    case "show-progression": {
      window._progressionExercise = el.dataset.exerciseName;
      navigate("progression");
      break;
    }
  }
}

// ─── Helpers ───

function formatDate(isoStr) {
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return isoStr;
  }
}

// ─── Init ───

document.addEventListener("DOMContentLoaded", () => {
  ensureNotificationPermission();
  document.getElementById("app").classList.add("app-enter");
  render();
});
