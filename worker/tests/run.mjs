import assert from "node:assert/strict";
import {
  processBookingRequest,
  purgeExpiredBookings,
  readAndValidatePhotos,
  sendResendEmail,
  validateBookingFields,
  verifyTurnstile,
} from "../src/index.js";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);

class MockFile {
  constructor(bytes, type, name) { this.bytes = new Uint8Array(bytes); this.type = type; this.name = name; this.size = this.bytes.length; }
  async arrayBuffer() { return this.bytes.slice().buffer; }
}

class MockFormData {
  values = new Map();
  append(name, value) { this.values.set(name, [...(this.values.get(name) || []), value]); }
  set(name, value) { this.values.set(name, [value]); }
  get(name) { return this.values.get(name)?.[0] ?? null; }
  getAll(name) { return this.values.get(name) || []; }
}

class MemoryStore {
  booking = null;
  photos = [];
  notifications = [];
  async getBookingByRequestId(id) { return this.booking?.request_id === id ? this.booking : null; }
  async getBookingById(id) { return this.booking?.id === id ? this.booking : null; }
  async createBooking(id, requestId, fields, now) {
    if (this.booking) return false;
    this.booking = { id, request_id: requestId, ...fields, status: "processing", created_at: now };
    return true;
  }
  async resetBooking(id, fields, now) { this.booking = { ...this.booking, ...fields, status: "processing", updated_at: now }; }
  async addPhoto(id, key, filename, contentType, size, now) { this.photos.push({ booking_id: id, object_key: key, original_name: filename, content_type: contentType, byte_size: size, created_at: now }); }
  async getPhotos() { return this.photos; }
  async clearPhotos() { this.photos = []; }
  async markUploadFailed(id) { this.booking.status = "upload_failed"; }
  async createOutbox() { this.notifications.push({ status: "pending" }); }
  async markNotificationPending(id, nextAt, code) { this.booking.status = "notification_pending"; this.booking.attempts = (this.booking.attempts || 0) + 1; this.booking.last_error_code = code; }
  async markNotificationSent(id, emailId) { this.booking.status = "received"; this.booking.notification_status = "sent"; this.booking.resend_email_id = emailId; }
  async markNotificationMocked(id, mockId) { this.booking.status = "received"; this.booking.notification_status = "mocked"; this.booking.resend_email_id = mockId; }
}

function formData({ token = "turnstile-test", requestId = "11111111-1111-4111-8111-111111111111", photos = [png] } = {}) {
  const data = new MockFormData();
  data.set("request_id", requestId);
  data.set("name", "Preview Customer");
  data.set("email", "preview@example.test");
  data.set("phone", "5105550123");
  data.set("location", "Alameda");
  data.set("vehicle", "2022 Preview SUV");
  data.set("package", "Enhance Gold");
  data.set("preferred_date", "2027-01-12");
  data.set("preferred_time", "10 AM – 12 PM");
  data.set("condition", "Test request only");
  data.set("cf-turnstile-response", token);
  data.set("website", "");
  photos.forEach((bytes, index) => data.append("photos", new MockFile(bytes, "image/png", `vehicle-${index + 1}.png`)));
  return data;
}

function request(data) {
  return { headers: { get: name => name === "Content-Type" ? "multipart/form-data; boundary=mock" : null }, formData: async () => data };
}

function dependencies(overrides = {}) {
  const store = overrides.store || new MemoryStore();
  const objects = new Map();
  return {
    env: { RATE_LIMIT_SALT: "test-salt" },
    store,
    isLocalMock: false,
    verifyTurnstile: async token => token === "turnstile-test",
    rateLimit: async () => true,
    writePhoto: async (key, bytes) => { objects.set(key, new Uint8Array(bytes)); },
    deletePhoto: async key => objects.delete(key),
    readPhoto: async key => objects.get(key),
    sendEmail: async () => ({ id: "mock-resend-id" }),
    ...overrides,
  };
}

