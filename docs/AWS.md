# Deployment to AWS

This document describes how to do a deployment of Send in AWS

## AWS requirements

### Security groups (2)

* ALB:
  - inbound: allow traffic from anywhere on port 80 and 443
  - outbound: allow traffic to the instance security group on port `8080`

* Instance:
  - inbound: allow SSH from your public IP or a bastion (changing the default SSH port is a good idea)
  - inbound: allow traffic from the ALB security group on port `8080`
  - outbound: allow only the egress required by the deployment, such as package
    repositories during installation, the configured storage and Redis services,
    DNS/time services, and optional Sentry. Prefer VPC endpoints or narrowly
    scoped network controls where available.

### Resources

* An S3 bucket (block all public access)

* A private EC2 instance running a currently supported Ubuntu LTS release (use
  the [Amazon EC2 AMI Locator](https://cloud-images.ubuntu.com/locator/ec2/) to
  select a maintained image)

  Attach an IAM role to the instance with the following inline policy:

  ```json
  {
      "Version": "2012-10-17",
      "Statement": [
          {
              "Action": [
                  "s3:ListBucket"
              ],
              "Resource": [
                  "arn:aws:s3:::<s3_bucket_name>"
              ],
              "Effect": "Allow"
          },
          {
              "Action": [
                  "s3:GetObject",
                  "s3:PutObject",
                  "s3:AbortMultipartUpload",
                  "s3:DeleteObject"
              ],
              "Resource": [
                  "arn:aws:s3:::<s3_bucket_name>/*"
              ],
              "Effect": "Allow"
          }
      ]
  }
  ```

This policy is scoped to the configured bucket and the current S3 adapter's
operations: bucket health check, object reads and writes, managed multipart
upload cancellation, and deletion. If the bucket enforces SSE-KMS with a
customer-managed key, also grant the required `kms:GenerateDataKey` and
`kms:Decrypt` permissions on that key, update its key policy as needed, and
test uploads and downloads with the deployment role.

* A public ALB:

  - Create a target group with the instance registered (HTTP on port `8080` and path `/`)
  - Configure HTTP (port 80) to redirect to HTTPS (port 443)
  - HTTPS (port 443) using the latest security policy and an ACM certificate like `send.mydomain.com`

* A Route53 public record, alias from `send.mydomain.com` to the ALB

## Software requirements

* Git
* Node.js `24.x` LTS
* Local Redis server

### Prerequisite packages

```bash
sudo apt update
sudo apt install -y apt-transport-https ca-certificates curl software-properties-common
```

### Add repositories

* Node.js `24.x` LTS (see [package.json](../package.json)):

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
```

* Git (latest)

```bash
sudo add-apt-repository ppa:git-core/ppa
```

* Redis (latest)

```bash
sudo add-apt-repository ppa:redislabs/redis
```

### Install required packages

```bash
sudo apt update
sudo apt install git nodejs redis-server telnet
```

### Redis server

#### Password (optional)

Generate a strong password:

```bash
makepasswd --chars=100
```

Edit Redis configuration file `/etc/redis/redis.conf`:

```bash
requirepass <redis_password>
```

_Note: documentation on securing Redis https://redis.io/topics/security_

#### Systemd

Enable and (re)start the Redis server service:

```bash
sudo systemctl enable redis-server
sudo systemctl restart redis-server
sudo systemctl status redis-server
```

## Website directory

Setup a directory for the data

```
sudo mkdir -pv /var/www/send
sudo chown www-data:www-data /var/www/send
sudo chmod 750 /var/www/send
```

### NodeJS

Check the installed Node.js and bundled npm versions:

```bash
node --version
npm --version
```

Clone the repository, install the locked JavaScript dependencies, and compile
the production assets:

```bash
sudo su -l www-data -s /bin/bash
cd /var/www/send
git clone https://gitlab.com/timvisee/send.git .
npm run check:runtime
npm ci
npm run build
exit
```

Create the file `/var/www/send/.env` used by Systemd with your environment variables
(checkout [config.js](../server/config.js) for more configuration environment variables):

```
BASE_URL='https://send.mydomain.com'
NODE_ENV='production'
PORT='8080'
REDIS_PASSWORD='<redis_password>'
S3_BUCKET='<s3_bucket_name>'
AWS_REGION='<aws_region>'
TRUST_PROXY='<trusted ALB address or narrowly scoped CIDR>'
```

Keep the environment file readable only by the service account and root. Set
`TRUST_PROXY` only after confirming the ALB-to-instance network path and
restricting direct access to the application port to that ALB. Choose exactly
one storage backend. The example IAM policy should be reviewed against the
operations enabled in your deployment and narrowed to the bucket and actions
actually required.

Lower files and folders permissions to user and group `www-data`:

```
sudo find /var/www/send -type d -exec chmod 750 {} \;
sudo find /var/www/send -type f -exec chmod 640 {} \;
sudo find -L /var/www/send/node_modules/.bin/ -exec chmod 750 {} \;
```

### Systemd

Create the file `/etc/systemd/system/send.service` with `root` user and `644` mode:

```
[Unit]
Description=Send
After=network.target
Requires=redis-server.service
Documentation=https://gitlab.com/timvisee/send

[Service]
Type=simple
ExecStart=/usr/bin/npm run prod
EnvironmentFile=/var/www/send/.env
WorkingDirectory=/var/www/send
User=www-data
Group=www-data
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

_Note: could be better tuner to secure the service by restricting system permissions,
check with `systemd-analyze security send`_

Enable and start the Send service, check logs:

```
sudo systemctl daemon-reload
sudo systemctl enable send
sudo systemctl start send
sudo systemctl status send
journalctl -fu send
```
