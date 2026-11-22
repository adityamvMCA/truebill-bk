/* Maps your tenant record to the `company` prop the print templates expect.
   Rename the right-hand fields to match your Tenant model. */
const companyFrom = (tenant) => ({
  name: tenant.companyName || tenant.name,
  address: tenant.address,
  phone: tenant.phone,
  gstin: tenant.gstin || tenant.gstNo,
  logo: tenant.logo || tenant.logoUrl,
  upi: tenant.upi,
  terms: tenant.invoiceTerms,
  bank: tenant.bank,
});

module.exports = { companyFrom };