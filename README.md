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
| `l10n-tools-extractor-php` | Extract from PHP gettext functions |
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
| `php-gettext` | PHP gettext functions |
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
  -t, --tags <tags>                  Additional tags for keys (comma separated)
```

## Requirements

- Node.js >= 22.19.0
- npm >= 10.9.0

## License

MIT

## Author

Eungkyu Song <eungkyu@gmail.com>
