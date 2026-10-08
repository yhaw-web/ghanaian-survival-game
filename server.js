import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import cors from 'cors';

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Store connected players: { playerId: { ws, username, avatar, position, lastPing } }
const players = new Map();

// Store messages: { fromId: { toId: [{ text, timestamp, read }] } }
const messageHistory = new Map();

// Store pending call requests: { fromId: toId }
const callRequests = new Map();

// Store active calls: { callId: { player1, player2, startTime } }
const activeCalls = new Map();

wss.on('connection', (ws) => {
  let playerId = null;
  let pingInterval = null;

  // Handle player join
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);

      if (message.type === 'join') {
        playerId = message.playerId;
        const playerData = {
          ws,
          username: message.username,
          avatar: message.avatar || '#7bc2ff',
          position: message.position || { x: 0, y: 0, z: 0 },
          lastPing: Date.now(),
          status: 'online',
        };
        players.set(playerId, playerData);

        // Send online players list to new player
        const onlineList = Array.from(players.entries()).map(([id, p]) => ({
          playerId: id,
          username: p.username,
          avatar: p.avatar,
          status: p.status,
        }));

        ws.send(
          JSON.stringify({
            type: 'playerJoined',
            data: { playerId, players: onlineList },
          })
        );

        // Broadcast to all that a player joined
        broadcastToAll(
          {
            type: 'playerOnline',
            data: {
              playerId,
              username: message.username,
              avatar: message.avatar,
            },
          },
          playerId
        );

        // Send ping every 30 seconds to detect disconnects
        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000);
      }

      // Text message
      if (message.type === 'message') {
        const { toId, text } = message;
        const msgData = { text, timestamp: Date.now(), read: false, fromId: playerId };

        // Store message
        if (!messageHistory.has(playerId)) messageHistory.set(playerId, new Map());
        if (!messageHistory.get(playerId).has(toId)) messageHistory.get(playerId).set(toId, []);
        messageHistory.get(playerId).get(toId).push(msgData);

        // Send to recipient if online
        const recipient = players.get(toId);
        if (recipient && recipient.ws.readyState === WebSocket.OPEN) {
          recipient.ws.send(
            JSON.stringify({
              type: 'messageReceived',
              data: { fromId: playerId, text, timestamp: msgData.timestamp },
            })
          );
        }

        // Confirm to sender
        ws.send(
          JSON.stringify({
            type: 'messageSent',
            data: { toId, text, timestamp: msgData.timestamp },
          })
        );
      }

      // Call request
      if (message.type === 'callRequest') {
        const { toId } = message;
        callRequests.set(playerId, toId);
        const recipient = players.get(toId);
        if (recipient && recipient.ws.readyState === WebSocket.OPEN) {
          recipient.ws.send(
            JSON.stringify({
              type: 'incomingCall',
              data: {
                fromId: playerId,
                username: players.get(playerId).username,
                avatar: players.get(playerId).avatar,
              },
            })
          );
        }
      }

      // Call accept
      if (message.type === 'callAccept') {
        const { fromId } = message;
        const callId = `${Math.min(playerId, fromId)}-${Math.max(playerId, fromId)}`;
        activeCalls.set(callId, {
          player1: playerId,
          player2: fromId,
          startTime: Date.now(),
        });

        callRequests.delete(fromId);

        // Notify both players
        const otherPlayer = players.get(fromId);
        if (otherPlayer && otherPlayer.ws.readyState === WebSocket.OPEN) {
          otherPlayer.ws.send(
            JSON.stringify({
              type: 'callStarted',
              data: { callId, withId: playerId, username: players.get(playerId).username },
            })
          );
        }
        ws.send(
          JSON.stringify({
            type: 'callStarted',
            data: { callId, withId: fromId, username: players.get(fromId).username },
          })
        );
      }

      // Call decline
      if (message.type === 'callDecline') {
        const { fromId } = message;
        callRequests.delete(fromId);
        const caller = players.get(fromId);
        if (caller && caller.ws.readyState === WebSocket.OPEN) {
          caller.ws.send(
            JSON.stringify({
              type: 'callDeclined',
              data: { byId: playerId },
            })
          );
        }
      }

      // Call end
      if (message.type === 'callEnd') {
        const { callId } = message;
        const call = activeCalls.get(callId);
        if (call) {
          const otherPlayerId = call.player1 === playerId ? call.player2 : call.player1;
          const otherPlayer = players.get(otherPlayerId);
          if (otherPlayer && otherPlayer.ws.readyState === WebSocket.OPEN) {
            otherPlayer.ws.send(
              JSON.stringify({
                type: 'callEnded',
                data: { callId },
              })
            );
          }
          activeCalls.delete(callId);
        }
      }

      // Position update
      if (message.type === 'positionUpdate') {
        const player = players.get(playerId);
        if (player) {
          player.position = message.position;
        }
      }

      // Pong response
      if (message.type === 'pong') {
        const player = players.get(playerId);
        if (player) {
          player.lastPing = Date.now();
        }
      }
    } catch (error) {
      console.error('Message handling error:', error);
    }
  });

  // Handle disconnect
  ws.on('close', () => {
    if (playerId && players.has(playerId)) {
      const player = players.get(playerId);
      player.status = 'offline';
      players.delete(playerId);

      // Cancel any pending calls
      callRequests.forEach((toId, fromId) => {
        if (fromId === playerId || toId === playerId) {
          callRequests.delete(fromId);
        }
      });

      // End active calls
      activeCalls.forEach((call, callId) => {
        if (call.player1 === playerId || call.player2 === playerId) {
          const otherPlayerId = call.player1 === playerId ? call.player2 : call.player1;
          const otherPlayer = players.get(otherPlayerId);
          if (otherPlayer && otherPlayer.ws.readyState === WebSocket.OPEN) {
            otherPlayer.ws.send(
              JSON.stringify({
                type: 'callEnded',
                data: { callId },
              })
            );
          }
          activeCalls.delete(callId);
        }
      });

      // Broadcast player offline
      broadcastToAll(
        {
          type: 'playerOffline',
          data: { playerId },
        },
        null
      );
    }

    if (pingInterval) clearInterval(pingInterval);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

function broadcastToAll(message, excludePlayerId) {
  players.forEach((player, playerId) => {
    if (playerId !== excludePlayerId && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify(message));
    }
  });
}

// Cleanup inactive connections every 60 seconds
setInterval(() => {
  const now = Date.now();
  players.forEach((player, playerId) => {
    if (now - player.lastPing > 90000) {
      player.ws.close();
    }
  });
}, 60000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Multiplayer server running on ws://localhost:${PORT}`);
});
