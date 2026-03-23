const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const PORT = process.env.PORT || 3003;

const io = new Server(PORT, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

const devices = new Map();      // deviceId -> device info
const pairingCodes = new Map(); // code -> deviceId

console.log(`🚀 Signaling Server running on port ${PORT}`);

io.on("connection", (socket) => {
  console.log(`📱 Device connected: ${socket.id}`);
  const deviceId = uuidv4();

  socket.on("register", (data) => {
    const device = {
      id: deviceId,
      type: data.type,
      name: data.name || `${data.type}-${deviceId.slice(0, 6)}`,
      socketId: socket.id,
      capabilities: data.capabilities || {},
    };
    devices.set(deviceId, device);
    socket.data.deviceId = deviceId;
    socket.emit("registered", { id: deviceId, name: device.name });
    console.log(`✅ ${data.type.toUpperCase()} registered: ${device.name} (${deviceId})`);

    // If worker, generate pairing code
    if (data.type === "worker") {
      const code = generateCode();
      pairingCodes.set(code, deviceId);
      socket.data.pairingCode = code;
      socket.emit("pairing_code", { code });
      console.log(`🔗 Pairing code generated: ${code} for ${device.name}`);
    }
  });

  // Boss sends pair request
  socket.on("pair", (data) => {
    const code = (data.code || "").toUpperCase().trim();
    console.log(`🔗 Pair request with code: ${code}`);

    const workerId = pairingCodes.get(code);
    if (!workerId) {
      console.log(`❌ Invalid code: ${code}`);
      socket.emit("pair_error", { message: "Invalid pairing code" });
      return;
    }

    const worker = devices.get(workerId);
    if (!worker) {
      console.log(`❌ Worker not found for code: ${code}`);
      socket.emit("pair_error", { message: "Worker device not found" });
      return;
    }

    const bossId = socket.data.deviceId;
    const boss = devices.get(bossId);

    // Link them
    if (boss) boss.pairedWith = workerId;
    worker.pairedWith = bossId;

    // Notify boss
    socket.emit("paired", { workerId, workerName: worker.name });
    console.log(`✅ Paired: ${boss?.name} <-> ${worker.name}`);

    // Notify worker
    const workerSocket = io.sockets.sockets.get(worker.socketId);
    if (workerSocket) {
      workerSocket.emit("paired", { bossId, bossName: boss?.name });
    }
  });

  // Relay: start/stop stream
  socket.on("start_stream", (data) => {
    const target = devices.get(data.targetId);
    if (target) {
      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (targetSocket) targetSocket.emit("start_stream", data);
    }
  });

  socket.on("stop_stream", (data) => {
    const target = devices.get(data.targetId);
    if (target) {
      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (targetSocket) targetSocket.emit("stop_stream", data);
    }
  });

  // WebRTC signaling relay
  socket.on("offer", (data) => {
    const target = devices.get(data.targetId);
    if (target) {
      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (targetSocket) targetSocket.emit("offer", { ...data, fromId: socket.data.deviceId });
    }
  });

  socket.on("answer", (data) => {
    const target = devices.get(data.targetId);
    if (target) {
      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (targetSocket) targetSocket.emit("answer", { ...data, fromId: socket.data.deviceId });
    }
  });

  socket.on("ice_candidate", (data) => {
    const target = devices.get(data.targetId);
    if (target) {
      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (targetSocket) targetSocket.emit("ice_candidate", { ...data, fromId: socket.data.deviceId });
    }
  });

  socket.on("disconnect", () => {
    const devId = socket.data.deviceId;
    const device = devices.get(devId);
    if (device) {
      console.log(`❌ ${device.type?.toUpperCase()} disconnected: ${device.name}`);
      // Remove pairing code
      if (socket.data.pairingCode) pairingCodes.delete(socket.data.pairingCode);
      // Notify paired device
      if (device.pairedWith) {
        const paired = devices.get(device.pairedWith);
        if (paired) {
          const pairedSocket = io.sockets.sockets.get(paired.socketId);
          if (pairedSocket) pairedSocket.emit("peer_disconnected", {});
          paired.pairedWith = null;
        }
      }
      devices.delete(devId);
    }
  });
});

function generateCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
