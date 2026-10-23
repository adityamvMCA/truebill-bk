const { configurations, objectId, seedKind } = require("../shared/masterCore");

const seedDefaultProductMasters = async ({
  models,
  tenantId,
  userId = null,
  session,
  ipAddress,
}) => {
  const tenantObjectId = objectId(tenantId, "tenantId");
  const userObjectId = userId == null ? null : objectId(userId, "userId");
  const connection = models?.ProductCategory?.db;
  for (const key of ["ProductCategory", "ProductBrand", "AuditLog"]) {
    if (!models?.[key] || models[key].db !== connection)
      throw new Error(`Invalid tenant seed model: ${key}`);
  }
  if (!session?.inTransaction())
    throw new Error("Default master seeding requires an active transaction");
  const context = {
    models,
    connection,
    tenantId: tenantObjectId,
    userId: userObjectId,
    session,
    ipAddress,
  };
  const categories = await seedKind(context, configurations.category);
  const brands = await seedKind(context, configurations.brand);
  return { categories, brands };
};
module.exports = { seedDefaultProductMasters };
