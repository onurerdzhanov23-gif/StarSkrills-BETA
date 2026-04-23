// Unified Multiplayer Server v2.1 (Auto-Deployed)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// Disable cache
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Expires', '0');
  next();
});

// Serve static files properly without blocking the rest of the application
app.use(express.static(__dirname, {
  maxAge: 0,
  etag: false,
  fallthrough: true
}));

// Route for the main game
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

const WebSocket = require('ws');
const https = require('https');
const fs = require('fs');

let registeredNames = [];
const namesFile = path.join(__dirname, 'registered_names.json');
if (fs.existsSync(namesFile)) {
    try { registeredNames = JSON.parse(fs.readFileSync(namesFile, 'utf8')); } catch(e) {}
}
function saveNames() {
    try { fs.writeFileSync(namesFile, JSON.stringify(registeredNames, null, 2)); } catch(e) {}
}

// Game state
const players = new Map();
const rooms = new Map();
const wsClients = new Map();
const wss = new WebSocket.Server({ noServer: true });
const MAX_PLAYERS_PER_ROOM = 10;

console.log('🚀 Servidor Brawl Clone 3D iniciado');

// Main page - Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Server stats
app.get('/stats', (req, res) => {
    res.json({
        players: players.size,
        rooms: rooms.size,
        uptime: process.uptime()
    });
});

// Socket.io connection
io.on('connection', (socket) => {
    console.log(`✅ Jugador conectado: ${socket.id}`);
    
    let currentRoom = null;
    let playerData = null;

    // Player joins a room
    socket.on('join-room', (data) => {
        const { roomId, playerName, characterColor, characterType } = data;
        
        if (currentRoom) leaveRoom(socket, currentRoom);

        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                id: roomId,
                players: new Map(),
                gameState: { started: false, countdown: false }
            });
            console.log(`🏠 Sala creada: ${roomId}`);
        }

        const room = rooms.get(roomId);

        if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
            socket.emit('room-full', { roomId });
            return;
        }

        playerData = {
            id: socket.id,
            name: playerName || `Jugador ${players.size + 1}`,
            color: characterColor || '#00FF88',
            type: characterType || 'normal',
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            health: 100,
            alive: true,
            lastUpdate: Date.now()
        };

        room.players.set(socket.id, playerData);
        currentRoom = roomId;
        socket.join(roomId);

        socket.emit('joined-room', {
            roomId,
            playerId: socket.id,
            players: Array.from(room.players.values())
        });

        socket.to(roomId).emit('player-joined', playerData);
        console.log(`${playerData.name} se unió a ${roomId}`);
    });

    socket.on('player-move', (data) => {
        if (!currentRoom || !playerData) return;
        const room = rooms.get(currentRoom);
        if (!room) return;

        const player = room.players.get(socket.id);
        if (player) {
            player.position = data.position || player.position;
            player.rotation = data.rotation || player.rotation;
            socket.to(currentRoom).emit('player-moved', {
                id: socket.id,
                position: player.position,
                rotation: player.rotation
            });
        }
    });

    socket.on('player-attack', (data) => {
        if (!currentRoom || !playerData) return;
        socket.to(currentRoom).emit('player-attacked', {
            id: socket.id,
            attackData: data,
            position: playerData.position
        });
    });

    socket.on('chat-message', (data) => {
        if (!currentRoom || !playerData) return;
        io.to(currentRoom).emit('chat-message', {
            id: socket.id,
            name: playerData.name,
            message: data.message.substring(0, 200),
            time: Date.now()
        });
    });

    socket.on('disconnect', () => {
        console.log(`❌ Jugador desconectado: ${socket.id}`);
        if (currentRoom) leaveRoom(socket, currentRoom);
    });

    function leaveRoom(socket, roomId) {
        const room = rooms.get(roomId);
        if (room) {
            room.players.delete(socket.id);
            socket.leave(roomId);
            socket.to(roomId).emit('player-left', { id: socket.id });
            if (room.players.size === 0) rooms.delete(roomId);
        }
        currentRoom = null;
        playerData = null;
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor en puerto ${PORT}`);
});

// WebSocket server para lista de jugadores
server.on('upgrade', (request, socket, head) => {
    if (request.url.startsWith('/ws')) {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    }
});

wss.on('connection', (ws, req) => {
    const id = 'user_' + Date.now() + Math.random().toString(36).substr(2, 5);
    wsClients.set(id, ws);
    console.log(`🔌 WS cliente: ${id}`);
    
    ws.send(JSON.stringify({ type: 'welcome', id }));
    
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            
            if (msg.type === 'register') {
                let name = msg.name || 'Anon';
                name = name.replace(/[^a-zA-Z0-9_ñÑ]/g, '');
                let finalName = name;
                let counter = 0;
                while (registeredNames.includes(finalName)) {
                    counter++;
                    finalName = name + counter;
                }
                if (!registeredNames.includes(finalName)) {
                    registeredNames.push(finalName);
                    saveNames();
                }
                ws.playerName = finalName;
                ws.playerState = 'menu';
                ws.send(JSON.stringify({ type: 'registered', name: finalName }));
            }
            
            if (msg.type === 'game-start') {
                ws.playerState = 'playing';
                updateActivePlayers();
            }
            
            if (msg.type === 'game-end') {
                ws.playerState = 'menu';
                updateActivePlayers();
            }
            
            if (msg.type === 'get-active') {
                updateActivePlayers();
            }
            
            if (msg.type === 'spectate') {
                const targetName = msg.target;
                let targetPos = null;
                wsClients.forEach((w) => {
                    if (w.playerName === targetName && w.playerState === 'playing') {
                        targetPos = w.playerPosition;
                    }
                });
                ws.send(JSON.stringify({ type: 'spectate-ok', target: targetName, position: targetPos }));
            }
            
            if (msg.type === 'position-update') {
                ws.playerPosition = msg.position;
            }
            
            if (msg.type === 'get-players') {
                const connectedPlayers = [];
                const playingPlayers = [];
                wsClients.forEach((w, id) => {
                    if (w.readyState === WebSocket.OPEN && w.playerName) {
                        connectedPlayers.push(w.playerName);
                        if (w.playerState === 'playing') {
                            playingPlayers.push(w.playerName);
                        }
                    }
                });
                ws.send(JSON.stringify({ 
                    type: 'players-list', 
                    players: connectedPlayers,
                    playing: playingPlayers 
                }));
            }
            
            if (msg.type === 'move') {
                ws.send(JSON.stringify({ type: 'moved', id, x: msg.x, y: msg.y }));
            }
        } catch(e) {}
    });
    
    ws.on('close', () => {
        wsClients.delete(id);
        console.log(`❌ WS desconectado: ${id}`);
    });
    
    function updateActivePlayers() {
        const activePlayers = [];
        wsClients.forEach((w) => {
            if (w.readyState === WebSocket.OPEN && w.playerName && w.playerState === 'playing') {
                activePlayers.push({ name: w.playerName, position: w.playerPosition });
            }
        });
        ws.send(JSON.stringify({ type: 'active-players', players: activePlayers }));
    }
});