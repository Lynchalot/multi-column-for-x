module.exports = {
  sourceDir: '.',
  artifactsDir: 'web-ext-artifacts',
  ignoreFiles: ['test', 'store', '.github', 'package.json', 'package-lock.json', 'README.md', 'CHANGELOG.md', 'PRIVACY.md', 'CLAUDE.md', 'LICENSE', 'web-ext-config.cjs', '.gitignore', 'node_modules'],
  build: { overwriteDest: true },
};
