/* ── app.js — PhysioAI frontend logic ──────────────────────── */
const socket = io();

// ── State ──────────────────────────────────────────────────────
let cfg = { mode: 'SQUATS', reps: 10, sets: 3 };
let sessionState = 'setup';   // 'setup' | 'running' | 'complete'
let currentSet   = 1;
let lastRepCount = 0;
let lastSetCompleteTime = 0;  // debounce: ignore duplicate session_complete events
let cameraEnabled = false;
let browserStream = null;
let voiceEnabled = true; // Voice guidance enabled by default
let lastSpokenFeedback = '';

// ── DOM refs ───────────────────────────────────────────────────
const screens = {
  setup:    document.getElementById('setup-screen'),
  exercise: document.getElementById('exercise-screen'),
  complete: document.getElementById('complete-screen'),
};

const videoFeed = document.getElementById('video-feed');
const videoPlaceholder = document.getElementById('video-placeholder');
const $  = id => document.getElementById(id);
const repCounter    = $('rep-counter');
const repOf         = $('rep-of');
const setCounter    = $('set-counter');
const setOf         = $('set-of');
const correctCount  = $('correct-count');
const incorrectCount= $('incorrect-count');
const stateBadge    = $('state-badge');
const feedbackBox   = $('feedback-box');
const feedbackIcon  = $('feedback-icon');
const feedbackText  = $('feedback-text');
const repFlash      = $('rep-flash');
const sessionFill   = $('session-fill');
const progressPct   = $('progress-pct');
const accFill       = $('acc-fill');
const accuracyPct   = $('accuracy-pct');
const setDots       = $('set-dots');
const topMode       = $('top-mode');
const ringFill      = $('ring-fill');

// Rest-timer refs
const restOverlay   = $('rest-overlay');
const restCountdown = $('rest-countdown');
const restBarFill   = $('rest-bar-fill');
const restPrevStats = $('rest-prev-stats');

const REST_DURATION = 30; // seconds between sets
let   restTimerId   = null; // holds setInterval handle

const TIPS = {
  SQUATS:       ['Feet shoulder-width apart','Keep back straight','Knees track over toes'],
  STS:          ['Use armrests if needed','Lead with your chest','Push through your heels'],
  LUNGES:       ['Torso upright at all times','Front knee behind toes','Lower rear knee gently'],
  SHOULDER_ABD: ['Keep elbow fully straight','Raise to shoulder height','Control the lowering phase'],
};

const ICONS = {
  green:  '✅',
  orange: '⚠️',
  red:    '❌',
  default:'🎯',
};

// ── Screen helpers ─────────────────────────────────────────────
function showScreen(name) {
  Object.values(screens).forEach(s => { s.classList.remove('active'); s.style.display = 'none'; });
  const s = screens[name];
  s.style.display = 'flex';
  requestAnimationFrame(() => s.classList.add('active'));
}

// ── Setup screen ───────────────────────────────────────────────
let reps = 10, sets = 3;

// ── Exercise preview data ──────────────────────────────────────
const EXERCISE_PREVIEW = {
  SQUATS: {
    image: 'images/squats.png',
    name: 'Squats',
    desc: 'A fundamental lower body exercise that strengthens your quads, glutes, and core while improving mobility and balance.',
    tips: [
      'Feet shoulder-width apart',
      'Keep back straight and chest up',
      'Knees track over toes, not inward',
      'Lower until thighs are parallel to floor'
    ]
  },
  STS: {
    image: 'images/sts.png',
    name: 'Sit to Stand',
    desc: 'A functional rehabilitation exercise that builds leg and core strength essential for daily activities like getting up from a chair.',
    tips: [
      'Sit at the edge of a sturdy chair',
      'Lean forward slightly before standing',
      'Push through your heels to rise',
      'Stand fully upright, extend hips'
    ]
  },
  LUNGES: {
    image: 'images/lunges.png',
    name: 'Lunges',
    desc: 'A unilateral exercise that builds balance, glute and quad strength while improving coordination and lower body stability.',
    tips: [
      'Stand at 45° angle to camera',
      'Keep your torso upright throughout',
      'Front knee stays behind toes',
      'Lower rear knee gently toward floor'
    ]
  },
  SHOULDER_ABD: {
    image: 'images/shoulder_abd.png',
    name: 'Shoulder Abduction',
    desc: 'A rehabilitation exercise targeting shoulder range of motion. Strengthens deltoids and rotator cuff muscles for injury recovery.',
    tips: [
      'Keep elbows fully straight',
      'Raise arms sideways to shoulder height',
      'Control the movement both up and down',
      'Keep torso upright, avoid leaning'
    ]
  }
};

function updatePreview(mode) {
  const data = EXERCISE_PREVIEW[mode];
  if (!data) return;
  const previewImg = $('preview-img');
  const previewName = $('preview-name');
  const previewDesc = $('preview-desc');
  const previewTipsList = $('preview-tips-list');
  if (previewImg) previewImg.src = data.image;
  if (previewName) previewName.textContent = data.name;
  if (previewDesc) previewDesc.textContent = data.desc;
  if (previewTipsList) {
    previewTipsList.innerHTML = '';
    data.tips.forEach(tip => {
      const li = document.createElement('li');
      li.textContent = tip;
      previewTipsList.appendChild(li);
    });
  }
}

