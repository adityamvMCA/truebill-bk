const crypto = require("crypto");
const Menu = require("../models/Menu");
const { getEntitlements, norm } = require("../services/entitlements");

const normalizeRoles = (roles) =>
  Array.isArray(roles)
    ? [...new Set(roles.map((r) => norm(r)).filter(Boolean))]
    : [];

const normalizeFeature = (f) => (f ? norm(f) : null);
const newDocNo = (appCode) =>
  `MNU-${appCode.toUpperCase()}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

const buildChild = (child, index, parentRoles) => ({
  id: child.id || `CH-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
  label: String(child.label || "").trim(),
  icon: child.icon || null,
  path: child.path || null,
  feature: normalizeFeature(child.feature),
  roles:
    child.roles !== undefined && normalizeRoles(child.roles).length
      ? normalizeRoles(child.roles)
      : parentRoles,
  order: Number(child.order ?? index),
  isActive: child.isActive !== false,
});

const buildMenuData = (body, existing = {}) => {
  const roles =
    body.roles !== undefined
      ? normalizeRoles(body.roles)
      : existing.roles || ["admin"];

  const children =
    body.children !== undefined
      ? (Array.isArray(body.children) ? body.children : []).map((c, i) =>
          buildChild(c, i, roles)
        )
      : existing.children;

  return {
    appCode: norm(body.appCode ?? existing.appCode ?? "truebill"),
    group: String(body.group ?? existing.group ?? "").trim(),
    groupOrder: Number(body.groupOrder ?? existing.groupOrder ?? 0),
    label: String(body.label ?? existing.label ?? "").trim(),
    icon: body.icon !== undefined ? body.icon : existing.icon ?? null,
    path: body.path !== undefined ? body.path : existing.path ?? null,
    feature:
      body.feature !== undefined
        ? normalizeFeature(body.feature)
        : existing.feature ?? null,
    roles,
    order: Number(body.order ?? existing.order ?? 0),
    children,
    isActive:
      body.isActive !== undefined
        ? body.isActive === true || body.isActive === "true"
        : existing.isActive ?? true,
  };
};

const validatePath = (p) => !p || String(p).startsWith("/");

const validateMenu = (menu) => {
  if (!menu.appCode || !menu.group || !menu.label)
    return "appCode, group and label are required";
  if (!menu.roles.length) return "At least one role is required";
  if (!validatePath(menu.path)) return "Menu path must start with /";
  if (menu.children?.some((c) => !c.label))
    return "Every child menu must have a label";
  if (menu.children?.some((c) => !validatePath(c.path)))
    return "Every child path must start with /";
  return null;
};

const fail = (res, status, message) =>
  res.status(status).json({ success: false, message });

const getMenuByRole = async (req, res) => {
  try {
    const userRole = norm(req.user?.role || "");
    const appCode = norm(req.query.appCode || "truebill");
    const isDeveloper = req.user?.platformRole === "developer";

    if (!userRole && !isDeveloper) return fail(res, 401, "User role is missing");

    let ent = null;
    if (!isDeveloper) {
      if (!req.user?.tenantId) return fail(res, 403, "Tenant access required");
      ent = await getEntitlements(req.user.tenantId);
      if (!ent.valid)
        return res.status(402).json({
          success: false,
          code: ent.reason,
          message: "Subscription is inactive or expired",
        });
    }

    const query = { appCode, isActive: true };
    if (!isDeveloper) query.roles = userRole;

    const menus = await Menu.find(query)
      .sort({ groupOrder: 1, order: 1, label: 1 })
      .lean();

    const allowed = (feature) =>
      !ent || !feature || ent.features.has(norm(feature));

    const groupMap = new Map();

    for (const menu of menus) {
      if (!allowed(menu.feature)) continue;

      const children = (menu.children || [])
        .filter(
          (c) =>
            c.isActive !== false &&
            (isDeveloper || (c.roles || []).includes(userRole)) &&
            allowed(c.feature)
        )
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map(({ roles, isActive, ...child }) => child);

      const { createdBy, createdAt, updatedAt, __v, roles, ...menuData } = menu;
      const item = { ...menuData };
      if (children.length) item.children = children;
      else delete item.children;

      if (!groupMap.has(menu.group))
        groupMap.set(menu.group, {
          group: menu.group,
          groupOrder: menu.groupOrder ?? 0,
          items: [],
        });
      groupMap.get(menu.group).items.push(item);
    }

    const menuGroups = [...groupMap.values()]
      .sort((a, b) => a.groupOrder - b.groupOrder)
      .map((g) => ({ ...g, items: g.items.sort((a, b) => a.order - b.order) }));

    return res.json({
      success: true,
      role: userRole,
      appCode,
      menuGroups,
      subscription: ent && {
        plan: ent.plan,
        status: ent.status,
        daysLeft: ent.daysLeft,
        inGrace: ent.inGrace,
        features: [...ent.features],
        limits: ent.limits,
      },
    });
  } catch (error) {
    console.error("Get menus error:", error);
    return fail(res, 500, "Failed to fetch menus");
  }
};

