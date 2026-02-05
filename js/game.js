// ════════════════════════════════════════════════════════════
// GLOBAL STATE
// ════════════════════════════════════════════════════════════
const BASE = "/api";
let STATE = {
  // Player Data
  playerId: null,
  playerName: "",
  
  // Game Progress
  stage: 1,
  score: 0,
  totalCorrect: 0,
  totalWrong: 0,
  
  // Current Event Config
  event: null,
  theme: null,
  bgSchedule: [],
  iconSchedule: [],
  clockHighlightSchedule: [],
  clockColorSchedule: [], // from Extension
  clocks: [],
  effects: [],            // from Extension
  
  // Runtime State
  timer: null,
  timeLeft: 10.00,
  running: false,
  stopped: false,
  startTime: null,
  currentH: 0, currentM: 0, currentS: 0,
  
  // Active Visuals
  activeBg: null,
  activeIcons: [],
  activeHighlight: null,
  activeClockColor: null, // from Extension
  iconElements: [],
  
  // Input & Mechanics
  spacebarCount: 0,
  rapidTaps: [],
  rapidStarted: false,
  rapidStartTime: 0,
  pressStart: null,
  pressStartTime: 0,
  pressDuration: 0,
  redAppeared: false,
  rhythmTaps: [],
  blinkTimes: [],
};

// Internal schedule indices
let _bgIdx = 0, _iconIdx = 0, _hlIdx = 0, _colorIdx = 0;

// ════════════════════════════════════════════════════════════
// BOOT & LOGIN
// ════════════════════════════════════════════════════════════
// 파티클 생성 (즉시 실행)
(function spawnParticles() {
  for (let i = 0; i < 18; i++) {
    const p = document.createElement("div");
    p.className = "particle";
    const size = 4 + Math.random() * 10;
    p.style.width = p.style.height = size + "px";
    p.style.left = Math.random() * 100 + "vw";
    p.style.top  = Math.random() * 100 + "vh";
    p.style.background = `hsl(${180 + Math.random()*60}, 80%, 60%)`;
    p.style.animationDelay = Math.random() * 6 + "s";
    p.style.animationDuration = (6 + Math.random() * 5) + "s";
    document.body.appendChild(p);
  }
})();

function startGame() {
  document.getElementById("startScreen").classList.add("hidden");
  document.getElementById("loginOverlay").classList.remove("hidden");
  document.getElementById("nameInput").focus();
}

async function doLogin() {
  const name = document.getElementById("nameInput").value.trim();
  if (!name) return;
  try {
    const res = await fetch(BASE + "/register", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({name})
    });
    const data = await res.json();
    STATE.playerId = data.player_id;
    STATE.playerName = data.name;
    document.getElementById("playerName").textContent = data.name;
    document.getElementById("loginOverlay").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    
    await fetchBest();
    beginStage(1);
  } catch(e) {
    alert("백엔드 연결 실패. app.py를 실행해주세요.");
  }
}

async function fetchBest() {
  try {
    const res = await fetch(BASE + "/my_best?player_id=" + STATE.playerId);
    const data = await res.json();
    document.getElementById("bestStage").textContent = data.max_stage;
  } catch(e) {}
}

