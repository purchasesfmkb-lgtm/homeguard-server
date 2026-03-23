import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";

const PORT = process.env.PORT || 8080;

const io = new Server(Number(PORT), {
  cors: { origin: "*", methods: ["GET", "POST"], credentials: true },
  transports: ["websocket", "polling"],
});

const devices = new Map();
const pairingCodes = new Map();

console.log(`🚀 Signaling Server running on port ${PORT}`);

io.on("connection", (socket) => {
  console.log(`📱 Device connected: ${socket.id}`);
  const deviceId = uuidv4();

  socket.on("register", (data: any) => {
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

    if (data.type === "worker") {
      const code = generateCode();
      pairingCodes.set(code, deviceId);
      socket.data.pairingCode = code;
      socket.emit("pairing_code", { code });
      console.log(`🔗 Pairing code generated: ${code} for ${device.name}`);
    }
  });

  socket.on("pair", (data: any) => {
    const code = (data.code || "").toUpperCase().trim();
    console.log(`🔗 Pair request with code: ${code}`);
    const workerId = pairingCodes.get(code);
    if (!workerId) { socket.emit("pair_error", { message: "Invalid pairing code" }); return; }
    const worker = devices.get(workerId);
    if (!worker) { socket.emit("pair_error", { message: "Worker not found" }); return; }
    const bossId = socket.data.deviceId;
    const boss = devices.get(bossId);
    if (boss) boss.pairedWith = workerId;
    worker.pairedWith = bossId;
    socket.emit("paired", { workerId, workerName: worker.name });
    console.log(`✅ Paired: ${boss?.name} <-> ${worker.name}`);
    const workerSocket = io.sockets.sockets.get(worker.socketId);
    if (workerSocket) workerSocket.emit("paired", { bossId, bossName: boss?.name });
  });

  socket.on("start_stream", (data: any) => relay(data.targetId, "start_stream", data));
  socket.on("stop_stream", (data: any) => relay(data.targetId, "stop_stream", data));
  socket.on("offer", (data: any) => relay(data.targetId, "offer", { ...data, fromId: socket.data.deviceId }));
  socket.on("answer", (data: any) => relay(data.targetId, "answer", { ...data, fromId: socket.data.deviceId }));
  socket.on("ice_candidate", (data: any) => relay(data.targetId, "ice_candidate", { ...data, fromId: socket.data.deviceId }));

  socket.on("disconnect", () => {
    const devId = socket.data.deviceId;
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

  function relay(targetId: string, event: string, data: any) {
    const target = devices.get(targetId);
    if (target) {
      const ts = io.sockets.sockets.get(target.socketId);
      if (ts) ts.emit(event, data);
    }
  }
});

function generateCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