const valid = validateBookingFields(new Map([
  ["request_id", "11111111-1111-4111-8111-111111111111"], ["name", "Preview Customer"],
  ["email", "preview@example.test"], ["phone", "5105550123"], ["location", "Alameda"],
  ["vehicle", "2022 Preview SUV"], ["package", "Enhance Gold"], ["preferred_date", "2027-01-12"],
  ["preferred_time", "10 AM – 12 PM"], ["condition", "Test request only"],
]));
assert.equal(valid.ok, true, "valid booking details pass field validation");
assert.equal(valid.value.preferredDate, "2027-01-12", "preferred date is retained");
assert.equal(valid.value.preferredTime, "10 AM – 12 PM", "preferred time is retained");

const goodStore = new MemoryStore();
const written = new Map();
let emailCalls = 0;
const goodDeps = dependencies({
  store: goodStore,
  writePhoto: async (key, bytes) => written.set(key, new Uint8Array(bytes)),
  readPhoto: async key => written.get(key),
  sendEmail: async (booking, attachments) => { emailCalls++; assert.equal(attachments.length, 2); assert.equal(booking.email, "preview@example.test"); return { id: "resend-mock-id" }; },
});
const success = await processBookingRequest(request(formData({ photos: [png, png] })), goodDeps);
assert.equal(success.status, 201);
assert.equal(success.body.ok, true);
assert.equal(success.body.notification, "sent");
assert.equal(goodStore.booking.status, "received");
assert.equal(goodStore.photos.length, 2, "both photos are catalogued");
assert.equal(emailCalls, 1, "one notification attempt is made");

const duplicate = await processBookingRequest(request(formData({ photos: [png, png] })), goodDeps);
assert.equal(duplicate.body.duplicate, true, "same request ID is idempotent after receipt");
assert.equal(emailCalls, 1, "duplicate request does not send another email");

const invalidStore = new MemoryStore();
const invalidResult = await processBookingRequest(request(formData({ token: "bad-token" })), dependencies({ store: invalidStore, verifyTurnstile: async token => token === "good-token" }));
assert.equal(invalidResult.status, 403, "invalid Turnstile token is rejected");
assert.equal(invalidStore.booking, null, "unverified requests are not stored");

const invalidPng = await readAndValidatePhotos([new MockFile(new TextEncoder().encode("not an image"), "image/png", "bad.png")]);
assert.equal(invalidPng.ok, false, "image MIME type without a matching file signature is rejected");
const tooMany = await readAndValidatePhotos(Array.from({ length: 6 }, (_, index) => new MockFile(png, "image/png", `p${index}.png`)));
assert.equal(tooMany.ok, false, "more than five photos are rejected");

let resendPayload;
let resendHeaders;
const resend = await sendResendEmail({
  id: "booking-test-id", customer_name: "Preview Customer", email: "preview@example.test", phone: "5105550123",
  service_location: "Alameda", vehicle: "2022 Preview SUV", package: "Enhance Gold", preferred_date: null,
  preferred_time: null, condition_notes: "Test only",
}, [{ filename: "vehicle.png", contentType: "image/png", bytes: png }], {
  RESEND_API_KEY: "test-only-secret", MAIL_FROM: "Enhance My Ride <bookings@example.test>",
}, async (url, options) => {
  assert.equal(url, "https://api.resend.com/emails");
  resendHeaders = options.headers;
  resendPayload = JSON.parse(options.body);
  return new Response(JSON.stringify({ id: "resend-test-id" }), { status: 200, headers: { "Content-Type": "application/json" } });
});
assert.equal(resend.id, "resend-test-id");
assert.deepEqual(resendPayload.to, ["info@enhancemyride.com"], "notification recipient is fixed");
assert.equal(resendPayload.attachments.length, 1, "photo is attached to notification");
assert.equal(resendPayload.reply_to, "preview@example.test");
assert.equal(resendHeaders["Idempotency-Key"], "booking-notification/booking-test-id");

