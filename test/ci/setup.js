/**
 * This setup file is used to patch modules before tests run.
 * It should be required at the beginning of test files.
 */

// Override the request module to use our secure wrapper
const Module = require('module');
const originalRequire = Module.prototype.require;

// Store the original path to the request module
const requestPath = require.resolve('request');

// Replace the original require with our patched version
Module.prototype.require = function(path) {
  // If the request for 'request' module, return our secure wrapper
  if (path === 'request' || path === requestPath) {
    return require('./request_wrapper');
  }

  // Otherwise use the original require
  return originalRequire.apply(this, arguments);
};

console.log('Request module patched for security');
