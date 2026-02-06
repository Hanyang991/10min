from flask import Flask, jsonify, request, send_from_directory
import sqlite3, uuid, random
from datetime import datetime, timedelta
import os

app = Flask(__name__)

# ─── CORS 설정 ─────────────────────────────────────────────────────
@app.after_request
def after_request(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp

@app.route("/api/<path:path>", methods=["OPTIONS"])
def options_handler(path):
    return "", 204

# ─── DB 설정 (상대 경로로 수정) ──────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data")
DB_FILE = os.path.join(DB_PATH, "game.db")

def get_db():
    if not os.path.exists(DB_PATH):
        os.makedirs(DB_PATH)
    conn = sqlite3.connect(DB_FILE)
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

# ─── 로직: 유효 시간 계산 및 함정 생성 ───────────────────────────────

def get_possible_times():
    """
    현재 시각 기준 +2초 ~ +10초 (총 9초간)의 시각 리스트 반환
    (사용자가 반응할 시간 확보 및 심리전 구간)
    """
    now = datetime.now()
    possible_times = []
    
    # 2초 후부터 10초 후까지
    for i in range(2, 11): 
        future_time = now + timedelta(seconds=i)
        possible_times.append((future_time.hour, future_time.minute, future_time.second))
    
    return possible_times

def create_time_based_event(possible_times, stage):
    """
    심리전 로직 적용:
    1. 2~10초 사이의 시간 속성을 분석
    2. 일정 확률로 그 사이에 '없는' 조건을 제시 (함정)
    """
    # 1. 윈도우 내 속성 분석
    stats = {
        "seconds": set(),
        "sums": set(),
        "digits": set(),
        "has_even_sum": False,
        "has_odd_sum": False,
        "has_multiple_7": False
    }

    for h, m, s in possible_times:
        stats["seconds"].add(s)
        
        # 자릿수 분해 및 합계
        digits = [int(d) for d in f"{h:02d}{m:02d}{s:02d}"]
        d_sum = sum(digits)
        
        stats["sums"].add(d_sum)
        stats["digits"].update(digits)
        
        if d_sum % 2 == 0: stats["has_even_sum"] = True
        else: stats["has_odd_sum"] = True
        
        if s > 0 and s % 7 == 0: stats["has_multiple_7"] = True

    # 2. 함정 여부 결정 (스테이지가 높을수록 함정 확률 증가, 최대 50%)
    trap_chance = min(0.2 + (stage * 0.02), 0.5)
    is_trap = random.random() < trap_chance

    # 3. 미션 타입 랜덤 선택
    # 심리전에 적합한 타입들 위주로 구성
    mission_types = ["specific_second", "sum_target", "digit_appears"]
    if stage >= 5:
        mission_types.extend(["sum_parity", "multiple_7"])
    
    m_type = random.choice(mission_types)
    event = None

    # --- 미션 생성 로직 ---
    
    if m_type == "specific_second":
        if not is_trap:
            # 정답: 존재하는 초 중 하나
            target = random.choice(list(stats["seconds"]))
        else:
            # 함정: 존재하지 않는 초
            all_secs = set(range(60))
            candidates = list(all_secs - stats["seconds"])
            if not candidates: return None
            target = random.choice(candidates)
            
        event = {
            "type": "specific_number",
            "description": f"시계의 **초(秒)가 {target}**일 때 멈추세요!",
            "detail": {"unit": "second", "target": target, "is_trap": is_trap}
        }

    elif m_type == "sum_target":
        if not is_trap:
            target = random.choice(list(stats["sums"]))
        else:
            # 함정: 나오지 않는 합 (대략적인 범위 0~54)
            possible_sums = set(range(1, 55))
            candidates = list(possible_sums - stats["sums"])
            if not candidates: return None
            target = random.choice(candidates)

        event = {
            "type": "sum_target",
            "description": f"숫자들의 **합이 {target}**일 때 멈추세요!",
            "detail": {"target": target, "is_trap": is_trap}
        }

    elif m_type == "digit_appears":
        if not is_trap:
            target = random.choice(list(stats["digits"]))
        else:
            all_digits = set(range(10))
            candidates = list(all_digits - stats["digits"])
            if not candidates: return None
            target = random.choice(candidates)
            
        event = {
            "type": "digit_appears",
            "description": f"숫자 **{target}**이 포함되면 멈추세요!",
            "detail": {"target_digit": target, "is_trap": is_trap}
        }

    elif m_type == "sum_parity":
        # 짝수/홀수
        target_str = "짝수" if random.random() < 0.5 else "홀수"
        target_is_even = (target_str == "짝수")
        
        # 실제 윈도우에 해당 조건이 있는지 확인
        exists = stats["has_even_sum"] if target_is_even else stats["has_odd_sum"]
        
        if not is_trap:
            # 정답 모드여야 하는데 존재하지 않으면 -> 강제 함정 모드로 변경
            actual_trap = not exists
        else:
            # 함정 모드여야 하는데 존재하면 -> 반대 조건으로 변경하거나 패스
            # 여기서는 단순화를 위해 '존재하지 않는 것'을 요구하도록 설정
            if exists: 
                # 존재하는데 함정이어야 함 -> 불가능하므로 미션 변경 (반대 성별 요구)
                target_str = "홀수" if target_is_even else "짝수"
                actual_trap = True # 바꿨으니 없다고 가정 (단, 둘 다 있을 수 있으므로 재확인 필요하지만 생략)
                # 엄밀히는 둘 다 존재할 수 있으므로 parity는 함정 만들기가 까다로움.
                # 그냥 exists 체크 결과에 따라 trap 여부를 갱신
                actual_trap = True
            else:
                actual_trap = True

        # Parity는 로직이 복잡하므로, 단순히 "조건이 존재하지 않으면 Trap"으로 정의
        target_val = "even" if target_str == "짝수" else "odd"
        is_really_possible = stats["has_even_sum"] if target_val == "even" else stats["has_odd_sum"]
        
        event = {
            "type": "sum_even" if target_val == "even" else "sum_odd",
            "description": f"숫자 합이 **{target_str}**일 때 멈추세요!",
            "detail": {"is_trap": not is_really_possible}
        }

    elif m_type == "multiple_7":
        exists = stats["has_multiple_7"]
        event = {
            "type": "multiple_7",
            "description": "**초가 7의 배수**일 때 멈추세요!",
            "detail": {"is_trap": not exists}
        }

    return event


def create_non_time_event(stage):
    """시각 무관 이벤트 (기존 유지)"""
    # ... 기존 로직과 동일 ... (필요시 함정 추가 가능하나 생략)
    # 여기서는 간단한 구현을 위해 None 리턴하여 Time event 위주로 유도하거나
    # 기존 코드의 create_non_time_event 함수 내용을 그대로 쓰세요.
    # (코드 길이상 생략하고 필요한 경우 이전 코드 붙여넣으시면 됩니다)
    pass 

# ─── ROUTES ──────────────────────────────────────────────────────

@app.route('/')
def serve_index():
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
    stage = int(request.args.get("stage", 1))
    
    # 80% 확률로 시간 기반 심리전 문제 출제
    possible_times = get_possible_times()
    evt = create_time_based_event(possible_times, stage)
    
    # 만약 생성 실패했거나(None), 랜덤으로 비시간 문제 낼 경우
    if not evt:
        # fallback: 간단한 스페이스바 연타 문제 등
        count = random.randint(5, 15)
        evt = {
            "type": "spacebar_count",
            "description": f"스페이스바를 정확히 **{count}번** 누르세요!",
            "detail": {"target_count": count, "is_trap": False}
        }

    # 테마 설정
    themes = [
        {"bg": "#0f0f1a", "accent": "#00fff5", "name": "dark_cyber"},
        {"bg": "#1a0a2e", "accent": "#e94560", "name": "neon_night"},
        {"bg": "#162447", "accent": "#e94560", "name": "deep_navy"},
    ]
    
    return jsonify({
        "stage": stage,
        "event": evt,
        "theme": random.choice(themes),
        "clocks": ["digital"] # 테스트용으로 디지털 고정
    })

@app.route("/api/verify", methods=["POST"])
def verify():
    data = request.get_json()
    event = data.get("event", {})
    detail = event.get("detail", {})
    current_time = data.get("current_time", {})
    
    # 클라이언트가 보낸 '눌렀는지 여부' (타임아웃 시 clicked: false로 와야 함)
    clicked = data.get("clicked", True) 
    
    h, m, s = current_time.get("h", 0), current_time.get("m", 0), current_time.get("s", 0)
    digits = [int(d) for d in f"{h:02d}{m:02d}{s:02d}"]
    
    # 함정 여부 (클라이언트가 보내준 detail 활용)
    is_trap = detail.get("is_trap", False)
    
    # 1. 실제 조건 충족 여부 계산
    condition_met = False
    etype = event.get("type")
    
    if etype == "specific_number":
        target = detail["target"]
        if detail["unit"] == "second": condition_met = (s == target)
        elif detail["unit"] == "minute": condition_met = (m == target)
        
    elif etype == "sum_target":
        condition_met = (sum(digits) == detail["target"])
        
    elif etype == "digit_appears":
        condition_met = (detail["target_digit"] in digits)
        
    elif etype == "sum_even":
        condition_met = (sum(digits) % 2 == 0)
        
    elif etype == "sum_odd":
        condition_met = (sum(digits) % 2 != 0)
        
    elif etype == "multiple_7":
        condition_met = (s > 0 and s % 7 == 0)

    elif etype == "spacebar_count":
        # 스페이스바 카운트는 함정이 없음 (무조건 맞춰야 함)
        user_count = data.get("spacebar_count", 0)
        condition_met = (user_count == detail["target_count"])
        # 카운트 미션은 clicked 개념이 다름 (제출 시점)
        if condition_met: return jsonify({"correct": True, "msg": "정확합니다!"})
        else: return jsonify({"correct": False, "expected": detail["target_count"]})

    # 2. 최종 판정 로직 (심리전 포함)
    
    if clicked:
        # 사용자가 눌렀음
        if condition_met:
            return jsonify({"correct": True, "msg": "정확한 타이밍!"})
        else:
            # 조건이 안 맞는데 눌렀음
            if is_trap:
                return jsonify({"correct": False, "msg": "함정이었습니다! (조건이 등장하지 않음)"})
            else:
                return jsonify({"correct": False, "msg": "타이밍이 틀렸습니다!"})
                
    else:
        # 사용자가 안 누르고 기다림 (Timeout)
        if is_trap:
            # 함정이었으므로 안 누른 게 정답
            return jsonify({"correct": True, "msg": "성공! 함정을 잘 피하셨습니다."})
        else:
            # 정답이 있었는데 안 눌렀음
            return jsonify({"correct": False, "msg": "기회를 놓쳤습니다! (정답이 있었습니다)"})

# ─── 실행 ────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=True)