# l10n-tools

A modular localization toolchain for extracting translation keys from source code, syncing with translation management systems, and compiling translations into various output formats.

## Features

- **Extract** translation keys from multiple source types (JavaScript, TypeScript, Vue, Python, PHP, Android, iOS)
- **Sync** with translation management platforms (Lokalise)
- **Compile** translations into various output formats (JSON, gettext PO/MO, platform-specific)
- **Validate** translation completeness and format consistency
- **Modular architecture** - install only the plugins you need

## Installation

```bash
# Install CLI and required plugins
npm install l10n-tools l10n-tools-extractor-vue l10n-tools-compiler-json l10n-tools-syncer-lokalise
```

### Available Packages

| Package | Description |
|---------|-------------|
| `l10n-tools` | CLI for managing translations |
| `l10n-tools-core` | Core library and infrastructure |
| **Extractors** | |
| `l10n-tools-extractor-javascript` | Extract from JS/TS/JSX/TSX files |
| `l10n-tools-extractor-vue` | Extract from Vue.js files (vue-gettext, vue-i18n) |
| `l10n-tools-extractor-python` | Extract from Python gettext functions |
| `l10n-tools-plugin-android` | Extract and compile Android strings.xml |
| `l10n-tools-plugin-ios` | Extract and compile iOS .strings files |
| **Compilers** | |
| `l10n-tools-compiler-json` | Compile to JSON formats (vue-i18n, i18next, etc.) |
| `l10n-tools-compiler-gettext` | Compile to PO/MO files |
| **Syncers** | |
| `l10n-tools-syncer-lokalise` | Sync with Lokalise |

## Configuration

Create a `.l10nrc` file in your project root:

```json
{
  "$schema": "https://raw.githubusercontent.com/tpcint/l10n-tools/main/packages/core/l10nrc.schema.json",
  "domains": {
    "web": {
      "type": "vue-i18n",
      "tag": "web-app",
      "locales": ["en", "ko", "ja"],
      "src-dirs": ["src"],
      "src-patterns": ["**/*.vue", "**/*.ts"],
      "outputs": [
        {
          "type": "vue-i18n",
          "target-dir": "src/locales"
        }
      ]
    }
  },
  "sync-target": "lokalise",
  "lokalise": {
    "token": "${LOKALISE_TOKEN}",
    "projectId": "your-project-id"
  }
}
```

> The CLI automatically loads a `.env` file from the current working directory on startup if one exists. Existing environment variables take precedence, so values exported in your shell are not overridden.

### Domain Types

| Type | Description |
|------|-------------|
| `vue-gettext` | Vue.js with vue-gettext (`$gettext`, `<translate>`, `v-translate`) |
| `vue-i18n` | Vue.js with vue-i18n (`$t`, `<i18n>`, `<i18n-t>`) |
| `javascript` | JavaScript/TypeScript with custom keywords |
| `typescript` | Alias for `javascript` |
| `react` | React with i18n functions |
| `i18next` | i18next translation functions |
| `python` | Python gettext functions |
| `android` | Android strings.xml resources |
| `ios` | iOS Swift, Storyboard, and XIB files |

### Output Types

| Type | Description |
|------|-------------|
| `json` | Single JSON file with all locales |
| `json-dir` | Separate JSON file per locale |
| `vue-i18n` | JSON with vue-i18n plural format |
| `i18next` | JSON with i18next plural format |
| `node-i18n` | JSON with node-i18n plural format |
| `po-json` | JSON PO format |
| `mo` | Compiled gettext MO files |
| `node-gettext` | PO files for node-gettext |
| `android` | Android strings.xml |
| `ios` | iOS .strings files |

### iOS Property Access Patterns

For Swift code using extension-based localization like `"string".localized`:

```swift
extension String {
  var localized: String {
    return NSLocalizedString(self, comment: "")
  }
}

let message = "Hello, World!".localized
```

Add the property name with a `.` prefix to the `keywords` option:

```json
{
  "type": "ios",
  "keywords": [".localized", ".localizedFormat"],
  "src-dir": "MyApp",
  ...
}
```

This extracts keys from both single-line and multi-line string literals:

```swift
"Hello".localized
"""
Multi-line
string
""".localized
```

## Usage

### Update local translations

Extract keys from source, sync with remote, and compile outputs:

```bash
l10n update
```

### Upload changes to sync target

Extract and upload new/changed keys without modifying local files:

```bash
l10n upload
```

### Full sync

Bidirectional sync between local and remote:

```bash
l10n sync
```

