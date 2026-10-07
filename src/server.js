require("dotenv").config();
const app=require("./app");
const connectDB=require("./config/db");
const PORT=process.env.PORT||5000;
(async()=>{try{await connectDB();app.listen(PORT,()=>console.log(`TrustIQ ERP API running on port ${PORT}`));}catch(e){console.error("Server startup failed:",e.message);process.exit(1);}})();
