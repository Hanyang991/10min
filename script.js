// ════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════
const BASE = "/api";
let STATE = {
  playerId: null,
  playerName: "",
  stage: 1,
  score: 0,
  totalCorrect: 0,
  totalWrong: 0,
  event: null,
  theme: null,
  bgSchedule: [],
  iconSchedule: [],
  clockHighlightSchedule: [],
  clocks: [],           
  timer: null,          
  timeLeft: 10.00,
  running: false,
  stopped: false,
  currentH: 0, currentM: 0, currentS: 0,
  activeBg: null,
  activeIcons: [],      
  activeHighlight: null,
  iconElements: [],     
  startTime: null,      
  spacebarCount: 0,     

  // 확장 STATE
  clockColorSchedule: [],
  activeClockColor: null,
  effects: [],
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

// ════════════════════════════════════════════════════════════
// BOOT / LOGIN
// ════════════════════════════════════════════════════════════
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
    // fetch best
    await fetchBest();
    // begin stage 1
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
// STAGE LIFECYCLE
// ════════════════════════════════════════════════════════════
async function beginStage(stage) {
  STATE.stage = stage;
  STATE.running = false;
  STATE.stopped = false;
  STATE.timeLeft = 10.00;
  STATE.activeBg = null;
  STATE.activeIcons = [];
  STATE.activeHighlight = null;
  STATE.iconElements.forEach(el => el.remove());
  STATE.iconElements = [];
  STATE.spacebarCount = 0;  

  // reset UI
  hideResult();
  document.getElementById("stageVal").textContent = stage;
  document.getElementById("scoreVal").textContent = STATE.score;
  document.getElementById("timerVal").textContent = "10.00";
  document.getElementById("timerVal").classList.remove("danger");
  document.getElementById("btnStop").disabled = false;
  document.getElementById("btnNext").style.display = "none";
  document.getElementById("missionText").textContent = "로딩 중…";

  // reset bg
  document.body.style.background = "";

  // fetch event from backend
  try {
    const res = await fetch(BASE + "/new_event?stage=" + stage);
    const data = await res.json();
    STATE.event = data.event;
    STATE.theme = data.theme;
    STATE.bgSchedule = data.bg_schedule;
    STATE.iconSchedule = data.icon_schedule;
    STATE.clockHighlightSchedule = data.clock_highlight_schedule;
    STATE.clocks = data.clocks;  

    // apply theme bg
    document.body.style.background = data.theme.bg;
    document.documentElement.style.setProperty("--accent", data.theme.accent);
    document.documentElement.style.setProperty("--bg", data.theme.bg);

    // render mission
    renderMission(data.event.description);
    // render clocks
    renderClocks(data.clocks);
    // start countdown
    STATE.startTime = Date.now();
    STATE.running = true;
    startTimer();
  } catch(e) {
    document.getElementById("missionText").textContent = "백엔드 연결 오류 – app.py 실행 확인!";
  }
}

// ★ 수정됨: 실패 후 다시하기 시 초기화
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
// TIMER
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

    if (STATE.timeLeft <= 0) {
      clearInterval(STATE.timer);
      STATE.running = false;
      timeUp();
    }
  }, 40); 
}

function timeUp() {
  STATE.stopped = true;
  document.getElementById("btnStop").disabled = true;
  
  if (STATE.event && STATE.event.type === "spacebar_count") {
    const target = STATE.event.detail.target_count;
    if (STATE.spacebarCount === target) {
      STATE.totalCorrect++;
      showResult(true, "정답!", `정확히 ${target}번 눌렀습니다! 다음 단계로 가세요.`);
    } else {
      STATE.totalWrong++;
      showResult(false, "틀렸습니다!", `목표: ${target}번 / 실제: ${STATE.spacebarCount}번`);
      saveRecord();
    }
  } else {
    const answerText = getAnswerText(STATE.event);
    showResult(false, "시간이 지났습니다!", `조건이 충족되지 않았습니다.<br/><br/>💡 <strong>정답:</strong> ${answerText}`);
    STATE.totalWrong++;
    saveRecord();
  }
}

// ════════════════════════════════════════════════════════════
// SCHEDULE PROCESSING
// ════════════════════════════════════════════════════════════
let _bgIdx = 0, _iconIdx = 0, _hlIdx = 0;

function resetScheduleIdx() { _bgIdx = 0; _iconIdx = 0; _hlIdx = 0; }

