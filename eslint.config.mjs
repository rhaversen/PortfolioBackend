// @ts-check

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import eslint from '@eslint/js'
import { FlatCompat } from '@eslint/eslintrc'
import stylistic from '@stylistic/eslint-plugin'
import eslintConfigPrettier from 'eslint-config-prettier'
import * as importPlugin from 'eslint-plugin-import'
import nPlugin from 'eslint-plugin-n'
import promisePlugin from 'eslint-plugin-promise'
import tseslint from 'typescript-eslint'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const compat = new FlatCompat({
	baseDirectory: __dirname,
})

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	...compat.extends('plugin:promise/recommended', 'plugin:n/recommended-module'),
	eslintConfigPrettier,

	{
		files: ['**/*.ts'],
		plugins: {
			'@stylistic': stylistic,
			import: importPlugin,
			n: nPlugin,
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			promise: promisePlugin,
			'@typescript-eslint': tseslint.plugin
		},
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				project: './tsconfig.json',
				ecmaVersion: 'latest',
				sourceType: 'module'
			}
		},
		settings: {
			'import/parsers': {
				'@typescript-eslint/parser': ['.ts']
			},
			'import/resolver': {
				typescript: {
					project: './tsconfig.json'
				}
			}
		},
		rules: {
			'@typescript-eslint/strict-boolean-expressions': 'error',
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
			'no-console': ['error'],
			'import/first': 'error',
			'import/order': [
				'error',
				{
					alphabetize: { order: 'asc', caseInsensitive: true },
					groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
					'newlines-between': 'always'
				}
			],
			'import/newline-after-import': 'error',
			'import/no-duplicates': 'error',
			'import/no-unresolved': 'error',
			'import/no-named-as-default': 'warn',
			'import/no-named-as-default-member': 'off',
			'import/no-extraneous-dependencies': 'off',
			'import/no-mutable-exports': 'error',
			'import/no-amd': 'error',
			'import/no-commonjs': 'off',
			'import/no-nodejs-modules': 'off',
			'import/no-self-import': 'error',
			'import/no-useless-path-segments': 'error',
			'import/no-relative-parent-imports': 'off',
			'import/no-absolute-path': 'error',
			'import/extensions': [
				'error',
				'ignorePackages',
				{ ts: 'never' }
			],
			'n/no-missing-import': 'off',
			'@stylistic/semi': ['error', 'never'],
			'@stylistic/no-extra-semi': 'error',
			'@stylistic/quotes': ['error', 'single'],
			'@stylistic/no-tabs': 'off',
			'@stylistic/indent': ['error', 'tab', { SwitchCase: 1 }],
			'@stylistic/object-curly-spacing': ['error', 'always'],
			'@stylistic/array-bracket-spacing': ['error', 'never'],
			'@stylistic/key-spacing': ['error', { beforeColon: false, afterColon: true }],
			'@stylistic/space-before-function-paren': ['error', 'always'],
			'@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
			'@stylistic/no-multi-spaces': 'error',
			'@stylistic/block-spacing': ['error', 'always'],
			'@stylistic/space-in-parens': ['error', 'never'],
			'@stylistic/comma-dangle': ['error', 'never'],
			'@stylistic/padded-blocks': ['error', 'never'],
			'@stylistic/no-trailing-spaces': 'error',
			'@stylistic/spaced-comment': ['error', 'always'],
			'@stylistic/no-multiple-empty-lines': ['error', { max: 1, maxEOF: 1 }],
			curly: ['error', 'all']
		}
	},

	{
		files: ['src/app/utils/passportConfig.ts', 'src/types/**/*.d.ts'],
		rules: {
			'@typescript-eslint/no-namespace': 'off',
			'@typescript-eslint/no-empty-object-type': 'off',
			'@typescript-eslint/no-explicit-any': 'off'
		}
	},

	{
		files: ['src/test/**/*.ts', 'src/development/**/*.ts', 'src/app/utils/ngrokDev.ts'],
		rules: {
			'n/no-unpublished-import': 'off',
			'n/no-extraneous-import': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
			'n/no-process-exit': 'off',
			'import/no-mutable-exports': 'off',
			'@typescript-eslint/no-unused-vars': 'off'
		}
	},

	{
		ignores: ['node_modules/**', 'dist/**']
	}
)
