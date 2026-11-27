const test = require("node:test");
const assert = require("node:assert/strict");
const { createSubmissionHandler, createRecordName } = require("./submission");

const requestId = "18e452d6-0657-4e51-9079-c45c19f205ea";
const submission = {
    personOrCorp: "person",
    name: "테스트",
    ssn: "000000-0000001",
    phone: "010-1234-5678",
    area: "구리교문",
    familyTotalRequest: "yes",
    familyMembers: [{ name: "가족", percentage: "25.5" }],
    agree: true
};

function createMemoryDb() {
    const records = new Map();
    return {
        records,
        collection: () => ({ doc: id => id }),
        runTransaction: callback => callback({
            get: async ref => ({ exists: records.has(ref), data: () => records.get(ref) }),
            create: (ref, data) => records.set(ref, data)
        })
    };
}

function response() {
    return {
        headers: {},
        set(key, value) { this.headers[key] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
        end() { return this; }
    };
}

function request(body, options = {}) {
    const headers = { origin: "https://example.test", ...options.headers };
    return {
        method: options.method || "POST",
        body,
        get: name => headers[name.toLowerCase()]
    };
}

function handler(db, options = {}) {
    return createSubmissionHandler({
        db,
        serverTimestamp: options.serverTimestamp || (() => "timestamp"),
        getAllowedOrigins: () => "https://example.test",
        logger: { warn() {}, error() {} }
    });
}

async function call(fn, body, options) {
    const res = response();
    await fn(request(body, options), res);
    return res;
}

test("valid submissions are stored once; changed retries conflict", async () => {
    const db = createMemoryDb();
    const fn = handler(db);
    const body = { requestId, submission };
    assert.equal((await call(fn, body)).statusCode, 200);
    assert.equal((await call(fn, body)).statusCode, 200);
    assert.equal(db.records.size, 1);
    assert.deepEqual(db.records.get(requestId).submission, submission);
    assert.match(db.records.get(requestId).recordName, /^테스트_\d{14}$/);
    assert.equal((await call(fn, { requestId, submission: { ...submission, name: "다른 이름" } })).statusCode, 409);
    assert.equal(db.records.get(requestId).submission.name, "테스트");
});

test("invalid inputs, consent, personal number, and family data are rejected", async () => {
    const db = createMemoryDb();
    const fn = handler(db);
    const invalid = [
        { ...submission, agree: false },
        { ...submission, ssn: "000000-0000000" },
        { ...submission, phone: "123" },
        { ...submission, familyTotalRequest: "no" },
        { ...submission, familyMembers: [{ name: "가족", percentage: "abc" }] }
    ];
    for (const value of invalid) {
        assert.equal((await call(fn, { requestId, submission: value })).statusCode, 400);
    }
    assert.equal(db.records.size, 0);
    const corporate = { ...submission, personOrCorp: "corporation", ssn: "사업자번호", familyTotalRequest: "no", familyMembers: [] };
    assert.equal((await call(fn, { requestId, submission: corporate })).statusCode, 200);
});

test("origin and method are enforced and storage failures are surfaced", async () => {
    const db = createMemoryDb();
    const fn = handler(db);
    const body = { requestId, submission };
    assert.equal((await call(fn, body, { headers: { origin: "https://other.test" } })).statusCode, 403);
    assert.equal((await call(fn, body, { method: "OPTIONS" })).statusCode, 204);
    assert.equal((await call(fn, body, { method: "GET" })).statusCode, 405);
    assert.equal(db.records.size, 0);
    const failing = handler({ ...db, runTransaction: async () => { throw new Error("unavailable"); } });
    assert.equal((await call(failing, body)).statusCode, 500);
});

test("record name uses Korean local date and seconds", () => {
    assert.equal(createRecordName("테스트", new Date("2026-01-01T15:00:01Z")), "테스트_20260102000001");
});

test("Firestore emulator stores retries once and denies unauthenticated direct access", {
    skip: !process.env.FIRESTORE_EMULATOR_HOST
}, async () => {
    const { initializeApp, deleteApp } = require("firebase-admin/app");
    const { getFirestore, FieldValue } = require("firebase-admin/firestore");
    const app = initializeApp({ projectId: "demo-church-gibu" }, "emulator-test");
    const db = getFirestore(app);
    const fn = handler(db, { serverTimestamp: () => FieldValue.serverTimestamp() });
    const ref = db.collection("donationApplications").doc(requestId);
    try {
        const body = { requestId, submission };
        const results = await Promise.all([call(fn, body), call(fn, body)]);
        assert.deepEqual(results.map(result => result.statusCode), [200, 200]);
        const snapshot = await ref.get();
        assert.equal(snapshot.exists, true);
        assert.deepEqual(snapshot.data().submission.familyMembers, submission.familyMembers);
        assert.ok(snapshot.data().createdAt);
        const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/demo-church-gibu/databases/(default)/documents/donationApplications/${requestId}`;
        assert.equal((await fetch(url)).status, 403);
        assert.equal((await fetch(url, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: { test: { stringValue: "test" } } })
        })).status, 403);
        assert.equal((await fetch(url, { method: "DELETE" })).status, 403);
    } finally {
        await ref.delete();
        await deleteApp(app);
    }
});

test("Functions emulator accepts token-free submissions and enforces origin", {
    skip: !process.env.TEST_FUNCTION_URL
}, async () => {
    const url = process.env.TEST_FUNCTION_URL;
    const preflight = await fetch(url, {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "POST" }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost:3000");
    const accepted = await fetch(url, {
        method: "POST",
        headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, submission })
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { ok: true });
    const { initializeApp, deleteApp } = require("firebase-admin/app");
    const { getFirestore } = require("firebase-admin/firestore");
    const app = initializeApp({ projectId: "demo-church-gibu" }, "http-test");
    try {
        const ref = getFirestore(app).collection("donationApplications").doc(requestId);
        const snapshot = await ref.get();
        assert.deepEqual(snapshot.data().submission, submission);
        await ref.delete();
    } finally {
        await deleteApp(app);
    }
    const forbidden = await fetch(url, {
        method: "POST",
        headers: { Origin: "https://other.test", "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, submission })
    });
    assert.equal(forbidden.status, 403);
});
