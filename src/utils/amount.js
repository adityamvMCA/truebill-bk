export const paiseToRupees = (
  paise,
) => {
  const value = Number(paise || 0);

  return value / 100;
};

export const rupeesToPaise = (
  rupees,
) => {
  const value = Number(rupees || 0);

  return Math.round(value * 100);
};

export const formatInr = (paise) => {
  const rupees = paiseToRupees(paise);

  return new Intl.NumberFormat(
    "en-IN",
    {
      style: "currency",
      currency: "INR",
    },
  ).format(rupees);
};

export const formatDate = (value) => {
  if (!value) {
    return "";
  }

  return new Date(
    value,
  ).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

export const formatStatus = (
  status,
) => {
  if (!status) {
    return "";
  }

  return status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) =>
      character.toUpperCase(),
    );
};