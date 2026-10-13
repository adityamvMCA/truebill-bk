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
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_PATH is not configured",
    );
  }

  const serviceAccount = require(serviceAccountPath);

  if (
    serviceAccount.type !== "service_account" ||
    !serviceAccount.project_id ||
    !serviceAccount.client_email ||
    !serviceAccount.private_key
  ) {
    throw new Error(
      "Invalid Firebase service-account configuration",
    );
  }

  const firebaseApp = initializeApp({
    credential: cert(serviceAccount),
  });

  console.log(
    `Firebase Admin initialized: ${serviceAccount.project_id}`,
  );

  return firebaseApp;
};

module.exports = {
  initializeFirebaseAdmin,
};