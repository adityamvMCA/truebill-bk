const {ROLE_PERMISSIONS}=require("../config/constants");
const getRolePermissions=role=>ROLE_PERMISSIONS[role]||[];
const hasPermission=(user,permission)=>!!user&&(user.platformRole==="developer"||user.platformRole==="support"||user.permissions?.includes(permission)||getRolePermissions(user.role).includes(permission));
module.exports={getRolePermissions,hasPermission};
