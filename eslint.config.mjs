// A small lint aimed at real bugs, not style: names that do not exist, duplicate keys,
// dead code, and the rules of React hooks. `npm run lint` must stay at zero errors;
// warnings are a to-do list, not a gate.
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

const bugs = {
  "no-undef": "error",
  "no-dupe-keys": "error",
  "no-unreachable": "error",
  "no-self-assign": "error",
  "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", ignoreRestSiblings: true }],
};

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "release/**",
      "public/**",
      "legacy/**",
      "references/**",
      "relay/**",
      // Generated from design/ by scripts/dc-to-jsx.mjs.
      "src/design/**",
      // Starting points for the projects a bot creates: they are not Colmena's code.
      "server/projects/templates/**",
      // Page snippets pasted into a browser automation, not modules.
      "scripts/*.snippet.js",
    ],
  },
  // Disable comments for rules this config does not load (react-hooks outside src/) stay quiet.
  { linterOptions: { reportUnusedDisableDirectives: "off" } },
  {
    files: ["server/**/*.mjs", "tests/**/*.mjs", "scripts/**/*.mjs", "eval/**/*.mjs", "*.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node } },
    rules: bugs,
  },
  {
    files: ["desktop/**/*.cjs", "scripts/**/*.cjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "commonjs", globals: { ...globals.node } },
    rules: bugs,
  },
  {
    // The QA and measuring scripts hand functions to a browser page (page.evaluate).
    files: ["scripts/**/*.{mjs,cjs}"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Preloads and page scripts run in a renderer: Node's and the browser's names.
    files: ["desktop/preload-*.cjs"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["desktop/**/*.js"],
    languageOptions: { ecmaVersion: "latest", sourceType: "script", globals: { ...globals.browser } },
    rules: bugs,
  },
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...bugs,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
