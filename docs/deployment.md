## Requirements

This guide describes a Linux deployment with Apache as a TLS-terminating reverse
proxy. Use a currently supported Linux distribution, Node.js 24 LTS (24.x; see
`.nvmrc`), Git, Apache, and Redis. Redis is required by production deployments
for upload metadata. The local-filesystem storage path must also be configured
to use persistent storage; its default is a temporary directory.

## Building

* Configure an Apache virtual host and choose an application directory owned by
  the dedicated, unprivileged Send service account.
* Clone the repository into that directory, then install the lockfile-defined
  dependencies and build the production assets:

```bash
git clone https://github.com/njinco/send.git /srv/send
cd /srv/send
npm run check:runtime
npm ci
npm run build
```

* Set `NODE_ENV=production`, `PORT=1443`, `BASE_URL` to the public HTTPS URL,
  and configure Redis plus a persistent local upload directory or one object
  storage backend. See the configuration table in [Docker documentation](docker.md)
  and `server/config.js` for supported values. For S3, `AWS_REGION` is required.
* Run the process under a service manager (such as systemd) as the dedicated
  unprivileged account; do not run the application as root. Keep secrets in a
  protected environment file or secret manager, outside version control.

## Running

Configure your service manager to run `npm run prod` from the checkout directory
with the production environment and dedicated service account. The server
listens on port 1443 by default. Confirm it is reachable locally before
configuring Apache:

```bash
curl --fail http://127.0.0.1:1443/__heartbeat__
```

## Reverse Proxy

Of course, we don't want to expose the service on port 1443. Instead we want our normal webserver to forward all requests to Send ("Reverse proxy").

# Apache webserver

* Enable Apache required modules:

```bash
sudo a2enmod headers
sudo a2enmod proxy
sudo a2enmod proxy_http
sudo a2enmod proxy_wstunnel
sudo a2enmod rewrite
```

* Edit your Apache virtual host configuration file, insert this:

```
# Enable rewrite engine
RewriteEngine on

# Make sure the original domain name is forwarded to Send
# Otherwise the generated URLs will be wrong
ProxyPreserveHost on

# Make sure the generated URL is https://
RequestHeader set X-Forwarded-Proto https

# If it's a normal file (e.g. PNG, CSS) just return it
RewriteCond %{REQUEST_FILENAME} -f
RewriteRule .* - [L]

# If it's a websocket connection, redirect it to a Send WS connection
RewriteCond %{HTTP:Upgrade} =websocket [NC]
RewriteRule /(.*) ws://127.0.0.1:1443/$1 [P,L]

# Otherwise redirect it to a normal HTTP connection
RewriteRule ^/(.*)$ http://127.0.0.1:1443/$1 [P,QSA]
ProxyPassReverse  "/" "http://127.0.0.1:1443"
```

Send does not trust forwarded headers by default. Configure `TRUST_PROXY` with
only the address, CIDR, or hop count appropriate to the trusted proxy path;
never trust arbitrary client-supplied forwarded headers. For a load balancer
with changing addresses, choose a narrowly scoped trusted network and ensure
the application port cannot be reached directly by untrusted clients. Check
the `TRUST_PROXY` setting against the actual proxy topology before enabling
client-IP-based rate limits.

* Test configuration and restart Apache:

```bash
sudo apache2ctl configtest
sudo systemctl restart apache2
```
