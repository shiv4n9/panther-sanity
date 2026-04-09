# Contributing to Panther Sanity Dashboard

Thank you for your interest in contributing! 🎉

## Getting Started

1. **Fork the repository**
   ```bash
   # Click "Fork" on GitHub
   git clone https://github.com/YOUR_USERNAME/panther-sanity.git
   cd panther-sanity
   ```

2. **Set up development environment**
   ```bash
   # Backend
   cd backend
   ./install.sh
   
   # Frontend
   npm install
   ```

3. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Workflow

### Backend Changes

1. Make changes to `backend/server.py`
2. Test locally:
   ```bash
   cd backend
   source venv/bin/activate
   python server.py
   ```
3. Test endpoints:
   ```bash
   curl http://localhost:3001/health
   ```

### Frontend Changes

1. Make changes to React components
2. Test locally:
   ```bash
   npm run dev
   ```
3. Check browser console for errors
4. Test on different screen sizes

### Code Style

**Python:**
- Follow PEP 8
- Use meaningful variable names
- Add docstrings to functions
- Handle errors gracefully

**JavaScript/React:**
- Use functional components
- Follow existing code style
- Use meaningful component names
- Add comments for complex logic

## Testing

### Backend
```bash
cd backend
python -m py_compile server.py
python -c "import server"
```

### Frontend
```bash
npm run build
npm run lint
```

## Submitting Changes

1. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: Add new feature"
   ```

   Commit message format:
   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation
   - `style:` Formatting
   - `refactor:` Code restructuring
   - `test:` Adding tests
   - `chore:` Maintenance

2. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```

3. **Create Pull Request**
   - Go to GitHub
   - Click "New Pull Request"
   - Describe your changes
   - Link any related issues

## Pull Request Guidelines

- ✅ Clear description of changes
- ✅ Tests pass (CI/CD)
- ✅ No console errors
- ✅ Documentation updated
- ✅ Code follows style guide
- ✅ Commits are meaningful

## Reporting Issues

### Bug Reports

Include:
- Description of the bug
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots (if applicable)
- Environment (OS, Python version, Node version)

### Feature Requests

Include:
- Clear description
- Use case
- Expected behavior
- Mockups (if applicable)

## Code Review Process

1. Maintainer reviews PR
2. Feedback provided
3. Changes requested (if needed)
4. Approval and merge

## Questions?

- Open an issue
- Check existing documentation
- Review QUICKSTART.md and DEPLOYMENT_GUIDE.md

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing! 🚀
