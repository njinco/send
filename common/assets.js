const genmap = require('./generate_asset_map');
const path = require('path');
const isServer = typeof genmap === 'function';
let prefix = '';
let manifest = {};
try {
  //eslint-disable-next-line node/no-missing-require
  manifest = require('../dist/manifest.json');
} catch (e) {
  // use middleware
}

const assets = isServer ? manifest : genmap;

function getAsset(name) {
  return prefix + assets[name];
}

function setPrefix(name) {
  prefix = name;
}

function getMatches(match) {
  return Object.keys(assets)
    .filter(k => match.test(k))
    .map(getAsset);
}

const instance = {
  setPrefix: setPrefix,
  get: getAsset,
  match: getMatches,
  setMiddleware: function(middleware) {
    function getManifest() {
      const context = middleware.context;
      const fileSystem = context
        ? context.outputFileSystem
        : middleware.fileSystem;
      const filename = context
        ? path.join(
            (context.compiler.compilers || [context.compiler])[0].options.output
              .path,
            'manifest.json'
          )
        : middleware.getFilenameFromUrl('/manifest.json');
      return JSON.parse(fileSystem.readFileSync(filename));
    }
    if (middleware) {
      instance.get = function getAssetWithMiddleware(name) {
        const m = getManifest();
        return prefix + m[name];
      };
      instance.match = function matchAssetWithMiddleware(match) {
        const m = getManifest();
        return Object.keys(m)
          .filter(k => match.test(k))
          .map(k => prefix + m[k]);
      };
    }
  }
};

module.exports = instance;
