const { AsyncLocalStorage } = require('node:async_hooks');
const { makeTraceId } = require('./trace');

const als = new AsyncLocalStorage();

function runWithTrace(traceId, fn) {
  const id = String(traceId || '').trim() || makeTraceId();
  return als.run({ traceId: id }, fn);
}

function enterWithTrace(traceId) {
  const id = String(traceId || '').trim() || makeTraceId();
  // Sets context for the current async execution chain.
  // Useful when we cannot easily wrap a large handler body.
  als.enterWith({ traceId: id });
  return id;
}

function getTraceId() {
  return als.getStore()?.traceId || null;
}

module.exports = { runWithTrace, enterWithTrace, getTraceId };


