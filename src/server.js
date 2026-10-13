// // require("dotenv").config();
// // const app = require("./app");
// // const connectDB = require("./config/db");
// // const PORT = process.env.PORT || 5001;
// // (async () => {
// //   try {
// //     await connectDB();
// //     app.listen(PORT, () =>
// //       console.log(`TrustIQ ERP API running on port ${PORT}`),
// //     );
// //   } catch (e) {
// //     console.error("Server startup failed:", e.message);
// //     process.exit(1);
// //   }
// // })();
// require("dotenv").config();

// const app = require("./app");

// const connectDB = require("./config/db");

// const {
//   initializeFirebaseAdmin,
// } = require("./config/firebaseAdmin");

// const PORT = process.env.PORT || 5001;

// (async () => {
//   try {
//     await connectDB();

//     initializeFirebaseAdmin();

//     app.listen(PORT, () => {
//       console.log(
//         `TrustIQ ERP API running on port ${PORT}`,
//       );
//     });
//   } catch (error) {
//     console.error(
//       "Server startup failed:",
//       error.message,
//     );

//     process.exit(1);
//   }
// })();

require("dotenv").config();

const app = require("./app");

const connectDB = require("./config/db");

const {
  initializeFirebaseAdminSafe,
} = require("./config/firebaseAdmin");

const PORT = process.env.PORT || 5001;

(async () => {
  try {
    await connectDB();

    initializeFirebaseAdminSafe();

    app.listen(PORT, () => {
      console.log(
        `TrustIQ ERP API running on port ${PORT}`,
      );
    });
  } catch (error) {
    console.error(
      "Server startup failed:",
      error.message,
    );

    process.exit(1);
  }
})();