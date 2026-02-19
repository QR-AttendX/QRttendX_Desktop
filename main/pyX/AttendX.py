from flask import Flask, request, jsonify
import sqlite3
import qrcode
from PIL import Image
from io import BytesIO
import base64
import json
import os
import traceback
import logging
from datetime import datetime
import multiprocessing
from urllib.parse import quote

# NOTE: INSTALL A GODDAMN WAITRESS you Restless skibidi coder (message from Spades)
# NOTE: im trying twin

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
app.logger.setLevel(logging.INFO)

# Resolve DB path to work in both dev + packaged mode
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "QR_X.db")

# ---------------------------------
# Database Initialization
# ---------------------------------
def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fullname TEXT NOT NULL,
            username TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL,
            section TEXT,
            status TEXT DEFAULT 'Present',
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Attendance table stores individual attendance records
    c.execute("""
        CREATE TABLE IF NOT EXISTS attendance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_username TEXT NOT NULL,
            student_fullname TEXT NOT NULL,
            student_section TEXT,
            role TEXT,
            status TEXT DEFAULT 'Present',
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            time_in DATETIME,
            time_out DATETIME
        )
    """)
    conn.commit()
    # Ensure backward-compatible columns exist (for upgrades)
    try:
        c.execute("PRAGMA table_info(attendance)")
        cols = [r[1] for r in c.fetchall()]
        if 'time_in' not in cols:
            c.execute("ALTER TABLE attendance ADD COLUMN time_in DATETIME")
        if 'time_out' not in cols:
            c.execute("ALTER TABLE attendance ADD COLUMN time_out DATETIME")
        if 'student_section' not in cols:
            c.execute("ALTER TABLE attendance ADD COLUMN student_section TEXT")
        # ensure users table has section column
        c.execute("PRAGMA table_info(users)")
        ucols = [r[1] for r in c.fetchall()]
        if 'section' not in ucols:
            try:
                c.execute("ALTER TABLE users ADD COLUMN section TEXT")
            except Exception:
                # Some older SQLite builds may not allow multiple simultaneous alters — ignore
                pass
        conn.commit()
    except Exception as e:
        app.logger.info('init_db: could not ensure time_in/time_out columns: %s', e)
    conn.close()

init_db()

