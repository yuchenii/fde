# Security Policy

## Supported Versions

We release patches for security vulnerabilities for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of FDE seriously. If you believe you have found a security vulnerability, please report it to us as described below.

### Please DO NOT:

- Open a public issue on GitHub
- Publicly disclose the vulnerability before it has been addressed

### Please DO:

1. **Email us** at security@your-domain.com (or create a private security advisory on GitHub)
2. **Include details**:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Acknowledgment** - We'll acknowledge your report within 48 hours
- **Updates** - We'll keep you informed about our progress
- **Credit** - We'll credit you in the security advisory (unless you prefer to remain anonymous)

### Security Best Practices

When using FDE:

1. **Keep tokens secure** - Never commit tokens to version control
2. **Use strong tokens** - Generate random, long tokens (32+ characters)
3. **HTTPS only** - Always use HTTPS in production
4. **Regular updates** - Keep FDE updated to the latest version
5. **Limit access** - Restrict server access to trusted networks
6. **Review logs** - Regularly check deployment logs for suspicious activity

### Example Secure Configuration

```yaml
# server.yaml
port: 3000

environments:
  prod:
    # Use environment variable, not hardcoded token
    token: ${DEPLOY_TOKEN}
    uploadPath: "/var/www/html"
    deployCommand: "nginx -s reload"
```

```bash
# Set token via environment variable
export DEPLOY_TOKEN=$(openssl rand -hex 32)
```

## Known Security Considerations

- **Token-based authentication** - Tokens should be treated like passwords
- **File uploads** - Only accept uploads from trusted sources
- **Command execution** - Deploy commands run with server privileges
- **Checksum verification** - Always enable checksum verification in production

## Security Updates

Security updates will be released as patch versions and announced via:

- GitHub Security Advisories
- GitHub Releases
- CHANGELOG.md

---

Thank you for helping keep FDE secure! 🔒
