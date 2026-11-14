const OWNER_EMAIL = "info@enhancemyride.com";
const PACKAGE_VALUES = new Set([
  "Enhance Gold",
  "Enhance Black Label",
  "Showroom Edition",
  "Specialty service — custom quote",
  "Not sure yet",
]);
const TIME_VALUES = new Set([
  "Flexible",
  "8 AM – 10 AM",
  "10 AM – 12 PM",
  "12 PM – 2 PM",
  "2 PM – 4 PM",
  "4 PM – 6 PM",
]);
const IMAGE_TYPES = new Map([
  ["image/jpeg", { extension: "jpg", signature: "jpeg" }],
  ["image/png", { extension: "png", signature: "png" }],
  ["image/webp", { extension: "webp", signature: "webp" }],
  ["image/heic", { extension: "heic", signature: "heif" }],
  ["image/heif", { extension: "heif", signature: "heif" }],
]);
const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const MAX_RETRIES = 12;
const DAILY_RETENTION_CRON = "2 12 * * *";
const DEFAULT_BOOKING_RETENTION_DAYS = 90;
const RETENTION_BATCH_SIZE = 100;

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
});

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function localMocksAllowed(request, env) {
  return env.LOCAL_MOCK_SERVICES === "true" && isLoopback(new URL(request.url).hostname);
}

function allowedOrigin(origin, env, local) {
  if (!origin) return false;
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean);
  if (allowed.includes(origin)) return true;
  if (!local) return false;
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && isLoopback(url.hostname);
  } catch {
    return false;
  }
}

function originHeaders(request, env, local) {
  const origin = request.headers.get("Origin");
  if (!allowedOrigin(origin, env, local)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

function serviceReady(env) {
  return Boolean(
    env.BOOKINGS_DB && env.BOOKING_PHOTOS && env.TURNSTILE_SITE_KEY &&
    env.TURNSTILE_SECRET_KEY && env.TURNSTILE_HOSTNAMES && env.RESEND_API_KEY && env.MAIL_FROM && env.RATE_LIMIT_SALT
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const local = localMocksAllowed(request, env);

    if (url.pathname === "/api/config" && request.method === "GET") {
      return json({
        ok: true,
        mode: local ? "local_mock" : (serviceReady(env) ? "live" : "setup_required"),
        turnstileSiteKey: local ? "" : (env.TURNSTILE_SITE_KEY || ""),
        maxPhotos: MAX_PHOTOS,
        maxPhotoBytes: MAX_PHOTO_BYTES,
      });
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        ok: true,
        mode: local ? "local_mock" : "worker",
        bindings: {
          d1: Boolean(env.BOOKINGS_DB),
          r2: Boolean(env.BOOKING_PHOTOS),
          turnstile: Boolean(env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY),
          resend: Boolean(env.RESEND_API_KEY && env.MAIL_FROM),
        },
      });
    }

    if (url.pathname === "/api/bookings") {
      if (request.method === "OPTIONS") {
        const headers = originHeaders(request, env, local);
        return headers ? new Response(null, { status: 204, headers }) : json({ ok: false, error: "origin_not_allowed" }, 403);
      }
      if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, { Allow: "POST, OPTIONS" });
      const headers = originHeaders(request, env, local);
      if (!headers) return json({ ok: false, error: "origin_not_allowed" }, 403);
      if (!local && !serviceReady(env)) return json({ ok: false, error: "booking_service_not_configured" }, 503, headers);
      const contentLength = Number(request.headers.get("Content-Length") || 0);
      if (contentLength > MAX_REQUEST_BYTES) return json({ ok: false, error: "request_too_large" }, 413, headers);

      const store = new D1BookingStore(env.BOOKINGS_DB);
      const dependencies = {
        env,
        store,
        isLocalMock: local,
        verifyTurnstile: token => verifyTurnstile(token, request, env, local),
        writePhoto: (key, bytes, contentType, bookingId) => env.BOOKING_PHOTOS.put(key, bytes, {
          httpMetadata: { contentType },
          customMetadata: { bookingId },
        }),
        deletePhoto: key => env.BOOKING_PHOTOS.delete(key),
        readPhoto: async key => {
          const object = await env.BOOKING_PHOTOS.get(key);
          if (!object) throw new Error("photo_object_missing");
          return new Uint8Array(await object.arrayBuffer());
        },
        sendEmail: local ? async () => ({ id: "local-mock-email" }) : (booking, photos) => sendResendEmail(booking, photos, env),
        rateLimit: (ipHash, hourBucket) => store.incrementRateLimit(ipHash, hourBucket, Number(env.RATE_LIMIT_PER_HOUR) || 5),
      };
      const result = await processBookingRequest(request, dependencies);
      return json(result.body, result.status, headers);
    }

    if (url.pathname.startsWith("/api/")) return json({ ok: false, error: "not_found" }, 404);
    if (env.ASSETS) {
      const assetRequest = url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")
        ? new Request(new URL("/index.html", url), request)
        : request;
      return env.ASSETS.fetch(assetRequest);
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller, env, ctx) {
    if (!env.BOOKINGS_DB || !env.BOOKING_PHOTOS) return;
    const store = new D1BookingStore(env.BOOKINGS_DB);
    if (controller.cron === DAILY_RETENTION_CRON) {
      ctx.waitUntil(purgeExpiredBookings(store, env.BOOKING_PHOTOS, {
        now: new Date(controller.scheduledTime),
        retentionDays: Number(env.BOOKING_RETENTION_DAYS) || DEFAULT_BOOKING_RETENTION_DAYS,
        batchSize: RETENTION_BATCH_SIZE,
      }));
      return;
    }
    if (env.RESEND_API_KEY && env.MAIL_FROM) ctx.waitUntil(retryPendingNotifications(store, env));
  },
};

