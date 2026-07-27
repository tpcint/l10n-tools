import { defineConfig } from 'oxlint'
import stylistic from '@stylistic/eslint-plugin'

// @stylistic의 `customize`를 그대로 재사용해 stylistic 룰셋이 플러그인 한 곳에만
// 정의되도록 한다. oxlint jsPlugins로 실행된다.
const stylisticRules = stylistic.configs.customize({
  braceStyle: '1tbs',
  indent: 2,
  quotes: 'single',
}).rules

export default defineConfig({
  plugins: ['typescript', 'oxc', 'import'],
  jsPlugins: ['@stylistic/eslint-plugin', 'eslint-plugin-import-newlines'],
  env: { builtin: true, es2025: true, node: true },
  ignorePatterns: ['**/dist'],
  categories: { correctness: 'error' },
  // type-aware 룰은 oxlint-tsgolint가 처리한다. tsgolint는 tsconfig의 `baseUrl`을
  // 지원하지 않는데, 이 리포는 baseUrl을 쓰지 않으므로 그대로 켤 수 있다.
  options: { typeAware: true },
  rules: {
    'prefer-const': ['error', { destructuring: 'all' }],
    'sort-imports': ['error', { ignoreCase: true, ignoreDeclarationSort: true }],
    'no-unused-vars': ['error', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^ignore',
    }],
    'typescript/consistent-type-imports': ['error', {
      disallowTypeAnnotations: false,
      fixStyle: 'inline-type-imports',
      prefer: 'type-imports',
    }],
    'typescript/no-import-type-side-effects': 'error',
    'typescript/no-explicit-any': 'off',
    'typescript/no-non-null-assertion': 'off',
    'typescript/no-redundant-type-constituents': 'off',
    'typescript/no-deprecated': 'warn',
    'typescript/return-await': ['error', 'error-handling-correctness-only'],
    'typescript/restrict-template-expressions': ['error', {
      allowBoolean: true,
      allowNever: true,
      allowNumber: true,
      allowNullish: true,
    }],
    // typescript-eslint `strict-type-checked` 대응. oxlint의 `correctness` 카테고리가
    // 켜지 않는 type-aware / TS 룰을 명시적으로 켠다. `pedantic` 카테고리를 통째로 켜면
    // 무관한 복잡도/스타일 룰(max-lines, no-inline-comments 등)까지 딸려오고
    // core/typescript 중복 리포트(require-await, throw-literal)가 생긴다.
    // no-unsafe-* 계열 (any를 따라다니며 발생)
    'typescript/no-unsafe-argument': 'error',
    'typescript/no-unsafe-assignment': 'error',
    'typescript/no-unsafe-call': 'error',
    'typescript/no-unsafe-enum-comparison': 'error',
    'typescript/no-unsafe-function-type': 'error',
    'typescript/no-unsafe-member-access': 'error',
    'typescript/no-unsafe-return': 'error',
    // promise / async / error handling
    'typescript/no-misused-promises': 'error',
    'typescript/only-throw-error': 'error',
    'typescript/prefer-promise-reject-errors': 'error',
    'typescript/require-await': 'error',
    'typescript/use-unknown-in-catch-callback-variable': 'error',
    // no-unnecessary-* (대부분 autofix 가능)
    'typescript/no-unnecessary-boolean-literal-compare': 'error',
    'typescript/no-unnecessary-template-expression': 'error',
    'typescript/no-unnecessary-type-arguments': 'error',
    'typescript/no-unnecessary-type-assertion': 'error',
    'typescript/no-unnecessary-type-constraint': 'error',
    'typescript/no-unnecessary-type-conversion': 'error',
    'typescript/no-unnecessary-type-parameters': 'error',
    // type-system hygiene
    'typescript/ban-ts-comment': ['error', { minimumDescriptionLength: 10 }],
    'typescript/no-confusing-void-expression': 'error',
    // `delete map[key]`는 이 리포에서 정상 패턴이다 (기존 ESLint 설정에서도 껐다).
    'typescript/no-dynamic-delete': 'off',
    'typescript/no-empty-object-type': 'error',
    'typescript/no-extraneous-class': 'error',
    'typescript/no-invalid-void-type': 'error',
    'typescript/no-mixed-enums': 'error',
    'typescript/no-namespace': 'error',
    'typescript/no-non-null-asserted-nullish-coalescing': 'error',
    'typescript/no-require-imports': 'error',
    'typescript/prefer-literal-enum-member': 'error',
    'typescript/prefer-reduce-type-parameter': 'error',
    'typescript/prefer-return-this-type': 'error',
    'typescript/related-getter-setter-pairs': 'error',
    'typescript/restrict-plus-operands': ['error', {
      allowAny: false,
      allowBoolean: false,
      allowNullish: false,
      allowNumberAndString: false,
      allowRegExp: false,
    }],
    'typescript/unified-signatures': 'error',
    // 공용 설정에는 없는 이 리포 고유 추가.
    // union 타입(TransPluralKey, DomainType, SyncTarget 등)에 멤버를 추가하고
    // switch 케이스를 빠뜨리는 걸 막는다.
    'typescript/switch-exhaustiveness-check': 'error',
    // 로그 문자열을 템플릿 리터럴로 조립하는 곳이 많아 `[object Object]`를 막는다.
    'typescript/no-base-to-string': 'error',
    'import/no-duplicates': ['error', { 'prefer-inline': true }],
    'import/no-named-as-default-member': 'off',
    'import/newline-after-import': ['error', { count: 1, exactCount: true, considerComments: true }],
    'import-newlines/enforce': ['error', 20, 120],
    ...stylisticRules,
    '@stylistic/arrow-parens': ['error', 'as-needed'],
    '@stylistic/function-call-spacing': ['error', 'never'],
    '@stylistic/member-delimiter-style': ['error', {
      multiline: { delimiter: 'comma', requireLast: true },
      singleline: { delimiter: 'comma', requireLast: false },
    }],
    '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
    '@stylistic/multiline-ternary': 'off',
    '@stylistic/operator-linebreak': 'off',
    '@stylistic/jsx-closing-bracket-location': 'off',
    '@stylistic/jsx-first-prop-new-line': 'off',
    '@stylistic/jsx-max-props-per-line': 'off',
  },
  overrides: [
    {
      files: ['**/*.test.ts'],
      rules: {
        'typescript/require-await': 'off',
        // node:test의 `describe`/`it`은 Promise를 반환하지만 await하지 않는 것이
        // 정상 사용법이다.
        'typescript/no-floating-promises': 'off',
        // `assert.throws(() => obj.method(), ...)` 형태의 arrow shorthand.
        'typescript/no-confusing-void-expression': 'off',
        // 테스트는 `JSON.parse(...)` 결과를 그대로 단언하는 경우가 많다.
        'typescript/no-unsafe-argument': 'off',
        'typescript/no-unsafe-assignment': 'off',
        'typescript/no-unsafe-call': 'off',
        'typescript/no-unsafe-member-access': 'off',
        'typescript/no-unsafe-return': 'off',
      },
    },
  ],
})
