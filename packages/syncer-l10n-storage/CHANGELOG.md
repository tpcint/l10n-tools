# Changelog

## [1.4.0](https://github.com/tpcint/l10n-tools/compare/l10n-tools-syncer-l10n-storage-v1.3.6...l10n-tools-syncer-l10n-storage-v1.4.0) (2026-05-31)


### Miscellaneous Chores

* **deps:** bump es-toolkit from 1.46.1 to 1.47.0 ([#362](https://github.com/tpcint/l10n-tools/issues/362)) ([9b3258e](https://github.com/tpcint/l10n-tools/commit/9b3258ed9229b589f58dd8c534f6436ecc1e7d72))


### Features

* **syncer-l10n-storage:** tag-filtered fetch and (tag,*) unclaim under single-source model ([#363](https://github.com/tpcint/l10n-tools/issues/363)) ([366ed23](https://github.com/tpcint/l10n-tools/commit/366ed23e474340de731352a961f42c23fd7a2413))

## [1.3.6](https://github.com/tpcint/l10n-tools/compare/l10n-tools-syncer-l10n-storage-v1.3.5...l10n-tools-syncer-l10n-storage-v1.3.6) (2026-05-26)


### Bug Fixes

* **syncer-l10n-storage:** claim and clean up PR-source tags in context-less domains ([#358](https://github.com/tpcint/l10n-tools/issues/358)) ([623a61c](https://github.com/tpcint/l10n-tools/commit/623a61c74d62fb4596549b345224e884fb3aff22))

## [1.3.5](https://github.com/tpcint/l10n-tools/compare/l10n-tools-syncer-l10n-storage-v1.3.4...l10n-tools-syncer-l10n-storage-v1.3.5) (2026-05-17)


### Performance Improvements

* **syncer-l10n-storage:** raise list keys page size from 500 to 5000 ([#354](https://github.com/tpcint/l10n-tools/issues/354)) ([0579940](https://github.com/tpcint/l10n-tools/commit/0579940ddd09bd0e47e86aba4badeb6936ec30a2))

## [1.3.4](https://github.com/tpcint/l10n-tools/compare/l10n-tools-syncer-l10n-storage-v1.3.3...l10n-tools-syncer-l10n-storage-v1.3.4) (2026-05-14)


### Bug Fixes

* **syncer-l10n-storage:** accumulate metadata across multi-context keyNames ([#344](https://github.com/tpcint/l10n-tools/issues/344)) ([2e98a15](https://github.com/tpcint/l10n-tools/commit/2e98a1552a9775ea288ae12638901015f8a4142e))
* **syncer-l10n-storage:** scope PR-source claim to actual context additions ([#346](https://github.com/tpcint/l10n-tools/issues/346)) ([df4069c](https://github.com/tpcint/l10n-tools/commit/df4069c6d4b32f980c843d934bb6dee33b164cbc))

## [1.3.3](https://github.com/tpcint/l10n-tools/compare/l10n-tools-syncer-l10n-storage-v1.3.2...l10n-tools-syncer-l10n-storage-v1.3.3) (2026-05-12)


### Bug Fixes

* propagate new Android names to localized strings.xml on PR apply ([#341](https://github.com/tpcint/l10n-tools/issues/341)) ([55d6c92](https://github.com/tpcint/l10n-tools/commit/55d6c921144973702986f5939ec541109a3736df))

## [1.3.2](https://github.com/tpcint/l10n-tools/compare/l10n-tools-syncer-l10n-storage-v1.3.1...l10n-tools-syncer-l10n-storage-v1.3.2) (2026-05-06)


### Bug Fixes

* **syncer-l10n-storage:** match server keys by local source text on download ([#324](https://github.com/tpcint/l10n-tools/issues/324)) ([efdd579](https://github.com/tpcint/l10n-tools/commit/efdd579587b20a3f19f7a04e3ed5d1d4195cd119))

## [1.3.1](https://github.com/tpcint/l10n-tools/compare/l10n-tools-syncer-l10n-storage-v1.3.0...l10n-tools-syncer-l10n-storage-v1.3.1) (2026-05-05)


### Dependencies

* The following workspace dependencies were updated
  * peerDependencies
    * l10n-tools-core bumped from ^8.1.0 to ^8.2.0

## [1.3.0](https://github.com/tpcint/l10n-tools/compare/l10n-tools-syncer-l10n-storage-v1.2.1...l10n-tools-syncer-l10n-storage-v1.3.0) (2026-05-05)


### Features

* add --source filter to check and _compile ([#318](https://github.com/tpcint/l10n-tools/issues/318)) ([f273e76](https://github.com/tpcint/l10n-tools/commit/f273e7684458010dceb66b0af6e6c12f31f919bb))


### Dependencies

* The following workspace dependencies were updated
  * peerDependencies
    * l10n-tools-core bumped from ^8.0.0 to ^8.1.0

## [1.2.1](https://github.com/tpcint/l10n-tools/compare/l10n-tools-syncer-l10n-storage-v1.2.0...l10n-tools-syncer-l10n-storage-v1.2.1) (2026-05-04)


### Miscellaneous Chores

* **deps:** bump es-toolkit from 1.46.0 to 1.46.1 ([#312](https://github.com/tpcint/l10n-tools/issues/312)) ([d338856](https://github.com/tpcint/l10n-tools/commit/d338856ecc6a2db00724ecedc8f15d4a8ce1b83b))

## [1.2.0](https://github.com/tpcint/l10n-tools/compare/l10n-tools-syncer-l10n-storage-v1.1.3...l10n-tools-syncer-l10n-storage-v1.2.0) (2026-04-28)


### Miscellaneous Chores

* **deps:** bump es-toolkit from 1.45.1 to 1.46.0 ([#303](https://github.com/tpcint/l10n-tools/issues/303)) ([a909c3d](https://github.com/tpcint/l10n-tools/commit/a909c3d709ef72fa52a191c6299e503bd95708bf))


### Features

* **syncer-l10n-storage:** switch sync to keys-to-serve API ([#305](https://github.com/tpcint/l10n-tools/issues/305)) ([23fef7d](https://github.com/tpcint/l10n-tools/commit/23fef7d2b99c6ca5500be5db3e24fdfdeac34394))


### Tests

* **syncer-l10n-storage:** add e2e tests against tpc-agent backend ([#306](https://github.com/tpcint/l10n-tools/issues/306)) ([6ce2065](https://github.com/tpcint/l10n-tools/commit/6ce2065453aabf72c1e3bf520ec040c3df26c438))


### Dependencies

* The following workspace dependencies were updated
  * peerDependencies
    * l10n-tools-core bumped from ^7.9.1 to ^8.0.0

## [1.1.3](https://github.com/tpcint/l10n-tools/compare/l10n-tools-syncer-l10n-storage-v1.1.2...l10n-tools-syncer-l10n-storage-v1.1.3) (2026-04-16)


### Dependencies

* The following workspace dependencies were updated
  * peerDependencies
    * l10n-tools-core bumped from ^7.9.0 to ^7.9.1

## [1.1.2](https://github.com/tpcint/l10n-tools/compare/l10n-tools-syncer-l10n-storage-v1.1.1...l10n-tools-syncer-l10n-storage-v1.1.2) (2026-04-11)


### Dependencies

* The following workspace dependencies were updated
  * peerDependencies
    * l10n-tools-core bumped from ^7.8.0 to ^7.9.0

## [1.1.1](https://github.com/tpcint/l10n-tools/compare/l10n-tools-syncer-l10n-storage-v1.1.0...l10n-tools-syncer-l10n-storage-v1.1.1) (2026-04-11)


### Dependencies

* The following workspace dependencies were updated
  * peerDependencies
    * l10n-tools-core bumped from ^7.7.0 to ^7.8.0

## [1.1.0](https://github.com/tpcint/l10n-tools/compare/l10n-tools-syncer-l10n-storage-v1.0.1...l10n-tools-syncer-l10n-storage-v1.1.0) (2026-04-11)


### Features

* **syncer-l10n-storage:** add locale-sync-map and --source CLI option ([#286](https://github.com/tpcint/l10n-tools/issues/286)) ([a985d27](https://github.com/tpcint/l10n-tools/commit/a985d27f66d9d88ff35002e739ba40d17a6092a6))


### Code Refactoring

* run tests from source via tsx with --conditions source ([#284](https://github.com/tpcint/l10n-tools/issues/284)) ([d6e5306](https://github.com/tpcint/l10n-tools/commit/d6e53063fff07143283893a14ee871f13eaf0247))


### Dependencies

* The following workspace dependencies were updated
  * peerDependencies
    * l10n-tools-core bumped from ^7.6.0 to ^7.7.0

## [1.0.1](https://github.com/tpcint/l10n-tools/compare/l10n-tools-syncer-l10n-storage-v1.0.0...l10n-tools-syncer-l10n-storage-v1.0.1) (2026-04-09)


### Dependencies

* The following workspace dependencies were updated
  * peerDependencies
    * l10n-tools-core bumped from ^7.5.0 to ^7.6.0

## 1.0.0 (2026-04-09)


### Features

* add syncer-l10n-storage for tpc-agent l10n-storage ([#276](https://github.com/tpcint/l10n-tools/issues/276)) ([7ef2c24](https://github.com/tpcint/l10n-tools/commit/7ef2c24825cca5992fe1c440d8d74639676b5729))


### Dependencies

* The following workspace dependencies were updated
  * peerDependencies
    * l10n-tools-core bumped from ^7.4.1 to ^7.5.0
