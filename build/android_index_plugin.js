const path = require('path');
const html = require('choo/html');
const NAME = 'AndroidIndexPlugin';

function chunkFileNames(compilation) {
  const names = {};
  for (const chunk of compilation.chunks) {
    for (const file of chunk.files) {
      if (!/\.map$/.test(file)) {
        names[`${chunk.name}${path.extname(file)}`] = file;
      }
    }
  }
  return names;
}
class AndroidIndexPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap(NAME, compilation => {
      compilation.hooks.processAssets.tap(
        {
          name: NAME,
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL
        },
        () => {
          const files = chunkFileNames(compilation);
          const page = html`
            <html lang="en-US">
              <head>
                <title>Send</title>
                <meta charset="utf-8" />
                <meta
                  name="viewport"
                  content="width=device-width, initial-scale=1"
                />
                <base href="file:///android_asset/" />
                <link href="${files['app.css']}" rel="stylesheet" />
                <script src="${files['android.js']}"></script>
              </head>
              <body></body>
            </html>
          `
            .toString()
            .replace(/\n\s{6}/g, '\n');
          compilation.emitAsset(
            'android.html',
            new compiler.webpack.sources.RawSource(page)
          );
        }
      );
    });
  }
}

module.exports = AndroidIndexPlugin;
