// const mongoose = require("mongoose");
// const connectDB = async () => {
//   if (!process.env.MONGO_URI) throw new Error("MONGO_URI is missing in .env");
//   mongoose.set("strictQuery", true);
//   const conn = await mongoose.connect(process.env.MONGO_URI);
//   console.log(`MongoDB Connected: ${conn.connection.host}`);
// };
// module.exports = connectDB;


const mongoose = require("mongoose");

const connectDB = async () => {
  const uri = process.env.MONGO_URI?.trim();

  if (!uri) {
    throw new Error("MONGO_URI is missing in .env");
  }

  mongoose.set("strictQuery", true);

  const connection = await mongoose.connect(uri);

  console.log(
    `MongoDB Connected: ${connection.connection.host}`,
  );

  console.log(
    `Main database: ${connection.connection.name}`,
  );
};

module.exports = connectDB;