document.querySelectorAll('.ex-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.ex-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    cfg.mode = card.dataset.mode;
    updatePreview(cfg.mode);
  });
});

function makeStepper(decId, incId, valId, min, max, initial, onChange) {
  let val = initial;
  const display = $(valId);
  display.textContent = val;
  $(decId).addEventListener('click', () => { if (val > min) { val--; display.textContent = val; onChange(val); } });
  $(incId).addEventListener('click', () => { if (val < max) { val++; display.textContent = val; onChange(val); } });
  return () => val;
}

const getReps = makeStepper('reps-dec','reps-inc','reps-val', 1, 50, 10, v => { reps = v; });
const getSets = makeStepper('sets-dec','sets-inc','sets-val', 1, 10, 3,  v => { sets = v; });

// ── Voice Assistant ───────────────────────────────────────────
function voiceSpeak(text) {
  if (voiceEnabled && 'speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.15; // Slightly faster for quick fluid guidance
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }
}

function toggleVoice(forceState) {
  voiceEnabled = forceState !== undefined ? forceState : !voiceEnabled;
  updateVoiceUI(voiceEnabled);
  if (!voiceEnabled) {
    window.speechSynthesis && window.speechSynthesis.cancel();
  } else {
    voiceSpeak('Voice assistant enabled');
  }
}

function updateVoiceUI(enabled) {
  const buttons = [$('btn-voice-toggle-setup'), $('btn-voice-toggle-ex')];
  buttons.forEach(btn => {
    if (!btn) return;
    if (enabled) {
      btn.className = 'btn-voice voice-enabled';
      btn.querySelector('.voice-status-text').textContent = 'Voice: ON';
    } else {
      btn.className = 'btn-voice voice-disabled';
      btn.querySelector('.voice-status-text').textContent = 'Voice: OFF';
    }
  });
}

// ── Camera Toggle & Permissions ───────────────────────────────
async function toggleCamera(forceState) {
  const targetState = forceState !== undefined ? forceState : !cameraEnabled;
  
  if (targetState) {
    try {
      // Ask user for browser camera permission
      browserStream = await navigator.mediaDevices.getUserMedia({ video: true });
      
      // Stop the browser stream track immediately to save resources,
      // as backend OpenCV is doing the actual capturing.
      browserStream.getTracks().forEach(track => track.stop());
      browserStream = null;
      
      cameraEnabled = true;
      updateCameraUI(true);
      socket.emit('camera_toggle', { enabled: true });
      
      // Reset UI elements if running
      if (sessionState === 'running') {
        if (videoPlaceholder) {
          videoPlaceholder.textContent = 'Initializing Camera...';
        }
      }
    } catch (err) {
      console.error('Camera access error:', err);
      alert('⚠️ Camera Access Denied or Not Found.\n\nPlease allow camera permissions in your browser to use the AI Physiotherapy Assistant.');
      cameraEnabled = false;
      updateCameraUI(false);
      socket.emit('camera_toggle', { enabled: false });
    }
  } else {
    cameraEnabled = false;
    if (browserStream) {
      browserStream.getTracks().forEach(track => track.stop());
      browserStream = null;
    }
    updateCameraUI(false);
    socket.emit('camera_toggle', { enabled: false });
    
    // Hide active video feed and show off placeholder if running
    if (sessionState === 'running') {
      if (videoFeed) videoFeed.style.display = 'none';
      if (videoPlaceholder) {
        videoPlaceholder.style.display = 'flex';
        videoPlaceholder.style.visibility = 'visible';
        videoPlaceholder.textContent = 'Camera is Turned OFF. Enable it from the top-right button.';
      }
    }
  }
}

function updateCameraUI(enabled) {
  const buttons = [$('btn-camera-toggle-setup'), $('btn-camera-toggle-ex')];
  buttons.forEach(btn => {
    if (!btn) return;
    if (enabled) {
      btn.className = 'btn-camera camera-enabled';
      btn.querySelector('.camera-status-text').textContent = 'Camera: ON';
    } else {
      btn.className = 'btn-camera camera-disabled';
      btn.querySelector('.camera-status-text').textContent = 'Camera: OFF';
    }
  });
}

$('btn-start').addEventListener('click', async () => {
  cfg.reps = getReps();
  cfg.sets = getSets();
  await startSession();
});

