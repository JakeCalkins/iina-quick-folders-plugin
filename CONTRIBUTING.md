# Contributing to Quick Folders

Thank you for your interest in contributing to Quick Folders! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please be respectful and constructive in all interactions. We aim to maintain a welcoming environment for all contributors.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates. When creating a bug report, include:

- **Clear title and description**
- **Steps to reproduce** the issue
- **Expected behavior** vs actual behavior
- **IINA version** and macOS version
- **Plugin version**
- **Screenshots** if applicable
- **Console logs** from IINA's log viewer (if relevant)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, include:

- **Clear title and description**
- **Use case** - explain why this would be useful
- **Proposed solution** or implementation approach
- **Alternatives considered**
- **Mockups or examples** if applicable

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Set up development environment**:
   ```sh
   iina-plugin link quick-folders.iinaplugin
   ```
3. **Make your changes**:
   - Follow the existing code style
   - Add comments for complex logic
   - Update documentation if needed
4. **Test your changes** thoroughly:
   - Test with different folder structures
   - Verify all preferences work
   - Check keyboard shortcuts
   - Ensure no console errors
5. **Update CHANGELOG.md** with your changes
6. **Commit your changes** with clear commit messages
7. **Push to your fork** and submit a pull request

### Pull Request Guidelines

- **One feature per PR** - Keep PRs focused
- **Include tests** if applicable
- **Update documentation** as needed
- **Follow code style** of the existing codebase
- **Write clear commit messages**
  - Use present tense ("Add feature" not "Added feature")
  - Reference issues and PRs when relevant

## Development Process

### Setting Up Development Environment

1. Install IINA 1.4.0 or later
2. Clone the repository
3. Link plugin for development:
   ```sh
   iina-plugin link quick-folders.iinaplugin
   ```
4. Make changes and restart IINA to test

### Code Structure

```
quick-folders.iinaplugin/
├── main.js           # Main plugin entry point
├── constants.js      # Configuration constants
├── preferences.html  # Settings UI
└── ui/              # Quick Folders window
    ├── index.html
    ├── app.js
    ├── messaging.js
    └── styles.css
```

### Testing

- Test with various folder structures and depths
- Verify all filter options work correctly
- Test keyboard shortcuts don't conflict
- Check preferences persistence
- Test with different IINA versions if possible

### Building

To create a distributable package:
```sh
iina-plugin pack quick-folders.iinaplugin
```

## Coding Standards

### JavaScript Style

- Use modern JavaScript (ES6+) features where supported
- Use `const` and `let`, avoid `var`
- Destructure imports: `const { core, event } = iina;`
- Use arrow functions for callbacks
- Add comments for complex logic
- Keep functions focused and single-purpose

### Naming Conventions

- **Variables/Functions**: camelCase (`myVariable`, `handleClick`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_DEPTH`, `DEFAULT_FILTER`)
- **Classes**: PascalCase (`FileManager`, `FolderBrowser`)
- **Private methods**: Prefix with underscore (`_internalMethod`)

### Documentation

- Add JSDoc comments for public functions
- Keep comments up to date with code changes
- Explain "why" not just "what"

## Questions?

Feel free to open an issue with your question or reach out to the maintainers.

## License

By contributing, you agree that your contributions will be licensed under the GNU General Public License v3.0.
