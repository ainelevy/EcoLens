#!/usr/bin/env python3
"""
EcoLens Kiosk v3 - Raspberry Pi Touchscreen UI

Session start is now QR-based: the home screen shows a QR code encoding this
kiosk's unitId ("ecolens://kiosk?unit=<uuid>"). The user scans it with the
EcoLens mobile app (Scan tab), which starts a session on this unit. The kiosk
polls GET /api/disposal/kiosks/<unitId>/active-session and, when a session
appears, switches into the disposal flow. The old on-screen keyboard / manual
user-code entry has been removed.

Rapid mode (RAPID_MODE, default on): disposal is tap-free. The user keeps
inserting bottles one after another; the kiosk auto-captures and classifies each
(the ML model doubles as the presence sensor, with a debounce so each bottle is
counted once), tallies live on screen, and flushes events to the backend in
batches instead of one network call per bottle. Tap END SESSION when done.
Set RAPID_MODE = False to fall back to the tap-per-item flow.

Retained from v2:
  - unitId sent with every session start (enables per-kiosk admin monitoring)
  - Kiosk full detection: stops accepting after KIOSK_CAPACITY bottles
  - Auto-syncs capacity with backend so admin can remotely reset via dashboard
  - Tracks all scanned items (accepted + rejected), not just accepted
  - DISPOSE AGAIN returns to session screen instead of auto-firing camera
  - Capacity bar visible during active sessions
  - Goes straight to FULL screen on startup if already at capacity
"""
import pygame
import sys
import os
import requests
import threading
import time
import io
import json
import math
import qrcode
from datetime import datetime
from PIL import Image
from picamera2 import Picamera2

# ─── CONFIG ────────────────────────────────────────────────────────────────────
BACKEND_URL       = "https://eco-lens-production.up.railway.app"
ML_SERVICE_URL    = "http://localhost:7860"  # ML runs locally on the Pi
UNIT_ID           = "7fe03643-1b25-4e8e-8b88-ee4b2cde83f0"
CAPTURE_DIR       = "/home/ecolens/captures"
BOTTLE_COUNT_FILE = "/home/ecolens/bottle_count.txt"
KIOSK_CAPACITY    = 300         # max bottles before KIOSK FULL screen
SCREEN_W          = 480
SCREEN_H          = 320
FPS               = 30

# ─── RAPID MODE (tap-free continuous disposal) ──────────────────────────────────
# The user just keeps feeding bottles one after another; the kiosk auto-captures,
# classifies and tallies each one with no taps. The ML model doubles as the
# presence sensor (empty frames are skipped) and a "must see an empty frame
# between items" debounce guarantees exactly one count per bottle. Events are
# queued locally and flushed to the backend in batches, so network latency is
# out of the per-bottle loop. Set RAPID_MODE = False to fall back to the old
# tap-per-item flow.
RAPID_MODE          = True
POINTS_PER_DISPOSAL = 50        # display only — the backend is the source of truth
IDLE_POLL_INTERVAL  = 0.6       # seconds between classifications while waiting for a bottle
RELOAD_DELAY        = 1.4       # seconds after a count, to let it drop / next be placed
REARM_EMPTY_FRAMES  = 2         # consecutive empty frames required before counting again
BATCH_FLUSH_EVERY   = 5         # flush queued events to the backend every N items
LOW_CONF_SKIP       = 0.35      # detections below this confidence are treated as noise
EVENT_QUEUE_FILE    = "/home/ecolens/event_queue.json"

# ─── COLORS ────────────────────────────────────────────────────────────────────
BG_DARK      = (8,   18,  12)
BG_CARD      = (14,  32,  20)
GREEN_BRIGHT = (0,   230, 100)
GREEN_DIM    = (0,   140, 60)
RED_BRIGHT   = (230, 60,  60)
RED_DIM      = (140, 30,  30)
TEAL         = (0,   200, 180)
WHITE        = (240, 245, 240)
GRAY         = (80,  100, 85)
GRAY_LIGHT   = (130, 150, 135)
AMBER        = (255, 190, 0)
BLACK        = (0,   0,   0)