// ── Session start ──────────────────────────────────────────────
async function startSession() {
  if (!cameraEnabled) {
    const proceed = confirm('📷 Camera is currently OFF.\n\nWould you like to turn it ON and grant camera permissions to start tracking your movements?');
    if (proceed) {
      await toggleCamera(true);
      if (!cameraEnabled) {
        // User denied or failed to turn camera ON, abort session start
        return;
      }
    } else {
      return;
    }
  }

  currentSet   = 1;
  lastRepCount = 0;
  lastSetCompleteTime = 0;
  sessionState = 'running';

  // Cancel any in-progress rest timer from a previous set
  if (restTimerId) { clearInterval(restTimerId); restTimerId = null; }
  if (restOverlay) restOverlay.style.display = 'none';

  // Reset video feed
  if (videoFeed) {
    videoFeed.style.display = 'none';
    videoFeed.src = '';
  }
  if (videoPlaceholder) {
    videoPlaceholder.style.display = 'flex';
    videoPlaceholder.style.visibility = 'visible';
    videoPlaceholder.textContent = 'Initializing Camera...';
  }

  topMode.textContent = modeLabel(cfg.mode);
  buildSetDots(cfg.sets, 1);
  setCounter.textContent  = '1';
  setOf.textContent       = `/ ${cfg.sets}`;
  repOf.textContent       = `/ ${cfg.reps}`;
  repCounter.textContent  = '0';
  correctCount.textContent   = '0';
  incorrectCount.textContent = '0';
  accuracyPct.textContent = '—';
  sessionFill.style.width = '0%';
  progressPct.textContent = '0%';
  updateRing(0, cfg.reps);
  updateAccRing(null);

  // Tips
  const tipsList = $('tips-list');
  tipsList.innerHTML = '';
  (TIPS[cfg.mode] || []).forEach(t => {
    const li = document.createElement('li');
    li.textContent = t;
    tipsList.appendChild(li);
  });

  setFeedback('Get into position and begin!', 'default', '🎯');
  stateBadge.textContent = 'READY';
  stateBadge.className = 'state-badge';
  resetPhase();

  showScreen('exercise');
  socket.emit('start', { mode: cfg.mode, reps: cfg.reps, sets: cfg.sets });
}

// ── Stop ───────────────────────────────────────────────────────
$('btn-stop').addEventListener('click', () => {
  // Cancel rest timer if it is running
  if (restTimerId) { clearInterval(restTimerId); restTimerId = null; }
  if (restOverlay) restOverlay.style.display = 'none';
  socket.emit('stop');
  sessionState = 'setup';
  showScreen('setup');
});

// ── Socket events ──────────────────────────────────────────────
socket.on('py_event', (data) => {
  if (data.type === 'error') {
    alert('⚠️ Python Error: ' + data.message + '\n\nCheck that Python is installed and the model file exists.');
    sessionState = 'setup';
    showScreen('setup');
    return;
  }

  if (data.type === 'stopped' && sessionState === 'running') {
    sessionState = 'setup';
    showScreen('setup');
    return;
  }

  if (data.type === 'frame' && sessionState === 'running') {
    if (cameraEnabled && videoFeed) {
      videoFeed.src = 'data:image/jpeg;base64,' + data.data;
      // Use computed style to correctly detect hidden state (CSS rule vs inline style)
      const computed = window.getComputedStyle(videoFeed);
      if (computed.display === 'none') {
        videoFeed.style.display = 'block';
      }
      if (videoPlaceholder) {
        videoPlaceholder.style.display = 'none';
      }
    } else if (!cameraEnabled) {
      if (videoFeed) videoFeed.style.display = 'none';
      if (videoPlaceholder) {
        videoPlaceholder.style.display = 'flex';
        videoPlaceholder.style.visibility = 'visible';
        videoPlaceholder.textContent = 'Camera is Turned OFF. Enable it from the top-right button.';
      }
    }
    return;
  }

  if (sessionState !== 'running' || !cameraEnabled) return;

  if (data.type === 'status') {
    handleStatus(data);
  } else if (data.type === 'session_complete') {
    handleSetComplete(data);
  }
});