export async function processBookingRequest(request, dependencies) {
  const { env, store, isLocalMock, verifyTurnstile, writePhoto, deletePhoto, readPhoto, sendEmail } = dependencies;
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) return result(415, { ok: false, error: "multipart_required" });

  let fields;
  try {
    fields = await request.formData();
  } catch {
    return result(400, { ok: false, error: "invalid_form_data" });
  }

  const honeypot = text(fields, "website", 200);
  if (honeypot) return result(400, { ok: false, error: "invalid_submission" });

  const booking = validateBookingFields(fields);
  if (!booking.ok) return result(422, { ok: false, error: "validation_failed", fields: booking.errors });

  const token = String(fields.get("cf-turnstile-response") || fields.get("turnstile_token") || "").trim();
  const human = await verifyTurnstile(token);
  if (!human) return result(403, { ok: false, error: "human_verification_failed" });

  const now = new Date().toISOString();
  const hourBucket = new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString();
  const ip = request.headers.get("CF-Connecting-IP") || "local-preview";
  const ipHash = await hashText(`${env.RATE_LIMIT_SALT || "local-only-salt"}:${ip}`);
  const allowed = await dependencies.rateLimit(ipHash, hourBucket);
  if (!allowed) return result(429, { ok: false, error: "rate_limit_exceeded" });

  const requestId = booking.value.requestId;
  let existing = await store.getBookingByRequestId(requestId);
  if (existing?.status === "received") {
    return result(200, { ok: true, bookingId: existing.id, notification: existing.notification_status, duplicate: true, mode: isLocalMock ? "local_mock" : "live" });
  }
  if (existing?.status === "processing") return result(409, { ok: false, error: "request_already_processing" });

  if (existing?.status === "notification_pending") {
    const stored = await store.getPhotos(existing.id);
    try {
      const photoBuffers = await Promise.all(stored.map(async photo => ({
        filename: photo.original_name,
        contentType: photo.content_type,
        bytes: await readPhoto(photo.object_key),
      })));
      const sendResult = await sendEmail(existing, photoBuffers);
      if (isLocalMock) await store.markNotificationMocked(existing.id, sendResult.id || "local-mock-email", now);
      else await store.markNotificationSent(existing.id, sendResult.id, now);
      return result(200, { ok: true, bookingId: existing.id, notification: isLocalMock ? "mocked" : "sent", mode: isLocalMock ? "local_mock" : "live" });
    } catch (error) {
      await store.markNotificationPending(existing.id, retryTime(existing.attempts || 0), safeErrorCode(error), now);
      return result(202, { ok: false, received: true, bookingId: existing.id, notification: "pending" });
    }
  }

  const photos = await readAndValidatePhotos(fields.getAll("photos"));
  if (!photos.ok) return result(422, { ok: false, error: "invalid_photos", fields: photos.errors });

  const bookingId = existing?.id || crypto.randomUUID();
  if (existing?.status === "upload_failed") {
    const oldPhotos = await store.getPhotos(existing.id);
    await Promise.all(oldPhotos.map(photo => deletePhoto(photo.object_key).catch(() => {})));
    await store.clearPhotos(existing.id);
    await store.resetBooking(existing.id, booking.value, now);
  } else {
    const inserted = await store.createBooking(bookingId, requestId, booking.value, now);
    if (!inserted) {
      const duplicate = await store.getBookingByRequestId(requestId);
      if (duplicate?.status === "received") return result(200, { ok: true, bookingId: duplicate.id, notification: duplicate.notification_status, duplicate: true, mode: isLocalMock ? "local_mock" : "live" });
      return result(409, { ok: false, error: "request_already_processing" });
    }
  }

  const uploadedKeys = [];
  try {
    for (const photo of photos.value) {
      const key = `booking/${bookingId}/${crypto.randomUUID()}.${photo.extension}`;
      await writePhoto(key, photo.bytes, photo.contentType, bookingId);
      uploadedKeys.push(key);
      await store.addPhoto(bookingId, key, photo.filename, photo.contentType, photo.bytes.byteLength, now);
    }
  } catch (error) {
    await Promise.all(uploadedKeys.map(key => deletePhoto(key).catch(() => {})));
    await store.clearPhotos(bookingId);
    await store.markUploadFailed(bookingId, now);
    return result(503, { ok: false, error: "photo_storage_failed" });
  }

  try {
    await store.createOutbox(bookingId, now);
    await store.markNotificationPending(bookingId, retryTime(0), null, now);
  } catch {
    await Promise.all(uploadedKeys.map(key => deletePhoto(key).catch(() => {})));
    await store.clearPhotos(bookingId);
    await store.markUploadFailed(bookingId, new Date().toISOString());
    return result(503, { ok: false, error: "booking_store_failed" });
  }
  existing = await store.getBookingById(bookingId);
  try {
    const sendResult = await sendEmail(existing, photos.value.map(photo => ({
      filename: photo.filename,
      contentType: photo.contentType,
      bytes: photo.bytes,
    })));
    if (isLocalMock) await store.markNotificationMocked(bookingId, sendResult.id || "local-mock-email", new Date().toISOString());
    else await store.markNotificationSent(bookingId, sendResult.id, new Date().toISOString());
    return result(201, { ok: true, bookingId, notification: isLocalMock ? "mocked" : "sent", mode: isLocalMock ? "local_mock" : "live" });
  } catch (error) {
    await store.markNotificationPending(bookingId, retryTime(0), safeErrorCode(error), new Date().toISOString());
    return result(202, { ok: false, received: true, bookingId, notification: "pending" });
  }
}

