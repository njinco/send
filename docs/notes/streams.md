# Web Streams

## Firefox download streaming follow-up

- Production Firefox 155 downloads failed with a `.part` “source cannot be read” error when the service-worker streaming path was enabled.
- The same download succeeded after disabling Firefox service workers, which forces Send's blob-based download path. Production logs showed the encrypted `/api/download/:id` response completing with HTTP 200 and 23,757 bytes, pointing away from a storage read failure.
- Current workaround: `app/capabilities.js` disables streaming downloads for Firefox, so Firefox uses the blob-based path. This has been confirmed working in production with Firefox service workers enabled.
- Later priority: identify and fix the underlying Firefox service-worker streaming failure; add a regression test for the streaming path before considering re-enabling it. Compare fresh downloads through both paths and inspect client-side stream/decryption failures. Do not reuse or share one-time links/HARs containing credentials.

## Mobile Chrome download authorization follow-up

- This issue belonged to the `send` web app serving `send.enkiel.org`, not the separate `ffsend` command-line client. The web fix is in `njinco/send` commit `3e399a54` (`Use authenticated blob downloads on mobile Chrome`); it did not require a CLI change.
- Symptom: desktop downloads worked, but Android Chrome showed an “authorization needed” download notification after tapping Download.
- Likely cause, based on the request paths and symptom: the streaming download depends on a service worker intercepting a browser request to the protected `/api/download/:id` route. If that interception does not happen, the request lacks the required authorization header and the server returns HTTP 401. We did not capture a mobile network trace, so this is an inference rather than a confirmed browser-level cause.
- Fix: `app/capabilities.js` turns off streaming downloads for mobile Chrome. Its existing blob download path requests `/api/download/blob/:id` with the authorization header, then decrypts and saves the file in the browser.
- Verification: the production build and automated tests passed (167 backend and 24 frontend tests), and the site owner confirmed that a fresh link downloads successfully on mobile Chrome after deployment.
- Existing share links are not invalidated by this code change. Their original expiry and download-count limits still apply. When retesting, use a fresh link with enough lifetime and downloads for both desktop and mobile checks. Do not publish share links or network captures containing their credentials.
- The blob path holds the download in browser memory, so keep the existing large-file warning in mind when testing files over 256 MiB. Revisit mobile streaming only after reproducing the failure and adding a regression test.

- API
  - https://developer.mozilla.org/en-US/docs/Web/API/Streams_API
- Reference Implementation
  - https://github.com/whatwg/streams/tree/master/reference-implementation
- Examples
  - https://github.com/mdn/dom-examples/tree/master/streams
- Polyfill
  - https://github.com/MattiasBuelens/web-streams-polyfill

# Encrypted Content Encoding

- Spec
  - https://trac.tools.ietf.org/html/rfc8188
- node.js implementation
  - https://github.com/web-push-libs/encrypted-content-encoding/tree/master/nodejs

# Other APIs

- Blobs
  - https://developer.mozilla.org/en-US/docs/Web/API/Blob
- ArrayBuffers, etc
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array
- FileReader
  - https://developer.mozilla.org/en-US/docs/Web/API/FileReader

# Other

- node.js Buffer browser library
  - https://github.com/feross/buffer
- StreamSaver
  - https://github.com/jimmywarting/StreamSaver.js