function processSchedule(elapsed) {
  while (_bgIdx < STATE.bgSchedule.length && elapsed >= STATE.bgSchedule[_bgIdx].at) {
    STATE.activeBg = STATE.bgSchedule[_bgIdx].color;
    document.body.style.background = STATE.activeBg;
    _bgIdx++;
  }
  while (_iconIdx < STATE.iconSchedule.length && elapsed >= STATE.iconSchedule[_iconIdx].at) {
    spawnIcon(STATE.iconSchedule[_iconIdx]);
    _iconIdx++;
  }
  while (_hlIdx < STATE.clockHighlightSchedule.length && elapsed >= STATE.clockHighlightSchedule[_hlIdx].at) {
    STATE.activeHighlight = STATE.clockHighlightSchedule[_hlIdx].clock;
    highlightClock(STATE.activeHighlight);
    _hlIdx++;
  }
}

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

// ════════════════════════════════════════════════════════════
// CLOCKS RENDER & UPDATE
// ════════════════════════════════════════════════════════════
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
          각 열은 시·분·초의 십의 자리와 일의 자리<br/>
          켜진 비트 = 1, 꺼진 비트 = 0
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

  // Digital & Neon
  const dEl = document.getElementById("digitalClock");
  if (dEl) dEl.textContent = timeStr;
  const nEl = document.getElementById("neonClock");
  if (nEl) nEl.textContent = timeStr;

  // Analog
  updateAnalog(h, m, s, ms);
  // Binary
  updateBinary(h, m, s);
  // Flip
  updateFlip(h, m, s);
}

function updateAnalog(h, m, s, ms) {
  const sDeg = (s + ms/1000) * 6;
  const mDeg = (m + s/60) * 6;
  const hDeg = ((h % 12) + m/60) * 30;

  const setHand = (id, deg, len) => {
    const el = document.getElementById(id);
    if (!el) return;
    const rad = (deg - 90) * Math.PI / 180;
    const x2 = 50 + len * Math.cos(rad);
    const y2 = 50 + len * Math.sin(rad);
    el.setAttribute("x2", x2);
    el.setAttribute("y2", y2);
  };
  setHand("hourHand", hDeg, 22);
  setHand("minHand",  mDeg, 28);
  setHand("secHand",  sDeg, 32);
}

function updateBinary(h, m, s) {
  const el = document.getElementById("binaryClock");
  if (!el) return;
  const units = [
    Math.floor(h/10), h%10,
    Math.floor(m/10), m%10,
    Math.floor(s/10), s%10
  ];
  el.innerHTML = units.map((val, i) => {
    const bits = val.toString(2).padStart(4, "0");
    return `<div class="binary-col">${bits.split("").map(b => `<div class="bit ${b==="1"?"on":""}" ></div>`).join("")}</div>`;
  }).join("");
}

function updateFlip(h, m, s) {
  const el = document.getElementById("flipClock");
  if (!el) return;
  const pad = n => String(n).padStart(2,"0");
  const digits = (pad(h)+pad(m)+pad(s)).split("");
  el.innerHTML = digits.map((d, i) =>
    `<div class="flip-digit">${d}</div>${(i===1||i===3)? '<div class="flip-sep">:</div>':''}`
  ).join("");
}

// ════════════════════════════════════════════════════════════
// STOP BUTTON
// ════════════════════════════════════════════════════════════
async function onStop(e) {
  if (!STATE.running || STATE.stopped) return;
  const btn = document.getElementById("btnStop");
  const rect = btn.getBoundingClientRect();
  const ripple = document.createElement("span");
  ripple.className = "ripple";
  const size = Math.max(rect.width, rect.height);
  ripple.style.width = ripple.style.height = size + "px";
  ripple.style.left = (e.clientX - rect.left - size/2) + "px";
  ripple.style.top  = (e.clientY - rect.top  - size/2) + "px";
  btn.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600);

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
        spacebar_count: STATE.spacebarCount,
      })
    });
    const data = await res.json();
    if (data.correct) {
      STATE.totalCorrect++;
      showResult(true, "정답!", `스테이지 ${STATE.stage} 완료! 다음 단계로 가세요.`);
    } else {
      STATE.totalWrong++;
      const answerText = data.answer ? `<br/><br/>💡 <strong>정답:</strong> ${data.answer}` : '';
      showResult(false, "틀렸습니다!", `조건이 충족되지 않은 순간에 멈췄습니다.${answerText}<br/><br/>처음부터 다시 시작하세요.`);
      saveRecord();
    }
  } catch(e) {
    showResult(false, "연결 오류", "백엔드와 통신에 실패했습니다.");
  }
}