// ── Status handler ─────────────────────────────────────────────
function handleStatus(d) {
  // Rep counter
  const rep = d.rep ?? 0;
  const targetReps = d.target_reps ?? cfg.reps;
  const metrics = d.metrics ?? {};
  const tQuality = d.tracking_quality ?? 0;

  // Track tracking quality in history
  trackingQualityHistory.push(tQuality);

  // 1. HUD Onboarding Alerts & Signal Badges
  const hudBadge = $('hud-tracking-badge');
  const hudText = $('hud-tracking-text');
  const hudAlert = $('hud-onboarding-alert');
  const hudAlertText = $('hud-onboarding-text');

  if (hudBadge && hudText) {
    hudBadge.className = 'hud-tracking-badge ' + (
      tQuality >= 90 ? 'tracking-excellent' :
      tQuality >= 70 ? 'tracking-good' : 'tracking-poor'
    );
    hudText.textContent = 'Signal: ' + (
      tQuality >= 90 ? 'Excellent' :
      tQuality >= 70 ? 'Good' : 'Weak'
    );
  }

  if (hudAlert && hudAlertText) {
    if (tQuality < 70) {
      hudAlert.style.display = 'flex';
      hudAlert.className = 'hud-onboarding-alert alert-warning';
      hudAlertText.textContent = '⚠️ Step back or improve lighting';
    } else if (rep === 0) {
      hudAlert.style.display = 'flex';
      hudAlert.className = 'hud-onboarding-alert alert-info';
      if (cfg.mode === 'SHOULDER_ABD') {
        hudAlertText.textContent = 'ℹ️ Move back until your full upper body is visible';
      } else {
        hudAlertText.textContent = 'ℹ️ Move back until your full body is visible';
      }
    } else {
      hudAlert.style.display = 'none';
    }
  }

  // 2. Rep tracking and stats history
  if (rep !== lastRepCount) {
    if (rep > lastRepCount) {
      flashRep('+1');
      voiceSpeak(rep.toString()); // Speak rep count out loud!

      // Record rep data progression
      const t = (d.correct ?? 0) + (d.incorrect ?? 0);
      const repAcc = t > 0 ? Math.round((d.correct / t) * 100) : 100;
      accuracyHistory.push(repAcc);
      romHistory.push(metrics.rom ?? 100);
    }
    lastRepCount = rep;
  }
  repCounter.textContent = rep;
  repOf.textContent = `/ ${targetReps}`;
  updateRing(rep, targetReps);

  // Correct / incorrect
  correctCount.textContent   = d.correct   ?? 0;
  incorrectCount.textContent = d.incorrect ?? 0;

  // Accuracy
  const total = (d.correct ?? 0) + (d.incorrect ?? 0);
  if (total > 0) {
    const acc = Math.round((d.correct / total) * 100);
    accuracyPct.textContent = acc + '%';
    updateAccRing(acc);
    accFill.style.stroke = acc >= 70 ? 'var(--green)' : acc >= 40 ? 'var(--orange)' : 'var(--red)';
  }

  // 3. Dynamic Form Score Level Display
  const formScoreVal = $('form-score-value');
  if (formScoreVal) {
    if (total === 0) {
      formScoreVal.textContent = 'Waiting for first rep';
      formScoreVal.style.color = 'var(--muted)';
    } else {
      const acc = Math.round((d.correct / total) * 100);
      let grade = 'Excellent';
      let color = 'var(--green)';
      if (acc >= 90) {
        grade = 'Excellent';
        color = 'var(--green)';
      } else if (acc >= 70) {
        grade = 'Good';
        color = 'var(--accent2)';
      } else if (acc >= 50) {
        grade = 'Average';
        color = 'var(--orange)';
      } else {
        grade = 'Needs Work';
        color = 'var(--red)';
      }
      formScoreVal.textContent = grade;
      formScoreVal.style.color = color;
    }
  }

  // Session overall progress (sets * reps)
  const totalRepsSession = cfg.sets * cfg.reps;
  const doneRepsSession  = (currentSet - 1) * cfg.reps + rep;
  const pct = Math.min(100, Math.round((doneRepsSession / totalRepsSession) * 100));
  sessionFill.style.width  = pct + '%';
  progressPct.textContent  = pct + '%';

  // State badge
  const st = (d.state ?? '').toLowerCase();
  stateBadge.textContent = (d.state ?? 'READY').toUpperCase();
  stateBadge.className = 'state-badge' + (
    st.includes('down') || st.includes('sitting') ? ' state-down' :
    st.includes('up')   || st.includes('stand')   ? ' state-up'   : '');

  // 4. Update live cockpit dashboard card & values
  const dashCard = $('dash-state-card');
  const dashValue = $('dash-state-value');

  if (dashCard && dashValue) {
    let stateClass = 'state-ready';
    let stateLabel = 'READY';
    
    if (d.color === 'red') {
      stateClass = 'state-incorrect';
      stateLabel = 'INCORRECT FORM';
    } else if (d.color === 'orange') {
      stateClass = 'state-transition';
      stateLabel = 'TRANSITION';
    } else if (d.color === 'green') {
      if (d.feedback === 'Good posture' || d.feedback === 'Good lunge form!' || d.feedback === 'Good Form') {
        stateClass = 'state-correct';
        stateLabel = 'GOOD POSTURE';
      } else {
        stateClass = 'state-ready';
        stateLabel = 'READY';
      }
    }
    
    dashCard.className = `dash-state-card ${stateClass}`;
    dashValue.textContent = stateLabel;
  }

  // Metric displays
  const metric1Label = $('metric-1-label');
  const metric1Val = $('metric-1-val');
  const metric1Target = $('metric-1-target');
  
  const metric2Label = $('metric-2-label');
  const metric2Val = $('metric-2-val');
  const romBarFill = $('rom-bar-fill');
  
  const metricPhaseVal = $('metric-phase-val');

  if (cfg.mode === 'SQUATS') {
    if (metric1Label) metric1Label.textContent = 'KNEE / HIP ANGLE';
    if (metric1Val) metric1Val.textContent = `${metrics.knee_angle ?? 180}° / ${metrics.hip_angle ?? 180}°`;
    if (metric1Target) metric1Target.textContent = `/ 80°`;
    
    if (metric2Label) metric2Label.textContent = 'DEPTH SCORE';
    if (metric2Val) metric2Val.textContent = `${metrics.depth_score ?? 0}%`;
    if (romBarFill) romBarFill.style.width = `${metrics.rom ?? 0}%`;
  } else if (cfg.mode === 'STS') {
    if (metric1Label) metric1Label.textContent = 'KNEE / BACK ANGLE';
    if (metric1Val) metric1Val.textContent = `${metrics.knee_angle ?? 90}° / ${metrics.back_angle ?? 90}°`;
    if (metric1Target) metric1Target.textContent = `/ 160°`;
    
    if (metric2Label) metric2Label.textContent = 'RANGE OF MOTION';
    if (metric2Val) metric2Val.textContent = `${metrics.rom ?? 0}%`;
    if (romBarFill) romBarFill.style.width = `${metrics.rom ?? 0}%`;
  } else if (cfg.mode === 'LUNGES') {
    if (metric1Label) metric1Label.textContent = 'FRONT KNEE ANGLE';
    if (metric1Val) metric1Val.textContent = `${metrics.knee_angle ?? 180}°`;
    if (metric1Target) metric1Target.textContent = `/ 95°`;
    
    if (metric2Label) metric2Label.textContent = 'RANGE OF MOTION';
    if (metric2Val) metric2Val.textContent = `${metrics.rom ?? 0}%`;
    if (romBarFill) romBarFill.style.width = `${metrics.rom ?? 0}%`;
  } else if (cfg.mode === 'SHOULDER_ABD') {
    if (metric1Label) metric1Label.textContent = 'SHOULDER / ELBOW';
    if (metric1Val) metric1Val.textContent = `${metrics.shoulder_angle ?? 0}° / ${metrics.elbow_angle ?? 180}°`;
    if (metric1Target) metric1Target.textContent = `/ 90°`;
    
    if (metric2Label) metric2Label.textContent = 'ABDUCTION RANGE';
    if (metric2Val) metric2Val.textContent = `${metrics.rom ?? 0}%`;
    if (romBarFill) romBarFill.style.width = `${metrics.rom ?? 0}%`;
  }
  
  if (metricPhaseVal) {
    metricPhaseVal.textContent = metrics.phase ?? 'Standing';
  }

  // Phase indicator
  updatePhase(st);

  // Feedback
  const fb  = d.feedback ?? '';
  const col = d.color    ?? 'green';
  setFeedback(fb || 'Keep going…', col, ICONS[col] ?? '🎯');

  // Real-time voice posture correction feedback & mistake logging
  if (fb && fb !== lastSpokenFeedback && fb !== 'Keep going…') {
    voiceSpeak(fb);
    lastSpokenFeedback = fb;
    if (col === 'red' || col === 'orange') {
      mistakesLog[fb] = (mistakesLog[fb] ?? 0) + 1;
    }
  } else if (!fb || fb === 'Keep going…') {
    lastSpokenFeedback = '';
  }
}

