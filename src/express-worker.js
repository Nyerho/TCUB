const path = require('node:path');
const templatesPromise = import('./template-loader.js');

function renderTemplate(name, data, parentName = name, templates) {
  const template = templates[name];
  if (!template) throw new Error(`Unknown view: ${name}`);
  const include = (includeName, includeData = {}) => {
    const resolved = includeName.startsWith('.')
      ? path.posix.normalize(path.posix.join(path.posix.dirname(parentName), includeName))
      : includeName;
    return renderTemplate(resolved.replace(/^\.\//, ''), { ...data, ...includeData }, resolved.replace(/^\.\//, ''), templates);
  };
  return template(data, undefined, include);
}

function compilePath(pattern, end = true) {
  const keys = [];
  const source = pattern.split('/').filter(Boolean).map((part) => {
    if (part.startsWith(':')) { keys.push(part.slice(1)); return '([^/]+)'; }
    if (part === '*') { keys.push('0'); return '(.*)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return { regex: new RegExp(`^/${source}${end ? '/?$' : '(?:/|$)'}`), keys };
}

function decorateRequest(req) {
  if (req.__workerDecorated) return req;
  req.__workerDecorated = true;
  const originalUrl = req.url || '/';
  Object.defineProperty(req, 'path', { configurable: true, get: () => new URL(req.url || '/', 'http://worker').pathname });
  Object.defineProperty(req, 'query', { configurable: true, get: () => Object.fromEntries(new URL(req.url || '/', 'http://worker').searchParams) });
  req.get = (name) => req.headers[String(name).toLowerCase()];
  req.header = req.get;
  req.protocol = req.headers['x-forwarded-proto'] || 'https';
  req.secure = req.protocol === 'https';
  req.ip = req.headers['cf-connecting-ip'] || req.socket?.remoteAddress || '127.0.0.1';
  req.originalUrl = originalUrl;
  return req;
}

function decorateResponse(res, app) {
  if (res.__workerDecorated) return res;
  res.__workerDecorated = true;
  res.locals = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.type = (value) => { res.setHeader('content-type', value.includes('/') ? value : `text/${value}; charset=utf-8`); return res; };
  res.json = (value) => { if (!res.headersSent) res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
  res.send = (value) => { if (typeof value === 'object' && !Buffer.isBuffer(value)) return res.json(value); res.end(String(value ?? '')); };
  res.redirect = (codeOrUrl, maybeUrl) => {
    const code = typeof codeOrUrl === 'number' ? codeOrUrl : 302;
    const url = typeof codeOrUrl === 'number' ? maybeUrl : codeOrUrl;
    res.statusCode = code;
    res.setHeader('location', url);
    res.end();
  };
  res.clearCookie = (name) => { res.setHeader('set-cookie', `${name}=; Max-Age=0; Path=/; HttpOnly`); };
  res.render = (view, options = {}, callback) => {
    const data = { ...res.locals, ...options };
    templatesPromise.then(({ templates }) => {
      try {
        const html = renderTemplate(view.replace(/\.ejs$/, ''), data, view.replace(/\.ejs$/, ''), templates);
        if (callback) return callback(null, html);
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(html);
      } catch (error) {
        if (callback) return callback(error);
        res.status(500).send(error.message);
      }
    }).catch((error) => {
      if (callback) return callback(error);
      res.status(500).send(error.message);
    });
  };
  return res;
}

class Router {
  constructor() { this.layers = []; }
  use(...args) {
    let prefix = '';
    if (typeof args[0] === 'string') prefix = args.shift();
    const handlers = args.flat();
    for (const handler of handlers) {
      const callable = typeof handler === 'function' ? handler : (req, res, next) => handler.handle(req, res, next);
      this.layers.push({ method: null, prefix, handler: callable, mount: true });
    }
    return this;
  }
  register(method, pattern, handlers) {
    this.layers.push({ method, pattern, compiled: compilePath(pattern), handlers: handlers.flat(), mount: false });
    return this;
  }
  get(pattern, ...handlers) { return this.register('GET', pattern, handlers); }
  post(pattern, ...handlers) { return this.register('POST', pattern, handlers); }
  put(pattern, ...handlers) { return this.register('PUT', pattern, handlers); }
  patch(pattern, ...handlers) { return this.register('PATCH', pattern, handlers); }
  delete(pattern, ...handlers) { return this.register('DELETE', pattern, handlers); }
  async handle(req, res, done = () => {}) {
    decorateRequest(req); decorateResponse(res, this);
    console.log(`[router] ${req.method} ${req.url}`);
    let index = 0;
    const next = async (error) => {
      if (error) return done(error);
      const layer = this.layers[index++];
      if (!layer) return done();
      console.log(`[router] layer ${index} ${layer.method || 'use'} ${layer.pattern || layer.prefix || ''}`);
      if (layer.mount) {
        const pathname = new URL(req.url || '/', 'http://worker').pathname;
        if (layer.prefix && pathname !== layer.prefix && !pathname.startsWith(`${layer.prefix}/`)) return next();
        const previousUrl = req.url;
        if (layer.prefix) req.url = req.url.slice(layer.prefix.length) || '/';
        try { await invoke(layer.handler, req, res, next); } finally { req.url = previousUrl; }
        return;
      }
      if (layer.method !== req.method) return next();
      const match = layer.compiled.regex.exec(new URL(req.url || '/', 'http://worker').pathname);
      if (!match) return next();
      req.params = {};
      layer.compiled.keys.forEach((key, i) => { req.params[key] = decodeURIComponent(match[i + 1] || ''); });
      await invokeHandlers(layer.handlers, req, res, next);
    };
    await next();
  }
}

async function invoke(handler, req, res, next) {
  try {
    const result = handler(req, res, next);
    if (result && typeof result.then === 'function') await result;
  } catch (error) { console.error('[router] middleware error', error); await next(error); }
}
async function invokeHandlers(handlers, req, res, next, index = 0) {
  if (index >= handlers.length) return next();
  const handler = handlers[index];
  if (handler.length === 4) return invokeHandlers(handlers, req, res, next, index + 1);
  let called = false;
  const localNext = async (error) => { called = true; if (error) return next(error); return invokeHandlers(handlers, req, res, next, index + 1); };
  await invoke(handler, req, res, localNext);
  if (!called && !res.writableEnded && index + 1 < handlers.length) await invokeHandlers(handlers, req, res, next, index + 1);
}

function createExpress() {
  const router = new Router();
  const app = (req, res, next) => router.handle(req, res, next);
  app.layers = router.layers;
  app.handle = router.handle.bind(app);
  app.register = router.register.bind(app);
  for (const method of ['use', 'get', 'post', 'put', 'patch', 'delete']) app[method] = router[method].bind(app);
  app.settings = {};
  app.set = (key, value) => { app.settings[key] = value; return app; };
  app.locals = {};
  app.listen = (_port, _host, callback) => { callback?.(); return { close() {} }; };
  return app;
}
createExpress.Router = () => new Router();
createExpress.json = () => async (req, _res, next) => { await parseBody(req); next(); };
createExpress.urlencoded = () => async (req, _res, next) => { await parseBody(req); next(); };
createExpress.static = () => (_req, _res, next) => next();

async function parseBody(req) {
  if (req.__bodyParsed) return;
  req.__bodyParsed = true;
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || (!req.headers['content-length'] && !req.headers['transfer-encoding'])) {
    req.body = {};
    return;
  }
  const type = String(req.headers['content-type'] || '');
  if (!type.includes('application/json') && !type.includes('application/x-www-form-urlencoded')) {
    req.body = {};
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) { req.body = {}; return; }
  if (type.includes('application/json')) {
    try { req.body = JSON.parse(raw); } catch { req.body = {}; }
  } else {
    req.body = Object.fromEntries(new URLSearchParams(raw));
  }
}

module.exports = createExpress;