// ════════════════════════════════════════════════════════════
// STAGE CONTROL
// ════════════════════════════════════════════════════════════
async function beginStage(stage) {
  // 1. Reset State
  STATE.stage = stage;
  STATE.running = false;
  STATE.stopped = false;
  STATE.timeLeft = 10.00;
  
  // Visual Reset
  STATE.activeBg = null;
  STATE.activeIcons = [];
  STATE.activeHighlight = null;
  STATE.activeClockColor = null;
  STATE.iconElements.forEach(el => el.remove());
  STATE.iconElements = [];
  
  // Extension State Reset
  STATE.spacebarCount = 0;
  STATE.rapidTaps = [];
  STATE.rapidStarted = false;
  STATE.pressStart = null;
  STATE.pressDuration = 0;
  STATE.redAppeared = false;
  STATE.rhythmTaps = [];
  STATE.blinkTimes = [];
  STATE.clockColorSchedule = [];
  STATE.effects = [];
  
  // Reset Indices
  _bgIdx = 0; _iconIdx = 0; _hlIdx = 0; _colorIdx = 0;

  // 2. Reset UI
  hideResult();
  document.getElementById("stageVal").textContent = stage;
  document.getElementById("scoreVal").textContent = STATE.score;
  document.getElementById("timerVal").textContent = "10.00";
  document.getElementById("timerVal").classList.remove("danger");
  document.getElementById("btnStop").disabled = false;
  document.getElementById("btnNext").style.display = "none";
  document.getElementById("missionText").textContent = "로딩 중…";
  document.body.style.background = ""; // Clear BG

  // 3. Fetch New Event
  try {
    const res = await fetch(BASE + "/new_event?stage=" + stage);
    const data = await res.json();
    
    STATE.event = data.event;
    STATE.theme = data.theme;
    STATE.bgSchedule = data.bg_schedule || [];
    STATE.iconSchedule = data.icon_schedule || [];
    STATE.clockHighlightSchedule = data.clock_highlight_schedule || [];
    STATE.clockColorSchedule = data.clock_color_schedule || []; // Extension
    STATE.clocks = data.clocks || [];
    STATE.effects = data.effects || []; // Extension

    // Apply Theme
    document.body.style.background = data.theme.bg;
    document.documentElement.style.setProperty("--accent", data.theme.accent);
    document.documentElement.style.setProperty("--bg", data.theme.bg);

    // Render Logic
    renderMission(data.event.description);
    renderClocks(data.clocks);
    applyEffects(STATE.effects);

    // Start
    STATE.startTime = Date.now();
    STATE.running = true;
    startTimer();
  } catch(e) {
    console.error(e);
    document.getElementById("missionText").textContent = "오류 발생: 백엔드 연결 확인 필요";
  }
}

function retryStage() {
  hideResult();
  STATE.score = 0;
  STATE.totalCorrect = 0;
  STATE.totalWrong = 0;
  beginStage(1);
}

function nextStage() {
  hideResult();
  STATE.score += 1;
  beginStage(STATE.stage + 1);
}

// ════════════════════════════════════════════════════════════
// TIMER & SCHEDULE
// ════════════════════════════════════════════════════════════
function startTimer() {
  if (STATE.timer) clearInterval(STATE.timer);
  STATE.timer = setInterval(() => {
    if (!STATE.running) { clearInterval(STATE.timer); return; }
    
    const elapsed = (Date.now() - STATE.startTime) / 1000;
    STATE.timeLeft = Math.max(0, 10 - elapsed);
    document.getElementById("timerVal").textContent = STATE.timeLeft.toFixed(2);
    
    if (STATE.timeLeft <= 3) document.getElementById("timerVal").classList.add("danger");

    processSchedule(elapsed);
    updateClocks();
    
    // Rhythm Tap Helper (Extension)
    if (STATE.event?.type === 'rhythm_tap') {
      // 매초 깜빡임 효과 (1초 단위 체크)
      const sec = Math.floor(elapsed);
      const prevSec = Math.floor(elapsed - 0.04);
      if (sec > prevSec) {
        STATE.blinkTimes.push(elapsed);
        document.querySelectorAll('.digital-clock, .neon-clock').forEach(c => {
          c.style.opacity = '0.3';
          setTimeout(() => c.style.opacity = '1', 100);
        });
      }
    }

    if (STATE.timeLeft <= 0) {
      clearInterval(STATE.timer);
      STATE.running = false;
      timeUp();
    }
  }, 40);
}