function result(status, body) { return { status, body }; }

export function validateBookingFields(fields) {
  const errors = {};
  const requestId = text(fields, "request_id", 80);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) errors.request_id = "invalid";
  const name = text(fields, "name", 120);
  if (name.length < 2) errors.name = "required";
  const email = text(fields, "email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "invalid";
  const phone = text(fields, "phone", 40);
  if (phone.replace(/\D/g, "").length < 7) errors.phone = "invalid";
  const location = text(fields, "location", 120);
  if (location.length < 2) errors.location = "required";
  const vehicle = text(fields, "vehicle", 140);
  if (vehicle.length < 2) errors.vehicle = "required";
  const packageName = text(fields, "package", 100);
  if (!PACKAGE_VALUES.has(packageName)) errors.package = "invalid";
  const preferredDate = text(fields, "preferred_date", 10);
  if (preferredDate && (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate) || !validDate(preferredDate) || preferredDate < pacificDate())) errors.preferred_date = "invalid";
  const preferredTime = text(fields, "preferred_time", 32);
  if (preferredTime && !TIME_VALUES.has(preferredTime)) errors.preferred_time = "invalid";
  const condition = text(fields, "condition", 2500);
  return Object.keys(errors).length ? { ok: false, errors } : {
    ok: true,
    value: { requestId, customerName: name, email, phone, location, vehicle, package: packageName, preferredDate: preferredDate || null, preferredTime: preferredTime || null, condition: condition || null },
  };
}

