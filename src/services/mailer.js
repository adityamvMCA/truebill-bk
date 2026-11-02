
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.MAIL_EMAIL,
    pass: process.env.MAIL_PASSWORD?.replace(/\s/g, ""),
  },
});

const sendMail = async ({
  to,
  subject,
  text,
  attachments = [],
}) => {
  if (!process.env.MAIL_EMAIL || !process.env.MAIL_PASSWORD) {
    throw new Error("Gmail SMTP credentials are missing");
  }

  const info = await transporter.sendMail({
    from: `"${process.env.MAIL_FROM_NAME || "TrustIQ ERP"}" <${process.env.MAIL_EMAIL}>`,
    to,
    subject,
    text,
    attachments,
  });

  return info.messageId;
};

module.exports = { sendMail };
