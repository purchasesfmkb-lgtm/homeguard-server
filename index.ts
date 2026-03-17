import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";

// Use PORT from environment variable (Railway sets this automatically)
const PORT = parseInt(process.env.PORT || "3003");

const io = new Server(PORT, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

// Store connected devices
const devices = new Map<
  string,
  {
    id: string;
    type: "worker" | "boss";
    name?: string;
    pairedWith?: string;
    socketId: string;
    capabilities?: {
      camera: boolean;
      audio: boolean;
      screen: boolean;
    };
  }
>();

// Store pairing codes
const pairingCodes = new Map<string, string>(); // code -> workerId

console.log(`🚀 Signaling Server running on port ${PORT}`);

io.on("connection", (socket) => {
  console.log(`📱 Device connected: ${socket.id}`);

  // Generate unique device ID
  const deviceId = uuidv4();

  socket.on("register", (data: { type: "worker" | "boss"; name?: string; capabilities?: { camera: boolean; audio: boolean; screen: boolean } }) => {
    const device = {
      id: deviceId,
      type: data.type,
      name: data.name || `${data.type}-${deviceId.slice(0, 6)}`,
      socketId: socket.id,
      capabilities: data.capabilities,
    };

    devices.set(deviceId, device);
    socket.data.deviceId = deviceId;

    console.log(`✅ ${data.type.toUpperCase()} registered: ${device.name} (${deviceId})`);

    socket.emit("registered", {
      id: deviceId,
      name: device.name,
    });

    // If worker, generate pairing code
    if (data.type === "worker") {
      const pairingCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      pairingCodes.set(pairingCode, deviceId);
      socket.emit("pairing_code", { code: pairingCode });
      console.log(`🔗 Pairing code generated: ${pairingCode} for ${device.name}`);
    }
  });

  // Boss requests to pair with worker using code
  socket.on("pair_request", (data: { code: string }) => {
    const workerId = pairingCodes.get(data.code);

    if (!workerId) {
      socket.emit("pair_error", { message: "Invalid pairing code" });
      return;
    }

    const worker = devices.get(workerId);
    const boss = devices.get(socket.data.deviceId);

    if (!worker || !boss) {
      socket.emit("pair_error", { message: "Device not found" });
      return;
    }

    // Pair the devices
    worker.pairedWith = boss.id;
    boss.pairedWith = worker.id;

    // Notify both devices
    socket.emit("paired", {
      workerId: worker.id,
      workerName: worker.name,
      capabilities: worker.capabilities,
    });

    io.to(worker.socketId).emit("paired", {
      bossId: boss.id,
      bossName: boss.name,
    });

    // Remove used pairing code
    pairingCodes.delete(data.code);

    console.log(`🔗 PAIRED: ${worker.name} <-> ${boss.name}`);
  });

  // Worker generates new pairing code
  socket.on("generate_pairing_code", () => {
    const deviceId = socket.data.deviceId;
    if (!deviceId) return;

    const device = devices.get(deviceId);
    if (!device || device.type !== "worker") return;

    // Remove old pairing codes for this device
    for (const [code, id] of pairingCodes) {
      if (id === deviceId) {
        pairingCodes.delete(code);
      }
    }

    const pairingCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    pairingCodes.set(pairingCode, deviceId);
    socket.emit("pairing_code", { code: pairingCode });
    console.log(`🔗 New pairing code: ${pairingCode} for ${device.name}`);
  });

  // WebRTC Signaling - Offer
  socket.on("offer", (data: { targetId: string; offer: RTCSessionDescriptionInit }) => {
    const targetDevice = devices.get(data.targetId);
    if (targetDevice) {
      const sender = devices.get(socket.data.deviceId);
      io.to(targetDevice.socketId).emit("offer", {
        senderId: socket.data.deviceId,
        senderName: sender?.name,
        offer: data.offer,
      });
      console.log(`📤 Offer sent from ${sender?.name} to ${targetDevice.name}`);
    }
  });

  // WebRTC Signaling - Answer
  socket.on("answer", (data: { targetId: string; answer: RTCSessionDescriptionInit }) => {
    const targetDevice = devices.get(data.targetId);
    if (targetDevice) {
      const sender = devices.get(socket.data.deviceId);
      io.to(targetDevice.socketId).emit("answer", {
        senderId: socket.data.deviceId,
        answer: data.answer,
      });
      console.log(`📥 Answer sent from ${sender?.name} to ${targetDevice.name}`);
    }
  });

  // WebRTC Signaling - ICE Candidate
  socket.on("ice_candidate", (data: { targetId: string; candidate: RTCIceCandidateInit }) => {
    const targetDevice = devices.get(data.targetId);
    if (targetDevice) {
      io.to(targetDevice.socketId).emit("ice_candidate", {
        senderId: socket.data.deviceId,
        candidate: data.candidate,
      });
    }
  });

  // Stream Control Commands (Boss -> Worker)
  socket.on("start_stream", (data: { streamType: "camera" | "audio" | "screen"; cameraId?: "front" | "back" }) => {
    const deviceId = socket.data.deviceId;
    const device = devices.get(deviceId);
    if (!device || device.type !== "boss") return;

    const worker = devices.get(device.pairedWith!);
    if (worker) {
      io.to(worker.socketId).emit("start_stream", {
        streamType: data.streamType,
        cameraId: data.cameraId || "back",
        bossId: deviceId,
      });
      console.log(`🎥 Start ${data.streamType} stream command sent to ${worker.name}`);
    }
  });

  socket.on("stop_stream", (data: { streamType: "camera" | "audio" | "screen" }) => {
    const deviceId = socket.data.deviceId;
    const device = devices.get(deviceId);
    if (!device || device.type !== "boss") return;

    const worker = devices.get(device.pairedWith!);
    if (worker) {
      io.to(worker.socketId).emit("stop_stream", {
        streamType: data.streamType,
      });
      console.log(`⏹️ Stop ${data.streamType} stream command sent to ${worker.name}`);
    }
  });

  // Heartbeat for connection monitoring
  socket.on("heartbeat", () => {
    const deviceId = socket.data.deviceId;
    if (deviceId) {
      const device = devices.get(deviceId);
      if (device) {
        socket.emit("heartbeat_ack", { timestamp: Date.now() });
      }
    }
  });

  // Disconnect handling
  socket.on("disconnect", () => {
    const deviceId = socket.data.deviceId;
    if (deviceId) {
      const device = devices.get(deviceId);
      if (device) {
        console.log(`❌ ${device.type.toUpperCase()} disconnected: ${device.name}`);

        // Notify paired device about disconnection
        if (device.pairedWith) {
          const pairedDevice = devices.get(device.pairedWith);
          if (pairedDevice) {
            io.to(pairedDevice.socketId).emit("peer_disconnected", {
              deviceId: deviceId,
              deviceName: device.name,
            });
            pairedDevice.pairedWith = undefined;
          }
        }

        // Clean up pairing codes
        if (device.type === "worker") {
          for (const [code, id] of pairingCodes) {
            if (id === deviceId) {
              pairingCodes.delete(code);
            }
          }
        }

        devices.delete(deviceId);
      }
    }
  });

  // Get device status
  socket.on("get_status", () => {
    const deviceId = socket.data.deviceId;
    const device = devices.get(deviceId);

    if (device && device.pairedWith) {
      const pairedDevice = devices.get(device.pairedWith);
      if (pairedDevice) {
        socket.emit("status", {
          paired: true,
          peerName: pairedDevice.name,
          peerType: pairedDevice.type,
          capabilities: pairedDevice.capabilities,
        });
        return;
      }
    }

    socket.emit("status", {
      paired: false,
    });
  });
});