function processSchedule(elapsed) {
  // 1. Background
  while (_bgIdx < STATE.bgSchedule.length && elapsed >= STATE.bgSchedule[_bgIdx].at) {
    STATE.activeBg = STATE.bgSchedule[_bgIdx].color;
    document.body.style.background = STATE.activeBg;
    _bgIdx++;
  }
  // 2. Icons
  while (_iconIdx < STATE.iconSchedule.length && elapsed >= STATE.iconSchedule[_iconIdx].at) {
    spawnIcon(STATE.iconSchedule[_iconIdx]);
    _iconIdx++;
  }
  // 3. Clock Highlight
  while (_hlIdx < STATE.clockHighlightSchedule.length && elapsed >= STATE.clockHighlightSchedule[_hlIdx].at) {
    STATE.activeHighlight = STATE.clockHighlightSchedule[_hlIdx].clock;
    highlightClock(STATE.activeHighlight);
    _hlIdx++;
  }
  // 4. Clock Border Color (Extension)
  while (_colorIdx < STATE.clockColorSchedule.length && elapsed >= STATE.clockColorSchedule[_colorIdx].at) {
    STATE.activeClockColor = STATE.clockColorSchedule[_colorIdx].color;
    applyClockColor(STATE.activeClockColor);
    _colorIdx++;
  }
  
  // Check for 'dont_click' red background condition
  if (STATE.event?.type === 'dont_click' && STATE.activeBg === '#e74c3c') {
    STATE.redAppeared = true;
  }
}

function timeUp() {
  STATE.stopped = true;
  document.getElementById("btnStop").disabled = true;
  
  const evt = STATE.event;
  if (!evt) return; // safety

  // Special Fail Conditions
  if (evt.type === 'spacebar_count') {
    const target = evt.detail.target_count;
    if (STATE.spacebarCount === target) {
      STATE.totalCorrect++;
      showResult(true, "정답!", `정확히 ${target}번!`);
    } else {
      STATE.totalWrong++;
      showResult(false, "실패", `목표: ${target} / 실제: ${STATE.spacebarCount}`);
      saveRecord();
    }
    return;
  }
  
  if (evt.type === 'rapid_tap') {
    if (STATE.rapidTaps.length === 5) {
      STATE.totalCorrect++;
      showResult(true, "정답!", "1초 안에 5번 연타 성공!");
    } else {
      STATE.totalWrong++;
      showResult(false, "실패", `연타 횟수 부족 (${STATE.rapidTaps.length}/5)`);
      saveRecord();
    }
    return;
  }
  
  if (evt.type === 'dont_click') {
    if (STATE.redAppeared) {
      STATE.totalCorrect++;
      showResult(true, "정답!", "빨간 화면에 속지 않았습니다!");
    } else {
      STATE.totalWrong++;
      showResult(false, "실패", "빨간 화면이 나오지 않았는데 안 눌렀습니다.");
      saveRecord();
    }
    return;
  }

  // Default Time Up
  const answerText = getAnswerText(STATE.event);
  showResult(false, "시간 초과", `조건이 충족되지 않았습니다.<br/><br/>💡 <strong>정답:</strong> ${answerText}`);
  STATE.totalWrong++;
  saveRecord();
}

// ════════════════════════════════════════════════════════════
// VISUALS & RENDERING
// ════════════════════════════════════════════════════════════
function spawnIcon(info) {
  const el = document.createElement("div");
  el.className = "float-icon";
  if (STATE.event && STATE.event.type === "icon_appears" && info.icon === STATE.event.detail.target_icon) {
    el.classList.add("target-icon");
  }
  el.textContent = info.icon;
  el.style.left = info.x + "%";
  el.style.top  = info.y + "%";
  document.body.appendChild(el);
  STATE.iconElements.push(el);
  STATE.activeIcons.push(info.icon);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 400);
    const idx = STATE.activeIcons.indexOf(info.icon);
    if (idx !== -1) STATE.activeIcons.splice(idx, 1);
  }, 4000);
}

function highlightClock(type) {
  document.querySelectorAll(".clock-card").forEach(c => c.classList.remove("highlighted"));
  const target = document.querySelector(`.clock-card[data-type="${type}"]`);
  if (target) target.classList.add("highlighted");
}

function applyClockColor(color) {
  document.querySelectorAll('.clock-card').forEach(card => {
    card.style.borderColor = color;
    card.style.boxShadow = `0 0 25px ${color}, inset 0 0 30px ${color}20`;
  });
}