### Check translation status

Check for untranslated entries:

```bash
l10n check
l10n check --locales ko,ja
l10n check src/components/Header.vue  # Check specific files
```

### Key mode of commands that do not connect to the sync target (l10n-storage)

A tag of l10n-storage uses source keys or id keys (`keyMode`). Commands that connect to l10n-storage (`upload`,
`download`, `sync`, `check` with `--source` or `--force-sync`) read the tag's key mode from the server and extract the
cached keys with it. Commands that do not connect (`update`, `check` without `--source`, `_extractKeys`, `_compile`
without `--source`) extract and compile with the key mode the cached keys were extracted with, so they match the cached
translations. Every command that extracts the keys records its key mode in `<cache-dir>/<domain>/key-mode.json`. Without
a record, or with an invalid record or a record of another tag, commands that do not connect use source keys. `_sync` syncs the cached keys, so it also uses the recorded key mode and fails if the tag's key
mode differs. `_compile --source` does not change the cache and does not update the record.

Run `l10n download` after the tag's key mode changes (e.g. after `l10n migrate-keys --apply`) to update the record.

### CLI Options

```
Options:
  -r, --rcfile <rcfile>              Config file path (default: .l10nrc)
  -d, --domains <domains>            Domains to process (comma separated)
  -s, --skip-validation              Skip format validation
  -b, --validation-base-locale       Base locale for validation
  -n, --dry-sync                     Simulate sync without changes
  -v, --verbose                      Verbose output
  -q, --quiet                        Minimal output
  --project-id <projectId>           Use this l10n-storage project instead of the one in the rc file
  -t, --tags <tags>                  Additional tags for keys (comma separated)
```

### Migrate source keys to id keys (l10n-storage)

