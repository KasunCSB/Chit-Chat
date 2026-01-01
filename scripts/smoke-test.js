import 'dotenv/config';
import assert from 'assert';
import { io as ioClient } from 'socket.io-client';

const port = process.env.PORT || '3000';
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

// ============================================================================
// Test Utilities
// ============================================================================

const TIMEOUT_MS = 5000;
const results = { passed: 0, failed: 0, skipped: 0, errors: [] };

function log(msg, indent = 0) {
  console.log('  '.repeat(indent) + msg);
}

function logPass(name) {
  results.passed++;
  log(`✓ ${name}`, 1);
}

function logFail(name, error) {
  results.failed++;
  const errMsg = error?.message || error || 'Unknown error';
  log(`✗ ${name}`, 1);
  log(`  → ${errMsg}`, 1);
  results.errors.push({ test: name, error: errMsg, stack: error?.stack });
}

function logSkip(name, reason) {
  results.skipped++;
  log(`○ ${name} (skipped: ${reason})`, 1);
}

async function test(name, fn) {
  try {
    await fn();
    logPass(name);
    return true;
  } catch (err) {
    logFail(name, err);
    return false;
  }
}

async function jsonFetch(path, init = {}) {
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Non-JSON response
  }
  return { res, json, text };
}

function connectSocket(url, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, { 
      transports: ['websocket'], 
      reconnection: false, 
      timeout: TIMEOUT_MS,
      ...options 
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('Socket connect timeout')), TIMEOUT_MS + 1000);
  });
}

function socketEmit(socket, event, payload = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timeout`)), TIMEOUT_MS);
    socket.emit(event, payload, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

function waitForEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Waiting for ${event} timed out`)), TIMEOUT_MS);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// ============================================================================
// Test Suite
// ============================================================================

