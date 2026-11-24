const mongoose = require("mongoose");
const Branch = require("../models/Branch");
const { getEntitlements } = require("../services/entitlements");
const { buildUpgradeBanner } = require("./businessController");

/* ================================================================
   GET BRANCHES (for current active business)
================================================================ */
const getBranches = async (req, res) => {
  try {
    const tenantId = req.tenantId || req.tenant?._id;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "Tenant context required" });
    }

    // Auto-seed Main Branch if none exists yet
    const existingCount = await Branch.countDocuments({ tenantId });
    if (existingCount === 0 && req.tenant) {
      await Branch.create({
        tenantId,
        name: "Main Branch",
        code: "MAIN",
        isMain: true,
        phone: req.tenant.phone || "",
        email: req.tenant.email || "",
        gstNo: req.tenant.gstNo || "",
        address: {
          street: req.tenant.address || "",
          city: req.tenant.city || "",
          state: req.tenant.state || "",
          pincode: req.tenant.pincode || "",
        },
        createdBy: req.user.userId || req.user._id,
      });
    }

    const branches = await Branch.find({ tenantId, isActive: true })
      .sort({ isMain: -1, createdAt: 1 })
      .lean();

    // Check plan limits strictly based on subscription plan
    const plan = (req.tenant?.subscriptionPlan || "basic").toLowerCase();
    const maxBranches = plan === "premium" ? null : plan === "standard" ? 5 : 1;

    const used = branches.length;
    const canCreate = maxBranches === null || used < maxBranches;

    return res.json({
      success: true,
      branches,
      limits: {
        plan,
        max: maxBranches,
        used,
        canCreate,
      },
    });
  } catch (error) {
    console.error("getBranches error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load branches",
    });
  }
};

/* ================================================================
   CREATE BRANCH (with Plan Limit Check)
================================================================ */
const createBranch = async (req, res) => {
  try {
    const tenantId = req.tenantId || req.tenant?._id;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "Tenant context required" });
    }

    const { name, code, phone, email, gstNo, address, isMain } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: "Branch name is required" });
    }

    // Plan limit check based on subscription plan
    const plan = (req.tenant?.subscriptionPlan || "basic").toLowerCase();
    const maxBranches = plan === "premium" ? null : plan === "standard" ? 5 : 1;

    const activeCount = await Branch.countDocuments({ tenantId, isActive: true });

    if (maxBranches !== null && activeCount >= maxBranches) {
      const banner = buildUpgradeBanner({
        limitType: "branches",
        currentPlan: plan,
        max: maxBranches,
        used: activeCount,
      });

      return res.status(402).json({
        success: false,
        code: "PLAN_LIMIT_REACHED",
        upgradeRequired: true,
        currentPlan: plan,
        requiredPlan: "standard",
        limit: "branches",
        max: maxBranches,
        used: activeCount,
        message: `${plan.toUpperCase()} plan allows a maximum of ${maxBranches} branch. Upgrade to TrueBill Standard or Premium to add multiple branches.`,
        banner,
      });
    }

    // If marked as main, unset isMain from existing branches
    if (isMain) {
      await Branch.updateMany({ tenantId }, { $set: { isMain: false } });
    }

    const branch = await Branch.create({
      tenantId,
      name: String(name).trim(),
      code: code ? String(code).trim().toUpperCase() : undefined,
      isMain: Boolean(isMain),
      phone: phone ? String(phone).trim() : undefined,
      email: email ? String(email).trim().toLowerCase() : undefined,
      gstNo: gstNo ? String(gstNo).trim().toUpperCase() : undefined,
      address: address || {},
      createdBy: req.user.userId || req.user._id,
    });

    return res.status(201).json({
      success: true,
      message: `Branch "${branch.name}" created successfully`,
      branch,
    });
  } catch (error) {
    console.error("createBranch error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create branch",
    });
  }
};

/* ================================================================
   UPDATE BRANCH
================================================================ */
const updateBranch = async (req, res) => {
  try {
    const tenantId = req.tenantId || req.tenant?._id;
    const { branchId } = req.params;

    if (!mongoose.isValidObjectId(branchId)) {
      return res.status(400).json({ success: false, message: "Invalid branch ID" });
    }

    const { name, code, phone, email, gstNo, address, isMain, isActive } = req.body || {};

    const existing = await Branch.findOne({ _id: branchId, tenantId });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Branch not found" });
    }

    if (isMain && !existing.isMain) {
      await Branch.updateMany({ tenantId }, { $set: { isMain: false } });
    }

    if (name) existing.name = String(name).trim();
    if (code !== undefined) existing.code = code ? String(code).trim().toUpperCase() : null;
    if (phone !== undefined) existing.phone = phone ? String(phone).trim() : null;
    if (email !== undefined) existing.email = email ? String(email).trim().toLowerCase() : null;
    if (gstNo !== undefined) existing.gstNo = gstNo ? String(gstNo).trim().toUpperCase() : null;
    if (address !== undefined) existing.address = address;
    if (isMain !== undefined) existing.isMain = Boolean(isMain);
    if (isActive !== undefined) existing.isActive = Boolean(isActive);

    await existing.save();

    return res.json({
      success: true,
      message: "Branch updated successfully",
      branch: existing,
    });
  } catch (error) {
    console.error("updateBranch error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update branch",
    });
  }
};

/* ================================================================
   DELETE BRANCH
================================================================ */
const deleteBranch = async (req, res) => {
  try {
    const tenantId = req.tenantId || req.tenant?._id;
    const { branchId } = req.params;

    if (!mongoose.isValidObjectId(branchId)) {
      return res.status(400).json({ success: false, message: "Invalid branch ID" });
    }

    const branch = await Branch.findOne({ _id: branchId, tenantId });
    if (!branch) {
      return res.status(404).json({ success: false, message: "Branch not found" });
    }

    if (branch.isMain) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete the Main Branch of your business",
      });
    }

    branch.isActive = false;
    await branch.save();

    return res.json({
      success: true,
      message: `Branch "${branch.name}" deactivated successfully`,
    });
  } catch (error) {
    console.error("deleteBranch error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to delete branch",
    });
  }
};

module.exports = {
  getBranches,
  createBranch,
  updateBranch,
  deleteBranch,
};
