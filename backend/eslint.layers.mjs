// The dependency rule of docs/concept/architecture.md#dependency-rule, built on
// ESLint's own no-restricted-imports (no plugin: eslint-plugin-boundaries pulls
// in an unfixed advisory, see the report of FEATURE-001 slice 1).
// Paths are relative to the lint's working directory, so the proof in
// features/support/layers.spec.ts can run the same rules over lint-fixtures/.
//
// A rule is an import specifier that must not match. Each block below sets the
// whole option for its files, so a block lists everything its files may not do.

const folder = (name) => `(^|/)${name}(/|$)`
const BAN = {
  application: folder('application'),
  ports: folder('ports'),
  fakes: folder('fakes'),
  adapters: folder('adapters'),
  entry: String.raw`(^|/)src/(server|collector|stash)\.ts$`,
  steps: folder('features'),
  // Anything that is not a relative path: a Node built-in or a package.
  outside: String.raw`^(?!\.{1,2}/)`,
}
const PROGRAMS = ['node:child_process', 'child_process']

// no-restricted-imports for a file that may not import the named layers, nor
// start a program unless `programs` is set.
const imports = (layers, { programs = false } = {}) => [
  'error',
  {
    ...(programs
      ? {}
      : {
          paths: PROGRAMS.map((name) => ({
            name,
            message: 'Only the iCloud Photos adapter and the guardian start a program.',
          })),
        }),
    patterns: layers.map((layer) => ({
      regex: BAN[layer],
      message: `This file may not import ${layer}: dependencies point inward only.`,
    })),
  },
]

const block = (files, rule, ignores = []) => ({
  files,
  ignores,
  rules: { 'no-restricted-imports': rule },
})

// The same restriction for a layer's production files and for its unit tests,
// which are the one place a fake may be imported from.
const layer = (dir, banned, options) => [
  block([`src/${dir}/**/*.ts`], imports([...banned, 'fakes'], options), ['**/*.spec.ts']),
  block([`src/${dir}/**/*.spec.ts`], imports(banned, options)),
]

// features/support/ is the harness, not app code: it runs cucumber as a program.
const source = ['src/**/*.ts', 'features/steps/**/*.ts']

export const layers = [
  // Everything else under src/ and features/: no adapter, no program.
  block(source, imports(['adapters'])),
  // Domain imports only domain: no layer, no built-in, no package.
  block(
    ['src/domain/**/*.ts'],
    imports(['application', 'ports', 'fakes', 'adapters', 'entry', 'steps', 'outside']),
    ['**/*.spec.ts'],
  ),
  // ... its unit tests need the test runner, so built-ins and packages are theirs.
  block(
    ['src/domain/**/*.spec.ts'],
    imports(['application', 'ports', 'adapters', 'entry', 'steps']),
  ),
  ...layer('ports', ['application', 'adapters', 'entry', 'steps']),
  ...layer('application', ['adapters', 'entry', 'steps']),
  ...layer('fakes', ['application', 'adapters', 'entry', 'steps']),
  // Adapters may import adapters; only the iCloud Photos adapter and the guardian
  // start a program (Tesseract, as the OCR engine, runs inside the guardian).
  ...layer('adapters', ['entry', 'steps']),
  block(
    ['src/adapters/sources/icloud-photos/**/*.ts', 'src/adapters/guardian/**/*.ts'],
    imports(['entry', 'steps', 'fakes'], { programs: true }),
  ),
  // The entry points wire the adapters.
  block(['src/server.ts', 'src/collector.ts', 'src/stash.ts'], imports(['fakes', 'steps'])),
  // Step definitions: application, ports, fakes; real adapters only in the integration subset.
  block(['features/steps/**/*.ts'], imports(['adapters', 'entry'])),
  block(['features/steps/**/*.integration.steps.ts'], imports(['entry'])),
  {
    // The photo library is never read directly: its package is named in no string.
    files: source,
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/photoslibrary/i]',
          message: 'The photo library is never read directly.',
        },
        {
          selector: 'TemplateElement[value.raw=/photoslibrary/i]',
          message: 'The photo library is never read directly.',
        },
      ],
    },
  },
]