function applyEffects(effects) {
  // Clear previous
  document.querySelectorAll('.clock-card').forEach(c => {
    c.style.filter = '';
    c.style.transform = '';
  });
  const fake = document.querySelector('.fake-clock');
  if (fake) fake.remove();

  effects.forEach(eff => {
    if (eff.type === 'fog') {
      document.querySelectorAll('.clock-card').forEach(c => {
        c.style.filter = 'blur(3px)';
        c.style.opacity = '0.6';
      });
    } else if (eff.type === 'mirror') {
      document.querySelectorAll('.clock-card').forEach(c => {
        c.style.transform = 'scaleX(-1)';
      });
    } else if (eff.type === 'fake_clock') {
      const grid = document.getElementById('clockGrid');
      const fakeCard = document.createElement('div');
      fakeCard.className = 'clock-card fake-clock';
      fakeCard.style.borderColor = '#ff6b6b';
      fakeCard.innerHTML = `
        <div class="clock-label">⚠️ FAKE (1초 빠름)</div>
        <div class="digital-clock" id="fakeClock" style="color: #ff6b6b;">00:00:00</div>
      `;
      grid.appendChild(fakeCard);
    }
  });
}

function renderMission(desc) {
  document.getElementById("missionText").innerHTML = desc.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function renderClocks(clockTypes) {
  const grid = document.getElementById("clockGrid");
  const clockTemplates = {
    digital: `
      <div class="clock-card" data-type="digital">
        <div class="clock-label">Digital</div>
        <div class="digital-clock" id="digitalClock">00:00:00</div>
      </div>`,
    analog: `
      <div class="clock-card" data-type="analog">
        <div class="clock-label">Analog</div>
        <svg class="analog-svg" id="analogClock" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="2"/>
          ${Array.from({length:12},(_,i)=>{
            const a=(i*30-90)*Math.PI/180;
            const x1=50+40*Math.cos(a), y1=50+40*Math.sin(a);
            const x2=50+44*Math.cos(a), y2=50+44*Math.sin(a);
            return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(255,255,255,0.25)" stroke-width="1.2"/>`;
          }).join("")}
          <line id="hourHand"  x1="50" y1="50" x2="50" y2="22" stroke="white"  stroke-width="2.5" stroke-linecap="round"/>
          <line id="minHand"   x1="50" y1="50" x2="50" y2="16" stroke="rgba(255,255,255,0.8)" stroke-width="1.8" stroke-linecap="round"/>
          <line id="secHand"   x1="50" y1="50" x2="50" y2="12" stroke="var(--accent2)" stroke-width="1" stroke-linecap="round"/>
          <circle cx="50" cy="50" r="2.5" fill="white"/>
        </svg>
      </div>`,
    binary: `
      <div class="clock-card" data-type="binary">
        <div class="clock-label">Binary</div>
        <div class="binary-grid" id="binaryClock"></div>
        <div style="font-size: 0.65rem; color: #666; margin-top: 8px; line-height: 1.3;">
          각 열은 시·분·초<br/>켜진 비트 = 1
        </div>
      </div>`,
    flip: `
      <div class="clock-card" data-type="flip">
        <div class="clock-label">Flip</div>
        <div class="flip-display" id="flipClock"></div>
      </div>`,
    neon: `
      <div class="clock-card" data-type="neon">
        <div class="clock-label">Neon</div>
        <div class="neon-clock" id="neonClock">00:00:00</div>
      </div>`
  };
  grid.innerHTML = clockTypes.map(type => clockTemplates[type] || '').join('');
}

function updateClocks() {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds(), ms = now.getMilliseconds();
  STATE.currentH = h; STATE.currentM = m; STATE.currentS = s;

  const pad = n => String(n).padStart(2,"0");
  const timeStr = `${pad(h)}:${pad(m)}:${pad(s)}`;

  // 1. Standard Clocks
  const dEl = document.getElementById("digitalClock");
  if (dEl) dEl.textContent = timeStr;
  const nEl = document.getElementById("neonClock");
  if (nEl) nEl.textContent = timeStr;

  // 2. Analog
  const sDeg = (s + ms/1000) * 6;
  const mDeg = (m + s/60) * 6;
  const hDeg = ((h % 12) + m/60) * 30;
  const setHand = (id, deg, len) => {
    const el = document.getElementById(id);
    if (!el) return;
    const rad = (deg - 90) * Math.PI / 180;
    el.setAttribute("x2", 50 + len * Math.cos(rad));
    el.setAttribute("y2", 50 + len * Math.sin(rad));
  };
  setHand("hourHand", hDeg, 22);
  setHand("minHand",  mDeg, 28);
  setHand("secHand",  sDeg, 32);

  // 3. Binary
  const binEl = document.getElementById("binaryClock");
  if (binEl) {
    const units = [Math.floor(h/10), h%10, Math.floor(m/10), m%10, Math.floor(s/10), s%10];
    binEl.innerHTML = units.map(val => {
      const bits = val.toString(2).padStart(4, "0");
      return `<div class="binary-col">${bits.split("").map(b => `<div class="bit ${b==="1"?"on":""}" ></div>`).join("")}</div>`;
    }).join("");
  }

  // 4. Flip
  const flipEl = document.getElementById("flipClock");
  if (flipEl) {
    const digits = (pad(h)+pad(m)+pad(s)).split("");
    flipEl.innerHTML = digits.map((d, i) =>
      `<div class="flip-digit">${d}</div>${(i===1||i===3)? '<div class="flip-sep">:</div>':''}`
    ).join("");
  }

  // 5. Fake Clock (Extension)
  const fakeEl = document.getElementById('fakeClock');
  if (fakeEl) {
    let fakeS = s + 1, fakeM = m, fakeH = h;
    if (fakeS >= 60) { fakeS = 0; fakeM++; }
    if (fakeM >= 60) { fakeM = 0; fakeH = (fakeH + 1) % 24; }
    fakeEl.textContent = `${pad(fakeH)}:${pad(fakeM)}:${pad(fakeS)}`;
  }
  
  // 6. Check Rapid Start (Extension)
  if (STATE.event?.type === 'rapid_tap' && s === 0 && !STATE.rapidStarted) {
    STATE.rapidStarted = true;
    STATE.rapidTaps = [];
    STATE.rapidStartTime = Date.now();
  }
}

// ════════════════════════════════════════════════════════════
// INTERACTIONS & STOP
// ════════════════════════════════════════════════════════════
async function onStop(e) {
  if (!STATE.running || STATE.stopped) return;
  
  // Ripple Effect
  const btn = document.getElementById("btnStop");
  btn.classList.add("ripple");
  setTimeout(() => btn.classList.remove("ripple"), 600);

  // Stop Logic
  STATE.running = false;
  STATE.stopped = true;
  clearInterval(STATE.timer);
  btn.disabled = true;

  const stoppedAt = (Date.now() - STATE.startTime) / 1000;

  try {
    const res = await fetch(BASE + "/verify", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        event: STATE.event,
        stopped_at: stoppedAt,
        current_time: { h: STATE.currentH, m: STATE.currentM, s: STATE.currentS },
        active_bg_color: STATE.activeBg,
        active_icons: STATE.activeIcons,
        active_highlight: STATE.activeHighlight,
        active_clock_color: STATE.activeClockColor,
        spacebar_count: STATE.spacebarCount,
        rapid_taps: STATE.rapidTaps,
        press_start: STATE.pressStart,
        press_duration: STATE.pressDuration,
        red_appeared: STATE.redAppeared,
        clicked: true,
        rhythm_taps: STATE.rhythmTaps,
        blink_times: STATE.blinkTimes,
      })
    });
    const data = await res.json();
    
    if (data.correct) {
      STATE.totalCorrect++;
      showResult(true, "정답!", `스테이지 ${STATE.stage} 완료!`);
    } else {
      STATE.totalWrong++;
      const answerText = data.answer || '';
      showResult(false, "틀림!", `💡 정답: ${answerText}`);
      saveRecord();
    }
  } catch(e) {
    showResult(false, "오류", "통신 실패");
  }
}

// Event Listeners (Merged)
function handleAction(e) {
  if (!STATE.running || STATE.stopped) return;
  if (e) e.preventDefault();

  // Spacebar Count Mission
  if (STATE.event?.type === 'spacebar_count') {
    STATE.spacebarCount++;
    showSpacebarFeedback();
    if (STATE.spacebarCount > STATE.event.detail.target_count) {
      failGame("너무 많이 눌렀습니다!");
    }
  } 
  // Dont Click Mission
  else if (STATE.event?.type === 'dont_click') {
    failGame("누르면 안 되는 미션입니다!");
  }
  // Normal Stop
  else {
    onStop();
  }
}

function failGame(msg) {
  STATE.running = false;
  STATE.stopped = true;
  clearInterval(STATE.timer);
  document.getElementById("btnStop").disabled = true;
  showResult(false, "실패!", msg);
  STATE.totalWrong++;
  saveRecord();
}

document.addEventListener("pointerdown", (e) => {
  if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'A') {
    handleAction(e);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.key === " ") {
    e.preventDefault();

    // 1. Long Press Start
    if (!e.repeat && STATE.running && STATE.event?.type === 'long_press') {
      STATE.pressStart = STATE.currentS;
      STATE.pressStartTime = Date.now();
    }

    // 2. In Game Actions
    if (STATE.running && !STATE.stopped) {
      // Rapid Tap
      if (STATE.event?.type === 'rapid_tap' && STATE.rapidStarted) {
        const elapsed = (Date.now() - STATE.rapidStartTime) / 1000;
        if (elapsed <= 1.0) {
          STATE.rapidTaps.push(elapsed);
          showSpacebarFeedback(`${STATE.rapidTaps.length}/5`);
        }
        return;
      }
      
      // Rhythm Tap
      if (STATE.event?.type === 'rhythm_tap') {
        const elapsed = (Date.now() - STATE.startTime) / 1000;
        STATE.rhythmTaps.push(elapsed);
        showSpacebarFeedback(`♪${STATE.rhythmTaps.length}/3`);
        return;
      }
      
      // Spacebar Count
      if (STATE.event?.type === 'spacebar_count') {
        STATE.spacebarCount++;
        showSpacebarFeedback();
        if (STATE.spacebarCount > STATE.event.detail.target_count) {
          failGame("너무 많이 눌렀습니다!");
        }
        return;
      }
      
      // Normal Click
      if (STATE.event?.type !== 'dont_click') {
        document.getElementById("btnStop").click();
      } else {
        failGame("누르면 안 되는 미션입니다!");
      }
    }
    // 3. Result Screen Actions
    else if (document.getElementById("resultOverlay").classList.contains("show")) {
      const nextBtn = document.getElementById("resultNext");
      if (nextBtn && nextBtn.style.display !== "none") {
        nextStage();
      } else {
        retryStage();
      }
    }
  }
});

document.addEventListener("keyup", (e) => {
  if (e.code === "Space" || e.key === " ") {
    if (STATE.running && STATE.event?.type === 'long_press') {
      STATE.pressDuration = (Date.now() - STATE.pressStartTime) / 1000;
      if (STATE.pressDuration >= STATE.event.detail.duration) {
        document.getElementById("btnStop").click();
      }
    }
  }
});

function showSpacebarFeedback(text) {
  const existing = document.getElementById("spacebarCounter");
  if (existing) existing.remove();
  
  const counter = document.createElement("div");
  counter.id = "spacebarCounter";
  counter.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    font-family: 'Orbitron', sans-serif; font-size: 4rem; font-weight: 900;
    color: var(--accent); text-shadow: 0 0 30px var(--accent), 0 0 60px var(--accent);
    z-index: 999; pointer-events: none; animation: spacebarPulse 0.3s ease-out;
  `;
  counter.textContent = text || STATE.spacebarCount;
  document.body.appendChild(counter);
  setTimeout(() => counter.remove(), 300);
}

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════
function getAnswerText(event) {
  if (!event) return "조건 충족 시";
  const etype = event.type;
  const detail = event.detail || {};

  const map = {
    "specific_number": `${detail.target}${{hour:"시",minute:"분",second:"초"}[detail.unit]}`,
    "matching_digits": `숫자 ${detail.digit}이 ${detail.count}개 연속`,
    "palindrome": "회문(앞뒤 같은 시간)",
    "digit_appears": `숫자 ${detail.target_digit} 포함`,
    "no_digit": `숫자 ${detail.excluded_digit} 없음`,
    "sum_target": `합이 ${detail.target}`,
    "bg_color_change": `배경 ${detail.target_color_name}`,
    "icon_appears": `아이콘 ${detail.target_icon}`,
    "clock_type_match": `${detail.target_clock} 시계 빛날 때`,
    "second_zero": "00초",
    "spacebar_count": `${detail.target_count}번 클릭`,
    "sum_even": "합이 짝수",
    "sum_odd": "합이 홀수",
    "multiple_7": "7의 배수",
    "prime_second": "소수(Prime Number)",
    "sandwich": "분 == 초",
    "ascending": "숫자 증가",
    "descending": "숫자 감소",
    "clock_color_match": `시계 ${detail.target_color_name}`,
    "rapid_tap": "1초에 5번 연타",
    "long_press": `${detail.target_second}초에 1초 꾹`,
    "dont_click": detail.will_appear_red ? "빨강 나오면 X" : "빨강 없으면 O",
    "rhythm_tap": "깜빡임 3번",
  };
  return map[etype] || "조건 충족 시";
}

