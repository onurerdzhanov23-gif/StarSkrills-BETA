// Simple name handler
function getMyName() {
    var input = document.getElementById('username-input');
    var name = '';
    if (input && input.value && input.value.length >= 2) {
        name = input.value.trim().substring(0, 12);
        sessionStorage.setItem('myName', name);
    } else {
        name = sessionStorage.getItem('myName') || '';
    }
    if (input && name && input.value !== name) {
        input.value = name;
    }
    return name;
}

// Dummy sendToServer to avoid errors - Firebase handles multiplayer now
function sendToServer(data) {
    // Not used anymore
}

function connectWebSocket() {
    return new Promise(function(resolve, reject) {
        // Try multiple WebSocket URLs
        var protocols = [
            'wss://starskrills-1.onrender.com/ws',
            'wss://starskrills-1.onrender.com/websocket',
            'wss://starskrills-1.onrender.com'
        ];
        
        var tryIndex = 0;
        
        function tryConnect() {
            if (tryIndex >= protocols.length) {
                reject(new Error('No se pudo conectar'));
                return;
            }
            
            var url = protocols[tryIndex];
            console.log('Intentando WS:', url);
            
            try {
                var testWs = new WebSocket(url);
                testWs.onopen = function() {
                    console.log('✅ Conectado a:', url);
                    resolve({ ws: testWs, url: url });
                };
                testWs.onerror = function(e) {
                    console.log('❌ Error con:', url);
                    tryIndex++;
                    tryConnect();
                };
                testWs.onclose = function() {
                    tryIndex++;
                    tryConnect();
                };
            } catch(e) {
                tryIndex++;
                tryConnect();
            }
        }
        
        tryConnect();
    });
}

// Auto-connect on load
window.addEventListener('load', function() {
    setTimeout(function() {
        var myName = getMyName();
        
        // Update display
        var input = document.getElementById('username-input');
        if (input && myName) input.value = myName;
        
        // Show connecting status
        var counter = document.getElementById('online-players');
        if (counter) counter.innerHTML = '⚡ Conectando...';
        
        // Try to connect
        connectWebSocket().then(function(result) {
            ws = result.ws;
            isOnline = true;
            
            if (counter) counter.innerHTML = '🟢 Conectado';
            console.log('WS conectado');
            
            if (myName && myName.length >= 2) {
                ws.send(JSON.stringify({ type: 'register', name: myName }));
                setTimeout(function() { 
                    ws.send(JSON.stringify({ type: 'get-players' })); 
                }, 500);
            }
            
            ws.onmessage = function(e) {
                try {
                    var msg = JSON.parse(e.data);
                    console.log('Mensaje:', msg.type);
                    if (msg.type === 'players-list') {
                        showPlayersInModal(msg.players || [], myName, msg.playing || []);
                    }
                } catch(err) {}
            };
            
            ws.onclose = function() {
                isOnline = false;
                if (counter) counter.innerHTML = '🔴 Desconectado';
                // Auto reconnect after 5 seconds
                setTimeout(function() {
                    connectWebSocket().then(function(r) {
                        ws = r.ws;
                        isOnline = true;
                    });
                }, 5000);
            };
            
        }).catch(function(e) {
            console.log('Error:', e);
            if (counter) counter.innerHTML = '❌ Sin conexión';
        });
    }, 1500);
});

// Remove error overlays
setInterval(function() {
    try {
        document.querySelectorAll('div').forEach(function(d) {
            if (d.innerText && d.innerText.includes('image.png') && d.innerText.length < 50) d.remove();
        });
    } catch(e) {}
}); // End error overlay removal

document.addEventListener('DOMContentLoaded', function() {
console.log('game.js starting, THREE:', typeof THREE);

// ============================================
// 🎮 SISTEMA MULTIPLAYER (WebSocket) - Solo conectar cuando inicie el juego
const isHttps = window.location.protocol === 'https:';
const SERVER_URL = 'wss://starskrills-1.onrender.com/ws';
// Dynamically connected to where it is hosted
let useLocal = false;
let ws = null;
let isOnline = false;
let myPlayerId = null;
let otherPlayers = new Map();
const registeredPlayers = JSON.parse(localStorage.getItem('registeredPlayers') || '[]');

// ============================================
// 🔥 FIREBASE MULTIPLAYER SYSTEM
// ============================================
let firebaseMyRef = null;
let firebasePlayersRef = null;
let firebaseReady = false;
let myFirebaseId = null;
let firebaseOtherPlayers = new Map();
const firebasePlayerMeshes = new Map();

function joinFirebase(name) {
    if (!window.db || !window.firebaseReady) {
        console.log('🔥 Firebase no listo - db:', !!window.db, 'ready:', window.firebaseReady);
        return;
    }
    if (!name || name.length < 2) {
        console.log('🔥 Nombre inválido:', name);
        return;
    }
    
    console.log('🔥 Guardando jugador:', name);
    
    myFirebaseId = name + '_' + Math.random().toString(36).substr(2, 4);
    firebasePlayersRef = window.db.ref('jugadores');
    firebaseMyRef = firebasePlayersRef.child(myFirebaseId);
    
    var playerData = {
        nombre: name,
        x: playerGroup ? playerGroup.position.x : 0,
        z: playerGroup ? playerGroup.position.z : 0,
        angulo: playerGroup ? playerGroup.rotation.y : 0,
        color: getMyColor(),
        ultimo: Date.now()
    };
    
    console.log('🔥 playerData:', playerData);
    
    firebaseMyRef.set(playerData).then(function() {
        console.log('🔥 Jugador Guardado en Firebase!');
    }).catch(function(err) {
        console.error('🔥 Error al guardar:', err);
    });
    
    // Borrar al desconectar
    firebaseMyRef.onDisconnect().remove();
    
    // Escuchar otros jugadores
    firebasePlayersRef.on('child_added', function(snapshot) {
        var id = snapshot.key;
        if (id !== myFirebaseId && !firebaseOtherPlayers.has(id)) {
            var data = snapshot.val();
            data.id = id;
            firebaseOtherPlayers.set(id, data);
            createPlayerMesh(id, data);
        }
    });
    
    firebasePlayersRef.on('child_changed', function(snapshot) {
        var id = snapshot.key;
        if (firebaseOtherPlayers.has(id)) {
            var data = snapshot.val();
            var player = firebaseOtherPlayers.get(id);
            player.x = data.x;
            player.z = data.z;
            player.angulo = data.angulo;
            player.color = data.color;
            firebaseOtherPlayers.set(id, player);
        }
    });
    
    firebasePlayersRef.on('child_removed', function(snapshot) {
        var id = snapshot.key;
        if (firebaseOtherPlayers.has(id)) {
            removePlayerMesh(id);
            firebaseOtherPlayers.delete(id);
        }
    });
    
    console.log('🔥 Firebase:Jugador registrado', myFirebaseId);
}

function updateMyFirebasePosition() {
    if (!firebaseMyRef || !playerGroup) return;
    
    firebaseMyRef.update({
        x: playerGroup.position.x,
        z: playerGroup.position.z,
        angulo: playerGroup.rotation.y,
        ultimo: Date.now()
    });
}

function createPlayerMesh(id, data) {
    if (firebasePlayerMeshes.has(id)) return;
    if (!scene) return;
    
    var color = data.color ? new THREE.Color(data.color) : new THREE.Color(0xFF6B6B);
    var g = new THREE.Group();
    
    // Cuerpo simple
    var body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.6, 1.5, 8),
        new THREE.MeshPhongMaterial({ color: color })
    );
    body.position.y = 0.75;
    g.add(body);
    
    // Cabeza
    var head = new THREE.Mesh(
        new THREE.SphereGeometry(0.4, 8, 8),
        new THREE.MeshPhongMaterial({ color: 0xFFDBAC })
    );
    head.position.y = 1.7;
    g.add(head);
    
    g.position.set(data.x || 0, 0, data.z || 0);
    g.rotation.y = data.angulo || 0;
    
    scene.add(g);
    firebasePlayerMeshes.set(id, g);
    console.log('🔥 Jugador creado:', id);
}

function removePlayerMesh(id) {
    var g = firebasePlayerMeshes.get(id);
    if (g) {
        scene.remove(g);
        firebasePlayerMeshes.delete(id);
        console.log('🔥 Jugador eliminado:', id);
    }
}

function updateFirebasePlayers() {
    firebasePlayerMeshes.forEach(function(g, id) {
        var p = firebaseOtherPlayers.get(id);
        if (p) {
            g.position.x = p.x || 0;
            g.position.z = p.z || 0;
            g.rotation.y = p.angulo || 0;
        }
    });
}

function getMyColor() {
    var colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD'];
    return colors[Math.floor(Math.random() * colors.length)];
}

function checkLocalServer() {
    useLocal = false;
    return false;
}

function getServerUrl() {
    return useLocal ? SERVER_URL : SERVER_URL;
}

function saveUsername(name) {
    var cleanName = name.trim().replace(/[^a-zA-Z0-9_ñÑ]/g, '');
    if (cleanName.length < 2) return null;
    if (registeredPlayers.indexOf(cleanName) === -1) {
        registeredPlayers.push(cleanName);
        localStorage.setItem('registeredPlayers', JSON.stringify(registeredPlayers));
    }
    sessionStorage.setItem('myName', cleanName);
    sessionStorage.setItem('savedName', cleanName);
    var input = document.getElementById('username-input');
    if (input) input.value = cleanName;
    return cleanName;
}

function getSessionUsername() {
    return sessionStorage.getItem('myName') || '';
}

window.showPlayersList = function() {
    var modal = document.getElementById('players-modal');
    var list = document.getElementById('players-list');
    if (!modal || !list) return;
    
    var myName = getMyName();
    if (!myName || myName.length < 2) {
        if (list) {
            list.innerHTML = '<li style="padding:10px;color:#e74c3c;">⚠️ Escribe un nombre primero</li>';
            modal.style.display = 'flex';
        }
        return;
    }
    
    var html = '<li style="padding:10px;border-bottom:2px solid #2ecc71;">🟢 ' + myName + ' (tú)</li>';
    list.innerHTML = html;
    modal.style.display = 'flex';
    
    console.log('🔥 db exists:', !!window.db);
    console.log('🔥 firebaseReady:', window.firebaseReady);
    console.log('🔥 myFirebaseId:', myFirebaseId);
    
    // If Firebase is ready, show all players from Firebase
    if (window.db && window.firebaseReady) {
        console.log('🔥 Leyendo jugadores de Firebase...');
        window.db.ref('jugadores').once('value', function(snapshot) {
            var html = '<li style="padding:10px;border-bottom:2px solid #2ecc71;">🟢 ' + myName + ' (tú)</li>';
            var now = Date.now();
            var players = [];
            var foundSelf = false;
            
            console.log('🔥 Snapshot tiene elementos:', snapshot.numChildren());
            
            if (snapshot.numChildren() === 0) {
                html += '<li style="padding:10px;color:#f39c12;">⏳ Primero juega para ver otros jugadores</li>';
            } else {
            
            snapshot.forEach(function(child) {
                var id = child.key;
                var data = child.val();
                var playerName = data.nombre || '';
                
                // Check if it's self by name
                if (playerName === myName) {
                    foundSelf = true;
                    return;
                }
                
                // Only show players with names
                if (!playerName || playerName.length < 1) return;
                
                var lastSeen = data.ultimo || 0;
                var diff = now - lastSeen;
                var isOnline = diff < 10000; // 10 segundos
                players.push({ id: id, nombre: playerName, online: isOnline, ultimo: lastSeen });
            });
            
            // Update my status if found
            if (foundSelf) {
                html = '<li style="padding:10px;border-bottom:2px solid #2ecc71;">🟢 ' + myName + ' (tú)</li>';
            }
            
            // Ordenar: primero online, luego offline
            players.sort(function(a, b) { return (b.online ? 1 : 0) - (a.online ? 1 : 0); });
            
            if (players.length === 0) {
                html += '<li style="padding:10px;color:#888;">No hay otros jugadores</li>';
            } else {
                players.forEach(function(p) {
                    var status = p.online ? '🟢 En juego' : '🔴 ' + formatTimeDiff(now - p.ultimo);
                    var color = p.online ? '#2ecc71' : '#e74c3c';
                    html += '<li style="padding:10px;border-bottom:1px solid #444;color:' + color + ';">' + status + ' - ' + p.nombre + '</li>';
                });
            }
            }  // Cierre del else
            
            console.log('🔥 Jugadores encontrados en Firebase:', players.length);
            list.innerHTML = html;
        }).catch(function(err) {
            console.error('Firebase error:', err);
            list.innerHTML = '<li style="padding:10px;color:#e74c3c;">❌ Error: ' + err.message + '</li>';
        });
    } else {
        // Still try to show players even if firebaseReady is not set
        console.log('🔥 Intentando mostrar jugadores...');
        window.db.ref('jugadores').once('value', function(snapshot) {
            var html = '<li style="padding:10px;border-bottom:2px solid #2ecc71;">🟢 ' + myName + ' (tú)</li>';
            var now = Date.now();
            var players = [];
            
            console.log('🔥 Players in DB:', snapshot.numChildren());
            
            snapshot.forEach(function(child) {
                var id = child.key;
                var data = child.val();
                var playerName = data.nombre || '';
                
                if (!playerName || playerName.length < 1) return;
                
                var lastSeen = data.ultimo || 0;
                var diff = now - lastSeen;
                var isOnline = diff < 10000;
                players.push({ nombre: playerName, online: isOnline, ultimo: lastSeen });
            });
            
            if (players.length === 0) {
                html += '<li style="padding:10px;color:#f39c12;">⏳ No hay jugadores</li>';
            } else {
                players.forEach(function(p) {
                    var status = p.online ? '🟢 En juego' : '🔴 ' + formatTimeDiff(now - p.ultimo);
                    var color = p.online ? '#2ecc71' : '#e74c3c';
                    html += '<li style="padding:10px;border-bottom:1px solid #444;color:' + color + ';">' + status + ' - ' + p.nombre + '</li>';
                });
            }
            
            list.innerHTML = html;
        }).catch(function(err) {
            console.error('Firebase error:', err);
        });
    }
};

function formatTimeDiff(ms) {
    var segundos = Math.floor(ms / 1000);
    var minutos = Math.floor(ms / 60000);
    var horas = Math.floor(ms / 3600000);
    var dias = Math.floor(ms / 86400000);
    
    if (horas < 1) return '-1h';
    if (dias < 1) return horas + 'h';
    return dias + 'd';
}

function saveUsername(name) {
    const cleanName = name.trim().replace(/[^a-zA-Z0-9_ñÑ]/g, '');
    if (cleanName.length < 2) return null;
    if (!registeredPlayers.includes(cleanName)) {
        registeredPlayers.push(cleanName);
        localStorage.setItem('registeredPlayers', JSON.stringify(registeredPlayers));
    }
    const sessionId = 'user_' + Date.now();
    sessionStorage.setItem('myName', cleanName);
    sessionStorage.setItem('sessionId', sessionId);
    localStorage.setItem('session_' + sessionId, cleanName);
    return cleanName;
}

function getSavedUsername() {
    return sessionStorage.getItem('myName') || '';
}

function showLocalPlayersList() {
    var modal = document.getElementById('players-modal');
    var list = modal ? modal.querySelector('ul') : null;
    if (!list) return;
    var registered = JSON.parse(localStorage.getItem('registeredPlayers') || '[]');
    var myName = getSessionUsername() || 'Tú';
    var html = '<li style="padding:10px;border-bottom:2px solid #3498db;">⭐ ' + myName + ' (tú)</li>';
    var otherPlayers = registered.filter(function(n) { return n !== myName; });
    if (otherPlayers.length > 0) {
        otherPlayers.forEach(function(name) {
            html += '<li style="padding:10px;border-bottom:1px solid #555;">' + name + '</li>';
        });
    } else {
        html += '<li style="padding:10px;color:#888;">Ningún otro jugador</li>';
    }
    list.innerHTML = html;
    modal.style.display = 'flex';
}

function showPlayersInModal(players, myName, playing) {
    var modal = document.getElementById('players-modal');
    var list = modal ? modal.querySelector('ul') : null;
    if (!list) return;
    if (!myName) myName = sessionStorage.getItem('myName') || sessionStorage.getItem('savedName') || 'Tú';
    var playingList = playing || [];
    var allPlayers = players || [];
    var hasPlaying = playingList.length > 0;
    
    var html = '<li style="padding:10px;border-bottom:2px solid #2ecc71;">🟢 ' + myName + ' (tú)</li>';
    html += '<li style="padding:8px;color:#888;font-size:12px;">(' + allPlayers.length + ' conectados)</li><hr style="margin:5px 0;border-color:#555;">';
    
    if (!hasPlaying) {
        if (allPlayers.length <= 1) {
            html += '<li style="padding:15px;color:#f39c12;text-align:center;">🔴 Nadie en línea</li>';
        } else {
            allPlayers.forEach(function(name) {
                if (name && name !== myName) {
                    html += '<li style="padding:10px;border-bottom:1px solid #555;">⭐ ' + name + '</li>';
                }
            });
            html += '<li style="padding:10px;color:#888;margin-top:10px;">Ningún jugador en partida</li>';
        }
    } else {
        playingList.forEach(function(name) {
            if (name && name !== myName) {
                var btnId = 'spectate_' + name.replace(/[^a-zA-Z0-9]/g, '');
                html += '<div id="' + btnId + '" style="padding:15px;margin:5px 0;background:rgba(231,76,60,0.3);border:2px solid #e74c3c;border-radius:10px;cursor:pointer;" onmouseover="this.style.background=\'rgba(231,76,60,0.5)\'" onmouseout="this.style.background=\'rgba(231,76,60,0.3)\'" onclick="window.spectatePlayer(\'' + name + '\')">';
                html += '<div style="font-size:20px;">🎮 ' + name + '</div>';
                html += '<div style="color:#f39c12;font-size:14px;">👁️ ESPECTAR</div></div>';
            }
        });
        html += '<li style="padding:10px;color:#888;margin-top:10px;">👁️ Toca el recuadro rojo para spectear</li>';
    }
    
    list.innerHTML = html;
    modal.style.display = 'flex';
    
    // Update online counter
    var counter = document.getElementById('online-players');
    if (counter) {
        var playingCount = playingList ? playingList.length : 0;
        counter.innerHTML = '🟢 ' + allPlayers.length + ' en línea (' + playingCount + ' jugando)';
    }
}

window.spectatePlayer = function(playerName) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    document.getElementById('players-modal').style.display = 'none';
    document.getElementById('spectate-panel').style.display = 'block';
    document.getElementById('spectating-name').innerHTML = 'Viendo a: ' + playerName;
    // Disable all game buttons
    var buttonsToDisable = ['start-btn', 'star-drop-btn', 'players-btn', 'settings-btn', 'shop-btn', 'extra-btn'];
    buttonsToDisable.forEach(function(btnId) {
        var btn = document.getElementById(btnId);
        if (btn) btn.style.pointerEvents = 'none';
    });
    ws.send(JSON.stringify({ type: 'spectate', target: playerName }));
    window.isSpectating = true;
    window.spectatingTarget = playerName;
};

window.exitSpectate = function() {
    document.getElementById('spectate-panel').style.display = 'none';
    // Re-enable all game buttons
    var buttonsToEnable = ['start-btn', 'star-drop-btn', 'players-btn', 'settings-btn', 'shop-btn', 'extra-btn'];
    buttonsToEnable.forEach(function(btnId) {
        var btn = document.getElementById(btnId);
        if (btn) btn.style.pointerEvents = 'auto';
    });
    ws.send(JSON.stringify({ type: 'spectate', target: null }));
    window.isSpectating = false;
    window.spectatingTarget = null;
};

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && window.isSpectating) {
        window.exitSpectate();
    }
});

function connectToServer() {
    if (ws) return;
    const usernameInput = document.getElementById('username-input');
    let username = usernameInput ? usernameInput.value.trim() : '';
    if (!username) username = getSavedUsername();
    if (!username) {
        alert('Por favor ingresa tu nombre de usuario');
        if (usernameInput) usernameInput.focus();
        return;
    }
    username = saveUsername(username);
    if (!username) return;

    const saved = getSavedUsername();
    if (saved && saved !== username) {
        alert('Ya tienes un nombre guardado: ' + saved + '. Usa ese o cambia el nombre.');
        document.getElementById('username-input').value = saved;
        document.getElementById('username-input').focus();
        return;
    }
    if (ws) return;
    try {
        const serverUrl = useLocal ? SERVER_URL : SERVER_URL;
        ws = new WebSocket(serverUrl);
        ws.onopen = () => {
            console.log('🌐 Online');
            isOnline = true;
            const username = getSessionUsername() || 'Anon';
            ws.send(JSON.stringify({ type: 'register', name: username }));
            // Pedir lista de jugadores automáticamente
            ws.send(JSON.stringify({ type: 'get-players' }));
        };
        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === 'welcome') myPlayerId = msg.id;
                if (msg.type === 'moved') updateOtherPlayer(msg.id, msg.x, msg.y);
                if (msg.type === 'new') createOtherPlayer(msg.id, msg.color);
                if (msg.type === 'left') removeOtherPlayer(msg.id);
                if (msg.type === 'players-list') {
                    const list = document.getElementById('players-list');
                    const modal = document.getElementById('players-modal');
                    const myName = getSessionUsername() || 'Tú';
                    if (list && modal) {
                        let html = `<li style="padding:10px;border-bottom:2px solid #3498db;">⭐ ${myName} (tú)</li>`;
                        if (msg.players && msg.players.length > 0) {
                            msg.players.forEach((p, i) => {
                                html += `<li style="padding:10px;border-bottom:1px solid #555;">${p}</li>`;
                            });
                        } else {
                            html += `<li style="padding:10px;color:#888;">Sin otros jugadores</li>`;
                        }
                        list.innerHTML = html;
                        modal.style.display = 'flex';
                    }
                }
                if (msg.type === 'registered') {
                    console.log('Registrado como:', msg.name);
                }
            } catch(e) {}
        };
        ws.onclose = () => { isOnline = false; ws = null; setTimeout(connectToServer, 3000); };
    } catch(e) { console.log('Error:', e); }
} function updateOtherPlayer(id, x, z) {
    const p = otherPlayers.get(id);
    if (p) p.position.set(x, 0, z);
} function createOtherPlayer(id, color) {
    if (otherPlayers.has(id)) return;
    const g = createDetailedBrawler(parseInt(color.replace('#','0x'),16));
    scene.add(g); otherPlayers.set(id, g);
} function removeOtherPlayer(id) {
    const p = otherPlayers.get(id);
    if (p) { scene.remove(p); otherPlayers.delete(id); }
}

// Funciones globales para botones - asegurados
function runIntroSequence() {
    // Buscar la función real
    try {
        if (typeof window.jugarStart === 'function') {
            window.jugarStart();
        } else if (document.getElementById('start-btn')) {
            document.getElementById('start-btn').click();
        }
    } catch(e) {
        console.log('runIntroSequence error:', e);
    }
    
    // 🔥 FIREBASE: Unirse cuando juega
    if (window.firebaseReady && window.db) {
        var myName = getMyName();
        console.log('🔥 getMyName retorna:', myName);
        if (myName && myName.length >= 2) {
            joinFirebase(myName);
            console.log('🔥 Conectando a Firebase como:', myName);
        } else {
            console.log('🔥 Nombre muy corto o vacío');
        }
    }
}

window.sendGameEnd = function() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'game-end' }));
        window.amIPlaying = false;
    }
};

function openStarDrop() {
    // Buscar y mostrar la pantalla de Star Drop
    try {
        const starDropScreen = document.getElementById('star-drop-screen') || 
                               document.getElementById('star-drop-overlay') ||
                               document.querySelector('[id*="star"]');
        if (starDropScreen) starDropScreen.style.display = 'flex';
    } catch(e) {
        console.log('openStarDrop error:', e);
    }
}

// Asignar a window
window.runIntroSequence = runIntroSequence;
window.openStarDrop = openStarDrop;

// Función para salir de sala
function sendPosition(position, rotation) {
    if (socket && isOnline && myRoomId) {
        socket.emit('player-move', { position, rotation });
    }
}

// Enviar ataque al servidor
function sendAttack(targetId, damage) {
    if (socket && isOnline && myRoomId) {
        socket.emit('player-attack', {
            targetId: targetId,
            damage: damage
        });
    }
}

// Enviar respawn
function sendRespawn() {
    if (socket && isOnline && myRoomId) {
        socket.emit('player-respawn');
    }
}

// Enviar mensaje de chat
function sendChatMessage(message) {
    if (socket && isOnline && myRoomId) {
        socket.emit('chat-message', { message });
    }
}

// Crear mesh para otro jugador
function createOtherPlayer(playerData) {
    if (otherPlayers.has(playerData.id)) return;
    
    const playerGroup = createDetailedBrawler(playerData.color);
    playerGroup.position.set(
        playerData.position?.x || 0,
        playerData.position?.y || 0,
        playerData.position?.z || 0
    );
    playerGroup.userData.playerId = playerData.id;
    playerGroup.userData.playerName = playerData.name;
    playerGroup.userData.health = playerData.health || 100;
    
    scene.add(playerGroup);
    otherPlayers.set(playerData.id, playerGroup);
    
    // Crear nombre sobre el jugador
    createPlayerNameTag(playerGroup, playerData.name);
}

// Actualizar posición de otro jugador
function updateOtherPlayer(id, position, rotation) {
    const player = otherPlayers.get(id);
    if (player) {
        player.position.set(position.x, position.y, position.z);
        if (rotation) {
            player.rotation.y = rotation.y;
        }
    }
}

// Remover jugador
function removeOtherPlayer(id) {
    const player = otherPlayers.get(id);
    if (player) {
        scene.remove(player);
        otherPlayers.delete(id);
    }
}

// Respawn de otro jugador
function respawnOtherPlayer(id, position, health) {
    const player = otherPlayers.get(id);
    if (player) {
        player.position.set(position.x, position.y, position.z);
        player.userData.health = health;
        player.visible = true;
    }
}

// Crear nombre sobre jugador
function createPlayerNameTag(playerGroup, name) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(name, 128, 40);
    
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(2, 0.5, 1);
    sprite.position.y = 2.5;
    sprite.name = 'nameTag';
    playerGroup.add(sprite);
}

// Mostrar efecto de ataque
function showAttackEffect(position, attackData) {
    // Crear efecto visual del ataque
    const geometry = new THREE.SphereGeometry(0.3, 8, 8);
    const material = new THREE.MeshBasicMaterial({ 
        color: 0xff0000, 
        transparent: true, 
        opacity: 0.8 
    });
    const effect = new THREE.Mesh(geometry, material);
    effect.position.set(position.x, position.y + 1, position.z);
    scene.add(effect);
    
    // Animación de desvanecimiento
    let scale = 1;
    const animate = () => {
        scale += 0.1;
        effect.scale.setScalar(scale);
        material.opacity -= 0.1;
        if (material.opacity > 0) {
            requestAnimationFrame(animate);
        } else {
            scene.remove(effect);
        }
    };
    animate();
}

// Mostrar daño
function showDamageEffect(playerId, health) {
    const player = otherPlayers.get(playerId);
    if (player) {
        player.userData.health = health;
        // Flash rojo
        player.traverse(child => {
            if (child.material) {
                const originalColor = child.material.color?.getHex();
                child.material.color?.setHex(0xff0000);
                setTimeout(() => {
                    if (child.material) {
                        child.material.color?.setHex(originalColor);
                    }
                }, 100);
            }
        });
    }
}

// Mostrar muerte
function showDeathEffect(playerId, killerName) {
    const player = otherPlayers.get(playerId);
    if (player) {
        player.visible = false;
        showNotification(`${player.userData.playerName} fue eliminado por ${killerName}`, 'info');
    }
}

// Mostrar notificación
function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 100px;
        left: 50%;
        transform: translateX(-50%);
        padding: 15px 30px;
        background: ${type === 'success' ? '#2ecc71' : type === 'error' ? '#e74c3c' : '#3498db'};
        color: white;
        border-radius: 10px;
        font-family: 'Poppins', sans-serif;
        font-size: 16px;
        z-index: 99999;
        animation: fadeInOut 3s ease-in-out;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Mostrar mensaje de chat
function showChatMessage(playerName, message) {
    const chatBox = document.getElementById('chat-messages') || createChatBox();
    const msgElement = document.createElement('div');
    msgElement.style.cssText = 'padding: 5px 10px; color: white; font-size: 14px;';
    msgElement.innerHTML = `<strong>${playerName}:</strong> ${message}`;
    chatBox.appendChild(msgElement);
    chatBox.scrollTop = chatBox.scrollHeight;
    
    // Remover mensajes antiguos
    while (chatBox.children.length > 50) {
        chatBox.removeChild(chatBox.firstChild);
    }
}

