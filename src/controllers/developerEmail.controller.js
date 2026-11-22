"use strict";

const emailNotificationService = require("../services/email/emailNotificationService");
const EmailNotificationLog = require("../models/EmailNotificationLog");

/**
 * Controller strictly protected for developer platform role.
 */

exports.getTemplates = async (req, res, next) => {
  try {
    const templates = emailNotificationService.listTemplates();
    return res.status(200).json({
      success: true,
      data: templates,
    });
  } catch (err) {
    next(err);
  }
};

exports.previewTemplate = async (req, res, next) => {
  try {
    const { type, data } = req.body;
    if (!type) {
      return res.status(400).json({
        success: false,
        message: "Template 'type' is required",
      });
    }

    const preview = emailNotificationService.preview(type, data);
    return res.status(200).json({
      success: true,
      data: preview,
    });
  } catch (err) {
    next(err);
  }
};

exports.sendTestEmail = async (req, res, next) => {
  try {
    const { type, to, data } = req.body;

    if (!type || !to) {
      return res.status(400).json({
        success: false,
        message: "Both 'type' and recipient email 'to' are required",
      });
    }

    const result = await emailNotificationService.send({
      type,
      to,
      data: data || {},
      triggeredBy: `DEVELOPER_CONSOLE (${req.user?.email || req.user?.userId || "dev"})`,
    });

    return res.status(200).json({
      success: true,
      message: `Email '${type}' dispatched successfully to ${to}`,
      result,
    });
  } catch (err) {
    next(err);
  }
};

exports.getEmailLogs = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 25);
    const filter = {};

    if (req.query.status) {
      filter.status = req.query.status;
    }
    if (req.query.templateType) {
      filter.templateType = req.query.templateType;
    }
    if (req.query.search) {
      filter.to = { $regex: req.query.search.trim(), $options: "i" };
    }

    const [logs, total] = await Promise.all([
      EmailNotificationLog.find(filter)
        .sort({ sentAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      EmailNotificationLog.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.runLifecycleCheck = async (req, res, next) => {
  try {
    const { processSubscriptionLifecycleEmails } = require("../services/email/subscriptionEmailScheduler");
    const summary = await processSubscriptionLifecycleEmails();

    return res.status(200).json({
      success: true,
      message: "Automated subscription and trial email check completed successfully",
      summary,
    });
  } catch (err) {
    next(err);
  }
};
