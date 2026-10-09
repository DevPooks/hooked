# Security policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not include live credentials, third-party personal data, or a public proof of concept in an issue.

Include the affected route or component, expected impact, reproduction steps using synthetic data, and any proposed mitigation. Reports will be acknowledged and assessed before public discussion.

## Supported version

The latest commit on `main` is the supported development version. This project is an educational reference and has not had an independent security audit.

## Deployment warning

Version 0.1 has no API authentication and stores endpoint signing secrets without encryption at rest. Do not expose it as a multi-tenant internet service without addressing the controls documented in [docs/security.md](docs/security.md).
