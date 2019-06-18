const path = require('path');

const debug = require('debug')('ideaspark-sharpthumb');
const fs = require('fs-extra');
const sharp = require('sharp');

function trimPathPrefix(inPath) {
  const components = inPath.split('/');

  return components.slice(2).join('/');
}

// resize staticPath and save to cachePath
async function cache(staticPath, cachePath, params) {
  const cacheDir = path.dirname(cachePath);

  try {
    await fs.ensureDir(cacheDir);
  } catch (err) {
    console.error(err.stack);

    return staticPath;
  }

  const pipeline = sharp(staticPath);

  pipeline.resize(
    params.width ? parseInt(params.width, 10) : null,
    params.height ? parseInt(params.height, 10) : null,
  );

  if (params.withoutEnlargement) {
    pipeline.withoutEnlargement();
  }

  if (params.background) {
    pipeline.background(params.background);
  }

  if (params.crop) {
    pipeline.crop(params.crop);
  }

  if (params.flatten) {
    pipeline.flatten();
  }

  if (params.max) {
    pipeline.max();
  }

  if (params.min) {
    pipeline.min();
  }

  try {
    return pipeline.toFile(cachePath);
  } catch (err) {
    console.error('Error caching', staticPath, err);
    return staticPath;
  }
}

// call cache() if staticPath has been modified after cachePath was modified
async function cacheIfStale(staticStat, staticPath, cachePath, params) {
  let cacheStat;

  try {
    cacheStat = await fs.stat(cachePath);
  } catch (err) {
    debug(err.stack);

    return cache(staticPath, cachePath, params);
  }

  if (staticStat.mtime > cacheStat.mtime) {
    throw new Error('Live file has not been modified and will not be cached');
  }

  return cachePath;
}

// call cacheIfStale() if resize params are set
// otherwise send static static file if it exists and options.serveStatic is true
// otherwise call next()
async function handle(options, req, res, next) {
  const staticUrl = decodeURI(req.originalUrl.replace(/\?.*/u, ''));
  const childPath = path.normalize(trimPathPrefix(staticUrl));
  const staticPath = path.join(options.staticDir, childPath);
  const cachePath = path.join(options.cacheDir, safeDirName(req.query), childPath);

  let stat;

  try {
    stat = await fs.stat(staticPath);
  } catch (err) {
    debug(childPath, 'next()', err);

    return next();
  }

  if (!stat.isFile()) {
    debug(childPath, 'next()', 'not a file');

    return next();
  }

  let foundPath;

  if (shouldResize(req)) {
    try {
      foundPath = await cacheIfStale(stat, staticPath, cachePath, req.query);
    } catch (err) {
      debug(err.stack);
    }
  }

  if (!foundPath && options.serveStatic) {
    foundPath = staticPath;
  } else {
    debug(childPath, 'next()', 'done without needing to do anything');

    return next();
  }

  debug('sending', childPath, foundPath);

  return res.sendFile(foundPath);
}

// wrapper to convert handle() to a middleware function
function middleware(options) {
  return async function (req, res, next) {
    debug(`ideaspark-sharpthumb is attempting to handle ${req.originalUrl}`);
    await handle(options, req, res, next);
  };
}

// convert query params into a directory name
function safeDirName(obj) {
  return JSON.stringify(obj).replace(/[^\w,=:]/gu, '');
}

function shouldResize(req) {
  if (req.path.match(/\.svg$/iu)) { // ignore .svg files
    return false;
  }
  if (req.query.width || req.query.height) {
    return true;
  }
}

// express/connect middleware
function staticMiddleware(staticDir, options) {
  const normalizedDir = path.normalize(staticDir);

  const defaults = {
    cacheDir: path.join(normalizedDir, '.cache'),
    serveStatic: false,
    staticDir: normalizedDir,
  };

  const effectiveOpts = Object.assign(defaults, options);

  return middleware(effectiveOpts);
}

module.exports = {
  static: staticMiddleware,
};