function text(fields, name, maxLength) {
  const value = fields.get(name);
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validDate(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function pacificDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export async function readAndValidatePhotos(entries) {
  const photos = entries.filter(item => item && typeof item === "object" && typeof item.arrayBuffer === "function" && item.size > 0);
  const errors = {};
  if (photos.length > MAX_PHOTOS) return { ok: false, errors: { photos: "too_many" } };
  let total = 0;
  const output = [];
  for (const photo of photos) {
    total += photo.size;
    const contentType = String(photo.type || "").toLowerCase();
    const kind = IMAGE_TYPES.get(contentType);
    if (!kind) { errors.photos = "unsupported_type"; continue; }
    const bytes = new Uint8Array(await photo.arrayBuffer());
    if (!validImageSignature(bytes, kind.signature)) { errors.photos = "invalid_image"; continue; }
    output.push({ filename: safeFilename(photo.name, kind.extension), contentType, extension: kind.extension, bytes });
  }
  if (total > MAX_PHOTO_BYTES) errors.photos = "too_large";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: output };
}

function validImageSignature(bytes, kind) {
  if (kind === "jpeg") return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (kind === "png") return bytes.length > 8 && bytes[0] === 0x89 && String.fromCharCode(...bytes.slice(1, 4)) === "PNG";
  if (kind === "webp") return bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (kind === "heif") return bytes.length > 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp" && /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(String.fromCharCode(...bytes.slice(8, 12)));
  return false;
}

function safeFilename(name, extension) {
  const base = String(name || "vehicle-photo").normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 70) || "vehicle-photo";
  return `${base.replace(/\.[^.]*$/, "")}.${extension}`;
}

