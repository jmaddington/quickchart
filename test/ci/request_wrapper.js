/**
 * This wrapper intercepts calls to the deprecated 'request' package
 * and uses node-fetch instead, preventing the SSRF vulnerability in request.
 */

const fetch = require('node-fetch');
const originalRequest = require('request');
const { URL } = require('url');

// Create a secure wrapper around request
function secureRequest(options, callback) {
  // If options is a string, convert it to an object with a URL
  if (typeof options === 'string') {
    options = { url: options };
  }

  // Get the URL and HTTP method from the options
  const url = options.url || options.uri;
  const method = (options.method || 'GET').toUpperCase();

  // Validate URL to prevent SSRF
  try {
    const parsedUrl = new URL(url);

    // Block requests to private networks
    const hostname = parsedUrl.hostname;
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.16.') ||
      hostname.startsWith('192.168.')
    ) {
      const error = new Error('SSRF protection: Requests to private networks are not allowed');
      return callback(error);
    }

    // Block requests to non-HTTP protocols
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      const error = new Error(`SSRF protection: Protocol ${parsedUrl.protocol} is not allowed`);
      return callback(error);
    }
  } catch (error) {
    return callback(new Error(`Invalid URL: ${error.message}`));
  }

  // Convert request options to fetch options
  const fetchOptions = {
    method,
    headers: options.headers || {},
  };

  // Add body if present
  if (options.body) {
    fetchOptions.body = options.body;
  }

  // Perform the fetch request
  fetch(url, fetchOptions)
    .then(response => {
      // Convert the response to a buffer
      return response.buffer().then(buffer => {
        const res = {
          statusCode: response.status,
          headers: response.headers.raw(),
          body: buffer,
        };

        // Call the callback with the response
        callback(null, res, buffer);
      });
    })
    .catch(error => {
      callback(error);
    });
}

// Export a function that has the same API as the original request
module.exports = function wrappedRequest(options, callback) {
  return secureRequest(options, callback);
};

// Copy over helper methods from the original request
Object.keys(originalRequest).forEach(key => {
  if (typeof originalRequest[key] === 'function') {
    module.exports[key] = function() {
      // Redirect to our secure implementation
      return secureRequest(arguments[0], arguments[1]);
    };
  } else {
    module.exports[key] = originalRequest[key];
  }
});
