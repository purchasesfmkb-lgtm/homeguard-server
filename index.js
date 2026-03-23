const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 8080;

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"], credentials: true },
  transports: ['websocket', 'polling'],
});

const devices = new Map();
const pairingCodes = new Map();

console.log(`🚀 Signaling Server running on port ${PORT}`);

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', service: 'HomeGuard' }));
app.get('/health', (req, res) => res.json({ status: 'healthy' }));

io.on("connection", (socket) => {
  const deviceId = uuidv4();
  console.log(`📱 Device connected: ${socket.id}`);

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
    socket.data.deviceType = data.type;
    
    socket.emit("registered", { id: deviceId, name: device.name });
    console.log(`✅ ${data.type.toUpperCase()} registered: ${device.name}`);

    if (data.type === "worker") {
      const code = generateCode();
      pairingCodes.set(code, deviceId);
      socket.data.pairingCode = code;
      socket.emit("pairing_code", { code });
      console.log(`🔗 Pairing code: ${code} for ${device.name}`);
    }
  });

  // FIXED: Listen for 'pair_request' (matches dashboard)
  socket.on("pair_request", (data) => {
    const code = (data.code || "").toUpperCase().trim();
    console.log(`🔗 Pair request with code: ${code}`);
    console.log(`📋 Available codes: [${Array.from(pairingCodes.keys()).join(', ')}]`);
    
    const workerId = pairingCodes.get(code);
    if (!workerId) {
      console.log(`❌ Invalid code: ${code}`);
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
    
    // Notify boss
    socket.emit("paired", { workerId, workerName: worker.name, capabilities: worker.capabilities });
    console.log(`✅ PAIRED: Boss(${boss?.name}) <-> Worker(${worker.name})`);
    
    // Notify worker
    const workerSocket = io.sockets.sockets.get(worker.socketId);
    if (workerSocket) {
      workerSocket.emit("paired", { bossId, bossName: boss?.name });
    }
    
    // Remove used code
    pairingCodes.delete(code);
  });

  // Stream commands
  socket.on("start_stream", (data) => {
    const device = devices.get(socket.data.deviceId);
    if (device?.pairedWith) {
      const worker = devices.get(device.pairedWith);
      if (worker) {
        const ws = io.sockets.sockets.get(worker.socketId);
        if (ws) ws.emit("start_stream", data);
        console.log(`🎥 START ${data.streamType}`);
      }
    }
  });

  socket.on("stop_stream", (data) => {
    const device = devices.get(socket.data.deviceId);
    if (device?.pairedWith) {
      const worker = devices.get(device.pairedWith);
      if (worker) {
        const ws = io.sockets.sockets.get(worker.socketId);
        if (ws) ws.emit("stop_stream", data);
      }
    }
  });

  // WebRTC signaling
  socket.on("offer", (data) => {
    const target = devices.get(data.targetId);
    if (target) {
      const ts = io.sockets.sockets.get(target.socketId);
      if (ts) ts.emit("offer", { senderId: socket.data.deviceId, offer: data.offer });
    }
  });

  socket.on("answer", (data) => {
    const target = devices.get(data.targetId);
    if (target) {
      const ts = io.sockets.sockets.get(target.socketId);
      if (ts) ts.emit("answer", { senderId: socket.data.deviceId, answer: data.answer });
    }
  });

  socket.on("ice_candidate", (data) => {
    const target = devices.get(data.targetId);
    if (target) {
      const ts = io.sockets.sockets.get(target.socketId);
      if (ts) ts.emit("ice_candidate", { senderId: socket.data.deviceId, candidate: data.candidate });
    }
  });

  socket.on("disconnect", () => {
    const devId = socket.data?.deviceId;
    const device = devices.get(devId);
    if (device) {
      console.log(`❌ ${device.type?.toUpperCase()} disconnected: ${device.name}`);
      if (socket.data.pairingCode) pairingCodes.delete(socket.data.pairingCode);
      if (device.pairedWith) {
        const paired = devices.get(device.pairedWith);
        if (paired) {
          const ps = io.sockets.sockets.get(paired.socketId);
          if (ps) ps.emit("peer_disconnected", {});
          paired.pairedWith = null;
        }
      }
      devices.delete(devId);
    }
  });
});

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
