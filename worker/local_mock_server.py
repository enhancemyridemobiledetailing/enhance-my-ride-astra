#!/usr/bin/env python3
"""Loopback-only browser preview for the Worker booking flow; never sends email."""

import base64
import datetime as dt
import email.policy
import json
import mimetypes
import os
import re
import sqlite3
import uuid
from email.parser import BytesParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
SITE = HERE.parent / "site"
STATE = HERE / ".local"
DB_PATH = STATE / "mock-d1.sqlite3"
R2_ROOT = STATE / "mock-r2"
OUTBOX_PATH = STATE / "mock-resend-outbox.jsonl"
HOST = "127.0.0.1"
PORT = 8770
MAX_BODY_BYTES = 12 * 1024 * 1024
MAX_PHOTO_BYTES = 8 * 1024 * 1024
MAX_PHOTOS = 5
PACKAGE_VALUES = {
    "Enhance Gold", "Enhance Black Label", "Showroom Edition",
    "Specialty service — custom quote", "Not sure yet",
}
TIME_VALUES = {"Flexible", "8 AM – 10 AM", "10 AM – 12 PM", "12 PM – 2 PM", "2 PM – 4 PM", "4 PM – 6 PM"}
IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif"}


def connect_db():
    STATE.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.executescript("""
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE,
        customer_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL,
        service_location TEXT NOT NULL, vehicle TEXT NOT NULL, package TEXT NOT NULL,
        preferred_date TEXT, preferred_time TEXT, condition_notes TEXT,
        status TEXT NOT NULL, notification_status TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS booking_photos (
        id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        object_key TEXT NOT NULL UNIQUE, original_name TEXT NOT NULL,
        content_type TEXT NOT NULL, byte_size INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS booking_rate_limits (
        client_key TEXT NOT NULL, window_start TEXT NOT NULL, hit_count INTEGER NOT NULL,
        PRIMARY KEY(client_key, window_start)
      );
    """)
    return db