`l10n migrate-keys` switches a resource-format tag from source keys to id keys without losing translations
([#484](https://github.com/tpcint/l10n-tools/issues/484)). The CLI extracts the repository files in both key modes, pairs
each resource's id key with the source key it uses now, and sends the plan to l10n-storage, which applies it in one
transaction:

- creates the id key (or reuses an existing one) and copies the source key's confirmed translations and pending suggestions,
  including the source locale
- moves the `(tag, source)` claim and the resource's `context` metadata from the source key to the id key
- sets the tag to `keyMode=id` with `--min-syncer-version`

It works for domains whose extractor supports id keys (currently Android `strings.xml`). The CLI extracts every selected
domain first and fails without sending anything if one of them has no id key. With `--apply` on several domains it runs a
dry-run for all of them first and applies only when none has errors; each tag is still migrated in its own transaction. A
tag used by several domains of the rc file is not supported.

Only the claims of `l10n-storage.source` in the rc file (the default branch sync, usually `main`) are migrated. Claims of
open pull requests (`PR-N`) stay on the source keys. Nothing is deleted and repository files are not changed: after the
migration, compiling `values-xx/` gives the same output and `values/` is untouched.

```bash
# Dry-run (default): the server computes the plan, reports errors and conflicts, and writes nothing
l10n migrate-keys --min-syncer-version 1.6.0 --output plan.json

# Apply. The migration id is printed to stdout (also with -q); keep it for rollback
l10n migrate-keys --min-syncer-version 1.6.0 --apply --output applied.json

# Roll back: dry-run first, then apply
l10n migrate-keys --rollback <migrationId>
l10n migrate-keys --rollback <migrationId> --apply
```

| Option | Description |
|--------|-------------|
| `--apply` | Apply the migration or rollback. Without it the command is a dry-run. |
| `--min-syncer-version <version>` | Minimum `l10n-tools-syncer-l10n-storage` version set on the tag. Older syncers are rejected for this tag after the migration. Required unless `--rollback`. |
| `--rollback <migrationId>` | Roll back an applied migration. The server applies the rollback plan it stored when the migration was applied: it removes the id keys' claims, restores the source keys' claims and `context` metadata, and restores the tag settings. Copied translations and created id keys are kept. |
| `--output <path>` | Write the server responses as JSON (per-item copied locales, conflicts, rollback plan). |

Run it on a full checkout of the default branch after its sync has finished, while no sync of the tag is running. The
Android extractor skips a module whose `strings.xml` is missing with only a warning, so a sparse checkout migrates part of
the tag. A resource the default branch sync has not uploaded fails with `source-key-not-found`. After applying, run the
dry-run again: it should report `0 tag claims moved`; otherwise a sync that started before the migration claimed source
keys again, and applying the same plan again moves them.

Use an `l10n-tools-syncer-l10n-storage` version at or above `--min-syncer-version`, and update the repository's CI to it
before applying: after the migration the server rejects older syncers for the tag with `426`.

#### Rehearsal on a cloned project

Before applying to the production project, clone it, migrate the clone, and compare the clone's compiled output with the
production output. `--project-id` runs any command against the clone with the repository's rc file. Cloning and deleting a
project require a member token in `TPC_AGENT_TOKEN`.

Start from a clean working tree and index: step 1 stages the baseline and step 5 unstages everything. This compares the
outputs with git, so it assumes the compiled outputs are tracked; if they are ignored, copy them aside after step 1 and
compare them with `diff -r` in step 4. With `--project-id` the translation cache is kept per project
(`<cache-dir>/projects/<projectId>`), so the clone's output does not include translations cached from the production project.
The baseline also uses `--project-id` with the production project so that both start from an empty cache; delete
`<cache-dir>/projects/<projectId>` of the production project left from an earlier rehearsal first. The default cache is
not touched.

```bash
# curl does not read .env or the rc file: export the tpc-agent URL and the member token in the shell
export TPC_AGENT_URL=<tpc-agent URL> TPC_AGENT_TOKEN=<member token>
PROJECT=<projectId in .l10nrc>

# 1. Baseline: compile from the production project with an empty cache without uploading, and stage the output
rm -rf ".l10n-tools/projects/$PROJECT"   # <cache-dir>/projects/<projectId>, created only by --project-id
l10n --project-id "$PROJECT" -n sync
git add -A

# 2. Clone the project and note project.id of the response
curl -sS -X POST "$TPC_AGENT_URL/api/l10n/projects/$PROJECT/clone" \
  -H "Authorization: Bearer $TPC_AGENT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name": "rehearsal-20261120"}'
CLONE=<project.id>

# 3. Migrate the clone
l10n --project-id "$CLONE" migrate-keys --min-syncer-version 1.6.0
l10n --project-id "$CLONE" migrate-keys --min-syncer-version 1.6.0 --apply

# 4. Compile from the clone without uploading. The compiled output must not differ from the baseline
#    (Android: values-xx/ and values/ strings.xml)
l10n --project-id "$CLONE" -n sync
git diff --stat -- ':(glob)**/values*/strings.xml'

# 5. Delete the clone and unstage the baseline
curl -sS -X DELETE "$TPC_AGENT_URL/api/l10n/projects/$CLONE" -H "Authorization: Bearer $TPC_AGENT_TOKEN"
git reset
```

`-n sync` is used because it downloads and compiles with the tag's key mode without uploading; `download` does not compile.

## Internal commands

These commands are prefixed with `_` and are intended for scripting / automation, not day-to-day use. Their flags and output are kept stable but their purpose is to be composed by other tooling.

### `_remoteCount` — Count translations on the sync target

Query the sync target directly and report translation counts per locale, without downloading translations into the local cache. Useful for verifying upload completeness or driving dashboards.

```bash
# Sum across all domains (locale union)
l10n _remoteCount --source web

# Specific domain
l10n -d web _remoteCount --source web

# Multiple domains → one line per domain
l10n -d web,mobile _remoteCount --source web

# Filter by spec
l10n _remoteCount --source web -s untranslated
l10n _remoteCount --source web -s translated,untranslated

# Specific locales
l10n _remoteCount --source web -l en,ko
```

Options:

| Option | Description |
|--------|-------------|
| `--source <source>` | Source identifier to filter by. Omit to count all keys for the domain's tag. |
| `-l, --locales <locales>` | Comma-separated locales (default: each domain's configured locales). |
| `-s, --spec <spec>` | Comma-separated specs, `!` prefix to negate. Supported: `total` (default), `translated`, `untranslated`. |

Output format:

- One line per domain: `<domain>,<locale>:<count>,<locale>:<count>,...`
- When `-d/--domains` is omitted, a single aggregate line is emitted with `*` as the domain name. Locales are the union of each domain's locales (insertion order); a locale's count is the sum across the domains that include it.

Notes:

- Requires a sync target that supports source listing (currently `l10n-storage`).
- Counts are by `(context, key)` pair, matching `_count` semantics — a key with multiple contexts is counted per context.
- The l10n-storage backend has no `unverified` flag, so `unverified` / `!unverified` specs always behave as if all entries are verified.

## Requirements

- Node.js >= 22.19.0
- npm >= 10.9.0

## License

MIT

## Author

Eungkyu Song <eungkyu@gmail.com>