// ── Set / session complete handler ─────────────────────────────
function handleSetComplete(d) {
  // Debounce: ignore rapid duplicate events
  const now = Date.now();
  if (now - lastSetCompleteTime < 4000) return;
  lastSetCompleteTime = now;

  if (currentSet < cfg.sets) {
    // Show rest timer with stats from the just-completed set
    showRestTimer(currentSet, d);
  } else {
    // All sets done
    sessionState = 'complete';
    socket.emit('stop');
    voiceSpeak("Session complete! Excellent job, you have completed all your sets!");
    showComplete(d);
  }
}

// ── Rest timer between sets ─────────────────────────────────────
function showRestTimer(completedSet, d) {
  // Populate previous-set stats inside the overlay
  const correct   = d.correct   ?? 0;
  const incorrect = d.incorrect ?? 0;
  const total     = correct + incorrect;
  const acc       = total > 0 ? Math.round((correct / total) * 100) : 0;
  restPrevStats.innerHTML = `
    <div class="rps-item"><span class="rps-val" style="color:var(--green)">${correct}</span><span class="rps-lbl">Correct</span></div>
    <div class="rps-item"><span class="rps-val" style="color:var(--red)">${incorrect}</span><span class="rps-lbl">Errors</span></div>
    <div class="rps-item"><span class="rps-val" style="color:var(--accent2)">${acc}%</span><span class="rps-lbl">Accuracy</span></div>
  `;

  // Show overlay
  restOverlay.style.display = 'flex';
  restOverlay.style.animation = 'none';
  restOverlay.offsetHeight;
  restOverlay.style.animation = '';

  let remaining = REST_DURATION;
  restCountdown.textContent    = remaining;
  restBarFill.style.transition = 'none';
  restBarFill.style.width      = '100%';



  voiceSpeak(`Set ${completedSet} complete! Rest for ${REST_DURATION} seconds.`);

  // Kick off progress bar shrink
  requestAnimationFrame(() => {
    restBarFill.style.transition = `width ${REST_DURATION}s linear`;
    restBarFill.style.width      = '0%';
  });

  if (restTimerId) clearInterval(restTimerId);

  // Wire skip button
  const skipBtn = $('btn-skip-rest');
  const skipHandler = () => {
    if (restTimerId) { clearInterval(restTimerId); restTimerId = null; }
    window.speechSynthesis && window.speechSynthesis.cancel();
    skipBtn.removeEventListener('click', skipHandler);
    advanceToNextSet();
  };
  skipBtn.addEventListener('click', skipHandler);

  restTimerId = setInterval(() => {
    remaining--;
    restCountdown.textContent = remaining;

    // Pulse on tick
    restCountdown.style.transform = 'scale(1.18)';
    setTimeout(() => { restCountdown.style.transform = 'scale(1)'; }, 120);

    if (remaining === 10) voiceSpeak('10 seconds remaining. Get ready!');
    if (remaining === 5)  voiceSpeak('5 seconds. Get ready!');
    if (remaining === 3)  voiceSpeak('3');
    if (remaining === 2)  voiceSpeak('2');
    if (remaining === 1)  voiceSpeak('1');

    if (remaining <= 0) {
      clearInterval(restTimerId);
      restTimerId = null;
      skipBtn.removeEventListener('click', skipHandler);
      advanceToNextSet();
    }
  }, 1000);
}