def image_extension(content_type, data):
    if content_type == "image/jpeg" and data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if content_type == "image/png" and data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if content_type == "image/webp" and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if content_type in ("image/heic", "image/heif") and data[4:8] == b"ftyp" and data[8:12] in (b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"):
        return IMAGE_TYPES[content_type]
    return None


def safe_filename(name, extension):
    base = re.sub(r"[^a-zA-Z0-9._-]+", "_", (name or "vehicle-photo"))
    base = base.lstrip(".")[:70] or "vehicle-photo"
    base = re.sub(r"\.[^.]*$", "", base)
    return f"{base}.{extension}"


class PreviewHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        super().end_headers()

    def log_message(self, fmt, *args):
        print("[local-preview] " + (fmt % args), flush=True)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/config":
            return self.send_json(200, {"ok": True, "mode": "local_mock", "turnstileSiteKey": "", "maxPhotos": MAX_PHOTOS, "maxPhotoBytes": MAX_PHOTO_BYTES})
        if path == "/api/health":
            return self.send_json(200, {"ok": True, "mode": "local_mock", "bindings": {"d1": "sqlite mock", "r2": "local private file mock", "turnstile": "fixed local test token", "resend": "JSONL mock outbox"}})
        return super().do_GET()

    def do_POST(self):
        if urlsplit(self.path).path != "/api/bookings":
            return self.send_json(404, {"ok": False, "error": "not_found"})
        expected_origin = f"http://{self.headers.get('Host', '')}"
        if self.headers.get("Origin") != expected_origin or not expected_origin.startswith("http://127.0.0.1:"):
            return self.send_json(403, {"ok": False, "error": "origin_not_allowed"})
        content_type = self.headers.get("Content-Type", "")
        if not content_type.lower().startswith("multipart/form-data;"):
            return self.send_json(415, {"ok": False, "error": "multipart_required"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.send_json(400, {"ok": False, "error": "invalid_content_length"})
        if length <= 0 or length > MAX_BODY_BYTES:
            return self.send_json(413, {"ok": False, "error": "request_too_large"})
        raw = self.rfile.read(length)
        message = BytesParser(policy=email.policy.default).parsebytes(
            b"Content-Type: " + content_type.encode("utf-8") + b"\r\nMIME-Version: 1.0\r\n\r\n" + raw
        )
        if not message.is_multipart():
            return self.send_json(400, {"ok": False, "error": "invalid_form_data"})

        fields = {}
        files = []
        for part in message.iter_parts():
            name = part.get_param("name", header="content-disposition")
            if not name:
                continue
            payload = part.get_payload(decode=True) or b""
            filename = part.get_filename()
            if name == "photos" and filename:
                files.append({"name": filename, "type": part.get_content_type().lower(), "data": payload})
            else:
                charset = part.get_content_charset() or "utf-8"
                try:
                    value = payload.decode(charset)
                except (LookupError, UnicodeDecodeError):
                    value = ""
                fields[name] = value.strip()

        if fields.get("website"):
            return self.send_json(400, {"ok": False, "error": "invalid_submission"})
        if fields.get("turnstile_token") != "local-mock-pass":
            return self.send_json(403, {"ok": False, "error": "human_verification_failed"})
        booking, errors = validate_fields(fields)
        if errors:
            return self.send_json(422, {"ok": False, "error": "validation_failed", "fields": errors})
        photo_errors = validate_photos(files)
        if photo_errors:
            return self.send_json(422, {"ok": False, "error": "invalid_photos", "fields": photo_errors})

        now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        window = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H")
        client_key = "loopback"
        db = connect_db()
        try:
            db.execute("BEGIN IMMEDIATE")
            rate = db.execute("SELECT hit_count FROM booking_rate_limits WHERE client_key=? AND window_start=?", (client_key, window)).fetchone()
            if rate and rate["hit_count"] >= 20:
                db.rollback()
                return self.send_json(429, {"ok": False, "error": "rate_limit_exceeded"})
            db.execute("INSERT INTO booking_rate_limits(client_key,window_start,hit_count) VALUES(?,?,1) ON CONFLICT(client_key,window_start) DO UPDATE SET hit_count=hit_count+1", (client_key, window))
            existing = db.execute("SELECT * FROM bookings WHERE request_id=?", (booking["request_id"],)).fetchone()
            if existing:
                db.commit()
                return self.send_json(200, {"ok": True, "mode": "local_mock", "bookingId": existing["id"], "notification": "mocked", "duplicate": True})

            booking_id = str(uuid.uuid4())
            db.execute("""INSERT INTO bookings(id,request_id,customer_name,email,phone,service_location,vehicle,package,preferred_date,preferred_time,condition_notes,status,notification_status,created_at)
                          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
                booking_id, booking["request_id"], booking["name"], booking["email"], booking["phone"], booking["location"], booking["vehicle"], booking["package"], booking["preferred_date"], booking["preferred_time"], booking["condition"], "received", "mocked", now,
            ))
            photo_rows = []
            for item in files:
                extension = image_extension(item["type"], item["data"])
                filename = safe_filename(item["name"], extension)
                key = f"booking/{booking_id}/{uuid.uuid4()}.{extension}"
                target = R2_ROOT / key
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(item["data"])
                photo_rows.append((str(uuid.uuid4()), booking_id, key, filename, item["type"], len(item["data"]), target))
                db.execute("INSERT INTO booking_photos(id,booking_id,object_key,original_name,content_type,byte_size) VALUES(?,?,?,?,?,?)", photo_rows[-1][:6])
            db.commit()
            outbox = {"bookingId": booking_id, "to": "info@enhancemyride.com", "mocked": True, "sent": False, "attachmentNames": [row[3] for row in photo_rows], "createdAt": now}
            with OUTBOX_PATH.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(outbox, ensure_ascii=False) + "\n")
            return self.send_json(201, {"ok": True, "mode": "local_mock", "bookingId": booking_id, "notification": "mocked", "photoCount": len(photo_rows)})
        except sqlite3.IntegrityError:
            db.rollback()
            return self.send_json(409, {"ok": False, "error": "request_already_processing"})
        except Exception:
            db.rollback()
            return self.send_json(500, {"ok": False, "error": "local_mock_failed"})
        finally:
            db.close()

    def send_json(self, status, body):
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def validate_fields(fields):
    errors = {}
    request_id = fields.get("request_id", "")
    if not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", request_id, re.I):
        errors["request_id"] = "invalid"
    name = fields.get("name", "")[:120]
    if len(name) < 2:
        errors["name"] = "required"
    email_value = fields.get("email", "")[:254].lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email_value):
        errors["email"] = "invalid"
    phone = fields.get("phone", "")[:40]
    if len(re.sub(r"\D", "", phone)) < 7:
        errors["phone"] = "invalid"
    location = fields.get("location", "")[:120]
    if len(location) < 2:
        errors["location"] = "required"
    vehicle = fields.get("vehicle", "")[:140]
    if len(vehicle) < 2:
        errors["vehicle"] = "required"
    package = fields.get("package", "")[:100]
    if package not in PACKAGE_VALUES:
        errors["package"] = "invalid"
    preferred_date = fields.get("preferred_date", "")
    if preferred_date:
        try:
            date_value = dt.date.fromisoformat(preferred_date)
            if date_value.isoformat() != preferred_date or date_value < dt.datetime.now().date():
                errors["preferred_date"] = "invalid"
        except ValueError:
            errors["preferred_date"] = "invalid"
    preferred_time = fields.get("preferred_time", "")
    if preferred_time and preferred_time not in TIME_VALUES:
        errors["preferred_time"] = "invalid"
    condition = fields.get("condition", "")[:2500]
    if errors:
        return {}, errors
    return {"request_id": request_id, "name": name, "email": email_value, "phone": phone, "location": location, "vehicle": vehicle, "package": package, "preferred_date": preferred_date or None, "preferred_time": preferred_time or None, "condition": condition or None}, {}


def validate_photos(files):
    if len(files) > MAX_PHOTOS:
        return {"photos": "too_many"}
    if sum(len(item["data"]) for item in files) > MAX_PHOTO_BYTES:
        return {"photos": "too_large"}
    if any(image_extension(item["type"], item["data"]) is None for item in files):
        return {"photos": "invalid_image"}
    return {}


def main():
    if not SITE.is_dir():
        raise SystemExit(f"Static site directory missing: {SITE}")
    STATE.mkdir(parents=True, exist_ok=True)
    print(f"Local mock booking preview: http://{HOST}:{PORT}/", flush=True)
    print("Loopback only. D1/R2/Turnstile/Resend are mocked; no email is sent.", flush=True)
    ThreadingHTTPServer((HOST, PORT), PreviewHandler).serve_forever()


if __name__ == "__main__":
    main()
