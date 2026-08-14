/**
 * MongoDB connection module.
 *
 * Exposes:
 *   - connectDb()         -> Promise<Mongoose>
 *   - getDbStatus()       -> 'connected' | 'connecting' | 'disconnected' | 'error'
 *   - getConnectionHost() -> string (for health endpoint reporting)
 *
 * behaviour:
 *   - connectDb() is called once during server bootstrap.
 *   - If MongoDB is unreachable, the server STILL starts (so the operator can
 *     hit /api/health and see the failure), but every collection operation
 *     will fail loudly at call-time. This is intentional: hiding a DB outage
 *     behind a false "connected" status would violate acceptance.
 */
import mongoose from 'mongoose';
import { env } from './env.js';
import { log } from '../utils/logger.js';

let connectionState = 'disconnected';
let connectionHost = null;

mongoose.connection.on('connected', () => {
  connectionState = 'connected';
  connectionHost = mongoose.connection.host;
  log('info', `MongoDB connected → ${connectionHost}`);
});

mongoose.connection.on('connecting', () => {
  connectionState = 'connecting';
});

mongoose.connection.on('disconnected', () => {
  connectionState = 'disconnected';
  log('warn', 'MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  connectionState = 'error';
  // Never log the full URI — it may contain credentials.
  log('error', 'MongoDB connection error:', err.message);
});

/**
 * Connect to MongoDB using MONGODB_URI from env.
 *
 * @returns {Promise<typeof mongoose>}
 */
export async function connectDb() {
  log('info', 'Connecting to MongoDB…');
  // Mongoose 8 default timeouts: serverSelectionTimeoutMS = 30000ms.
  // We lower it so a misconfigured URI fails fast during dev startup.
  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    dbName: undefined, // use the db from the URI
  });
  return mongoose;
}

/**
 * @returns {'connected'|'connecting'|'disconnected'|'error'}
 */
export function getDbStatus() {
  // Prefer the live mongoose state if it disagrees with our cached value
  // (e.g. an unexpected drop after we last heard an event).
  const raw = mongoose.connection.readyState;
  // Mongoose readyState: 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  if (raw === 1) return 'connected';
  if (raw === 2) return 'connecting';
  if (raw === 3) return 'disconnected';
  if (raw === 0) {
    return connectionState === 'error' ? 'error' : 'disconnected';
  }
  return 'disconnected';
}

/**
 * @returns {string|null}
 */
export function getConnectionHost() {
  return connectionHost ?? mongoose.connection.host ?? null;
}

/**
 * Graceful shutdown helper.
 */
export async function closeDb() {
  try {
    await mongoose.disconnect();
    log('info', 'MongoDB connection closed');
  } catch (err) {
    log('error', 'Error closing MongoDB connection:', err.message);
  }
}