function showResult(correct, title, desc) {
  const overlay = document.getElementById("resultOverlay");
  document.getElementById("resultEmoji").textContent = correct ? "🎉" : "😅";
  
  const titleEl = document.getElementById("resultTitle");
  titleEl.textContent = title;
  titleEl.className = "result-title " + (correct ? "correct" : "wrong");
  document.getElementById("resultDesc").innerHTML = desc;

  const btnNext = document.getElementById("resultNext");
  const btnRetry = document.getElementById("btnRetry");

  if (correct) {
    btnNext.style.display = "inline-block";
    btnRetry.style.display = "none";
  } else {
    btnNext.style.display = "none";
    btnRetry.style.display = "inline-block";
    btnRetry.innerHTML = `처음부터 다시 (Stage 1) <span style="display:block;font-size:0.7rem;opacity:0.6;margin-top:2px;">(SPACE)</span>`;
  }
  overlay.classList.add("show");
}

function hideResult() { document.getElementById("resultOverlay").classList.remove("show"); }

async function saveRecord() {
  try {
    await fetch(BASE + "/save_record", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        player_id: STATE.playerId,
        max_stage: STATE.stage,
        total_correct: STATE.totalCorrect,
        total_wrong: STATE.totalWrong,
      })
    });
    await fetchBest();
  } catch(e) {}
}

