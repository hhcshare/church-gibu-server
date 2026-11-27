const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { createSubmissionHandler } = require("./submission");

initializeApp();

exports.submitDonation = onRequest(
    { region: "asia-northeast3" },
    createSubmissionHandler({
        db: getFirestore(),
        serverTimestamp: () => FieldValue.serverTimestamp(),
        getAllowedOrigins: () => process.env.ALLOWED_ORIGINS,
        logger
    })
);
