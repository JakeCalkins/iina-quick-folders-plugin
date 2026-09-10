# Security policy

## Supported version

Security fixes target the latest released version of Quick Folders. Users should update through IINA or install the newest package from [GitHub Releases](https://github.com/JakeCalkins/iina-quick-folders-plugin/releases/latest).

## Reporting a vulnerability

Please do not disclose a suspected vulnerability in a public issue. Use GitHub's **Report a vulnerability** option on the repository's Security tab when private vulnerability reporting is available. If that option is unavailable, contact the repository owner privately through the contact method on their GitHub profile.

Include:

- The affected Quick Folders and IINA versions
- A concise description of the impact
- Reproduction steps or a proof of concept
- Whether filesystem access, crafted filenames, or untrusted plugin packages are involved
- Any suggested mitigation

Remove unrelated private media filenames and filesystem paths. The maintainer will acknowledge the report when received, assess its impact, and coordinate disclosure with the reporter when practical.

## Scope

Quick Folders has permission to browse and permanently delete files explicitly selected through its UI. Reports about escaping configured folder roots, unintended deletion, unsafe path handling, or release-package integrity are especially important.
