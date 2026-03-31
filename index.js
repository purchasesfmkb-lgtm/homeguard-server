const { createServer } = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 8080;

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});

const devices = new Map();
const codes = new Map();

console.log('🚀 HomeGuard Server Started on port ' + PORT);

io.on('connection', (socket) => {
  console.log('📱 Connected:', socket.id);
  
  socket.on('register', (data) => {
    const device = {
      id: socket.id,
      type: data.type,
      name: data.name || data.type,
      socket: socket
    };
    devices.set(socket.id, device);
    socket.deviceId = socket.id;
    socket.deviceType = data.type;
    
    socket.emit('registered', { id: socket.id });
    console.log('✅', data.type.toUpperCase(), 'registered');
    
    if (data.type === 'worker') {
      const code = generateCode();
      codes.set(code, socket.id);
      socket.currentCode = code;
      socket.emit('pairing_code', { code });
      console.log('🔗 Code:', code);
    }
  });
  
  socket.on('pair_request', (data) => {
    const code = (data.code || '').toUpperCase().trim();
    console.log('🔍 Pair request:', code, '| Available:', Array.from(codes.keys()));
    
    const workerSocketId = codes.get(code);
    if (!workerSocketId) {
      console.log('❌ Invalid code');
      socket.emit('pair_error', { message: 'Invalid code' });
      return;
    }
    
    const worker = devices.get(workerSocketId);
    const boss = devices.get(socket.id);
    
    if (!worker || !boss) {
      socket.emit('pair_error', { message: 'Device not found' });
      return;
    }
    
    worker.bossId = socket.id;
    boss.workerId = workerSocketId;
    
    socket.emit('paired', { workerId: workerSocketId, workerName: worker.name });
    worker.socket.emit('paired', { bossId: socket.id });
    console.log('✅ PAIRED:', boss.name, '<->', worker.name);
    
    codes.delete(code);
  });
  
  socket.on('start_stream', (data) => {
    const device = devices.get(socket.id);
    if (device && device.workerId) {
      const worker = devices.get(device.workerId);
      if (worker) {
        worker.socket.emit('start_stream', data);
        console.log('🎥 Start stream:', data.streamType);
      }
    }
  });
  
  socket.on('stop_stream', (data) => {
    const device = devices.get(socket.id);
    if (device && device.workerId) {
      const worker = devices.get(device.workerId);
      if (worker) {
        worker.socket.emit('stop_stream', data);
      }
    }
  });
  
  socket.on('offer', (data) => {
    const targetId = data.targetId || socket.workerId || socket.bossId;
    const target = devices.get(targetId);
    if (target) {
      target.socket.emit('offer', { senderId: socket.id, offer: data.offer });
    }
  });
  
  socket.on('answer', (data) => {
    const targetId = data.targetId || socket.workerId || socket.bossId;
    const target = devices.get(targetId);
    if (target) {
      target.socket.emit('answer', { senderId: socket.id, answer: data.answer });
    }
  });
  
  socket.on('ice_candidate', (data) => {
    const targetId = data.targetId || socket.workerId || socket.bossId;
    const target = devices.get(targetId);
    if (target) {
      target.socket.emit('ice_candidate', { senderId: socket.id, candidate: data.candidate });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('❌ Disconnected:', socket.deviceType, socket.id);
    if (socket.currentCode) codes.delete(socket.currentCode);
    devices.delete(socket.id);
  });
});

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('✅ Server listening on port', PORT);
});
