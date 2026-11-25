const Trip = require("./trip.model");
const Driver = require("./driver.model");

/**
 * Calculates distance in km between two lat/lng coordinates (Haversine formula).
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  const R = 6371; // Radius of the Earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

module.exports = function registerLogisticsSocket(io) {
  const ns = io.of("/logistics");

  ns.on("connection", (socket) => {
    // 1. Join a specific trip room (used by driver, admin, or receiver tracking page)
    socket.on("trip:join", ({ tripId, trackingToken, tenantId, driverId }) => {
      socket.data = socket.data || {};
      if (tripId) {
        socket.join(`trip_${tripId}`);
        socket.data.tripId = tripId;
      }
      if (trackingToken) {
        socket.join(`token_${trackingToken}`);
        socket.data.trackingToken = trackingToken;
      }
      if (tenantId) {
        socket.join(`tenant_${tenantId}`);
        socket.data.tenantId = tenantId;
      }
      if (driverId) {
        socket.data.driverId = driverId;
      }
    });

    // 2. Driver emits real-time GPS location
    socket.on(
      "driver:location",
      async ({ tripId, driverId, tenantId, lat, lng, speed, heading, accuracy }) => {
        try {
          if (!lat || !lng) return;

          const now = new Date();
          const locationData = {
            lat: Number(lat),
            lng: Number(lng),
            speed: Number(speed || 0),
            heading: Number(heading || 0),
            accuracy: Number(accuracy || 0),
            updatedAt: now,
          };

          // Broadcast to anyone listening to this trip immediately for zero latency (< 50ms)
          if (tripId) {
            ns.to(`trip_${tripId}`).emit("trip:location_update", {
              tripId,
              location: locationData,
            });
          }

          // Broadcast to fleet admin dashboard
          const effectiveTenantId = tenantId || socket.data?.tenantId;
          if (effectiveTenantId) {
            ns.to(`tenant_${effectiveTenantId}`).emit("fleet:driver_update", {
              driverId,
              tripId,
              location: locationData,
            });
          }

          // Asynchronously persist to database
          if (tripId) {
            const trip = await Trip.findById(tripId);
            if (trip) {
              // Calculate incremental distance if there was a previous point
              let extraKm = 0;
              if (trip.currentLocation?.lat && trip.currentLocation?.lng) {
                extraKm = haversineDistance(
                  trip.currentLocation.lat,
                  trip.currentLocation.lng,
                  locationData.lat,
                  locationData.lng
                );
                // Sanity check: ignore GPS jumps > 5km in a single ping
                if (extraKm > 5) extraKm = 0;
              }

              trip.currentLocation = locationData;
              trip.distanceCoveredKm = Number(
                ((trip.distanceCoveredKm || 0) + extraKm).toFixed(2)
              );

              // Append breadcrumb
              trip.path.push({
                lat: locationData.lat,
                lng: locationData.lng,
                speed: locationData.speed,
                heading: locationData.heading,
                timestamp: now,
              });

              // Keep last 1500 points to prevent document bloat
              if (trip.path.length > 1500) {
                trip.path = trip.path.slice(-1500);
              }

              await trip.save();

              // Also notify via token room for public receivers
              if (trip.trackingToken) {
                ns.to(`token_${trip.trackingToken}`).emit(
                  "trip:location_update",
                  {
                    tripId,
                    location: locationData,
                    distanceCoveredKm: trip.distanceCoveredKm,
                  }
                );
              }

              // Also ensure tenant fleet map is updated
              if (trip.tenantId && String(trip.tenantId) !== String(effectiveTenantId)) {
                ns.to(`tenant_${trip.tenantId}`).emit("fleet:driver_update", {
                  driverId,
                  tripId,
                  location: locationData,
                  distanceCoveredKm: trip.distanceCoveredKm,
                });
              }
            }
          }

          // Update driver's last known location
          if (driverId) {
            await Driver.findByIdAndUpdate(driverId, {
              currentLocation: locationData,
            });
          }
        } catch (err) {
          console.error("Error handling driver:location socket event:", err);
        }
      }
    );

    // 3. Driver or Admin updates trip status
    socket.on("trip:status_change", async ({ tripId, status }) => {
      try {
        if (!tripId || !status) return;

        const update = { status };
        if (status === "STARTED") update.startedAt = new Date();
        if (status === "COMPLETED") update.completedAt = new Date();

        const updatedTrip = await Trip.findByIdAndUpdate(tripId, update, {
          new: true,
        });

        if (updatedTrip) {
          ns.to(`trip_${tripId}`).emit("trip:status_update", {
            tripId,
            status,
            trip: updatedTrip,
          });

          if (updatedTrip.trackingToken) {
            ns.to(`token_${updatedTrip.trackingToken}`).emit(
              "trip:status_update",
              {
                tripId,
                status,
                trip: updatedTrip,
              }
            );
          }

          if (updatedTrip.tenantId) {
            ns.to(`tenant_${updatedTrip.tenantId}`).emit(
              "fleet:status_update",
              {
                tripId,
                status,
                trip: updatedTrip,
              }
            );
          }
        }
      } catch (err) {
        console.error("Error handling trip:status_change socket event:", err);
      }
    });

    socket.on("disconnect", () => {
      // Clean up
    });
  });

  return ns;
};