export async function runSmoke() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ChitChat Comprehensive Smoke Tests`);
  console.log(`  Target: ${baseUrl}`);
  console.log(`${'═'.repeat(60)}\n`);

  let redisAvailable = false;
  let roomId = null;
  let passphrase = null;
  let shortCode = null;
  let adminSocket = null;
  let memberSocket = null;
  let thirdSocket = null;
  let adminMemberId = null;
  let memberMemberId = null;
  let thirdMemberId = null;

  // ──────────────────────────────────────────────────────────────────────────
  // SECTION 1: Health Endpoints
  // ──────────────────────────────────────────────────────────────────────────
  log('\n📡 Health & Readiness Endpoints');
  log('─'.repeat(40));

  await test('GET /healthz returns 200 OK', async () => {
    const { res, json } = await jsonFetch('/healthz');
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.strictEqual(json.ok, true, 'Response should have ok: true');
  });

  await test('GET /readyz returns health status', async () => {
    const { res, json } = await jsonFetch('/readyz');
    assert.ok([200, 503].includes(res.status), `Expected 200 or 503, got ${res.status}`);
    assert.strictEqual(typeof json.ok, 'boolean', 'Should have boolean ok field');
    redisAvailable = res.status === 200 && json.ok === true;
    if (!redisAvailable) {
      log(`    ⚠ Redis not available (status: ${res.status})`, 1);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // SECTION 2: REST API Endpoints
  // ──────────────────────────────────────────────────────────────────────────
  log('\n🌐 REST API Endpoints');
  log('─'.repeat(40));

  await test('GET /api/options returns name and avatar suggestions', async () => {
    const { res, json } = await jsonFetch('/api/options');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(json.names), 'Should have names array');
    assert.ok(Array.isArray(json.avatars), 'Should have avatars array');
    assert.ok(json.names.length >= 1, 'Should have at least 1 name');
    assert.ok(json.avatars.length >= 1, 'Should have at least 1 avatar');
    // Check backward compatibility keys
    assert.ok(Array.isArray(json.nameOptions), 'Should have nameOptions array');
    assert.ok(Array.isArray(json.avatarOptions), 'Should have avatarOptions array');
  });

  // Room creation tests
  if (redisAvailable) {
    await test('POST /api/rooms creates a new room', async () => {
      const { res, json } = await jsonFetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Smoke Test Room', avatar: '🔥' }),
      });
      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
      assert.strictEqual(json.ok, true);
      assert.ok(json.roomId, 'Should return roomId');
      assert.ok(json.passphrase, 'Should return passphrase');
      assert.ok(json.shortCode, 'Should return shortCode');
      assert.ok(json.shortLink, 'Should return shortLink');
      assert.ok(json.qrCode, 'Should return qrCode (base64)');
      assert.strictEqual(json.name, 'Smoke Test Room');
      assert.strictEqual(json.avatar, '🔥');
      roomId = json.roomId;
      passphrase = json.passphrase;
      shortCode = json.shortCode;
    });

    await test('POST /api/rooms with empty name uses default', async () => {
      const { res, json } = await jsonFetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '', avatar: '💬' }),
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(json.name, 'Chat Room', 'Should use default name');
    });

    await test('POST /api/rooms with long name returns 400', async () => {
      const longName = 'x'.repeat(101);
      const { res, json } = await jsonFetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: longName }),
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(json.ok, false);
      assert.ok(json.error.toLowerCase().includes('long'), 'Error should mention length');
    });

    // Room lookup tests
    if (passphrase) {
      await test('GET /api/rooms/lookup by passphrase', async () => {
        const { res, json } = await jsonFetch(`/api/rooms/lookup?q=${encodeURIComponent(passphrase)}`);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(json.roomId, roomId);
        assert.strictEqual(json.passphrase, passphrase);
      });

      await test('GET /api/rooms/lookup by shortCode', async () => {
        const { res, json } = await jsonFetch(`/api/rooms/lookup?q=${shortCode}`);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(json.roomId, roomId);
      });
    }

    await test('GET /api/rooms/lookup with invalid query returns 404', async () => {
      const { res, json } = await jsonFetch('/api/rooms/lookup?q=invalid-passphrase-here');
      assert.strictEqual(res.status, 404);
      assert.strictEqual(json.ok, false);
    });

    await test('GET /api/rooms/lookup without query returns 400', async () => {
      const { res, json } = await jsonFetch('/api/rooms/lookup');
      assert.strictEqual(res.status, 400);
      assert.strictEqual(json.ok, false);
    });

    // QR code endpoint
    if (roomId) {
      await test('GET /api/rooms/:roomId/qr returns QR code', async () => {
        const { res, json } = await jsonFetch(`/api/rooms/${roomId}/qr`);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(json.ok, true);
        assert.ok(json.qrCode, 'Should return qrCode');
        assert.ok(json.qrCode.startsWith('data:image/png;base64,'), 'QR should be base64 PNG');
        assert.ok(json.shortLink, 'Should return shortLink');
      });
    }

    await test('GET /api/rooms/:roomId/qr with invalid room returns 404', async () => {
      const { res, json } = await jsonFetch('/api/rooms/invalid-room-id/qr');
      assert.strictEqual(res.status, 404);
      assert.strictEqual(json.ok, false);
    });

  } else {
    logSkip('POST /api/rooms', 'Redis unavailable');
    logSkip('GET /api/rooms/lookup', 'Redis unavailable');
    logSkip('GET /api/rooms/:roomId/qr', 'Redis unavailable');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SECTION 3: Socket.IO Connection & Basic Events
  // ──────────────────────────────────────────────────────────────────────────
  log('\n🔌 Socket.IO Connection');
  log('─'.repeat(40));

  await test('Socket.IO connects successfully', async () => {
    adminSocket = await connectSocket(baseUrl);
    assert.ok(adminSocket.connected, 'Socket should be connected');
  });

  if (adminSocket) {
    await test('whoami returns server info', async () => {
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('whoami timeout')), TIMEOUT_MS);
        adminSocket.emit('whoami', (res) => {
          clearTimeout(timer);
          resolve(res);
        });
      });
      assert.ok(result.serverId, 'Should return serverId');
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SECTION 4: Room Join Flow
  // ──────────────────────────────────────────────────────────────────────────
  log('\n🚪 Room Join Flow');
  log('─'.repeat(40));

  if (adminSocket && roomId && redisAvailable) {
    await test('room:join as creator/admin succeeds', async () => {
      const result = await socketEmit(adminSocket, 'room:join', {
        roomId,
        userName: 'AdminUser',
        userAvatar: '👑',
        isCreator: true,
      });
      assert.strictEqual(result.ok, true, `Join failed: ${result.error}`);
      assert.ok(result.memberId, 'Should return memberId');
      adminMemberId = result.memberId;
    });

    // Listen for events on admin socket
    const eventsReceived = { memberJoined: false, roomMembers: false };
    adminSocket.on('member:joined', () => { eventsReceived.memberJoined = true; });
    adminSocket.on('room:members', () => { eventsReceived.roomMembers = true; });

    await test('room:join as second member succeeds', async () => {
      memberSocket = await connectSocket(baseUrl);
      const result = await socketEmit(memberSocket, 'room:join', {
        roomId,
        userName: 'MemberUser',
        userAvatar: '🧑',
        isCreator: false,
      });
      assert.strictEqual(result.ok, true, `Join failed: ${result.error}`);
      assert.ok(result.memberId, 'Should return memberId');
      memberMemberId = result.memberId;
    });

    await test('room:join broadcasts member:joined to others', async () => {
      // Give time for event to propagate
      await new Promise(r => setTimeout(r, 200));
      assert.ok(eventsReceived.memberJoined, 'Admin should receive member:joined event');
    });

    await test('room:join without roomId fails', async () => {
      const tempSocket = await connectSocket(baseUrl);
      try {
        const result = await socketEmit(tempSocket, 'room:join', { userName: 'Test' });
        assert.strictEqual(result.ok, false);
        assert.ok(result.error, 'Should return error message');
      } finally {
        tempSocket.disconnect();
      }
    });

    await test('room:join without userName fails', async () => {
      const tempSocket = await connectSocket(baseUrl);
      try {
        const result = await socketEmit(tempSocket, 'room:join', { roomId });
        assert.strictEqual(result.ok, false);
      } finally {
        tempSocket.disconnect();
      }
    });

    await test('room:join with invalid roomId fails', async () => {
      const tempSocket = await connectSocket(baseUrl);
      try {
        const result = await socketEmit(tempSocket, 'room:join', {
          roomId: 'nonexistent-room',
          userName: 'Test',
        });
        assert.strictEqual(result.ok, false);
        assert.ok(result.error.toLowerCase().includes('not found') || result.error.toLowerCase().includes('expired'));
      } finally {
        tempSocket.disconnect();
      }
    });

    await test('room:join with very long username fails', async () => {
      const tempSocket = await connectSocket(baseUrl);
      try {
        const result = await socketEmit(tempSocket, 'room:join', {
          roomId,
          userName: 'x'.repeat(100),
        });
        assert.strictEqual(result.ok, false);
        assert.ok(result.error.toLowerCase().includes('long'));
      } finally {
        tempSocket.disconnect();
      }
    });

  } else {
    logSkip('room:join tests', redisAvailable ? 'No socket/room' : 'Redis unavailable');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SECTION 5: Room Start Flow
  // ──────────────────────────────────────────────────────────────────────────
  log('\n▶️ Room Start Flow');
  log('─'.repeat(40));

  if (adminSocket && memberSocket && roomId && redisAvailable) {
    await test('room:start by non-admin fails', async () => {
      const result = await socketEmit(memberSocket, 'room:start', {});
      assert.strictEqual(result.ok, false);
      assert.ok(result.error.toLowerCase().includes('admin'));
    });

    await test('room:start by admin succeeds', async () => {
      // Set up listener for room:started event on member socket
      const startedPromise = waitForEvent(memberSocket, 'room:started');
      
      const result = await socketEmit(adminSocket, 'room:start', {});
      assert.strictEqual(result.ok, true, `Start failed: ${result.error}`);
      
      // Verify member received room:started
      const startedEvent = await startedPromise;
      assert.strictEqual(startedEvent.status, 'chatting');
    });

  } else {
    logSkip('room:start tests', 'Prerequisites not met');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SECTION 6: Messaging Flow
  // ──────────────────────────────────────────────────────────────────────────
  log('\n💬 Messaging Flow');
  log('─'.repeat(40));

  if (adminSocket && memberSocket && roomId && redisAvailable) {
    await test('message:send succeeds after room started', async () => {
      const msgPromise = waitForEvent(memberSocket, 'message:received');
      
      const result = await socketEmit(adminSocket, 'message:send', {
        text: 'Hello from smoke test!',
      });
      assert.strictEqual(result.ok, true, `Send failed: ${result.error}`);
      assert.ok(result.seq >= 1, 'Should return sequence number');
      
      // Verify member received the message
      const msg = await msgPromise;
      assert.strictEqual(msg.content, 'Hello from smoke test!'); // Server uses 'content' not 'text'
      assert.ok(msg.seq, 'Message should have seq');
    });

    await test('message:send with clientMsgId for idempotency', async () => {
      const clientMsgId = `smoke-${Date.now()}`;
      
      // Send first time
      const result1 = await socketEmit(adminSocket, 'message:send', {
        text: 'Idempotent message',
        clientMsgId,
      });
      assert.strictEqual(result1.ok, true);
      
      // Send same clientMsgId again - should be deduplicated
      const result2 = await socketEmit(adminSocket, 'message:send', {
        text: 'Idempotent message duplicate',
        clientMsgId,
      });
      assert.strictEqual(result2.ok, true);
      assert.strictEqual(result2.duplicate, true, 'Should mark as duplicate');
    });

    await test('message:send with empty text fails', async () => {
      const result = await socketEmit(adminSocket, 'message:send', { text: '' });
      assert.strictEqual(result.ok, false);
      assert.ok(result.error.toLowerCase().includes('empty'));
    });

    await test('message:send with very long text fails', async () => {
      const result = await socketEmit(adminSocket, 'message:send', {
        text: 'x'.repeat(2001),
      });
      assert.strictEqual(result.ok, false);
      assert.ok(result.error.toLowerCase().includes('long'));
    });

    await test('message:send before joining room fails', async () => {
      const tempSocket = await connectSocket(baseUrl);
      try {
        const result = await socketEmit(tempSocket, 'message:send', { text: 'Test' });
        assert.strictEqual(result.ok, false);
        assert.ok(result.error.toLowerCase().includes('room'));
      } finally {
        tempSocket.disconnect();
      }
    });

  } else {
    logSkip('Messaging tests', 'Prerequisites not met');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SECTION 7: Typing Indicators
  // ──────────────────────────────────────────────────────────────────────────
  log('\n⌨️ Typing Indicators');
  log('─'.repeat(40));

  if (adminSocket && memberSocket && roomId && redisAvailable) {
    await test('typing:start broadcasts typing:update', async () => {
      const typingPromise = waitForEvent(memberSocket, 'typing:update');
      adminSocket.emit('typing:start');
      
      const typingData = await typingPromise;
      // Server sends { typingUsers: [...] }
      assert.ok(Array.isArray(typingData.typingUsers), 'Should have typingUsers array');
    });

    await test('typing:stop clears typing indicator', async () => {
      const typingPromise = waitForEvent(memberSocket, 'typing:update');
      adminSocket.emit('typing:stop');
      
      const typingData = await typingPromise;
      // Server sends { typingUsers: [...] }
      assert.ok(Array.isArray(typingData.typingUsers), 'Should have typingUsers array');
    });

  } else {
    logSkip('Typing indicator tests', 'Prerequisites not met');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SECTION 8: Admin Controls - Promote
  // ──────────────────────────────────────────────────────────────────────────
  log('\n👑 Admin Controls - Promote');
  log('─'.repeat(40));

  if (adminSocket && memberSocket && memberMemberId && roomId && redisAvailable) {
    // Add third member to test promotion
    await test('Add third member for promotion test', async () => {
      thirdSocket = await connectSocket(baseUrl);
      const result = await socketEmit(thirdSocket, 'room:join', {
        roomId,
        userName: 'ThirdUser',
        userAvatar: '🎭',
      });
      assert.strictEqual(result.ok, true);
      thirdMemberId = result.memberId;
    });

    await test('member:promote by non-admin fails', async () => {
      const result = await socketEmit(memberSocket, 'member:promote', {
        memberId: thirdMemberId,
      });
      assert.strictEqual(result.ok, false);
      assert.ok(result.error.toLowerCase().includes('admin'));
    });

    await test('member:promote by admin succeeds', async () => {
      const promotePromise = waitForEvent(memberSocket, 'member:promoted');
      
      const result = await socketEmit(adminSocket, 'member:promote', {
        memberId: memberMemberId,
      });
      assert.strictEqual(result.ok, true, `Promote failed: ${result.error}`);
      
      const promoteEvent = await promotePromise;
      assert.strictEqual(promoteEvent.memberId, memberMemberId);
    });

    await test('member:promote with invalid memberId fails', async () => {
      const result = await socketEmit(adminSocket, 'member:promote', {
        memberId: 'invalid-member-id',
      });
      assert.strictEqual(result.ok, false);
    });

  } else {
    logSkip('Promote tests', 'Prerequisites not met');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SECTION 9: Admin Controls - Kick
  // ──────────────────────────────────────────────────────────────────────────
  log('\n🦵 Admin Controls - Kick');
  log('─'.repeat(40));

  // Note: After promote test, memberSocket is now admin (adminSocket was demoted)
  if (memberSocket && thirdSocket && thirdMemberId && roomId && redisAvailable) {
    await test('member:kick with invalid memberId fails', async () => {
      // memberSocket is now admin after the promote
      const result = await socketEmit(memberSocket, 'member:kick', {
        memberId: 'invalid-member',
      });
      assert.strictEqual(result.ok, false);
    });

    await test('member:kick by admin succeeds', async () => {
      const kickPromise = waitForEvent(thirdSocket, 'member:kicked');
      
      // memberSocket is now admin after the promote
      const result = await socketEmit(memberSocket, 'member:kick', {
        memberId: thirdMemberId,
      });
      assert.strictEqual(result.ok, true, `Kick failed: ${result.error}`);
      
      const kickEvent = await kickPromise;
      assert.strictEqual(kickEvent.memberId, thirdMemberId);
    });

  } else {
    logSkip('Kick tests', 'Prerequisites not met');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SECTION 10: Room Close Flow
  // ──────────────────────────────────────────────────────────────────────────
  log('\n🚫 Room Close Flow');
  log('─'.repeat(40));

  if (adminSocket && memberSocket && roomId && redisAvailable) {
    // Create a separate room for close testing to not interfere with rejoin test
    let closeRoomId = null;
    let closeAdminSocket = null;
    let closeMemberSocket = null;

    await test('Setup: Create room for close test', async () => {
      const { res, json } = await jsonFetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Close Test Room' }),
      });
      assert.strictEqual(res.status, 200);
      closeRoomId = json.roomId;
      
      closeAdminSocket = await connectSocket(baseUrl);
      await socketEmit(closeAdminSocket, 'room:join', {
        roomId: closeRoomId,
        userName: 'CloseAdmin',
        isCreator: true,
      });
      
      closeMemberSocket = await connectSocket(baseUrl);
      await socketEmit(closeMemberSocket, 'room:join', {
        roomId: closeRoomId,
        userName: 'CloseMember',
      });
    });

    await test('room:close by non-admin fails', async () => {
      const result = await socketEmit(closeMemberSocket, 'room:close', {});
      assert.strictEqual(result.ok, false);
      assert.ok(result.error.toLowerCase().includes('admin'));
    });

    await test('room:close by admin succeeds', async () => {
      const closedPromise = waitForEvent(closeMemberSocket, 'room:closed');
      
      const result = await socketEmit(closeAdminSocket, 'room:close', {});
      assert.strictEqual(result.ok, true, `Close failed: ${result.error}`);
      
      const closedEvent = await closedPromise;
      assert.ok(closedEvent.reason);
    });

    await test('Joining closed room fails', async () => {
      const tempSocket = await connectSocket(baseUrl);
      try {
        const result = await socketEmit(tempSocket, 'room:join', {
          roomId: closeRoomId,
          userName: 'LateJoiner',
        });
        assert.strictEqual(result.ok, false);
        assert.ok(result.error.toLowerCase().includes('closed'));
      } finally {
        tempSocket.disconnect();
      }
    });

    // Cleanup
    if (closeAdminSocket) closeAdminSocket.disconnect();
    if (closeMemberSocket) closeMemberSocket.disconnect();

  } else {
    logSkip('Room close tests', 'Prerequisites not met');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SECTION 11: Reconnection / Rejoin Flow
  // ──────────────────────────────────────────────────────────────────────────
  log('\n🔄 Reconnection Flow');
  log('─'.repeat(40));

  if (adminMemberId && roomId && redisAvailable) {
    await test('room:rejoin with valid memberId receives room:joined', async () => {
      const rejoinSocket = await connectSocket(baseUrl);
      try {
        const joinedPromise = waitForEvent(rejoinSocket, 'room:joined');
        
        rejoinSocket.emit('room:rejoin', {
          roomId,
          memberId: adminMemberId,
        });
        
        const joinedData = await joinedPromise;
        assert.ok(joinedData.ok, 'Should receive room:joined with ok');
        assert.strictEqual(joinedData.roomId, roomId);
        assert.ok(Array.isArray(joinedData.recent), 'Should have recent messages');
      } finally {
        rejoinSocket.disconnect();
      }
    });

    await test('room:rejoin with invalid memberId triggers rejoin-failed', async () => {
      const rejoinSocket = await connectSocket(baseUrl);
      try {
        const failedPromise = waitForEvent(rejoinSocket, 'room:rejoin-failed');
        
        rejoinSocket.emit('room:rejoin', {
          roomId,
          memberId: 'invalid-member-id',
        });
        
        const failedData = await failedPromise;
        assert.ok(failedData.reason, 'Should have failure reason');
      } finally {
        rejoinSocket.disconnect();
      }
    });

  } else {
    logSkip('Reconnection tests', 'Prerequisites not met');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SECTION 12: Static Files & SPA Routing
  // ──────────────────────────────────────────────────────────────────────────
  log('\n📄 Static Files & Routing');
  log('─'.repeat(40));

  await test('GET / serves index.html', async () => {
    const { res, text } = await jsonFetch('/');
    assert.strictEqual(res.status, 200);
    assert.ok(text.includes('<!DOCTYPE html>') || text.includes('<html'), 'Should return HTML');
  });

  await test('GET /join/:shortCode serves SPA (index.html)', async () => {
    const { res, text } = await jsonFetch('/join/test1234');
    assert.strictEqual(res.status, 200);
    assert.ok(text.includes('<!DOCTYPE html>') || text.includes('<html'), 'Should return HTML for SPA routing');
  });

  await test('GET /css/styles.css serves CSS', async () => {
    const res = await fetch(`${baseUrl}/css/styles.css`);
    assert.strictEqual(res.status, 200);
    const contentType = res.headers.get('content-type');
    assert.ok(contentType.includes('css'), 'Should have CSS content type');
  });

  await test('GET /js/app.js serves JavaScript', async () => {
    const res = await fetch(`${baseUrl}/js/app.js`);
    assert.strictEqual(res.status, 200);
    const contentType = res.headers.get('content-type');
    assert.ok(contentType.includes('javascript'), 'Should have JS content type');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // SECTION 13: Edge Cases & Error Handling
  // ──────────────────────────────────────────────────────────────────────────
  log('\n⚠️ Edge Cases & Error Handling');
  log('─'.repeat(40));

  await test('Invalid JSON body returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    assert.strictEqual(res.status, 400);
  });

  await test('Unknown API endpoint returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/unknown-endpoint`);
    assert.strictEqual(res.status, 404);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Cleanup
  // ──────────────────────────────────────────────────────────────────────────
  log('\n🧹 Cleanup');
  log('─'.repeat(40));

  if (adminSocket) adminSocket.disconnect();
  if (memberSocket) memberSocket.disconnect();
  if (thirdSocket) thirdSocket.disconnect();
  log('  Disconnected all sockets', 0);

  // ──────────────────────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  TEST SUMMARY');
  console.log(`${'═'.repeat(60)}`);
  console.log(`  ✓ Passed:  ${results.passed}`);
  console.log(`  ✗ Failed:  ${results.failed}`);
  console.log(`  ○ Skipped: ${results.skipped}`);
  console.log(`  Total:     ${results.passed + results.failed + results.skipped}`);
  console.log(`${'═'.repeat(60)}`);

  if (results.errors.length > 0) {
    console.log('\n❌ FAILED TESTS DETAILS:');
    console.log('─'.repeat(60));
    for (const err of results.errors) {
      console.log(`\n  Test: ${err.test}`);
      console.log(`  Error: ${err.error}`);
      if (err.stack) {
        const stackLines = err.stack.split('\n').slice(1, 4).map(l => `    ${l.trim()}`);
        console.log(`  Stack:\n${stackLines.join('\n')}`);
      }
    }
    console.log('─'.repeat(60));
  }

  if (results.failed > 0) {
    throw new Error(`${results.failed} test(s) failed`);
  }

  console.log('\n✅ All tests passed!\n');
}