function advanceToNextSet() {
  restOverlay.style.display = 'none';
  currentSet++;
  buildSetDots(cfg.sets, currentSet);
  setCounter.textContent = currentSet;
  lastRepCount = 0;
  socket.emit('next_set', { set: currentSet, reps: cfg.reps });
  setFeedback(`Set ${currentSet} — Go!`, 'green', '🚀');
}

// ── Complete screen ────────────────────────────────────────────
function showComplete(d) {
  const cs = $('complete-stats');
  const total    = d.total    ?? 0;
  const correct  = d.correct  ?? 0;
  const incorrect= d.incorrect?? 0;
  const acc = total > 0 ? Math.round((correct / total) * 100) : 0;
  const grade = acc >= 90 ? '🥇 Excellent' : acc >= 70 ? '🥈 Good' : acc >= 50 ? '🥉 Average' : '📈 Keep Practicing';

  // Set exercise header
  const exNameHeader = $('complete-ex-name');
  if (exNameHeader) exNameHeader.textContent = modeLabel(cfg.mode);

  cs.innerHTML = `
    <div class="cstat"><div class="cstat-val" style="color:var(--accent2)">${cfg.sets}</div><div class="cstat-lbl">Sets Done</div></div>
    <div class="cstat"><div class="cstat-val" style="color:var(--green)">${correct}</div><div class="cstat-lbl">Correct Reps</div></div>
    <div class="cstat"><div class="cstat-val" style="color:var(--orange)">${incorrect}</div><div class="cstat-lbl">Needs Work</div></div>
    <div class="cstat"><div class="cstat-val" style="color:var(--accent)">${acc}%</div><div class="cstat-lbl">${grade}</div></div>
  `;

  // Render clinical mistakes, line charts, and bar charts
  renderMistakesLog();
  drawAccuracyChart();
  drawROMChart();

  showScreen('complete');
}

// ── Medical Summary SVG Charting & Downloader Helpers ───────────
function renderMistakesLog() {
  const container = $('mistakes-container');
  if (!container) return;
  container.innerHTML = '';
  
  const mistakes = Object.entries(mistakesLog);
  if (mistakes.length === 0) {
    container.innerHTML = '<div class="mistake-placeholder">No posture errors recorded. Perfect form! 🌟</div>';
    return;
  }
  
  mistakes.forEach(([msg, count]) => {
    const card = document.createElement('div');
    card.className = 'mistake-card';
    card.innerHTML = `
      <span class="mistake-card-icon">⚠️</span>
      <div class="mistake-card-info">
        <span class="mistake-card-title">${msg}</span>
        <span class="mistake-card-count">Flagged ${count} time${count > 1 ? 's' : ''} during session</span>
      </div>
    `;
    container.appendChild(card);
  });
}