export async function verifyTurnstile(token, request, env, local, fetchImpl = fetch) {
  if (local) return token === "local-mock-pass";
  if (!env.TURNSTILE_SECRET_KEY || !token) return false;
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  const remoteIp = request.headers.get("CF-Connecting-IP");
  if (remoteIp) form.set("remoteip", remoteIp);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form, signal: controller.signal });
    const result = await response.json();
    if (!response.ok || result.success !== true || result.action !== "booking_request") return false;
    const allowedHosts = String(env.TURNSTILE_HOSTNAMES || "").split(",").map(item => item.trim().toLowerCase()).filter(Boolean);
    return allowedHosts.length > 0 && allowedHosts.includes(String(result.hostname || "").toLowerCase());
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function hashText(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

class D1BookingStore {
  constructor(db) { this.db = db; }
  async getBookingByRequestId(id) { return this.db.prepare("SELECT * FROM bookings WHERE request_id = ?").bind(id).first(); }
  async getBookingById(id) { return this.db.prepare("SELECT * FROM bookings WHERE id = ?").bind(id).first(); }
  async createBooking(id, requestId, b, now) {
    const result = await this.db.prepare(`INSERT OR IGNORE INTO bookings
      (id, request_id, customer_name, email, phone, service_location, vehicle, package, preferred_date, preferred_time, condition_notes, status, notification_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', 'pending', ?, ?)`)
      .bind(id, requestId, b.customerName, b.email, b.phone, b.location, b.vehicle, b.package, b.preferredDate, b.preferredTime, b.condition, now, now).run();
    return (result.meta?.changes || 0) > 0;
  }
  async resetBooking(id, b, now) {
    await this.db.prepare(`UPDATE bookings SET customer_name=?, email=?, phone=?, service_location=?, vehicle=?, package=?, preferred_date=?, preferred_time=?, condition_notes=?, status='processing', notification_status='pending', updated_at=? WHERE id=?`)
      .bind(b.customerName, b.email, b.phone, b.location, b.vehicle, b.package, b.preferredDate, b.preferredTime, b.condition, now, id).run();
  }
  async addPhoto(bookingId, key, filename, contentType, byteSize, now) {
    await this.db.prepare("INSERT INTO booking_photos(id, booking_id, object_key, original_name, content_type, byte_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), bookingId, key, filename, contentType, byteSize, now).run();
  }
  async getPhotos(id) { return this.db.prepare("SELECT * FROM booking_photos WHERE booking_id=? ORDER BY created_at").bind(id).all().then(result => result.results || []); }
  async clearPhotos(id) { await this.db.prepare("DELETE FROM booking_photos WHERE booking_id=?").bind(id).run(); }
  async markUploadFailed(id, now) { await this.db.prepare("UPDATE bookings SET status='upload_failed', updated_at=? WHERE id=?").bind(now, id).run(); }
  async createOutbox(id, now) {
    await this.db.prepare("INSERT OR IGNORE INTO notification_outbox(booking_id, status, attempts, next_attempt_at, updated_at) VALUES (?, 'pending', 0, ?, ?)").bind(id, now, now).run();
  }
  async markNotificationPending(id, nextAt, errorCode, now) {
    await this.db.prepare(`UPDATE notification_outbox SET status='pending', attempts=attempts+1, next_attempt_at=?, last_error_code=?, updated_at=? WHERE booking_id=?`)
      .bind(nextAt, errorCode, now, id).run();
    await this.db.prepare("UPDATE bookings SET status='notification_pending', notification_status='pending', updated_at=? WHERE id=?").bind(now, id).run();
  }
  async markNotificationSent(id, emailId, now) {
    await this.db.prepare("UPDATE notification_outbox SET status='sent', resend_email_id=?, last_error_code=NULL, updated_at=? WHERE booking_id=?").bind(emailId, now, id).run();
    await this.db.prepare("UPDATE bookings SET status='received', notification_status='sent', updated_at=? WHERE id=?").bind(now, id).run();
  }
  async markNotificationMocked(id, mockId, now) {
    await this.db.prepare("UPDATE notification_outbox SET status='mocked', resend_email_id=?, last_error_code=NULL, updated_at=? WHERE booking_id=?").bind(mockId, now, id).run();
    await this.db.prepare("UPDATE bookings SET status='received', notification_status='mocked', updated_at=? WHERE id=?").bind(now, id).run();
  }
  async incrementRateLimit(ipHash, hourBucket, limit) {
    const row = await this.db.prepare(`INSERT INTO booking_rate_limits(ip_hash, window_started_at, hit_count) VALUES (?, ?, 1)
      ON CONFLICT(ip_hash) DO UPDATE SET hit_count=CASE WHEN booking_rate_limits.window_started_at=excluded.window_started_at THEN booking_rate_limits.hit_count+1 ELSE 1 END,
      window_started_at=excluded.window_started_at RETURNING hit_count`).bind(ipHash, hourBucket).first();
    return Number(row?.hit_count || 0) <= limit;
  }
  async findDue(now, limit = 10) {
    const result = await this.db.prepare(`SELECT b.*, o.attempts FROM notification_outbox o JOIN bookings b ON b.id=o.booking_id
      WHERE o.status='pending' AND o.next_attempt_at<=? AND o.attempts<? ORDER BY o.next_attempt_at LIMIT ?`)
      .bind(now, MAX_RETRIES, limit).all();
    return result.results || [];
  }
  async findExpiredBookingIds(cutoff, limit = RETENTION_BATCH_SIZE) {
    const result = await this.db.prepare("SELECT id FROM bookings WHERE created_at < ? ORDER BY created_at LIMIT ?")
      .bind(cutoff, limit).all();
    return result.results || [];
  }
  async deleteExpiredBooking(id, cutoff) {
    await this.db.prepare("DELETE FROM notification_outbox WHERE booking_id=?").bind(id).run();
    await this.db.prepare("DELETE FROM booking_photos WHERE booking_id=?").bind(id).run();
    const result = await this.db.prepare("DELETE FROM bookings WHERE id=? AND created_at < ?").bind(id, cutoff).run();
    return (result.meta?.changes || 0) > 0;
  }
  async clearExpiredRateLimits(cutoff) {
    await this.db.prepare("DELETE FROM booking_rate_limits WHERE window_started_at < ?").bind(cutoff).run();
  }
}

export async function purgeExpiredBookings(store, bucket, {
  now = new Date(),
  retentionDays = DEFAULT_BOOKING_RETENTION_DAYS,
  batchSize = RETENTION_BATCH_SIZE,
} = {}) {
  const days = Number.isInteger(retentionDays) && retentionDays > 0 ? retentionDays : DEFAULT_BOOKING_RETENTION_DAYS;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const rateLimitCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  await store.clearExpiredRateLimits(rateLimitCutoff);

  const expired = await store.findExpiredBookingIds(cutoff, batchSize);
  let deleted = 0;
  let failed = 0;
  for (const booking of expired) {
    try {
      const photos = await store.getPhotos(booking.id);
      const objectKeys = photos.map(photo => photo.object_key).filter(Boolean);
      if (objectKeys.length) await bucket.delete(objectKeys);
      if (await store.deleteExpiredBooking(booking.id, cutoff)) deleted++;
    } catch {
      // Leave the D1 record in place if R2 cleanup fails so the next daily run can retry it.
      failed++;
    }
  }
  return { cutoff, scanned: expired.length, deleted, failed };
}

export async function sendResendEmail(booking, photos, env, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) throw new Error("resend_not_configured");
  const display = {
    name: booking.customer_name,
    email: booking.email,
    phone: booking.phone,
    location: booking.service_location,
    vehicle: booking.vehicle,
    package: booking.package,
    date: booking.preferred_date || "Flexible",
    time: booking.preferred_time || "Flexible",
    notes: booking.condition_notes || "None provided",
  };
  const rows = Object.entries(display).map(([label, value]) => `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("");
  const attachments = photos.map(photo => ({ filename: photo.filename, content: bytesToBase64(photo.bytes) }));
  const payload = {
    from: env.MAIL_FROM,
    to: [OWNER_EMAIL],
    reply_to: booking.email,
    subject: `New detail request — ${display.vehicle}`,
    text: Object.entries(display).map(([label, value]) => `${label}: ${value}`).join("\n"),
    html: `<h2>New detail request</h2><table>${rows}</table><p>${photos.length} vehicle photo(s) attached.</p>`,
    attachments,
  };
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `booking-notification/${booking.id}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.id) throw new Error(`resend_http_${response.status}`);
  return { id: body.id };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function bytesToBase64(bytes) {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(binary);
}

function retryTime(attempts) {
  const delayMinutes = Math.min(5 * (2 ** Math.max(0, attempts)), 360);
  return new Date(Date.now() + delayMinutes * 60_000).toISOString();
}

function safeErrorCode(error) {
  const message = String(error?.message || "notification_failed");
  return /^[a-z0-9_-]{1,48}$/i.test(message) ? message : "notification_failed";
}

async function retryPendingNotifications(store, env) {
  const rows = await store.findDue(new Date().toISOString());
  for (const booking of rows) {
    try {
      const photos = await store.getPhotos(booking.id);
      const attachments = await Promise.all(photos.map(async photo => {
        const object = await env.BOOKING_PHOTOS.get(photo.object_key);
        if (!object) throw new Error("photo_object_missing");
        return { filename: photo.original_name, contentType: photo.content_type, bytes: new Uint8Array(await object.arrayBuffer()) };
      }));
      const sent = await sendResendEmail(booking, attachments, env);
      await store.markNotificationSent(booking.id, sent.id, new Date().toISOString());
    } catch (error) {
      if ((booking.attempts || 0) + 1 >= MAX_RETRIES) {
        await store.markNotificationPending(booking.id, new Date(Date.now() + 24 * 3600_000).toISOString(), safeErrorCode(error), new Date().toISOString());
      } else {
        await store.markNotificationPending(booking.id, retryTime(booking.attempts || 0), safeErrorCode(error), new Date().toISOString());
      }
    }
  }
}
