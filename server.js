const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { Server } = require('socket.io');

const MESSAGE_LIMIT = 1000;
const MESSAGE_WINDOW_MS = 10_000;
const MESSAGE_WINDOW_LIMIT = 12;
const publicDirectory = path.join(__dirname, 'public');

function cleanTopics(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((topic) => typeof topic === 'string')
    .map((topic) => topic.trim().slice(0, 24))
    .filter(Boolean))].slice(0, 6);
}

function createChatServer({ reportLogger = console } = {}) {
  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer);
  const queue = [];
  const partners = new Map();
  const profiles = new Map();
  const blockedPeers = new Map();
  const messageTimes = new Map();

  app.disable('x-powered-by');
  app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));
  app.use(express.static(publicDirectory, { extensions: ['html'], maxAge: '1h' }));

  function broadcastStats() {
    io.emit('online-count', io.engine.clientsCount);
  }

  function removeFromQueue(socketId) {
    const index = queue.indexOf(socketId);
    if (index !== -1) queue.splice(index, 1);
  }

  function endChat(socket, notifyPartner = true) {
    removeFromQueue(socket.id);
    const partnerId = partners.get(socket.id);
    if (!partnerId) return;
    partners.delete(socket.id);
    partners.delete(partnerId);
    if (notifyPartner) io.to(partnerId).emit('partner-left');
  }

  function findMatch(socketId) {
    const ownTopics = profiles.get(socketId)?.topics ?? [];
    const ownBlocks = blockedPeers.get(socketId) ?? new Set();
    let bestIndex = -1;
    let bestScore = -1;

    queue.forEach((candidateId, index) => {
      if (candidateId === socketId || ownBlocks.has(candidateId)) return;
      if (blockedPeers.get(candidateId)?.has(socketId)) return;
      const candidateTopics = profiles.get(candidateId)?.topics ?? [];
      const score = ownTopics.filter((topic) => candidateTopics.includes(topic)).length;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    return bestIndex;
  }

  function match(socket, partnerId) {
    const partner = io.sockets.sockets.get(partnerId);
    if (!partner) return;
    const ownTopics = profiles.get(socket.id)?.topics ?? [];
    const partnerTopics = profiles.get(partnerId)?.topics ?? [];
    const sharedTopics = ownTopics.filter((topic) => partnerTopics.includes(topic));
    partners.set(socket.id, partnerId);
    partners.set(partnerId, socket.id);
    socket.emit('matched', { sharedTopics });
    partner.emit('matched', { sharedTopics });
  }

  io.on('connection', (socket) => {
    profiles.set(socket.id, { topics: [], adultConfirmed: false });
    blockedPeers.set(socket.id, new Set());
    messageTimes.set(socket.id, []);
    broadcastStats();

    socket.on('start', (options = {}) => {
      if (options.adultConfirmed !== true) {
        socket.emit('app-error', 'Please confirm that you are 18 or older before joining.');
        return;
      }

      endChat(socket);
      profiles.set(socket.id, { topics: cleanTopics(options.topics), adultConfirmed: true });
      const matchIndex = findMatch(socket.id);
      if (matchIndex === -1) {
        queue.push(socket.id);
        socket.emit('queue-status');
        return;
      }

      const partnerId = queue.splice(matchIndex, 1)[0];
      match(socket, partnerId);
    });

    socket.on('next', () => {
      if (!profiles.get(socket.id)?.adultConfirmed) {
        socket.emit('app-error', 'Please confirm that you are 18 or older before joining.');
        return;
      }
      endChat(socket);
      const matchIndex = findMatch(socket.id);
      if (matchIndex === -1) {
        queue.push(socket.id);
        socket.emit('queue-status');
        return;
      }
      const partnerId = queue.splice(matchIndex, 1)[0];
      match(socket, partnerId);
    });

    socket.on('stop', () => {
      endChat(socket);
      socket.emit('chat-stopped');
    });

    socket.on('message', (rawMessage) => {
      const partnerId = partners.get(socket.id);
      if (!partnerId || typeof rawMessage !== 'string') return;
      const message = rawMessage.trim().slice(0, MESSAGE_LIMIT);
      if (!message) return;

      const now = Date.now();
      const recentTimes = (messageTimes.get(socket.id) ?? [])
        .filter((sentAt) => now - sentAt < MESSAGE_WINDOW_MS);
      if (recentTimes.length >= MESSAGE_WINDOW_LIMIT) {
        socket.emit('app-error', 'You are sending messages too quickly. Please wait a moment.');
        return;
      }
      recentTimes.push(now);
      messageTimes.set(socket.id, recentTimes);
      io.to(partnerId).emit('message', { text: message, sentAt: now });
      socket.emit('message-sent', { text: message, sentAt: now });
    });

    socket.on('typing', (isTyping) => {
      const partnerId = partners.get(socket.id);
      if (partnerId) io.to(partnerId).emit('partner-typing', isTyping === true);
    });

    socket.on('report', (reason) => {
      const partnerId = partners.get(socket.id);
      if (!partnerId || typeof reason !== 'string') return;
      const allowedReasons = new Set(['harassment', 'spam', 'explicit-content', 'other']);
      if (!allowedReasons.has(reason)) return;

      blockedPeers.get(socket.id)?.add(partnerId);
      reportLogger.warn(JSON.stringify({
        type: 'chat-report',
        reason,
        reportedAt: new Date().toISOString(),
      }));
      socket.emit('report-accepted');
      endChat(socket);
    });

    socket.on('disconnect', () => {
      endChat(socket);
      profiles.delete(socket.id);
      blockedPeers.delete(socket.id);
      messageTimes.delete(socket.id);
      broadcastStats();
    });
  });

  return { app, httpServer, io };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const { httpServer } = createChatServer();
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Stranger Chat is running at http://localhost:${port}`);
  });
}

module.exports = { createChatServer };