// ════════════════════════════════════════════════════════════
// RESULT UI (수정됨: 버튼 로직)
// ════════════════════════════════════════════════════════════
function getAnswerText(event) {
  if (!event) return "조건 충족 시";
  const etype = event.type;
  const detail = event.detail || {};
  if (etype === "specific_number") {
    const unitLabel = {"hour": "시", "minute": "분", "second": "초"}[detail.unit];
    return `${detail.target}${unitLabel}이 표시될 때`;
  } else if (etype === "matching_digits") {
    return `숫자 ${detail.digit}이 ${detail.count}개 연속으로 나타날 때`;
  } else if (etype === "palindrome") {
    return "시간이 회문(앞뒤 같은 숫자)일 때";
  } else if (etype === "digit_appears") {
    return `숫자 ${detail.target_digit}이 포함될 때`;
  } else if (etype === "no_digit") {
    return `숫자 ${detail.excluded_digit}이 없을 때`;
  } else if (etype === "sum_target") {
    return `숫자 합이 ${detail.target}일 때`;
  } else if (etype === "bg_color_change") {
    return `배경이 ${detail.target_color_name}일 때`;
  } else if (etype === "icon_appears") {
    return `${detail.target_icon} 아이콘이 나타날 때`;
  } else if (etype === "clock_type_match") {
    const labels = {"digital": "디지털", "analog": "아날로그", "binary": "바이너리", "flip": "플립", "neon": "네온"};
    return `${labels[detail.target_clock]} 시계가 빛날 때`;
  } else if (etype === "second_zero") {
    return "초가 00일 때";
  } else if (etype === "spacebar_count") {
    return `정확히 ${detail.target_count}번 눌렀을 때`;
  }
  return "조건 충족 시";
}

// ★ 수정됨: 성공/실패에 따른 버튼 표시 로직
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
    // 성공 시: 다음 버튼 O, 다시시도 버튼 X
    btnNext.style.display = "inline-block";
    btnRetry.style.display = "none";
  } else {
    // 실패 시: 다음 버튼 X, 다시시도 버튼 O (Stage 1 초기화)
    btnNext.style.display = "none";
    btnRetry.style.display = "inline-block";
    btnRetry.innerHTML = `처음부터 다시 (Stage 1) <span style="display: block; font-size: 0.7rem; opacity: 0.6; margin-top: 2px;">(SPACE)</span>`;
  }

  overlay.classList.add("show");
}

function hideResult() { document.getElementById("resultOverlay").classList.remove("show"); }

// ════════════════════════════════════════════════════════════
// SAVE / LEADERBOARD
// ════════════════════════════════════════════════════════════
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
        let rankCls = "";
        if (i === 0) rankCls = "gold";
        else if (i === 1) rankCls = "silver";
        else if (i === 2) rankCls = "bronze";
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

function goHomeFromLb() {
  closeLb();
  goHome();
}

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

// ════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════
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

const _origBegin = beginStage;
beginStage = async function(stage) {
  resetScheduleIdx();
  return _origBegin(stage);
};

