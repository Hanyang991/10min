from flask import Flask, jsonify, request, make_response, send_from_directory
import sqlite3, uuid, random
from datetime import datetime
import os
app = Flask(__name__)

# ─── CORS ─────────────────────────────────────────────────────
@app.after_request
def after_request(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp

@app.route("/api/<path:path>", methods=["OPTIONS"])
def options_handler(path):
    return "", 204

# ─── DB ──────────────────────────────────────────────────────────
DB_PATH = "/data"
DB = os.path.join(DB_PATH, "game.db")

def get_db():
    # /data 폴더가 없으면 생성 (권한 오류 방지)
    if not os.path.exists(DB_PATH):
        os.makedirs(DB_PATH)
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS players (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id TEXT,
            max_stage INTEGER DEFAULT 0,
            total_correct INTEGER DEFAULT 0,
            total_wrong INTEGER DEFAULT 0,
            played_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(player_id) REFERENCES players(id)
        );
    """)
    conn.commit()
    conn.close()

init_db()

# ─── CONSTANTS ───────────────────────────────────────────────────
CLOCK_TYPES = ["digital", "analog", "binary", "flip", "neon"]

# ─── 10초 안의 시각 기반 조건 생성 ──────────────────────────────────

def get_possible_times():
    """현재 시각 기준 2~10초 후의 모든 시각 반환"""
    """ hi """
    now = datetime.now()
    h, m, s = now.hour, now.minute, now.second
    
    possible_times = []
    for i in range(2, 11):  # 1~10초
        future_s = s + i
        future_m = m
        future_h = h
        if future_s >= 60:
            future_s -= 60
            future_m += 1
            if future_m >= 60:
                future_m -= 60
                future_h = (future_h + 1) % 24
        possible_times.append((future_h, future_m, future_s))
    
    return possible_times


def create_time_based_event(possible_times, stage):
    """10초 안의 실제 시각을 기반으로 조건 생성 (함정 로직 추가됨)"""
    
    # [기존 코드 1] 랜덤하게 시각 선택 및 조건 생성 (그대로 유지)
    target_time = random.choice(possible_times)
    h, m, s = target_time
    time_str = f"{h:02d}{m:02d}{s:02d}"
    digits = [int(d) for d in time_str]
    
    conditions = []
    
    # 1. 특정 숫자
    conditions.append(("specific_second", s))
    if random.random() < 0.2:
        conditions.append(("specific_minute", m))
    
    # 2. 연속 숫자
    max_run = 1
    for i in range(len(digits)):
        run = 1
        for j in range(i+1, len(digits)):
            if digits[i] == digits[j] and j == i + run:
                run += 1
            else:
                break
        max_run = max(max_run, run)
    if max_run >= 2:
        for i in range(len(digits) - max_run + 1):
            if all(digits[i] == digits[i+k] for k in range(max_run)):
                conditions.append(("matching", digits[i], max_run))
                break
    
    # 3~12. 나머지 조건들 (회문, 포함, 미포함, 합, 배수, 소수 등... 기존 코드 그대로)
    if time_str == time_str[::-1]: conditions.append(("palindrome",))
    
    unique_digits = list(set(digits))
    if unique_digits:
        digit = random.choice(unique_digits)
        conditions.append(("digit_in", digit))
        
    all_digits = set(range(10))
    absent = list(all_digits - set(digits))
    if absent:
        digit = random.choice(absent)
        # 미포함 로직은 원본의 'never_appears' 체크가 이미 강력한 함정 역할이므로 그대로 둠
        never_appears = all(digit not in [int(d) for d in f"{th:02d}{tm:02d}{ts:02d}"] for th, tm, ts in possible_times)
        if never_appears: conditions.append(("no_click_impossible", digit))
        else: conditions.append(("digit_not_in", digit))
            
    total = sum(digits)
    conditions.append(("sum", total))
    
    if s == 0: conditions.append(("second_zero",))
    
    if stage >= 5:
        if total % 2 == 0: conditions.append(("sum_even",))
        else: conditions.append(("sum_odd",))
        if s % 7 == 0 and s > 0: conditions.append(("multiple_7",))
        if is_prime(s): conditions.append(("prime",))
        if m == s: conditions.append(("sandwich",))
        if is_sequence_asc(digits): conditions.append(("ascending",))
        elif is_sequence_desc(digits): conditions.append(("descending",))

    if not conditions: return None
    
    cond = random.choice(conditions)

    # =========================================================================
    # [추가된 로직] 여기서 결정을 뒤집습니다 (함정 생성)
    # =========================================================================
    is_trap = False
    
    # no_click_impossible은 이미 함정이므로 건드리지 않음
    if cond[0] != "no_click_impossible":
        # 30% 확률로 정답 조건을 오답으로 변조
        if random.random() < 0.3:
            
            # 1) 초(Second) 변조
            if cond[0] == "specific_second":
                valid_secs = set(t[2] for t in possible_times)
                invalid_secs = list(set(range(60)) - valid_secs)
                if invalid_secs:
                    cond = ("specific_second", random.choice(invalid_secs))
                    is_trap = True
                    
            # 2) 분(Minute) 변조
            elif cond[0] == "specific_minute":
                valid_mins = set(t[1] for t in possible_times)
                invalid_mins = list(set(range(60)) - valid_mins)
                if invalid_mins:
                    cond = ("specific_minute", random.choice(invalid_mins))
                    is_trap = True
            
            # 3) 합(Sum) 변조
            elif cond[0] == "sum":
                valid_sums = set()
                for ph, pm, ps in possible_times:
                    valid_sums.add(sum([int(d) for d in f"{ph:02d}{pm:02d}{ps:02d}"]))
                
                # 가능한 합 범위 (0~54) 중 안 나오는 것 선택
                invalid_sums = list(set(range(55)) - valid_sums)
                if invalid_sums:
                    cond = ("sum", random.choice(invalid_sums))
                    is_trap = True
                    
            # 4) 숫자 포함(Digit In) 변조
            elif cond[0] == "digit_in":
                valid_digits = set()
                for ph, pm, ps in possible_times:
                    valid_digits.update([int(d) for d in f"{ph:02d}{pm:02d}{ps:02d}"])
                
                invalid_digits = list(set(range(10)) - valid_digits)
                if invalid_digits:
                    cond = ("digit_in", random.choice(invalid_digits))
                    is_trap = True

    # =========================================================================
    # [수정된 반환] is_trap 정보를 detail에 추가하여 반환
    # =========================================================================

    if cond[0] == "specific_second":
        return {
            "type": "specific_number",
            "description": f"시계에서 **{cond[1]}초**가 표시될 때 멈추세요!",
            "detail": {"target": cond[1], "unit": "second", "is_trap": is_trap}
        }
    elif cond[0] == "specific_minute":
        return {
            "type": "specific_number",
            "description": f"시계에서 **{cond[1]}분**이 표시될 때 멈추세요!",
            "detail": {"target": cond[1], "unit": "minute", "is_trap": is_trap}
        }
    elif cond[0] == "matching":
        # 연속 숫자는 변조가 복잡하므로 is_trap=False 고정 (혹은 위에서 처리 안함)
        return {
            "type": "matching_digits",
            "description": f"숫자 **{cond[1]}**이 **{cond[2]}개** 연속으로 나타날 때 멈추세요!",
            "detail": {"digit": cond[1], "count": cond[2], "is_trap": False}
        }
    elif cond[0] == "palindrome":
        return {
            "type": "palindrome",
            "description": "시간 표시가 **회문(앞뒤로 읽어도 같은 숫자)**이 될 때 멈추세요!",
            "detail": {"is_trap": False} # 회문은 변조 어려움
        }
    elif cond[0] == "digit_in":
        return {
            "type": "digit_appears",
            "description": f"시간 표시에 숫자 **{cond[1]}**이 포함될 때 멈추세요!",
            "detail": {"target_digit": cond[1], "is_trap": is_trap}
        }
    elif cond[0] == "digit_not_in":
        return {
            "type": "no_digit",
            "description": f"시간 표시에 숫자 **{cond[1]}**이 없을 때 멈추세요!",
            "detail": {"excluded_digit": cond[1], "is_trap": False}
        }
    elif cond[0] == "no_click_impossible":
        return {
            "type": "no_click",
            "description": f"⚠️ 10초 동안 숫자 **{cond[1]}**이 나타나지 않습니다. **멈추지 마세요!**",
            "detail": {"impossible_digit": cond[1], "is_trap": True} # 이건 원래 함정
        }
    elif cond[0] == "sum":
        return {
            "type": "sum_target",
            "description": f"시간 숫자들의 **합이 {cond[1]}**이 될 때 멈추세요!",
            "detail": {"target": cond[1], "is_trap": is_trap}
        }
    elif cond[0] == "second_zero":
        return {
            "type": "second_zero",
            "description": "시계의 **초(秒)가 00**이 될 때 멈추세요!",
            "detail": {"is_trap": False}
        }
    
    # 고급 조건들은 변조 로직을 추가하지 않았으므로 is_trap=False로 반환
    # (필요하다면 위쪽 is_trap 로직에 추가 가능)
    elif cond[0] == "sum_even":
        return {"type": "sum_even", "description": "합이 짝수일 때 멈추세요!", "detail": {"is_trap": False}}
    elif cond[0] == "sum_odd":
        return {"type": "sum_odd", "description": "합이 홀수일 때 멈추세요!", "detail": {"is_trap": False}}
    elif cond[0] == "multiple_7":
        return {"type": "multiple_7", "description": "초가 7의 배수일 때 멈추세요!", "detail": {"is_trap": False}}
    elif cond[0] == "prime":
        return {"type": "prime_second", "description": "초가 소수일 때 멈추세요!", "detail": {"is_trap": False}}
    elif cond[0] == "sandwich":
        return {"type": "sandwich", "description": "분과 초가 같을 때 멈추세요!", "detail": {"is_trap": False}}
    elif cond[0] == "ascending":
        return {"type": "ascending", "description": "숫자가 연속 증가할 때 멈추세요!", "detail": {"is_trap": False}}
    elif cond[0] == "descending":
        return {"type": "descending", "description": "숫자가 연속 감소할 때 멈추세요!", "detail": {"is_trap": False}}
    
    return None

def is_prime(n):
    """소수 판별"""
    if n < 2:
        return False
    if n == 2:
        return True
    if n % 2 == 0:
        return False
    for i in range(3, int(n**0.5) + 1, 2):
        if n % i == 0:
            return False
    return True


def is_sequence_asc(digits):
    """연속 증가 체크 (최소 3개)"""
    count = 1
    for i in range(1, len(digits)):
        if digits[i] == digits[i-1] + 1:
            count += 1
            if count >= 3:
                return True
        else:
            count = 1
    return False


def is_sequence_desc(digits):
    """연속 감소 체크 (최소 3개)"""
    count = 1
    for i in range(1, len(digits)):
        if digits[i] == digits[i-1] - 1:
            count += 1
            if count >= 3:
                return True
        else:
            count = 1
    return False


def create_non_time_event(stage):
    """시각과 무관한 조건 생성"""
    event_types = ["bg_color", "icon", "clock_hl", "spacebar"]
    
    # 스테이지 10+ 에서 시계 색상 조건 추가
    if stage >= 10:
        event_types.append("clock_color")
    
    # 스테이지 15+ 에서 피지컬 조건 추가
    if stage >= 15:
        event_types.extend(["rapid_tap", "long_press", "dont_click", "rhythm"])
    
    etype = random.choice(event_types)
    
    if etype == "bg_color":
        colors = {
            "빨간색": "#e74c3c", "파란색": "#3498db", "초록색": "#2ecc71",
            "노란색": "#f1c40f", "보라색": "#9b59b6", "주황색": "#e67e22"
        }
        name, hex_val = random.choice(list(colors.items()))
        return {
            "type": "bg_color_change",
            "description": f"배경이 **{name}**으로 바뀌면 멈추세요!",
            "detail": {"target_color_name": name, "target_color_hex": hex_val}
        }
    
    elif etype == "icon":
        icons = ["⭐", "🔥", "💎", "🌙", "❄️", "🍎", "🌈", "⚡", "🎯", "🦋"]
        icon = random.choice(icons)
        return {
            "type": "icon_appears",
            "description": f"화면에 **{icon}** 가 나타나면 멈추세요!",
            "detail": {"target_icon": icon, "all_icons": icons}
        }
    
    elif etype == "clock_hl":
        clock = random.choice(CLOCK_TYPES)
        labels = {"digital": "디지털", "analog": "아날로그", "binary": "바이너리", "flip": "플립", "neon": "네온"}
        return {
            "type": "clock_type_match",
            "description": f"**{labels[clock]}** 시계가 빛나는 순간 멈추세요!",
            "detail": {"target_clock": clock}
        }
    
    elif etype == "clock_color":
        colors = {
            "빨간색": "#e74c3c", "파란색": "#3498db", "초록색": "#2ecc71",
            "노란색": "#f1c40f", "보라색": "#9b59b6"
        }
        name, hex_val = random.choice(list(colors.items()))
        return {
            "type": "clock_color_match",
            "description": f"시계가 **{name}**으로 빛날 때 멈추세요!",
            "detail": {"target_color_name": name, "target_color_hex": hex_val}
        }
    
    elif etype == "spacebar":
        # 스테이지에 따라 횟수 증가
        if stage < 5:
            count = random.randint(3, 10)
        elif stage < 10:
            count = random.randint(10, 30)
        elif stage < 15:
            count = random.randint(20, 40)
        else:
            count = random.randint(40, 60)
        
        return {
            "type": "spacebar_count",
            "description": f"스페이스바를 정확히 **{count}번** 누르세요!",
            "detail": {"target_count": count}
        }
    
    # === 피지컬 조건들 ===
    
    elif etype == "rapid_tap":
        # 초=00 순간부터 1초 안에 5번 연타
        return {
            "type": "rapid_tap",
            "description": "**초가 00**이 되는 순간부터 **2초 안에 스페이스바 5번 연타**하세요!",
            "detail": {"target_second": 0, "duration": 2.0, "tap_count": 5}
        }
    
    elif etype == "long_press":
        # 10의 배수일 때 1초 동안 길게 누르기
        multiples = [10, 20, 30, 40, 50]
        target = random.choice(multiples)
        return {
            "type": "long_press",
            "description": f"**초가 {target}**일 때 스페이스바를 **1초 동안 꾹** 누르고 있으세요!",
            "detail": {"target_second": target, "duration": 1.0}
        }
    
    elif etype == "dont_click":
        # 빨간색이 나오지 않으면 마지막에 누르기
        return {
            "type": "dont_click",
            "description": "10초 동안 **빨간색 배경이 나오지 않으면** 마지막에 누르세요! (나오면 누르지 마세요)",
            "detail": {"forbidden_color": "#e74c3c"}
        }
    
    elif etype == "rhythm":
        # 콜론 깜빡임에 맞춰 3번 연속
        return {
            "type": "rhythm_tap",
            "description": "시계의 **콜론(:) 깜빡임에 맞춰** 스페이스바를 **3번 연속** 누르세요!",
            "detail": {"tap_count": 3, "tolerance": 0.3}  # ±0.3초 허용
        }
    
    return None


# ─── ROUTES ──────────────────────────────────────────────────────

@app.route('/')
def serve_index():
    # 현재 실행 경로('.')에서 index.html 파일을 찾아 전송합니다.
    return send_from_directory('.', 'index.html')


@app.route("/api/register", methods=["POST"])
def register():
    data = request.get_json()
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "이름을 입력해주세요"}), 400
    pid = str(uuid.uuid4())[:12]
    conn = get_db()
    conn.execute("INSERT INTO players (id, name) VALUES (?,?)", (pid, name))
    conn.commit()
    conn.close()
    return jsonify({"player_id": pid, "name": name})


@app.route("/api/new_event", methods=["GET"])
def new_event():
    """스테이지마다 랜덤 이벤트 생성"""
    stage = int(request.args.get("stage", 1))
    
    # 스테이지별 시계 개수
    num_clocks = min(5, 1 + (stage - 1) // 5)
    
    # 바이너리 시계는 스테이지 10부터
    available_clocks = CLOCK_TYPES.copy()
    if stage < 10:
        available_clocks = [c for c in available_clocks if c != "binary"]
    
    selected_clocks = random.sample(available_clocks, min(num_clocks, len(available_clocks)))
    
    # 숫자 표시 시계가 있는지 확인
    has_digital = any(c in selected_clocks for c in ["digital", "binary", "flip", "neon"])
    
    # 이벤트 생성
    if has_digital and random.random() < 0.7:  # 70% 확률로 시각 기반 조건
        possible_times = get_possible_times()
        evt = create_time_based_event(possible_times, stage)
        if not evt:  # 생성 실패 시 fallback
            evt = create_non_time_event(stage)
    else:
        evt = create_non_time_event(stage)
    
    # 테마
    themes = [
        {"bg": "#0f0f1a", "accent": "#00fff5", "name": "dark_cyber"},
        {"bg": "#1a0a2e", "accent": "#e94560", "name": "neon_night"},
        {"bg": "#0d1117", "accent": "#58a6ff", "name": "github_dark"},
        {"bg": "#1b1b2f", "accent": "#f0a500", "name": "amber_dark"},
        {"bg": "#162447", "accent": "#e94560", "name": "deep_navy"},
        {"bg": "#1e3a5f", "accent": "#00d2ff", "name": "ocean_deep"},
    ]
    theme = random.choice(themes)
    
    # 스케줄 생성
    bg_schedule = []
    icon_schedule = []
    icons = ["⭐", "🔥", "💎", "🌙", "❄️", "🍎", "🌈", "⚡", "🎯", "🦋"]
    
    if evt["type"] == "bg_color_change":
        target_color = evt["detail"]["target_color_hex"]
        change_count = random.randint(3, 5) # 총 변경 횟수
        min_dist = 1.2  # 각 색상 간의 최소 간격 (초 단위, 취향껏 조절하세요)
        
        # 1. 서로 겹치지 않는 시간대(슬롯)를 먼저 생성
        scheduled_times = []
        attempts = 0
        while len(scheduled_times) < change_count and attempts < 100:
            new_at = round(random.uniform(0.5, 9.0), 2)
            # 기존에 선택된 시간들과 최소 간격(min_dist) 이상 떨어져 있는지 확인
            if all(abs(new_at - t) >= min_dist for t in scheduled_times):
                scheduled_times.append(new_at)
            attempts += 1
        
        # 시간 순서대로 정렬
        scheduled_times.sort()
        
        # 2. 생성된 시간 슬롯 중 하나를 랜덤하게 골라 정답 색상 위치로 지정
        target_time_idx = random.randint(0, len(scheduled_times) - 1)
        
        # 3. 시간표(bg_schedule)에 색상 할당
        for i, at in enumerate(scheduled_times):
            if i == target_time_idx:
                # 정답 색상 배치
                bg_schedule.append({"at": at, "color": target_color})
            else:
                # 가짜 색상들 중 하나 골라 배치
                other = [c for c in ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6", "#e67e22"] if c != target_color]
                bg_schedule.append({"at": at, "color": random.choice(other)})
                
        # 혹시 모를 순서 꼬임 방지를 위한 최종 정렬
        bg_schedule.sort(key=lambda x: x["at"])
    
    if evt["type"] == "icon_appears":
        target_icon = evt["detail"]["target_icon"]
        icon_count = random.randint(4, 8)
        icon_schedule.append({"at": round(random.uniform(2.0, 8.0), 2), "icon": target_icon, "x": random.randint(5, 95), "y": random.randint(10, 85)})
        for _ in range(icon_count - 1):
            icon_schedule.append({"at": round(random.uniform(0.3, 9.7), 2), "icon": random.choice(icons), "x": random.randint(5, 95), "y": random.randint(10, 85)})
        icon_schedule.sort(key=lambda x: x["at"])
    
    # 시계 강조 스케줄
    clock_hl_schedule = []
    clock_color_schedule = []  # 시계 색상 스케줄
    hl_count = random.randint(3, 6)
    
    if evt["type"] == "clock_type_match":
        target = evt["detail"]["target_clock"]
        if target not in selected_clocks:
            selected_clocks[random.randint(0, len(selected_clocks)-1)] = target
        clock_hl_schedule.append({"at": round(random.uniform(2.0, 8.0), 2), "clock": target})
        for _ in range(hl_count - 1):
            clock_hl_schedule.append({"at": round(random.uniform(0.5, 9.5), 2), "clock": random.choice(selected_clocks)})
    elif evt["type"] == "clock_color_match":
        # 시계 색상 조건
        target_color = evt["detail"]["target_color_hex"]
        colors = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6"]
        color_count = random.randint(3, 6)
        clock_color_schedule.append({"at": round(random.uniform(2.0, 8.0), 2), "color": target_color})
        for _ in range(color_count - 1):
            other_colors = [c for c in colors if c != target_color]
            clock_color_schedule.append({"at": round(random.uniform(0.5, 9.5), 2), "color": random.choice(other_colors)})
        clock_color_schedule.sort(key=lambda x: x["at"])
        # 일반 시계 강조도 진행
        for _ in range(hl_count):
            clock_hl_schedule.append({"at": round(random.uniform(0.5, 9.5), 2), "clock": random.choice(selected_clocks)})
    else:
        for _ in range(hl_count):
            clock_hl_schedule.append({"at": round(random.uniform(0.5, 9.5), 2), "clock": random.choice(selected_clocks)})
    clock_hl_schedule.sort(key=lambda x: x["at"])
    
    # === 연출 효과 (스테이지별) ===
    effects = []
    
    # 스테이지 7+ : 안개 효과
    if stage >= 7 and random.random() < 0.3:  # 30% 확률
        effects.append({"type": "fog", "opacity": 0.4})
    
    # 스테이지 12+ : 거울 모드
    if stage >= 12 and random.random() < 0.2:  # 20% 확률
        effects.append({"type": "mirror"})
    
    # 스테이지 18+ : 가짜 시계
    if stage >= 18 and random.random() < 0.25:  # 25% 확률
        effects.append({"type": "fake_clock", "offset": 1})  # 1초 빠른 시계
    
    # dont_click 조건일 때는 특별 배경 스케줄 생성
    if evt["type"] == "dont_click":
        # 빨간색이 나올지 말지 랜덤 결정
        will_appear = random.random() < 0.5  # 50%
        if will_appear:
            # 빨간색 등장 (누르면 안 됨)
            appear_at = round(random.uniform(2.0, 8.0), 2)
            bg_schedule = [{"at": appear_at, "color": "#e74c3c"}]
        else:
            # 빨간색 안 나옴 (마지막에 눌러야 함)
            bg_schedule = []
        evt["detail"]["will_appear_red"] = will_appear
    
    return jsonify({
        "stage": stage,
        "event": evt,
        "theme": theme,
        "clocks": selected_clocks,
        "bg_schedule": bg_schedule,
        "icon_schedule": icon_schedule,
        "clock_highlight_schedule": clock_hl_schedule,
        "clock_color_schedule": clock_color_schedule,
        "effects": effects,  # 연출 효과
    })


@app.route("/api/verify", methods=["POST"])
def verify():
    data = request.get_json()
    event = data.get("event", {})
    current_time = data.get("current_time", {})
    active_bg_color = data.get("active_bg_color")
    active_icons = data.get("active_icons", [])
    active_highlight = data.get("active_highlight")
    active_clock_color = data.get("active_clock_color")
    spacebar_count = data.get("spacebar_count", 0)
    
    etype = event.get("type")
    detail = event.get("detail", {})
    h, m, s = current_time.get("h", 0), current_time.get("m", 0), current_time.get("s", 0)
    
    correct = False
    digits = [int(d) for d in f"{h:02d}{m:02d}{s:02d}"]
    expected_time = None  # 정답 시각
    
    if etype == "specific_number":
        unit = detail["unit"]
        target = detail["target"]
        val = {"hour": h, "minute": m, "second": s}[unit]
        correct = (val == target)
        if not correct:
            # 정답 시각 생성
            if unit == "second":
                expected_time = f"{h:02d}:{m:02d}:{target:02d}"
            elif unit == "minute":
                expected_time = f"{h:02d}:{target:02d}:{s:02d}"
            elif unit == "hour":
                expected_time = f"{target:02d}:{m:02d}:{s:02d}"
    
    elif etype == "matching_digits":
        target_d = detail["digit"]
        count = detail["count"]
        run = 0
        for d in digits:
            if d == target_d:
                run += 1
                if run >= count:
                    correct = True
                    break
            else:
                run = 0
        if not correct:
            # 예시 시각 생성 - 명확하게 연속 표시
            if count == 2:
                # 초 자리에 연속 2개
                ss = min(int(f"{target_d}{target_d}"), 59)
                expected_time = f"{h:02d}:{m:02d}:{ss:02d} (예시)"
            elif count == 3:
                # 분초 자리에 연속 3개
                mm = min(int(f"{target_d}{target_d}"), 59)
                ss = min(int(f"{target_d}{(s % 10)}"), 59)
                expected_time = f"{h:02d}:{mm:02d}:{ss:02d} (예시)"
            else:
                expected_time = f"연속 {count}개 필요 (예시)"
    
    elif etype == "palindrome":
        s_str = f"{h:02d}{m:02d}{s:02d}"
        correct = (s_str == s_str[::-1])
        if not correct:
            # 가장 가까운 회문 시각 예시
            expected_time = "12:21:21 (예시)"
    
    elif etype == "digit_appears":
        correct = (detail["target_digit"] in digits)
        if not correct:
            # 해당 숫자 포함 예시
            td = detail["target_digit"]
            # 초 자리에 타겟 숫자 (유효 범위 보장)
            ss_str = f"{td}{(s % 10):01d}"
            ss = min(int(ss_str), 59)
            expected_time = f"{h:02d}:{m:02d}:{ss:02d} (예시)"
    
    elif etype == "no_digit":
        correct = (detail["excluded_digit"] not in digits)
        if not correct:
            # 해당 숫자 없는 예시
            excluded = detail["excluded_digit"]
            # 제외된 숫자가 아닌 다른 숫자들로만 구성
            safe_digits = [d for d in range(10) if d != excluded]
            if safe_digits:
                # 간단한 예시: 같은 숫자 반복
                sample = safe_digits[0]
                hh = min(sample * 10 + sample, 23)
                mm = min(sample * 10 + sample, 59)
                ss = min(sample * 10 + sample, 59)
                expected_time = f"{hh:02d}:{mm:02d}:{ss:02d} (예시)"
    
    elif etype == "no_click":
        # 불가능 조건 - 누르지 않았어야 함
        clicked = data.get("clicked", True)
        correct = not clicked
    
    elif etype == "sum_target":
        correct = (sum(digits) == detail["target"])
        if not correct:
            expected_time = f"합={detail['target']} 예: 03:14:25 (3+1+4+2+5={detail['target']})"
    
    elif etype == "sum_even":
        correct = (sum(digits) % 2 == 0)
        if not correct:
            expected_time = "합=짝수 예: 12:34:56 (1+2+3+4+5+6=21 홀수) → 12:34:52 (짝수)"
    
    elif etype == "sum_odd":
        correct = (sum(digits) % 2 == 1)
        if not correct:
            expected_time = "합=홀수 예: 12:34:52 (짝수) → 12:34:56 (1+2+3+4+5+6=21 홀수)"
    
    elif etype == "multiple_7":
        correct = (s % 7 == 0 and s > 0)
        if not correct:
            next_7 = ((s // 7) + 1) * 7
            if next_7 < 60:
                expected_time = f"{h:02d}:{m:02d}:{next_7:02d}"
            else:
                expected_time = f"{h:02d}:{(m+1)%60:02d}:07"
    
    elif etype == "prime_second":
        correct = is_prime(s)
        if not correct:
            primes = [2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59]
            next_prime = next((p for p in primes if p > s), primes[0])
            if next_prime < 60:
                expected_time = f"{h:02d}:{m:02d}:{next_prime:02d}"
            else:
                expected_time = f"{h:02d}:{(m+1)%60:02d}:02"
    
    elif etype == "sandwich":
        correct = (m == s)
        if not correct:
            expected_time = f"{h:02d}:{s:02d}:{s:02d}"
    
    elif etype == "ascending":
        correct = is_sequence_asc(digits)
        if not correct:
            expected_time = "예: 12:34:56 (연속 증가)"
    
    elif etype == "descending":
        correct = is_sequence_desc(digits)
        if not correct:
            expected_time = "예: 10:09:08 (연속 감소)"
    
    elif etype == "bg_color_change":
        correct = (active_bg_color == detail["target_color_hex"])
    
    elif etype == "icon_appears":
        correct = (detail["target_icon"] in active_icons)
    
    elif etype == "clock_type_match":
        correct = (active_highlight == detail["target_clock"])
    
    elif etype == "clock_color_match":
        correct = (active_clock_color == detail["target_color_hex"])
    
    elif etype == "second_zero":
        correct = (s == 0)
    
    elif etype == "spacebar_count":
        correct = (spacebar_count == detail["target_count"])
    
    # === 피지컬 조건들 ===
    
    elif etype == "rapid_tap":
        # 초=00 이후 1초 안에 5번 연타 확인
        rapid_taps = data.get("rapid_taps", [])  # 탭 타임스탬프 리스트
        target_s = detail["target_second"]
        duration = detail["duration"]
        required_count = detail["tap_count"]
        
        # 초=00이 된 시점 이후의 탭만 카운트
        if s == target_s or (s == target_s + 1 and len(rapid_taps) > 0):
            # 1초 이내에 5번 눌렀는지 확인
            valid_taps = [t for t in rapid_taps if 0 <= t <= duration]
            correct = (len(valid_taps) >= required_count)
        else:
            correct = False
    
    elif etype == "long_press":
        # 특정 초에 1초 동안 길게 누르기
        press_start = data.get("press_start")  # 누르기 시작 시각의 초
        press_duration = data.get("press_duration", 0)  # 누른 시간
        target_s = detail["target_second"]
        required_duration = detail["duration"]
        
        correct = (press_start == target_s and press_duration >= required_duration)
    
    elif etype == "dont_click":
        # 빨간색이 나왔는지 여부
        red_appeared = data.get("red_appeared", False)
        clicked = data.get("clicked", False)
        
        if red_appeared:
            # 빨간색 나왔으면 누르면 안 됨
            correct = not clicked
        else:
            # 빨간색 안 나왔으면 눌러야 함
            correct = clicked
    
    elif etype == "rhythm_tap":
        # 깜빡임에 맞춰 3번 연속
        rhythm_taps = data.get("rhythm_taps", [])  # 탭 타임스탬프 리스트
        blink_times = data.get("blink_times", [])  # 깜빡임 타이밍 리스트
        required_count = detail["tap_count"]
        tolerance = detail["tolerance"]
        
        # 각 탭이 깜빡임 타이밍과 ±0.3초 안에 있는지 확인
        matched = 0
        for tap in rhythm_taps:
            for blink in blink_times:
                if abs(tap - blink) <= tolerance:
                    matched += 1
                    break
        
        correct = (matched >= required_count)
    
    # 정답 정보 생성
    answer_info = generate_answer_info(etype, detail)
    
    return jsonify({
        "correct": correct, 
        "answer": answer_info,
        "expected_time": expected_time  # 정답 시각
    })


def generate_answer_info(etype, detail):
    if etype == "specific_number":
        unit_label = {"hour": "시", "minute": "분", "second": "초"}[detail["unit"]]
        return f"{detail['target']}{unit_label}이 표시될 때"
    elif etype == "matching_digits":
        return f"숫자 {detail['digit']}이 {detail['count']}개 연속으로 나타날 때"
    elif etype == "palindrome":
        return "시간이 회문(앞뒤 같은 숫자)일 때"
    elif etype == "digit_appears":
        return f"숫자 {detail['target_digit']}이 포함될 때"
    elif etype == "no_digit":
        return f"숫자 {detail['excluded_digit']}이 없을 때"
    elif etype == "no_click":
        return f"숫자 {detail.get('impossible_digit', '?')}이 나타나지 않으므로 누르지 않기"
    elif etype == "sum_target":
        return f"숫자 합이 {detail['target']}일 때"
    elif etype == "sum_even":
        return "숫자 합이 짝수일 때"
    elif etype == "sum_odd":
        return "숫자 합이 홀수일 때"
    elif etype == "multiple_7":
        return "초가 7의 배수일 때"
    elif etype == "prime_second":
        return "초가 소수일 때"
    elif etype == "sandwich":
        return "분과 초가 같을 때"
    elif etype == "ascending":
        return "숫자가 연속으로 증가할 때"
    elif etype == "descending":
        return "숫자가 연속으로 감소할 때"
    elif etype == "bg_color_change":
        return f"배경이 {detail.get('target_color_name', '특정 색')}일 때"
    elif etype == "icon_appears":
        return f"{detail['target_icon']} 아이콘이 나타날 때"
    elif etype == "clock_type_match":
        labels = {"digital": "디지털", "analog": "아날로그", "binary": "바이너리", "flip": "플립", "neon": "네온"}
        return f"{labels[detail['target_clock']]} 시계가 빛날 때"
    elif etype == "clock_color_match":
        return f"시계가 {detail.get('target_color_name', '특정 색')}으로 빛날 때"
    elif etype == "second_zero":
        return "초가 00일 때"
    elif etype == "spacebar_count":
        return f"정확히 {detail['target_count']}번 눌렀을 때"
    elif etype == "rapid_tap":
        return f"초가 {detail['target_second']}이 된 후 {detail['duration']}초 안에 {detail['tap_count']}번 연타"
    elif etype == "long_press":
        return f"초가 {detail['target_second']}일 때 {detail['duration']}초 동안 꾹 누르기"
    elif etype == "dont_click":
        will_appear = detail.get("will_appear_red", False)
        if will_appear:
            return "빨간색이 나타났으므로 누르지 않기"
        else:
            return "빨간색이 나타나지 않았으므로 마지막에 누르기"
    elif etype == "rhythm_tap":
        return f"깜빡임에 맞춰 {detail['tap_count']}번 연속 누르기"
    return "조건 충족 시"


@app.route("/api/save_record", methods=["POST"])
def save_record():
    data = request.get_json()
    pid = data.get("player_id")
    max_stage = data.get("max_stage", 0)
    total_correct = data.get("total_correct", 0)
    total_wrong = data.get("total_wrong", 0)
    conn = get_db()
    conn.execute(
        "INSERT INTO records (player_id, max_stage, total_correct, total_wrong) VALUES (?,?,?,?)",
        (pid, max_stage, total_correct, total_wrong)
    )
    conn.commit()
    conn.close()
    return jsonify({"saved": True})


@app.route("/api/leaderboard", methods=["GET"])
def leaderboard():
    conn = get_db()
    rows = conn.execute("""
        SELECT p.name, r.max_stage, r.total_correct, r.played_at
        FROM records r
        JOIN players p ON p.id = r.player_id
        ORDER BY r.max_stage DESC, r.total_correct DESC
        LIMIT 20
    """).fetchall()
    conn.close()
    return jsonify([dict(row) for row in rows])


@app.route("/api/my_best", methods=["GET"])
def my_best():
    pid = request.args.get("player_id")
    conn = get_db()
    row = conn.execute("""
        SELECT max_stage, total_correct FROM records
        WHERE player_id=? ORDER BY max_stage DESC LIMIT 1
    """, (pid,)).fetchone()
    conn.close()
    if row:
        return jsonify({"max_stage": row["max_stage"], "total_correct": row["total_correct"]})
    return jsonify({"max_stage": 0, "total_correct": 0})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)