// Crear caja de chat
function createChatBox() {
    const chatBox = document.createElement('div');
    chatBox.id = 'chat-messages';
    chatBox.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 20px;
        width: 300px;
        height: 200px;
        background: rgba(0,0,0,0.7);
        border-radius: 10px;
        padding: 10px;
        overflow-y: auto;
        z-index: 9999;
        font-family: 'Poppins', sans-serif;
    `;
    document.body.appendChild(chatBox);
    return chatBox;
}

// ============================================
// WEBRTC VOICE CHAT
// ============================================

let localStream = null;
let voiceEnabled = false;

async function toggleVoiceChat() {
    if (!isOnline || !myRoomId) {
        showNotification('No estás en una sala', 'error');
        return;
    }
    
    try {
        if (!voiceEnabled) {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            voiceEnabled = true;
            showNotification('Micrófono activado', 'success');
            
            // Enviar oferta a todos en la sala
            for (const [peerId] of otherPlayers) {
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                socket.emit('voice-offer', { to: peerId, offer });
            }
        } else {
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
                localStream = null;
            }
            voiceEnabled = false;
            showNotification('Micrófono desactivado', 'info');
        }
    } catch(e) {
        console.log('Error accediendo al micrófono:', e);
        showNotification('Error accediendo al micrófono', 'error');
    }
}

const peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
});

peerConnection.ontrack = (event) => {
    const audio = new Audio();
    audio.srcObject = event.streams[0];
    audio.autoplay = true;
};

async function handleVoiceOffer(data) {
    const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    
    pc.ontrack = (event) => {
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.autoplay = true;
    };
    
    await pc.setRemoteDescription(data.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    socket.emit('voice-answer', { to: data.from, answer });
}

async function handleVoiceAnswer(data) {
    await peerConnection.setRemoteDescription(data.answer);
}

handleVoiceIceCandidate = async (data) => {
    await peerConnection.addIceCandidate(data.candidate);
};

// ============================================
// FIN SISTEMA MULTIPLAYER
// ============================================

// --- Sistema de Sonido Moderno (Tarea 33) ---

// --- Sistema de Sonido Moderno (Tarea 33) ---
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // --- Efecto de Sonido ---
        function playSound(type) {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            
            if (type === 'appear') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(200, audioCtx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.3);
                gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.5);
            } else if (type === 'disappear') {
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(600, audioCtx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.5);
                gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.5);
            } else if (type === 'hum') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(150, audioCtx.currentTime);
                gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
                osc.start();
                osc.stop(audioCtx.currentTime + 0.5);
            }
        }

        // --- Menú SHOP ---
        function createShopParticles() {
            const container = document.getElementById('shop-particles');
            if (!container) return;
            container.innerHTML = '';
            for (let i = 0; i < 20; i++) {
                const particle = document.createElement('div');
                particle.className = 'shop-particle';
                particle.style.left = Math.random() * 100 + '%';
                particle.style.animationDelay = Math.random() * 8 + 's';
                particle.style.animationDuration = (5 + Math.random() * 5) + 's';
                particle.style.width = (2 + Math.random() * 4) + 'px';
                particle.style.height = particle.style.width;
                container.appendChild(particle);
            }
        }

        window.showShop = () => {
            document.getElementById('start-menu').style.display = 'none';
            document.getElementById('settings-btn').style.display = 'none';
            document.getElementById('trophy-display').style.display = 'none';
            document.getElementById('shop-overlay').style.display = 'flex';
            createShopParticles();
            if (window.menuBrawler) window.menuBrawler.visible = false;
            SoundEngine.play('ui');
        };

        window.closeShop = () => {
            document.getElementById('shop-overlay').style.display = 'none';
            document.getElementById('start-menu').style.display = 'flex';
            document.getElementById('settings-btn').style.display = 'flex';
            document.getElementById('settings-btn').style.visibility = 'visible';
            document.getElementById('trophy-display').style.display = 'flex';
            if (window.menuBrawler) {
                window.menuBrawler.visible = true;
                window.menuBrawler.rotation.set(0, -Math.PI/6, 0);
            }
            SoundEngine.play('ui');
        };
        
        // --- Tarea: Audio Espacial (Culling por Visibilidad) ---
        const _frustum = new THREE.Frustum();
        const _projScreenMatrix = new THREE.Matrix4();
        // --- NAVEGACIÓN ROBUSTA (Fix para menús bugeados) ---
        window.hideAllMenus = () => {
            const menus = [
                'char-overlay', 'sub-menu-overlay', 'settings-overlay', 'languages-overlay', 
                'reload-overlay', 'brawler-menu-1', 'brawler-menu-2', 'brawler-menu-3', 
                'brawler-menu-4', 'brawler-menu-5', 'empty-sub-menu', 'shop-overlay', 
                'char-preview-overlay', 'loss-menu', 'death-overlay', 'placement-banner',
                'matchmaking-screen', 'showcase-screen', 'countdown-overlay-new', 'showdown-overlay',
                'afk-warning', 'afk-error'
            ];
            menus.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            const bgs = ['char-bg', 'sub-bg'];
            bgs.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            const settingsBtn = document.getElementById('settings-btn');
            if (settingsBtn) settingsBtn.style.display = 'none';
        };

        window.showCharMenu = () => {
            window.hideAllMenus();
            const char = document.getElementById('char-overlay');
            if (char) {
                // Add close button if not exists
                let closeBtn = document.getElementById('char-close-btn');
                if (!closeBtn) {
                    closeBtn = document.createElement('button');
                    closeBtn.id = 'char-close-btn';
                    closeBtn.innerText = 'X';
                    closeBtn.onclick = function() {
                        window.closeCharMenu();
                    };
                    char.appendChild(closeBtn);
                }
                char.style.display = 'flex';
            }
            const charBg = document.getElementById('char-bg');
            if (charBg) charBg.style.display = 'block';
            
            document.getElementById('start-menu').style.display = 'none';
            document.getElementById('settings-btn').style.display = 'none';
            document.getElementById('trophy-display').style.display = 'none';
            
            if (window.menuBrawler) window.menuBrawler.visible = false;
            window.currentMenuState = 'breathe';
            SoundEngine.play('ui');
        };

        window.closeCharMenu = () => {
            window.hideAllMenus();
            document.getElementById('start-menu').style.display = 'flex';
            document.getElementById('settings-btn').style.display = 'flex';
            document.getElementById('trophy-display').style.display = 'flex';
            
            if (window.menuBrawler) {
                window.menuBrawler.visible = true;
                window.menuBrawler.rotation.set(0, -Math.PI/6, 0);
                window.currentMenuState = 'breathe';
            }
            
            // Make sure menu renderer is visible
            if (window.menuRenderer && window.menuRenderer.domElement) {
                window.menuRenderer.domElement.style.display = 'block';
            }
            
            SoundEngine.play('ui');
        };

        window.openSubMenu = () => {
            // No hideAllMenus aquí para mantener el grid debajo si se desea, 
            // pero sí mostramos el fondo azul
            document.getElementById('sub-menu-overlay').style.display = 'flex';
            const subBg = document.getElementById('sub-bg');
            if (subBg) subBg.style.display = 'block';
            window.currentMenuState = 'breathe';
            SoundEngine.play('ui');
        };

        window.openEmptySubMenu = () => {
            document.getElementById('empty-sub-menu').style.display = 'flex';
            SoundEngine.play('ui');
        };

        window.closeEmptySubMenu = () => {
            document.getElementById('empty-sub-menu').style.display = 'none';
            SoundEngine.play('ui');
        };

        let charPreviewRenderer, charPreviewScene, charPreviewCamera, charPreviewBrawler;
        window.openCharPreview = () => {
            document.getElementById('char-preview-overlay').style.display = 'flex';
            initCharPreviewScene();
            SoundEngine.play('ui');
        };

        window.closeCharPreview = () => {
            document.getElementById('char-preview-overlay').style.display = 'none';
            document.getElementById('char-overlay').style.display = 'flex';
            SoundEngine.play('ui');
        };

        window.selectCharacter = () => {
            SoundEngine.play('ui');
            document.getElementById('char-preview-overlay').style.display = 'none';
            document.getElementById('char-overlay').style.display = 'none';
            document.getElementById('char-bg').style.display = 'none';
            document.getElementById('start-menu').style.display = 'flex';
            document.getElementById('settings-btn').style.display = 'flex';
            document.getElementById('trophy-display').style.display = 'flex';
            if (window.menuBrawler) {
                window.menuBrawler.visible = true;
                window.menuBrawler.rotation.set(0, -Math.PI/6, 0);
                window.currentMenuState = 'salute';
                window.stateEndTime = Date.now() * 0.001 + 2.0;
            }
        };

        function initCharPreviewScene() {
            const container = document.getElementById('char-preview-container');
            if (!container) return;
            
            if (!charPreviewRenderer) {
                charPreviewScene = new THREE.Scene();
                charPreviewCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
                charPreviewCamera.position.set(0, 1.4, 3.5);
                charPreviewCamera.lookAt(0, 1.0, 0);
                
                charPreviewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
                charPreviewRenderer.setSize(window.innerWidth, window.innerHeight);
                container.appendChild(charPreviewRenderer.domElement);
                
                const ambient = new THREE.AmbientLight(0xffffff, 0.6);
                charPreviewScene.add(ambient);
                const dir = new THREE.DirectionalLight(0xffffff, 1.0);
                dir.position.set(2, 5, 2);
                charPreviewScene.add(dir);
                
                charPreviewBrawler = createDetailedBrawler(0x00FF88);
                charPreviewScene.add(charPreviewBrawler);
            }
            
            function animateCharPreview() {
                if (document.getElementById('char-preview-overlay').style.display !== 'none') {
                    if (charPreviewBrawler) {
                        charPreviewBrawler.rotation.y += 0.02;
                    }
                    charPreviewRenderer.render(charPreviewScene, charPreviewCamera);
                }
                requestAnimationFrame(animateCharPreview);
            }
            animateCharPreview();
        }

        window.openBrawlerMenu1 = () => { document.getElementById('brawler-menu-1').style.display = 'flex'; SoundEngine.play('ui'); };
        window.closeBrawlerMenu1 = () => { document.getElementById('brawler-menu-1').style.display = 'none'; window.showCharMenu(); SoundEngine.play('ui'); };
        window.openBrawlerMenu2 = () => { document.getElementById('brawler-menu-2').style.display = 'flex'; SoundEngine.play('ui'); };
        window.closeBrawlerMenu2 = () => { document.getElementById('brawler-menu-2').style.display = 'none'; window.showCharMenu(); SoundEngine.play('ui'); };
        window.openBrawlerMenu3 = () => { document.getElementById('brawler-menu-3').style.display = 'flex'; SoundEngine.play('ui'); };
        window.closeBrawlerMenu3 = () => { document.getElementById('brawler-menu-3').style.display = 'none'; window.showCharMenu(); SoundEngine.play('ui'); };
        window.openBrawlerMenu4 = () => { document.getElementById('brawler-menu-4').style.display = 'flex'; SoundEngine.play('ui'); };
        window.closeBrawlerMenu4 = () => { document.getElementById('brawler-menu-4').style.display = 'none'; window.showCharMenu(); SoundEngine.play('ui'); };
        window.openBrawlerMenu5 = () => { document.getElementById('brawler-menu-5').style.display = 'flex'; SoundEngine.play('ui'); };
        window.closeBrawlerMenu5 = () => { document.getElementById('brawler-menu-5').style.display = 'none'; window.showCharMenu(); SoundEngine.play('ui'); };
        window.selectAndReturn = () => {
            window.hideAllMenus();
            document.getElementById('start-menu').style.display = 'flex';
            document.getElementById('settings-btn').style.display = 'flex';
            document.getElementById('trophy-display').style.display = 'flex';
            
            if (window.menuBrawler) {
                window.menuBrawler.visible = true;
                window.menuBrawler.rotation.set(0, -Math.PI/6, 0);
                window.currentMenuState = 'salute';
                window.stateEndTime = Date.now() * 0.001 + 2.0;
            }
            SoundEngine.play('ui');
        };

        window.showSettings = () => {
            console.log('DEBUG: showSettings called');
            window.hideAllMenus();
            const el = document.getElementById('settings-overlay');
            if (el) {
                el.style.display = 'flex';
                el.style.pointerEvents = 'auto';
            }
            
            document.getElementById('start-menu').style.display = 'none';
            document.getElementById('settings-btn').style.display = 'none';
            document.getElementById('trophy-display').style.display = 'none';
            const shopBtn = document.querySelector('.shop-btn');
            if (shopBtn) shopBtn.style.display = 'none';
            
            if (window.menuBrawler) window.menuBrawler.visible = false;
            SoundEngine.play('ui');
        };

        window.hideSettings = () => {
            window.goToMainMenu();
        };

        window.goToMainMenu = () => {
            console.log("LOG: goToMainMenu called");
            window.hideAllMenus();
            
            document.getElementById('start-menu').style.display = 'flex';
            document.getElementById('settings-btn').style.display = 'flex';
            const trophyDisp = document.getElementById('trophy-display');
            if (trophyDisp) {
                trophyDisp.style.display = 'flex';
                trophyDisp.style.visibility = 'visible';
            }
            const shopBtn = document.querySelector('.shop-btn');
            if (shopBtn) {
                shopBtn.style.display = 'flex';
            }
            const extraBtn = document.querySelector('.extra-btn');
            if (extraBtn) {
                extraBtn.style.display = 'flex';
            }
            const bottomRect = document.getElementById('bottom-left-rect');
            if (bottomRect) {
                bottomRect.style.display = 'flex';
            }
            document.getElementById('star-pieces-container').style.display = 'flex';
            
            // Mostrar canvas de estrellas al volver al menú
            const menuBgCanvas = document.getElementById('menu-bg-canvas');
            if (menuBgCanvas) menuBgCanvas.style.display = 'block';
            
            // Tarea FIX: Asegurar que el brawler del menú se vuelva a ver tras una partida
            if (window.menuRenderer && window.menuRenderer.domElement) {
                window.menuRenderer.domElement.style.display = 'block';
            }
            if (window.menuBrawler) {
                window.menuBrawler.visible = true;
                window.menuBrawler.rotation.set(0, -Math.PI/6, 0);
                window.currentMenuState = 'breathe';
            }
            SoundEngine.play('ui');
        };

        // --- SISTEMA DE IDIOMAS (Tarea: 14 Idiomas + Recarga Total) ---
        const TRANSLATIONS = {
            es: { play: "JUGAR", return: "REGRESAR", settings: "AJUSTES", langs: "IDIOMAS", loading: "CARGANDO...", skrill_left: "Skrills restantes", matchmaking: "BUSCANDO RIVALES...", participants: "PARTICIPANTES", placement: "Quedaste", afk_warn: "Porfavor vuelve al juego para no ser desconectado", conn_error: "Error de conexión", afk_error: "Se ha perdido la conexión con el servidor por inactividad.", back: "Volver", lost: "¡HAS PERDIDO!", won: "¡HAS GANADO!", select_skrill: "SELECCIONAR SKRILL" },
            fr: { play: "JOUER", return: "RETOUR", settings: "PARAMÈTRES", langs: "LANGUES", loading: "CHARGEMENT...", skrill_left: "Skrills restants", matchmaking: "RECHERCHE D'ADVERSAIRES...", participants: "PARTICIPANTS", placement: "Tu as fini", afk_warn: "S'il vous plaît revenir au jeu pour ne pas être déconnecté", conn_error: "Erreur de connexion", afk_error: "Connexion perdue pour inactivité.", back: "Retour", lost: "TU AS PERDU !", won: "TU AS GAGNÉ !", select_skrill: "CHOISIR SKRILL" },
            it: { play: "GIOCA", return: "INDIETRO", settings: "IMPOSTAZIONI", langs: "LINGUE", loading: "CARICAMENTO...", skrill_left: "Skrill rimasti", matchmaking: "RICERCA AVVERSARI...", participants: "PARTECIPANTI", placement: "Sei arrivato", afk_warn: "Per favore torna al gioco per non essere disconnesso", conn_error: "Errore di connessione", afk_error: "Connessione persa per inattività.", back: "Indietro", lost: "HAI PERSO!", won: "HAI VINTO!", select_skrill: "SCEGLI SKRILL" },
            en: { play: "PLAY", return: "BACK", settings: "SETTINGS", langs: "LANGUAGES", loading: "LOADING...", skrill_left: "Skrills left", matchmaking: "SEARCHING FOR RIVALS...", participants: "PARTICIPANTS", placement: "You placed", afk_warn: "Please return to the game to avoid disconnection", conn_error: "Connection Error", afk_error: "Connection lost due to inactivity.", back: "Back", lost: "YOU LOST!", won: "YOU WON!", select_skrill: "SELECT SKRILL" },
            bg: { play: "ИГРАЙ", return: "НАЗАД", settings: "НАСТРОЙКИ", langs: "ЕЗИЦИ", loading: "ЗАРЕЖДАНЕ...", skrill_left: "Оставащи Skrills", matchmaking: "ТЪРСЕНЕ НА СЪПЕРНИЦИ...", participants: "УЧАСТНИЦИ", placement: "Ти завърши", afk_warn: "Моля, върнете се в играта, за да не бъдете изключени", conn_error: "Грешка в връзката", afk_error: "Връзката е прекъсната поради неактивност.", back: "Назад", lost: "ТИ ЗАГУБИ!", won: "ТИ СПЕЧЕЛИ!", select_skrill: "ИЗБЕРИ SKRILL" },
            ru: { play: "ИГРАТЬ", return: "НАЗАД", settings: "НАСТРОЙКИ", langs: "ЯЗЫКИ", loading: "ЗАГРУЗКА...", skrill_left: "Осталось Skrills", matchmaking: "ПОИСК СОПЕРНИКОВ...", participants: "УЧАСТНИКИ", placement: "Вы заняли", afk_warn: "Пожалуйста, вернитесь в игру, чтобы избежать отключения", conn_error: "Ошибка подключения", afk_error: "Соединение потеряно из-за бездействия.", back: "Назад", lost: "ВЫ ПРОИГРАЛИ!", won: "ВЫ ВЫИГРАЛИ!", select_skrill: "ВЫБРАТЬ SKRILL" },
            zh: { play: "开始游戏", return: "返回", settings: "设置", langs: "语言", loading: "加载中...", skrill_left: "剩余 Skrills", matchmaking: "正在寻找对手...", participants: "参与者", placement: "你的名次是", afk_warn: "请返回游戏以避免断开连接", conn_error: "连接错误", afk_error: "由于长时间未操作，连接已断开。", back: "返回", lost: "你输了！", won: "你赢了！", select_skrill: "选择 SKRILL" },
            ja: { play: "プレイ", return: "戻る", settings: "設定", langs: "言語", loading: "読み込み中...", skrill_left: "残り Skrills", matchmaking: "対戦相手を探しています...", participants: "参加者", placement: "順位は", afk_warn: "切断を避けるためにゲームに戻ってください", conn_error: "接続エラー", afk_error: "無操作のため接続が切れました。", back: "戻る", lost: "あなたの負けです！", won: "あなたの勝ちです！", select_skrill: "SKRILLを選択" },
            ko: { play: "플레이", return: "뒤로", settings: "설정", langs: "언어", loading: "로딩 중...", skrill_left: "남은 Skrills", matchmaking: "상대를 찾는 중...", participants: "참가자", placement: "순위는", afk_warn: "끊기지 않으려면 게임으로 돌아오세요", conn_error: "연결 오류", afk_error: "비활성으로 인해 연결이 끊겼습니다.", back: "뒤로", lost: "패배했습니다!", won: "승리했습니다!", select_skrill: "SKRILL 선택" },
            'zh-tw': { play: "開始遊戲", return: "返回", settings: "設定", langs: "語言", loading: "載入中...", skrill_left: "剩餘 Skrills", matchmaking: "正在尋找對手...", participants: "參與者", placement: "你的名次是", afk_warn: "請返回遊戲以避免斷開連接", conn_error: "連線錯誤", afk_error: "由於長時間未操作，連線已断開。", back: "返回", lost: "你輸了！", won: "你贏了！", select_skrill: "選擇 SKRILL" },
            'pt-br': { play: "JOGAR", return: "VOLTAR", settings: "AJUSTES", langs: "IDIOMAS", loading: "CARREGANDO...", skrill_left: "Skrills restantes", matchmaking: "PROCURANDO ADVERSÁRIOS...", participants: "PARTICIPANTES", placement: "Você ficou em", afk_warn: "Por favor, volte ao jogo para não ser desconectado", conn_error: "Erro de conexão", afk_error: "Conexão perdida por inatividade.", back: "Voltar", lost: "VOCÊ PERDEU!", won: "VOCÊ GANHOU!", select_skrill: "SELECIONAR SKRILL" },
            'en-uk': { play: "PLAY", return: "BACK", settings: "SETTINGS", langs: "LANGUAGES", loading: "LOADING...", skrill_left: "Skrills left", matchmaking: "SEARCHING FOR RIVALS...", participants: "PARTICIPANTS", placement: "You placed", afk_warn: "Please return to the game to avoid disconnection", conn_error: "Connection Error", afk_error: "Connection lost due to inactivity.", back: "Back", lost: "YOU LOST!", won: "YOU WON!", select_skrill: "SELECT SKRILL" },
            'de-ch': { play: "SPIELE", return: "ZURÜCK", settings: "IISTELLIGE", langs: "SPRACHE", loading: "LADE...", skrill_left: "Skrills übrig", matchmaking: "GÄGNER SUECHE...", participants: "TEILNÄHMER", placement: "Du bisch worde", afk_warn: "Bitte chum ad Säckel das d'Verbindig nöd verlüürsch", conn_error: "Verbindigsfähler", afk_error: "Verbindig wäge Inaktivität verloore.", back: "Zrugg", lost: "DU HESCH VERLOORE!", won: "DU HESCH GWUNNE!", select_skrill: "SKRILL WÄHLE" },
            el: { play: "ΠΑΙΞΕ", return: "ΠΙΣΩ", settings: "ΡΥΘΜΙΣΕΙΣ", langs: "ΓΛΩΣΣΕΣ", loading: "ΦΟΡΤΩΣΗ...", skrill_left: "Skrills που απομένουν", matchmaking: "ΑΝΑΖΗΤΗΣΗ ΑΝΤΙΠΑΛΩΝ...", participants: "ΣΥΜΜΕΤΕΧΟΝΤΕΣ", placement: "Βγήκες", afk_warn: "Παρακαλώ επιστρέψτε στο παιχνίδι για να μην αποσυνδεθείτε", conn_error: "Σφάλμα σύνδεσης", afk_error: "Η σύνδεση χάθηκε λόγω αδράνειας.", back: "Πίσω", lost: "ΕΧΑΣΕΣ!", won: "ΝΙΚΗΣΕΣ!", select_skrill: "ΕΠΙΛΟΓΗ SKRILL" }
        };

        // Languages are now handled by index.html
        
        function applyLanguage() {
            const lang = localStorage.getItem('gameLanguage') || 'es';
            const t = TRANSLATIONS[lang] || TRANSLATIONS.es;
            
            // UI Menú Principal
            const startBtn = document.getElementById('start-btn');
            if (startBtn) startBtn.innerText = t.play;
            
            const retBtn = document.getElementById('return-menu-btn');
            if (retBtn) retBtn.innerText = t.return;

            const langBtnText = document.getElementById('settings-lang-text');
            if (langBtnText) langBtnText.innerText = t.langs;

            // UI Menú Idiomas
            const langTitle = document.getElementById('lang-menu-title');
            if (langTitle) langTitle.innerText = t.langs;

            // UI Previsualización Brawler
            const selectSkrillBtn = document.getElementById('select-skrill-btn');
            if (selectSkrillBtn) selectSkrillBtn.innerText = t.select_skrill;

            // UI Matchmaking
            const matchTitle = document.querySelector('#matchmaking-screen h1');
            if (matchTitle) matchTitle.innerText = t.matchmaking;

            const participantsTitle = document.querySelector('#showcase-screen h2');
            if (participantsTitle) participantsTitle.innerText = t.participants;

            // UI Gameplay Result
            const placementLabel = document.querySelector('#placement-banner .place-label');
            if (placementLabel) placementLabel.innerText = t.placement;

            const lossTitle = document.querySelector('#loss-menu .loss-title');
            if (lossTitle) lossTitle.innerText = t.lost;

            const lossRetBtn = document.getElementById('loss-return-btn');
            if (lossRetBtn) lossRetBtn.innerText = t.return;

            // UI AFK
            const afkWarn = document.querySelector('#afk-warning h2');
            if (afkWarn) afkWarn.innerText = t.afk_warn;

            const afkErrTitle = document.querySelector('#afk-error .error-title');
            if (afkErrTitle) afkErrTitle.innerText = t.conn_error;

            const afkErrText = document.querySelector('#afk-error p');
            if (afkErrText) afkErrText.innerText = t.afk_error;

            const afkRetBtn = document.getElementById('afk-return-btn');
            if (afkRetBtn) afkRetBtn.innerText = t.back;

            const reloadText = document.getElementById('reload-text');
            if (reloadText) reloadText.innerText = t.loading;

            // Skrill count template
            window.skrillTextTemplate = t.skrill_left;
        }
        applyLanguage();

        function isPositionVisible(pos) {
            if (!pos || !camera) return true;
            _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
            _frustum.setFromProjectionMatrix(_projScreenMatrix);
            // Usamos un radio generoso (2m) para que los sonidos no se corten justo en el borde
            return _frustum.intersectsSphere({ center: pos, radius: 2 });
        }

        const SoundEngine = {
            play(type, pos) {
                // Si se proporciona posición, solo suena si es visible por la cámara
                if (pos && !isPositionVisible(pos)) return;

                if (audioCtx.state === 'suspended') audioCtx.resume();
                const now = audioCtx.currentTime;
                const masterGain = audioCtx.createGain();
                masterGain.connect(audioCtx.destination);

                switch (type) {
                    case 'shoot':
                        this.synthShoot(now, masterGain);
                        break;
                    case 'hit':
                        this.synthHit(now, masterGain);
                        break;
                    case 'death':
                        this.synthDeath(now, masterGain);
                        break;
                    case 'empty':
                        this.synthEmpty(now, masterGain);
                        break;
                    case 'recharge':
                        this.synthRecharge(now, masterGain);
                        break;
                    case 'ui':
                        this.synthUI(now, masterGain);
                        break;
                    case 'showdown':
                        this.synthShowdown(now, masterGain);
                        break;
                    case 'powerup':
                        this.synthPowerup(now, masterGain);
                        break;
                    case 'tick':
                        this.synthTick(now, masterGain);
                        break;
                    case 'explosion':
                        this.synthExplosion(now, masterGain);
                        break;
                    case 'gem':
                        this.synthGem(now, masterGain);
                        break;
                    case 'gemUpgrade':
                        this.synthGemUpgrade(now, masterGain);
                        break;
                    case 'gemLegendary':
                        this.synthGemLegendary(now, masterGain);
                        break;
                    case 'death_loss':
                        this.synthDeathLoss(now, masterGain);
                        break;
                }
            },

            synthShowdown(now, master) {
                const osc = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(100, now);
                osc.frequency.linearRampToValueAtTime(400, now + 1.5);
                g.gain.setValueAtTime(0, now);
                g.gain.linearRampToValueAtTime(0.5, now + 0.2);
                g.gain.exponentialRampToValueAtTime(0.01, now + 2);
                osc.connect(g); g.connect(master);
                osc.start(now); osc.stop(now + 2);
            },

            synthPowerup(now, master) {
                const osc = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(200, now);
                osc.frequency.exponentialRampToValueAtTime(800, now + 0.3);
                g.gain.setValueAtTime(0, now);
                g.gain.linearRampToValueAtTime(0.3, now + 0.05);
                g.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
                osc.connect(g); g.connect(master);
                osc.start(now); osc.stop(now + 0.4);
            },

            synthTick(now, master) {
                const osc = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                osc.type = 'square';
                osc.frequency.setValueAtTime(800, now);
                osc.frequency.exponentialRampToValueAtTime(1200, now + 0.08);
                g.gain.setValueAtTime(0.15, now);
                g.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                osc.connect(g); g.connect(master);
                osc.start(now); osc.stop(now + 0.1);
            },

            synthExplosion(now, master) {
                const bufferSize = audioCtx.sampleRate * 0.5;
                const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) {
                    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
                }
                const source = audioCtx.createBufferSource();
                source.buffer = buffer;
                const filter = audioCtx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(2000, now);
                filter.frequency.exponentialRampToValueAtTime(100, now + 0.5);
                const g = audioCtx.createGain();
                g.gain.setValueAtTime(0.4, now);
                g.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
                source.connect(filter); filter.connect(g); g.connect(master);
                source.start(now);
            },

            synthGem(now, master) {
                const osc = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(600, now);
                osc.frequency.exponentialRampToValueAtTime(1200, now + 0.05);
                osc.frequency.exponentialRampToValueAtTime(400, now + 0.12);
                g.gain.setValueAtTime(0.15, now);
                g.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
                osc.connect(g); g.connect(master);
                osc.start(now); osc.stop(now + 0.12);
            },

            synthGemUpgrade(now, master) {
                const osc1 = audioCtx.createOscillator();
                const osc2 = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                osc1.type = 'sine';
                osc2.type = 'sine';
                osc1.frequency.setValueAtTime(800, now);
                osc1.frequency.exponentialRampToValueAtTime(1600, now + 0.15);
                osc2.frequency.setValueAtTime(1200, now);
                osc2.frequency.exponentialRampToValueAtTime(2400, now + 0.15);
                g.gain.setValueAtTime(0.2, now);
                g.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
                osc1.connect(g); osc2.connect(g); g.connect(master);
                osc1.start(now); osc1.stop(now + 0.3);
                osc2.start(now); osc2.stop(now + 0.3);
            },

            synthGemLegendary(now, master) {
                const osc1 = audioCtx.createOscillator();
                const osc2 = audioCtx.createOscillator();
                const osc3 = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                osc1.type = 'sine';
                osc2.type = 'sine';
                osc3.type = 'triangle';
                osc1.frequency.setValueAtTime(523, now);
                osc2.frequency.setValueAtTime(659, now);
                osc3.frequency.setValueAtTime(784, now);
                osc1.frequency.exponentialRampToValueAtTime(1046, now + 0.5);
                osc2.frequency.exponentialRampToValueAtTime(1318, now + 0.5);
                osc3.frequency.exponentialRampToValueAtTime(1568, now + 0.5);
                g.gain.setValueAtTime(0.25, now);
                g.gain.exponentialRampToValueAtTime(0.01, now + 1);
                osc1.connect(g); osc2.connect(g); osc3.connect(g); g.connect(master);
                osc1.start(now); osc1.stop(now + 1);
                osc2.start(now); osc2.stop(now + 1);
                osc3.start(now); osc3.stop(now + 1);
            },

            synthEmpty(now, master) {
                const osc = audioCtx.createOscillator();
                const env = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(100, now);
                osc.frequency.linearRampToValueAtTime(50, now + 0.05);
                env.gain.setValueAtTime(0.2, now);
                env.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
                osc.connect(env);
                env.connect(master);
                osc.start(now);
                osc.stop(now + 0.05);
            },

            synthDeathLoss(now, master) {
                const osc = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(220, now);
                osc.frequency.exponentialRampToValueAtTime(110, now + 0.8);
                osc.frequency.exponentialRampToValueAtTime(55, now + 2.0);
                g.gain.setValueAtTime(0.3, now);
                g.gain.linearRampToValueAtTime(0.5, now + 0.1);
                g.gain.exponentialRampToValueAtTime(0.01, now + 2.0);
                const filter = audioCtx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(1000, now);
                filter.frequency.linearRampToValueAtTime(200, now + 2.0);
                osc.connect(filter); filter.connect(g); g.connect(master);
                osc.start(now); osc.stop(now + 2.0);
            },

            synthShoot(now, master) {
                const osc = audioCtx.createOscillator();
                const noise = this.createNoiseBuffer();
                const noiseNode = audioCtx.createBufferSource();
                const noiseGain = audioCtx.createGain();
                const env = audioCtx.createGain();
                const filter = audioCtx.createBiquadFilter();

                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(2000, now);
                filter.frequency.exponentialRampToValueAtTime(100, now + 0.1);

                osc.type = 'triangle';
                osc.frequency.setValueAtTime(600, now);
                osc.frequency.exponentialRampToValueAtTime(50, now + 0.1);

                noiseNode.buffer = noise;
                noiseGain.gain.setValueAtTime(0.5, now);
                noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);

                env.gain.setValueAtTime(0.5, now);
                env.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

                osc.connect(filter);
                noiseNode.connect(noiseGain);
                noiseGain.connect(filter);
                filter.connect(env);
                env.connect(master);

                const g = audioCtx.createGain();
                g.gain.setValueAtTime(0.15, now);
                g.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                noiseNode.connect(filter);
                filter.connect(g);
                g.connect(master);
                noiseNode.start(now);
                noiseNode.stop(now + 0.1);
            },

            createNoiseBuffer() {
                const bufferSize = audioCtx.sampleRate * 0.1;
                const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
                return buffer;
            },

            synthHit(now, master) {
                const osc = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                osc.type = 'square';
                osc.frequency.setValueAtTime(150, now);
                osc.frequency.exponentialRampToValueAtTime(40, now + 0.1);
                g.gain.setValueAtTime(0.2, now);
                g.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                osc.connect(g); g.connect(master);
                osc.start(now); osc.stop(now + 0.1);
            },

            synthDeath(now, master) {
                const osc = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(200, now);
                osc.frequency.exponentialRampToValueAtTime(50, now + 0.3);
                g.gain.setValueAtTime(0.3, now);
                g.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
                osc.connect(g); g.connect(master);
                osc.start(now); osc.stop(now + 0.3);
            },

            synthRecharge(now, master) {
                const osc = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(400, now);
                osc.frequency.exponentialRampToValueAtTime(800, now + 0.2);
                g.gain.setValueAtTime(0.2, now);
                g.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
                osc.connect(g); g.connect(master);
                osc.start(now); osc.stop(now + 0.2);
            },

            synthUI(now, master) {
                const osc = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(600, now);
                osc.frequency.exponentialRampToValueAtTime(1200, now + 0.05);
                g.gain.setValueAtTime(0.1, now);
                g.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
                osc.connect(g); g.connect(master);
                osc.start(now); osc.stop(now + 0.05);
            },

            synthDeathLoss(now, master) {
                const osc = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(220, now);
                osc.frequency.exponentialRampToValueAtTime(110, now + 0.8);
                osc.frequency.exponentialRampToValueAtTime(55, now + 2);
                
                g.gain.setValueAtTime(0.3, now);
                g.gain.linearRampToValueAtTime(0.5, now + 0.1);
                g.gain.exponentialRampToValueAtTime(0.01, now + 2);
                
                const filter = audioCtx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(1000, now);
                filter.frequency.linearRampToValueAtTime(200, now + 2);
                
                osc.connect(filter); filter.connect(g); g.connect(master);
                osc.start(now); osc.stop(now + 2);
            }
        };

        const MusicEngine = {
            isPlaying: false, intensity: 1.0, bpm: 128, gain: null,
            init() { if (this.gain) return; this.gain = audioCtx.createGain(); this.gain.connect(audioCtx.destination); this.gain.gain.value = 0.15; },
            start() { if (this.isPlaying) return; this.init(); this.isPlaying = true; this.scheduleLoop(audioCtx.currentTime); },
            stop() {
                this.isPlaying = false;
                if (this.timeoutId) clearTimeout(this.timeoutId);
                if (this.gain) this.gain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
            },
            scheduleLoop(time) {
                if (!this.isPlaying) return;
                const stepLen = 60 / (this.bpm * (this.intensity > 1.2 ? 1.5 : 1)) / 4;
                for (let i = 0; i < 16; i++) { this.playStep(time + i * stepLen, i); }
                this.timeoutId = setTimeout(() => this.scheduleLoop(time + 16 * stepLen), (16 * stepLen * 1000) - 50);
            },
            playStep(time, i) {
                if (i % 4 === 0) this.synthDrum(time, 60, 0.3, 0.12);
                if (i % 8 === 4) this.synthNoise(time, 0.1, 0.08);
                const notes = this.intensity > 1.2 ? [40, 43, 40, 48] : [40, 40, 40, 40];
                const freq = 440 * Math.pow(2, (notes[Math.floor(i / 4)] - 69) / 12);
                this.synthBass(time, freq, 0.1, 0.08);
            },
            synthDrum(t, f, d, v) { const o = audioCtx.createOscillator(); const g = audioCtx.createGain(); o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(0.01, t + d); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.01, t + d); o.connect(g); g.connect(this.gain); o.start(t); o.stop(t + d); },
            synthBass(t, f, d, v) { const o = audioCtx.createOscillator(); const g = audioCtx.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.01, t + d); o.connect(g); g.connect(this.gain); o.start(t); o.stop(t + d); },
            synthNoise(t, d, v) { const b = audioCtx.createBuffer(1, audioCtx.sampleRate * d, audioCtx.sampleRate); const dt = b.getChannelData(0); for (let i = 0; i < dt.length; i++) dt[i] = Math.random() * 2 - 1; const s = audioCtx.createBufferSource(); s.buffer = b; const g = audioCtx.createGain(); const f = audioCtx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1000; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.01, t + d); s.connect(f); f.connect(g); g.connect(this.gain); s.start(t); }
        };

        // Pre-asignación de objetos temporales para evitar Garbage Collection (Tarea 7.3)
        const _v1 = new THREE.Vector3();
        const _v2 = new THREE.Vector3();
        const _v3 = new THREE.Vector3();
        const _qTemp = new THREE.Quaternion(); // Tarea 12.1
        const _qTemp2 = new THREE.Quaternion(); // Tarea 12.1
        const _dirTemp = new THREE.Vector3(); // Cambio de nombre para evitar colisión
        const _box = new THREE.Box3();
        const _raycaster = new THREE.Raycaster();

        // 1. Configuración básica de la escena
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87CEEB); // Cielo azul claro
        scene.fog = new THREE.Fog(0x87CEEB, 20, 100);

        // 2. Cámara (Vista cenital / Isométrica)
        const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
        const cameraOffset = new THREE.Vector3(0, 15, 12); // Arriba 15m, Atrás 12m
        camera.position.copy(cameraOffset);
        camera.lookAt(0, 0, 0);

        // 3. Renderizador
        const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.shadowMap.enabled = true; 
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(renderer.domElement);

        // 4. Luces
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
        directionalLight.position.set(20, 30, 10);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 1024;
        directionalLight.shadow.mapSize.height = 1024;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 100;
        const d = 30;
        directionalLight.shadow.camera.left = -d;
        directionalLight.shadow.camera.right = d;
        directionalLight.shadow.camera.top = d;
        directionalLight.shadow.camera.bottom = -d;
        scene.add(directionalLight);

        // 5. Entorno (Mapa/Suelo)
        const mapSize = 100;
        let ground = null;
        const walls = [];
        const grassBlocks = []; // Para detectar si estamos dentro
        const boxes = []; // Tarea 37: Cajas de supervivencia
        const powerCubes = []; // Tarea 37: Ítems que sueltan las cajas

        // Generador de texturas procedurales (Ladrillos)
        function createBrickTexture(baseColor, brickColor) {
            const canvas = document.createElement('canvas');
            canvas.width = 128;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');

            // Fondo (mortero/unión)
            ctx.fillStyle = baseColor;
            ctx.fillRect(0, 0, 128, 128);

            // Ladrillos
            ctx.fillStyle = brickColor;
            const rows = 4;
            const cols = 2;
            const brickW = 128 / cols;
            const brickH = 128 / rows;

            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    let ox = (r % 2 === 0) ? 0 : -brickW / 2;
                    ctx.fillRect(ox + c * brickW + 2, r * brickH + 2, brickW - 4, brickH - 4);
                    if (ox < 0) {
                        ctx.fillRect(ox + cols * brickW + 2, r * brickH + 2, brickW - 4, brickH - 4);
                    }
                }
            }

            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            return texture;
        }

        // Textura de césped (hojas)
        function createGrassTexture() {
            const canvas = document.createElement('canvas');
            canvas.width = 64; canvas.height = 64;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#1B5E20';
            ctx.fillRect(0, 0, 64, 64);
            ctx.fillStyle = '#2E7D32';
            for (let i = 0; i < 30; i++) {
                ctx.fillRect(Math.random() * 64, Math.random() * 64, 4, 8);
            }
            const texture = new THREE.CanvasTexture(canvas);
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            return texture;
        }
        const grassTexture = createGrassTexture();

        // Tarea 37.1: Textura de caja de cartón sellada
        function createCardboardTexture() {
            const canvas = document.createElement('canvas');
            canvas.width = 128;
            canvas.height = 128;
            const ctx = canvas.getContext('2d');

            // Color base cartón
            ctx.fillStyle = '#C19A6B';
            ctx.fillRect(0, 0, 128, 128);

            // Bordes y sombras
            ctx.strokeStyle = '#8B6B4C';
            ctx.lineWidth = 4;
            ctx.strokeRect(2, 2, 124, 124);

            // Cinta de sellado (Precinto)
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'; // Cinta semi-transparente
            ctx.fillRect(0, 50, 128, 28);
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
            ctx.strokeRect(0, 50, 128, 28);

            const texture = new THREE.CanvasTexture(canvas);
            return texture;
        }
        const cardboardTexture = createCardboardTexture();

        const wallTextureBrown = createBrickTexture('#3E2723', '#8B4513');
        const wallTextureGrey = createBrickTexture('#424242', '#D7CCC8');

        function createWall(x, z, width, depth) {
            const tex = wallTextureBrown.clone();
            tex.repeat.set(width / 2, depth / 2 || 1);

            const wallGeo = new THREE.BoxGeometry(width, 2.5, depth);
            const wallMat = new THREE.MeshStandardMaterial({
                map: tex,
                roughness: 0.8
            });
            const wall = new THREE.Mesh(wallGeo, wallMat);
            wall.position.set(x, 1.25, z);
            wall.castShadow = true;
            wall.receiveShadow = true;
            scene.add(wall);

            const bbox = new THREE.Box3().setFromObject(wall);
            walls.push({ mesh: wall, box: bbox, hp: 1000 });
        }

        function createGrass(x, z, width, depth) {
            const tex = grassTexture.clone();
            tex.repeat.set(width / 2, depth / 2);
            const grassGeo = new THREE.BoxGeometry(width, 0.5, depth);
            const grassMat = new THREE.MeshStandardMaterial({
                map: tex,
                transparent: true,
                opacity: 0.9
            });
            const grass = new THREE.Mesh(grassGeo, grassMat);
            grass.position.set(x, 0.25, z);
            scene.add(grass);

            const bbox = new THREE.Box3().setFromObject(grass);
            grassBlocks.push({ mesh: grass, box: bbox });
        }

        function buildMap() {
            if (ground) {
                scene.remove(ground);
                walls.forEach(w => scene.remove(w.mesh));
                walls.length = 0;
                grassBlocks.forEach(g => scene.remove(g.mesh));
                grassBlocks.length = 0;
            }

            // Suelo con patrón tipo tablero decorativo para dar aspecto de arena
            const groundGeometry = new THREE.PlaneGeometry(mapSize, mapSize);
            const groundMaterial = new THREE.MeshStandardMaterial({
                color: 0x8BC34A, roughness: 1.0,
            });
            ground = new THREE.Mesh(groundGeometry, groundMaterial);
            ground.rotation.x = -Math.PI / 2;
            ground.receiveShadow = true;
            ground.matrixAutoUpdate = false;
            ground.updateMatrix();
            scene.add(ground);
            
            // Add walls and lakes from createGameHouses
            createGameHouses(scene);
            
            // Re-spawnear cajas
            spawnBoxes();

            const halfMap = mapSize / 2;

            // Paredes exteriores (límites del mapa)
            createWall(0, -halfMap, mapSize, 2);    // Norte
            createWall(0, halfMap, mapSize, 2);     // Sur
            createWall(-halfMap, 0, 2, mapSize);    // Oeste
            createWall(halfMap, 0, 2, mapSize);     // Este

            // Función para generar un grupo de paredes delgadas
            // type "L", "I", "U", "square", "block"
            const createGroup = (x, z, type, rotation) => {
                const wallThickness = 1.0;
                const wallLength = 4.0;

                const addBlock = (px, pz, width, depth) => {
                    const tex = wallTextureGrey.clone();
                    // Ajustar repetición según el lado más largo
                    const reps = Math.max(width, depth) / 2;
                    tex.repeat.set(width > depth ? reps : 1, depth > width ? reps : 1);

                    const block = new THREE.Mesh(
                        new THREE.BoxGeometry(width, 2.5, depth),
                        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })
                    );
                    block.position.set(px, 1.25, pz);
                    block.matrixAutoUpdate = false;
                    block.updateMatrix();
                    block.castShadow = true;
                    block.receiveShadow = true;
                    scene.add(block);
                    block.castShadow = true;
                    block.receiveShadow = true;
                    scene.add(block);
                    const bbox = new THREE.Box3().setFromObject(block);
                    walls.push({ mesh: block, box: bbox, hp: 1000 });
                };

                const W = wallLength;
                const T = wallThickness;

                if (type === 'I') {
                    if (rotation === 0) addBlock(x, z, W, T);
                    else addBlock(x, z, T, W);
                } else if (type === 'L') {
                    if (rotation === 0) {
                        addBlock(x, z, W, T);
                        addBlock(x - W / 2 + T / 2, z + W / 2, T, W);
                    } else if (rotation === 1) {
                        addBlock(x, z, W, T);
                        addBlock(x + W / 2 - T / 2, z + W / 2, T, W);
                    } else if (rotation === 2) {
                        addBlock(x, z, W, T);
                        addBlock(x - W / 2 + T / 2, z - W / 2, T, W);
                    } else {
                        addBlock(x, z, W, T);
                        addBlock(x + W / 2 - T / 2, z - W / 2, T, W);
                    }
                } else if (type === 'U') {
                    if (rotation === 0) {
                        addBlock(x, z, W, T);
                        addBlock(x - W / 2 + T / 2, z + W / 2, T, W);
                        addBlock(x + W / 2 - T / 2, z + W / 2, T, W);
                    } else {
                        addBlock(x, z, W, T);
                        addBlock(x - W / 2 + T / 2, z - W / 2, T, W);
                        addBlock(x + W / 2 - T / 2, z - W / 2, T, W);
                    }
                } else if (type === 'square') {
                    addBlock(x, z - W / 2 + T / 2, W, T);
                    addBlock(x, z + W / 2 - T / 2, W, T);
                    addBlock(x - W / 2 + T / 2, z, T, W - T * 2);
                    addBlock(x + W / 2 - T / 2, z, T, W - T * 2);
                } else if (type === 'block') {
                    addBlock(x, z, W, W);
                }

            };

            // ---- MAPA FIJO Y DISEÑADO ----
            // Zona central
            createGroup(0, -10, 'U', 0);
            createGroup(0, 10, 'U', 1);
            createGroup(-15, 0, 'I', 1);
            createGroup(15, 0, 'I', 1);

            // Obstáculos laterales y esquinas diseñados para cobertura
            createGroup(-20, -20, 'L', 0);
            createGroup(20, -20, 'L', 1);
            createGroup(-20, 20, 'L', 2);
            createGroup(20, 20, 'L', 3);

            createGroup(-35, -5, 'square', 0);
            createGroup(35, 5, 'square', 0);

            createGroup(-10, -30, 'I', 0);
            createGroup(10, -30, 'I', 0);
            createGroup(-10, 30, 'I', 0);
            createGroup(10, 30, 'I', 0);

            createGroup(30, -25, 'block', 0);
            createGroup(-30, -25, 'I', 1);
            createGroup(30, 25, 'I', 1);

            // Tarea 15.3: Muros en las esquinas para evitar vacío
            createGroup(-40, -40, 'L', 0);
            createGroup(40, -40, 'L', 1); // vacío
            createGroup(-40, 40, 'L', 2);
            createGroup(40, 40, 'L', 3);

            // Añadir zonas de césped (arbustos) cerca de muros
            createGrass(0, 0, 6, 6); // Centro
            createGrass(-15, 10, 8, 4);
            createGrass(15, -10, 8, 4);
            createGrass(-20, -25, 10, 5);
            createGrass(20, 25, 10, 5);
            // Tarea 15.3: Más pasto en las esquinas
            createGrass(-40, -35, 6, 4);
            createGrass(40, 35, 6, 4);
            // Césped dentro de los huecos de los muros centrales (Tarea 13)
            createGrass(0, -11, 3, 2);
            createGrass(0, 11, 3, 2);
        }

        // Tarea 39: Evitar generar cajas dentro de muros
        function findSafePosition(radius, avoidWalls = true) {
            let attempts = 0;
            while (attempts < 100) {
                const x = (Math.random() - 0.5) * 85;
                const z = (Math.random() - 0.5) * 85;

                // Verificar muros
                let collision = false;
                if (avoidWalls) {
                    const checkBox = new THREE.Box3().setFromCenterAndSize(
                        new THREE.Vector3(x, 1, z),
                        new THREE.Vector3(radius * 2.5, 2, radius * 2.5) // Margen extra
                    );
                    for (let w of walls) {
                        if (w.box.intersectsBox(checkBox)) {
                            collision = true;
                            break;
                        }
                    }
                }

                if (!collision) return { x, z };
                attempts++;
            }
            return { x: 0, z: 0 };
        }

        function spawnBoxes() {
            // Limpiar cajas viejas
            boxes.forEach(b => scene.remove(b.mesh));
            boxes.length = 0;

            const boxCount = 5; // Tarea 15.1: Solamente 5 cajas en el mapa
            for (let i = 0; i < boxCount; i++) {
                const pos = findSafePosition(1.0, true); // Usar findSafePosition para cajas
                createPowerBox(pos.x, pos.z);
            }
        }

        function createPowerBox(x, z) {
            // Tarea 37.1: Cajas más pequeñas y resistentes
            const boxGeo = new THREE.BoxGeometry(1.5, 1.1, 1.5);
            const boxMat = new THREE.MeshStandardMaterial({
                map: cardboardTexture,
                roughness: 0.9,
                emissive: 0x000000
            });
            const boxMesh = new THREE.Mesh(boxGeo, boxMat);
            // Ajustar posición Y para que esté en el suelo (1.1 / 2 = 0.55)
            boxMesh.position.set(x, 0.55, z);
            boxMesh.castShadow = true;
            boxMesh.receiveShadow = true;
            scene.add(boxMesh);

            const bbox = new THREE.Box3().setFromObject(boxMesh);
            boxes.push({
                mesh: boxMesh,
                box: bbox,
                hp: 10400,
                maxHp: 10400,
                originalPos: new THREE.Vector3(x, 0.55, z),
                hitTime: 0
            });

            updateHPDisplay(boxMesh, 10400, 10400, "Caja");
        }

        function spawnPowerCube(pos) {
            const cubeGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
            const cubeMat = new THREE.MeshStandardMaterial({
                color: 0x00FF00,
                emissive: 0x00FF00,
                emissiveIntensity: 0.5
            });
            const cubeMesh = new THREE.Mesh(cubeGeo, cubeMat);
            cubeMesh.position.set(pos.x, 1, pos.z);
            scene.add(cubeMesh);

            powerCubes.push({
                mesh: cubeMesh
            });
        }

        // 6. Personaje y Modelado (Tarea 10)
        // Pool de Geometrías para optimizar rendimiento (Tarea 10.5)
        const GEO = {
            body: new THREE.CylinderGeometry(0.3, 0.4, 0.8, 16),
            jacket: new THREE.CylinderGeometry(0.35, 0.43, 0.75, 16),
            coatLower: new THREE.CylinderGeometry(0.43, 0.5, 0.5, 16, 1, true, -Math.PI/2, Math.PI),
            collar: new THREE.CylinderGeometry(0.36, 0.36, 0.1, 16, 1, true),
            pin: new THREE.SphereGeometry(0.04, 8, 8),
            head: new THREE.SphereGeometry(0.35, 16, 16),
            hairTop: new THREE.SphereGeometry(0.38, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2),
            ponytail: new THREE.ConeGeometry(0.15, 0.5, 8),
            bun: new THREE.SphereGeometry(0.15, 12, 12),
            sclera: new THREE.SphereGeometry(0.05, 12, 12),
            pupil: new THREE.SphereGeometry(0.025, 8, 8),
            mouthBack: new THREE.SphereGeometry(0.08, 12, 12),
            lips: new THREE.TorusGeometry(0.08, 0.025, 8, 16),
            teeth: new THREE.BoxGeometry(0.08, 0.03, 0.01),
            limb: new THREE.CylinderGeometry(0.12, 0.1, 0.7, 12),
            hand: new THREE.SphereGeometry(0.12, 12, 12),
            gunHandle: new THREE.BoxGeometry(0.1, 0.3, 0.15),
            gunBody: new THREE.BoxGeometry(0.12, 0.2, 0.4),
            gunBarrel: new THREE.CylinderGeometry(0.045, 0.045, 0.3, 12),
            coil: new THREE.TorusGeometry(0.04, 0.015, 8, 16),
            glow: new THREE.SphereGeometry(0.04, 8, 8),
            shadow: new THREE.CircleGeometry(0.5, 16)
        };
GEO.shadow.rotateX(-Math.PI/2);
        GEO.gunBarrel.rotateX(-Math.PI/2);

        // Cache de materiales de camisa (definido antes de createDetailedBrawler)
        const shirtMatCache = {};

        // Pool de Materiales base
        const MAT = {
            skin: new THREE.MeshStandardMaterial({ color: 0xffccaa, roughness: 0.7 }),
            hair: new THREE.MeshStandardMaterial({ color: 0xd9381e, roughness: 0.9 }),
            pants: new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.8 }), 
            shoes: new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.5 }),
            jacket: new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 }), 
            detail: new THREE.MeshStandardMaterial({ color: 0x00E5FF, emissive: 0x00E5FF, emissiveIntensity: 0.3 }),
            gun: new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8, roughness: 0.3 }), 
            sclera: new THREE.MeshBasicMaterial({ color: 0xffffff }),
            pupil: new THREE.MeshBasicMaterial({ color: 0x000000 }),
            mouthBack: new THREE.MeshBasicMaterial({ color: 0x330000 }),
            lips: new THREE.MeshBasicMaterial({ color: 0x5D2906 }),
            teeth: new THREE.MeshBasicMaterial({ color: 0xffffff }),
            shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 })
        };

        // --- EFECTO DE AURA (Invulnerabilidad) --- 
        function createAura(targetGroup) {
            const auraGeo = new THREE.SphereGeometry(1.2, 32, 32);
            const auraMat = new THREE.MeshBasicMaterial({
                color: 0x00ffff,
                transparent: true,
                opacity: 0.3,
                side: THREE.DoubleSide,
                depthWrite: false // Tarea: Evitar que el aura oculte el personaje por error de profundidad
            });
            const aura = new THREE.Mesh(auraGeo, auraMat);
            aura.name = "aura";
            // Tarea: Hacerla un pelín más grande para asegurar que no clipee
            aura.scale.set(1.2, 1.4, 1.2); 
            aura.position.y = 1.1;
            targetGroup.add(aura);
            return aura;
        }

        function removeAura(targetGroup) {
            if (!targetGroup) return;
            const aura = targetGroup.getObjectByName("aura");
            if (aura) {
                targetGroup.remove(aura);
                aura.geometry.dispose();
                aura.material.dispose();
            }
        }

function createDetailedBrawler(colorHex) {
            const group = new THREE.Group();
            const visualGroup = new THREE.Group();
            visualGroup.name = "visualGroup";
            group.add(visualGroup);

            if (!shirtMatCache[colorHex]) {
                shirtMatCache[colorHex] = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.7 });
            }
            const shirtMat = shirtMatCache[colorHex];

// 1. Cuerpo (Torso)
            const body = new THREE.Mesh(GEO.body, shirtMat);
            body.position.y = 1.0;
            visualGroup.add(body);

            // Chaqueta (Abrigo)
            const jacket = new THREE.Mesh(GEO.jacket, MAT.jacket);
            jacket.position.y = 1.05;
            visualGroup.add(jacket);

            // Parte inferior del abrigo (faldas)
            const coatLower = new THREE.Mesh(GEO.coatLower, MAT.jacket);
            coatLower.position.set(0, 0.6, 0);
            visualGroup.add(coatLower);

            // Cuello de la chaqueta
            const collar = new THREE.Mesh(GEO.collar, MAT.jacket);
            collar.position.y = 1.4;
            visualGroup.add(collar);

            // Cinturón
            const belt = new THREE.Mesh(GEO.collar, MAT.pants);
            belt.scale.set(1.2, 1, 1.2);
            belt.position.y = 0.65;
            visualGroup.add(belt);

            // Detalles en la chaqueta (Pins neón)
            const leftPin = new THREE.Mesh(GEO.pin, MAT.detail);
            leftPin.position.set(-0.15, 1.2, 0.36);
            visualGroup.add(leftPin);

            const rightPin = new THREE.Mesh(GEO.pin, MAT.detail);
            rightPin.position.set(0.12, 1.1, 0.38);
            visualGroup.add(rightPin);

            // 2. Cabeza
            const head = new THREE.Mesh(GEO.head, MAT.skin);
            head.position.y = 1.6;
            visualGroup.add(head);

            // Pelo pelirrojo
            const hairTop = new THREE.Mesh(GEO.hairTop, MAT.hair);
            hairTop.position.y = 1.6;
            visualGroup.add(hairTop);
            
            const ponytail = new THREE.Mesh(GEO.ponytail, MAT.hair);
            ponytail.position.set(0, 1.5, -0.35);
            ponytail.rotation.x = -Math.PI / 4;
            visualGroup.add(ponytail);

            const bun = new THREE.Mesh(GEO.bun, MAT.hair);
            bun.position.set(0, 1.95, -0.1);
            visualGroup.add(bun);

            // Ojos
            const leftEyeBase = new THREE.Mesh(GEO.sclera, MAT.sclera);
            leftEyeBase.position.set(-0.12, 1.65, 0.32);
            const leftPupil = new THREE.Mesh(GEO.pupil, MAT.pupil);
            leftPupil.position.set(0, 0, 0.042);
            leftEyeBase.add(leftPupil);
            visualGroup.add(leftEyeBase);
            
            const rightEyeBase = new THREE.Mesh(GEO.sclera, MAT.sclera);
            rightEyeBase.position.set(0.12, 1.65, 0.32);
            const rightPupil = new THREE.Mesh(GEO.pupil, MAT.pupil);
            rightPupil.position.set(0, 0, 0.042);
            rightEyeBase.add(rightPupil);
            visualGroup.add(rightEyeBase);

            // Boca - labios delgados y estirados
            const mouthGeo = new THREE.BoxGeometry(0.12, 0.02, 0.02);
            const mouthMat = new THREE.MeshBasicMaterial({ color: 0x5D2906 });
            const mouth = new THREE.Mesh(mouthGeo, mouthMat);
            mouth.position.set(0, 1.48, 0.34);
            visualGroup.add(mouth);

            // Guardar ojos para animator
            group.userData.leftEye = leftEyeBase;
            group.userData.rightEye = rightEyeBase;
            group.userData.leftPupil = leftPupil;
            group.userData.rightPupil = rightPupil;

            // 3. Piernas
            const leftLeg = new THREE.Mesh(GEO.limb, MAT.pants);
            leftLeg.position.set(-0.22, 0.3, 0);
            visualGroup.add(leftLeg);
            group.userData.leftLeg = leftLeg;

            const rightLeg = new THREE.Mesh(GEO.limb, MAT.pants);
            rightLeg.position.set(0.22, 0.3, 0);
            visualGroup.add(rightLeg);
            group.userData.rightLeg = rightLeg;

            // Zapatillas
            const leftShoe = new THREE.Mesh(GEO.hand, MAT.shoes);
            leftShoe.scale.set(1.2, 0.6, 1.4);
            leftShoe.position.set(0, -0.3, 0.05);
            leftLeg.add(leftShoe);
            
            const rightShoe = new THREE.Mesh(GEO.hand, MAT.shoes);
            rightShoe.scale.set(1.2, 0.6, 1.4);
            rightShoe.position.set(0, -0.3, 0.05);
            rightLeg.add(rightShoe);

            // 4. Brazos
            const leftArmGroup = new THREE.Group();
            leftArmGroup.position.set(-0.5, 1.3, 0); 
            const leftArm = new THREE.Mesh(GEO.limb, MAT.skin);
            leftArm.position.y = -0.3;
            leftArmGroup.add(leftArm);
            
            const leftSleeveJ = new THREE.Mesh(GEO.limb, MAT.jacket);
            leftSleeveJ.scale.set(1.2, 0.6, 1.2);
            leftSleeveJ.position.y = -0.15;
            leftArmGroup.add(leftSleeveJ);

            const leftHand = new THREE.Mesh(GEO.hand, MAT.skin);
            leftHand.scale.set(0.8, 0.8, 0.8);
            leftHand.position.y = -0.65;
            leftArmGroup.add(leftHand);
            group.userData.leftHand = leftHand;

            leftArmGroup.rotation.z = 0.25; 
            visualGroup.add(leftArmGroup);
            group.userData.leftArm = leftArmGroup;

            const rightArmGroup = new THREE.Group();
            rightArmGroup.position.set(0.4, 1.3, 0);
            const rightArm = new THREE.Mesh(GEO.limb, MAT.skin);
            rightArm.position.y = -0.3;
            rightArmGroup.add(rightArm);
            
            const rightSleeveJ = new THREE.Mesh(GEO.limb, MAT.jacket);
            rightSleeveJ.scale.set(1.2, 0.6, 1.2);
            rightSleeveJ.position.y = -0.15;
            rightArmGroup.add(rightSleeveJ);

            const rightHand = new THREE.Mesh(GEO.hand, MAT.skin);
            rightHand.scale.set(0.8, 0.8, 0.8);
            rightHand.position.y = -0.65;
            rightArmGroup.add(rightHand);
            group.userData.rightHand = rightHand;

            visualGroup.add(rightArmGroup);
            group.userData.rightArm = rightArmGroup;

            // 5. Arma
            function createElectricGun() {
                const gunGroup = new THREE.Group();

                const handle = new THREE.Mesh(GEO.gunHandle, MAT.gun);
                handle.position.set(0, -0.06, 0);
                handle.rotation.x = Math.PI / 8;
                gunGroup.add(handle);

                const pBody = new THREE.Mesh(GEO.gunBody, MAT.gun);
                pBody.position.set(0, 0.05, 0.05); 
                gunGroup.add(pBody);
                
                const barrel = new THREE.Mesh(GEO.gunBarrel, MAT.gun);
                barrel.position.set(0, 0.05, 0.35);
                gunGroup.add(barrel);

                for(let i=0; i<3; i++) {
                    const coil = new THREE.Mesh(GEO.coil, MAT.detail);
                    coil.position.set(0, 0.05, 0.25 + i*0.08);
                    gunGroup.add(coil);
                }

                const glow = new THREE.Mesh(GEO.glow, MAT.detail);
                glow.position.set(0, 0.05, 0.52);
                gunGroup.add(glow);
                
                return gunGroup;
            }

            const rightGun = createElectricGun();
            rightGun.position.set(0, -0.65, 0.1); 
            rightGun.rotation.x = Math.PI / 2.2;
            rightArmGroup.add(rightGun);
            
            group.userData.rightGun = rightGun;
            group.userData.leftGun = null;

            group.userData.bodyMaterial = shirtMat;

            // Sombra
            const shadow = new THREE.Mesh(GEO.shadow, MAT.shadow);
            shadow.position.y = 0.01;
            visualGroup.add(shadow);

            return group;
        }

        // --- ROBOT CHARACTER ---
        function createRobotBrawler(colorHex) {
            const group = new THREE.Group();
            const visualGroup = new THREE.Group();
            visualGroup.name = "visualGroup";
            group.add(visualGroup);

            // Robot materials
            const robotWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.5 });
            const robotGray = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.7 });
            const robotDarkGray = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.5, metalness: 0.7 });
            const robotBrown = new THREE.MeshStandardMaterial({ color: 0x8B5A2B, roughness: 0.6 });
            const robotBlack = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
            const robotBorder = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 });

            // Cuerpo cuadrado con esquinas suavizadas
            const bodyGeo = new THREE.BoxGeometry(0.75, 0.65, 0.45);
            const body = new THREE.Mesh(bodyGeo, robotWhite);
            body.position.y = 1.0;
            visualGroup.add(body);
            
            // Borde exterior muy sutil para suavizar esquinas
            const bodyOuterGeo = new THREE.BoxGeometry(0.76, 0.66, 0.46);
            const bodyOuterMat = new THREE.MeshStandardMaterial({ 
                color: 0xffffff, 
                roughness: 0.4, 
                metalness: 0.2,
                transparent: true,
                opacity: 0.6
            });
            const bodyOuter = new THREE.Mesh(bodyOuterGeo, bodyOuterMat);
            bodyOuter.position.y = 1.0;
            visualGroup.add(bodyOuter);

            // 4 Tornillos solo en la parte de atrás
            const bodyScrewGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.015, 6);
            const backScrewPositions = [
                [-0.3, 1.25, -0.23], [0.3, 1.25, -0.23],
                [-0.3, 0.75, -0.23], [0.3, 0.75, -0.23]
            ];
            backScrewPositions.forEach(([x, y, z]) => {
                const screw = new THREE.Mesh(bodyScrewGeo, robotDarkGray);
                screw.rotation.x = Math.PI / 2;
                screw.position.set(x, y, z);
                visualGroup.add(screw);
            });

            // Detalles de desgaste - Frente
            const wearMat = new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.25 });
            const wearMatBack = new THREE.MeshBasicMaterial({ color: 0xbbbbbb, transparent: true, opacity: 0.2 });
            
            // Frente - Marcas y rayas
            const wear1 = new THREE.Mesh(new THREE.CircleGeometry(0.06, 8), wearMat);
            wear1.position.set(0.25, 1.15, 0.23);
            visualGroup.add(wear1);
            
            const scratch1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.008, 0.005), wearMat);
            scratch1.position.set(-0.1, 0.9, 0.23);
            scratch1.rotation.z = 0.3;
            visualGroup.add(scratch1);
            
            const scratch2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.006, 0.005), wearMat);
            scratch2.position.set(0.15, 0.85, 0.23);
            scratch2.rotation.z = -0.2;
            visualGroup.add(scratch2);
            
            const cornerWear = new THREE.Mesh(new THREE.CircleGeometry(0.03, 6), wearMat);
            cornerWear.position.set(-0.35, 0.7, 0.23);
            visualGroup.add(cornerWear);
            
            // Atrás - Rayas y marcas
            const backScratch1 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.007, 0.005), wearMatBack);
            backScratch1.position.set(0.1, 1.2, -0.23);
            backScratch1.rotation.z = -0.4;
            visualGroup.add(backScratch1);
            
            const backScratch2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.005, 0.005), wearMatBack);
            backScratch2.position.set(-0.2, 1.0, -0.23);
            backScratch2.rotation.z = 0.5;
            visualGroup.add(backScratch2);
            
            const backScratch3 = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.006, 0.005), wearMatBack);
            backScratch3.position.set(0.05, 0.8, -0.23);
            backScratch3.rotation.z = 0.1;
            visualGroup.add(backScratch3);
            
            const backWear = new THREE.Mesh(new THREE.CircleGeometry(0.04, 6), wearMatBack);
            backWear.position.set(-0.25, 0.75, -0.23);
            visualGroup.add(backWear);

            // Ojo grande circular (iris marrón) - pegado al cuerpo
            const eyeRingGeo = new THREE.TorusGeometry(0.20, 0.05, 12, 24);
            const eyeRing = new THREE.Mesh(eyeRingGeo, robotBrown);
            eyeRing.position.set(0, 1.05, 0.24);
            visualGroup.add(eyeRing);

            // Parte negra del ojo (sclera negra)
            const eyeBlackGeo = new THREE.CircleGeometry(0.18, 24);
            const eyeBlack = new THREE.Mesh(eyeBlackGeo, robotBlack);
            eyeBlack.position.set(0, 1.05, 0.245);
            visualGroup.add(eyeBlack);

            // Pupila azul en el centro
            const pupilMat = new THREE.MeshStandardMaterial({ 
                color: 0x00BFFF, 
                emissive: 0x00BFFF, 
                emissiveIntensity: 0.6,
                roughness: 0.3 
            });
            const pupilGeo = new THREE.CircleGeometry(0.08, 16);
            const pupil = new THREE.Mesh(pupilGeo, pupilMat);
            pupil.position.set(0, 1.05, 0.25);
            visualGroup.add(pupil);

            // Yunque/Anvil en la cabeza - pegado al cuerpo
            // Parte inferior (más estrecha - pega al cuerpo)
            const anvilBottomGeo = new THREE.BoxGeometry(0.25, 0.08, 0.2);
            const anvilBottom = new THREE.Mesh(anvilBottomGeo, robotBlack);
            anvilBottom.position.set(0, 1.33, 0);
            visualGroup.add(anvilBottom);
            
            // Parte media
            const anvilMidGeo = new THREE.BoxGeometry(0.4, 0.08, 0.28);
            const anvilMid = new THREE.Mesh(anvilMidGeo, robotBlack);
            anvilMid.position.set(0, 1.41, 0);
            visualGroup.add(anvilMid);
            
            // Parte superior (más ancha - como yunque)
            const anvilTopGeo = new THREE.BoxGeometry(0.55, 0.1, 0.35);
            const anvilTop = new THREE.Mesh(anvilTopGeo, robotBlack);
            anvilTop.position.set(0, 1.5, 0);
            visualGroup.add(anvilTop);

            // Brazos - tamaño normal
            const armTubeGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.17, 12);
            const handGeo = new THREE.SphereGeometry(0.09, 12, 12);
            const elbowGeo = new THREE.SphereGeometry(0.065, 8, 8);

            // Función para crear pistola más grande
            function createGun() {
                const gun = new THREE.Group();
                
                // Empuñadura
                const handleGeo = new THREE.BoxGeometry(0.06, 0.12, 0.07);
                const handle = new THREE.Mesh(handleGeo, robotBlack);
                gun.add(handle);
                
                // Cuerpo
                const bodyGeo = new THREE.BoxGeometry(0.08, 0.09, 0.18);
                const body = new THREE.Mesh(bodyGeo, robotBlack);
                body.position.set(0, 0.09, 0.04);
                gun.add(body);
                
                // Cañón
                const barrelGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.15, 8);
                const barrel = new THREE.Mesh(barrelGeo, robotDarkGray);
                barrel.rotation.x = Math.PI / 2;
                barrel.position.set(0, 0.09, 0.2);
                gun.add(barrel);
                
                // Boca del cañón
                const muzzleGeo = new THREE.CylinderGeometry(0.035, 0.025, 0.025, 8);
                const muzzle = new THREE.Mesh(muzzleGeo, robotBlack);
                muzzle.rotation.x = Math.PI / 2;
                muzzle.position.set(0, 0.09, 0.29);
                gun.add(muzzle);
                
                // Detalle azul
                const detailMat = new THREE.MeshStandardMaterial({ 
                    color: 0x00BFFF, 
                    emissive: 0x00BFFF, 
                    emissiveIntensity: 0.6 
                });
                const detailGeo = new THREE.BoxGeometry(0.03, 0.012, 0.05);
                const detail = new THREE.Mesh(detailGeo, detailMat);
                detail.position.set(0, 0.14, 0.04);
                gun.add(detail);
                
                return gun;
            }

            // Brazo izquierdo completo con pistola
            const leftArmGroup = new THREE.Group();
            leftArmGroup.position.set(-0.38, 1.05, 0);
            
            const leftShoulder = new THREE.Mesh(armTubeGeo, robotWhite);
            leftShoulder.rotation.z = Math.PI / 2.6;
            leftShoulder.position.set(-0.05, 0.02, 0);
            leftArmGroup.add(leftShoulder);
            
            const leftElbow = new THREE.Mesh(elbowGeo, robotWhite);
            leftElbow.position.set(-0.15, -0.06, 0);
            leftArmGroup.add(leftElbow);
            
            const leftForearm = new THREE.Mesh(armTubeGeo, robotWhite);
            leftForearm.position.set(-0.15, -0.19, 0);
            leftArmGroup.add(leftForearm);
            
            const leftHand = new THREE.Mesh(handGeo, robotBrown);
            leftHand.position.set(-0.15, -0.32, 0);
            leftArmGroup.add(leftHand);
            
            // Pistola izquierda en la mano
            const leftGun = createGun();
            leftGun.position.set(-0.15, -0.38, 0.08);
            leftArmGroup.add(leftGun);
            
            visualGroup.add(leftArmGroup);

            // Brazo derecho completo con pistola
            const rightArmGroup = new THREE.Group();
            rightArmGroup.position.set(0.38, 1.05, 0);
            
            const rightShoulder = new THREE.Mesh(armTubeGeo, robotWhite);
            rightShoulder.rotation.z = -Math.PI / 2.6;
            rightShoulder.position.set(0.05, 0.02, 0);
            rightArmGroup.add(rightShoulder);
            
            const rightElbow = new THREE.Mesh(elbowGeo, robotWhite);
            rightElbow.position.set(0.15, -0.06, 0);
            rightArmGroup.add(rightElbow);
            
            const rightForearm = new THREE.Mesh(armTubeGeo, robotWhite);
            rightForearm.position.set(0.15, -0.19, 0);
            rightArmGroup.add(rightForearm);
            
            const rightHand = new THREE.Mesh(handGeo, robotBrown);
            rightHand.position.set(0.15, -0.32, 0);
            rightArmGroup.add(rightHand);
            
            // Pistola derecha en la mano
            const rightGun = createGun();
            rightGun.position.set(0.15, -0.38, 0.08);
            rightArmGroup.add(rightGun);
            
            visualGroup.add(rightArmGroup);

            // Pierna central única - unida al cuerpo con detalles
            const legGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.35, 12);
            const leg = new THREE.Mesh(legGeo, robotGray);
            leg.position.set(0, 0.5, 0);
            visualGroup.add(leg);

            // Conexión al cuerpo
            const legConnectGeo = new THREE.CylinderGeometry(0.08, 0.06, 0.1, 12);
            const legConnect = new THREE.Mesh(legConnectGeo, robotGray);
            legConnect.position.set(0, 0.7, 0);
            visualGroup.add(legConnect);

            // Detalles de la pierna - Tornillos
            const screwGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.02, 6);
            const screwHeadGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.01, 6);
            
            // Tornillos frontal
            for (let i = 0; i < 3; i++) {
                const screw = new THREE.Mesh(screwGeo, robotBlack);
                screw.rotation.x = Math.PI / 2;
                screw.position.set(0, 0.6 - i * 0.12, 0.06);
                visualGroup.add(screw);
                
                const screwHead = new THREE.Mesh(screwHeadGeo, robotDarkGray);
                screwHead.rotation.x = Math.PI / 2;
                screwHead.position.set(0, 0.6 - i * 0.12, 0.07);
                visualGroup.add(screwHead);
            }

            // Tornillos laterales
            for (let i = 0; i < 2; i++) {
                const screwL = new THREE.Mesh(screwGeo, robotBlack);
                screwL.rotation.z = Math.PI / 2;
                screwL.position.set(0.06, 0.55 - i * 0.15, 0);
                visualGroup.add(screwL);
                
                const screwR = new THREE.Mesh(screwGeo, robotBlack);
                screwR.rotation.z = Math.PI / 2;
                screwR.position.set(-0.06, 0.55 - i * 0.15, 0);
                visualGroup.add(screwR);
            }

            // Placa metálica en la pierna
            const plateGeo = new THREE.BoxGeometry(0.08, 0.12, 0.01);
            const plate = new THREE.Mesh(plateGeo, robotDarkGray);
            plate.position.set(0, 0.45, 0.065);
            visualGroup.add(plate);

            // Remaches en la placa
            const rivetGeo = new THREE.SphereGeometry(0.012, 6, 6);
            const rivetPositions = [[-0.03, 0.49], [0.03, 0.49], [-0.03, 0.41], [0.03, 0.41]];
            rivetPositions.forEach(([x, y]) => {
                const rivet = new THREE.Mesh(rivetGeo, robotBlack);
                rivet.position.set(x, y, 0.07);
                visualGroup.add(rivet);
            });

            // Rueda en lugar del pie (más grande)
            // Eje de la rueda
            const axleGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.15, 8);
            const axle = new THREE.Mesh(axleGeo, robotDarkGray);
            axle.rotation.x = Math.PI / 2;
            axle.position.set(0, 0.25, 0);
            visualGroup.add(axle);

            // Rueda (toroide más grande)
            const wheelGeo = new THREE.TorusGeometry(0.13, 0.05, 12, 24);
            const wheel = new THREE.Mesh(wheelGeo, robotBlack);
            wheel.rotation.y = Math.PI / 2;
            wheel.position.set(0, 0.25, 0);
            visualGroup.add(wheel);

            // Centro de la rueda
            const wheelCenterGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.1, 12);
            const wheelCenter = new THREE.Mesh(wheelCenterGeo, robotDarkGray);
            wheelCenter.rotation.x = Math.PI / 2;
            wheelCenter.position.set(0, 0.25, 0);
            visualGroup.add(wheelCenter);

            // Detalles en el centro de la rueda
            const hubDetailGeo = new THREE.TorusGeometry(0.04, 0.01, 6, 12);
            const hubDetail = new THREE.Mesh(hubDetailGeo, robotBlack);
            hubDetail.rotation.y = Math.PI / 2;
            hubDetail.position.set(0, 0.25, 0.055);
            visualGroup.add(hubDetail);

            // Soportes laterales de la rueda - más realistas
            // Soporte izquierdo (ligeramente curvado)
            const leftSupportGeo = new THREE.BoxGeometry(0.025, 0.22, 0.07);
            const leftSupport = new THREE.Mesh(leftSupportGeo, robotGray);
            leftSupport.position.set(-0.11, 0.25, 0);
            visualGroup.add(leftSupport);
            
            // Soporte derecho
            const rightSupport = new THREE.Mesh(leftSupportGeo, robotGray);
            rightSupport.position.set(0.11, 0.25, 0);
            visualGroup.add(rightSupport);
            
            // Conexión superior
            const supportTopGeo = new THREE.BoxGeometry(0.245, 0.03, 0.07);
            const supportTop = new THREE.Mesh(supportTopGeo, robotDarkGray);
            supportTop.position.set(0, 0.36, 0);
            visualGroup.add(supportTop);
            
            // Conexión inferior
            const supportBottomGeo = new THREE.BoxGeometry(0.245, 0.03, 0.07);
            const supportBottom = new THREE.Mesh(supportBottomGeo, robotDarkGray);
            supportBottom.position.set(0, 0.14, 0);
            visualGroup.add(supportBottom);
            
            // Tornillos en los soportes
            const supportScrewGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.08, 6);
            const supportScrew1L = new THREE.Mesh(supportScrewGeo, robotBlack);
            supportScrew1L.rotation.x = Math.PI / 2;
            supportScrew1L.position.set(-0.11, 0.36, 0);
            visualGroup.add(supportScrew1L);
            const supportScrew1R = new THREE.Mesh(supportScrewGeo, robotBlack);
            supportScrew1R.rotation.x = Math.PI / 2;
            supportScrew1R.position.set(0.11, 0.36, 0);
            visualGroup.add(supportScrew1R);
            const supportScrew2L = new THREE.Mesh(supportScrewGeo, robotBlack);
            supportScrew2L.rotation.x = Math.PI / 2;
            supportScrew2L.position.set(-0.11, 0.14, 0);
            visualGroup.add(supportScrew2L);
            const supportScrew2R = new THREE.Mesh(supportScrewGeo, robotBlack);
            supportScrew2R.rotation.x = Math.PI / 2;
            supportScrew2R.position.set(0.11, 0.14, 0);
            visualGroup.add(supportScrew2R);



            // Sombra
            const shadow = new THREE.Mesh(GEO.shadow, MAT.shadow);
            shadow.position.y = 0.01;
            visualGroup.add(shadow);

            // Store references for animation
            group.userData.leftArm = leftArmGroup;
            group.userData.rightArm = rightArmGroup;
            group.userData.leftLeg = leg;
            group.userData.rightLeg = leg;
            group.userData.leftHand = leftHand;
            group.userData.rightHand = rightHand;
            group.userData.pupil = pupil;
            group.userData.bodyMaterial = robotWhite;
            group.userData.isRobot = true;

            return group;
        }

        // --- FLOWER CHARACTER (Sunflower) - Nombre interno: Lanrry ---
        const FLOWER_CHARACTER_NAME = 'Lanrry';
        
        function createFlowerBrawler() {
            const group = new THREE.Group();
            const visualGroup = new THREE.Group();
            visualGroup.name = "visualGroup";
            group.add(visualGroup);

            // Colores
            const yellowMat = new THREE.MeshStandardMaterial({ color: 0xFFDD00, roughness: 0.5 });
            const greenMat = new THREE.MeshStandardMaterial({ color: 0x3D9140, roughness: 0.6 });
            const pinkMat = new THREE.MeshStandardMaterial({ color: 0xFF69B4, roughness: 0.5 });
            const blackMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
            const whiteMat = new THREE.MeshStandardMaterial({ color: 0xFFFFFF });

            // Cabeza amarilla redondeada y achatada
            const headGeo = new THREE.SphereGeometry(0.28, 16, 16);
            const head = new THREE.Mesh(headGeo, yellowMat);
            head.scale.set(1.1, 1.0, 0.65);
            head.position.y = 1.55;
            visualGroup.add(head);

            // 3 Hojas grandes en la cabeza (arriba, izquierda, derecha)
            const leafGeo = new THREE.SphereGeometry(0.18, 8, 8);
            const lightGreenMat = new THREE.MeshStandardMaterial({ color: 0x5CB85C, roughness: 0.5 });
            
            // Hoja ARRIBA - VERTICAL apuntando hacia arriba
            const leafUp = new THREE.Mesh(leafGeo, greenMat);
            leafUp.scale.set(0.9, 2.2, 0.5);
            leafUp.position.set(0, 1.85, 0);
            visualGroup.add(leafUp);
            // Línea clara EN la superficie de la hoja - dimensiones exactas de la hoja
            const leafUpHeight = 0.18 * 2.2; // 0.396
            const leafUpLineF = new THREE.Mesh(new THREE.BoxGeometry(0.04, leafUpHeight, 0.002), lightGreenMat);
            leafUpLineF.position.set(0, 1.85, 0.09);
            visualGroup.add(leafUpLineF);
            const leafUpLineB = new THREE.Mesh(new THREE.BoxGeometry(0.04, leafUpHeight, 0.002), lightGreenMat);
            leafUpLineB.position.set(0, 1.85, -0.09);
            visualGroup.add(leafUpLineB);
            
            // Hoja IZQUIERDA - bien pegada a la cabeza
            const leafLeft = new THREE.Mesh(leafGeo, greenMat);
            leafLeft.scale.set(2.2, 0.9, 0.5);
            leafLeft.position.set(-0.32, 1.55, 0);
            visualGroup.add(leafLeft);
            // Línea clara EN la superficie de la hoja - dimensiones exactas de la hoja
            const leafSideWidth = 0.18 * 2.2; // 0.396
            const leafLeftLineF = new THREE.Mesh(new THREE.BoxGeometry(leafSideWidth, 0.04, 0.002), lightGreenMat);
            leafLeftLineF.position.set(-0.32, 1.55, 0.09);
            visualGroup.add(leafLeftLineF);
            const leafLeftLineB = new THREE.Mesh(new THREE.BoxGeometry(leafSideWidth, 0.04, 0.002), lightGreenMat);
            leafLeftLineB.position.set(-0.32, 1.55, -0.09);
            visualGroup.add(leafLeftLineB);
            
            // Hoja DERECHA - bien pegada a la cabeza
            const leafRight = new THREE.Mesh(leafGeo, greenMat);
            leafRight.scale.set(2.2, 0.9, 0.5);
            leafRight.position.set(0.32, 1.55, 0);
            visualGroup.add(leafRight);
            // Línea clara EN la superficie de la hoja - dimensiones exactas de la hoja
            const leafRightLineF = new THREE.Mesh(new THREE.BoxGeometry(leafSideWidth, 0.04, 0.002), lightGreenMat);
            leafRightLineF.position.set(0.32, 1.55, 0.09);
            visualGroup.add(leafRightLineF);
            const leafRightLineB = new THREE.Mesh(new THREE.BoxGeometry(leafSideWidth, 0.04, 0.002), lightGreenMat);
            leafRightLineB.position.set(0.32, 1.55, -0.09);
            visualGroup.add(leafRightLineB);

            // Ojos (dos líneas verticales negras como en la imagen)
            const eyeGeo = new THREE.BoxGeometry(0.025, 0.1, 0.02);
            const leftEye = new THREE.Mesh(eyeGeo, blackMat);
            leftEye.position.set(-0.08, 1.58, 0.3);
            visualGroup.add(leftEye);
            
            const rightEye = new THREE.Mesh(eyeGeo, blackMat);
            rightEye.position.set(0.08, 1.58, 0.3);
            visualGroup.add(rightEye);

            // Boca simple sin textura
            const mouthMat = new THREE.MeshBasicMaterial({ 
                color: 0x5D2906,
                side: THREE.DoubleSide
            });
            const mouthGeo = new THREE.PlaneGeometry(0.32, 0.16);
            const mouth = new THREE.Mesh(mouthGeo, mouthMat);
            mouth.position.set(0, 1.44, 0.32);
            visualGroup.add(mouth);

            // Cuerpo amarillo tipo semilla/maní (más estrecho en el medio)
            const bodyGroup = new THREE.Group();
            
            // Parte superior del cuerpo
            const bodyTopGeo = new THREE.SphereGeometry(0.14, 12, 12);
            const bodyTop = new THREE.Mesh(bodyTopGeo, yellowMat);
            bodyTop.scale.set(1, 0.8, 0.7);
            bodyTop.position.y = 1.15;
            bodyGroup.add(bodyTop);
            
            // Parte media (más estrecha)
            const bodyMidGeo = new THREE.CylinderGeometry(0.1, 0.12, 0.25, 12);
            const bodyMid = new THREE.Mesh(bodyMidGeo, yellowMat);
            bodyMid.position.y = 0.95;
            bodyGroup.add(bodyMid);
            
            // Parte inferior (más ancha)
            const bodyBottomGeo = new THREE.SphereGeometry(0.15, 12, 12);
            const bodyBottom = new THREE.Mesh(bodyBottomGeo, yellowMat);
            bodyBottom.scale.set(1, 0.7, 0.7);
            bodyBottom.position.y = 0.75;
            bodyGroup.add(bodyBottom);
            
            visualGroup.add(bodyGroup);

            // Costuras rosas en el cuerpo (2 filas)
            const stitchGeo = new THREE.BoxGeometry(0.15, 0.015, 0.015);
            // Fila superior
            const stitch1 = new THREE.Mesh(stitchGeo, pinkMat);
            stitch1.position.set(0, 1.05, 0.14);
            visualGroup.add(stitch1);
            // Flechas de la costura
            const stitchArrowGeo = new THREE.ConeGeometry(0.015, 0.03, 4);
            const stitchArrow1L = new THREE.Mesh(stitchArrowGeo, pinkMat);
            stitchArrow1L.rotation.z = Math.PI / 2;
            stitchArrow1L.position.set(-0.08, 1.05, 0.14);
            visualGroup.add(stitchArrow1L);
            const stitchArrow1R = new THREE.Mesh(stitchArrowGeo, pinkMat);
            stitchArrow1R.rotation.z = -Math.PI / 2;
            stitchArrow1R.position.set(0.08, 1.05, 0.14);
            visualGroup.add(stitchArrow1R);
            
            // Fila inferior
            const stitch2 = new THREE.Mesh(stitchGeo, pinkMat);
            stitch2.position.set(0, 0.88, 0.14);
            visualGroup.add(stitch2);
            const stitchArrow2L = new THREE.Mesh(stitchArrowGeo, pinkMat);
            stitchArrow2L.rotation.z = Math.PI / 2;
            stitchArrow2L.position.set(-0.08, 0.88, 0.14);
            visualGroup.add(stitchArrow2L);
            const stitchArrow2R = new THREE.Mesh(stitchArrowGeo, pinkMat);
            stitchArrow2R.rotation.z = -Math.PI / 2;
            stitchArrow2R.position.set(0.08, 0.88, 0.14);
            visualGroup.add(stitchArrow2R);

            // Brazos verdes (como hojas)
            const armGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.35, 8);
            const handGeo = new THREE.SphereGeometry(0.07, 8, 8);
            
            const leftArmGroup = new THREE.Group();
            leftArmGroup.position.set(-0.22, 1.0, 0);
            const leftArm = new THREE.Mesh(armGeo, greenMat);
            leftArm.rotation.z = 0.4;
            leftArmGroup.add(leftArm);
            const leftHand = new THREE.Mesh(handGeo, greenMat);
            leftHand.position.set(-0.15, -0.2, 0);
            leftArmGroup.add(leftHand);
            visualGroup.add(leftArmGroup);

            const rightArmGroup = new THREE.Group();
            rightArmGroup.position.set(0.22, 1.0, 0);
            const rightArm = new THREE.Mesh(armGeo, greenMat);
            rightArm.rotation.z = -0.4;
            rightArmGroup.add(rightArm);
            const rightHand = new THREE.Mesh(handGeo, greenMat);
            rightHand.position.set(0.15, -0.2, 0);
            rightArmGroup.add(rightHand);
            visualGroup.add(rightArmGroup);

            // Piernas verdes (largas y delgadas)
            const legGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.4, 8);
            const footGeo = new THREE.SphereGeometry(0.06, 8, 8);
            
            const leftLegGroup = new THREE.Group();
            leftLegGroup.position.set(-0.08, 0.45, 0);
            const leftLeg = new THREE.Mesh(legGeo, greenMat);
            leftLegGroup.add(leftLeg);
            const leftFoot = new THREE.Mesh(footGeo, greenMat);
            leftFoot.scale.set(1.2, 0.6, 1.6);
            leftFoot.position.set(0, -0.25, 0.03);
            leftLegGroup.add(leftFoot);
            visualGroup.add(leftLegGroup);

            const rightLegGroup = new THREE.Group();
            rightLegGroup.position.set(0.08, 0.45, 0);
            const rightLeg = new THREE.Mesh(legGeo, greenMat);
            rightLegGroup.add(rightLeg);
            const rightFoot = new THREE.Mesh(footGeo, greenMat);
            rightFoot.scale.set(1.2, 0.6, 1.6);
            rightFoot.position.set(0, -0.25, 0.03);
            rightLegGroup.add(rightFoot);
            visualGroup.add(rightLegGroup);

            // Sombra
            const shadow = new THREE.Mesh(GEO.shadow, MAT.shadow);
            shadow.position.y = 0.01;
            visualGroup.add(shadow);

            // Store references for animation
            group.userData.leftArm = leftArmGroup;
            group.userData.rightArm = rightArmGroup;
            group.userData.leftLeg = leftLegGroup;
            group.userData.rightLeg = rightLegGroup;
            group.userData.leftHand = leftHand;
            group.userData.rightHand = rightHand;
            group.userData.isFlower = true;
            group.userData.bodyMaterial = yellowMat;

            return group;
        }

        // --- Character Selection System ---
        const characterTypes = ['brawler', 'robot', 'flower'];
        let currentCharacterIndex = 0;
        const characterColors = [0x00FF88, 0xFF5733, 0x3498DB, 0xF1C40F, 0x9B59B6];

        function switchCharacter() {
            currentCharacterIndex = (currentCharacterIndex + 1) % characterTypes.length;
            const charType = characterTypes[currentCharacterIndex];
            const color = characterColors[currentCharacterIndex % characterColors.length];

            if (window.menuBrawler && window.menuScene) {
                window.menuScene.remove(window.menuBrawler);
                
                if (charType === 'robot') {
                    window.menuBrawler = createRobotBrawler(color);
                } else if (charType === 'flower') {
                    window.menuBrawler = createFlowerBrawler();
                } else {
                    window.menuBrawler = createDetailedBrawler(color);
                }
                
                window.menuBrawler.position.set(0, 0, 0);
                window.menuScene.add(window.menuBrawler);
                menuBrawler = window.menuBrawler;
                
                // Update local references
                menuBrawler.rotation.y = window.currentRotationTarget || 0;
            }
            
            // Save selection
            window.selectedCharacterType = charType;
            window.selectedCharacterColor = color;
        }
        window.switchCharacter = switchCharacter;
        
        // Select character by index from menu
        window.selectCharacterByIndex = function(index) {
            if (index >= 0 && index < characterTypes.length) {
                currentCharacterIndex = index;
                const charType = characterTypes[currentCharacterIndex];
                const color = characterColors[currentCharacterIndex % characterColors.length];

                if (window.menuBrawler && window.menuScene) {
                    window.menuScene.remove(window.menuBrawler);
                    
                    if (charType === 'robot') {
                        window.menuBrawler = createRobotBrawler(color);
                    } else if (charType === 'flower') {
                        window.menuBrawler = createFlowerBrawler();
                    } else {
                        window.menuBrawler = createDetailedBrawler(color);
                    }
                    
                    window.menuBrawler.position.set(0, 0, 0);
                    window.menuScene.add(window.menuBrawler);
                    menuBrawler = window.menuBrawler;
                    menuBrawler.rotation.y = window.currentRotationTarget || 0;
                    
                    window.selectedCharacterType = charType;
                    window.selectedCharacterColor = color;
                }
                
                window.closeCharMenu();
            }
        };

        // --- Sistema de Lágrimas ---
        const teardrops = [];
        function createTeardrop(mesh) {
            const drop = new THREE.Mesh(GEO.sclera, MAT.detail); // Color cyan neón
            drop.scale.set(0.1, 0.2, 0.1);
            const side = Math.random() > 0.5 ? 0.12 : -0.12;
            drop.position.set(side, 1.6, 0.35);
            mesh.add(drop);
            teardrops.push({ mesh: drop, parent: mesh, life: 1.0 });
        }

        function updateTeardrops(delta) {
            for (let i = teardrops.length - 1; i >= 0; i--) {
                const t = teardrops[i];
                t.mesh.position.y -= delta * 0.5;
                t.life -= delta * 0.5;
                if (t.life <= 0) {
                    t.parent.remove(t.mesh);
                    teardrops.splice(i, 1);
                }
            }
        }

        // Tarea 20: Lógica de Animación
        function updateCharacterAnimation(group, state, time, delta) {
            const { leftLeg, rightLeg, leftArm, rightArm, rightGun, leftEye, rightEye, leftPupil, rightPupil, leftHand, rightHand, mouthGroup } = group.userData;
            if(!leftLeg) return;
            
            // Para el robot, usar animación especial
            if (group.userData.isRobot) {
                // Animación simple: solo respiración
                const vg = group.getObjectByName("visualGroup");
                if (vg && (state === 'idle' || state === 'breathe')) {
                    vg.position.y = Math.sin(time * 2) * 0.02;
                }
                
                // Pupil animación
                if (group.userData.pupil) {
                    const pupil = group.userData.pupil;
                    
                    // Pulso de brillo
                    const pulse = 0.4 + Math.sin(time * 3) * 0.3;
                    pupil.material.emissiveIntensity = pulse;
                    
                    // Movimiento discreto: derecha, pausa, izquierda, pausa, centro, pausa
                    const cycle = time % 9;
                    let lookX = 0;
                    if (cycle < 1.5) {
                        lookX = 0.05; // Mira a la derecha
                    } else if (cycle < 3) {
                        lookX = 0; // Centro (pausa)
                    } else if (cycle < 4.5) {
                        lookX = -0.05; // Mira a la izquierda
                    } else if (cycle < 6) {
                        lookX = 0; // Centro (pausa)
                    } else {
                        lookX = 0; // Centro (pausa larga)
                    }
                    pupil.position.x = lookX;
                    
                    // Parpadeo: se aplana como una línea
                    const blinkTime = time % 3.5;
                    if (blinkTime > 3.3) {
                        pupil.scale.y = 0.05; // Se aplana como línea cerrada
                    } else {
                        pupil.scale.y = 1.0;
                    }
                }
                
                return;
            }
            const alpha = Math.min(1, delta * 8);

            // --- Animació de Ojos ---
            const blinkTime = time % 4;
            const blinking = blinkTime > 3.8;
            const winkRight = group.userData.winkRight || false;
            const winkLeft = group.userData.winkLeft || false;
            
            if (leftEye) leftEye.scale.y = (blinking || winkLeft) ? 0.1 : 1.0;
            if (rightEye) rightEye.scale.y = (blinking || winkRight) ? 0.1 : 1.0;

            const eyeSeed = Math.floor(time * 0.5);
            const eyePhase = (time * 0.5) % 1;
            if (eyePhase < 0.1) {
                const offsetX = (Math.sin(eyeSeed * 7) * 0.01);
                const offsetY = (Math.cos(eyeSeed * 3) * 0.01);
                if (leftPupil) leftPupil.position.set(offsetX, offsetY, 0.042);
                if (rightPupil) rightPupil.position.set(offsetX * 1.1, offsetY * 0.9, 0.042);
            }

            // Robot pupil pulsing animation
            if (group.userData.isRobot && group.userData.pupil) {
                const pupil = group.userData.pupil;
                const pulse = 0.4 + Math.sin(time * 3) * 0.3;
                pupil.material.emissiveIntensity = pulse;
                const scalePulse = 1 + Math.sin(time * 4) * 0.1;
                pupil.scale.set(scalePulse, scalePulse, 1);
            }

            // --- SISTEMA DE BLENDING: calcular targets y aplicar lerp ---
            let tLLegX = 0, tRLegX = 0;
            let tLArmX = 0, tLArmZ = 0.25;
            let tRArmX = -Math.PI / 2.2, tRArmZ = 0;
            let tVisualY = 0;

            if (state === 'idle' || state === 'breathe') {
                tVisualY = Math.sin(time * 2) * 0.05;
                tLArmX = Math.sin(time) * 0.1;
                // CORRECCION DE SIGNOS: Para que apunten HACIA AFUERA (A-pose)
                tLArmZ = -0.35; // Negativo para rotar hacia afuera a la izquierda
                
                tRArmX = 0.5 + Math.sin(time) * 0.05; 
                tRArmZ = 0.25;  // Positivo para rotar hacia afuera a la derecha
                
                // Tarea: Mantener solo rotación sutil, eliminar escala
                const handPulse = Math.sin(time) * 0.05;
                if (leftHand) {
                    leftHand.rotation.x = handPulse;
                    leftHand.scale.set(0.8, 0.8, 0.8);
                }
                if (rightHand) {
                    rightHand.rotation.x = handPulse;
                    rightHand.scale.set(0.8, 0.8, 0.8);
                }
                
                if (mouthGroup) {
                    const mouthScale = 1.0 + Math.sin(time) * 0.01;
                    mouthGroup.scale.set(mouthScale, mouthScale, 1.0);
                }
            } else if (state === 'look_left') {
                // Tarea: Mirar a la izquierda (Cabeza + Ojos)
                tVisualY = Math.sin(time * 2) * 0.05;
                const vg = group.getObjectByName("visualGroup");
                if (vg) {
                    const head = vg.children.find(c => c.geometry === GEO.head);
                    if (head) head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, 0.6, alpha);
                }
                const offsetX = -0.015; // Ojos a la izquierda
                if (leftPupil) leftPupil.position.set(offsetX, 0, 0.042);
                if (rightPupil) rightPupil.position.set(offsetX, 0, 0.042);
            } else if (state === 'salute') {
                // Tarea FIX: Mano MUCHO MÁS ARRIBA
                tLArmX = -Math.PI * 1.1; // Rotación extra para apuntar casi vertical
                tLArmZ = 0.85 + Math.sin(time * 10) * 0.3; 
                tRArmX = -Math.PI / 4;
                tVisualY = Math.abs(Math.sin(time * 2)) * 0.05;
            } else if (state === 'walk') {
                const walkSpeed = 12;
                const legRot = Math.sin(time * walkSpeed) * 0.5;
                tLLegX = legRot;
                tRLegX = -legRot;
                tLArmX = -legRot * 0.8;
                tLArmZ = 0.25;
                tRArmX = -Math.PI / 2.2 + Math.abs(Math.sin(time * walkSpeed)) * 0.1;
                tVisualY = Math.abs(Math.sin(time * walkSpeed)) * 0.1;
            } else if (state === 'attack') {
                const recoil = Math.sin(time * 25) * 0.15;
                if (rightGun) rightGun.position.z = 0.05 + Math.max(0, recoil);
                tRArmX = -Math.PI / 2.2 - recoil * 0.5;
                tLArmZ = 0.25;
                // Mantener pose de apuntar con el cuerpo y cabeza al disparar
                const vg = group.getObjectByName("visualGroup");
                if (vg) {
                    vg.rotation.x = THREE.MathUtils.lerp(vg.rotation.x, 0.15, alpha);
                    const head = vg.children.find(c => c.geometry === GEO.head);
                    if (head) head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, 0.1, alpha);
                }
            } else if (state === 'aim') {
                // Pose de apuntar: brazo levantado e inclinación de cuerpo y cabeza
                tRArmX = -Math.PI / 2.2;
                tLArmZ = 0.25;
                const vg = group.getObjectByName("visualGroup");
                if (vg) {
                    vg.rotation.x = THREE.MathUtils.lerp(vg.rotation.x, 0.2, alpha);
                    const head = vg.children.find(c => c.geometry === GEO.head);
                    if (head) head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, 0.15, alpha);
                }
            } else if (state === 'sad') {
                const vg = group.getObjectByName("visualGroup");
                if (vg) {
                    const head = vg.children.find(c => c.geometry === GEO.head);
                    if (head) head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, 0.4, 0.08);
                    const mouth = vg.children.find(c => c.children.length > 0 && c.position.y < 1.6 && c.position.y > 1.4);
                    if (mouth) mouth.rotation.x = THREE.MathUtils.lerp(mouth.rotation.x, -Math.PI / 1.8, 0.08);
                }
                tLArmX = 0.2 + Math.sin(time * 0.5) * 0.1;
                tLArmZ = 0.1;
                tRArmX = 0.2 + Math.cos(time * 0.5) * 0.1;
                tRArmZ = -0.1;
                if (Math.random() < 0.1) createTeardrop(group);
            } else if (state === 'celebrate') {
                // Saltar, aplaudir, feliz
                const clap = Math.sin(time * 14);
                const jump = Math.abs(Math.sin(time * 7)) * 0.6; // bote de salto
                tVisualY = jump;
                // Aplaudir: brazos se juntan por delante pero con margen para no pegar en la boca
                tLArmX = -Math.PI / 2.2 + clap * 0.5; 
                tLArmZ = 0.5 + clap * 0.25; // Base 0.5 en vez de 0.3
                tRArmX = -Math.PI / 2.2 - clap * 0.5;
                tRArmZ = -(0.5 + clap * 0.25);
                // Piernas: ligero balanceo al saltar
                tLLegX = Math.sin(time * 7) * 0.2;
                tRLegX = -Math.sin(time * 7) * 0.2;
            }

            // --- Reset de inclinación (Tarea: Volver a la vertical tras apuntar) ---
            if (state !== 'attack' && state !== 'aim' && state !== 'sad') {
                const vg = group.getObjectByName("visualGroup");
                if (vg) {
                    vg.rotation.x = THREE.MathUtils.lerp(vg.rotation.x, 0, alpha);
                    const head = vg.children.find(c => c.geometry === GEO.head);
                    if (head) {
                        head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, 0, alpha);
                        head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, 0, alpha);
                    }
                }
            }

            // Lerp suave: evita "pum" al cambiar de estado
            leftLeg.rotation.x  = THREE.MathUtils.lerp(leftLeg.rotation.x,  tLLegX,  alpha);
            rightLeg.rotation.x = THREE.MathUtils.lerp(rightLeg.rotation.x, tRLegX,  alpha);
            leftArm.rotation.x  = THREE.MathUtils.lerp(leftArm.rotation.x,  tLArmX,  alpha);
            leftArm.rotation.z  = THREE.MathUtils.lerp(leftArm.rotation.z,  tLArmZ,  alpha);
            rightArm.rotation.x = THREE.MathUtils.lerp(rightArm.rotation.x, tRArmX,  alpha);
            rightArm.rotation.z = THREE.MathUtils.lerp(rightArm.rotation.z, tRArmZ,  alpha);

            const vg = group.getObjectByName("visualGroup");
            if (vg && state !== 'sad') {
                vg.position.y = THREE.MathUtils.lerp(vg.position.y, tVisualY, alpha);
            }
        }


        // Helper: mostrar banner de posición al morir o ganar
        
        let totalTrophies = parseInt(localStorage.getItem('brawlTrophies')) || 0;
        
        function updateTrophyDisplay() {
            const el = document.getElementById('trophy-count');
            if (el) el.innerText = totalTrophies;
            localStorage.setItem('brawlTrophies', totalTrophies);
        }

        function showPlacement(place) {
            const banner = document.getElementById('placement-banner');
            if (!banner) return;
            
            // Calcular delta de trofeos
            let trophyDelta = 0;
            switch(place) {
                case 1: trophyDelta = 10; break;
                case 2: trophyDelta = 6; break;
                case 3: trophyDelta = 2; break;
                case 4: trophyDelta = 0; break;
                case 5: trophyDelta = -2; break;
                case 6: trophyDelta = -3; break;
                case 7: trophyDelta = -4; break;
                case 8: trophyDelta = -5; break;
                case 9: trophyDelta = -6; break;
                case 10: trophyDelta = -7; break;
                default: trophyDelta = 0;
            }
            
            // Calcular los textos de visualización ANTES de las animaciones
            const displayDelta = trophyDelta >= 0 ? `+${trophyDelta}` : `${trophyDelta}`;
            const colorDelta = trophyDelta > 0 ? '#00FF00' : (trophyDelta < 0 ? '#FF4444' : '#aaaaaa');

            // Actualizar trofeos INMEDIATAMENTE para que queden guardados
            // aunque el usuario cierre la pantalla antes de que termine la animación
            if (trophyDelta !== 0) {
                totalTrophies += trophyDelta;
                if (totalTrophies < 0) totalTrophies = 0;
                updateTrophyDisplay(); // Guardar en localStorage y actualizar UI inmediatamente
            }

            // Mostrar el banner de posición
            const numEl = banner.querySelector('.place-number');
            if (numEl) numEl.textContent = `#${place}`;
            banner.className = '';
            if (place === 1) banner.classList.add('gold');
            else if (place === 2) banner.classList.add('silver');
            else if (place === 3) banner.classList.add('bronze');
            else banner.classList.add('normal');

            // Mostrar el delta de trofeos visualmente en el banner
            let trophySubtitle = banner.querySelector('.trophy-delta');
            if (!trophySubtitle) {
                trophySubtitle = document.createElement('div');
                trophySubtitle.className = 'trophy-delta';
                trophySubtitle.style.fontSize = '1.8rem';
                trophySubtitle.style.marginTop = '6px';
                banner.appendChild(trophySubtitle);
            }
            if (trophyDelta !== 0) {
                trophySubtitle.innerHTML = `<span style="color:${colorDelta}; font-weight:bold;">${displayDelta} 🏆</span>`;
            } else {
                trophySubtitle.innerHTML = `<span style="color:#aaa;">0 🏆</span>`;
            }

            // Reiniciar animación de entrada del banner
            banner.style.display = 'none';
            void banner.offsetWidth;
            banner.style.display = 'flex';

            // Efecto de vuelo: el número de delta vuela desde el banner al marcador (puramente visual)
            if (trophyDelta !== 0) {
                setTimeout(() => {
                    const bannerRect = banner.getBoundingClientRect();
                    const targetRect = document.getElementById('trophy-display').getBoundingClientRect();
                    
                    const flyingEl = document.createElement('div');
                    flyingEl.textContent = `${displayDelta} СЂСџРЏвЂ `;
                    flyingEl.style.cssText = `
                        position: fixed;
                        left: ${bannerRect.left + bannerRect.width / 2}px;
                        top: ${bannerRect.top + bannerRect.height / 2}px;
                        font-size: 2.5rem;
                        font-family: 'Outfit', sans-serif;
                        font-weight: bold;
                        color: ${colorDelta};
                        text-shadow: 2px 2px 0 #000;
                        z-index: 5000;
                        pointer-events: none;
                        white-space: nowrap;
                    `;
                    document.body.appendChild(flyingEl);

                    const destX = targetRect.left + targetRect.width / 2;
                    const destY = targetRect.top + targetRect.height / 2;
                    const startX = bannerRect.left + bannerRect.width / 2;
                    const startY = bannerRect.top + bannerRect.height / 2;

                    const anim = flyingEl.animate([
                        { left: `${startX}px`, top: `${startY}px`, opacity: 1, transform: 'scale(1.2)' },
                        { left: `${destX}px`, top: `${destY}px`, opacity: 0.3, transform: 'scale(0.4)' }
                    ], { duration: 900, easing: 'ease-in', fill: 'forwards' });

                    anim.onfinish = () => {
                        flyingEl.remove();
                        // Efecto de pulso en el contador de trofeos
                        const disp = document.getElementById('trophy-display');
                        if (disp) {
                            disp.style.transition = 'transform 0.15s, background-color 0.15s';
                            disp.style.transform = 'scale(1.25)';
                            disp.style.backgroundColor = trophyDelta > 0 ? 'rgba(0,200,0,0.6)' : 'rgba(200,0,0,0.6)';
                            SoundEngine.play('hit');
                            setTimeout(() => {
                                disp.style.transform = 'scale(1)';
                                disp.style.backgroundColor = 'rgba(0,0,0,0.7)';
                            }, 250);
                        }
                    };
                }, 1200);
            }
        }

        function hidePlacement() {
            const banner = document.getElementById('placement-banner');
            if (banner) banner.style.display = 'none';
        }

        // Tarea: Mostrar menú de pérdida (con personaje llorando)
        function showLossMenu() {
            document.getElementById('loss-menu').style.display = 'flex';
            if (window.MusicEngine) MusicEngine.stop();
            
            // 🔥 FIREBASE: Salir del juego
            if (firebaseMyRef) {
                firebaseMyRef.remove();
                firebaseMyRef = null;
            }
            // Limpiar meshes de otros jugadores
            firebasePlayerMeshes.forEach(function(g) { scene.remove(g); });
            firebasePlayerMeshes.clear();
        }

        let lossRenderer, lossScene, lossCamera, lossBrawler;
        function initLossScreenPreview() {
            const container = document.getElementById('loss-canvas-container');
            if (lossRenderer) {
                container.appendChild(lossRenderer.domElement);
                return;
            }
            lossScene = new THREE.Scene();
            lossCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
            lossCamera.position.set(0, 1.2, 2.5);
            lossCamera.lookAt(0, 1.2, 0);

            lossRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            lossRenderer.setSize(500, 500);
            container.appendChild(lossRenderer.domElement);

            const ambient = new THREE.AmbientLight(0xffffff, 1.5);
            lossScene.add(ambient);
            const dir = new THREE.DirectionalLight(0xffffff, 2);
            dir.position.set(5, 5, 5);
            lossScene.add(dir);

            lossBrawler = createDetailedBrawler(0x00FF88); // Color del jugador
            lossScene.add(lossBrawler);

            function animateLoss() {
                if (document.getElementById('loss-menu').style.display === 'flex') {
                    requestAnimationFrame(animateLoss);
                    const now = Date.now() * 0.001;
                    updateCharacterAnimation(lossBrawler, 'sad', now, 0.016);
                    updateTeardrops(0.016);
                    lossRenderer.render(lossScene, lossCamera);
                }
            }
            animateLoss();
        }

        const moveSpeed = 7;
        const keys = { w: false, a: false, s: false, d: false };

        function updateActivity() {
            lastInputTime = Date.now();
        }
        window.addEventListener('keydown', updateActivity);
        window.addEventListener('mousedown', updateActivity);
        window.addEventListener('mousemove', updateActivity);
        window.addEventListener('touchstart', updateActivity, {passive: true});
        window.addEventListener('touchmove', updateActivity, {passive: true});

        // 7.5. Sistema de Disparo
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        const bullets = [];
        const bulletSpeed = 25;
        const bulletRange = 10;
        const bulletGeometry = new THREE.SphereGeometry(0.15, 8, 8);
        const spreadAngles = [-Math.PI / 12, -Math.PI / 24, 0, Math.PI / 24, Math.PI / 12];

        // Sistema de munición (Tarea 23: Estilo Brawl Stars)
        const MAX_AMMO = 3;
        const RECHARGE_TIME = 2000; // 2 segundos por carga
        let playerAmmo = MAX_AMMO;

        // --- Tarea 20: Previsualización 3D en el Menú ---
        let menuScene, menuCamera, menuRenderer, menuBrawler;
            // initMenu3D_OLD deprecated
        // --- Pool de Balas (Tarea 7.2) ---
        const bulletPool = [];
        const MAX_BULLET_POOL = 100;

        function getBulletFromPool(color) {
            let b;
            if (bulletPool.length > 0) {
                b = bulletPool.pop();
                b.material.color.setHex(color);
                b.material.emissive.setHex(color);
                b.visible = true;
            } else {
                const mat = new THREE.MeshStandardMaterial({ 
                    color: color, 
                    emissive: color, 
                    emissiveIntensity: 0.3,
                    transparent: false 
                });
                b = new THREE.Mesh(bulletGeometry, mat);
            }
            return b;
        }

        function returnBulletToPool(bulletObj) {
            bulletObj.visible = false;
            if (bulletPool.length < MAX_BULLET_POOL) {
                bulletPool.push(bulletObj);
            } else {
                bulletObj.geometry.dispose();
                bulletObj.material.dispose();
                scene.remove(bulletObj);
            }
        }

        // Función para disparar una ráfaga de proyectiles
        function fireSpread(originPos, aimDirection, ownerType, ownerName) {
            const baseDmg = 300;
            for (let s = 0; s < spreadAngles.length; s++) {
                const angle = spreadAngles[s];
                
                _dirTemp.copy(aimDirection);
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                const rx = _dirTemp.x * cos - _dirTemp.z * sin;
                const rz = _dirTemp.x * sin + _dirTemp.z * cos;
                
                const col = ownerType === 'player' ? 0x00E5FF : (ownerType === 'enemy' ? 0xFF4444 : 0xFFFFFF);
                const bMesh = getBulletFromPool(col);
                
                // Tarea 9.1: Punto de disparo adelantado para mayor naturalidad
                const forwardOffset = 0.8;
                bMesh.position.set(
                    originPos.x + aimDirection.x * forwardOffset, 
                    1, 
                    originPos.z + aimDirection.z * forwardOffset
                );
                
                if (!bMesh.parent) scene.add(bMesh);

                bullets.push({
                    mesh: bMesh,
                    dir: new THREE.Vector3(rx, 0, rz),
                    traveled: 0,
                    type: ownerType,
                    owner: ownerName,
                    // Tarea 11.1: Paridad absoluta de daño. Bots y Jugador usan la misma lógica
                    damage: baseDmg * (ownerType === 'player' ? playerDamageMultiplier : (enemies.find(e => e.name === ownerName)?.damageMultiplier || 1.0))
                });
            }
        }

        // Declaración unificada de variables globales y UI
        const MAX_HP = 3700;
        const REGEN_DELAY = 3000;
        const REGEN_PERCENT = 0.13;
        const enemies = [];
        const brawlersLeftDisplay = document.getElementById('brawlers-left');
        const uiContainer = document.getElementById('ui-container');
        const gameStats = document.getElementById('game-stats');
        const killFeedContainer = document.getElementById('kill-feed');

        let isPlaying = false;
        let gameOver = false;
        let playerGroup = null;
        let aimIndicator = null;
        let playerHP = MAX_HP;
        let playerMaxHP = MAX_HP;
        let lastInputTime = Date.now();
        let playerDamageMultiplier = 1.0;
        let playerLastDamageTime = 0;
        let playerVisible = true;
        let playerVisibleTime = 0;
        let introSequenceActive = false; // Bloquear controles durante la intro
        let invulnerabilityTime = 0; // Tiempo restante de invulnerabilidad
        let playerLastRegenBurstTime = 0;
        let playerHitTime = 0; // Tarea 38
        let playerOriginalPos = new THREE.Vector3();
        let playerLastPos = new THREE.Vector3(); // Tarea FIX AI: Para velocidad
        let screenShake = 0; // Tarea 34: Intensidad de sacudida
        let globalTimeScale = 1.0; // Tarea 41: Para efecto Slow-Mo

        // Inicializar display de trofeos al cargar
        if (typeof updateTrophyDisplay === 'function') updateTrophyDisplay();

        function spawnPlayerAt(x, z) {
            if (playerGroup) scene.remove(playerGroup);
            playerGroup = createDetailedBrawler(0x00FF88);
            playerGroup.position.set(x, 0, z);
            playerGroup.name = "Jugador"; // Store name for easier access
            
            // Aim indicator — flat cone matching bullet range (10) and spread (±15°)
            var aimShape = new THREE.Shape();
            aimShape.moveTo(0, 0);
            aimShape.lineTo(-2.68, 10); // 10 * tan(15°) is approx 2.68
            aimShape.lineTo(2.68, 10);
            aimShape.lineTo(0, 0);
            var aimGeom = new THREE.ShapeGeometry(aimShape);
            aimGeom.rotateX(Math.PI / 2); // Rotate X to make Y-axis of shape align with Z-axis of world
            var aimMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthTest: false });
            aimIndicator = new THREE.Mesh(aimGeom, aimMat);
            aimIndicator.renderOrder = 999;
            aimIndicator.position.y = 0.15;
            aimIndicator.visible = false;
            playerGroup.add(aimIndicator);

            scene.add(playerGroup);
            updateHPDisplay(playerGroup, MAX_HP, MAX_HP, "Tú");
            updateAmmoDisplay(playerGroup, MAX_AMMO, MAX_AMMO, 0, true);
        }

        window.addEventListener('mousemove', (e) => {
            mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        });

        function playerShoot(direction) {
            if (!isPlaying || playerHP <= 0 || introSequenceActive) return;

            if (playerAmmo < 1) {
                SoundEngine.play('empty');
                screenShake = 0.2; 
                const ammoUI = playerGroup.getObjectByName('ammoDisplay');
                if (ammoUI) {
                    const targetX = 0; 
                    const startTime = Date.now();
                    const shake = () => {
                        const elapsed = Date.now() - startTime;
                        if (elapsed < 200) {
                            ammoUI.position.x = targetX + (Math.sin(elapsed * 0.1) * 0.15);
                            requestAnimationFrame(shake);
                        } else {
                            ammoUI.position.x = targetX;
                        }
                    };
                    shake();
                }
                return;
            }

            playerLastShot = Date.now();
            playerLastDamageTime = Date.now();
            direction.y = 0;
            direction.normalize();
            
            playerGroup.lookAt(playerGroup.position.clone().add(direction));

            fireSpread(playerGroup.position, direction, 'player', 'Tú');
            SoundEngine.play('shoot', playerGroup.position);

            playerAmmo = Math.max(0, playerAmmo - 1);
            updateAmmoDisplay(playerGroup, playerAmmo, MAX_AMMO, playerRechargeProgress, true);
        }



        // Tarea 14: Sistema de Nombres
        const botNamesMaster = ["Pepitogamer123", "ElProEnTodo", "Caviar12", "Daniel_XX", "JuanXZ", "BrawlerX", "SuperN00b", "NinjaShadow", "GamerPro", "DarkKnight", "SpikeJr", "ColtFan"];
        let currentBotNames = [];

        function addKillEntry(killer, victim) {
            const entry = document.createElement('div');
            entry.className = 'kill-item';
            if (killer === 'Tú' || victim === 'Tú') {
                entry.classList.add('player-action');
            }
            entry.innerHTML = `<span class="killer">${killer}</span> <span style="color:rgba(255,255,255,0.9); font-size: 0.85rem; margin: 0 4px; letter-spacing: 1px; font-weight: 700;">ELIMINÓ A</span> <span class="victim">${victim}</span>`;
            killFeedContainer.appendChild(entry);
            setTimeout(() => { if (entry.parentNode) entry.remove(); }, 4500);
        }

        // Tarea 22/23: Indicador de vida 3D con NÚMERO mediante Sprite
        function updateHPDisplay(characterMesh, hp, maxHp, name = "") {
            let hpGroup = characterMesh.getObjectByName('hpDisplay');
            if (!hpGroup) {
                hpGroup = new THREE.Group();
                hpGroup.name = 'hpDisplay';

                // Fondo rojo (daño)
                const bgGeo = new THREE.PlaneGeometry(2, 0.2);
                // Tarea 11.2: depthTest: false y renderOrder para que siempre se vea arriba
                const bgMat = new THREE.MeshBasicMaterial({ color: 0x440000, depthTest: false, transparent: true });
                const bg = new THREE.Mesh(bgGeo, bgMat);
                bg.name = 'bg';
                bg.renderOrder = 999;
                hpGroup.add(bg);

                // Barra verde (vida)
                const fgGeo = new THREE.PlaneGeometry(2, 0.2);
                const fgMat = new THREE.MeshBasicMaterial({ color: 0x00FF00, depthTest: false, transparent: true });
                const fg = new THREE.Mesh(fgGeo, fgMat);
                fg.name = 'fg';
                fg.position.z = 0.01;
                fg.renderOrder = 1000;
                hpGroup.add(fg);

                // Sprite para el número de vida
                const hpCanvas = document.createElement('canvas');
                hpCanvas.width = 256;
                hpCanvas.height = 64;
                const hpCtx = hpCanvas.getContext('2d');
                const hpTex = new THREE.CanvasTexture(hpCanvas);
                // Tarea 11.2: depthTest: false para sprites
                const hpSpriteMat = new THREE.SpriteMaterial({ map: hpTex, depthTest: false, transparent: true });
                const hpSprite = new THREE.Sprite(hpSpriteMat);
                hpSprite.name = 'hpValueSprite';
                hpSprite.renderOrder = 1001;
                hpSprite.scale.set(2, 0.5, 1);
                hpSprite.position.y = 0.4; // Sobre la barra
                hpGroup.add(hpSprite);

                // Tarea 32: Sprite para el nombre del personaje
                const nameCanvas = document.createElement('canvas');
                nameCanvas.width = 512;
                nameCanvas.height = 64;
                const nameCtx = nameCanvas.getContext('2d');
                const nameTex = new THREE.CanvasTexture(nameCanvas);
                const nameSpriteMat = new THREE.SpriteMaterial({ map: nameTex, depthTest: false, transparent: true });
                const nameSprite = new THREE.Sprite(nameSpriteMat);
                nameSprite.name = 'nameSprite';
                nameSprite.renderOrder = 1002;
                nameSprite.scale.set(4, 0.5, 1);
                nameSprite.position.y = 1.0; // Encima del número de vida
                hpGroup.add(nameSprite);

                hpGroup.position.set(0, 4.2, 0); 
                characterMesh.add(hpGroup);
            }

            // Tarea: Asegurar que el visualGroup sea visible durante el showcase
            const visual = characterMesh.getObjectByName("visualGroup");
            if (visual) visual.visible = true;

            const fg = hpGroup.getObjectByName('fg');
            const pct = Math.max(0, hp / maxHp);
            fg.scale.x = pct;
            fg.position.x = (pct - 1);

            // Actualizar número en el sprite solo si cambia
            const hpSprite = hpGroup.getObjectByName('hpValueSprite');
            if (hpSprite) {
                const roundedHP = Math.round(hp);
                if (hpSprite.userData.lastValue !== roundedHP) {
                    const canvas = hpSprite.material.map.image;
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.fillStyle = 'white';
                    ctx.font = 'bold 40px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText(roundedHP.toString(), 128, 45);
                    hpSprite.material.map.needsUpdate = true;
                    hpSprite.userData.lastValue = roundedHP;
                }
            }

            // Actualizar nombre en el sprite solo si cambia o es la primera vez
            const nameSprite = hpGroup.getObjectByName('nameSprite');
            if (nameSprite && name) {
                if (nameSprite.userData.lastName !== name) {
                    const canvas = nameSprite.material.map.image;
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.fillStyle = '#f0f0f0';
                    ctx.font = 'bold 36px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText(name, 256, 45);
                    nameSprite.material.map.needsUpdate = true;
                    nameSprite.userData.lastName = name;
                }
            }
        }

        // --- ORQUESTACIÓN DE LA INTRO ---
        function runIntroSequence() {
            if (introSequenceActive || isPlaying) return;
            
            introSequenceActive = true;
            isPlaying = false;
            gameOver = false; 
            showdownTriggered = false;
            globalTimeScale = 1.0;
            currentShowcaseTarget = null;
            
            // Conectar al servidor multiplayer cuando inicie el juego
            connectToServer();
            
            // Tarea: Limpiar mundo inmediatamente para evitar ver restos de la partida anterior
            despawnWorld();
            
            // Tarea: Ocultar Rummy del menú durante el juego
            if (menuRenderer && menuRenderer.domElement) {
                menuRenderer.domElement.style.display = 'none';
            }
            
            // 1. Ocultar menús y mostrar matchmaking
            startMenu.style.display = 'none';
            document.getElementById('matchmaking-screen').style.display = 'flex';
            
            // Ocultar botón de ajustes
            const settingsBtnMatch = document.getElementById('settings-btn');
            if (settingsBtnMatch) {
                settingsBtnMatch.style.display = 'none';
                settingsBtnMatch.style.visibility = 'hidden';
            }
            
            // Ocultar botón de tienda
            const shopBtnMatch = document.querySelector('.shop-btn');
            if (shopBtnMatch) {
                shopBtnMatch.style.display = 'none';
            }
            
            // Ocultar botón extra
            const extraBtnMatch = document.querySelector('.extra-btn');
            if (extraBtnMatch) {
                extraBtnMatch.style.display = 'none';
            }
            
            // Ocultar rectángulo inferior
            const bottomRectMatch = document.getElementById('bottom-left-rect');
            if (bottomRectMatch) {
                bottomRectMatch.style.display = 'none';
            }
            
            // Ocultar botón de ajustes del menú
            startMenu.querySelectorAll('button').forEach(btn => {
                if (btn.textContent.includes('AJUSTES') || btn.textContent.includes('⚙️')) {
                    btn.style.display = 'none';
                }
            });
            
            // Ocultar trofeos al iniciar la intro (matchmaking)
            const trophyDisp = document.getElementById('trophy-display');
            if (trophyDisp) trophyDisp.style.display = 'none';
            
            // Ocultar star pieces
            const starPieces = document.getElementById('star-pieces-container');
            if (starPieces) starPieces.style.display = 'none';
            
            simulateMatchmaking(() => {
                // 2 & 3. Mostrar Showcase y Cuenta Regresiva Simultáneamente
                document.getElementById('matchmaking-screen').style.display = 'none';
                showShowcaseAndCountdown(() => {
                        // 4. Iniciar juego
                        // Tarea: Ocultar TODOS los overlays de intro por seguridad
                        document.getElementById('matchmaking-screen').style.display = 'none';
                        document.getElementById('showcase-screen').style.display = 'none';
                        document.getElementById('countdown-overlay-new').style.display = 'none';
                        
                        hidePlacement();
                        if (window.stopMenuMusic) window.stopMenuMusic();
                        // Reset de estado del Jugador
                        playerHP = MAX_HP;
                        playerMaxHP = MAX_HP;
                        playerDamageMultiplier = 1.0;
                        playerAmmo = MAX_AMMO;
                        playerReloading = false;
                        playerRechargeProgress = 0;
                        playerHitTime = 0;
                        playerLastShot = 0;
                        introSequenceActive = false; // Tarea: Desbloquear controles
                        isPlaying = true;
                        gameStartTime = Date.now();
                        
                        // Ocultar canvas de estrellas cuando empieza el juego
                        const menuBgCanvas = document.getElementById('menu-bg-canvas');
                        if (menuBgCanvas) menuBgCanvas.style.display = 'none';
                        
                        // Parar audio del menú
                        if (window.stopMenuAudio) window.stopMenuAudio();
                        lastInputTime = Date.now(); // Tarea: Reiniciar AFK al empezar de verdad
                        
                        // Ocultar elementos del menú al iniciar el juego
                        document.getElementById('settings-btn').style.display = 'none';
                        const trophyDisp = document.getElementById('trophy-display');
                        if (trophyDisp) {
                            trophyDisp.style.display = 'none';
                            trophyDisp.style.visibility = 'hidden';
                        }
                        document.getElementById('star-pieces-container').style.display = 'none';
                        document.getElementById('start-menu').style.display = 'none';
                        document.querySelector('.shop-btn').style.display = 'none';
                        document.querySelector('.extra-btn').style.display = 'none';
                        document.getElementById('bottom-left-rect').style.display = 'none';
                        
                        // Ocultar star drop button durante el juego
                        document.getElementById('star-drop-btn').style.display = 'none';
                        
                        // Activar aura de invulnerabilidad (5 segundos pedirlo por el usuario)
                        invulnerabilityTime = 5.0;
                        createAura(playerGroup);
                        enemies.forEach(e => {
                            e.isInvulnerable = true;
                            createAura(e.mesh);
                        });

                        uiContainer.style.display = 'block';
                        gameStats.style.display = 'block';
                        joystickBase.style.display = 'block';
                        aimBase.style.display = 'block';
                        
                        
                        
                        // Ocultar botón de ajustes durante el juego
                        const settingsBtnInGame = document.getElementById('settings-btn');
                        if (settingsBtnInGame) settingsBtnInGame.style.display = 'none';
                        const trophyDisplay = document.getElementById('trophy-display');
                        if (trophyDisplay) trophyDisplay.style.display = 'none';
                        const starPiecesInGame = document.getElementById('star-pieces-container');
                        if (starPiecesInGame) starPiecesInGame.style.display = 'none';
                        
                        // Tareas de UI ya manejadas en runIntroSequence (ocultar trofeos)
                        if (audioCtx.state === 'suspended') audioCtx.resume();
                        MusicEngine.start();
                        // Activar gas zone después de 60 segundos
                        setTimeout(createGasZone, GAS_START_DELAY * 1000);
                    });
            });
        }

        function simulateMatchmaking(callback) {
            let count = 0;
            const bar = document.getElementById('matchmaking-bar');
            const status = document.getElementById('matchmaking-count');
            
            const interval = setInterval(() => {
                count++;
                status.innerText = `${count} / 10`;
                bar.style.width = `${count * 10}%`;
                
                if (count >= 10) {
                    clearInterval(interval);
                    setTimeout(callback, 500);
                }
            }, 300); // 3 segundos total
        }

        function showShowcaseAndCountdown(callback) {
            const screen = document.getElementById('showcase-screen');
            const grid = document.getElementById('showcase-grid');
            screen.style.display = 'flex';
            
            // Tarea: Forzar visibilidad por si fue ocultado severamente antes
            screen.style.visibility = 'visible';
            screen.style.opacity = '1';
            
            grid.innerHTML = '';
            
            // Re-inicializar mundo (ya despawneado en runIntroSequence)
            buildMap();
            spawnBoxes();
            
            // Spawnear jugadores
            const spawnPoints = getDiverseSpawnPoints(10);
            const pSpawn = spawnPoints[0] || { x: 0, z: 0 };
            spawnPlayerAt(pSpawn.x, pSpawn.z);
            
            // Mezclar nombres y colores para bots
            currentBotNames = [...botNamesMaster].sort(() => Math.random() - 0.5);
            const botColors = [0xFF0000, 0x00FF00, 0x0000FF, 0xFFFF00, 0xFF00FF, 0x00FFFF, 0x888888, 0xFFFFFF, 0x444444];

            for (let i = 1; i < 10; i++) {
                const pt = spawnPoints[i] || { x: (Math.random() - 0.5) * 80, z: (Math.random() - 0.5) * 80 };
                spawnBot(botColors[i - 1], currentBotNames[i - 1], pt);
            }
            updateSurvivorCount();
            
            // Mostrar todos en el grid
            const allParticipants = [
                { name: 'Tú', color: 0x00FF88, mesh: playerGroup },
                ...enemies.map(e => ({ name: e.name, color: 0xFF4444, mesh: e.mesh }))
            ];
            
            allParticipants.forEach((p, i) => {
                const item = document.createElement('div');
                item.className = 'showcase-item';
                const colorStr = '#' + p.color.toString(16).padStart(6, '0');
                item.innerHTML = `
                    <div class="showcase-avatar" style="background-color: ${colorStr};">
                        <div class="face"></div>
                    </div>
                    <div class="showcase-name">${p.name}</div>
                `;
                grid.appendChild(item);
                
                // Aparición progresiva rápida (10 items en 1 segundo total)
                setTimeout(() => {
                    item.classList.add('visible');
                    SoundEngine.play('ui');
                }, i * 100);
            });
            
            // Mantener cámara en el jugador
            currentShowcaseTarget = playerGroup;

            // Iniciar cuenta atrás inmediatamente
            const el = document.getElementById('countdown-overlay-new');
            el.style.display = 'block';
            let count = 5;
            
            const timer = setInterval(() => {
                el.innerText = count > 0 ? count : '¡VAMOS!';
                SoundEngine.play('hit'); // Sonido de tick
                
                if (count < 0) {
                    clearInterval(timer);
                    el.style.display = 'none';
                    callback();
                }
                count--;
            }, 1000);
        }



        // Tarea 23: Indicador de munición (Symmetry & Clarity)
        function updateAmmoDisplay(characterMesh, ammo, maxAmmo, progress = 0, isPlayer = false) {
            if (!isPlayer) return;
            
            let group = characterMesh.getObjectByName('ammoDisplay');
            const spacing = 0.7;
            const totalWidth = (maxAmmo - 1) * spacing;

            if (!group) {
                group = new THREE.Group();
                group.name = 'ammoDisplay';
                const width = 0.6;
                const height = 0.15;

                for (let k = 0; k < maxAmmo; k++) {
                    const bgGeo = new THREE.PlaneGeometry(width, height);
                    const bgMat = new THREE.MeshBasicMaterial({ color: 0x332200, transparent: true, opacity: 0.6, depthTest: false });
                    const rectBg = new THREE.Mesh(bgGeo, bgMat);
                    rectBg.renderOrder = 999;
                    rectBg.position.set((k * spacing) - totalWidth / 2, 0, 0);
                    group.add(rectBg);

                    const fgGeo = new THREE.PlaneGeometry(width, height);
                    const fgMat = new THREE.MeshBasicMaterial({ color: 0xFF9800, depthTest: false, transparent: true });
                    const rectFg = new THREE.Mesh(fgGeo, fgMat);
                    rectFg.name = 'fill_' + k;
                    rectFg.renderOrder = 1000;
                    rectFg.position.set((k * spacing) - totalWidth / 2, 0, 0.01);
                    group.add(rectFg);
                }
                group.position.set(0, 3.1, 0);
                characterMesh.add(group);
            }

            const width = 0.6;
            for (let k = 0; k < maxAmmo; k++) {
                const rectFg = group.getObjectByName('fill_' + k);
                if (rectFg) {
                    let fillPct = 0;
                    if (k < Math.floor(ammo)) fillPct = 1;
                    else if (k === Math.floor(ammo)) fillPct = progress;

                    if (fillPct > 0) {
                        rectFg.visible = true;
                        rectFg.scale.x = fillPct;
                        // Tarea 14.1: Carga desde la izquierda (ajustar posición x segun el escalado)
                        const baseX = (k * spacing) - totalWidth / 2;
                        rectFg.position.x = baseX - (width / 2 * (1 - fillPct));
                    } else {
                        rectFg.visible = false;
                    }
                }
            }
        }

        function updateSurvivorCount() {
            const total = enemies.filter(e => !e.dead).length + (isPlaying ? 1 : 0);
            brawlersLeftDisplay.innerText = `${total} Skrills restantes`;

            // Animación de pulso
            brawlersLeftDisplay.classList.remove('pulse');
            void brawlersLeftDisplay.offsetWidth; // Force reflow
            brawlersLeftDisplay.classList.add('pulse');
            setTimeout(() => brawlersLeftDisplay.classList.remove('pulse'), 300);
        }
        const startMenu = document.getElementById('start-menu');
        const startBtn = document.getElementById('start-btn');
        const returnMenuBtn = document.getElementById('return-menu-btn');

        startBtn.addEventListener('click', () => {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            SoundEngine.play('ui');
            runIntroSequence();
            
            document.getElementById('afk-warning').style.display = 'none';
            document.getElementById('afk-error').style.display = 'none';
        });

        // Event listener for the new return button
        if (returnMenuBtn) {
            returnMenuBtn.addEventListener('click', () => {
                SoundEngine.play('ui');
                location.reload();
            });
        }

        // Loss return button
        const lossReturnBtn = document.getElementById('loss-return-btn');
        if (lossReturnBtn) {
            lossReturnBtn.addEventListener('click', () => {
                if (window.MusicEngine) MusicEngine.stop();
                
                if (window.lossRenderer) {
                    window.lossRenderer.domElement.remove();
                    window.lossRenderer = null;
                }
                
                if (window.goToMainMenu) window.goToMainMenu();
                if (window.initMenu3D) window.initMenu3D();
                
                // Mostrar star drop button al volver al menú
                document.getElementById('star-drop-btn').style.display = 'block';
                if (window.playMenuMusic) window.playMenuMusic();
            });
        }

        document.getElementById('afk-return-btn').addEventListener('click', () => {
            despawnWorld();
            document.getElementById('afk-error').style.display = 'none';
            startMenu.style.display = 'flex';
            document.getElementById('trophy-display').style.display = 'flex';
            document.getElementById('star-pieces-container').style.display = 'flex';
            
            // Tarea: Mostrar Rummy del menú al volver de AFK
            if (menuRenderer && menuRenderer.domElement) {
                menuRenderer.domElement.style.display = 'block';
            }
            
            const header = document.querySelector('#start-menu h1');
            header.innerText = "";
            header.style.display = 'none';
            startBtn.style.display = 'block';
            if (returnMenuBtn) returnMenuBtn.style.display = 'none';
            
            // Mostrar star drop button al volver al menú
            document.getElementById('star-drop-btn').style.display = 'block';
            if (window.playMenuMusic) window.playMenuMusic();
        });

        function findSafeSpawn() {
            let attempts = 0;
            while (attempts < 50) {
                const x = (Math.random() - 0.5) * 80;
                const z = (Math.random() - 0.5) * 80;
                const r = 1.0;
                const box = new THREE.Box3(
                    new THREE.Vector3(x - r, 0, z - r),
                    new THREE.Vector3(x + r, 2, z + r)
                );
                let collision = false;
                for (let w of walls) {
                    if (w.box.intersectsBox(box)) {
                        collision = true;
                        break;
                    }
                }
                // También verificar colisión con cajas
                for (let b of boxes) {
                    if (b.box.intersectsBox(box)) {
                        collision = true;
                        break;
                    }
                }
                if (!collision) return { x, z };
                attempts++;
            }
            return { x: 0, z: 0 };
        }

        // Tarea 35: Algoritmo Greedy Max-Min para puntos alejados
        function getDiverseSpawnPoints(count) {
            const candidates = [];
            for (let i = 0; i < 60; i++) {
                candidates.push(findSafeSpawn());
            }

            const selected = [];
            // Primer punto aleatorio
            selected.push(candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0]);

            while (selected.length < count && candidates.length > 0) {
                let bestCandIdx = -1;
                let maxMinDist = -1;

                for (let i = 0; i < candidates.length; i++) {
                    const cand = candidates[i];
                    let minDistToSelected = Infinity;
                    for (const s of selected) {
                        const d = Math.sqrt((cand.x - s.x) ** 2 + (cand.z - s.z) ** 2);
                        if (d < minDistToSelected) minDistToSelected = d;
                    }

                    if (minDistToSelected > maxMinDist) {
                        maxMinDist = minDistToSelected;
                        bestCandIdx = i;
                    }
                }
                selected.push(candidates.splice(bestCandIdx, 1)[0]);
            }
            return selected;
        }

        function spawnBot(color, name, pos) {
            const group = createDetailedBrawler(color);
            group.position.set(pos.x, 0, pos.z);
            scene.add(group);

            // Tarea 13.3: Paridad de HP (Se eliminan los multiplicadores de vida por clase)
            const classes = ['BALANCED', 'TANK', 'SNIPER', 'BERSERKER'];
            const botClass = classes[Math.floor(Math.random() * classes.length)];
            let hpMult = 1.0, speedMult = 1.0, rangeOffset = 0, aggro = 0.5;
            let visualScale = 1.0; 

            if (botClass === 'TANK') {
                hpMult = 1.0; speedMult = 0.8; rangeOffset = -2; aggro = 0.8;
            } else if (botClass === 'SNIPER') {
                hpMult = 1.0; speedMult = 1.1; rangeOffset = 4; aggro = 0.3;
            } else if (botClass === 'BERSERKER') {
                hpMult = 1.0; speedMult = 1.2; rangeOffset = -4; aggro = 1.0;
            }

            group.scale.set(1, 1, 1);

            const enemyObj = {
                mesh: group,
                hp: MAX_HP * hpMult,
                maxHP: MAX_HP * hpMult,
                dead: false,
                name: name,
                class: botClass,
                state: 'PATROL',
                patrolPoint: new THREE.Vector3((Math.random() - 0.5) * 80, 0, (Math.random() - 0.5) * 80),
                lastDecision: Date.now(),
                speed: (4.5 + Math.random() * 0.5), // Tarea 8.4: Velocidad normalizada
                ammo: MAX_AMMO,
                lastShot: 0,
                rechargeProgress: 0,
                attackRange: (10 + Math.random() * 4) + rangeOffset,
                aggression: aggro,
                lastDamageTime: 0,
                lastRegenBurstTime: 0,
                damageMultiplier: 1.0,
                stuckTimer: 0,
                hitTime: 0,
                originalPos: group.position.clone(),
                lastPos: new THREE.Vector3()
            };
            enemies.push(enemyObj);
            updateHPDisplay(group, enemyObj.hp, enemyObj.maxHP, name);
            updateAmmoDisplay(group, MAX_AMMO, MAX_AMMO, 0, false);
        }

        function moveCharacter(ent, direction, dist) {
            const nextX = ent.mesh.position.x + direction.x * dist;
            const nextZ = ent.mesh.position.z + direction.z * dist;

            const r = 0.7;
            const boxX = new THREE.Box3(
                new THREE.Vector3(nextX - r, 0, ent.mesh.position.z - r),
                new THREE.Vector3(nextX + r, 2, ent.mesh.position.z + r)
            );
            const boxZ = new THREE.Box3(
                new THREE.Vector3(ent.mesh.position.x - r, 0, nextZ - r),
                new THREE.Vector3(ent.mesh.position.x + r, 2, nextZ + r)
            );

            let colX = false;
            let colZ = false;
            for (let w of walls) {
                if (w.box.intersectsBox(boxX)) colX = true;
                if (w.box.intersectsBox(boxZ)) colZ = true;
            }
            // También verificar colisión con cajas
            for (let b of boxes) {
                if (b.box.intersectsBox(boxX)) colX = true;
                if (b.box.intersectsBox(boxZ)) colZ = true;
            }
            
            // Verificar colisión con agua
            if (window.waterBoxes) {
                for (let w of window.waterBoxes) {
                    const distX = nextX - w.x;
                    const distZ = ent.mesh.position.z - w.z;
                    if (Math.sqrt(distX*distX + distZ*distZ) < w.radius + 0.5) colX = true;
                    
                    const distX2 = ent.mesh.position.x - w.x;
                    const distZ2 = nextZ - w.z;
                    if (Math.sqrt(distX2*distX2 + distZ2*distZ2) < w.radius + 0.5) colZ = true;
                }
            }

            const limit = (mapSize / 2) - 1.5;

            // Tarea 36: Mejora de colisión con "despegue" (rebote ligero)
            if (!colX) {
                ent.mesh.position.x = Math.max(-limit, Math.min(limit, nextX));
            } else {
                // Retroceder un poco para no quedar pegado (Tarea 8.5: Mejora navegación)
                ent.mesh.position.x -= direction.x * 0.05;
            }

            if (!colZ) {
                ent.mesh.position.z = Math.max(-limit, Math.min(limit, nextZ));
            } else {
                ent.mesh.position.z -= direction.z * 0.05;
            }

            // Tarea FIX FUSION: Colisión entre brawlers (Optimized)
            for (let j = 0; j < enemies.length; j++) {
                const other = enemies[j];
                if (other.dead || other.mesh === ent.mesh) continue;
                
                const distSq = ent.mesh.position.distanceToSquared(other.mesh.position);
                if (distSq < 1.44) { // 1.2 * 1.2 = 1.44
                    const d = Math.sqrt(distSq);
                    _v1.subVectors(ent.mesh.position, other.mesh.position).normalize();
                    const force = (1.2 - d) * 0.3;
                    ent.mesh.position.x = Math.max(-limit, Math.min(limit, ent.mesh.position.x + _v1.x * force));
                    ent.mesh.position.z = Math.max(-limit, Math.min(limit, ent.mesh.position.z + _v1.z * force));
                }
            }
            if (playerGroup && ent.mesh !== playerGroup) {
                const distSq = ent.mesh.position.distanceToSquared(playerGroup.position);
                if (distSq < 1.44) {
                    const d = Math.sqrt(distSq);
                    _v1.subVectors(ent.mesh.position, playerGroup.position).normalize();
                    const force = (1.2 - d) * 0.3;
                    ent.mesh.position.x = Math.max(-limit, Math.min(limit, ent.mesh.position.x + _v1.x * force));
                    ent.mesh.position.z = Math.max(-limit, Math.min(limit, ent.mesh.position.z + _v1.z * force));
                }
            }
        }

        function despawnWorld() {
            isPlaying = false;
            if (playerGroup) { scene.remove(playerGroup); playerGroup = null; }
            if (ground) { scene.remove(ground); ground = null; }
            walls.forEach(w => { scene.remove(w.mesh); }); walls.length = 0;
            grassBlocks.forEach(g => { scene.remove(g.mesh); }); grassBlocks.length = 0;
            boxes.forEach(b => { scene.remove(b.mesh); }); boxes.length = 0; // Limpiar cajas
            powerCubes.forEach(c => { scene.remove(c.mesh); }); powerCubes.length = 0; // Limpiar cubos
            enemies.forEach(e => { scene.remove(e.mesh); }); enemies.length = 0;
            bullets.forEach(b => { scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); });
            bullets.length = 0;
            // Limpiar gas zone
            removeGasZone();
        }

        // =====================================================
        // GAS ZONE SYSTEM - Zona de Gas (Estilo Battle Royale)
        // =====================================================
        let gasZone = null;           // Malla del anillo de gas (afuera)
        let gasGroundOverlay = null;  // Suelo verde en la zona de gas
        let gasZoneActive = false;
        let gasZoneRadius = mapSize / 2 - 5; // Radio actual de la zona segura
        const GAS_START_DELAY = 60;   // Segundos antes de empezar a cerrar
        const GAS_SHRINK_RATE = 0.6;  // Unidades por segundo que se cierra
        const GAS_MIN_RADIUS = 8;     // Radio mínimo (nunca cierra completamente)
        const GAS_DAMAGE_INTERVAL = 1500; // Daño cada 1.5s
        const GAS_DAMAGE_PER_HIT = 150;
        let gasLastDamageTime = 0;
        let gasZoneWarningShown = false;

        // Canvas-based animated gas texture
        function createGasTexture() {
            const size = 256;
            const canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;
            const ctx = canvas.getContext('2d');
            const tex = new THREE.CanvasTexture(canvas);
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(4, 4);

            let frame = 0;
            function draw() {
                ctx.clearRect(0, 0, size, size);
                frame += 0.03;
                // Layer 1: Base verde oscuro
                const g1 = ctx.createRadialGradient(
                    size * (0.4 + 0.2 * Math.sin(frame)),
                    size * (0.4 + 0.2 * Math.cos(frame * 0.7)),
                    0,
                    size / 2, size / 2, size * 0.7
                );
                g1.addColorStop(0, 'rgba(0, 200, 50, 0.55)');
                g1.addColorStop(0.4, 'rgba(10, 80, 20, 0.4)');
                g1.addColorStop(1, 'rgba(0, 30, 10, 0.1)');
                ctx.fillStyle = g1;
                ctx.fillRect(0, 0, size, size);

                // Layer 2: Morado
                const g2 = ctx.createRadialGradient(
                    size * (0.55 + 0.25 * Math.cos(frame * 1.1)),
                    size * (0.55 + 0.25 * Math.sin(frame * 0.9)),
                    0,
                    size / 2, size / 2, size * 0.5
                );
                g2.addColorStop(0, 'rgba(100, 0, 200, 0.3)');
                g2.addColorStop(0.5, 'rgba(50, 0, 80, 0.2)');
                g2.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = g2;
                ctx.fillRect(0, 0, size, size);

                // Layer 3: Venas de gas (líneas curvas)
                for (let i = 0; i < 5; i++) {
                    const x1 = size * (Math.sin(frame + i * 1.2) * 0.4 + 0.5);
                    const y1 = size * (Math.cos(frame * 0.8 + i * 0.9) * 0.4 + 0.5);
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.quadraticCurveTo(
                        size * Math.random(), size * Math.random(), x1 + 40, y1 + 40
                    );
                    ctx.strokeStyle = `rgba(0, 255, 80, ${0.05 + 0.08 * Math.abs(Math.sin(frame + i))})`;
                    ctx.lineWidth = 2 + Math.sin(frame * 2 + i) * 1.5;
                    ctx.stroke();
                }

                tex.needsUpdate = true;
            }

            // Animate the texture continuously
            function animTex() {
                if (gasZoneActive) {
                    draw();
                    requestAnimationFrame(animTex);
                }
            }
            animTex();
            return tex;
        }

        function createGasZone() {
            if (gasZone) return;
            gasZoneActive = true;
            gasZoneRadius = mapSize / 2 - 5;

            const gasTex = createGasTexture();
            // 1. Cilindro lateral (efecto pared)
            const gasGeo = new THREE.CylinderGeometry(
                mapSize, mapSize, 30, 64, 1, true
            );
            const gasMat = new THREE.MeshBasicMaterial({
                map: gasTex,
                transparent: true,
                opacity: 0.65,
                side: THREE.BackSide,
                depthWrite: false
            });
            gasZone = new THREE.Mesh(gasGeo, gasMat);
            gasZone.position.set(0, 5, 0);
            scene.add(gasZone);

            // 2. Sobre-suelo verde (efecto suelo contaminado)
            if (gasGroundOverlay) scene.remove(gasGroundOverlay);
            const planeGeo = new THREE.PlaneGeometry(mapSize * 2, mapSize * 2);
            const planeMat = new THREE.MeshBasicMaterial({
                color: 0x004414,
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            // Usaremos un shader simple para hacer el hueco circular
            planeMat.onBeforeCompile = (shader) => {
                shader.uniforms.uInnerRadius = { value: gasZoneRadius };
                shader.fragmentShader = `
                    uniform float uInnerRadius;
                    ${shader.fragmentShader}
                `.replace(
                    '#include <map_fragment>',
                    `
                    #include <map_fragment>
                    float dist = distance(vUv, vec2(0.5));
                    if (dist < (uInnerRadius / ${mapSize * 2.0})) discard;
                    `
                );
                planeMat.userData.shader = shader;
            };
            gasGroundOverlay = new THREE.Mesh(planeGeo, planeMat);
            gasGroundOverlay.rotation.x = -Math.PI / 2;
            gasGroundOverlay.position.y = 0.05;
            scene.add(gasGroundOverlay);

            // Show warning overlay in HUD
            showGasZoneHUD(true);
        }

        function removeGasZone() {
            if (gasZone) {
                scene.remove(gasZone);
                gasZone.geometry.dispose();
                gasZone.material.map && gasZone.material.map.dispose();
                gasZone.material.dispose();
                gasZone = null;
            }
            if (gasGroundOverlay) {
                scene.remove(gasGroundOverlay);
                gasGroundOverlay.geometry.dispose();
                gasGroundOverlay.material.dispose();
                gasGroundOverlay = null;
            }
            gasZoneActive = false;
            gasZoneRadius = mapSize / 2 - 5;
            gasZoneWarningShown = false;
            showGasZoneHUD(false);
        }

        function showGasZoneHUD(visible) {
            // Eliminado por petición del usuario: ocultar avisos de gas
            let hud = document.getElementById('gas-zone-hud');
            if (hud) hud.style.display = 'none';
        }

        function updateGasZone(delta, now) {
            if (!gasZoneActive || !gasZone) return;

            // Shrink safe zone
            if (gasZoneRadius > GAS_MIN_RADIUS) {
                gasZoneRadius -= GAS_SHRINK_RATE * delta;
                if (gasZoneRadius < GAS_MIN_RADIUS) gasZoneRadius = GAS_MIN_RADIUS;
            }

            // Resize the "hole" by scaling the inner ring
            const scale = gasZoneRadius / (mapSize / 2);
            gasZone.scale.set(scale, 1, scale);

            // Update ground ring overlay
            if (gasGroundOverlay && gasGroundOverlay.material.userData.shader) {
                gasGroundOverlay.material.userData.shader.uniforms.uInnerRadius.value = gasZoneRadius;
            }

            // Rotate texture for swirl effect
            if (gasZone.material.map) {
                gasZone.material.map.offset.x += 0.0015;
                gasZone.material.map.offset.y += 0.001;
            }

            // Damage players outside safe zone
            if (now - gasLastDamageTime > GAS_DAMAGE_INTERVAL) {
                gasLastDamageTime = now;

                // Damage player
                if (playerGroup && playerHP > 0 && invulnerabilityTime <= 0) {
                    const dist = Math.sqrt(playerGroup.position.x ** 2 + playerGroup.position.z ** 2);
                    if (dist > gasZoneRadius) {
                        playerHP -= GAS_DAMAGE_PER_HIT;
                        if (playerHP < 0) playerHP = 0;
                        updateHPDisplay(playerGroup, playerHP, playerMaxHP, 'Tú');
                        // Screen flash green-tinted
                        screenShake = 0.3;
                        // Eliminado aviso de "Estás en el gas" por petición del usuario
                    }
                }

                // Damage bots outside safe zone
                enemies.forEach(e => {
                    if (e.dead || e.isInvulnerable) return;
                    const dist = Math.sqrt(e.mesh.position.x ** 2 + e.mesh.position.z ** 2);
                    if (dist > gasZoneRadius) {
                        e.hp -= GAS_DAMAGE_PER_HIT;
                    }
                });
            }
        }


        // 8. Bucle del Juego (Update y Render)
        const clock = new THREE.Clock(); // Para controlar el movimiento independiente de FPS

        let showdownTriggered = false;
        let gameStartTime = 0; // Declarar gameStartTime aquí

        function animate() {
            requestAnimationFrame(animate);
            if (gameOver) return;

            const now = Date.now();
            let delta = Math.min(0.05, clock.getDelta());
            
            // Ocultar elementos del menú durante el juego
            if (isPlaying) {
                // Ocultar botón de ajustes flotante
                const settingsBtn = document.getElementById('settings-btn');
                if (settingsBtn) {
                    settingsBtn.style.display = 'none';
                    settingsBtn.style.visibility = 'hidden';
                }
                
                // Ocultar botón de ajustes dentro del menú
                document.querySelectorAll('#start-menu button').forEach(btn => {
                    if (btn.textContent.includes('AJUSTES') || btn.textContent.includes('⚙️')) {
                        btn.style.display = 'none';
                    }
                });
                
                const trophyDisplay = document.getElementById('trophy-display');
                if (trophyDisplay) trophyDisplay.style.display = 'none';
                const starPieces = document.getElementById('star-pieces-container');
                if (starPieces) starPieces.style.display = 'none';
                const startMenu = document.getElementById('start-menu');
                if (startMenu) startMenu.style.display = 'none';
            }
            
            // Declarar moveX y moveZ aquí para evitar ReferenceError fuera del bloque isPlaying
            let moveX = 0;
            let moveZ = 0;
            
            // Aplicar TimeScale Global (Showdown / Efectos)
            delta *= globalTimeScale;

            // Reducir sacudida de pantalla
            if (screenShake > 0) {
                screenShake -= delta * 2;
                if (screenShake < 0) screenShake = 0;
            }

            updateTeardrops(delta);

            // Gas Zone update (activo durante el juego)
            if (isPlaying && gasZoneActive) updateGasZone(delta, now);

            if (isPlaying) {
                // --- LÓGICA DE SHOWDOWN (SOLO SI EL JUEGO ESTÁ ACTIVO) ---
                // --- LÓGICA DE SHOWDOWN (Optimized) ---
                let aliveCount = (playerHP > 0 ? 1 : 0);
                for (let j = 0; j < enemies.length; j++) if (!enemies[j].dead) aliveCount++;
                
                if (aliveCount === 2 && !showdownTriggered) {
                    showdownTriggered = true;
                    const overlay = document.getElementById('showdown-overlay');
                    if (overlay) {
                        overlay.classList.add('active');
                        SoundEngine.play('showdown');

                        
                        // Tarea 41: Efecto Slow-Mo Cinematográfico
                        globalTimeScale = 0.3;
                        let tsInterval = setInterval(() => {
                            globalTimeScale += 0.05;
                            if (globalTimeScale >= 1.0) {
                                globalTimeScale = 1.0;
                                clearInterval(tsInterval);
                            }
                        }, 100);

                        MusicEngine.intensity = 1.6; // Más fuerte
                        // Tarea 9.2: Quitar showdown más rápido (1.5s)
                        setTimeout(() => overlay.classList.remove('active'), 1500);
                    }
                }
            
            // Tarea 31: Sistema AFK
            if (isPlaying) {
                const idleTime = now - lastInputTime;
                if (idleTime > 20000) {
                    document.getElementById('afk-error').style.display = 'flex';
                    document.getElementById('afk-warning').style.display = 'none';
                    isPlaying = false;
                } else if (idleTime > 7000) {
                    document.getElementById('afk-warning').style.display = 'flex';
                } else {
                    document.getElementById('afk-warning').style.display = 'none';
                }
            }
            if (isPlaying && playerHP > 0) {
                if (now - playerLastDamageTime > REGEN_DELAY) {
                    playerHP = Math.min(playerMaxHP, playerHP + playerMaxHP * REGEN_PERCENT * (delta / 1000));
                    updateHPDisplay(playerGroup, playerHP, playerMaxHP, "Tú");
                }

                if (playerAmmo < MAX_AMMO) {
                    playerRechargeProgress += delta * (1000 / RECHARGE_TIME);
                    if (playerRechargeProgress >= 1) {
                        playerAmmo = Math.min(MAX_AMMO, playerAmmo + 1);
                        playerRechargeProgress = 0;
                        SoundEngine.play('recharge', playerGroup.position);
                    }
                } else {
                    playerRechargeProgress = 0;
                }
                updateAmmoDisplay(playerGroup, playerAmmo, MAX_AMMO, playerRechargeProgress, true);
            }

            for (const e of enemies) {
                if (e.dead) continue;

                if (now - e.lastDamageTime > REGEN_DELAY) {
                    e.hp = Math.min(e.maxHP, e.hp + e.maxHP * REGEN_PERCENT * (delta / 1000));
                    updateHPDisplay(e.mesh, e.hp, e.maxHP, e.name);
                }

                // Tarea 31: Detección de bots atascados
                const distToLast = e.mesh.position.distanceTo(e.lastPos);
                if (distToLast < 0.1 && (e.state === 'PATROL' || e.state === 'CHASE')) {
                    e.stuckTimer += delta;
                    if (e.stuckTimer > 0.6) {
                        // Tarea 36/45: Detector de atascamiento más agresivo (0.6s)
                        // Nudge reactivo: Elegir dirección opuesta a la actual o aleatoria
                        const randomEscape = new THREE.Vector3((Math.random() - 0.5) * 40, 0, (Math.random() - 0.5) * 40);
                        e.patrolPoint.add(randomEscape);
                        e.stuckTimer = 0;
                    }
                } else {
                    e.stuckTimer = 0;
                }
                e.lastPos.copy(e.mesh.position);

                if (e.ammo < MAX_AMMO) {
                    e.rechargeProgress = (e.rechargeProgress || 0) + delta * (1000 / RECHARGE_TIME);
                    if (e.rechargeProgress >= 1) {
                        e.ammo = Math.min(MAX_AMMO, e.ammo + 1);
                        e.rechargeProgress = 0;
                    }
                } else {
                    e.rechargeProgress = 0;
                }
                updateAmmoDisplay(e.mesh, e.ammo, MAX_AMMO, e.rechargeProgress, false);
            }


            if (isPlaying && !introSequenceActive) {
                const distanceToMove = moveSpeed * delta;

                if (keys.w) moveZ -= 1;
                if (keys.s) moveZ += 1;
                if (keys.a) moveX -= 1;
                if (keys.d) moveX += 1;

                if (moveX !== 0 && moveZ !== 0) {
                    const factor = Math.sqrt(0.5);
                    moveX *= factor;
                    moveZ *= factor;
                }

                let nextX = playerGroup.position.x + moveX * distanceToMove;
                let nextZ = playerGroup.position.z + moveZ * distanceToMove;

                // Colisiones con paredes para el jugador
                const playerRadius = 0.7;
                const nextPlayerBoxX = new THREE.Box3(
                    new THREE.Vector3(nextX - playerRadius, 0, playerGroup.position.z - playerRadius),
                    new THREE.Vector3(nextX + playerRadius, 2, playerGroup.position.z + playerRadius)
                );
                const nextPlayerBoxZ = new THREE.Box3(
                    new THREE.Vector3(playerGroup.position.x - playerRadius, 0, nextZ - playerRadius),
                    new THREE.Vector3(playerGroup.position.x + playerRadius, 2, nextZ + playerRadius)
                );

                let collisionX = false;
                let collisionZ = false;

                for (let w of walls) {
                    if (!collisionX && w.box.intersectsBox(nextPlayerBoxX)) collisionX = true;
                    if (!collisionZ && w.box.intersectsBox(nextPlayerBoxZ)) collisionZ = true;
                }
                // Colisión con cajas
                for (let b of boxes) {
                    if (!collisionX && b.box.intersectsBox(nextPlayerBoxX)) collisionX = true;
                    if (!collisionZ && b.box.intersectsBox(nextPlayerBoxZ)) collisionZ = true;
                }
                
                // Colisión con agua (estanques)
                if (window.waterBoxes) {
                    for (let w of window.waterBoxes) {
                        const distX = nextX - w.x;
                        const distZ = nextZ - w.z;
                        const dist = Math.sqrt(distX * distX + distZ * distZ);
                        if (dist < w.radius + 0.5) {
                            collisionX = true;
                            collisionZ = true;
                        }
                    }
                }

                if (!collisionX) playerGroup.position.x = nextX;
                if (!collisionZ) playerGroup.position.z = nextZ;

                // Limitar al jugador dentro del mapa
                const pLimit = (mapSize / 2) - 1;
                playerGroup.position.x = Math.max(-pLimit, Math.min(pLimit, playerGroup.position.x));
                playerGroup.position.z = Math.max(-pLimit, Math.min(pLimit, playerGroup.position.z));

                // Enviar posición al servidor
                if (isOnline && ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'move', x: playerGroup.position.x, y: playerGroup.position.z }));
                }

                // 🔥 FIREBASE: Actualizar posición
                if (firebaseMyRef) {
                    updateMyFirebasePosition();
                }

                // Mouse-aiming for PC (only if not using joysticks)
                if (typeof isJActive !== 'undefined' && !isJActive && !isAimActive) {
                    raycaster.setFromCamera(mouse, camera);
                    var fP = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
                    var interV = new THREE.Vector3();
                    if (raycaster.ray.intersectPlane(fP, interV)) {
                        var dV = new THREE.Vector3().subVectors(interV, playerGroup.position);
                        dV.y = 0;
                        if (dV.length() > 0.1) {
                            dV.normalize();
                            if (isPlaying && !introSequenceActive && Date.now() - playerLastShot > 400) {
                                playerGroup.lookAt(playerGroup.position.clone().add(dV));
                                aimDir.copy(dV);
                                if (typeof aimIndicator !== 'undefined' && aimIndicator) aimIndicator.visible = false;
                            }
                        }
                    }
                }



                for (let i = bullets.length - 1; i >= 0; i--) {
                    const bullet = bullets[i];

                    let removeBullet = false;

                    // Tarea 20: Distancia recorrida exacta de 3 metros
                    const step = bulletSpeed * delta;
                    bullet.traveled = (bullet.traveled || 0) + step;

                    if (bullet.traveled >= bulletRange) {
                        removeBullet = true;
                    } else {
                        bullet.mesh.position.addScaledVector(bullet.dir, step);

                        // Colisión con CAJAS (Tarea 37) - OPTIMIZADO con Distancia
                        for (let bIdx = boxes.length - 1; bIdx >= 0; bIdx--) {
                            const b = boxes[bIdx];
                            const distToBox = bullet.mesh.position.distanceTo(b.mesh.position);
                            if (distToBox < 1.5) { // Radio de colisión simple para caja
                                b.hp -= (bullet.damage || 200);
                                updateHPDisplay(b.mesh, b.hp, b.maxHp, "Caja");

                                b.mesh.material.emissive.setHex(0xff0000);
                                b.mesh.material.emissiveIntensity = 1.0;
                                b.hitTime = Date.now();

                                SoundEngine.play('hit', b.mesh.position);
                                removeBullet = true;

                                if (b.hp <= 0) {
                                    spawnPowerCube(b.mesh.position.clone());
                                    SoundEngine.play('powerup', b.mesh.position);

                                    scene.remove(b.mesh);
                                    boxes.splice(bIdx, 1);
                                }
                                break;
                            }
                        }

                        if (removeBullet) { // Si la bala colisionó con una caja, no seguir procesando
                            returnBulletToPool(bullet.mesh);
                            bullets.splice(i, 1);
                            continue; // Pasar a la siguiente bala
                        }

                        // Colisión con paredes
                        const bulletBox = new THREE.Box3().setFromObject(bullet.mesh);
                        for (let w of walls) {
                            if (w.box.intersectsBox(bulletBox)) {
                                // Super bullets destroy walls
                                if (bullet.isSuper) {
                                    w.hp -= bullet.damage;
                                    if (w.hp <= 0) {
                                        scene.remove(w.mesh);
                                        const idx = walls.indexOf(w);
                                        if (idx > -1) walls.splice(idx, 1);
                                    }
                                }
                                removeBullet = true;
                                break;
                            }
                        }
                    }

                    if (removeBullet) {
                        returnBulletToPool(bullet.mesh);
                        bullets.splice(i, 1);
                    }
                }

                // 8.1. Lógica de Sigilo y Visibilidad (Tarea FIX STEALTH)
                let inGrass = false;
                _box.setFromCenterAndSize(playerGroup.position, _v1.set(1, 1, 1));
                for (let j = 0; j < grassBlocks.length; j++) {
                    if (grassBlocks[j].box.intersectsBox(_box)) {
                        inGrass = true;
                        break;
                    }
                }

                // Tarea 9.4: Revelarse si dispara (0.7s - Más dinámico)
                const shootingReveal = (Date.now() - playerLastShot < 700);

                // Tarea 9.4: Revelación por proximidad mutua (Radio reducido a 2.5m -> 6.25 sq)
                let nearEnemy = false;
                for (let j = 0; j < enemies.length; j++) {
                    const e = enemies[j];
                    if (e.dead) continue;
                    if (playerGroup.position.distanceToSquared(e.mesh.position) < 6.25) {
                        nearEnemy = true;
                        break;
                    }
                }

                playerVisible = !inGrass || shootingReveal || nearEnemy;

                // Visibilidad del jugador: usar visible en el visualGroup en lugar
                // de modificar materiales compartidos (evita el bug de "conos de colores")
                const playerVisualGroup = playerGroup.getObjectByName('visualGroup');
                if (playerVisualGroup) {
                    // Jugador siempre se ve a sí mismo pero semitransparente si está oculto
                    playerVisualGroup.children.forEach(c => {
                        if (c.material && c.material.transparent !== undefined) {
                            if (!c.userData.opacityOwned) {
                                c.material = c.material.clone();
                                c.material.transparent = true;
                                c.userData.opacityOwned = true;
                            }
                            c.material.opacity = playerVisible ? 1.0 : 0.35;
                        }
                    });
                }
            }
            for (let i = enemies.length - 1; i >= 0; i--) {
                    const enemy = enemies[i];
                    if (enemy.dead) continue; // Saltar bots muertos pendientes de splice

                    // --- IA DE DECISIONES CON EVITACIÓN DE GAS ---
                    if (isPlaying && !introSequenceActive) {
                        let bestTarget = null;
                    let bestScore = -Infinity;

                    // PRIORIDAD CRÍTICA: Evitar el Gas si estamos fuera de la zona segura
                    _v1.copy(enemy.mesh.position);
                    const distToCenterSq = _v1.x*_v1.x + _v1.z*_v1.z;
                    const inGas = gasZoneActive && (distToCenterSq > gasZoneRadius * gasZoneRadius);

                    if (inGas) {
                        // Forzar movimiento al centro (0,0,0)
                        enemy.state = 'PATROL';
                        enemy.patrolPoint.set(0, 0, 0);
                        // Desactivar target temporalmente para huir del gas
                        bestTarget = null; 
                    } else { // Fin del else para inGas
                        // 1. Evaluar Jugador como objetivo
                    _v1.copy(playerGroup.position);
                    let distSq = enemy.mesh.position.distanceToSquared(_v1);
                    if (distSq < 900) { // 30m radio
                        // FIX FPS: Cachear LoS contra el jugador, recalcular solo cada 150ms
                        if (!enemy.loSPlayerTime || (now - enemy.loSPlayerTime) > 150) {
                            _v2.copy(enemy.mesh.position).setY(1);
                            _v3.copy(playerGroup.position).setY(1);
                            _dirTemp.subVectors(_v3, _v2).normalize();
                            _raycaster.set(_v2, _dirTemp);
                            _raycaster.far = Math.sqrt(distSq);
                            
                            enemy.loSPlayer = true;
                            for (let w of walls) {
                                if (_raycaster.intersectObject(w.mesh).length > 0) {
                                    enemy.loSPlayer = false;
                                    break;
                                }
                            }
                            enemy.loSPlayerTime = now;
                        }

                        if (enemy.loSPlayer && (playerVisible || distSq < 6.25)) {
                            let score = (30 - Math.sqrt(distSq));
                            if (enemy.lastAttacker === 'Tú') score += 15;
                            if (enemy.target && enemy.target.name === 'Tú') score += 5;
                            bestScore = score;
                            bestTarget = { mesh: playerGroup, name: 'Tú', isPlayer: true };
                        }
                    }

                    // 2. Evaluar otros Bots (LoS cacheado por par)
                    for (let j = 0; j < enemies.length; j++) {
                        const other = enemies[j];
                        if (other === enemy || other.dead) continue;
                        
                        distSq = enemy.mesh.position.distanceToSquared(other.mesh.position);
                        if (distSq < 900) {
                            // FIX FPS: Cachear LoS entre bots, recalcular solo cada 200ms
                            const loSKey = `los_${j}`;
                            if (!enemy[loSKey + '_time'] || (now - enemy[loSKey + '_time']) > 200) {
                                _v2.copy(enemy.mesh.position).setY(1);
                                _v3.copy(other.mesh.position).setY(1);
                                _dirTemp.subVectors(_v3, _v2).normalize();
                                _raycaster.set(_v2, _dirTemp);
                                _raycaster.far = Math.sqrt(distSq);

                                let loSResult = true;
                                for (let w of walls) {
                                    if (_raycaster.intersectObject(w.mesh).length > 0) {
                                        loSResult = false;
                                        break;
                                    }
                                }
                                enemy[loSKey] = loSResult;
                                enemy[loSKey + '_time'] = now;
                            }

                            if (enemy[loSKey] && (other.isVisible || distSq < 6.25)) {
                                let score = (30 - Math.sqrt(distSq));
                                if (enemy.lastAttacker === other.name) score += 15;
                                if (enemy.target && enemy.target.name === other.name) score += 5;

                                if (score > bestScore) {
                                    bestScore = score;
                                    bestTarget = { mesh: other.mesh, name: other.name, isPlayer: false };
                                }
                            }
                        }
                    }

                    // Tarea 15.2: Evaluar Cubos de Poder (Prioridad alta si están cerca)
                    for (let j = 0; j < powerCubes.length; j++) {
                        const cube = powerCubes[j];
                        distSq = enemy.mesh.position.distanceToSquared(cube.mesh.position);
                        if (distSq < 400) { // 20 metros
                            let score = (25 - Math.sqrt(distSq));
                            if (score > bestScore) {
                                bestScore = score;
                                bestTarget = { mesh: cube.mesh, name: "Cubo", isCube: true };
                            }
                        }
                    }

                    // Tarea 15.2: Evaluar Cajas (Si no hay enemigos o cubos mejores)
                    if (!bestTarget || bestScore < 10) {
                        for (let j = 0; j < boxes.length; j++) {
                            const box = boxes[j];
                            distSq = enemy.mesh.position.distanceToSquared(box.mesh.position);
                            if (distSq < 225) { // 15 metros
                                let score = (15 - Math.sqrt(distSq));
                                if (score > bestScore) {
                                    bestScore = score;
                                    bestTarget = { mesh: box.mesh, name: "Caja", isBox: true };
                                }
                            }
                        }
                    }

                    if (enemy.hp < enemy.maxHP * 0.35) {
                        enemy.state = 'FLEE';
                    } else if (bestTarget) {
                        enemy.target = bestTarget;
                        const d = enemy.mesh.position.distanceTo(bestTarget.mesh.position);
                        const aggro = enemy.aggression || 0.5;
                        
                        if (bestTarget.isCube) {
                            enemy.state = 'CHASE'; // Ir a por el cubo
                        } else if (bestTarget.isBox) {
                            let range = 6;
                            if (d < range) enemy.state = 'ATTACK';
                            else enemy.state = 'CHASE';
                        } else {
                            // Objetivo Brawler
                            let baseRange = (enemy.attackRange || 8) * (enemy.hp > enemy.maxHP * 0.7 ? (1 - aggro * 0.4) : 1);
                            if (d < baseRange) enemy.state = 'ATTACK';
                            else enemy.state = 'CHASE';
                        }
                    } else {
                        enemy.target = null;
                        if (Date.now() - enemy.lastDecision > (2000 + Math.random() * 2000)) {
                            enemy.state = 'PATROL';
                            enemy.lastDecision = Date.now();
                        }
                    }
                } // Fin del else para inGas

                // Detección de bala cercana para esquive
                    let bulletToDodge = null;
                    for (let b of bullets) {
                        if (b.owner === enemy.name) continue;
                        if (enemy.mesh.position.distanceTo(b.mesh.position) < 5) {
                            bulletToDodge = b;
                            break;
                        }
                    }
                    
// Si el target está en agua, buscar alternativa
                    if (bestTarget && window.waterBoxes) {
                        let targetInWater = false;
                        for (let w of window.waterBoxes) {
                            const dist = bestTarget.mesh.position.distanceTo(new THREE.Vector3(w.x, 0, w.z));
                            if (dist < w.radius + 1) {
                                targetInWater = true;
                                break;
                            }
                        }
                        if (targetInWater) {
                            bestTarget = null;
                            enemy.target = null;
                        }
                    }
                    
                    // Detección de agua para evitar
                    let avoidWater = false;
                    if (window.waterBoxes) {
                        for (let w of window.waterBoxes) {
                            const dist = enemy.mesh.position.distanceTo(new THREE.Vector3(w.x, 0, w.z));
                            if (dist < w.radius + 2) {
                                avoidWater = true;
                                break;
                            }
                        }
                    }

                    // --- MOVIMIENTO SEGÚN ESTADO ---
                    const botMapLimit = (mapSize / 2) - 1.5;

                    if (enemy.state === 'FLEE') {
                        // Huir del objetivo o perseguidor
                        let threat = (enemy.target && enemy.target.mesh) ? enemy.target.mesh : playerGroup;
                        let fleeDir = new THREE.Vector3().subVectors(enemy.mesh.position, threat.position).normalize();
                        
                        // Evadir agua al huir
                        if (window.waterBoxes && avoidWater) {
                            const closestWater = window.waterBoxes.reduce((closest, w) => {
                                const d = enemy.mesh.position.distanceTo(new THREE.Vector3(w.x, 0, w.z));
                                return d < closest.d ? { w, d } : closest;
                            }, { w: null, d: 999 });
                            if (closestWater.w) {
                                const waterPos = new THREE.Vector3(closestWater.w.x, 0, closestWater.w.z);
                                const avoidDir = new THREE.Vector3().subVectors(enemy.mesh.position, waterPos).normalize();
                                fleeDir.add(avoidDir).normalize();
                            }
                        }
                        
                        moveCharacter(enemy, fleeDir, enemy.speed * 1.3 * delta);
                        // Mirar hacia donde huye
                        enemy.mesh.lookAt(enemy.mesh.position.x + fleeDir.x, enemy.mesh.position.y, enemy.mesh.position.z + fleeDir.z);

                        // Tarea AI: Kiting mientras huye
                        if (enemy.ammo >= 1 && Date.now() - enemy.lastShot > 1600 && enemy.target && enemy.target.mesh) {
                            enemy.lastShot = Date.now();
                            const shootDir = new THREE.Vector3().subVectors(enemy.target.mesh.position, enemy.mesh.position).normalize();
                            fireSpread(enemy.mesh.position, shootDir, 'enemy', enemy.name);
                            SoundEngine.play('shoot', enemy.mesh.position);
                            enemy.ammo--;
                        }

                    } else if (enemy.state === 'CHASE' || enemy.state === 'ATTACK') {
                        if (!enemy.target || !enemy.target.mesh) {
                            enemy.target = window.player;
                            continue;
                        }
                        const targetMesh = enemy.target.mesh;
                        let dir = new THREE.Vector3().subVectors(targetMesh.position, enemy.mesh.position).normalize();
                        
                        // Evadir agua al perseguir
                        if (window.waterBoxes && avoidWater) {
                            const closestWater = window.waterBoxes.reduce((closest, w) => {
                                const d = enemy.mesh.position.distanceTo(new THREE.Vector3(w.x, 0, w.z));
                                return d < closest.d ? { w, d } : closest;
                            }, { w: null, d: 999 });
                            if (closestWater.w && closestWater.d < 5) {
                                const waterPos = new THREE.Vector3(closestWater.w.x, 0, closestWater.w.z);
                                const avoidDir = new THREE.Vector3().subVectors(enemy.mesh.position, waterPos).normalize();
                                dir.add(avoidDir.multiplyScalar(0.5)).normalize();
                            }
                        }
                        
                        const dist = enemy.mesh.position.distanceTo(targetMesh.position);

                        if (enemy.state === 'CHASE') {
                            moveCharacter(enemy, dir, enemy.speed * delta);
                        } else {
                            // Tarea AI: Movimiento COMBINADO (Strafe + Acercarse/Alejarse)
                            const strafeDir = new THREE.Vector3(-dir.z, 0, dir.x);
                            const t = Date.now() * 0.002;
                            // Variedad en el strafe según el bot
                            const strafeFreq = 0.5 + (i % 3) * 0.2;
                            const strafeFactor = Math.sin(t * strafeFreq + i) * (enemy.speed * 0.8);

                            let thrustFactor = 0;
                            const aggro = enemy.aggression || 0.5;
                            if (enemy.hp > enemy.maxHP * 0.5) {
                                thrustFactor = enemy.speed * aggro; // Más aggro -> más rápido se acerca
                            } else if (dist < 6) {
                                thrustFactor = -enemy.speed * (1.1 - aggro); // Menos aggro -> más rápido huye
                            }

                            const combinedMove = new THREE.Vector3()
                                .addScaledVector(strafeDir, strafeFactor)
                                .addScaledVector(dir, thrustFactor);

                            moveCharacter(enemy, combinedMove.normalize(), enemy.speed * delta);
                        }

                        // Tarea AI: Apuntado PREDICTIVO
                        let aimPos = targetMesh.position.clone();
                        if (enemy.target.isPlayer) {
                            const playerVel = new THREE.Vector3().subVectors(playerGroup.position, playerLastPos).divideScalar(delta || 0.016);
                            aimPos.addScaledVector(playerVel, 0.25); // Un pelín más de predicción
                        } else {
                            const targetBot = enemies.find(eb => eb.name === enemy.target.name);
                            if (targetBot) {
                                const botVel = new THREE.Vector3().subVectors(targetBot.mesh.position, targetBot.lastPos).divideScalar(delta || 0.016);
                                aimPos.addScaledVector(botVel, 0.25);
                            }
                        }
                        // Mirar al objetivo sin inclinar
                        enemy.mesh.lookAt(aimPos.x, enemy.mesh.position.y, aimPos.z);

                        if (enemy.state === 'ATTACK' && enemy.ammo >= 1 && Date.now() - enemy.lastShot > 1400) {
                            enemy.lastShot = Date.now();
                            // Recalcular shootDir justo antes de disparar para máxima precisión
                            const shootDir = new THREE.Vector3().subVectors(aimPos, enemy.mesh.position).normalize();
                            fireSpread(enemy.mesh.position, shootDir, 'enemy', enemy.name);
                            SoundEngine.play('shoot', enemy.mesh.position);
                            enemy.ammo = Math.max(0, enemy.ammo - 1);
                            updateAmmoDisplay(enemy.mesh, enemy.ammo, MAX_AMMO, enemy.rechargeProgress);
                        }
                    } else if (enemy.state === 'PATROL') {
                        const dp = enemy.mesh.position.distanceTo(enemy.patrolPoint);
                        if (dp > 2.0) {
                            const dir = new THREE.Vector3().subVectors(enemy.patrolPoint, enemy.mesh.position).normalize();
                            moveCharacter(enemy, dir, (enemy.speed * 0.7) * delta);
                            enemy.mesh.lookAt(enemy.patrolPoint.x, 0, enemy.patrolPoint.z);
                        } else {
                            // Llegó al punto: Escanear área (girar) y elegir nuevo destino
                            const scanAngle = Math.sin(Date.now() * 0.003) * 0.5;
                            enemy.mesh.rotation.y += scanAngle * 0.1;

                            if (Date.now() - enemy.lastDecision > 2000) {
                                enemy.lastDecision = Date.now();
                                // Tarea 29: 40% de ir al centro para buscar pelea
                                if (Math.random() < 0.4) {
                                    enemy.patrolPoint.set((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10);
                                } else {
                                    enemy.patrolPoint.set((Math.random() - 0.5) * 80, 0, (Math.random() - 0.5) * 80);
                                }
                            }
                        }
                    }

                    // ESQUIVE de bala (limitado para no salir del mapa)
                    if (bulletToDodge && enemy.state !== 'FLEE') {
                        const dodgeDir = new THREE.Vector3(-bulletToDodge.dir.z, 0, bulletToDodge.dir.x);
                        moveCharacter(enemy, dodgeDir, enemy.speed * delta);
                    }


                    // Limitar bots dentro del mapa (Eliminamos duplicidad de push que causaba "volar")
                    enemy.mesh.position.x = Math.max(-botMapLimit, Math.min(botMapLimit, enemy.mesh.position.x));
                    enemy.mesh.position.z = Math.max(-botMapLimit, Math.min(botMapLimit, enemy.mesh.position.z));

                    // 8.2. Sigilo para los Bots (Visual) - Tarea FIX STEALTH
                    let botInGrass = false;
                    _box.setFromCenterAndSize(enemy.mesh.position, _v1.set(1, 1, 1));
                    for (let g of grassBlocks) {
                        if (g.box.intersectsBox(_box)) {
                            botInGrass = true;
                            break;
                        }
                    }
                    const botShootingReveal = (Date.now() - enemy.lastShot < 700);
                    const nearPlayer = (enemy.mesh.position.distanceToSquared(playerGroup.position) < 6.25);
                    enemy.isVisible = !botInGrass || botShootingReveal || nearPlayer;

                    // FIX "CONOS DE COLORES": usar visible en lugar de modificar
                    // materiales compartidos del pool global MAT
                    } // Fin del bloque isPlaying && !introSequenceActive para IA
                    
                    enemy.mesh.visible = enemy.isVisible;

                    // Sistema de Daño para Bots (OPTIMIZADO con Distancia)
                    for (let j = bullets.length - 1; j >= 0; j--) {
                        const bullet = bullets[j];
                        if (bullet.type === 'enemy' && bullet.owner === enemy.name) continue; // No autodaño

                        const distToBot = bullet.mesh.position.distanceTo(enemy.mesh.position);
                        if (distToBot < 1.2) {
                            // Tarea: Invulnerabilidad inicial
                            if (enemy.isInvulnerable) {
                                returnBulletToPool(bullet.mesh);
                                bullets.splice(j, 1);
                                continue;
                            }
                            
                            enemy.hp -= (bullet.damage || 200);
                            enemy.lastDamageTime = Date.now();
                            enemy.lastRegenBurstTime = Date.now();
                            updateHPDisplay(enemy.mesh, enemy.hp, enemy.maxHP, enemy.name);
                            SoundEngine.play('hit', enemy.mesh.position);
                            
                            // Knockback from super bullets
                            if (bullet.isSuper) {
                                const knockbackDir = bullet.dir.clone().normalize();
                                enemy.mesh.position.addScaledVector(knockbackDir, 3);
                            }

                            if (enemy.mesh.userData.bodyMaterial) {
                                enemy.mesh.userData.bodyMaterial.emissive.setHex(0xff0000);
                                enemy.mesh.userData.bodyMaterial.emissiveIntensity = 0.8;
                            }
                            enemy.hitTime = Date.now();
                            enemy.originalPos.copy(enemy.mesh.position);
                            enemy.lastAttacker = bullet.owner || (bullet.type === 'player' ? 'Tú' : null);

                            if (enemy.hp <= 0 && !enemy.dead) {
                                spawnPowerCube(enemy.mesh.position.clone());
                            }

                            returnBulletToPool(bullet.mesh);
                            bullets.splice(j, 1);
                            if (enemy.hp <= 0) {
                                // Kill Feed Entry
                                const killerName = bullet.type === 'player' ? 'Tú' : (bullet.owner || 'Bot');
                                addKillEntry(killerName, enemy.name);
                                SoundEngine.play('death', enemy.mesh.position);

                                enemy.dead = true; 
                                scene.remove(enemy.mesh);
                                enemies.splice(i, 1);
                                updateSurvivorCount();
                                break;
                            }
                        }
                    }
                }

                // Actualizar animaciones (Tarea 20) - FUERA del bucle de bots para evitar redundancia O(N^2)
                const animNow = Date.now() * 0.001;

                // Jugador
                if ((isPlaying || introSequenceActive) && playerGroup && playerVisible) {
                    let pState = 'idle';
                    const pMoveDist = Math.sqrt(moveX * moveX + moveZ * moveZ);
                    if (pMoveDist > 0.01 && isPlaying) pState = 'walk';
                    if (Date.now() - playerLastShot < 200) pState = 'attack';
                    updateCharacterAnimation(playerGroup, pState, animNow, delta);
                }

                // Bots
                enemies.forEach(eb => {
                    if (eb.dead) return;
                    let eState = 'idle';
                    if (eb.target || (eb.state === 'CHASE' || eb.state === 'ATTACK')) eState = 'walk'; 
                    if (Date.now() - eb.lastShot < 200) eState = 'attack';
                    updateCharacterAnimation(eb.mesh, eState, animNow, delta);
                });
                
                // Checkear si las balas enemigas nos dan a nosotros (OPTIMIZADO + FIX REMOVAL)
                for (let j = bullets.length - 1; j >= 0; j--) {
                    const bullet = bullets[j];
                    if (bullet.type === 'player') continue; // El jugador no se daña a sí mismo

                    const distToPlayer = bullet.mesh.position.distanceTo(playerGroup.position);
                    if (distToPlayer < 1.2) { // Tarea 8.1: Aumentado radio para recibir daño correctamente
                        // Tarea: Invulnerabilidad inicial
                        if (invulnerabilityTime > 0) {
                            returnBulletToPool(bullet.mesh);
                            bullets.splice(j, 1);
                            continue;
                        }

                        playerHP -= (bullet.damage || 200);
                        playerLastDamageTime = Date.now();
                        playerLastRegenBurstTime = Date.now();
                        updateHPDisplay(playerGroup, playerHP, playerMaxHP, "Tú");
                        SoundEngine.play('hit', playerGroup.position);
                        
                        // Knockback from super bullets
                        if (bullet.isSuper) {
                            var knockDir = bullet.dir.clone().normalize();
                            playerGroup.position.addScaledVector(knockDir, 3);
                        }

                        if (playerGroup.userData.bodyMaterial) {
                            playerGroup.userData.bodyMaterial.emissive.setHex(0xff0000);
                            playerGroup.userData.bodyMaterial.emissiveIntensity = 0.8;
                        }
                        playerHitTime = Date.now();
                        playerOriginalPos.copy(playerGroup.position);

                        // FIX: Eliminar bala al impactar al jugador
                        returnBulletToPool(bullet.mesh);
                        bullets.splice(j, 1);

                        if (playerHP < 0) playerHP = 0;

                        if (playerHP <= 0 && isPlaying) {
                            isPlaying = false;
                            gameOver = true;
                            if (typeof window.sendGameEnd === 'function') window.sendGameEnd();

                            // Ocultar controles móviles
                            joystickBase.style.display = 'none';
                            aimBase.style.display = 'none';

                            // Tarea 17.1: Muerte Visual
                            const deathOverlay = document.getElementById('death-overlay');
                            if (deathOverlay) deathOverlay.style.display = 'block';
                            playerVisible = false;
                            playerGroup.visible = false;
                            
                            SoundEngine.play('death_loss');
                            
                            // Kill feed entry para nosotros
                            const killerName = bullet.owner || 'Bot';
                            addKillEntry(killerName, 'Tú');

                            const currentEnemies = enemies.length;
                            const finishPlace = currentEnemies + 1;

                            // Mostrar posición inmediatamente
                            showPlacement(finishPlace);

                            setTimeout(() => {
                                if (finishPlace > 3) {
                                    // Derrota: pantalla de pérdida
                                    showLossMenu();
                                    initLossScreenPreview();
                                } else {
                                    // Top 1-3: personaje aplaude, sin texto en el centro
                                    MusicEngine.stop();
                                    if (deathOverlay) deathOverlay.style.display = 'none';
                                    // Traer al personaje de vuelta aplaudiendo
                                    playerGroup.position.set(0, 0, 0);
                                    playerGroup.visible = true;
                                    playerGroup.userData.animState = 'celebrate';
                                    despawnWorld();
                                    gameStats.style.display = 'none';
                                    startMenu.style.display = 'flex';
                                    document.querySelector('#start-menu h1').style.display = 'none';
                                    startBtn.style.display = 'none';
                                    if (returnMenuBtn) returnMenuBtn.style.display = 'block';
                                    uiContainer.style.display = 'none';
                                    const td = document.getElementById('trophy-display');
                                    if (td) td.style.display = 'flex';
                                    const sp = document.getElementById('star-pieces-container');
                                    if (sp) sp.style.display = 'flex';
                                    const sb = document.getElementById('settings-btn');
                                    if (sb) sb.style.display = 'flex';
                                    if (startBtn) startBtn.style.display = 'block';
                                    initMenu3D(); // Asegurar reinicio del brawler del menú
                                }
                            }, 1700);
                        }
                    }
                }

                if (isPlaying && enemies.length === 0 && Date.now() - gameStartTime > 3000) {
                    isPlaying = false;
                    // El jugador fue el último en pie: Victoria!
                    showPlacement(1);
                    playerGroup.userData.animState = 'celebrate'; // personaje aplaude
                    MusicEngine.stop();
                    despawnWorld();
                    gameStats.style.display = 'none';
                    
                    // Ocultar controles móviles
                    joystickBase.style.display = 'none';
                    aimBase.style.display = 'none';
                    
                    startMenu.style.display = 'flex';
                    // Sin texto en el centro, solo el banner de posición
                    document.querySelector('#start-menu h1').style.display = 'none';
                    startBtn.style.display = 'none';
                    if (returnMenuBtn) returnMenuBtn.style.display = 'block';
                    uiContainer.style.display = 'none';
                    const td2 = document.getElementById('trophy-display');
                    if (td2) td2.style.display = 'flex';
                    const sp2 = document.getElementById('star-pieces-container');
                    if (sp2) sp2.style.display = 'flex';
                    const sb2 = document.getElementById('settings-btn');
                    if (sb2) sb2.style.display = 'flex';
                    if (startBtn) startBtn.style.display = 'block';
                    initMenu3D();
                    
                    // Mostrar star drop button al volver al menú
                    document.getElementById('star-drop-btn').style.display = 'block';
                }
            }

            if (!isPlaying && !introSequenceActive) {
                const time = Date.now() * 0.0005;
                camera.position.x = Math.sin(time) * 30;
                camera.position.z = Math.cos(time) * 30;
                camera.position.y = 20;
                camera.lookAt(0, 0, 0);

                // Animar personaje en menú post-partida (ej: celebrando)
                if (playerGroup && playerGroup.visible && playerGroup.userData.animState) {
                    updateCharacterAnimation(playerGroup, playerGroup.userData.animState, Date.now() * 0.001, 0.016);
                }
            } else if (introSequenceActive && currentShowcaseTarget) {
                 // --- CÁMARA DINÁMICA DE SHOWCASE ---
                const targetCameraPos = new THREE.Vector3(
                    currentShowcaseTarget.position.x,
                    currentShowcaseTarget.position.y + 6,
                    currentShowcaseTarget.position.z + 8
                );
                camera.position.lerp(targetCameraPos, 0.1);
                camera.lookAt(currentShowcaseTarget.position);
            } else if (playerGroup) {
                // Actualizar Cámara (perseguir al jugador suavemente, lerp) en partida
                const targetCameraPos = new THREE.Vector3(
                    playerGroup.position.x + cameraOffset.x,
                    playerGroup.position.y + cameraOffset.y,
                    playerGroup.position.z + cameraOffset.z
                );

                // --- GESTIÓN DE INVULNERABILIDAD ---
                if (invulnerabilityTime > 0) {
                    invulnerabilityTime -= delta; // Tarea: Usar delta real
                    if (invulnerabilityTime <= 0) {
                        removeAura(playerGroup);
                        enemies.forEach(e => {
                            e.isInvulnerable = false;
                            removeAura(e.mesh);
                        });
                    }
                }

                // Tarea 34: Aplicar sacudida de pantalla (Screen Shake)
                if (screenShake > 0) {
                    targetCameraPos.x += (Math.random() - 0.5) * screenShake;
                    targetCameraPos.z += (Math.random() - 0.5) * screenShake * 0.5;
                    targetCameraPos.y += (Math.random() - 0.5) * screenShake * 0.2;
                }

                // Tarea 10.3: Cámara más firme (Lerp 0.2) para reducir vibración visual en UI
                camera.position.lerp(targetCameraPos, 0.2);
                camera.lookAt(playerGroup.position);
            }

            // Billboarding de compensación (Tarea 12.1): Ignorar rotación del padre
            const billboardTargets = [playerGroup, ...enemies.map(e => e.mesh)];
            billboardTargets.forEach(t => {
                if (!t) return;
                
                _qTemp.copy(t.getWorldQuaternion(_qTemp2)).invert(); // Cancelar rotación del mundo del brawler
                
                const hp = t.getObjectByName('hpDisplay');
                if (hp) {
                    hp.quaternion.copy(_qTemp).multiply(camera.quaternion);
                }
                
                const ammo = t.getObjectByName('ammoDisplay');
                if (ammo) {
                    ammo.quaternion.copy(_qTemp).multiply(camera.quaternion);
                }
            });
            
            // Tarea 37.1: Manejar efectos de Hit en cajas (Flash y Shake Intenso)
            boxes.forEach(b => {
                if (b.hitTime > 0) {
                    const elapsed = now - b.hitTime;
                    if (elapsed < 120) {
                        // Sacudida aleatoria intensa (Tarea 37.1 intensificada)
                        const shakeAmt = 0.4;
                        b.mesh.position.x = b.originalPos.x + (Math.random() - 0.5) * shakeAmt;
                        b.mesh.position.z = b.originalPos.z + (Math.random() - 0.5) * shakeAmt;
                        b.mesh.material.emissiveIntensity = 1.0 - (elapsed / 120);
                    } else {
                        // Restaurar
                        b.mesh.material.emissive.setHex(0x000000);
                        b.mesh.position.copy(b.originalPos);
                        b.hitTime = 0;
                    }
                }
            });

            // Tarea 38: Manejar efectos de Hit en Brawlers (Flash y Shake Visual)
            enemies.concat(playerGroup ? [{ mesh: playerGroup, hitTime: playerHitTime, isPlayer: true, originalPos: playerOriginalPos }] : []).forEach(e => {
                const targetHitTime = e.isPlayer ? playerHitTime : e.hitTime;
                const visual = e.mesh.getObjectByName("visualGroup");

                if (targetHitTime > 0) {
                    const elapsed = now - targetHitTime;
                    if (elapsed < 150) {
                        // Shake lateral SOLO VISUAL
                        if (visual) {
                            visual.position.x = (Math.random() - 0.5) * 0.4;
                        }
                        // El material flash se maneja por userData
                        if (e.mesh.userData.bodyMaterial) {
                            e.mesh.userData.bodyMaterial.emissiveIntensity = 0.8 * (1 - (elapsed / 150));
                        }
                    } else {
                        // Restaurar
                        if (visual) visual.position.x = 0;
                        if (e.mesh.userData.bodyMaterial) {
                            e.mesh.userData.bodyMaterial.emissive.setHex(0x000000);
                        }
                        if (e.isPlayer) playerHitTime = 0;
                        else e.hitTime = 0;
                    }
                }
            });

            // Tarea 37: Lógica de ítems (cubos de poder)
            for (let i = powerCubes.length - 1; i >= 0; i--) {
                const cube = powerCubes[i];
                cube.mesh.rotation.y += delta * 2; // Giro 360
                cube.mesh.position.y = 1 + Math.sin(now * 0.005) * 0.2; // Flotación

                // Recogida por el Jugador
                if (playerGroup && playerGroup.position.distanceTo(cube.mesh.position) < 1.5) {
                    playerMaxHP += 700;
                    playerHP += 700;
                    playerDamageMultiplier += 0.08;
                    updateHPDisplay(playerGroup, playerHP, playerMaxHP, "Tú");

                    // Tarea 9.3: No cambiar el color/brillo de la skin al recoger
                    /* 
                    if (playerGroup.userData.bodyMaterial) {
                        playerGroup.userData.bodyMaterial.emissive.setHex(0xFFFFFF);
                        playerGroup.userData.bodyMaterial.emissiveIntensity = 0.4;
                    }
                    */
                    // playerGroup.scale.set(1.4, 1.4, 1.4); // Eliminado

                    // Tarea 42: Partículas de recolección (Efecto Burst)
                    for (let p_i = 0; p_i < 8; p_i++) {
                        const pGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
                        const pMat = new THREE.MeshBasicMaterial({ color: 0x00FF88 });
                        const pPart = new THREE.Mesh(pGeo, pMat);
                        pPart.position.copy(cube.mesh.position);
                        scene.add(pPart);
                        
                        const pDir = new THREE.Vector3(
                            (Math.random() - 0.5) * 2,
                            Math.random() * 2,
                            (Math.random() - 0.5) * 2
                        ).normalize();
                        
                        let pLife = 0;
                        const pAnimate = () => {
                            pLife += 0.05;
                            pPart.position.addScaledVector(pDir, 0.1);
                            pPart.scale.multiplyScalar(0.9);
                            if (pLife < 1) requestAnimationFrame(pAnimate);
                            else {
                                scene.remove(pPart);
                                pGeo.dispose();
                                pMat.dispose();
                            }
                        };
                        pAnimate();
                    }

                    scene.remove(cube.mesh);
                    powerCubes.splice(i, 1);
                    SoundEngine.play('recharge', cube.mesh.position);
                    SoundEngine.play('powerup', cube.mesh.position);
                    continue;
                }

                // Recogida por Bots (opcional pero justo)
                for (const e of enemies) {
                    if (!e.dead && e.mesh.position.distanceTo(cube.mesh.position) < 1.5) {
                        e.maxHP += 700;
                        e.hp += 700;
                        e.damageMultiplier += 0.08;
                        updateHPDisplay(e.mesh, e.hp, e.maxHP, e.name);

                        scene.remove(cube.mesh);
                        powerCubes.splice(i, 1);
                        break;
                    }
                }
            }

            renderer.render(scene, camera);

            // 🔥 FIREBASE: Actualizar otros jugadores
            if (firebasePlayerMeshes && firebasePlayerMeshes.size > 0) {
                updateFirebasePlayers();
            }

            // Tarea FIX AI: Actualizar última posición del jugador para velocidad
            if (playerGroup) playerLastPos.copy(playerGroup.position);
        }

        window.addEventListener('resize', () => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            renderer.setSize(w, h);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Tarea: Nitidez sin matar el rendimiento
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        });

        // Р’РЋIniciar juego!
        animate();

        // --- DEFINITIVE MENU INIT ---
        function initMenu3D() {
            if (window.menuRenderer) return;

            window.menuScene = new THREE.Scene();
            window.menuCamera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
            
            window.menuRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            window.menuRenderer.setSize(window.innerWidth, window.innerHeight);
            window.menuRenderer.setPixelRatio(window.devicePixelRatio);
            
            const dom = window.menuRenderer.domElement;
            dom.style.position = 'fixed';
            dom.style.top = '0';
            dom.style.left = '0';
            dom.style.width = '100vw';
            dom.style.height = '100vh';
            dom.style.zIndex = '4500'; 
            dom.style.pointerEvents = 'none'; // CLICK-THROUGH
            document.body.appendChild(dom);

            window.menuScene.add(new THREE.AmbientLight(0xffffff, 0.5)); 
            const menuDirLight = new THREE.DirectionalLight(0xffffff, 1.0);
            menuDirLight.position.set(2, 5, 2);
            window.menuScene.add(menuDirLight);
            
            window.menuBrawler = window.menuBrawler || createDetailedBrawler(0x00FF88);
            window.menuBrawler.position.set(0, 0, 0);
            window.menuScene.add(window.menuBrawler);

            // Audio del menú principal - se reproduce en loop
            if (!window.menuAudio) {
                window.menuAudio = new Audio(encodeURI('Main menu StarSkills Song.mp3'));
                window.menuAudio.loop = true;
                window.menuAudio.volume = 0.5;
                // Reproducir cuando el usuario interactúe (navegador bloquea autoplay)
                const startAudio = () => {
                    if (window.menuAudio) window.menuAudio.play().catch(() => {});
                    document.removeEventListener('click', startAudio);
                    document.removeEventListener('touchstart', startAudio);
                };
                document.addEventListener('click', startAudio);
                document.addEventListener('touchstart', startAudio);
            }

            window.menuCamera.position.set(0, 1.4, 4.0); // Más cerca para ver el personaje más grande
            window.menuCamera.lookAt(0, 1.0, 0); // Mirar al pecho/cabeza del brawler

            // Shorthands for internal use if needed (local references)
            menuScene = window.menuScene;
            menuCamera = window.menuCamera;
            menuRenderer = window.menuRenderer;
            menuBrawler = window.menuBrawler;
            
            window.currentMenuState = 'breathe';
            window.currentRotationTarget = 0;
            menuBrawler.rotation.y = window.currentRotationTarget;

            let lastInteractionTime = Date.now();
            let sequenceActive = false;
            let sequenceStartTime = 0;

            let isDragging = false;
            let previousMouseX = 0;
            let rotationVelocity = 0;
            let mouseDownTime = 0;
            let mouseDownPos = { x: 0, y: 0 };
            
            // --- Sistema de Proyectiles del Menú ---
            window.menuBullets = [];
            let lastMenuShotTime = 0;

            window.addEventListener('mousedown', (e) => {
                if (introSequenceActive || isPlaying) return;
                
                // Verificar si el menú principal está visible
                const startMenu = document.getElementById('start-menu');
                const startMenuVisible = startMenu && startMenu.style.display !== 'none';
                
                if (!startMenuVisible) return;
                
                // Si el click es en la UI, dejar que la UI lo maneje
                if (e.target.tagName === 'BUTTON' || e.target.closest('.brawler-card')) {
                    return;
                }

                lastInteractionTime = Date.now();
                sequenceActive = false;
                menuBrawler.userData.winkRight = false;
                window.currentMenuState = 'breathe';

                mouseDownTime = Date.now();
                mouseDownPos = { x: e.clientX, y: e.clientY };

                isDragging = true;
                previousMouseX = e.clientX;
                rotationVelocity = 0;
            });

            window.addEventListener('mousemove', (e) => {
                if (isDragging) {
                    lastInteractionTime = Date.now();
                    const deltaX = e.clientX - previousMouseX;
                    menuBrawler.rotation.y += deltaX * 0.007;
                    rotationVelocity = deltaX * 0.007;
                    previousMouseX = e.clientX;
                    window.currentRotationTarget = menuBrawler.rotation.y;
                }
            });

            window.addEventListener('mouseup', (e) => {
                if (!isDragging) return;
                isDragging = false;
                lastInteractionTime = Date.now();

                const mouseUpTime = Date.now();
                const dist = Math.hypot(e.clientX - mouseDownPos.x, e.clientY - mouseDownPos.y);
                const elapsed = mouseUpTime - mouseDownTime;

                // Solo abrir menú si el menú principal está visible
                const startMenu = document.getElementById('start-menu');
                const startMenuVisible = startMenu && startMenu.style.display !== 'none';
                
                if (startMenuVisible && elapsed < 250 && dist < 10) {
                    const mousePos = new THREE.Vector2(
                        (e.clientX / window.innerWidth) * 2 - 1,
                        -(e.clientY / window.innerHeight) * 2 + 1
                    );
                    
                    const rayM = new THREE.Raycaster();
                    rayM.setFromCamera(mousePos, menuCamera);
                    
                    const hits = rayM.intersectObject(menuScene, true);
                    if (hits.length > 0) {
                        // Open character menu instead of switching
                        if (typeof window.showCharMenu === 'function') {
                            window.showCharMenu();
                        }
                    }
                }
            });

            function animateMenu() {
                requestAnimationFrame(animateMenu);
                const sub = document.getElementById('sub-menu-overlay');
                const char = document.getElementById('char-overlay');
                const container = document.getElementById('start-menu');
                
                function isVisible(el) {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                }

                const menuVis = isVisible(container) || isVisible(sub) || isVisible(char);

                if (menuVis && menuRenderer) {
                    const sec = Date.now() * 0.001;
                    menuRenderer.domElement.style.display = 'block';
                    
                    if (currentMenuState === 'breathe') {
                        // Tarea: Respiración más lenta (frecuencia 0.8 en lugar de 1.5)
                        menuBrawler.position.y = Math.sin(sec * 0.8) * 0.05;
                    } 
                    
                    // Tarea: Volver a la posición frontal tras 5s de inactividad e iniciar secuencia
                    // Tarea: Reducir frecuencia (20s de inactividad)
                if (Date.now() - lastInteractionTime > 20000) {
                        if (!sequenceActive) {
                            sequenceActive = true;
                            sequenceStartTime = Date.now();
                        }

                        const elapsedS = (Date.now() - sequenceStartTime) / 1000;

                        if (elapsedS < 1.5) {
                            // Stage 1: Mirar a la izquierda
                            window.currentMenuState = 'look_left';
                        } else if (elapsedS < 3.0) {
                            // Stage 2: Girar cuerpo a la derecha
                            window.currentMenuState = 'breathe';
                            window.currentRotationTarget = Math.PI / 4;
                        } else if (elapsedS < 4.5) {
                            // Stage 3: Apuntar + Guiñar ojo
                            window.currentMenuState = 'aim';
                            menuBrawler.userData.winkRight = true;
                        } else if (elapsedS < 6.5) {
                            // Stage 4: Disparar (Fuego!)
                            window.currentMenuState = 'attack';
                            menuBrawler.userData.winkRight = true;
                        } else if (elapsedS < 8.0) {
                            // Stage 5: Reset gradual (Sin salto)
                            window.currentMenuState = 'breathe';
                            menuBrawler.userData.winkRight = false;
                            window.currentRotationTarget = 0;
                        } else {
                            // Reiniciar timer
                            lastInteractionTime = Date.now();
                            sequenceActive = false;
                        }
                    } else if (!isDragging) {
                        window.currentRotationTarget = 0;
                    }

                    if (!isDragging) {
                        menuBrawler.rotation.y += rotationVelocity;
                        rotationVelocity *= 0.94;
                        // Tarea: Animación de rotación más LENTA (factor 0.02 en lugar de 0.05)
                        menuBrawler.rotation.y += (window.currentRotationTarget - menuBrawler.rotation.y) * 0.02;
                    }

                    // Tarea: Animaciones de personaje 40% más lentas (sec * 0.6)
                    updateCharacterAnimation(menuBrawler, currentMenuState, sec * 0.6, 0.016);
                    
                    // --- Lógica de Balas del Menú (Azules) ---
                    if (currentMenuState === 'attack' && (sec - lastMenuShotTime > 0.15)) {
                        lastMenuShotTime = sec;
                        const gun = menuBrawler.userData.rightGun;
                        if (gun) {
                            gun.updateMatrixWorld(true);
                            const muzzle = new THREE.Vector3(0, 0.05, 0.52);
                            muzzle.applyMatrix4(gun.matrixWorld);
                            
                            const bulletDir = new THREE.Vector3(0, 0, 1);
                            bulletDir.applyQuaternion(gun.getWorldQuaternion(new THREE.Quaternion()));
                            
                            const bMesh = new THREE.Mesh(
                                new THREE.SphereGeometry(0.12, 8, 8),
                                new THREE.MeshStandardMaterial({ color: 0x00E5FF, emissive: 0x00E5FF, emissiveIntensity: 1.0 })
                            );
                            bMesh.position.copy(muzzle);
                            menuScene.add(bMesh);
                            window.menuBullets.push({ mesh: bMesh, dir: bulletDir, time: 0 });
                        }
                    }
                    
                    // Actualizar balas del menú
                    for (let i = window.menuBullets.length - 1; i >= 0; i--) {
                        const b = window.menuBullets[i];
                        b.mesh.position.addScaledVector(b.dir, 0.5); // Velocidad fija
                        b.time += 0.016;
                        if (b.time > 1.5) { // Desvanecer tras 1.5s
                            menuScene.remove(b.mesh);
                            b.mesh.geometry.dispose();
                            b.mesh.material.dispose();
                            window.menuBullets.splice(i, 1);
                        }
                    }

                    menuRenderer.render(menuScene, menuCamera);
                } else if (menuRenderer) {
                    // Limpiar balas si salimos del menú
                    if (window.menuBullets && window.menuBullets.length > 0) {
                        window.menuBullets.forEach(b => {
                            menuScene.remove(b.mesh);
                            b.mesh.geometry.dispose();
                            b.mesh.material.dispose();
                        });
                        window.menuBullets = [];
                    }
                    menuRenderer.domElement.style.display = 'none';
                }
            }
            animateMenu();
        }
        
        // Crear partículas del menú
        function createMenuParticles() {
            const container = document.getElementById('menu-particles');
            if (!container) return;
            container.innerHTML = '';
            for (let i = 0; i < 30; i++) {
                const particle = document.createElement('div');
                particle.className = 'menu-particle';
                particle.style.left = Math.random() * 100 + '%';
                particle.style.animationDelay = Math.random() * 8 + 's';
                particle.style.animationDuration = (5 + Math.random() * 5) + 's';
                particle.style.width = (2 + Math.random() * 4) + 'px';
                particle.style.height = particle.style.width;
                container.appendChild(particle);
            }
        }
