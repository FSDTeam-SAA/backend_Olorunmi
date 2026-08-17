/**
 * Thin holder for the Socket.IO server instance so controllers can broadcast
 * without importing server.js (which would create a circular import).
 */
let ioInstance = null;

export const setSocketServer = (io) => {
  ioInstance = io;
};

export const getSocketServer = () => ioInstance;

/**
 * Broadcasts to the "alerts" room that admin clients join on connect.
 */
export const emitToAlerts = (event, payload) => {
  if (!ioInstance) return;
  ioInstance.to("alerts").emit(event, payload);
};
