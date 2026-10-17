// const mongoose = require("mongoose");
// const getNextSequence = async (
//   prefix = "CN",
//   scope = "GLOBAL",
//   padLength = 3,
// ) => {
//   if (!mongoose.connection.db)
//     throw new Error("MongoDB connection is not ready");
//   const counters = mongoose.connection.db.collection("counters");
//   const counterId = `${scope}_${prefix}`;
//   const result = await counters.findOneAndUpdate(
//     { _id: counterId },
//     { $inc: { seq: 1 } },
//     { upsert: true, returnDocument: "after" },
//   );
//   const seq = result?.seq ?? result?.value?.seq ?? 1;
//   return `${prefix}${String(seq).padStart(padLength, "0")}`;
// };
// module.exports = { getNextSequence };
const mongoose = require("mongoose");

const getNextSequence = async (
  prefix = "CN",
  scope = "GLOBAL",
  padLength = 3,
  options = {},
) => {
  const {
    connection = mongoose.connection,
    session = null,
  } = options;

  if (
    !connection ||
    connection.readyState !== 1 ||
    !connection.db
  ) {
    throw new Error("MongoDB connection is not ready");
  }

  const counters = connection.db.collection("counters");

  const counterId = `${scope}_${prefix}`;

  const updateOptions = {
    upsert: true,
    returnDocument: "after",
  };

  if (session) {
    updateOptions.session = session;
  }

  const result = await counters.findOneAndUpdate(
    { _id: counterId },
    { $inc: { seq: 1 } },
    updateOptions,
  );

  const seq = result?.seq ?? result?.value?.seq;

  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new Error("Counter did not return a valid sequence");
  }

  return `${prefix}${String(seq).padStart(padLength, "0")}`;
};

module.exports = {
  getNextSequence,
};