createMenuParticles();
        
        // Initialize menu after everything is ready
        if (typeof THREE !== 'undefined') {
            setTimeout(function() {
                if (typeof initMenu3D === 'function') {
                    try { initMenu3D(); } catch(e) { console.log('Menu error:', e); }
                }
            }, 500);
        }
        
        window.startMatchmaking = function() {
            console.log('startMatchmaking called');
            if (typeof runIntroSequence === 'function') {
                runIntroSequence();
            }
        };

        // === DUAL VIRTUAL JOYSTICKS ===
        var joystickBase  = document.getElementById('joystick-base');
        var joystickStick = document.getElementById('joystick-stick');
        var aimBase  = document.getElementById('aim-base');
        var aimStick = document.getElementById('aim-stick');

        // Touch tracking
        var leftTouchId  = null;
        var rightTouchId = null;
        var leftOriginX = 0, leftOriginY = 0;
        var rightOriginX = 0, rightOriginY = 0;

        // Joystick state
        var isJActive   = false;
        var jX = 0, jY = 0;
        var isAimActive = false;
        var aX = 0, aY = 0;
        var aimDir = new THREE.Vector3();

        // Prevent ghost mouse clicks on touch devices
        var isTouchDevice = false;

        // ─── HELPER: world-space direction from stick offset ───
        // Camera is at (0,15,12) with NO Y-axis rotation.
        // Therefore: stick X (left/right) = world X, stick Y (up/down) = world Z.
        function calcAimDir(dx, dy) {
            if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return null;
            return new THREE.Vector3(dx, 0, dy).normalize();
        }

        // ─── LEFT STICK (extendable base) ───
        function updateLeftStick(mx, my) {
            var dx = mx - leftOriginX;
            var dy = my - leftOriginY;
            var dist = Math.sqrt(dx*dx + dy*dy);
            var maxD = 45;
            if (dist > maxD) {
                dx = dx / dist * maxD;
                dy = dy / dist * maxD;
            }
            var transform = 'translate(' + Math.round(dx) + 'px, ' + Math.round(dy) + 'px)';
            joystickStick.style.transform = transform;
            jX = dx / maxD;
            jY = dy / maxD;
            updateActivity();
        }

        // ─── RIGHT STICK (extendable base) ───
        function updateRightStick(mx, my) {
            var dx = mx - rightOriginX;
            var dy = my - rightOriginY;
            var dist = Math.sqrt(dx*dx + dy*dy);
            var maxD = 45;
            // Limit stick movement but keep base fixed
            if (dist > maxD) {
                dx = dx / dist * maxD;
                dy = dy / dist * maxD;
            }
            aimStick.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
            aX = dx / maxD;
            aY = dy / maxD;
            updateActivity();

            if (dist > 8 && playerGroup) {
                var dir = calcAimDir(dx, dy);
                if (dir) {
                    playerGroup.lookAt(playerGroup.position.clone().add(dir));
                    aimDir.copy(dir);
                    if (aimIndicator) aimIndicator.visible = true;
                }
            }
        }

        // ─── TOUCH HANDLERS ───
        function handleTouchStart(e) {
            if (!isPlaying || playerHP <= 0 || introSequenceActive) return;
            for (var i = 0; i < e.changedTouches.length; i++) {
                var t = e.changedTouches[i];
                if (t.clientX < window.innerWidth / 2) {
                    // Left half → move joystick - appear at touch position
                    if (leftTouchId !== null) continue;
                    leftTouchId = t.identifier;
                    isJActive = true;
                    leftOriginX = t.clientX;
                    leftOriginY = t.clientY;
                    joystickBase.style.left = (leftOriginX - 75) + 'px';
                    joystickBase.style.top = (leftOriginY - 75) + 'px';
                    joystickBase.style.display = 'block';
                    updateLeftStick(t.clientX, t.clientY);
                } else {
                    // Right half → aim joystick - appear at touch position
                    if (rightTouchId !== null) continue;
                    rightTouchId = t.identifier;
                    isAimActive = true;
                    rightOriginX = t.clientX;
                    rightOriginY = t.clientY;
                    aimBase.style.left = (rightOriginX - 75) + 'px';
                    aimBase.style.top = (rightOriginY - 75) + 'px';
                    aimBase.style.display = 'block';
                    updateRightStick(t.clientX, t.clientY);
                }
            }
        }

        function handleTouchMove(e) {
            for (var i = 0; i < e.changedTouches.length; i++) {
                var t = e.changedTouches[i];
                if (isJActive && t.identifier === leftTouchId) {
                    updateLeftStick(t.clientX, t.clientY);
                }
                if (isAimActive && t.identifier === rightTouchId) {
                    updateRightStick(t.clientX, t.clientY);
                }
            }
        }

        function handleTouchEnd(e) {
            for (var i = 0; i < e.changedTouches.length; i++) {
                var t = e.changedTouches[i];

                if (isJActive && t.identifier === leftTouchId) {
                    isJActive = false;
                    leftTouchId = null;
                    jX = 0; jY = 0;
                    joystickStick.style.transform = 'translate(0px,0px)';
                    // Return to default position
                    joystickBase.style.left = '60px'; 
                    joystickBase.style.top = 'auto';
                    joystickBase.style.right = 'auto'; 
                    joystickBase.style.bottom = '60px';
                    keys.w = keys.a = keys.s = keys.d = false;
                }

                if (isAimActive && t.identifier === rightTouchId) {
                    isAimActive = false;
                    rightTouchId = null;

                    if (Math.sqrt(aX*aX + aY*aY) > 0.15 && typeof playerShoot === 'function') {
                        playerShoot(aimDir.clone());
                    }

                    aX = 0; aY = 0;
                    aimStick.style.transform = 'translate(0px,0px)';
                    // Return to default position
                    aimBase.style.left = 'auto'; 
                    aimBase.style.top = 'auto';
                    aimBase.style.right = '60px'; 
                    aimBase.style.bottom = '60px';
                    if (aimIndicator) aimIndicator.visible = false;
                }
            }
        }

        // ─── EVENT LISTENERS ───
        document.addEventListener('touchstart',  function(e) {
            isTouchDevice = true;
            if (isPlaying) { e.preventDefault(); handleTouchStart(e); }
        }, {passive: false});
        document.addEventListener('touchmove',   function(e) {
            if (isPlaying) { e.preventDefault(); handleTouchMove(e); }
        }, {passive: false});
        document.addEventListener('touchend',    function(e) { if (isPlaying) handleTouchEnd(e); });
        document.addEventListener('touchcancel', function(e) { if (isPlaying) handleTouchEnd(e); });

        // Mouse fallback for PC testing only
        var mouseDown = false;
        document.addEventListener('mousedown', function(e) {
            if (isTouchDevice || !isPlaying || playerHP <= 0 || introSequenceActive) return;
            mouseDown = true;
            handleTouchStart({ changedTouches: [{ identifier:'mouse', clientX: e.clientX, clientY: e.clientY }] });
        });
        document.addEventListener('mousemove', function(e) {
            if (isTouchDevice || !mouseDown) return;
            handleTouchMove({ changedTouches: [{ identifier:'mouse', clientX: e.clientX, clientY: e.clientY }] });
        });
        document.addEventListener('mouseup', function(e) {
            if (isTouchDevice || !mouseDown) return;
            mouseDown = false;
            handleTouchEnd({ changedTouches: [{ identifier:'mouse', clientX: e.clientX, clientY: e.clientY }] });
        });

        // ─── MOVEMENT LOOP ───
        setInterval(function() {
            if (!isPlaying) return;
            if (isJActive) {
                var thresh = 0.15;
                keys.w = jY < -thresh;
                keys.s = jY >  thresh;
                keys.a = jX < -thresh;
                keys.d = jX >  thresh;
                // Rotate body when walking and NOT actively aiming, with 400ms grace period after last shot
                var aimGrace = 400;
                if (!isAimActive && playerGroup &&
                    (Date.now() - playerLastShot) > aimGrace &&
                    (Math.abs(jX) > 0.15 || Math.abs(jY) > 0.15)) {
                    var moveDir = calcAimDir(jX * 45, jY * 45);
                    if (moveDir) playerGroup.lookAt(playerGroup.position.clone().add(moveDir));
                }
            }
        }, 40);

        // Prevent pinch-zoom
        document.addEventListener('gesturestart',  function(e){ e.preventDefault(); }, {passive: false});
        document.addEventListener('gesturechange', function(e){ e.preventDefault(); }, {passive: false});
        
        // Keyboard controls (WASD + Space for super)
        document.addEventListener('keydown', function(e) {
            if (!isPlaying || playerHP <= 0 || introSequenceActive) return;
            var key = e.key.toLowerCase();
            if (key === 'w') keys.w = true;
            if (key === 'a') keys.a = true;
            if (key === 's') keys.s = true;
            if (key === 'd') keys.d = true;
            if (key === ' ') {
                e.preventDefault();
                fireSuper();
            }
        });
        
        document.addEventListener('keyup', function(e) {
            var key = e.key.toLowerCase();
            if (key === 'w') keys.w = false;
            if (key === 'a') keys.a = false;
            if (key === 's') keys.s = false;
            if (key === 'd') keys.d = false;
        });
        
        // Click to shoot on PC
        document.addEventListener('click', function(e) {
            if (!isPlaying || playerHP <= 0 || introSequenceActive) return;
            if (e.target.tagName === 'BUTTON') return;
            if (e.button !== 0) return;
            playerShoot(aimDir.clone());
        });
        
        // Super attack function (9 pellets, 320 damage each)
        function fireSuper() {
            if (!isPlaying || playerHP <= 0 || introSequenceActive) return;
            playerLastDamageTime = Date.now();
            var dir = aimDir.clone();
            dir.y = 0;
            dir.normalize();
            playerGroup.lookAt(playerGroup.position.clone().add(dir));
            
            // 9 pellets spread
            var superAngles = [-Math.PI/8, -Math.PI/12, -Math.PI/24, 0, Math.PI/24, Math.PI/12, Math.PI/24, -Math.PI/16, Math.PI/16];
            for (var i = 0; i < superAngles.length; i++) {
                var angle = superAngles[i];
                var cos = Math.cos(angle);
                var sin = Math.sin(angle);
                var rx = dir.x * cos - dir.z * sin;
                var rz = dir.x * sin + dir.z * cos;
                
                var bMesh = getBulletFromPool(0xFFD700);
                bMesh.scale.set(1.5, 1.5, 1.5);
                
                var forwardOffset = 0.8;
                bMesh.position.set(
                    playerGroup.position.x + dir.x * forwardOffset, 
                    1, 
                    playerGroup.position.z + dir.z * forwardOffset
                );
                
                if (!bMesh.parent) scene.add(bMesh);
                
                bullets.push({
                    mesh: bMesh,
                    dir: new THREE.Vector3(rx, 0, rz),
                    traveled: 0,
                    type: 'player',
                    owner: 'Tú',
                    damage: 320,
                    isSuper: true
                });
            }
            
            SoundEngine.play('shoot', playerGroup.position);
            screenShake = 0.5;
        }
        
        // === STAR DROP SYSTEM (Brawl Stars Style) ===
        const starDropRarities = [
            { name: 'ESPECIAL', desc: '50 Monedas', icon: '💰', color: '#00CCFF', bgColor: '#003344', class: 'rarity-especial', chance: 50, rotationSpeed: 8 },
            { name: 'SUPERESPECIAL', desc: '100 Monedas', icon: '💎', color: '#44FF00', bgColor: '#003300', class: 'rarity-superespecial', chance: 28, rotationSpeed: 6 },
            { name: 'ÉPICO', desc: 'Reacciones', icon: '✨', color: '#CC33FF', bgColor: '#330044', class: 'rarity-epico', chance: 20, rotationSpeed: 4 },
            { name: 'MÍTICO', desc: 'Gadgets', icon: '🔮', color: '#FF0044', bgColor: '#440011', class: 'rarity-mitico', chance: 15, rotationSpeed: 3 },
            { name: 'LEGENDARIO', desc: 'Star Powers', icon: '👑', color: '#FFFF00', bgColor: '#444400', class: 'rarity-legendario', chance: 10, rotationSpeed: 2 }
        ];
        
        let tapCount = 0;
        let finalRarityIndex = 0;
        let tapThresholds = [];
        const MAX_TAPS = 4;
        
        function adjustColor(hex, amount) {
            var num = parseInt(hex.replace('#', ''), 16);
            var r = Math.min(255, Math.max(0, (num >> 16) + amount));
            var g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
            var b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
            return '#' + (0x1000000 + (r << 16) + (g << 8) + b).toString(16).slice(1);
        }
        
        function generateRandomCracks() {
            const crackSvg = document.getElementById('crack-svg');
            const crackPatterns = [];
            
            for (let i = 0; i < 4; i++) {
                const crack = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                crack.classList.add('crack-group', 'crack-' + (i + 1));
                crack.style.opacity = '0';
                
                const numLines = 2 + Math.floor(Math.random() * 3);
                const startX = 30 + Math.random() * 100;
                const startY = 30 + Math.random() * 160;
                
                for (let j = 0; j < numLines; j++) {
                    let x = startX + (Math.random() - 0.5) * 60;
                    let y = startY + (Math.random() - 0.5) * 60;
                    
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    let d = 'M' + x + ',' + y;
                    
                    const segments = 2 + Math.floor(Math.random() * 3);
                    for (let s = 0; s < segments; s++) {
                        x += (Math.random() - 0.5) * 40;
                        y += (Math.random() - 0.5) * 40;
                        d += ' L' + x.toFixed(1) + ',' + y.toFixed(1);
                    }
                    
                    path.setAttribute('d', d);
                    path.setAttribute('stroke', 'rgba(0,0,0,0.6)');
                    path.setAttribute('stroke-width', (1 + Math.random()).toFixed(1));
                    path.setAttribute('fill', 'none');
                    path.setAttribute('stroke-linecap', 'round');
                    crack.appendChild(path);
                    
                    if (Math.random() > 0.5) {
                        const branchX = x;
                        const branchY = y;
                        const branch = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                        let bd = 'M' + branchX + ',' + branchY;
                        let bx = branchX + (Math.random() - 0.5) * 30;
                        let by = branchY + (Math.random() - 0.5) * 30;
                        bd += ' L' + bx.toFixed(1) + ',' + by.toFixed(1);
                        branch.setAttribute('d', bd);
                        branch.setAttribute('stroke', 'rgba(0,0,0,0.5)');
                        branch.setAttribute('stroke-width', '0.8');
                        branch.setAttribute('fill', 'none');
                        branch.setAttribute('stroke-linecap', 'round');
                        crack.appendChild(branch);
                    }
                }
                
                crackPatterns.push(crack);
            }
            
            crackSvg.innerHTML = '';
            crackPatterns.forEach(crack => crackSvg.appendChild(crack));
        }
        
        function showCrackGroup(tapCount) {
            const crackSvg = document.getElementById('crack-svg');
            const groups = crackSvg.querySelectorAll('.crack-group');
            
            groups.forEach((group, index) => {
                if (index < tapCount) {
                    group.style.opacity = '1';
                    group.style.transition = 'opacity 0.2s ease-out';
                }
            });
        }
        
        function createSparkles() {
            const gem = document.getElementById('gem-container');
            const rect = gem.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            
            for (let i = 0; i < 12; i++) {
                setTimeout(() => {
                    const sparkle = document.createElement('div');
                    sparkle.className = 'gem-sparkle';
                    
                    const angle = (i / 12) * Math.PI * 2;
                    const distance = 80 + Math.random() * 60;
                    const sx = Math.cos(angle) * distance;
                    const sy = Math.sin(angle) * distance - 30;
                    
                    sparkle.style.setProperty('--sx', sx + 'px');
                    sparkle.style.setProperty('--sy', sy + 'px');
                    sparkle.style.left = centerX + 'px';
                    sparkle.style.top = centerY + 'px';
                    sparkle.style.background = i % 2 === 0 ? '#FFD700' : '#FFFFFF';
                    sparkle.style.boxShadow = `0 0 10px ${i % 2 === 0 ? '#FFD700' : '#FFFFFF'}`;
                    
                    document.body.appendChild(sparkle);
                    
                    setTimeout(() => sparkle.remove(), 1000);
                }, i * 50);
            }
        }
        
        window.openStarDrop = function() {
            try {
                // Hide all sub menus safely
                const subMenu = document.getElementById('sub-menu-overlay');
                const emptySub = document.getElementById('empty-sub-menu');
                const charPreview = document.getElementById('char-preview-overlay');
                if (subMenu) subMenu.style.display = 'none';
                if (emptySub) emptySub.style.display = 'none';
                if (charPreview) charPreview.style.display = 'none';
                
                tapCount = 0;
                currentDisplayRarity = 0;
                
                // Roll for final rarity
                let roll = Math.random() * 100;
                let cumulative = 0;
                finalRarityIndex = 0;
                
                for (let i = 0; i < starDropRarities.length; i++) {
                    cumulative += starDropRarities[i].chance;
                    if (roll < cumulative) {
                        finalRarityIndex = i;
                        break;
                    }
                }
                
                tapThresholds = calculateTapThresholds(finalRarityIndex);
                
                // Reset UI
                const menu = document.getElementById('star-drop-menu');
                const gem = document.getElementById('gem-container');
                const tapDisplay = document.getElementById('tap-display');
                const rarityName = document.getElementById('rarity-name');
                const rarityPercent = document.getElementById('rarity-percent');
                
                gem.classList.remove('breaking', 'tap', 'shake', 'vibrate', 'legendary');
                tapDisplay.textContent = 'Toca ' + MAX_TAPS + ' veces';
                rarityName.textContent = '¿?';
                rarityName.style.color = '#00CCFF';
                rarityPercent.textContent = 'Toca para revelar';
                
                const crackOverlay = document.getElementById('crack-overlay');
                crackOverlay.className = 'crack-overlay';
                gem.classList.remove('crack-1', 'crack-2', 'crack-3', 'crack-4');
                generateRandomCracks();
                
                updateGemAppearance(0);
                menu.classList.add('active');
                
                // Epic entrance animation
                gem.classList.add('opening');
                gem.classList.remove('opening');
                void gem.offsetWidth; // Force reflow
                gem.classList.add('opening');
                
                // Sparkle particles
                createSparkles();
                
                SoundEngine.play('ui');
                
            } catch(e) {
                console.error('Star Drop Error:', e);
            }
        };
        
        function calculateTapThresholds(finalIndex) {
            // Determine at which tap the gem should upgrade
            // Special = never upgrades (always blue)
            // Legendary = upgrades at every tap
            
            if (finalIndex === 0) {
                // Special - stays at 0
                return [0, 0, 0, 0];
            }
            
            // Distribute upgrades evenly
            let thresholds = [];
            for (let i = 0; i < MAX_TAPS; i++) {
                // Calculate how many upgrades should have happened by this tap
                let upgradeLevel = Math.floor((i + 1) / (MAX_TAPS / finalIndex));
                thresholds.push(Math.min(upgradeLevel, finalIndex));
            }
            
            // Make sure last tap shows final rarity
            thresholds[MAX_TAPS - 1] = finalIndex;
            
            // Ensure progression is always forward
            for (let i = 1; i < MAX_TAPS; i++) {
                if (thresholds[i] < thresholds[i - 1]) {
                    thresholds[i] = thresholds[i - 1];
                }
            }
            
            return thresholds;
        }
        
        function updateGemAppearance(rarityIndex) {
            const rarity = starDropRarities[rarityIndex];
            const gemMain = document.getElementById('gem-main');
            const gemGlow = document.getElementById('gem-glow');
            const bg = document.getElementById('star-drop-bg');
            const rarityName = document.getElementById('rarity-name');
            const gem = document.getElementById('gem-container');
            
            // Update gem colors
            gemMain.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, ' + rarity.color + ' 20%, ' + adjustColor(rarity.color, -30) + ' 50%, ' + adjustColor(rarity.color, -60) + ' 80%, ' + adjustColor(rarity.color, -80) + ' 100%)';
            gemMain.style.boxShadow = '0 0 30px ' + rarity.color + ', inset 5px 5px 20px rgba(255,255,255,0.5), inset -5px -5px 20px rgba(0,0,0,0.3), inset 0 0 40px rgba(255,255,255,0.2)';
            
            // Update gem inner
            const gemInner = gem.querySelector('.gem-inner');
            if (gemInner) {
                gemInner.style.background = 'linear-gradient(180deg, rgba(255,255,255,0.4) 0%, ' + rarity.color + '40 50%, ' + adjustColor(rarity.color, -40) + '80 100%)';
            }
            
            gemGlow.style.background = rarity.color;
            gemGlow.style.boxShadow = '0 0 100px ' + rarity.color;
            
            // Update background
            bg.style.background = 'radial-gradient(circle, ' + rarity.bgColor + '88 0%, rgba(0,0,0,0.95) 100%)';
            
            // Update rarity text
            rarityName.textContent = rarity.name;
            rarityName.style.color = rarity.color;
            
            // Special effects for higher rarities
            gem.classList.remove('vibrate', 'legendary');
            if (rarityIndex >= 3) {
                gem.classList.add('vibrate');
            }
            if (rarityIndex === 4) {
                gem.classList.add('legendary');
            }
            
            // Update rotation speed
            gem.style.animationDuration = rarity.rotationSpeed + 's';
        }
        
        window.closeStarDrop = function() {
            document.getElementById('star-drop-menu').classList.remove('active');
            document.getElementById('start-menu').style.display = 'flex';
            document.getElementById('settings-btn').style.display = 'flex';
            document.getElementById('trophy-display').style.display = 'flex';
            document.getElementById('trophy-display').style.visibility = 'visible';
            document.getElementById('star-pieces-container').style.display = 'flex';
            const floatingBtn = document.getElementById('floating-star-drop-btn');
if (floatingBtn) floatingBtn.style.display = 'flex';
            document.querySelector('.shop-btn').style.display = 'flex';
            document.querySelector('.extra-btn').style.display = 'flex';
            document.getElementById('bottom-left-rect').style.display = 'flex';
            
            if (window.menuBrawler) {
                window.menuBrawler.visible = true;
                window.menuBrawler.rotation.set(0, -Math.PI/6, 0);
                window.currentMenuState = 'breathe';
            }
            if (window.initMenu3D) window.initMenu3D();
        };
        
        document.getElementById('star-drop-close').addEventListener('click', closeStarDrop);
        
        let currentDisplayRarity = 0;
        
        document.getElementById('gem-container').addEventListener('click', function() {
            if (tapCount >= MAX_TAPS) return;
            
            tapCount++;
            
            const gem = document.getElementById('gem-container');
            const tapDisplay = document.getElementById('tap-display');
            
            // Chance to upgrade based on final rarity
            // Higher final rarity = guaranteed upgrade more often
            const upgradeChance = finalRarityIndex / MAX_TAPS; // e.g., 4/4 = 100% for legendary
            const shouldUpgrade = Math.random() < upgradeChance || finalRarityIndex >= 3;
            
            if (currentDisplayRarity < finalRarityIndex && (shouldUpgrade || tapCount >= finalRarityIndex)) {
                currentDisplayRarity++;
            }
            
            // Always show progress toward final
            if (tapCount >= finalRarityIndex && currentDisplayRarity < finalRarityIndex) {
                currentDisplayRarity = finalRarityIndex;
            }
            
            const currentRarityIndex = currentDisplayRarity;
            
            tapDisplay.textContent = (MAX_TAPS - tapCount) + ' veces más';
            
            // Play sounds
            playTapSound(tapCount, currentRarityIndex);
            
            // Impact animation
            gem.classList.add('tap');
            const gemGlow = document.getElementById('gem-glow');
            gemGlow.classList.add('tap');
            setTimeout(() => {
                gem.classList.remove('tap');
                gemGlow.classList.remove('tap');
            }, 150);
            
            // Add crack based on tap count - add to container
            gem.classList.remove('crack-1', 'crack-2', 'crack-3', 'crack-4');
            gem.classList.add('crack-' + tapCount);
            
            // Show crack pattern from random positions
            showCrackGroup(tapCount);
            
            // Shake on higher rarities
            if (currentRarityIndex >= 2) {
                setTimeout(() => {
                    gem.classList.add('shake');
                    setTimeout(() => gem.classList.remove('shake'), 300);
                }, 150);
            }
            
            // Update appearance to current threshold
            updateGemAppearance(currentRarityIndex);
            
            if (tapCount >= MAX_TAPS) {
                // Show final rarity
                updateGemAppearance(finalRarityIndex);
                
                // Epic break animation!
                gem.classList.add('epic-break');
                createShatterEffect(starDropRarities[finalRarityIndex].color);
                
                // Play final sound
                if (finalRarityIndex >= 4) {
                    SoundEngine.play('gemLegendary');
                } else if (finalRarityIndex >= 2) {
                    SoundEngine.play('gemUpgrade');
                } else {
                    SoundEngine.play('victory');
                }
                
                // Close after animation
                setTimeout(() => {
                    gem.classList.remove('epic-break');
                    window.closeStarDrop();
                }, 1200);
                
                tapCount = 0;
                return;
            }
        });
        
        function playTapSound(tapNum, rarityIndex) {
            // Base tap sound
            SoundEngine.play('gem');
            
            // Upgrade sound if rarity changed
            if (rarityIndex > 0) {
                setTimeout(() => {
                    if (rarityIndex >= 4) {
                        SoundEngine.play('gemLegendary');
                    } else {
                        SoundEngine.play('gemUpgrade');
                    }
                }, 150);
            }
        }
        
        function createShatterEffect(rarityColor) {
            const gemContainer = document.getElementById('gem-container');
            const gemRect = gemContainer.getBoundingClientRect();
            const centerX = gemRect.left + gemRect.width / 2;
            const centerY = gemRect.top + gemRect.height / 2;
            
            // Create screen flash
            let flash = document.querySelector('.shatter-flash');
            if (!flash) {
                flash = document.createElement('div');
                flash.className = 'shatter-flash';
                document.body.appendChild(flash);
            }
            flash.style.setProperty('--flash-color', rarityColor);
            flash.classList.remove('active');
            void flash.offsetWidth;
            flash.classList.add('active');
            
            // Create fragments
            const numFragments = 12;
            for (let i = 0; i < numFragments; i++) {
                const fragment = document.createElement('div');
                fragment.className = 'gem-fragment';
                fragment.style.setProperty('--fragment-color', rarityColor);
                
                const angle = (i / numFragments) * Math.PI * 2 + Math.random() * 0.5;
                const distance = 80 + Math.random() * 120;
                const tx = Math.cos(angle) * distance;
                const ty = Math.sin(angle) * distance - 30;
                const rot = (Math.random() - 0.5) * 720;
                const duration = 0.6 + Math.random() * 0.4;
                
                fragment.style.setProperty('--tx', tx + 'px');
                fragment.style.setProperty('--ty', ty + 'px');
                fragment.style.setProperty('--rot', rot + 'deg');
                fragment.style.setProperty('--duration', duration + 's');
                fragment.style.left = (centerX - 7) + 'px';
                fragment.style.top = (centerY - 10) + 'px';
                
                document.body.appendChild(fragment);
                
                setTimeout(() => fragment.classList.add('animate'), 10);
                setTimeout(() => fragment.remove(), duration * 1000 + 100);
            }
            
            // Create particles
            const numParticles = 20;
            for (let i = 0; i < numParticles; i++) {
                const particle = document.createElement('div');
                particle.className = 'shatter-particle';
                particle.style.setProperty('--particle-color', rarityColor);
                
                const angle = Math.random() * Math.PI * 2;
                const distance = 50 + Math.random() * 100;
                const px = Math.cos(angle) * distance;
                const py = Math.sin(angle) * distance;
                const duration = 0.4 + Math.random() * 0.3;
                
                particle.style.setProperty('--px', px + 'px');
                particle.style.setProperty('--py', py + 'px');
                particle.style.setProperty('--duration', duration + 's');
                particle.style.left = centerX + 'px';
                particle.style.top = centerY + 'px';
                particle.style.width = (4 + Math.random() * 6) + 'px';
                particle.style.height = particle.style.width;
                
                document.body.appendChild(particle);
                
                setTimeout(() => particle.classList.add('animate'), 10);
                setTimeout(() => particle.remove(), duration * 1000 + 100);
            }
        }
        
        function revealStarDropReward(reward) {
            const modal = document.getElementById('star-drop-reward-modal');
            const icon = document.getElementById('star-reward-icon');
            const name = document.getElementById('star-reward-name');
            const desc = document.getElementById('star-reward-desc');
            const content = document.getElementById('star-reward-content');
            const glow = document.getElementById('star-reward-glow');
            
            icon.textContent = reward.icon;
            name.textContent = reward.name;
            name.style.color = reward.color;
            desc.textContent = reward.desc;
            glow.style.background = 'radial-gradient(circle, ' + reward.color + ' 0%, transparent 70%)';
            
            content.className = 'star-reward-content ' + reward.class;
            content.style.background = 'linear-gradient(180deg, ' + reward.bgColor + ' 0%, ' + reward.color + '88 100%)';
            
            modal.classList.add('active');
            
            // Different victory sound based on rarity
            if (finalRarityIndex >= 4) {
                SoundEngine.play('gemLegendary');
            } else if (finalRarityIndex >= 2) {
                SoundEngine.play('gemUpgrade');
            } else {
                SoundEngine.play('victory');
            }
            
            document.getElementById('star-reward-close').onclick = function() {
                modal.classList.remove('active');
                document.getElementById('sub-menu-overlay').style.display = 'flex';
            };
        }
        
        function updateRarityDisplay(rarityIndex) {
            const rarity = starDropRarities[rarityIndex];
            const starMain = document.getElementById('star-main');
            const starGlow = document.getElementById('star-glow');
            const bg = document.getElementById('star-drop-bg');
            const rarityName = document.getElementById('rarity-name');
            const rarityPercent = document.getElementById('rarity-percent');
            
            // Update star colors
            starMain.style.background = 'linear-gradient(135deg, ' + rarity.starColor + ' 0%, ' + rarity.color + ' 50%, ' + rarity.starColor + ' 100%)';
            starMain.style.boxShadow = 'inset 0 -10px 30px rgba(0,0,0,0.3), inset 0 10px 30px rgba(255,255,255,0.4), 0 0 40px ' + rarity.color;
            starGlow.style.background = rarity.color;
            
            // Update background
            bg.style.background = 'radial-gradient(circle, ' + rarity.bgColor + '44 0%, rgba(0,0,0,0.9) 100%)';
            
            // Update rarity text
            rarityName.textContent = rarity.name;
            rarityName.style.color = rarity.color;
            rarityPercent.textContent = rarity.chance + '% de probabilidad';
            
            // Update luck bar color based on rarity
            const luckBar = document.getElementById('luck-bar');
            luckBar.style.background = 'linear-gradient(90deg, ' + rarity.color + ' 0%, #f1c40f 50%, #e74c3c 100%)';
        }
        
        function closeStarDrop() {
            document.getElementById('star-drop-menu').classList.remove('active');
            document.getElementById('sub-menu-overlay').style.display = 'flex';
        }
        
        document.getElementById('star-drop-close').addEventListener('click', closeStarDrop);
        
        function revealStarDropReward(rarityIndex) {
            const rarity = starDropRarities[rarityIndex];
            
            const modal = document.getElementById('star-drop-reward-modal');
            const icon = document.getElementById('star-reward-icon');
            const name = document.getElementById('star-reward-name');
            const desc = document.getElementById('star-reward-desc');
            const content = document.getElementById('star-reward-content');
            const glow = document.getElementById('star-reward-glow');
            
            icon.textContent = rarity.icon;
            name.textContent = rarity.name;
            name.style.color = rarity.color;
            desc.textContent = rarity.desc;
            glow.style.background = 'radial-gradient(circle, ' + rarity.color + ' 0%, transparent 70%)';
            
            content.className = 'star-reward-content ' + rarity.class;
            content.style.background = 'linear-gradient(180deg, ' + rarity.bgColor + ' 0%, ' + rarity.color + '88 100%)';
            
            modal.classList.add('active');
            
            document.getElementById('star-reward-close').onclick = function() {
                modal.classList.remove('active');
            };
        }
        
        // === MAP EDITOR 3D SYSTEM ===
        let mapEditorScene, mapEditorCamera, mapEditorRenderer;
        let mapEditorObjects = [];
        let mapEditorSelected = null;
        let mapEditorSpawns = 0;
        let mapEditorDragging = false;
        let mapEditorPlane;
        
        const MAP_SIZE = 50;
        
        window.openMapEditor = function() {
            document.getElementById('map-editor-overlay').classList.add('active');
            initMapEditor3D();
        };
        
        window.closeMapEditor = function() {
            if (mapEditorRenderer) {
                mapEditorRenderer.dispose();
                document.getElementById('map-3d-canvas').style.display = 'none';
            }
            document.getElementById('map-editor-overlay').classList.remove('active');
        };
        
        function initMapEditor3D() {
            const canvas = document.getElementById('map-3d-canvas');
            canvas.style.display = 'block';
            
            // Scene
            mapEditorScene = new THREE.Scene();
            mapEditorScene.background = new THREE.Color(0x1a1a2e);
            
            // Camera
            const container = document.getElementById('map-canvas-container');
            mapEditorCamera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 1000);
            mapEditorCamera.position.set(0, 40, 40);
            mapEditorCamera.lookAt(0, 0, 0);
            
            // Renderer
            mapEditorRenderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
            mapEditorRenderer.setSize(container.clientWidth, container.clientHeight);
            mapEditorRenderer.shadowMap.enabled = true;
            
            // Lights
            const ambient = new THREE.AmbientLight(0xffffff, 0.6);
            mapEditorScene.add(ambient);
            
            const directional = new THREE.DirectionalLight(0xffffff, 0.8);
            directional.position.set(20, 40, 20);
            directional.castShadow = true;
            directional.shadow.camera.left = -30;
            directional.shadow.camera.right = 30;
            directional.shadow.camera.top = 30;
            directional.shadow.camera.bottom = -30;
            mapEditorScene.add(directional);
            
            // Ground (grass)
            const groundGeo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE);
            const groundMat = new THREE.MeshStandardMaterial({ color: 0x27ae60 });
            const ground = new THREE.Mesh(groundGeo, groundMat);
            ground.rotation.x = -Math.PI / 2;
            ground.receiveShadow = true;
            ground.userData.isGround = true;
            mapEditorScene.add(ground);
            
            // Grid
            const gridHelper = new THREE.GridHelper(MAP_SIZE, 20, 0xffffff, 0x444444);
            gridHelper.position.y = 0.01;
            mapEditorScene.add(gridHelper);
            
            // Boundaries (walls)
            createMapBoundary();
            
            // Raycaster for selection
            mapEditorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            
            // Events
            canvas.addEventListener('mousedown', onMapEditorMouseDown);
            canvas.addEventListener('mousemove', onMapEditorMouseMove);
            canvas.addEventListener('mouseup', onMapEditorMouseUp);
            canvas.addEventListener('wheel', onMapEditorWheel);
            
            // Touch events
            canvas.addEventListener('touchstart', onMapEditorTouchStart);
            canvas.addEventListener('touchmove', onMapEditorTouchMove);
            canvas.addEventListener('touchend', onMapEditorTouchEnd);
            
            animateMapEditor();
            updateMapInfo();
        }
        
        function createMapBoundary() {
            const wallHeight = 3;
            const wallThickness = 1;
            const halfSize = MAP_SIZE / 2;
            
            const wallMat = new THREE.MeshStandardMaterial({ color: 0xe74c3c });
            
            // 4 walls
            const walls = [
                { w: MAP_SIZE, h: wallHeight, d: wallThickness, x: 0, z: -halfSize },
                { w: MAP_SIZE, h: wallHeight, d: wallThickness, x: 0, z: halfSize },
                { w: wallThickness, h: wallHeight, d: MAP_SIZE, x: -halfSize, z: 0 },
                { w: wallThickness, h: wallHeight, d: MAP_SIZE, x: halfSize, z: 0 }
            ];
            
            walls.forEach(w => {
                const geo = new THREE.BoxGeometry(w.w, w.h, w.d);
                const mesh = new THREE.Mesh(geo, wallMat);
                mesh.position.set(w.x, w.h / 2, w.z);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                mesh.userData.type = 'boundary';
                mapEditorScene.add(mesh);
            });
            
            // Danger zone (red area on edges)
            const dangerGeo = new THREE.PlaneGeometry(MAP_SIZE - 6, MAP_SIZE - 6);
            const dangerMat = new THREE.MeshBasicMaterial({ 
                color: 0xe74c3c, 
                transparent: true, 
                opacity: 0.2,
                side: THREE.DoubleSide
            });
            const danger = new THREE.Mesh(dangerGeo, dangerMat);
            danger.rotation.x = -Math.PI / 2;
            danger.position.y = 0.02;
            mapEditorScene.add(danger);
            
            // Create random houses
            createRandomHouses(36);
        }
        
        function createRandomHouses(count) {
            // Same as createGameHouses but for map editor
            const roadMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
            
            // Vertical roads
            [-40, 0, 40].forEach(x => {
                const roadGeo = new THREE.PlaneGeometry(MAP_SIZE, 7);
                const roadV = new THREE.Mesh(roadGeo, roadMat);
                roadV.rotation.x = -Math.PI / 2;
                roadV.position.set(x, 0.05, 0);
                mapEditorScene.add(roadV);
            });
            
            // Horizontal roads
            [-40, 0, 40].forEach(z => {
                const roadGeo = new THREE.PlaneGeometry(MAP_SIZE, 7);
                const roadH = new THREE.Mesh(roadGeo, roadMat);
                roadH.rotation.x = -Math.PI / 2;
                roadH.rotation.z = Math.PI / 2;
                roadH.position.set(0, 0.05, z);
                mapEditorScene.add(roadH);
            });
            
            const wallColors = [0xDEB887, 0xF5DEB3, 0xFFE4C4, 0xE6E6FA];
            const roofColors = [0x8B4513, 0xA0522D, 0x6B4423];
            const zPos = [-30, -15, 15, 30];
            const xPos = [-30, -15, 15, 30];
            
            // Vertical roads
            [-52, -28, -12, 12, 28, 52].forEach((x, i) => {
                const facing = (i % 2 === 0) ? 'east' : 'west';
                zPos.forEach(z => {
                    createRandomHouse(mapEditorScene, x, z, wallColors, roofColors, facing);
                });
            });
            
            // Horizontal roads
            [-52, -28, -12, 12, 28, 52].forEach((z, i) => {
                const facing = (i % 2 === 0) ? 'north' : 'south';
                xPos.forEach(x => {
                    createRandomHouse(mapEditorScene, x, z, wallColors, roofColors, facing);
                });
            });
        }
        
        function createRandomHouse(targetScene, x, z, wallColors, roofColors, facing) {
            const houseGroup = new THREE.Group();
            const size = 7;
            const colorIdx = (Math.abs(x) + Math.abs(z)) % wallColors.length;
            
            const baseGeo = new THREE.BoxGeometry(size, 0.5, size);
            const baseMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
            const base = new THREE.Mesh(baseGeo, baseMat);
            base.position.y = 0.25;
            houseGroup.add(base);
            
            const wallGeo = new THREE.BoxGeometry(size - 0.5, 4, size - 0.5);
            const wallMat = new THREE.MeshStandardMaterial({ color: wallColors[colorIdx] });
            const walls = new THREE.Mesh(wallGeo, wallMat);
            walls.position.y = 2.75;
            houseGroup.add(walls);
            
            const roofGeo = new THREE.BoxGeometry(size, 0.5, size);
            const roofMat = new THREE.MeshStandardMaterial({ color: roofColors[colorIdx % roofColors.length] });
            const roof = new THREE.Mesh(roofGeo, roofMat);
            roof.position.y = 5.25;
            houseGroup.add(roof);
            
            const doorGeo = new THREE.BoxGeometry(1.8, 2.8, 0.2);
            const doorMat = new THREE.MeshStandardMaterial({ color: 0x3D2314 });
            const door = new THREE.Mesh(doorGeo, doorMat);
            
            if (facing === 'east') door.position.set(size/2 - 0.1, 1.9, 0);
            else if (facing === 'west') door.position.set(-size/2 + 0.1, 1.9, 0);
            else if (facing === 'north') door.position.set(0, 1.9, size/2 - 0.1);
            else if (facing === 'south') door.position.set(0, 1.9, -size/2 + 0.1);
            
            if (facing === 'east') door.rotation.y = Math.PI/2;
            else if (facing === 'west') door.rotation.y = -Math.PI/2;
            else if (facing === 'south') door.rotation.y = Math.PI;
            
            houseGroup.add(door);
            
            const winGeo = new THREE.BoxGeometry(1.2, 1.2, 0.15);
            const winMat = new THREE.MeshStandardMaterial({ color: 0x87CEEB });
            
            if (facing === 'north' || facing === 'south') {
                const w1 = new THREE.Mesh(winGeo, winMat);
                w1.position.set(-2, 3.5, facing === 'north' ? size/2 - 0.1 : -size/2 + 0.1);
                houseGroup.add(w1);
                const w2 = new THREE.Mesh(winGeo, winMat);
                w2.position.set(2, 3.5, facing === 'north' ? size/2 - 0.1 : -size/2 + 0.1);
                houseGroup.add(w2);
            } else {
                const w1 = new THREE.Mesh(winGeo, winMat);
                w1.position.set(facing === 'east' ? size/2 - 0.1 : -size/2 + 0.1, 3.5, -2);
                w1.rotation.y = Math.PI/2;
                houseGroup.add(w1);
                const w2 = new THREE.Mesh(winGeo, winMat);
                w2.position.set(facing === 'east' ? size/2 - 0.1 : -size/2 + 0.1, 3.5, 2);
                w2.rotation.y = Math.PI/2;
                houseGroup.add(w2);
            }
            
            houseGroup.position.set(x, 0, z);
            targetScene.add(houseGroup);
        }
        
        function createGameHouses(scene) {
            const tex = wallTextureGrey.clone();
            
            // Store water areas for collision
            window.waterBoxes = [];
            
            // Walls with brick texture - placed intelligently around the map
            const wallPositions = [
                // North wall clusters
                { x: -25, z: -35, w: 6, d: 1.5 },
                { x: -15, z: -35, w: 6, d: 1.5 },
                { x: 15, z: -35, w: 6, d: 1.5 },
                { x: 25, z: -35, w: 6, d: 1.5 },
                { x: -25, z: -28, w: 1.5, d: 5 },
                { x: 25, z: -28, w: 1.5, d: 5 },
                // South wall clusters
                { x: -25, z: 35, w: 6, d: 1.5 },
                { x: -15, z: 35, w: 6, d: 1.5 },
                { x: 15, z: 35, w: 6, d: 1.5 },
                { x: 25, z: 35, w: 6, d: 1.5 },
                { x: -25, z: 28, w: 1.5, d: 5 },
                { x: 25, z: 28, w: 1.5, d: 5 },
                // East side
                { x: 35, z: -25, w: 1.5, d: 6 },
                { x: 35, z: 0, w: 1.5, d: 8 },
                { x: 35, z: 25, w: 1.5, d: 6 },
                // West side
                { x: -35, z: -25, w: 1.5, d: 6 },
                { x: -35, z: 0, w: 1.5, d: 8 },
                { x: -35, z: 25, w: 1.5, d: 6 },
                // Center cover
                { x: -8, z: -8, w: 3, d: 3 },
                { x: 8, z: 8, w: 3, d: 3 },
                { x: -8, z: 8, w: 3, d: 1.5 },
                { x: 8, z: -8, w: 3, d: 1.5 },
            ];
            
            wallPositions.forEach(pos => {
                const texClone = tex.clone();
                texClone.repeat.set(pos.w / 2, pos.d / 2 || 1);
                const wall = new THREE.Mesh(
                    new THREE.BoxGeometry(pos.w, 2.5, pos.d),
                    new THREE.MeshStandardMaterial({ map: texClone, roughness: 0.8 })
                );
                wall.position.set(pos.x, 1.25, pos.z);
                wall.castShadow = true;
                wall.receiveShadow = true;
                scene.add(wall);
            });
            
            // Water holes - look like natural ponds with edges
            const lakeMat = new THREE.MeshStandardMaterial({ 
                color: 0x2196F3, 
                roughness: 0.1,
                metalness: 0.0,
                transparent: false,
                opacity: 1.0
            });
            
            // Pond edges (darker soil around water)
            const edgeMat = new THREE.MeshStandardMaterial({ 
                color: 0x5D4037, 
                roughness: 0.9
            });
            
            const pondPositions = [
                // North
                { x: -20, z: -38, shapes: [{ ox: 0, oz: 0, r: 2.5 }, { ox: 1.8, oz: 0.8, r: 1.8 }, { ox: -1.2, oz: 1, r: 1.5 }] },
                { x: 20, z: -38, shapes: [{ ox: 0, oz: 0, r: 2.5 }, { ox: -1.5, oz: 0.5, r: 1.8 }, { ox: 1, oz: 1, r: 1.5 }] },
                // South
                { x: -20, z: 38, shapes: [{ ox: 0, oz: 0, r: 2 }, { ox: 1.5, oz: -0.5, r: 1.5 }, { ox: -1, oz: -1, r: 1.2 }] },
                { x: 20, z: 38, shapes: [{ ox: 0, oz: 0, r: 2.2 }, { ox: -1.8, oz: -0.6, r: 1.6 }, { ox: 1.2, oz: -0.8, r: 1.3 }] },
                // East
                { x: 42, z: -20, shapes: [{ ox: 0, oz: 0, r: 1.8 }, { ox: 0, oz: 1.5, r: 1.5 }, { ox: 0.5, oz: -1.2, r: 1.2 }] },
                { x: 42, z: 20, shapes: [{ ox: 0, oz: 0, r: 2 }, { ox: -0.5, oz: 1.5, r: 1.6 }, { ox: 0.8, oz: -1, r: 1.3 }] },
                // West
                { x: -42, z: -20, shapes: [{ ox: 0, oz: 0, r: 1.8 }, { ox: 0, oz: 1.5, r: 1.5 }, { ox: 0.5, oz: -1.2, r: 1.2 }] },
                { x: -42, z: 20, shapes: [{ ox: 0, oz: 0, r: 2 }, { ox: -0.5, oz: 1.5, r: 1.6 }, { ox: 0.8, oz: -1, r: 1.3 }] },
            ];
            
            pondPositions.forEach(pond => {
                pond.shapes.forEach(shape => {
                    const px = pond.x + shape.ox;
                    const pz = pond.z + shape.oz;
                    
                    // Hole/dip in ground (dark edge, slightly below ground)
                    const edge = new THREE.Mesh(
                        new THREE.CircleGeometry(shape.r + 0.4, 12),
                        edgeMat
                    );
                    edge.rotation.x = -Math.PI / 2;
                    edge.position.set(px, 0.02, pz);
                    scene.add(edge);
                    
                    // Water inside (on top of edge)
                    const water = new THREE.Mesh(
                        new THREE.CircleGeometry(shape.r, 12),
                        lakeMat
                    );
                    water.rotation.x = -Math.PI / 2;
                    water.position.set(px, 0.03, pz);
                    water.userData.isWater = true;
                    scene.add(water);
                    
                    if (window.waterBoxes) {
                        window.waterBoxes.push({ x: px, z: pz, radius: shape.r * 0.8 });
                    }
                });
            });
        }
        
        function createHouse(scene, x, z, wallColors, roofColors, facing, styleIdx = 0) {
            const houseGroup = new THREE.Group();
            const size = 6 + (styleIdx % 2) * 1.5;
            const colorIdx = Math.abs(Math.floor(x * z / 100)) % wallColors.length;
            
            // Randomize slightly for variety
            const heightMod = 1 + Math.random() * 0.5;
            
            // Foundation
            const baseGeo = new THREE.BoxGeometry(size + 1, 0.8, size + 1);
            const baseMat = new THREE.MeshStandardMaterial({ color: 0x696969 });
            const base = new THREE.Mesh(baseGeo, baseMat);
            base.position.y = 0.4;
            houseGroup.add(base);
            
            // Main walls - with slight variation
            const wallHeight = 3.5 * heightMod;
            const wallGeo = new THREE.BoxGeometry(size - 0.5, wallHeight, size - 0.5);
            const wallMat = new THREE.MeshStandardMaterial({ color: wallColors[colorIdx] });
            const walls = new THREE.Mesh(wallGeo, wallMat);
            walls.position.y = 0.8 + wallHeight/2;
            houseGroup.add(walls);
            
            // Pitched roof - triangular prism
            const roofHeight = 2.5;
            const roofGeo = new THREE.ConeGeometry(size * 0.8, roofHeight, 4);
            roofGeo.rotateY(Math.PI / 4);
            const roofMat = new THREE.MeshStandardMaterial({ color: roofColors[colorIdx % roofColors.length] });
            const roof = new THREE.Mesh(roofGeo, roofMat);
            roof.position.y = 0.8 + wallHeight + roofHeight/2 - 0.3;
            houseGroup.add(roof);
            
            // Chimney
            const chimneyGeo = new THREE.BoxGeometry(0.8, 2, 0.8);
            const chimneyMat = new THREE.MeshStandardMaterial({ color: 0x8B0000 });
            const chimney = new THREE.Mesh(chimneyGeo, chimneyMat);
            chimney.position.set(size/3, 0.8 + wallHeight + 0.5, -size/3);
            houseGroup.add(chimney);
            
            // Door - positioned on the side facing the road (front of house)
            const doorGeo = new THREE.BoxGeometry(1.2, 2.5, 0.2);
            const doorMat = new THREE.MeshStandardMaterial({ color: 0x3E2723 });
            const door = new THREE.Mesh(doorGeo, doorMat);
            
            const doorY = 0.8 + 1.25;
            // Door always on the FRONT (facing the road)
            if (facing === 'east') {
                // Front is at +x (right side of house geometry)
                door.position.set(size/2 - 0.1, doorY, 0);
                door.rotation.y = Math.PI/2;
            } else if (facing === 'west') {
                // Front is at -x (left side of house geometry)
                door.position.set(-size/2 + 0.1, doorY, 0);
                door.rotation.y = -Math.PI/2;
            } else if (facing === 'north') {
                // Front is at +z (front of house geometry)
                door.position.set(0, doorY, size/2 - 0.1);
            } else if (facing === 'south') {
                // Front is at -z (back of house geometry)
                door.position.set(0, doorY, -size/2 + 0.1);
                door.rotation.y = Math.PI;
            }
            houseGroup.add(door);
            
            // Door frame
            const frameGeo = new THREE.BoxGeometry(1.5, 2.8, 0.1);
            const frameMat = new THREE.MeshStandardMaterial({ color: 0x2F2F2F });
            const frame = new THREE.Mesh(frameGeo, frameMat);
            frame.position.copy(door.position);
            frame.position.z += facing === 'north' ? 0.05 : facing === 'south' ? -0.05 : 0;
            frame.position.x += facing === 'east' ? 0.05 : facing === 'west' ? -0.05 : 0;
            frame.rotation.copy(door.rotation);
            houseGroup.add(frame);
            
            // Windows on front face (facing the road)
            const winSize = 1;
            const winGeo = new THREE.BoxGeometry(winSize, winSize * 1.2, 0.15);
            const winMat = new THREE.MeshStandardMaterial({ color: 0x87CEEB, emissive: 0x203040, emissiveIntensity: 0.3 });
            
            // Window frame
            const frameWinGeo = new THREE.BoxGeometry(winSize + 0.2, winSize * 1.2 + 0.2, 0.08);
            const frameWinMat = new THREE.MeshStandardMaterial({ color: 0xF5F5DC });
            
            if (facing === 'north' || facing === 'south') {
                // Windows on front/back
                const winZ = facing === 'north' ? size/2 - 0.1 : -size/2 + 0.1;
                const w1 = new THREE.Mesh(winGeo, winMat);
                w1.position.set(-size/3, 0.8 + wallHeight/2, winZ);
                houseGroup.add(w1);
                
                const w1Frame = new THREE.Mesh(frameWinGeo, frameWinMat);
                w1Frame.position.set(-size/3, 0.8 + wallHeight/2, winZ + (facing === 'north' ? 0.05 : -0.05));
                houseGroup.add(w1Frame);
                
                const w2 = new THREE.Mesh(winGeo, winMat);
                w2.position.set(size/3, 0.8 + wallHeight/2, winZ);
                houseGroup.add(w2);
                
                const w2Frame = new THREE.Mesh(frameWinGeo, frameWinMat);
                w2Frame.position.set(size/3, 0.8 + wallHeight/2, winZ + (facing === 'north' ? 0.05 : -0.05));
                houseGroup.add(w2Frame);
            } else {
                // Windows on side
                const winX = facing === 'east' ? size/2 - 0.1 : -size/2 + 0.1;
                const w1 = new THREE.Mesh(winGeo, winMat);
                w1.position.set(winX, 0.8 + wallHeight/2, -size/3);
                w1.rotation.y = Math.PI/2;
                houseGroup.add(w1);
                
                const w1Frame = new THREE.Mesh(frameWinGeo, frameWinMat);
                w1Frame.position.set(winX + (facing === 'east' ? 0.05 : -0.05), 0.8 + wallHeight/2, -size/3);
                w1Frame.rotation.y = Math.PI/2;
                houseGroup.add(w1Frame);
                
                const w2 = new THREE.Mesh(winGeo, winMat);
                w2.position.set(winX, 0.8 + wallHeight/2, size/3);
                w2.rotation.y = Math.PI/2;
                houseGroup.add(w2);
                
                const w2Frame = new THREE.Mesh(frameWinGeo, frameWinMat);
                w2Frame.position.set(winX + (facing === 'east' ? 0.05 : -0.05), 0.8 + wallHeight/2, size/3);
                w2Frame.rotation.y = Math.PI/2;
                houseGroup.add(w2Frame);
            }
            
            // Small step/porch in front of door
            const stepGeo = new THREE.BoxGeometry(2, 0.3, 1.5);
            const stepMat = new THREE.MeshStandardMaterial({ color: 0x808080 });
            const step = new THREE.Mesh(stepGeo, stepMat);
            
            if (facing === 'east') step.position.set(size/2, 0.15, 0);
            else if (facing === 'west') step.position.set(-size/2, 0.15, 0);
            else if (facing === 'north') step.position.set(0, 0.15, size/2);
            else if (facing === 'south') step.position.set(0, 0.15, -size/2);
            houseGroup.add(step);
            
            // Walkway/path from road to door
            const pathWidth = 1.5;
            const pathLength = 8;
            const pathGeo = new THREE.BoxGeometry(
                facing === 'east' || facing === 'west' ? pathWidth : pathLength,
                0.2,
                facing === 'east' || facing === 'west' ? pathLength : pathWidth
            );
            const pathMat = new THREE.MeshStandardMaterial({ color: 0xA0522D });
            const path = new THREE.Mesh(pathGeo, pathMat);
            
            if (facing === 'east') {
                path.position.set(size/2 + pathLength/2 + 0.5, 0.1, 0);
            } else if (facing === 'west') {
                path.position.set(-size/2 - pathLength/2 - 0.5, 0.1, 0);
            } else if (facing === 'north') {
                path.position.set(0, 0.1, size/2 + pathLength/2 + 0.5);
            } else if (facing === 'south') {
                path.position.set(0, 0.1, -size/2 - pathLength/2 - 0.5);
            }
            houseGroup.add(path);
            
            // Rotate entire house to face the road (towards the road)
            // north -> 180° (mira al sur, hacia z negativa)
            // south -> 0° (mira al norte, hacia z positiva)
            // east -> 0° (mira al oeste, hacia x negativa)
            // west -> 180° (mira al este, hacia x positiva)
            if (facing === 'west') houseGroup.rotation.y = Math.PI;
            else if (facing === 'north') houseGroup.rotation.y = Math.PI;
            else houseGroup.rotation.y = 0;
            
            houseGroup.position.set(x, 0, z);
            scene.add(houseGroup);
        }
        
        function animateMapEditor() {
            if (!mapEditorRenderer) return;
            requestAnimationFrame(animateMapEditor);
            mapEditorRenderer.render(mapEditorScene, mapEditorCamera);
        }
        
        const mapEditorRaycaster = new THREE.Raycaster();
        const mapEditorMouse = new THREE.Vector2();
        let isDragging = false;
        let dragObject = null;
        
        function getMapEditorMousePos(e) {
            const rect = e.target.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        }
        
        function onMapEditorMouseDown(e) {
            getMapEditorMousePos(e);
            mapEditorRaycaster.setFromCamera(mapEditorMouse, mapEditorCamera);
            
            const intersects = mapEditorRaycaster.intersectObjects(mapEditorScene.children);
            
            // Filter out ground and boundaries
            const editable = intersects.filter(i => i.object.userData.type && 
                ['wall', 'grass', 'box', 'cone', 'spawn'].includes(i.object.userData.type));
            
            if (editable.length > 0) {
                selectMapObject(editable[0].object);
                isDragging = true;
                dragObject = editable[0].object;
            } else {
                selectMapObject(null);
            }
        }
        
        function onMapEditorMouseMove(e) {
            if (!isDragging || !dragObject) return;
            
            getMapEditorMousePos(e);
            mapEditorRaycaster.setFromCamera(mapEditorMouse, mapEditorCamera);
            
            const intersectPoint = new THREE.Vector3();
            raycaster.ray.intersectPlane(mapEditorPlane, intersectPoint);
            
            // Clamp to map bounds
            const halfSize = MAP_SIZE / 2 - 2;
            dragObject.position.x = Math.max(-halfSize, Math.min(halfSize, intersectPoint.x));
            dragObject.position.z = Math.max(-halfSize, Math.min(halfSize, intersectPoint.z));
            
            // Update 3D object data
            const objData = mapEditorObjects.find(o => o.mesh === dragObject);
            if (objData) {
                objData.x = dragObject.position.x;
                objData.z = dragObject.position.z;
            }
        }
        
        function onMapEditorMouseUp() {
            isDragging = false;
            dragObject = null;
        }
        
        function onMapEditorWheel(e) {
            e.preventDefault();
            const zoomSpeed = 0.1;
            mapEditorCamera.position.y += e.deltaY * 0.05;
            mapEditorCamera.position.z += e.deltaY * 0.05;
            mapEditorCamera.position.y = Math.max(15, Math.min(80, mapEditorCamera.position.y));
            mapEditorCamera.position.z = Math.max(15, Math.min(80, mapEditorCamera.position.z));
        }
        
        function onMapEditorTouchStart(e) {
            e.preventDefault();
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                onMapEditorMouseDown({ 
                    clientX: touch.clientX, 
                    clientY: touch.clientY,
                    target: e.target,
                    preventDefault: () => {}
                });
            }
        }
        
        function onMapEditorTouchMove(e) {
            e.preventDefault();
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                onMapEditorMouseMove({ 
                    clientX: touch.clientX, 
                    clientY: touch.clientY,
                    target: e.target
                });
            }
        }
        
        function onMapEditorTouchEnd() {
            isDragging = false;
            dragObject = null;
        }
        
        function selectMapObject(obj) {
            // Reset previous selection
            mapEditorObjects.forEach(o => {
                if (o.mesh.material) {
                    o.mesh.material.emissive = new THREE.Color(0x000000);
                }
            });
            
            if (obj) {
                obj.material.emissive = new THREE.Color(0x444400);
            }
            mapEditorSelected = obj;
        }
        
        window.addMapObject = function(type) {
            const geo = new THREE.BoxGeometry(2, 2, 2);
            let mat, mesh;
            
            if (type === 'spawn') {
                if (mapEditorSpawns >= 10) {
                    alert('Máximo 10 puntos de spawn!');
                    return;
                }
                mat = new THREE.MeshStandardMaterial({ color: 0x9b59b6 });
                mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 16), mat);
                mapEditorSpawns++;
                mesh.position.y = 1;
            } else if (type === 'wall') {
                mat = new THREE.MeshStandardMaterial({ color: 0x7f8c8d });
                mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 1), mat);
                mesh.position.y = 1.5;
            } else if (type === 'grass') {
                mat = new THREE.MeshStandardMaterial({ color: 0x2ecc71 });
                mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.3, 8), mat);
                mesh.position.y = 0.15;
            } else if (type === 'box') {
                mat = new THREE.MeshStandardMaterial({ color: 0xd35400 });
                mesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), mat);
                mesh.position.y = 0.75;
            } else if (type === 'cone') {
                mat = new THREE.MeshStandardMaterial({ color: 0xe67e22 });
                mesh = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.5, 16), mat);
                mesh.position.y = 0.75;
            }
            
            mesh.castShadow = true;
            mesh.userData.type = type;
            mapEditorScene.add(mesh);
            
            mapEditorObjects.push({
                mesh: mesh,
                type: type,
                x: 0,
                z: 0,
                scaleX: 1,
                scaleY: 1,
                scaleZ: 1
            });
            
            selectMapObject(mesh);
            updateMapInfo();
        };
        
        window.selectMapTool = function(tool) {
            if (tool === 'delete' && mapEditorSelected) {
                const idx = mapEditorObjects.findIndex(o => o.mesh === mapEditorSelected);
                if (idx !== -1) {
                    if (mapEditorObjects[idx].type === 'spawn') mapEditorSpawns--;
                    mapEditorScene.remove(mapEditorSelected);
                    mapEditorObjects.splice(idx, 1);
                    mapEditorSelected = null;
                    updateMapInfo();
                }
            }
        };
        
        function updateMapInfo() {
            document.getElementById('map-info').textContent = 
                'Objetos: ' + mapEditorObjects.length + ' | Spawns: ' + mapEditorSpawns + '/10';
        }
        
        window.clearMap = function() {
            if (confirm('¿Borrar todos los objetos?')) {
                mapEditorObjects.forEach(o => mapEditorScene.remove(o.mesh));
                mapEditorObjects = [];
                mapEditorSpawns = 0;
                mapEditorSelected = null;
                updateMapInfo();
            }
        };
        
        window.saveMap = function() {
            const mapData = {
                objects: mapEditorObjects.map(o => ({
                    type: o.type,
                    x: Math.round(o.mesh.position.x * 10) / 10,
                    z: Math.round(o.mesh.position.z * 10) / 10,
                    scaleX: Math.round(o.mesh.scale.x * 10) / 10,
                    scaleY: Math.round(o.mesh.scale.y * 10) / 10,
                    scaleZ: Math.round(o.mesh.scale.z * 10) / 10,
                    rotation: Math.round(o.mesh.rotation.y * 10) / 10
                })),
                mapSize: MAP_SIZE
            };
            
            const json = JSON.stringify(mapData, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'mapa_custom.json';
            a.click();
            URL.revokeObjectURL(url);
            
            alert('Mapa 3D guardado!');
            window.closeMapEditor();
        };
        
}); // End DOMContentLoaded