async function openLeaderboard() {
  hideResult();
  try {
    const res = await fetch(BASE + "/leaderboard");
    const rows = await res.json();
    const list = document.getElementById("lbList");
    if (rows.length === 0) {
      list.innerHTML = '<p style="color:#666;text-align:center;padding:20px;">기록이 없습니다</p>';
    } else {
      list.innerHTML = rows.map((r, i) => {
        let rankCls = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
        return `<div class="lb-row">
          <div class="lb-rank ${rankCls}">#${i+1}</div>
          <div class="lb-name">${r.name}</div>
          <div class="lb-stage">Stage ${r.max_stage}</div>
        </div>`;
      }).join("");
    }
    document.getElementById("lbOverlay").classList.add("show");
  } catch(e) { alert("백엔드 연결 실패"); }
}

function closeLb() { document.getElementById("lbOverlay").classList.remove("show"); }
function goHome() {
  hideResult();
  STATE.stage = 1; STATE.score = 0; STATE.totalCorrect = 0; STATE.totalWrong = 0;
  clearInterval(STATE.timer);
  STATE.running = false;
  document.getElementById("app").classList.add("hidden");
  document.getElementById("startScreen").classList.remove("hidden");
  document.body.style.background = "";
  document.documentElement.style.setProperty("--accent", "#00fff5");
  document.documentElement.style.setProperty("--bg", "#0f0f1a");
}