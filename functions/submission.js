const { isDeepStrictEqual } = require("node:util");

function isText(value, maxLength) {
    return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function validateRRN(rrn) {
    const number = rrn.replace(/-/g, "");
    if (!/^\d{13}$/.test(number)) return false;
    const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
    const sum = weights.reduce((total, weight, index) => total + Number(number[index]) * weight, 0);
    return (11 - sum % 11) % 10 === Number(number[12]);
}

function normalizeSubmission(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        !["person", "corporation"].includes(input.personOrCorp) ||
        !isText(input.name, 100) || !isText(input.ssn, 100) ||
        !isText(input.phone, 20) || !isText(input.area, 100) ||
        !["yes", "no"].includes(input.familyTotalRequest) || input.agree !== true ||
        !Array.isArray(input.familyMembers) || input.familyMembers.length > 100) {
        return null;
    }
    if ((input.personOrCorp === "person" && !validateRRN(input.ssn)) ||
        !/^01[016789]\d{8}$/.test(input.phone.replace(/-/g, ""))) {
        return null;
    }
    if (input.familyTotalRequest === "no" && input.familyMembers.length !== 0) {
        return null;
    }
    const familyMembers = [];
    for (const member of input.familyMembers) {
        if (!member || typeof member !== "object" || Array.isArray(member) ||
            typeof member.name !== "string" || member.name.length > 100 ||
            typeof member.percentage !== "string" || member.percentage.length > 30 ||
            (member.percentage !== "" && !Number.isFinite(Number(member.percentage)))) {
            return null;
        }
        familyMembers.push({ name: member.name.trim(), percentage: member.percentage });
    }
    return {
        personOrCorp: input.personOrCorp,
        name: input.name.trim(),
        ssn: input.ssn,
        phone: input.phone,
        area: input.area,
        familyTotalRequest: input.familyTotalRequest,
        familyMembers,
        agree: true
    };
}

function createRecordName(name, date) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Seoul",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hourCycle: "h23"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${name}_${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`;
}

function createSubmissionHandler({ db, serverTimestamp, getAllowedOrigins, logger }) {
    return async (req, res) => {
        const origins = (getAllowedOrigins() || "").split(",").map(value => value.trim()).filter(Boolean);
        const origin = req.get("Origin");
        res.set("Vary", "Origin");
        if (!origin || !origins.includes(origin)) {
            res.status(403).json({ error: "허용되지 않은 요청입니다." });
            return;
        }
        res.set("Access-Control-Allow-Origin", origin);
        res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.set("Access-Control-Allow-Headers", "Content-Type");
        if (req.method === "OPTIONS") {
            res.status(204).end();
            return;
        }
        if (req.method !== "POST") {
            res.status(405).json({ error: "허용되지 않은 요청 방식입니다." });
            return;
        }
        const body = req.body;
        if ((req.rawBody && req.rawBody.length > 65536) || !body ||
            typeof body.requestId !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) {
            res.status(400).json({ error: "요청 형식이 올바르지 않습니다." });
            return;
        }
        const submission = normalizeSubmission(body.submission);
        if (!submission) {
            res.status(400).json({ error: "입력 내용을 확인해주세요." });
            return;
        }
        try {
            const ref = db.collection("donationApplications").doc(body.requestId);
            const result = await db.runTransaction(async transaction => {
                const existing = await transaction.get(ref);
                if (existing.exists) {
                    return isDeepStrictEqual(existing.data().submission, submission) ? "duplicate" : "conflict";
                }
                transaction.create(ref, {
                    submission,
                    recordName: createRecordName(submission.name, new Date()),
                    createdAt: serverTimestamp()
                });
                return "created";
            });
            if (result === "conflict") {
                res.status(409).json({ error: "같은 요청 번호에 다른 입력 내용이 있습니다." });
                return;
            }
            res.status(200).json({ ok: true });
        } catch (error) {
            logger.error("Donation application storage failed.");
            res.status(500).json({ error: "저장하지 못했습니다. 다시 시도해주세요." });
        }
    };
}

module.exports = { createSubmissionHandler, normalizeSubmission, createRecordName };