const getAllMenus = async (req, res) => {
  try {
    const filter = {};
    if (req.query.appCode) filter.appCode = norm(req.query.appCode);
    const menus = await Menu.find(filter)
      .sort({ appCode: 1, groupOrder: 1, order: 1 })
      .lean();
    return res.json({ success: true, total: menus.length, menus });
  } catch (error) {
    console.error("List menus error:", error);
    return fail(res, 500, "Failed to fetch menus");
  }
};

const createMenu = async (req, res) => {
  try {
    const data = buildMenuData(req.body);
    const err = validateMenu(data);
    if (err) return fail(res, 400, err);

    const menu = await Menu.create({
      ...data,
      documentNumber: newDocNo(data.appCode),
      createdBy: req.user?.userId || null,
    });
    return res
      .status(201)
      .json({ success: true, message: "Menu created successfully", menu });
  } catch (error) {
    if (error.code === 11000)
      return fail(res, 409, "A menu with this label already exists in this group");
    console.error("Create menu error:", error);
    return fail(res, 500, "Failed to create menu");
  }
};

const addChild = async (req, res) => {
  try {
    const parent = await Menu.findOne({
      documentNumber: req.params.documentNumber,
    }).lean();
    if (!parent) return fail(res, 404, "Menu not found");

    const child = buildChild(req.body, parent.children?.length || 0, parent.roles);
    if (!child.label) return fail(res, 400, "Submenu name is required");
    if (!validatePath(child.path))
      return fail(res, 400, "Submenu path must start with /");

    const menu = await Menu.findOneAndUpdate(
      {
        documentNumber: req.params.documentNumber,
        "children.label": {
          $not: new RegExp(
            `^${child.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            "i"
          ),
        },
      },
      { $push: { children: child } },
      { new: true }
    );

    if (!menu) return fail(res, 409, "This submenu already exists");
    return res
      .status(201)
      .json({ success: true, message: "Submenu added successfully", menu });
  } catch (error) {
    console.error("Add child error:", error);
    return fail(res, 500, "Failed to add submenu");
  }
};

const updateMenu = async (req, res) => {
  try {
    const menu = await Menu.findOne({ documentNumber: req.params.documentNumber });
    if (!menu) return fail(res, 404, "Menu not found");

    const data = buildMenuData(req.body, menu.toObject());
    const err = validateMenu(data);
    if (err) return fail(res, 400, err);

    Object.assign(menu, data);
    await menu.save();
    return res.json({ success: true, message: "Menu updated successfully", menu });
  } catch (error) {
    if (error.code === 11000)
      return fail(res, 409, "A menu with this label already exists in this group");
    console.error("Update menu error:", error);
    return fail(res, 500, "Failed to update menu");
  }
};

const deleteMenu = async (req, res) => {
  try {
    const menu = await Menu.findOneAndUpdate(
      { documentNumber: req.params.documentNumber },
      { $set: { isActive: false } },
      { new: true }
    );
    if (!menu) return fail(res, 404, "Menu not found");
    return res.json({ success: true, message: "Menu deactivated successfully" });
  } catch (error) {
    console.error("Delete menu error:", error);
    return fail(res, 500, "Failed to deactivate menu");
  }
};

const bulkMenus = async (req, res) => {
  try {
    const items = req.body.menus;
    if (!Array.isArray(items) || !items.length)
      return fail(res, 400, "Provide a non-empty menus array");

    const docs = [];
    const seen = new Set();

    for (const item of items) {
      const data = buildMenuData(item);
      const err = validateMenu(data);
      if (err) return fail(res, 400, `${data.label || "Menu"}: ${err}`);

      const key = `${data.appCode}|${data.group}|${data.label}`;
      if (seen.has(key)) return fail(res, 409, `Duplicate in request: ${data.label}`);
      seen.add(key);

      docs.push({
        ...data,
        documentNumber: newDocNo(data.appCode),
        createdBy: req.user?.userId || null,
      });
    }

    const existing = await Menu.find({
      $or: docs.map(({ appCode, group, label }) => ({ appCode, group, label })),
    })
      .select("label")
      .lean();

    if (existing.length)
      return fail(res, 409, `Menu already exists: ${existing[0].label}`);

    const result = await Menu.insertMany(docs, { ordered: true });
    return res.status(201).json({
      success: true,
      message: "Menus created successfully",
      total: result.length,
      menus: result,
    });
  } catch (error) {
    console.error("Bulk menu creation error:", error);
    return fail(res, 500, "Failed to create menus");
  }
};

const getMenuByDocumentNumber = async (req, res) => {
  try {
    const menu = await Menu.findOne({
      documentNumber: req.params.documentNumber,
    }).lean();
    if (!menu) return fail(res, 404, "Menu not found");
    return res.json({ success: true, menu });
  } catch (error) {
    console.error("Get menu error:", error);
    return fail(res, 500, "Failed to fetch menu");
  }
};

module.exports = {
  getMenuByRole,
  getAllMenus,
  createMenu,
  addChild,
  updateMenu,
  deleteMenu,
  bulkMenus,
  getMenuByDocumentNumber,
};