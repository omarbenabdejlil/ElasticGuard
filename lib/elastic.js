const { Client } = require('@elastic/elasticsearch');

let client = null;
let connectionConfig = null;

function createClient(config) {
  const opts = { node: config.node };

  if (config.username && config.password) {
    opts.auth = { username: config.username, password: config.password };
  }
  if (config.apiKey) {
    opts.auth = { apiKey: config.apiKey };
  }
  if (config.caFingerprint) {
    opts.caFingerprint = config.caFingerprint;
  }

  // Skip TLS verification if requested (dev/self-signed certs)
  if (config.skipTLS) {
    opts.tls = { rejectUnauthorized: false };
  }

  client = new Client(opts);
  connectionConfig = config;
  return client;
}

function getClient() {
  return client;
}

function getConfig() {
  return connectionConfig;
}

function isConnected() {
  return client !== null;
}

function disconnect() {
  client = null;
  connectionConfig = null;
}

module.exports = { createClient, getClient, getConfig, isConnected, disconnect };
