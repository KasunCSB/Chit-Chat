#!/usr/bin/env node
// =============================================================================
// ChitChat Status Aggregator
// =============================================================================
// Runs on Oracle VM (load balancer) to provide overall system status
// Usage: node status-aggregator.js
// Endpoint: http://localhost:3001/api/status
//
// Environment Variables:
//   STATUS_PORT     - Port to listen on (default: 3001)
//   BACKEND_SERVERS - Comma-separated list of backend servers
//                     Format: id:host:port,id:host:port
//                     Example: azure-vm-1:52.230.91.238:3000,azure-vm-2:4.194.203.184:3000
// =============================================================================

const http = require('http');

const PORT = process.env.STATUS_PORT || 3001;

// Parse backend servers from environment variable
function parseBackends() {
  const envBackends = process.env.BACKEND_SERVERS;
  if (!envBackends) {
    console.error('ERROR: BACKEND_SERVERS environment variable not set');
    console.error('Example: BACKEND_SERVERS=vm1:192.168.1.1:3000,vm2:192.168.1.2:3000');
    process.exit(1);
  }

  return envBackends.split(',').map((server) => {
    const [id, host, port] = server.trim().split(':');
    return { id, host, port: parseInt(port, 10) };
  });
}

const BACKENDS = parseBackends();

// Fetch server info with timeout
function fetchServerInfo(backend) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ serverId: backend.id, status: 'unreachable', error: 'timeout' });
    }, 3000);

    const req = http.get(
      `http://${backend.host}:${backend.port}/api/server-info`,
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          clearTimeout(timeout);
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve({ serverId: backend.id, status: 'error', error: 'invalid response' });
          }
        });
      }
    );

    req.on('error', () => {
      clearTimeout(timeout);
      resolve({ serverId: backend.id, status: 'unreachable', error: 'connection failed' });
    });

    req.end();
  });
}

// Get nginx status
function getNginxStatus() {
  return new Promise((resolve) => {
    require('child_process').exec('systemctl is-active nginx', (err, stdout) => {
      resolve(stdout.trim() === 'active');
    });
  });
}

// Main handler
async function handleStatus(req, res) {
  const startTime = Date.now();

  // Fetch all backend statuses in parallel
  const backendStatuses = await Promise.all(BACKENDS.map(fetchServerInfo));

  // Get nginx status
  const nginxActive = await getNginxStatus();

  // Aggregate
  const healthyBackends = backendStatuses.filter((b) => b.status === 'healthy').length;
  const totalClients = backendStatuses.reduce((sum, b) => sum + (b.clients || 0), 0);
  const totalRooms = backendStatuses.length > 0 ? backendStatuses[0].rooms || 0 : 0; // Redis is shared

  let overallStatus = 'healthy';
  if (healthyBackends === 0) overallStatus = 'down';
  else if (healthyBackends < BACKENDS.length) overallStatus = 'degraded';
  if (!nginxActive) overallStatus = 'down';

  const status = {
    status: overallStatus,
    loadBalancer: {
      host: 'oracle-vm',
      nginx: nginxActive ? 'running' : 'stopped',
    },
    backends: backendStatuses.map((b) => ({
      id: b.serverId,
      status: b.status,
      uptime: b.uptime ? `${Math.floor(b.uptime / 60)}m` : null,
      memory: b.memory ? `${b.memory}MB` : null,
      redis: b.redis?.connected ? `${b.redis.latency}ms` : 'disconnected',
      clients: b.clients || 0,
    })),
    summary: {
      healthyBackends: `${healthyBackends}/${BACKENDS.length}`,
      totalClients,
      activeRooms: totalRooms,
    },
    timestamp: new Date().toISOString(),
    responseTime: `${Date.now() - startTime}ms`,
  };

  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(status, null, 2));
}

// Simple HTTP server
const server = http.createServer((req, res) => {
  if (req.url === '/api/status' && req.method === 'GET') {
    handleStatus(req, res);
  } else if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'status-aggregator' }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`Status aggregator running on port ${PORT}`);
  console.log(`Monitoring backends: ${BACKENDS.map((b) => b.host).join(', ')}`);
});