function showSpacebarFeedback(text) {
  const existing = document.getElementById("spacebarCounter");
  if (existing) existing.remove();
  
  const counter = document.createElement("div");
  counter.id = "spacebarCounter";
  counter.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-family: 'Orbitron', sans-serif;
    font-size: 4rem;
    font-weight: 900;
    color: var(--accent);
    text-shadow: 0 0 30px var(--accent), 0 0 60px var(--accent);
    z-index: 999;
    pointer-events: none;
    animation: spacebarPulse 0.3s ease-out;
  `;
  counter.textContent = text || STATE.spacebarCount;
  document.body.appendChild(counter);
  
  setTimeout(() => counter.remove(), 300);
}

const style = document.createElement("style");
style.textContent = `
  @keyframes spacebarPulse {
    0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
    50% { transform: translate(-50%, -50%) scale(1.3); opacity: 1; }
    100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
  }
`;
document.head.appendChild(style);

</script>

<script>
// ============================================================
// 새 기능 추가 모듈 (INTEGRATED)
// ============================================================

window.applyEffects = function(effects) {
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
    }
    else if (eff.type === 'mirror') {
      document.querySelectorAll('.clock-card').forEach(c => {
        c.style.transform = 'scaleX(-1)';
      });
    }
    else if (eff.type === 'fake_clock') {
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
};

window.applyClockColor = function(color) {
  document.querySelectorAll('.clock-card').forEach(card => {
    card.style.borderColor = color;
    card.style.boxShadow = `0 0 25px ${color}, inset 0 0 30px ${color}20`;
  });
};

if (typeof _colorIdx === 'undefined') {
  window._colorIdx = 0;
}

const _origResetSchedule = window.resetScheduleIdx || function() {};
window.resetScheduleIdx = function() {
  _origResetSchedule();
  window._colorIdx = 0;
};

const _origProcessSchedule = window.processSchedule;
window.processSchedule = function(elapsed) {
  if (_origProcessSchedule) _origProcessSchedule(elapsed);
  
  while (window._colorIdx < STATE.clockColorSchedule.length && 
         elapsed >= STATE.clockColorSchedule[window._colorIdx].at) {
    STATE.activeClockColor = STATE.clockColorSchedule[window._colorIdx].color;
    window.applyClockColor(STATE.activeClockColor);
    window._colorIdx++;
  }
  
  if (STATE.event?.type === 'dont_click' && STATE.activeBg === '#e74c3c') {
    STATE.redAppeared = true;
  }
};

const _origUpdateClocks = window.updateClocks;
window.updateClocks = function() {
  if (_origUpdateClocks) _origUpdateClocks();
  
  const h = STATE.currentH;
  const m = STATE.currentM;
  const s = STATE.currentS;
  const pad = (n) => String(n).padStart(2, '0');
  
  const fakeEl = document.getElementById('fakeClock');
  if (fakeEl) {
    let fakeS = s + 1, fakeM = m, fakeH = h;
    if (fakeS >= 60) {
      fakeS = 0;
      fakeM++;
      if (fakeM >= 60) {
        fakeM = 0;
        fakeH = (fakeH + 1) % 24;
      }
    }
    fakeEl.textContent = `${pad(fakeH)}:${pad(fakeM)}:${pad(fakeS)}`;
  }
  
  if (STATE.event?.type === 'rapid_tap' && s === 0 && !STATE.rapidStarted) {
    STATE.rapidStarted = true;
    STATE.rapidTaps = [];
    STATE.rapidStartTime = Date.now();
  }
};

const _origBeginStage = window.beginStage;
window.beginStage = async function(stage) {
  STATE.rapidTaps = [];
  STATE.rapidStarted = false;
  STATE.pressStart = null;
  STATE.pressDuration = 0;
  STATE.redAppeared = false;
  STATE.rhythmTaps = [];
  STATE.blinkTimes = [];
  STATE.clockColorSchedule = [];
  STATE.activeClockColor = null;
  STATE.effects = [];
  
  await _origBeginStage(stage);
};

const _origFetch = window.fetch;
window.fetch = function(...args) {
  return _origFetch(...args).then(async (response) => {
    if (args[0]?.includes?.('/api/new_event')) {
      const clone = response.clone();
      const data = await clone.json();
      if (data) {
        STATE.clockColorSchedule = data.clock_color_schedule || [];
        STATE.effects = data.effects || [];
        if (window.applyEffects) {
          window.applyEffects(STATE.effects);
        }
      }
    }
    return response;
  });
};

const _origTimeUp = window.timeUp;
window.timeUp = function() {
  STATE.stopped = true;
  document.getElementById("btnStop").disabled = true;
  
  const evt = STATE.event;
  if (!evt) return _origTimeUp();
  
  if (evt.type === 'spacebar_count') {
    const target = evt.detail.target_count;
    if (STATE.spacebarCount === target) {
      STATE.totalCorrect++;
      showResult(true, "정답!", `정확히 ${target}번!`);
    } else {
      STATE.totalWrong++;
      showResult(false, "틀림!", `${target}번 vs ${STATE.spacebarCount}번`);
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
      showResult(false, "틀림!", `연타 ${STATE.rapidTaps.length}/5`);
      saveRecord();
    }
    return;
  }
  
  if (evt.type === 'dont_click') {
    if (!STATE.redAppeared) {
      STATE.totalWrong++;
      showResult(false, "틀림!", "빨간색 없었으면 눌렀어야!");
      saveRecord();
    } else {
      STATE.totalCorrect++;
      showResult(true, "정답!", "빨간색 나왔지만 안 눌렀음!");
    }
    return;
  }
  
  if (_origTimeUp) _origTimeUp();
};

const _origOnStop = window.onStop;
window.onStop = async function(event) {
  const btn = event?.target || document.getElementById("btnStop");
  if (!STATE.running || STATE.stopped) return;
  
  btn.classList.add("ripple");
  setTimeout(() => btn.classList.remove("ripple"), 600);
  
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
};

const _origGetAnswerText = window.getAnswerText;
window.getAnswerText = function(event) {
  const base = _origGetAnswerText ? _origGetAnswerText(event) : "";
  if (!event) return base;
  
  const etype = event.type;
  const detail = event.detail || {};
  
  const extras = {
    'sum_even': "숫자 합이 짝수",
    'sum_odd': "숫자 합이 홀수",
    'multiple_7': "초가 7의 배수",
    'prime_second': "초가 소수",
    'sandwich': "분==초",
    'ascending': "숫자 증가",
    'descending': "숫자 감소",
    'clock_color_match': `시계 ${detail.target_color_name}`,
    'rapid_tap': "1초에 5번 연타",
    'long_press': `${detail.target_second}초에 1초 꾹`,
    'dont_click': detail.will_appear_red ? "빨강 나오면 X" : "빨강 없으면 O",
    'rhythm_tap': "깜빡임 3번",
  };
  
  return extras[etype] || base;
};

setInterval(() => {
  if (STATE.running && STATE.event?.type === 'rhythm_tap') {
    const elapsed = (Date.now() - STATE.startTime) / 1000;
    STATE.blinkTimes.push(elapsed);
    document.querySelectorAll('.digital-clock, .neon-clock').forEach(c => {
      c.style.opacity = '0.3';
      setTimeout(() => c.style.opacity = '1', 100);
    });
  }
}, 1000);


function handleAction(e) {
  if (!STATE.running || STATE.stopped) return;

  // 이벤트 기본 동작 방지 (스크롤 등)
  if (e) e.preventDefault();

  // 1. 단순 스페이스바 카운트 미션일 때
  if (STATE.event?.type === 'spacebar_count') {
    STATE.spacebarCount++;
    showSpacebarFeedback();
    
    // 목표치 초과 시 즉시 실패 처리
    if (STATE.spacebarCount > STATE.event.detail.target_count) {
      STATE.running = false;
      STATE.stopped = true;
      clearInterval(STATE.timer);
      document.getElementById("btnStop").disabled = true;
      showResult(false, "실패!", "너무 많이 눌렀습니다!");
      STATE.totalWrong++;
      saveRecord();
    }
  } 
  // 2. 그 외 일반적인 STOP 조건일 때
  else if (STATE.event?.type !== 'dont_click') {
    // STOP 버튼 클릭 시뮬레이션
    onStop(); 
  }
}

document.addEventListener("pointerdown", (e) => {
  // 버튼이나 링크를 클릭한 게 아닐 때만 실행
  if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'A') {
    handleAction(e);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.key === " ") {
    e.preventDefault();
    
    // long_press 시작
    if (!e.repeat && STATE.running && STATE.event?.type === 'long_press') {
      STATE.pressStart = STATE.currentS;
      STATE.pressStartTime = Date.now();
    }
    
    // 게임 진행 중
    if (STATE.running && !STATE.stopped) {
      STATE.spacebarCount++;
      
      if (STATE.event?.type === 'rapid_tap' && STATE.rapidStarted) {
        const elapsed = (Date.now() - STATE.rapidStartTime) / 1000;
        if (elapsed <= 1.0) {
          STATE.rapidTaps.push(elapsed);
          showSpacebarFeedback(`${STATE.rapidTaps.length}/5`);
        }
        return;
      }
      
      if (STATE.event?.type === 'rhythm_tap') {
        const elapsed = (Date.now() - STATE.startTime) / 1000;
        STATE.rhythmTaps.push(elapsed);
        showSpacebarFeedback(`♪${STATE.rhythmTaps.length}/3`);
        return;
      }
      
      if (STATE.event?.type === 'spacebar_count') {
        showSpacebarFeedback();
        if (STATE.spacebarCount > STATE.event.detail.target_count) {
          STATE.running = false;
          STATE.stopped = true;
          clearInterval(STATE.timer);
          document.getElementById("btnStop").disabled = true;
          showResult(false, "실패!", "너무 많이 눌렀습니다!");
          STATE.totalWrong++;
          saveRecord();
        }
        return;
      }
      
      if (STATE.event?.type !== 'dont_click') {
        document.getElementById("btnStop").click();
      }
    }
    // 결과 화면에서 스페이스바 동작 (성공->다음, 실패->재시도)
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
