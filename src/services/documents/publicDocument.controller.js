const Tenant = require("../../models/Tenant"); // adjust path
const MessagingSettings = require("../../models/MessagingSettings");
const { verifyDocToken } = require("./documentToken");
const { getDocumentType } = require("./registry");
const { companyFrom } = require("./company");
const { getTenantAccountingModels } = require("../../tenancy/tenantAccountingModels");
const { getReadyTenantConnection } = require("../../tenancy/tenantConnectionManager");

exports.data = async (req, res) => {
  const parsed = verifyDocToken(req.params.token);
  if (!parsed) return res.sendStatus(410);

  try {
    const def = getDocumentType(parsed.docType);

    const tenant = await Tenant.findById(parsed.tenantId);
    if (!tenant) return res.sendStatus(404);

    const models = getTenantAccountingModels(getReadyTenantConnection(tenant));

    const [document, settings] = await Promise.all([
      def.load({ models, tenantId: tenant._id, ref: parsed.ref }),
      MessagingSettings.findOne({ tenantId: tenant._id }).lean(),
    ]);

    res.set("Cache-Control", "no-store");
    res.set("X-Robots-Tag", "noindex");
    res.json({
      printKind: def.printKind,
      document,
      templateId: settings?.printTemplates?.[def.printKind] || undefined,
      company: companyFrom(tenant),
    });
  } catch (error) {
    res.sendStatus(error.statusCode === 404 ? 404 : 500);
  }
};