const serverless = require('serverless-http');
const app = require('../../server');

module.exports.handler = serverless(app, {
  binary: ['image/*', 'application/pdf', 'application/octet-stream']
});
