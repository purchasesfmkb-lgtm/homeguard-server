const { createServer } = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const PORT = process.env.PORT || 8080;

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
});

const devices = new Map();
const pairingCodes = new Map();

io.on("connection", (socket) => {
  const deviceId = uuidv4();
  console.log(`📱 Device connected: ${socket.id}`);

  socket.on("register", (data) => {
    const device = {
      id: deviceId,
      type: data.type,
      name: data.name || `${data.type}-${deviceId.slice(0, 6)}`,
      socketId: socket.id,
    };
    devices.set(deviceId, device);
    socket.data.deviceId = deviceId;

    socket.emit("registered", { id: deviceId, name: device.name });
    console.log(`✅ ${data.type.toUpperCase()} registered: ${device.name}`);

    if (data.type === "worker") {
      const code = generateCode();
      pairingCodes.set(code, deviceId);
      socket.emit("pairing_code", { code });
      console.log(`🔗 Pairing code: ${code}`);
    }
  });

  socket.on("pair_request", (data) => {
    const code = (data.code || "").toUpperCase().trim();
    console.log(`🔗 Pair request: ${code}, Available: [${Array.from(pairingCodes.keys()).join(', ')}]`);

    const workerId = pairingCodes.get(code);
    if (!workerId) {
      socket.emit("pair_error", { message: "Invalid pairing code" });
      return;
    }

    const worker = devices.get(workerId);
    if (!worker) {
      socket.emit("pair_error", { message: "Worker not found" });
      return;
    }

    const bossId = socket.data.deviceId;
    const boss = devices.get(bossId);
    if (boss) boss.pairedWith = workerId;
    worker.pairedWith = bossId;

    socket.emit("paired", { workerId, workerName: worker.name });
    io.to(worker.socketId).emit("paired", { bossId, bossName: boss?.name });
    console.log(`✅ PAIRED: ${boss?.name} <-> ${worker.name}`);
    pairingCodes.delete(code);
  });

  socket.on("start_stream", (data) => {
    const device = devices.get(socket.data.deviceId);
    if (device?.pairedWith) {
      const worker = devices.get(device.pairedWith);
      if (worker) io.to(worker.socketId).emit("start_stream", data);
    }
  });

  socket.on("stop_stream", (data) => {
    const device = devices.get(socket.data.deviceId);
    if (device?.pairedWith) {
      const worker = devices.get(device.pairedWith);
      if (worker) io.to(worker.socketId).emit("stop_stream", data);
    }
  });

  socket.on("offer", (data) => {
    const target = devices.get(data.targetId);
    if (target) io.to(target.socketId).emit("offer", { senderId: socket.data.deviceId, offer: data.offer });
  });

  socket.on("answer", (data) => {
    const target = devices.get(data.targetId);
    if (target) io.to(target.socketId).emit("answer", { senderId: socket.data.deviceId, answer: data.answer });
  });

  socket.on("ice_candidate", (data) => {
    const target = devices.get(data.targetId);
    if (target) io.to(target.socketId).emit("ice_candidate", { senderId: socket.data.deviceId, candidate: data.candidate });
  });

  socket.on("disconnect", () => {
    const device = devices.get(socket.data?.deviceId);
    if (device) {
      console.log(`❌ ${device.type} disconnected: ${device.name}`);
      if (device.pairedWith) {
        const paired = devices.get(device.pairedWith);
        if (paired) {
          io.to(paired.socketId).emit("peer_disconnected", {});
          paired.pairedWith = null;
        }
      }
      devices.delete(socket.data.deviceId);
    }
  });
});

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

httpServer.listen(PORT, () => {
  console.log(`🚀 Signaling Server running on port ${PORT}`);
});