# ---------------------------------
# QR Generator
# ---------------------------------
def generate_qr(fullname, username, role, section=None, logo_path=None):
    payload = {"fullname": fullname, "username": username, "role": role}
    if section:
        payload['section'] = section

    # Expose a releases link so generic QR scanners (Google Lens, scanner apps)
    # will navigate to the releases page instead of showing raw JSON.
    RELEASES_URL = "https://github.com/QR-AttendX/QRttendX_Desktop/releases"
    # Also include the releases_url inside the profile JSON so apps that expect
    # a JSON payload can still read it from the `profile` param.
    payload['releases_url'] = RELEASES_URL

    # Build a URL payload that points to the releases page and carries the
    # profile JSON as an encoded `profile` query parameter. Fallback to raw
    # JSON if quoting fails for any reason.
    try:
        profile_json = json.dumps(payload)
        profile_param = quote(profile_json, safe='')
        qr_data = f"{RELEASES_URL}?profile={profile_param}"
    except Exception:
        qr_data = json.dumps(payload)

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=4
    )
    qr.add_data(qr_data)
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white").convert("RGBA")

    # Optional Logo Support
    if logo_path and os.path.exists(logo_path):
        try:
            logo = Image.open(logo_path).convert("RGBA")
            logo_size = int(img.size[0] * 0.20)
            logo.thumbnail((logo_size, logo_size), Image.LANCZOS)
            pos = ((img.size[0] - logo.size[0]) // 2,
                   (img.size[1] - logo.size[1]) // 2)
            img.paste(logo, pos, logo)
        except Exception as e:
            print("Logo error:", e)

    buffer = BytesIO()
    img.save(buffer, format="PNG")
    qr_bytes = buffer.getvalue()
    buffer.close()

    return base64.b64encode(qr_bytes).decode("ascii")

# ---------------------------------
# REST API Routes
# ---------------------------------

#For user registration
@app.route("/create_user", methods=["POST"])
def create_user():
    try:
        data = request.get_json()
        fullname = data.get("fullname", "").strip()
        username = data.get("username", "").strip().lower()
        role = data.get("role", "").strip()
        section = data.get("section", "").strip()

        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        # If username already exists, return that record (re-login flow)
        c.execute("SELECT id, fullname, username, role, section FROM users WHERE username = ?", (username,))
        existing = c.fetchone()
        if existing:
            conn.close()
            qr_b64 = generate_qr(existing[1], existing[2], existing[3], existing[4] if len(existing) > 4 else None)
            return jsonify({
                "status": "ok",
                "id": existing[0],
                "fullname": existing[1],
                "username": existing[2],
                "role": existing[3],
                "section": existing[4] if len(existing) > 4 else None,
                "qr_base64": qr_b64
            })

        # Prevent duplicate fullnames for *different* usernames (case-insensitive)
        c.execute("SELECT 1 FROM users WHERE lower(trim(fullname)) = ?", (fullname.lower(),))
        dup_full = c.fetchone()
        if dup_full:
            conn.close()
            return jsonify({"status": "error", "message": "fullname already exists"}), 409

        if not existing:
            c.execute("INSERT INTO users(fullname, username, role, section) VALUES (?,?,?,?)",
                      (fullname, username, role, section))
            conn.commit()

        # fetch canonical user columns (named order) so callers get consistent indices
        c.execute("SELECT id, fullname, username, role, section FROM users WHERE username = ?", (username,))
        user = c.fetchone()

        conn.close()

        # Auto-generate QR on registration
        qr_b64 = generate_qr(fullname, username, role, section)

        return jsonify({
            "status": "ok",
            "id": user[0],
            "fullname": user[1],
            "username": user[2],
            "role": user[3],
            "section": user[4] if len(user) > 4 else None,
            "qr_base64": qr_b64
        })

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/delete_user", methods=["POST"])
def delete_user():
    """Delete a user by username and remove related attendance rows."""
    try:
        data = request.get_json() or {}
        username = (data.get("username") or "").strip().lower()
        if username.startswith("@"):
            username = username.lstrip("@")
        if not username:
            return jsonify({"status": "error", "message": "username required"}), 400

        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        # Remove attendance rows tied to the username
        c.execute("DELETE FROM attendance WHERE student_username = ?", (username,))
        attendance_deleted = c.rowcount
        # Remove the user record
        c.execute("DELETE FROM users WHERE username = ?", (username,))
        user_deleted = c.rowcount
        conn.commit()
        conn.close()

        return jsonify({"status": "ok", "deleted_user": user_deleted, "deleted_attendance": attendance_deleted})
    except Exception as e:
        tb = traceback.format_exc()
        app.logger.error("Error in /delete_user: %s\n%s", e, tb)
        return jsonify({"status": "error", "message": str(e)}), 500

#For automatic QR Generation if user exists
@app.route("/generate_qr", methods=["POST"])
def qr_api():
    try:
        data = request.get_json()
        fullname = data["fullname"]
        username = data["username"]
        role = data["role"]
        section = data.get("section", None)
        logo_path = data.get("logo_path", None)

        qr_b64 = generate_qr(fullname, username, role, section, logo_path)

        return jsonify({
            "status": "ok",
            "qr_base64": qr_b64
        })

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


#For record attendance (ON TESTING PURPOSES)
@app.route("/record_attendance", methods=["POST"])
def record_attendance():
    data = request.get_json() or {}
    # Accept multiple possible field names coming from different frontends
    fullname = (data.get('fullname') or data.get('student_fullname') or data.get('name') or data.get('student_name') or '').strip()
    username = (data.get('username') or data.get('student_username') or data.get('user') or data.get('student_user') or '').strip()
    role = (data.get('role') or data.get('user_role') or '').strip()
    section = data.get('section') or data.get('student_section') or data.get('class')
    time_in = data.get('time_in') or data.get('timestamp')
    if username.startswith('@'):
        username = username.lstrip('@')
    # Require at least a username
    if not username:
        app.logger.error('record_attendance: missing username in payload: %s', data)
        return jsonify({'error': 'username required'}), 400

    # Normalize username before storing so matching/deletion is consistent
    try:
        uname = (username or '').strip()
        uname = uname.lstrip('@') if uname.startswith('@') else uname
        uname = uname.lower()
    except Exception:
        uname = (username or '').strip()

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # store student_section when provided so UI can display Section instead of username
    c.execute("""
        INSERT INTO attendance (student_username, student_fullname, student_section, role, time_in)
        VALUES (?, ?, ?, ?, ?)
    """, (uname, fullname, section, role, time_in))
    # Explicitly set timestamp to server's current local time (ISO 8601)
    try:
        inserted_id = c.lastrowid
        ts = datetime.now().isoformat()
        c.execute("UPDATE attendance SET timestamp = ? WHERE id = ?", (ts, inserted_id))
    except Exception as e:
        app.logger.warning('Failed to set explicit timestamp: %s', e)

    conn.commit()
    conn.close()

    return jsonify({"ok": True, "stored_username": uname})

#When the teacher updates attandance status/record
@app.route("/update_attendance", methods=["POST"])
def update_attendance():
    data = request.get_json()
    attendance_id = data["id"]
    new_status = data["status"]  # Present / Late / Excused / Absent

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("""
        UPDATE attendance SET status = ? WHERE id = ?
    """, (new_status, attendance_id))

    conn.commit()
    conn.close()

    return jsonify({"ok": True})

#To get all attendance records
@app.route("/get_attendance", methods=["GET"])
def get_attendance():
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        # Explicitly select columns by name to avoid issues when ALTER TABLE changed column ordering
        c.execute("SELECT id, student_username, student_fullname, student_section, role, status, timestamp, time_in, time_out FROM attendance")
        rows = [
            {"id": r[0], "student_username": r[1], "student_fullname": r[2], "student_section": r[3],
             "role": r[4], "status": r[5], "timestamp": r[6], "time_in": r[7], "time_out": r[8]} for r in c.fetchall()
        ]
        conn.close()
        return jsonify(rows)
    except Exception as e:
        # Log full traceback to server console
        tb = traceback.format_exc()
        app.logger.error('Error in /get_attendance: %s\n%s', e, tb)
        return jsonify({"error": "failed to fetch attendance", "details": str(e)}), 500


# `/delete_all_attendance` (dev-only) removed.


@app.route('/delete_attendance_row', methods=['POST'])
def delete_attendance_row():
    """Delete a single attendance row by its numeric id."""
    try:
        data = request.get_json() or {}
        attendance_id = data.get('id')
        if attendance_id is None:
            return jsonify({'error': 'id required'}), 400

        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("DELETE FROM attendance WHERE id = ?", (attendance_id,))
        deleted = c.rowcount
        conn.commit()
        conn.close()

        app.logger.info('delete_attendance_row: id=%s deleted=%s', attendance_id, deleted)
        return jsonify({'ok': True, 'deleted': deleted})
    except Exception as e:
        tb = traceback.format_exc()
        app.logger.error('Error in /delete_attendance_row: %s\n%s', e, tb)
        return jsonify({'error': str(e)}), 500


@app.route('/set_timeouts_bulk', methods=['POST'])
def set_timeouts_bulk():
    """Set time_out for multiple attendance rows. Expects JSON: { ids: [1,2,3], time_out: ISOString }
    """
    try:
        data = request.get_json() or {}
        ids = data.get('ids') or []
        time_out = data.get('time_out')
        if not ids or not time_out:
            return jsonify({'error': 'ids and time_out required'}), 400

        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        placeholders = ','.join('?' for _ in ids)
        query = f"UPDATE attendance SET time_out = ? WHERE id IN ({placeholders})"
        params = [time_out] + list(ids)
        c.execute(query, params)
        conn.commit()
        updated = c.rowcount
        conn.close()
        return jsonify({'ok': True, 'updated': updated})
    except Exception as e:
        tb = traceback.format_exc()
        app.logger.error('Error in /set_timeouts_bulk: %s\n%s', e, tb)
        return jsonify({'error': str(e)}), 500


@app.route('/set_timeout', methods=['POST'])
def set_timeout():
    """Set time_out for single attendance row. Accepts { id, time_out, status?(optional) }"""
    try:
        data = request.get_json() or {}
        attendance_id = data.get('id')
        time_out = data.get('time_out')
        status = data.get('status')
        if attendance_id is None or time_out is None:
            return jsonify({'error': 'id and time_out required'}), 400

        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        if status:
            c.execute("UPDATE attendance SET time_out = ?, status = ? WHERE id = ?", (time_out, status, attendance_id))
        else:
            c.execute("UPDATE attendance SET time_out = ? WHERE id = ?", (time_out, attendance_id))
        conn.commit()
        updated = c.rowcount
        conn.close()
        return jsonify({'ok': True, 'updated': updated})
    except Exception as e:
        tb = traceback.format_exc()
        app.logger.error('Error in /set_timeout: %s\n%s', e, tb)
        return jsonify({'error': str(e)}), 500


@app.route('/edit_attendance', methods=['POST'])
def edit_attendance():
    """Edit one attendance row. Accepts JSON containing `id` and any of the
    updatable fields: `student_fullname`, `student_username`, `student_section`,
    `role`, `status`, `time_in`, `time_out`, `timestamp`.

    Example payload:
      { "id": 123, "student_fullname": "New Name", "student_username": "user1", "student_section": "A1", "time_in": "2026-01-26T09:00:00" }
    """
    try:
        data = request.get_json() or {}
        attendance_id = data.get('id')
        if attendance_id is None:
            return jsonify({'error': 'id required'}), 400

        # Map accepted input keys to attendance table columns
        fields_map = {
            'student_fullname': 'student_fullname',
            'student_username': 'student_username',
            'student_section': 'student_section',
            'role': 'role',
            'status': 'status',
            'time_in': 'time_in',
            'time_out': 'time_out',
            'timestamp': 'timestamp'
        }

        updates = []
        params = []
        for key, col in fields_map.items():
            if key in data and data[key] is not None:
                val = data[key]
                # Normalize usernames: strip leading @ and lowercase
                if key == 'student_username':
                    try:
                        v = str(val).strip()
                        if v.startswith('@'):
                            v = v.lstrip('@')
                        v = v.lower()
                        val = v
                    except Exception:
                        pass
                updates.append(f"{col} = ?")
                params.append(val)

        if not updates:
            return jsonify({'error': 'no updatable fields provided'}), 400

        params.append(attendance_id)
        query = f"UPDATE attendance SET {', '.join(updates)} WHERE id = ?"

        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute(query, params)
        conn.commit()
        updated = c.rowcount
        conn.close()

        app.logger.info('edit_attendance: id=%s updated=%s', attendance_id, updated)
        return jsonify({'ok': True, 'updated': updated})

    except Exception as e:
        tb = traceback.format_exc()
        app.logger.error('Error in /edit_attendance: %s\n%s', e, tb)
        return jsonify({'error': str(e)}), 500


# `/delete_attendance_for_user` (dev helper) removed.

# NOTE: Dev-only endpoints have been removed from the public surface to reduce
# maintenance attack surface. Keep only production endpoints such as
# `/record_attendance`, `/get_attendance`, `/update_attendance`,
# `/delete_attendance_row`, and `/delete_user`.


# Health endpoint for readiness checks
@app.route("/health", methods=["GET"])
def health():
    try:
        # simple DB check to ensure server can access DB
        conn = sqlite3.connect(DB_PATH)
        conn.execute("SELECT 1")
        conn.close()
        return jsonify({"status": "ok", "ready": True})
    except Exception as e:
        return jsonify({"status": "error", "ready": False, "details": str(e)}), 500

# ---------------------------------
# Run Server
# ---------------------------------
if __name__ == "__main__":
    # Required for PyInstaller on Windows to avoid multiprocessing issues
    multiprocessing.freeze_support()
    import sys

    # Determine mode: production by default. Enable debug/dev when:
    # - env ATTENDY_DEBUG=1/true
    # - env ATTENDY_MODE=dev|development|debug
    # - CLI flag --dev or --debug
    # Default to False so the server does not enable the reloader/child process
    debug_mode = False
    if os.environ.get('ATTENDX_DEBUG', '').lower() in ('1', 'true', 'yes'):
        debug_mode = True
    if os.environ.get('ATTENDX_MODE', '').lower() in ('dev', 'development', 'debug'):
        debug_mode = True
    if '--dev' in sys.argv or '--debug' in sys.argv:
        debug_mode = True

    if debug_mode:
        # Development / debugging mode: enable Flask debugger + reloader
        app.config.update(DEBUG=True)
        try:
            logging.getLogger('werkzeug').setLevel(logging.DEBUG)
        except Exception:
            pass
        app.logger.setLevel(logging.DEBUG)
        app.run(host='127.0.0.1', port=5005, debug=True, use_reloader=True)
    else:
        # Production-ish mode: disable debugger/reloader and prefer waitress
        app.config.update(DEBUG=False)
        try:
            logging.getLogger('werkzeug').setLevel(logging.ERROR)
        except Exception:
            pass

        try:
            from waitress import serve
            serve(app, host='127.0.0.1', port=5005)
        except Exception:
            # Fallback to Flask built-in server without debug/reloader
            app.run(host='127.0.0.1', port=5005, debug=False, use_reloader=False)
