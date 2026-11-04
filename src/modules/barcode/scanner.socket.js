const jwt = require("jsonwebtoken");
const svc = require("../barcode/scanSession.service");
const { lookupBarcode } = require("../barcode/barcode.service");

/**
 * resolveSocketContext(userPayload) -> { tenantId, connection, models }
 * Build it from your tenant lookup + getReadyTenantConnection + getTenantAccountingModels.
 */
module.exports = (io, { resolveSocketContext }) => {
  const ns = io.of("/scanner");

  ns.use(async (socket, next) => {
    try {
      const user = jwt.verify(socket.handshake.auth?.token, process.env.JWT_SECRET);
      socket.data.user = user;
      socket.data.ctx = await resolveSocketContext(user); // tenant from the SERVER, never from the client
      next();
    } catch { next(new Error("Unauthorized")); }
  });

  const deviceCount = async (room) => (await ns.in(room).fetchSockets()).length;

  ns.on("connection", (socket) => {
    const { ctx, user } = socket.data;
    const room = (sid) => svc.scanRoom(ctx.tenantId, sid);

    const guard = (fn) => async (payload = {}, ack) => {
      try { const r = (await fn(payload)) || {}; if (typeof ack === "function") ack({ ok: true, ...r }); }
      catch (e) {
        if (typeof ack === "function") ack({ ok: false, message: e.message });
        socket.emit("scanner:error", { message: e.message });
      }
    };
    const requireSession = () => {
      if (!socket.data.sessionId) throw new Error("Join a session first");
      return socket.data.sessionId;
    };
    const announce = async (sid, event, extra = {}) =>
      ns.to(room(sid)).emit("scanner:sync", { event, devices: await deviceCount(room(sid)), ...extra });

    // owner (desktop, by sessionId) or any device with a join/device token
    socket.on("scanner:join", guard(async ({ sessionId, joinToken, deviceToken }) => {
      let session, role = "device", newDeviceToken = null;
      const token = deviceToken || joinToken;
      if (token) {
        ({ session } = await svc.verifyScanToken({
          models: ctx.models, tenantId: ctx.tenantId, userId: user.userId, token,
        }));
        newDeviceToken = svc.issueDeviceToken(session._id, ctx.tenantId, user.userId);
        if (String(session.createdBy) === String(user.userId) && !joinToken) role = "owner";
      } else {
        session = await svc.getOwnedSession({
          models: ctx.models, tenantId: ctx.tenantId, userId: user.userId, sessionId,
        });
        role = "owner";
      }
      const sid = String(session._id);
      socket.data.sessionId = sid;
      socket.data.role = role;
      await socket.join(room(sid));
      const items = await svc.getSessionItems({ models: ctx.models, tenantId: ctx.tenantId, sessionId: sid });
      socket.emit("scanner:joined", {
        sessionId: sid, documentType: session.documentType, role,
        deviceToken: role === "device" ? newDeviceToken : undefined,
        devices: await deviceCount(room(sid)), items,
      });
      await announce(sid, "device-joined");
      return { sessionId: sid, role, deviceToken: role === "device" ? newDeviceToken : undefined };
    }));

    // lookup only (shows the confirm card) – nothing is saved
    socket.on("scanner:scan", guard(async ({ barcode }) => {
      requireSession();
      const found = await lookupBarcode({ models: ctx.models, tenantId: ctx.tenantId, barcode });
      if (!found) { socket.emit("scanner:product-not-found", { barcode }); return { found: false }; }
      socket.emit("scanner:product-found", { barcode, product: found.product, packaging: found.mapping });
      return { found: true };
    }));

    // user tapped Confirm -> persist atomically + broadcast to this session only
    socket.on("scanner:confirm", guard(async ({ scanId, barcode, quantity }) => {
      const sid = requireSession();
      const r = await svc.recordConfirmedScan({
        models: ctx.models, connection: ctx.connection, tenantId: ctx.tenantId,
        userId: user.userId, sessionId: sid, scanId, barcode, quantity,
      });
      if (r.status === "NOT_FOUND") { socket.emit("scanner:product-not-found", { barcode }); return { status: r.status }; }
      if (r.status === "OK") ns.to(room(sid)).emit("scanner:quantity-updated", { item: r.item, product: r.product });
      return { status: r.status, item: r.item };
    }));

    socket.on("scanner:set-quantity", guard(async ({ itemId, quantity }) => {
      const sid = requireSession();
      if (socket.data.role !== "owner") throw new Error("Only the session owner can edit quantities");
      const item = await svc.setItemQuantity({ models: ctx.models, tenantId: ctx.tenantId, sessionId: sid, itemId, quantity });
      ns.to(room(sid)).emit("scanner:quantity-updated", { item });
      return {};
    }));

    socket.on("scanner:remove", guard(async ({ itemId }) => {
      const sid = requireSession();
      if (socket.data.role !== "owner") throw new Error("Only the session owner can remove items");
      await svc.removeScanItem({ models: ctx.models, tenantId: ctx.tenantId, sessionId: sid, itemId });
      await announce(sid, "item-removed", { itemId });
      return {};
    }));

    const leave = async () => {
      const sid = socket.data.sessionId;
      if (!sid) return;
      socket.data.sessionId = null;
      await socket.leave(room(sid));
      await announce(sid, "device-left");
    };
    socket.on("scanner:leave", guard(async () => { await leave(); }));
    socket.on("disconnect", () => { leave().catch(() => {}); });
  });
};
