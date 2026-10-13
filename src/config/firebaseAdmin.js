const fs = require("fs");

const {
  cert,
  getApps,
  initializeApp,
} = require("firebase-admin/app");

const initializeFirebaseAdmin = () => {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const serviceAccountPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  if (!serviceAccountPath) {
    const error = new Error(
      "FIREBASE_SERVICE_ACCOUNT_PATH is not configured",
    );

    error.isFirebaseConfigError = true;

    throw error;
  }

  if (!fs.existsSync(serviceAccountPath)) {
    const error = new Error(
      `Firebase service-account file not found: ${serviceAccountPath}`,
    );

    error.isFirebaseConfigError = true;

    throw error;
  }

  let serviceAccount;

  try {
    serviceAccount = require(serviceAccountPath);
  } catch (error) {
    const configError = new Error(
      `Unable to read Firebase service-account file: ${error.message}`,
    );

    configError.isFirebaseConfigError = true;

    throw configError;
  }

  if (
    serviceAccount.type !== "service_account" ||
    !serviceAccount.project_id ||
    !serviceAccount.client_email ||
    !serviceAccount.private_key
  ) {
    const error = new Error(
      "Invalid Firebase service-account configuration",
    );

    error.isFirebaseConfigError = true;

    throw error;
  }

  const firebaseApp = initializeApp({
    credential: cert(serviceAccount),
  });

  console.log(
    `Firebase Admin initialized: ${serviceAccount.project_id}`,
  );

  return firebaseApp;
};

const initializeFirebaseAdminSafe = () => {
  try {
    return initializeFirebaseAdmin();
  } catch (error) {
    if (error.isFirebaseConfigError) {
      console.warn(
        `Firebase Admin skipped: ${error.message}`,
      );

      return null;
    }

    throw error;
  }
};

module.exports = {
  initializeFirebaseAdmin,
  initializeFirebaseAdminSafe,
};