function drawAccuracyChart() {
  const wrap = $('accuracy-chart-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  
  if (accuracyHistory.length === 0) {
    wrap.innerHTML = '<span class="chart-no-data">Insufficient data for chart progression</span>';
    return;
  }
  
  const svgWidth = 360;
  const svgHeight = 110;
  const padding = 15;
  
  let pathD = '';
  let fillD = '';
  
  const pointsCount = accuracyHistory.length;
  const xStep = pointsCount > 1 ? (svgWidth - padding * 2) / (pointsCount - 1) : 0;
  
  accuracyHistory.forEach((acc, index) => {
    const x = padding + index * xStep;
    const y = svgHeight - padding - (acc / 100) * (svgHeight - padding * 2);
    
    if (index === 0) {
      pathD = `M ${x} ${y}`;
      fillD = `M ${x} ${svgHeight - padding} L ${x} ${y}`;
    } else {
      pathD += ` L ${x} ${y}`;
      fillD += ` L ${x} ${y}`;
    }
    
    if (index === pointsCount - 1) {
      fillD += ` L ${x} ${svgHeight - padding} Z`;
    }
  });
  
  if (pointsCount === 1) {
    const y = svgHeight - padding - (accuracyHistory[0] / 100) * (svgHeight - padding * 2);
    pathD = `M ${padding} ${y} L ${svgWidth - padding} ${y}`;
    fillD = `M ${padding} ${svgHeight - padding} L ${padding} ${y} L ${svgWidth - padding} ${y} L ${svgWidth - padding} ${svgHeight - padding} Z`;
  }
  
  const svgHTML = `
    <svg width="100%" height="100%" viewBox="0 0 ${svgWidth} ${svgHeight}" style="overflow:visible;">
      <defs>
        <linearGradient id="chartFillGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <!-- Grid lines -->
      <line x1="${padding}" y1="${padding}" x2="${svgWidth - padding}" y2="${padding}" class="svg-chart-grid" />
      <line x1="${padding}" y1="${svgHeight/2}" x2="${svgWidth - padding}" y2="${svgHeight/2}" class="svg-chart-grid" />
      <line x1="${padding}" y1="${svgHeight - padding}" x2="${svgWidth - padding}" y2="${svgHeight - padding}" class="svg-chart-grid" />
      
      <!-- Fill & Line -->
      <path d="${fillD}" class="svg-chart-fill" />
      <path d="${pathD}" class="svg-chart-path" />
      
      <!-- Dots -->
      ${accuracyHistory.map((acc, i) => {
        const x = padding + i * xStep;
        const y = svgHeight - padding - (acc / 100) * (svgHeight - padding * 2);
        return `<circle cx="${x}" cy="${y}" r="4.5" fill="var(--accent2)" stroke="var(--bg)" stroke-width="1.5" />`;
      }).join('')}
    </svg>
  `;
  wrap.innerHTML = svgHTML;
}

function drawROMChart() {
  const wrap = $('rom-chart-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  
  if (romHistory.length === 0) {
    wrap.innerHTML = '<span class="chart-no-data">Insufficient data for chart quality</span>';
    return;
  }
  
  const svgWidth = 360;
  const svgHeight = 110;
  const padding = 15;
  
  const barCount = romHistory.length;
  const spacing = 6;
  const barWidth = Math.max(8, (svgWidth - padding * 2) / barCount - spacing);
  
  const barsHTML = romHistory.map((rom, index) => {
    const x = padding + index * (barWidth + spacing);
    const barHeight = (rom / 100) * (svgHeight - padding * 2);
    const y = svgHeight - padding - barHeight;
    return `
      <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" class="svg-bar" />
      <text x="${x + barWidth/2}" y="${y - 4}" font-size="6.5" fill="var(--muted)" text-anchor="middle" font-weight="bold" font-family="var(--font)">${rom}%</text>
    `;
  }).join('');
  
  const svgHTML = `
    <svg width="100%" height="100%" viewBox="0 0 ${svgWidth} ${svgHeight}" style="overflow:visible;">
      <defs>
        <linearGradient id="barGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="var(--accent2)"/>
          <stop offset="100%" stop-color="var(--accent)"/>
        </linearGradient>
      </defs>
      <line x1="${padding}" y1="${padding}" x2="${svgWidth - padding}" y2="${padding}" class="svg-chart-grid" />
      <line x1="${padding}" y1="${svgHeight - padding}" x2="${svgWidth - padding}" y2="${svgHeight - padding}" class="svg-chart-grid" />
      
      ${barsHTML}
    </svg>
  `;
  wrap.innerHTML = svgHTML;
}

function downloadReport() {
  const total = lastRepCount;
  // Calculate correct reps
  const correct = accuracyHistory.length > 0 ? Math.round(accuracyHistory.length * (accuracyHistory[accuracyHistory.length - 1] / 100)) : 0;
  const incorrect = total - correct;
  const avgAcc = accuracyHistory.length > 0 ? Math.round(accuracyHistory.reduce((a, b) => a + b, 0) / accuracyHistory.length) : 0;
  const avgROM = romHistory.length > 0 ? Math.round(romHistory.reduce((a, b) => a + b, 0) / romHistory.length) : 0;
  const avgQuality = trackingQualityHistory.length > 0 ? Math.round(trackingQualityHistory.reduce((a, b) => a + b, 0) / trackingQualityHistory.length) : 100;
  
  let reportText = `==================================================\n`;
  reportText += `       PHYSIOAI CLINICAL PERFORMANCE REPORT       \n`;
  reportText += `==================================================\n\n`;
  reportText += `Date: ${new Date().toLocaleString()}\n`;
  reportText += `Exercise: ${modeLabel(cfg.mode)}\n`;
  reportText += `Sets Programmed: ${cfg.sets}\n`;
  reportText += `Reps Programmed per Set: ${cfg.reps}\n\n`;
  reportText += `--------------------------------------------------\n`;
  reportText += `SESSION PERFORMANCE SUMMARY\n`;
  reportText += `--------------------------------------------------\n`;
  reportText += `Total Repetitions Performed: ${total}\n`;
  reportText += `Correct Repetitions:         ${correct}\n`;
  reportText += `Incorrect Repetitions:       ${incorrect}\n`;
  reportText += `Average Accuracy Level:      ${avgAcc}%\n`;
  reportText += `Average Range of Motion:     ${avgROM}%\n`;
  reportText += `Average Camera Signal:       ${avgQuality}% (${avgQuality >= 90 ? 'Excellent' : avgQuality >= 70 ? 'Good' : 'Poor'})\n\n`;
  reportText += `--------------------------------------------------\n`;
  reportText += `POSTURE MISTAKE LOGS\n`;
  reportText += `--------------------------------------------------\n`;
  
  const mistakes = Object.entries(mistakesLog);
  if (mistakes.length === 0) {
    reportText += `No posture errors or joint deviations recorded.\nExcellent form maintained throughout the session!\n`;
  } else {
    mistakes.forEach(([msg, count]) => {
      reportText += `* [Flagged ${count}x] ${msg}\n`;
    });
  }
  
  reportText += `\n--------------------------------------------------\n`;
  reportText += `Rep-by-Rep Performance Profile\n`;
  reportText += `--------------------------------------------------\n`;
  accuracyHistory.forEach((acc, i) => {
    reportText += `Rep ${i+1}: Accuracy ${acc}%, Range of Motion ${romHistory[i]}%\n`;
  });
  
  reportText += `\n==================================================\n`;
  reportText += `Generated by PhysioAI Assistant. Medical reference.\n`;
  reportText += `==================================================\n`;
  
  const blob = new Blob([reportText], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `PhysioAI_Report_${modeLabel(cfg.mode).replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

$('btn-again').addEventListener('click', () => startSession());
$('btn-home').addEventListener('click', () => { sessionState = 'setup'; showScreen('setup'); });

// ── Helpers ────────────────────────────────────────────────────
function setFeedback(text, color, icon) {
  feedbackText.textContent = text;
  feedbackIcon.textContent = icon;
  feedbackBox.className = 'feedback-box' + (color !== 'default' ? ` fb-${color}` : '');
}

function flashRep(label) {
  repFlash.textContent = label;
  repFlash.style.animation = 'none';
  repFlash.offsetHeight; // reflow
  repFlash.style.animation = 'flash .7s ease forwards';
}

function updateRing(rep, target) {
  const circ = 314;
  const pct  = target > 0 ? Math.min(rep / target, 1) : 0;
  ringFill.style.strokeDashoffset = circ - pct * circ;
}

function updateAccRing(pct) {
  const circ = 251;
  accFill.style.strokeDashoffset = pct != null ? circ - (pct / 100) * circ : circ;
}

function buildSetDots(total, active) {
  setDots.innerHTML = '';
  for (let i = 1; i <= total; i++) {
    const d = document.createElement('div');
    d.className = 'set-dot' + (i < active ? ' done' : i === active ? ' active' : '');
    setDots.appendChild(d);
  }
}

function resetPhase() {
  // Deprecated phase elements, no actions required
}

function updatePhase(state) {
  // Deprecated phase elements, no actions required
}

function modeLabel(m) {
  return { SQUATS:'Squats', STS:'Sit to Stand', LUNGES:'Lunges', SHOULDER_ABD:'Shoulder Abduction' }[m] || m;
}

// ── Inject SVG gradient for ring ──────────────────────────────
(function injectGrad() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.id = 'svg-defs'; svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  svg.innerHTML = `<defs>
    <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#6c63ff"/>
      <stop offset="100%" stop-color="#00d9ff"/>
    </linearGradient>
  </defs>`;
  document.body.appendChild(svg);
  ringFill.setAttribute('stroke','url(#ringGrad)');
})();

// Socket connection camera state synchronization
socket.on('connect', () => {
  console.log('Socket.io connected to server, syncing camera state:', cameraEnabled);
  socket.emit('camera_toggle', { enabled: cameraEnabled });
});

// Init
if (videoFeed) videoFeed.style.display = 'none';

const setupToggle = $('btn-camera-toggle-setup');
const exToggle = $('btn-camera-toggle-ex');
if (setupToggle) setupToggle.addEventListener('click', () => toggleCamera());
if (exToggle) exToggle.addEventListener('click', () => toggleCamera());

const setupVoiceToggle = $('btn-voice-toggle-setup');
const exVoiceToggle = $('btn-voice-toggle-ex');
if (setupVoiceToggle) setupVoiceToggle.addEventListener('click', () => toggleVoice());
if (exVoiceToggle) exVoiceToggle.addEventListener('click', () => toggleVoice());

const downloadBtn = $('btn-download-report');
if (downloadBtn) downloadBtn.addEventListener('click', downloadReport);

updateCameraUI(cameraEnabled);
updateVoiceUI(voiceEnabled);
showScreen('setup');