let turnstileBody;
const mockTurnstileRequest = { headers: { get: () => null } };
const turnstileOk = await verifyTurnstile("good-token", mockTurnstileRequest, {
  TURNSTILE_SECRET_KEY: "server-only-test-secret", TURNSTILE_HOSTNAMES: "example.test",
}, false, async (url, options) => {
  assert.equal(url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  turnstileBody = new URLSearchParams(options.body);
  return new Response(JSON.stringify({ success: true, action: "booking_request", hostname: "example.test" }), { status: 200 });
});
assert.equal(turnstileOk, true);
assert.equal(turnstileBody.get("secret"), "server-only-test-secret");
assert.equal(await verifyTurnstile("bad-token", mockTurnstileRequest, { TURNSTILE_SECRET_KEY: "test" }, false, async () => new Response(JSON.stringify({ success: false }), { status: 200 })), false);
assert.equal(await verifyTurnstile("good-token", mockTurnstileRequest, { TURNSTILE_SECRET_KEY: "test" }, false, async () => new Response(JSON.stringify({ success: true, action: "booking_request", hostname: "example.test" }), { status: 200 })), false, "missing hostname allowlist fails closed");

const retentionNow = new Date("2026-11-13T12:02:00.000Z");
const retentionStore = {
  bookings: [
    { id: "expired-booking", created_at: new Date(retentionNow.getTime() - 91 * 86400000).toISOString() },
    { id: "recent-booking", created_at: new Date(retentionNow.getTime() - 89 * 86400000).toISOString() },
  ],
  photos: new Map([
    ["expired-booking", [{ object_key: "booking/expired/photo.jpg" }]],
    ["recent-booking", [{ object_key: "booking/recent/photo.jpg" }]],
  ]),
  clearedRateLimitCutoff: null,
  async clearExpiredRateLimits(cutoff) { this.clearedRateLimitCutoff = cutoff; },
  async findExpiredBookingIds(cutoff, limit) {
    return this.bookings.filter(booking => booking.created_at < cutoff).slice(0, limit).map(({ id }) => ({ id }));
  },
  async getPhotos(id) { return this.photos.get(id) || []; },
  async deleteExpiredBooking(id, cutoff) {
    const booking = this.bookings.find(item => item.id === id && item.created_at < cutoff);
    if (!booking) return false;
    this.bookings = this.bookings.filter(item => item.id !== id);
    this.photos.delete(id);
    return true;
  },
};
const removedKeys = [];
const retentionResult = await purgeExpiredBookings(retentionStore, {
  async delete(keys) { removedKeys.push(...keys); },
}, { now: retentionNow, retentionDays: 90, batchSize: 100 });
assert.equal(retentionResult.deleted, 1, "records older than 90 days are deleted");
assert.equal(retentionResult.failed, 0);
assert.deepEqual(removedKeys, ["booking/expired/photo.jpg"], "expired R2 photos are removed");
assert.deepEqual(retentionStore.bookings.map(({ id }) => id), ["recent-booking"], "recent bookings are retained");
assert.equal(retentionStore.clearedRateLimitCutoff, new Date(retentionNow.getTime() - 86400000).toISOString(), "hashed rate-limit entries older than 24 hours are pruned");

const failedRetentionStore = {
  bookings: [{ id: "keep-on-r2-error", created_at: new Date(retentionNow.getTime() - 91 * 86400000).toISOString() }],
  async clearExpiredRateLimits() {},
  async findExpiredBookingIds() { return [{ id: "keep-on-r2-error" }]; },
  async getPhotos() { return [{ object_key: "booking/keep-on-r2-error/photo.jpg" }]; },
  async deleteExpiredBooking() { throw new Error("must not delete D1 record before R2 cleanup"); },
};
const failedRetention = await purgeExpiredBookings(failedRetentionStore, {
  async delete() { throw new Error("simulated R2 failure"); },
}, { now: retentionNow });
assert.equal(failedRetention.failed, 1, "R2 failures are recorded for retry on the next daily run");
assert.equal(failedRetentionStore.bookings.length, 1, "booking data remains when photo deletion fails");

console.log("Worker mock tests passed: booking validation, Turnstile, photo checks, R2 writes and 90-day retention, Resend notification, and idempotency.");
