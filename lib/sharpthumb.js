const path = require('path');

const debug = require('debug')('ideaspark-sharpthumb');
const fs = require('fs-extra');
const sharp = require('sharp');

// resize staticPath and save to cachePath
async function cache(staticPath, cachePath, params) {
  try {
    await fs.ensureDir(cachePath.replace(/[^/]+$/u, ''));
  } catch (err) {
    console.error(err);
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
    debug(err);

    return cache(staticPath, cachePath, params);
  }

  if (staticStat.lastModified() > cacheStat.lastModified()) {
    throw new Error('Live file has not been modified and will not be cached');
  }

  return cachePath;
}

// call cacheIfStale() if resize params are set
// otherwise send static static file if it exists and options.serveStatic is true
// otherwise call next()
async function handle(options, req, res, next) {
  const staticUrl = decodeURI(req.originalUrl.replace(/\?.*/u, ''));
  const staticPath = path.normalize(options.staticDir + staticUrl);
  const cachePath = path.join(options.cacheDir, safeDirName(req.query), staticUrl);

  let stat;

  try {
    stat = await fs.stat(staticPath);
  } catch (err) {
    debug(staticUrl, 'next()', err);

    return next();
  }

  if (!stat.isFile()) {
    debug(staticUrl, 'next()', 'not a file');

    return next();
  }

  let foundPath;

  if (shouldResize(req)) {
    foundPath = await cacheIfStale(stat, staticPath, cachePath, req.query);
  } else if (options.serveStatic) {
    foundPath = staticPath;
  } else {
    debug(staticUrl, 'next()', 'done without needing to do anything');

    return next();
  }

  debug(staticUrl, foundPath);

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
