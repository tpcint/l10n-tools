# l10n-tools

모노레포 구조의 l10n(번역) 도구 모음.

## 스키마 생성

`packages/core/l10nrc.schema.json`은 직접 수정하지 않는다. 타입 정의(`packages/core/src/config.ts`)를 수정한 뒤 아래 명령으로 생성한다:

```bash
cd packages/core && npm run schema
```
