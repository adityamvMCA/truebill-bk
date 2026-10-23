const DEFAULT_TAX_RATES = [
  {
    name: "GST 0%",
    rate: 0,
    taxType: "GST",
  },
  {
    name: "GST 0.25%",
    rate: 0.25,
    taxType: "GST",
  },
  {
    name: "GST 1.5%",
    rate: 1.5,
    taxType: "GST",
  },
  {
    name: "GST 3%",
    rate: 3,
    taxType: "GST",
  },
  {
    name: "GST 5%",
    rate: 5,
    taxType: "GST",
  },
  {
    name: "GST 18%",
    rate: 18,
    taxType: "GST",
  },
  {
    name: "GST 40%",
    rate: 40,
    taxType: "GST",
  },
];

/*
  Add only approved HSN/SAC mappings.

  Each entry must contain:
  {
    code: "<verified classification code>",
    description: "<verified description>",
    defaultGstRate: <approved numeric rate>
  }

  Do not use 0 to represent an unknown rate.
*/
const DEFAULT_HSN_SAC_CODES = [];

module.exports = {
  DEFAULT_TAX_RATES,
  DEFAULT_HSN_SAC_CODES,
};