class EcoLensKiosk:
    def __init__(self):
        pygame.init()
        self.screen = pygame.display.set_mode((SCREEN_W, SCREEN_H), pygame.FULLSCREEN)
        pygame.display.set_caption("EcoLens")
        pygame.mouse.set_visible(True)

        self.f_xl   = pygame.font.SysFont("DejaVu Sans", 30, bold=True)
        self.f_lg   = pygame.font.SysFont("DejaVu Sans", 22, bold=True)
        self.f_md   = pygame.font.SysFont("DejaVu Sans", 16)
        self.f_sm   = pygame.font.SysFont("DejaVu Sans", 13)
        self.f_xs   = pygame.font.SysFont("DejaVu Sans", 11)
        self.f_mono = pygame.font.SysFont("DejaVu Sans Mono", 20, bold=True)
        self.f_kb   = pygame.font.SysFont("DejaVu Sans", 13, bold=True)

        # Session state
        self.state          = "home"
        self.user_id_input  = ""
        self.user_code      = ""
        self.user_name      = ""
        self.session_id     = None
        self.result_valid   = False
        self.result_label   = ""
        self.result_conf    = 0.0
        self.result_points  = 0
        self.total_points   = 0
        self.total_items    = 0    # all items scanned (accepted + rejected)
        self.accepted_items = 0    # plastic items accepted
        self.status_msg     = ""
        self.status_color   = WHITE

        # Capacity
        self.bottle_count    = self._load_bottle_count()
        self.last_full_check = 0   # epoch seconds; 0 triggers immediate check

        # Animation
        self.anim_tick = 0
        self.pulse     = 0.0
        self.pulse_dir = 1

        # Button refs (set during render, read during click handling)
        self.btn_dispose_again  = None
        self.btn_end_from_result = None
        self.btn_check_status   = None
        self.kb_rects           = {}

        # Rapid mode (tap-free feeding) state
        self.event_queue    = []                 # disposal events not yet sent to backend
        self.queue_lock     = threading.Lock()
        self.feed_running   = False              # feed loop should keep running
        self.feeding_active = False              # feed loop is currently inside its body
        self.flash_until    = 0.0                # show the last result flash until this time
        self.feed_hint      = "Place a plastic bottle in view..."
        self.btn_feed_end   = None

        os.makedirs(CAPTURE_DIR, exist_ok=True)

        # Pre-render the kiosk's QR code (encodes its fixed unitId). Users scan
        # this with the EcoLens app to start a session — no manual code entry.
        self.qr_surface = self._build_qr_surface()

        self.camera = None
        self._init_camera()

        # Sync capacity from backend in case admin reset it since last run
        threading.Thread(target=self._sync_capacity_from_backend, daemon=True).start()
        # Push this kiosk's physical capacity to the backend so the DB matches the hardware
        threading.Thread(target=self._report_capacity_to_backend, daemon=True).start()
        threading.Thread(target=self._warmup, daemon=True).start()
        # Watch for a phone-started session while the QR screen is showing
        threading.Thread(target=self._poll_loop, daemon=True).start()

        self.clock = pygame.time.Clock()

    # ─── QR CODE ───────────────────────────────────────────────────────────────
    def _build_qr_surface(self, size=180):
        """Render the kiosk's QR (encodes unitId) to a pygame surface for the home screen."""
        try:
            payload = f"ecolens://kiosk?unit={UNIT_ID}"
            qr = qrcode.QRCode(border=2, box_size=8,
                               error_correction=qrcode.constants.ERROR_CORRECT_M)
            qr.add_data(payload)
            qr.make(fit=True)
            img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
            img = img.resize((size, size))
            return pygame.image.fromstring(img.tobytes(), img.size, "RGB")
        except Exception as e:
            print(f"[QR] build error: {e}")
            return None

    # ─── SESSION POLLING ───────────────────────────────────────────────────────
    def _poll_loop(self):
        """Background: while the home/QR screen is up, detect a session started from a phone."""
        while True:
            if self.state == "home" and self.bottle_count < KIOSK_CAPACITY:
                self._check_for_active_session()
            time.sleep(2.5)

    def _check_for_active_session(self):
        if UNIT_ID == "YOUR-UNIT-UUID-HERE":
            return
        try:
            r = requests.get(
                f"{BACKEND_URL}/api/disposal/kiosks/{UNIT_ID}/active-session",
                timeout=5
            )
            if r.status_code == 200:
                data = r.json()
                # Re-check state: user may have left the home screen while we waited
                if data.get("active") and self.state == "home":
                    self.session_id     = data.get("session", {}).get("id")
                    self.user_name      = data.get("userName", "")
                    self.user_code      = data.get("userCode", "")
                    self.total_points   = 0
                    self.total_items    = 0
                    self.accepted_items = 0
                    self.status_msg     = f"Welcome, {self.user_name}!"
                    self.status_color   = GREEN_BRIGHT
                    print(f"[POLL] session {self.session_id} for {self.user_name}")
                    if RAPID_MODE:
                        self._start_feeding()
                    else:
                        self.state = "session"
        except Exception as e:
            print(f"[POLL] {e}")

    # ─── CAPACITY ──────────────────────────────────────────────────────────────
    def _load_bottle_count(self):
        try:
            with open(BOTTLE_COUNT_FILE, 'r') as f:
                return max(0, int(f.read().strip()))
        except Exception:
            return 0

    def _save_bottle_count(self):
        try:
            with open(BOTTLE_COUNT_FILE, 'w') as f:
                f.write(str(self.bottle_count))
        except Exception as e:
            print(f"[CAPACITY] save error: {e}")

    def _sync_capacity_from_backend(self):
        """On startup: if admin reset the count via dashboard, pick up that lower value."""
        if UNIT_ID == "YOUR-UNIT-UUID-HERE":
            return
        try:
            r = requests.get(
                f"{BACKEND_URL}/api/disposal/kiosks/{UNIT_ID}/status",
                timeout=5
            )
            if r.status_code == 200:
                backend_count = r.json().get("currentBottleCount", self.bottle_count)
                if backend_count < self.bottle_count:
                    self.bottle_count = backend_count
                    self._save_bottle_count()
                    print(f"[CAPACITY] synced from backend → {self.bottle_count}")
        except Exception as e:
            print(f"[CAPACITY] startup sync error: {e}")

    def _report_capacity_to_backend(self):
        """Background: tell backend the current bottle count + this kiosk's physical
        capacity (keeps the DB in sync with the hardware) after each disposal / on boot."""
        if UNIT_ID == "YOUR-UNIT-UUID-HERE":
            return
        try:
            requests.patch(
                f"{BACKEND_URL}/api/disposal/kiosks/{UNIT_ID}/capacity",
                json={"bottleCount": self.bottle_count, "capacity": KIOSK_CAPACITY},
                timeout=5
            )
        except Exception as e:
            print(f"[CAPACITY] report error: {e}")

    def _check_if_admin_reset(self):
        """Called from full screen: ask backend if admin emptied the kiosk."""
        self.last_full_check = time.time()
        if UNIT_ID == "YOUR-UNIT-UUID-HERE":
            self.bottle_count = 0
            self._save_bottle_count()
            self.state = "home"
            self.status_msg = "Kiosk ready"
            self.status_color = GREEN_BRIGHT
            return
        try:
            r = requests.get(
                f"{BACKEND_URL}/api/disposal/kiosks/{UNIT_ID}/status",
                timeout=5
            )
            if r.status_code == 200:
                backend_count = r.json().get("currentBottleCount", self.bottle_count)
                if backend_count < self.bottle_count:
                    self.bottle_count = backend_count
                    self._save_bottle_count()
                if self.bottle_count < KIOSK_CAPACITY:
                    self.status_msg = "Kiosk emptied. Ready!"
                    self.status_color = GREEN_BRIGHT
                    self.state = "home"
        except Exception as e:
            print(f"[CAPACITY] reset check error: {e}")

    # ─── CAMERA & WARMUP ───────────────────────────────────────────────────────
    def _init_camera(self):
        try:
            self.camera = Picamera2()
            cfg = self.camera.create_still_configuration(
                main={"size": (1280, 960)},
                lores={"size": (640, 480)}
            )
            self.camera.configure(cfg)
            self.camera.start()
            time.sleep(1.5)
            print("[CAMERA] initialised")
        except Exception as e:
            print(f"[CAMERA ERROR] {e}")

    def _warmup(self):
        try:
            requests.get(f"{BACKEND_URL}/health", timeout=5)
            print("[WARMUP] backend OK")
        except Exception as e:
            print(f"[WARMUP] {e}")

    # ─── API CALLS ─────────────────────────────────────────────────────────────
    def api_capture_and_classify(self):
        # Guard: never accept if already full
        if self.bottle_count >= KIOSK_CAPACITY:
            self.state = "full"
            return

        self.state = "capturing"
        try:
            time.sleep(0.3)
            arr = self.camera.capture_array("main")
            img = Image.fromarray(arr)

            stamp = datetime.now().strftime("%H%M%S")
            img.save(os.path.join(CAPTURE_DIR, f"{stamp}.jpg"), format="JPEG", quality=90)

            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=90)
            buf.seek(0)

            r = requests.post(
                f"{ML_SERVICE_URL}/classify",
                files={"file": ("item.jpg", buf, "image/jpeg")},
                timeout=30
            )
            print(f"[CLASSIFY] {r.status_code} {r.text[:200]}")
            ml = r.json()
            is_plastic    = ml.get("isPlastic", False)
            classified_as = ml.get("classifiedAs", "unknown")
            confidence    = float(ml.get("confidence", 0))

            r2 = requests.post(
                f"{BACKEND_URL}/api/disposal/events",
                json={
                    "sessionId":    self.session_id,
                    "classifiedAs": classified_as,
                    "confidence":   confidence,
                    "isPlastic":    is_plastic,
                },
                timeout=10
            )
            print(f"[EVENT] {r2.status_code} {r2.text[:200]}")
            data = r2.json()

            self.result_valid  = is_plastic
            self.result_label  = classified_as
            self.result_conf   = confidence
            self.result_points = int(data.get("event", {}).get("pointsAwarded", 0))

            self.total_items += 1
            if self.result_valid:
                self.total_points   += self.result_points
                self.accepted_items += 1
                self.bottle_count   += 1
                self._save_bottle_count()
                threading.Thread(target=self._report_capacity_to_backend, daemon=True).start()

            self.state = "result"

        except requests.exceptions.ConnectionError:
            self.result_valid, self.result_label = False, "Backend unreachable"
            self.result_conf, self.result_points = 0, 0
            self.total_items += 1
            self.state = "result"
        except Exception as e:
            print(f"[CLASSIFY ERROR] {e}")
            self.result_valid, self.result_label = False, str(e)[:30]
            self.result_conf, self.result_points = 0, 0
            self.total_items += 1
            self.state = "result"

    # ─── RAPID MODE (tap-free continuous feeding) ────────────────────────────────
    def _start_feeding(self):
        self.event_queue    = self._load_queue()   # resume any unsent from a crash
        self.total_points   = 0
        self.total_items    = 0
        self.accepted_items = 0
        self.flash_until    = 0.0
        self.feed_hint      = "Place a plastic bottle in view..."
        self.feed_running   = True
        self.state          = "feeding"
        threading.Thread(target=self._feed_loop, daemon=True).start()

    def _classify_current_frame(self):
        """Capture one frame and classify via the LOCAL ML service.
        Returns {detected, is_plastic, label, confidence} or None on error.
        'detected' means the model saw a real object (plastic or not)."""
        try:
            arr = self.camera.capture_array("main")
            img = Image.fromarray(arr)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85)
            buf.seek(0)
            r = requests.post(
                f"{ML_SERVICE_URL}/classify",
                files={"file": ("item.jpg", buf, "image/jpeg")},
                timeout=30,
            )
            ml = r.json()
            label = ml.get("classifiedAs", "no_detection")
            conf  = float(ml.get("confidence", 0))
            detected = label not in ("no_detection", "error", "unknown") and conf >= LOW_CONF_SKIP
            return {"detected": detected, "is_plastic": bool(ml.get("isPlastic", False)),
                    "label": label, "confidence": conf}
        except Exception as e:
            print(f"[CLASSIFY] {e}")
            return None

    def _feed_loop(self):
        """Continuous, tap-free disposal. The ML model acts as the presence sensor:
        empty frames are skipped, and a 'must see an empty frame between items'
        debounce guarantees one count per bottle. To use a conveyor belt or an
        IR-beam / microswitch later, gate the capture on that sensor here — the
        queue, batching and UI all stay the same."""
        self.feeding_active = True
        armed = True
        empty_streak = 0
        try:
            while self.feed_running and self.state == "feeding":
                if self.bottle_count >= KIOSK_CAPACITY:
                    self._finish_session(full=True)
                    return

                res = self._classify_current_frame()
                if res is None:
                    self.feed_hint = "Camera/ML error — retrying..."
                    time.sleep(IDLE_POLL_INTERVAL)
                    continue

                if not res["detected"]:
                    empty_streak += 1
                    if empty_streak >= REARM_EMPTY_FRAMES:
                        armed = True
                    if time.time() > self.flash_until:
                        self.feed_hint = "Place a plastic bottle in view..."
                    time.sleep(IDLE_POLL_INTERVAL)
                    continue

                # An object is in view
                empty_streak = 0
                if not armed:
                    time.sleep(0.3)   # same item still there — wait for it to clear
                    continue

                # New item → count it exactly once
                armed = False
                self._record_feed_item(res)
                if len(self.event_queue) >= BATCH_FLUSH_EVERY:
                    threading.Thread(target=self._flush_events, daemon=True).start()
                time.sleep(RELOAD_DELAY)
        finally:
            self.feeding_active = False

    def _record_feed_item(self, res):
        is_plastic = res["is_plastic"]
        self._enqueue_event(res["label"], res["confidence"], is_plastic)
        self.total_items += 1
        self.result_valid = is_plastic
        self.result_label = res["label"]
        self.result_conf  = res["confidence"]
        if is_plastic:
            self.result_points   = POINTS_PER_DISPOSAL
            self.total_points   += POINTS_PER_DISPOSAL
            self.accepted_items += 1
            self.bottle_count   += 1
            self._save_bottle_count()
            threading.Thread(target=self._report_capacity_to_backend, daemon=True).start()
        else:
            self.result_points = 0
        self.flash_until = time.time() + 1.3

    # ─── EVENT QUEUE + BATCHED FLUSH ─────────────────────────────────────────────
    def _enqueue_event(self, label, confidence, is_plastic):
        with self.queue_lock:
            self.event_queue.append({"classifiedAs": label, "confidence": confidence, "isPlastic": is_plastic})
        self._save_queue()

    def _save_queue(self):
        # Hold the lock for the whole write so concurrent saves can't corrupt the file.
        # (Callers must NOT already hold queue_lock — Lock is not reentrant.)
        try:
            with self.queue_lock:
                data = {"sessionId": self.session_id, "events": list(self.event_queue)}
                with open(EVENT_QUEUE_FILE, "w") as f:
                    json.dump(data, f)
        except Exception as e:
            print(f"[QUEUE] save error: {e}")

    def _load_queue(self):
        """Resume events queued but never sent (e.g. power loss mid-session)."""
        try:
            with open(EVENT_QUEUE_FILE) as f:
                data = json.load(f)
            if data.get("sessionId") == self.session_id:
                return data.get("events", [])
        except Exception:
            pass
        return []

    def _flush_events(self):
        """Send queued events to the backend in one batch; keep them on failure to retry."""
        with self.queue_lock:
            batch = list(self.event_queue)
        if not batch or not self.session_id:
            return
        try:
            r = requests.post(
                f"{BACKEND_URL}/api/disposal/events/batch",
                json={"sessionId": self.session_id, "events": batch},
                timeout=15,
            )
            if r.status_code in (200, 201):
                with self.queue_lock:
                    self.event_queue = self.event_queue[len(batch):]
                self._save_queue()
                print(f"[BATCH] flushed {len(batch)} events")
            else:
                print(f"[BATCH] server {r.status_code}: {r.text[:120]}")
        except Exception as e:
            print(f"[BATCH] flush error: {e}")

    def _finish_session(self, full=False):
        """Stop feeding, flush remaining events, end the session on the backend, reset."""
        self.feed_running = False
        # let the feed loop exit its current iteration before the final flush
        for _ in range(20):
            if not self.feeding_active:
                break
            time.sleep(0.05)

        self._flush_events()   # final synchronous flush so backend totals are complete

        try:
            r = requests.post(
                f"{BACKEND_URL}/api/disposal/sessions/end",
                json={"sessionId": self.session_id}, timeout=8,
            )
            data = r.json()
            final_pts = data.get("session", {}).get("totalPoints", self.total_points)
            self.status_msg   = f"Done! {self.accepted_items} bottles · {final_pts} pts earned."
            self.status_color = GREEN_BRIGHT
        except Exception as e:
            print(f"[END ERROR] {e}")
            self.status_msg   = "Session closed."
            self.status_color = GRAY_LIGHT

        # only clear the on-disk queue if everything was sent
        with self.queue_lock:
            leftover = len(self.event_queue)
        if leftover == 0:
            try:
                if os.path.exists(EVENT_QUEUE_FILE):
                    os.remove(EVENT_QUEUE_FILE)
            except Exception:
                pass

        self.session_id     = None
        self.user_code      = ""
        self.user_name      = ""
        self.total_points   = 0
        self.total_items    = 0
        self.accepted_items = 0
        self.state = "full" if (full or self.bottle_count >= KIOSK_CAPACITY) else "home"

    def api_end_session(self):
        self.state = "loading"
        self.status_msg = "Ending session..."
        try:
            r = requests.post(
                f"{BACKEND_URL}/api/disposal/sessions/end",
                json={"sessionId": self.session_id}, timeout=8
            )
            print(f"[END] {r.status_code} {r.text[:200]}")
            data = r.json()
            final_pts = data.get("session", {}).get("totalPoints", self.total_points)
            self.status_msg   = f"Done! {self.accepted_items} items · {final_pts} pts earned."
            self.status_color = GREEN_BRIGHT
        except Exception as e:
            print(f"[END ERROR] {e}")
            self.status_msg   = "Session closed."
            self.status_color = GRAY_LIGHT

        self.session_id     = None
        self.user_code      = ""
        self.user_name      = ""
        self.user_id_input  = ""
        self.total_points   = 0
        self.total_items    = 0
        self.accepted_items = 0
        # Route to full screen if kiosk is now full
        self.state = "full" if self.bottle_count >= KIOSK_CAPACITY else "home"

    # ─── DRAW HELPERS ──────────────────────────────────────────────────────────
    def draw_text(self, text, font, color, x, y, center=False, right=False):
        surf = font.render(str(text), True, color)
        rect = surf.get_rect()
        if center:
            rect.centerx = x
            rect.top = y
        elif right:
            rect.right = x
            rect.top = y
        else:
            rect.topleft = (x, y)
        self.screen.blit(surf, rect)
        return rect

    def draw_button(self, label, x, y, w, h, bg, fg=BLACK, radius=8):
        pygame.draw.rect(self.screen, bg, (x, y, w, h), border_radius=radius)
        surf = self.f_md.render(label, True, fg)
        self.screen.blit(surf, surf.get_rect(center=(x + w // 2, y + h // 2)))
        return pygame.Rect(x, y, w, h)

    def draw_scanline_bg(self):
        self.screen.fill(BG_DARK)
        for yy in range(0, SCREEN_H, 4):
            pygame.draw.line(self.screen, (0, 60, 20), (0, yy), (SCREEN_W, yy))

    def draw_header_bar(self, title, show_user=False):
        pygame.draw.rect(self.screen, BG_CARD, (0, 0, SCREEN_W, 36))
        pygame.draw.line(self.screen, GREEN_DIM, (0, 36), (SCREEN_W, 36), 1)
        pygame.draw.circle(self.screen, GREEN_BRIGHT, (14, 18), 5)
        pygame.draw.circle(self.screen, BG_DARK, (14, 18), 2)
        self.draw_text("ECOLENS", self.f_sm, GREEN_BRIGHT, 24, 12)
        self.draw_text(title, self.f_sm, GRAY_LIGHT, SCREEN_W // 2, 12, center=True)
        if show_user and self.user_code:
            self.draw_text(self.user_code, self.f_sm, TEAL, SCREEN_W - 8, 12, right=True)

    def draw_capacity_bar(self, x, y, w, h):
        pct   = min(self.bottle_count / KIOSK_CAPACITY, 1.0)
        fill  = int(w * pct)
        color = GREEN_BRIGHT if pct < 0.7 else (AMBER if pct < 0.9 else RED_BRIGHT)
        pygame.draw.rect(self.screen, BG_CARD, (x, y, w, h), border_radius=3)
        if fill > 0:
            pygame.draw.rect(self.screen, color, (x, y, fill, h), border_radius=3)
        pygame.draw.rect(self.screen, GRAY, (x, y, w, h), 1, border_radius=3)
        self.draw_text(f"Bin {self.bottle_count}/{KIOSK_CAPACITY}", self.f_xs, GRAY_LIGHT, x + w + 6, y)

    # ─── SCREENS ───────────────────────────────────────────────────────────────
    def render_home(self):
        self.draw_scanline_bg()
        self.draw_header_bar("SMART RECYCLING KIOSK")

        # ── Left: QR code on a white card ──
        card_x, card_y, card_sz = 24, 56, 190
        pygame.draw.rect(self.screen, WHITE, (card_x, card_y, card_sz, card_sz), border_radius=10)
        if self.qr_surface:
            qr_rect = self.qr_surface.get_rect(center=(card_x + card_sz // 2, card_y + card_sz // 2))
            self.screen.blit(self.qr_surface, qr_rect)
        else:
            self.draw_text("QR", self.f_xl, BLACK, card_x + card_sz // 2, card_y + card_sz // 2 - 16, center=True)

        # ── Right: instructions ──
        rx = 234
        self.draw_text("SCAN TO START", self.f_lg, GREEN_BRIGHT, rx, 54)
        steps = [
            "1  Open the EcoLens app",
            "2  Tap the Scan tab",
            "3  Point at this QR code",
            "4  Dispose & earn points",
        ]
        for i, s in enumerate(steps):
            self.draw_text(s, self.f_sm, WHITE, rx, 88 + i * 26)

        # Animated "waiting" hint
        dots = "." * (1 + (self.anim_tick // 20) % 3)
        self.draw_text(f"Waiting for scan{dots}", self.f_xs, TEAL, rx, 198)

        if self.status_msg:
            self.draw_text(self.status_msg, self.f_xs, self.status_color, rx, 222)

        # ── Bottom: capacity bar ──
        self.draw_capacity_bar(card_x, card_y + card_sz + 8, card_sz, 10)
        self.kb_rects = {}

    def render_session(self):
        self.draw_scanline_bg()
        self.draw_header_bar("ACTIVE SESSION", show_user=True)

        # Stats bar
        pygame.draw.rect(self.screen, BG_CARD, (0, 37, SCREEN_W, 30))
        self.draw_text(f"Scanned: {self.total_items}",   self.f_sm, GRAY_LIGHT,   8, 46)
        self.draw_text(f"Accepted: {self.accepted_items}", self.f_sm, GREEN_BRIGHT, 130, 46)
        self.draw_text(f"Points: {self.total_points}",   self.f_sm, AMBER,        280, 46)
        pygame.draw.line(self.screen, GREEN_DIM, (0, 67), (SCREEN_W, 67), 1)

        # Camera preview area
        cam_x, cam_y, cam_w, cam_h = 10, 75, 190, 138
        pulse_c = int(30 + 20 * self.pulse)
        pygame.draw.rect(self.screen, (0, pulse_c, 12), (cam_x, cam_y, cam_w, cam_h), border_radius=6)
        pygame.draw.rect(self.screen, GREEN_DIM,         (cam_x, cam_y, cam_w, cam_h), 1, border_radius=6)
        self.draw_text("[ CAMERA ]",        self.f_sm, GREEN_DIM, cam_x + cam_w // 2, cam_y + 52, center=True)
        self.draw_text("Place item in view", self.f_sm, GRAY,     cam_x + cam_w // 2, cam_y + 72, center=True)
        self.draw_text("then tap DISPOSE",  self.f_sm, GRAY,     cam_x + cam_w // 2, cam_y + 90, center=True)

        # Capacity bar below camera
        self.draw_capacity_bar(cam_x, cam_y + cam_h + 5, cam_w, 10)

        # Action buttons
        bx = 212
        self.btn_dispose = self.draw_button("DISPOSE",     bx, 78, 260, 52, GREEN_BRIGHT, BLACK, radius=8)
        self.btn_end     = self.draw_button("END SESSION", bx, 142, 260, 38, RED_DIM, WHITE, radius=8)

        self.draw_text("1. Place item in camera view", self.f_xs, GRAY_LIGHT, bx, 192)
        self.draw_text("2. Tap DISPOSE",               self.f_xs, GRAY_LIGHT, bx, 206)
        self.draw_text("3. Wait for result",           self.f_xs, GRAY_LIGHT, bx, 220)

        pygame.draw.line(self.screen, GREEN_DIM, (0, 258), (SCREEN_W, 258), 1)
        self.draw_text("Session in progress — dispose items one at a time",
                       self.f_xs, GRAY, SCREEN_W // 2, 265, center=True)

    def render_capturing(self):
        self.draw_scanline_bg()
        self.draw_header_bar("ANALYSING")
        cx, cy = SCREEN_W // 2, 138
        for i in range(3):
            r      = 30 + i * 15
            offset = (self.anim_tick * (2 + i)) % 360
            start  = math.radians(offset)
            end    = math.radians(offset + 240)
            pts    = [(cx + r * math.cos(start + (end - start) * s / 60),
                       cy + r * math.sin(start + (end - start) * s / 60))
                      for s in range(60)]
            if len(pts) > 1:
                pygame.draw.lines(self.screen, GREEN_BRIGHT, False, pts, 2)
        self.draw_text("Analysing item...",  self.f_lg, WHITE,      cx, 185, center=True)
        self.draw_text("Please hold still.", self.f_sm, GRAY_LIGHT, cx, 213, center=True)
        for i in range(5):
            lit = ((self.anim_tick // 8) % 5) == i
            pygame.draw.circle(self.screen,
                                GREEN_BRIGHT if lit else GRAY,
                                (cx - 40 + i * 20, 246),
                                5 if lit else 4)

    def render_result(self):
        self.draw_scanline_bg()
        self.draw_header_bar("RESULT", show_user=True)

        if self.result_valid:
            main_color, bg_color = GREEN_BRIGHT, (0, 40, 20)
            icon, headline = "OK", "ACCEPTED"
        else:
            main_color, bg_color = RED_BRIGHT, (40, 10, 10)
            icon, headline = "X", "REJECTED"

        pygame.draw.rect(self.screen, bg_color,   (12, 42, SCREEN_W - 24, 116), border_radius=10)
        pygame.draw.rect(self.screen, main_color, (12, 42, SCREEN_W - 24, 116), 2, border_radius=10)
        self.draw_text(icon,                             self.f_xl, main_color, 36,          66)
        self.draw_text(headline,                         self.f_lg, main_color, 80,          58)
        self.draw_text(f"Item: {self.result_label.upper()}", self.f_md, WHITE,  80,          88)
        conf_pct = f"{self.result_conf * 100:.0f}%" if self.result_conf <= 1 else f"{self.result_conf:.0f}%"
        self.draw_text(f"Confidence: {conf_pct}",        self.f_sm, GRAY_LIGHT, 80,         112)
        if self.result_valid:
            self.draw_text(f"+{self.result_points} pts", self.f_lg, AMBER,  SCREEN_W - 70,  66)
            self.draw_text(f"Total: {self.total_points}", self.f_sm, GRAY_LIGHT, SCREEN_W - 70, 98)

        # Buttons
        is_now_full = self.result_valid and self.bottle_count >= KIOSK_CAPACITY
        if is_now_full:
            # Disable dispose again — kiosk is full
            pygame.draw.rect(self.screen, (30, 30, 30), (12, 172, 210, 42), border_radius=8)
            pygame.draw.rect(self.screen, GRAY,         (12, 172, 210, 42), 1, border_radius=8)
            self.draw_text("KIOSK FULL", self.f_md, GRAY, 12 + 105, 172 + 13, center=True)
            self.btn_dispose_again = None
        else:
            self.btn_dispose_again = self.draw_button(
                "DISPOSE AGAIN", 12, 172, 210, 42, GREEN_DIM, WHITE, radius=8)

        self.btn_end_from_result = self.draw_button(
            "END SESSION", 234, 172, 234, 42, RED_DIM, WHITE, radius=8)

        # Footer bar
        pygame.draw.rect(self.screen, BG_CARD, (0, 228, SCREEN_W, 32))
        pygame.draw.line(self.screen, GREEN_DIM, (0, 228), (SCREEN_W, 228), 1)
        rem = KIOSK_CAPACITY - self.bottle_count
        self.draw_text(
            f"Bin: {self.bottle_count}/{KIOSK_CAPACITY}  ·  "
            f"{rem} slot{'s' if rem != 1 else ''} remaining",
            self.f_xs, GRAY_LIGHT, SCREEN_W // 2, 236, center=True)
        self.draw_text(
            f"Session: {self.accepted_items} accepted  ·  {self.total_points} pts",
            self.f_xs, GRAY_LIGHT, SCREEN_W // 2, 250, center=True)
        if not is_now_full:
            self.draw_text(
                "Tap DISPOSE AGAIN or END SESSION",
                self.f_xs, GRAY, SCREEN_W // 2, 264, center=True)

    def render_full(self):
        self.draw_scanline_bg()
        self.draw_header_bar("KIOSK STATUS")

        # Auto-poll every 60 s
        if time.time() - self.last_full_check > 60:
            threading.Thread(target=self._check_if_admin_reset, daemon=True).start()

        cx = SCREEN_W // 2
        pygame.draw.rect(self.screen, (50, 10, 10), (cx - 70, 46, 140, 72), border_radius=10)
        pygame.draw.rect(self.screen, RED_BRIGHT,   (cx - 70, 46, 140, 72), 2, border_radius=10)
        self.draw_text("!",    self.f_xl, RED_BRIGHT, cx, 52, center=True)
        self.draw_text("FULL", self.f_lg, RED_BRIGHT, cx, 90, center=True)

        self.draw_text("KIOSK IS AT CAPACITY",                     self.f_md, WHITE,      cx, 132, center=True)
        self.draw_text(f"{self.bottle_count} of {KIOSK_CAPACITY} bottles collected.",
                       self.f_sm, GRAY_LIGHT, cx, 154, center=True)
        self.draw_text("Contact admin to empty this unit.",         self.f_sm, GRAY_LIGHT, cx, 170, center=True)

        if UNIT_ID != "YOUR-UNIT-UUID-HERE":
            self.draw_text(f"Unit ID: {UNIT_ID[:8]}...", self.f_xs, GRAY, cx, 188, center=True)

        # Manual check button
        self.btn_check_status = self.draw_button(
            "Check Status", cx - 80, 206, 160, 36, BG_CARD, TEAL, radius=8)
        pygame.draw.rect(self.screen, TEAL, (cx - 80, 206, 160, 36), 1, border_radius=8)

        elapsed    = int(time.time() - self.last_full_check)
        if elapsed < 5:
            check_txt = "Checking..."
        else:
            next_auto = max(0, 60 - elapsed)
            check_txt = f"Auto-check in {next_auto}s"
        self.draw_text(check_txt, self.f_xs, GRAY, cx, 254, center=True)
        self.draw_text("Admin: reset via EcoLens dashboard → kiosk → Reset Capacity",
                       self.f_xs, GRAY, cx, 270, center=True)

    def render_feeding(self):
        self.draw_scanline_bg()
        self.draw_header_bar("DISPOSING", show_user=True)

        # Live tally bar
        pygame.draw.rect(self.screen, BG_CARD, (0, 37, SCREEN_W, 30))
        self.draw_text(f"Scanned: {self.total_items}",     self.f_sm, GRAY_LIGHT,   8, 46)
        self.draw_text(f"Accepted: {self.accepted_items}", self.f_sm, GREEN_BRIGHT, 150, 46)
        self.draw_text(f"Points: {self.total_points}",     self.f_sm, AMBER,        300, 46)
        pygame.draw.line(self.screen, GREEN_DIM, (0, 67), (SCREEN_W, 67), 1)

        # Main area: flash the last result, otherwise a pulsing "ready" prompt
        if time.time() < self.flash_until:
            if self.result_valid:
                mc, bg, head = GREEN_BRIGHT, (0, 40, 20), "ACCEPTED"
            else:
                mc, bg, head = RED_BRIGHT, (40, 10, 10), "REJECTED"
            pygame.draw.rect(self.screen, bg, (12, 76, SCREEN_W - 24, 100), border_radius=12)
            pygame.draw.rect(self.screen, mc, (12, 76, SCREEN_W - 24, 100), 2, border_radius=12)
            self.draw_text(head, self.f_xl, mc, SCREEN_W // 2, 88, center=True)
            self.draw_text(self.result_label.upper(), self.f_md, WHITE, SCREEN_W // 2, 124, center=True)
            if self.result_valid:
                self.draw_text(f"+{self.result_points} pts", self.f_lg, AMBER, SCREEN_W // 2, 146, center=True)
        else:
            cx, cy = SCREEN_W // 2, 116
            pygame.draw.circle(self.screen, GREEN_DIM, (cx, cy), 34 + int(6 * self.pulse), 3)
            pygame.draw.circle(self.screen, GREEN_BRIGHT, (cx, cy), 6)
            self.draw_text("READY", self.f_sm, GREEN_BRIGHT, cx, cy + 42, center=True)
            self.draw_text(self.feed_hint, self.f_sm, GRAY_LIGHT, cx, cy + 60, center=True)

        # Capacity bar + END button
        self.draw_capacity_bar(12, 198, 240, 12)
        self.btn_feed_end = self.draw_button("END SESSION", 336, 188, 132, 34, RED_DIM, WHITE, radius=8)

        # sync indicator (events still queued for the backend)
        with self.queue_lock:
            pending = len(self.event_queue)
        if pending:
            self.draw_text(f"syncing {pending}...", self.f_xs, TEAL, SCREEN_W - 8, 218, right=True)

        pygame.draw.line(self.screen, GREEN_DIM, (0, 232), (SCREEN_W, 232), 1)
        self.draw_text("Keep inserting bottles one after another — no tapping needed.",
                       self.f_xs, GRAY_LIGHT, SCREEN_W // 2, 240, center=True)
        rem = KIOSK_CAPACITY - self.bottle_count
        self.draw_text(f"{rem} slot{'s' if rem != 1 else ''} left  ·  Tap END SESSION when finished",
                       self.f_xs, GRAY, SCREEN_W // 2, 256, center=True)

    def render_loading(self):
        self.draw_scanline_bg()
        self.draw_header_bar("PLEASE WAIT")
        self.draw_text(self.status_msg, self.f_lg, WHITE, SCREEN_W // 2, 126, center=True)
        cx, cy = SCREEN_W // 2, 186
        for i in range(8):
            angle = math.radians(i * 45 + self.anim_tick * 4)
            x = cx + int(22 * math.cos(angle))
            y = cy + int(22 * math.sin(angle))
            v = max(60, 255 - i * 28)
            pygame.draw.circle(self.screen, (0, v, v // 2), (x, y), 4 if i == 0 else 3)

    # ─── INPUT ─────────────────────────────────────────────────────────────────
    def handle_key(self, event):
        # Manual code entry has been replaced by QR scanning from the mobile app,
        # so keyboard input on the home screen is ignored. (ESC-to-quit is handled
        # in run().)
        return

    def handle_click(self, pos):
        mx, my = pos

        if self.state == "home":
            pass  # Home is scan-only now; the QR is read by the user's phone.

        elif self.state == "session":
            if hasattr(self, "btn_dispose") and self.btn_dispose.collidepoint(mx, my):
                if self.bottle_count >= KIOSK_CAPACITY:
                    self.state = "full"
                else:
                    threading.Thread(target=self.api_capture_and_classify, daemon=True).start()
            elif hasattr(self, "btn_end") and self.btn_end.collidepoint(mx, my):
                threading.Thread(target=self.api_end_session, daemon=True).start()

        elif self.state == "result":
            if self.btn_dispose_again and self.btn_dispose_again.collidepoint(mx, my):
                # Go back to session screen; user positions item before tapping DISPOSE
                self.state = "session"
            elif self.btn_end_from_result and self.btn_end_from_result.collidepoint(mx, my):
                threading.Thread(target=self.api_end_session, daemon=True).start()

        elif self.state == "feeding":
            if self.btn_feed_end and self.btn_feed_end.collidepoint(mx, my):
                threading.Thread(target=self._finish_session, daemon=True).start()

        elif self.state == "full":
            if self.btn_check_status and self.btn_check_status.collidepoint(mx, my):
                self.last_full_check = time.time()
                threading.Thread(target=self._check_if_admin_reset, daemon=True).start()

    # ─── MAIN LOOP ─────────────────────────────────────────────────────────────
    def run(self):
        if self.bottle_count >= KIOSK_CAPACITY:
            self.state = "full"

        while True:
            self.anim_tick += 1
            self.pulse     += 0.04 * self.pulse_dir
            if self.pulse >= 1.0 or self.pulse <= 0.0:
                self.pulse_dir *= -1

            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    self.cleanup()
                if event.type == pygame.KEYDOWN:
                    if event.key == pygame.K_ESCAPE:
                        self.cleanup()
                    self.handle_key(event)
                if event.type == pygame.MOUSEBUTTONDOWN:
                    self.handle_click(event.pos)
                if event.type == pygame.FINGERDOWN:
                    self.handle_click((int(event.x * SCREEN_W), int(event.y * SCREEN_H)))

            {
                "home":      self.render_home,
                "session":   self.render_session,
                "capturing": self.render_capturing,
                "result":    self.render_result,
                "feeding":   self.render_feeding,
                "full":      self.render_full,
                "loading":   self.render_loading,
            }.get(self.state, self.render_home)()

            pygame.display.flip()
            self.clock.tick(FPS)

    def cleanup(self):
        if self.camera:
            try:
                self.camera.stop()
            except Exception:
                pass
        pygame.quit()
        sys.exit()


if __name__ == "__main__":
    kiosk = EcoLensKiosk()
    kiosk.run()
