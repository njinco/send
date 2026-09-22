## How big of a file can I transfer with Send?

The default maximum file size is 2.5 GiB, but the host may change it. Send
encrypts and decrypts the files in the browser which is great for
security but will tax your system resources.  In particular you can expect to
see your memory usage go up by at least the size of the file when the transfer
is processing.  You can see [the results of some
testing](https://github.com/mozilla/send/issues/170#issuecomment-314107793). For
the most reliable operation on common computers, it’s probably best to stay
under a few hundred megabytes.

## Why is my browser not supported?

We’re using the [Web Cryptography JavaScript API with the AES-GCM
algorithm](https://www.w3.org/TR/WebCryptoAPI/#aes-gcm) for our encryption.
Many browsers support this standard and should work fine, but some have not
implemented it yet (mobile browsers lag behind on this, in
particular).

## Why does Send require JavaScript?

Send uses JavaScript to:

- Encrypt and decrypt files locally on the client instead of the server.
- Render the user interface.
- Manage translations on the website into [various different languages](https://github.com/timvisee/send#localization).

The host may optionally configure Sentry error reporting. It is disabled unless
the host supplies Sentry configuration, and the browser does not initialize it
when the browser's Do Not Track setting is enabled. Check the operator's privacy
policy for how a particular instance handles diagnostics.

Since Send is an open source project, you can see all of the cool ways we use JavaScript by [examining our code](https://github.com/timvisee/send/).

## How long are files available for?

The default selected expiry is 24 hours. The host can configure the available
expiry options and maximum lifetime. When an upload expires, its Redis metadata
expires and the link stops working. The app deletes the stored file when the
download limit is reached, but it does not automatically remove local, S3, or
GCS file data when the Redis expiry time elapses. Instance operators must
configure and verify storage cleanup or lifecycle policies for expired files;
until then, the encrypted file data may remain in storage after its link stops
working.

## Can a file be downloaded more than once?

Yes, once a file is submitted to Send you can select the download limit.


*Disclaimer: Send is an experiment and under active development.  The answers
here may change as we get feedback from you and the project matures.*
