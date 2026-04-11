# Changelog

## [7.7.0](https://github.com/tpcint/l10n-tools/compare/l10n-tools-core-v7.6.0...l10n-tools-core-v7.7.0) (2026-04-11)


### Miscellaneous Chores

* **deps:** bump tinyglobby from 0.2.15 to 0.2.16 ([#281](https://github.com/tpcint/l10n-tools/issues/281)) ([2308a2d](https://github.com/tpcint/l10n-tools/commit/2308a2d31e3b84eb504638c6f5ace3273da40330))


### Features

* **syncer-l10n-storage:** add locale-sync-map and --source CLI option ([#286](https://github.com/tpcint/l10n-tools/issues/286)) ([a985d27](https://github.com/tpcint/l10n-tools/commit/a985d27f66d9d88ff35002e739ba40d17a6092a6))


### Code Refactoring

* run tests from source via tsx with --conditions source ([#284](https://github.com/tpcint/l10n-tools/issues/284)) ([d6e5306](https://github.com/tpcint/l10n-tools/commit/d6e53063fff07143283893a14ee871f13eaf0247))

## [7.6.0](https://github.com/tpcint/l10n-tools/compare/l10n-tools-core-v7.5.0...l10n-tools-core-v7.6.0) (2026-04-09)


### Features

* **core:** support L10N_SYNC_TARGET env var to override sync target ([#278](https://github.com/tpcint/l10n-tools/issues/278)) ([5b21ec8](https://github.com/tpcint/l10n-tools/commit/5b21ec8dcb20c63717bf81ce3b6e565d97a125e5))

## [7.5.0](https://github.com/tpcint/l10n-tools/compare/l10n-tools-core-v7.4.1...l10n-tools-core-v7.5.0) (2026-04-09)


### Features

* add syncer-l10n-storage for tpc-agent l10n-storage ([#276](https://github.com/tpcint/l10n-tools/issues/276)) ([7ef2c24](https://github.com/tpcint/l10n-tools/commit/7ef2c24825cca5992fe1c440d8d74639676b5729))

## [7.4.1](https://github.com/tpcint/l10n-tools/compare/l10n-tools-core-v7.4.0...l10n-tools-core-v7.4.1) (2026-03-28)


### Miscellaneous Chores

* **deps-dev:** bump ts-json-schema-generator from 2.5.0 to 2.9.0 ([#253](https://github.com/tpcint/l10n-tools/issues/253)) ([a9e311e](https://github.com/tpcint/l10n-tools/commit/a9e311ecfd1541dbdea556671dc2bd18bb177747))

## [7.4.0](https://github.com/tpcint/l10n-tools/compare/l10n-tools-core-v7.3.0...l10n-tools-core-v7.4.0) (2026-03-02)


### Features

* **plugin-android:** add default-module option to omit context prefix ([#247](https://github.com/tpcint/l10n-tools/issues/247)) ([e50e064](https://github.com/tpcint/l10n-tools/commit/e50e06494504f91c39ce853866980638b1fefdbd))

## [7.3.0](https://github.com/tpcint/l10n-tools/compare/l10n-tools-core-v7.2.1...l10n-tools-core-v7.3.0) (2026-02-13)


### Miscellaneous Chores

* replace ts-node with tsx for test runner ([#227](https://github.com/tpcint/l10n-tools/issues/227)) ([d3581db](https://github.com/tpcint/l10n-tools/commit/d3581db9cebdd801dc4e7a79e99943b23252599e))


### Features

* **cli:** add download command for download-only sync ([#231](https://github.com/tpcint/l10n-tools/issues/231)) ([e8e53f0](https://github.com/tpcint/l10n-tools/commit/e8e53f003d68400c72814cf10361a0a35223c6e2))

## [7.2.1](https://github.com/tpcint/l10n-tools/compare/l10n-tools-core-v7.2.0...l10n-tools-core-v7.2.1) (2026-02-05)


### Miscellaneous Chores

* **deps-dev:** bump ts-json-schema-generator from 2.4.0 to 2.5.0 ([#216](https://github.com/tpcint/l10n-tools/issues/216)) ([9c813a8](https://github.com/tpcint/l10n-tools/commit/9c813a8680d6734a1b4d89bbeee25a81e5679ac6))

## [7.2.0](https://github.com/tpcint/l10n-tools/compare/l10n-tools-core-v7.1.0...l10n-tools-core-v7.2.0) (2026-02-04)


### Features

* **plugin-android:** add multi-module support ([#210](https://github.com/tpcint/l10n-tools/issues/210)) ([a4edc5d](https://github.com/tpcint/l10n-tools/commit/a4edc5da10b0aab618760c59b710c44980883bac))

## [7.1.0](https://github.com/tpcint/l10n-tools/compare/l10n-tools-core-v7.0.0...l10n-tools-core-v7.1.0) (2026-02-04)


### Features

* add comment extraction for iOS and upload comments on new keys ([#209](https://github.com/tpcint/l10n-tools/issues/209)) ([286bfdd](https://github.com/tpcint/l10n-tools/commit/286bfdd3ddbaf15050e0f5bdb9f058dca7037a03))

## [7.0.0](https://github.com/tpcint/l10n-tools/compare/l10n-tools-core-v6.3.0...l10n-tools-core-v7.0.0) (2026-02-03)


### ⚠ BREAKING CHANGES

* plugin architecture and monorepo refactoring ([#197](https://github.com/tpcint/l10n-tools/issues/197))

### Miscellaneous Chores

* cleanup-version ([#199](https://github.com/tpcint/l10n-tools/issues/199)) ([3d7257c](https://github.com/tpcint/l10n-tools/commit/3d7257c056a4868ad8f64a92320d75c7bebc695d))


### Features

* plugin architecture and monorepo refactoring ([#197](https://github.com/tpcint/l10n-tools/issues/197)) ([183e72c](https://github.com/tpcint/l10n-tools/commit/183e72c582c2091a9a04c656811705d3cdec5ada))
