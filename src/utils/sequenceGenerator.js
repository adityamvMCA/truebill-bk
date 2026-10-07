const mongoose=require("mongoose");
const getNextSequence=async(prefix="CN",scope="GLOBAL",padLength=3)=>{if(!mongoose.connection.db)throw new Error("MongoDB connection is not ready");const counters=mongoose.connection.db.collection("counters");const counterId=`${scope}_${prefix}`;const result=await counters.findOneAndUpdate({_id:counterId},{$inc:{seq:1}},{upsert:true,returnDocument:"after"});const seq=result?.seq??result?.value?.seq??1;return `${prefix}${String(seq).padStart(padLength,"0")}`;};
module.exports={getNextSequence};
