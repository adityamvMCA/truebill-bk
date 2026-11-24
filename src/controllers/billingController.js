const crypto = require("crypto");
const Razorpay = require("razorpay");
const Tenant = require("../models/Tenant");
const SubscriptionPayment = require("../models/SubscriptionPayment");
const { PLANS, resolvePlanFeatures } = require("../config/subscriptionPlans");

const getRazorpayInstance = () => {
  const key_id = process.env.RAZORPAY_KEY_ID || process.env.RZP_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET || process.env.RZP_KEY_SECRET;

  if (!key_id || !key_secret) {
    return null;
  }
  return new Razorpay({ key_id, key_secret });
};

/**
 * GET /api/billing/plans
 * Pulls all plans, pricing, limits, and highlights directly from subscriptionPlans.js
 */
exports.getPlans = async (req, res, next) => {
  try {
    const tenantId = req.tenant?._id || req.tenant?.id;
    const tenant = await Tenant.findById(tenantId).lean();

    const plansData = Object.values(PLANS).map((p) => ({
      id: p.id,
      name: p.name,
      badge: p.badge,
      price: p.pricing,
      popular: p.popular,
      durationDays: p.durationDays,
      description: p.description,
      limits: p.limits,
      highlights: p.highlights,
    }));

    const currentSubscription = {
      plan: tenant?.subscriptionPlan || "trial",
      status: tenant?.status || "trial",
      startDate: tenant?.subscriptionStart,
      endDate: tenant?.subscriptionEnd,
      valid: tenant?.status === "active" || tenant?.status === "trial",
      daysLeft: tenant?.subscriptionEnd
        ? Math.max(
            0,
            Math.ceil(
              (new Date(tenant.subscriptionEnd) - new Date()) / (1000 * 60 * 60 * 24)
            )
          )
        : null,
      limits: tenant?.limits || PLANS[tenant?.subscriptionPlan || "trial"]?.limits,
    };

    const keyId = process.env.RAZORPAY_KEY_ID || process.env.RZP_KEY_ID || "";
    const hasKeys = Boolean(keyId && (process.env.RAZORPAY_KEY_SECRET || process.env.RZP_KEY_SECRET));

    res.json({
      success: true,
      plans: plansData,
      currentSubscription,
      razorpayKeyId: keyId,
      hasKeys,
      isTestMode: keyId.startsWith("rzp_test_"),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/create-order
 * Creates REAL Razorpay Order via official Razorpay SDK
 */
exports.createOrder = async (req, res, next) => {
  try {
    const { plan, billingCycle = "yearly" } = req.body;
    const tenantId = req.tenant?._id || req.tenant?.id;
    const userId = req.user?.userId;

    const planConfig = PLANS[plan];
    if (!planConfig || !planConfig.pricing) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription plan selected",
      });
    }

    const priceRupees = planConfig.pricing[billingCycle] ?? planConfig.pricing.yearly;
    const amountPaise = priceRupees * 100;

    const keyId = process.env.RAZORPAY_KEY_ID || process.env.RZP_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET || process.env.RZP_KEY_SECRET;

    if (!keyId || !keySecret) {
      return res.status(400).json({
        success: false,
        requiresKeys: true,
        message: "Please configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in true-backend/.env",
      });
    }

    const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const order = await rzp.orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt: `sub_${tenantId.toString().slice(-6)}_${Date.now()}`,
      notes: {
        tenantId: tenantId.toString(),
        userId: userId?.toString() || "",
        plan,
        billingCycle,
      },
    });

    await SubscriptionPayment.create({
      tenantId,
      userId: userId || tenantId,
      plan,
      billingCycle,
      amount: priceRupees,
      amountPaise,
      currency: "INR",
      razorpayOrderId: order.id,
      status: "created",
      metadata: {
        companyName: req.tenant?.name || req.tenant?.companyName,
        userEmail: req.user?.email,
      },
    });

    res.json({
      success: true,
      orderId: order.id,
      amount: amountPaise,
      amountRupees: priceRupees,
      currency: "INR",
      keyId,
      plan,
      billingCycle,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/verify-payment
 * Verifies official Razorpay HMAC-SHA256 signature and upgrades subscription
 */
exports.verifyPayment = async (req, res, next) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      plan,
      billingCycle = "yearly",
    } = req.body;

    const tenantId = req.tenant?._id || req.tenant?.id;
    const keySecret = process.env.RAZORPAY_KEY_SECRET || process.env.RZP_KEY_SECRET;

    if (!keySecret) {
      return res.status(400).json({
        success: false,
        message: "RAZORPAY_KEY_SECRET is not configured on the server",
      });
    }

    // Verify HMAC-SHA256 signature strictly
    const generatedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (generatedSignature !== razorpay_signature) {
      await SubscriptionPayment.findOneAndUpdate(
        { tenantId, razorpayOrderId: razorpay_order_id },
        { status: "failed" }
      );
      return res.status(400).json({
        success: false,
        message: "Razorpay signature verification failed. Payment untrusted.",
      });
    }

    const targetPlan = plan || "basic";
    const cycle = billingCycle || "yearly";
    const days = cycle === "monthly" ? 30 : 365;

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) {
      return res.status(404).json({ success: false, message: "Tenant not found" });
    }

    const now = new Date();
    const currentEnd =
      tenant.subscriptionEnd && new Date(tenant.subscriptionEnd) > now
        ? new Date(tenant.subscriptionEnd)
        : now;
    const newEnd = new Date(currentEnd.getTime() + days * 24 * 60 * 60 * 1000);

    const planConfig = PLANS[targetPlan] || PLANS.basic;
    tenant.subscriptionPlan = targetPlan;
    tenant.status = "active";
    tenant.subscriptionStart = now;
    tenant.subscriptionEnd = newEnd;
    tenant.limits = planConfig.limits;
    tenant.features = Array.from(resolvePlanFeatures(targetPlan));
    await tenant.save();

    await SubscriptionPayment.findOneAndUpdate(
      { tenantId, razorpayOrderId: razorpay_order_id },
      {
        status: "paid",
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
        paidAt: new Date(),
      }
    );

    res.json({
      success: true,
      message: `Successfully upgraded to ${planConfig.name}!`,
      subscription: {
        plan: tenant.subscriptionPlan,
        status: tenant.status,
        subscriptionStart: tenant.subscriptionStart,
        subscriptionEnd: tenant.subscriptionEnd,
        limits: tenant.limits,
        features: tenant.features,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/billing/activate-trial
 * Starts or extends a 14-day free trial
 */
exports.activateTrial = async (req, res, next) => {
  try {
    const tenantId = req.tenant?._id || req.tenant?.id;
    const userId = req.user?.userId;

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) {
      return res.status(404).json({ success: false, message: "Tenant not found" });
    }

    const now = new Date();
    const newEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    tenant.subscriptionPlan = "trial";
    tenant.status = "trial";
    tenant.subscriptionStart = now;
    tenant.subscriptionEnd = newEnd;
    tenant.limits = PLANS.trial.limits;
    tenant.features = Array.from(resolvePlanFeatures("trial"));
    await tenant.save();

    await SubscriptionPayment.create({
      tenantId,
      userId: userId || tenantId,
      plan: "trial",
      billingCycle: "trial",
      amount: 0,
      amountPaise: 0,
      status: "trial_activated",
      isTestMode: true,
      paidAt: now,
    });

    res.json({
      success: true,
      message: "14-Day Free Trial activated successfully!",
      subscription: {
        plan: tenant.subscriptionPlan,
        status: tenant.status,
        subscriptionStart: tenant.subscriptionStart,
        subscriptionEnd: tenant.subscriptionEnd,
        limits: tenant.limits,
        features: tenant.features,
      },
    });
  } catch (error) {
    next(error);
  }
};
