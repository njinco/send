# Web Streams

## Firefox download streaming follow-up

- Production Firefox 155 downloads failed with a `.part` “source cannot be read” error when the service-worker streaming path was enabled.
- The same download succeeded after disabling Firefox service workers, which forces Send's blob-based download path. Production logs showed the encrypted `/api/download/:id` response completing with HTTP 200 and 23,757 bytes, pointing away from a storage read failure.
- Current workaround: `app/capabilities.js` disables streaming downloads for Firefox, so Firefox uses the blob-based path. This has been confirmed working in production with Firefox service workers enabled.
- Later priority: identify and fix the underlying Firefox service-worker streaming failure; add a regression test for the streaming path before considering re-enabling it. Compare fresh downloads through both paths and inspect client-side stream/decryption failures. Do not reuse or share one-time links/HARs containing credentials.

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
