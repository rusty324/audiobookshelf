// ESLint config for the server (Node.js, CommonJS).
// Focus: catch real bugs (undefined vars, unhandled promises, unreachable code)
// while keeping adoption tractable on the existing codebase. Formatting is handled
// by Prettier, so stylistic rules are intentionally left off here.
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
    mocha: true
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'script'
  },
  extends: ['eslint:recommended', 'plugin:promise/recommended'],
  globals: {
    // Set on globalThis at startup (see index.js / server bootstrap)
    global: 'readonly'
  },
  ignorePatterns: ['client/', 'node_modules/', 'dist/', 'build/', 'coverage/', 'server/libs/'],
  rules: {
    // High-value bug catchers kept as errors
    'no-undef': 'error',
    'no-unreachable': 'error',
    'no-fallthrough': 'error',
    // Default (except-parens): flags accidental `if (a = b)` but allows the intentional,
    // explicitly-parenthesized `while ((m = re.exec(s)) != null)` iterator pattern.
    'no-cond-assign': 'error',
    'no-dupe-keys': 'error',
    'no-const-assign': 'error',
    // Pre-existing noise downgraded to warnings so initial adoption doesn't require a
    // full-codebase rewrite; these can be burned down over time.
    'no-unused-vars': 'warn',
    'no-empty': 'warn',
    'no-prototype-builtins': 'warn',
    'no-async-promise-executor': 'warn',
    'no-useless-escape': 'warn',
    'no-redeclare': 'warn',
    'no-dupe-class-members': 'warn',
    'no-control-regex': 'off',
    'promise/always-return': 'off',
    'promise/no-callback-in-promise': 'off',
    'promise/param-names': 'warn'
  }
}
