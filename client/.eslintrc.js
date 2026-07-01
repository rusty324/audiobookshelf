// ESLint config for the client (Nuxt 2 / Vue 2).
// Focus: catch real bugs (undefined vars, invalid Vue templates) while keeping adoption
// tractable. Formatting is handled by Prettier, so stylistic rules are left off here.
module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2022: true
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  // vue/essential = Vue 2 error-prevention rules only (no style opinions).
  extends: ['eslint:recommended', 'plugin:vue/essential'],
  globals: {
    // Nuxt / build-time globals available in the client runtime
    $nuxt: 'readonly',
    process: 'readonly',
    // Google Cast SDK globals (loaded via external script in the chromecast plugin)
    cast: 'readonly',
    chrome: 'readonly'
  },
  ignorePatterns: ['node_modules/', 'dist/', '.nuxt/', 'static/', 'cypress/'],
  rules: {
    // High-value bug catchers kept as errors
    'no-undef': 'error',
    'no-unreachable': 'error',
    'no-dupe-keys': 'error',
    'no-const-assign': 'error',
    'vue/no-dupe-keys': 'error',
    'vue/require-v-for-key': 'error',
    // Nuxt uses single-word page/component file names (pages/index.vue, oops.vue) by design
    'vue/multi-word-component-names': 'off',
    // Pre-existing noise downgraded to warnings for gradual burn-down
    'no-unused-vars': 'warn',
    'no-empty': 'warn',
    'no-prototype-builtins': 'warn',
    'no-useless-escape': 'warn',
    'no-redeclare': 'warn',
    'no-extra-boolean-cast': 'warn',
    'no-case-declarations': 'warn',
    'no-async-promise-executor': 'warn',
    'no-constant-condition': 'warn',
    'no-inner-declarations': 'warn',
    'no-control-regex': 'off',
    'vue/no-unused-components': 'warn',
    'vue/no-mutating-props': 'warn',
    'vue/no-use-v-if-with-v-for': 'warn',
    'vue/no-side-effects-in-computed-properties': 'warn',
    'vue/return-in-computed-property': 'warn'
  }
}
