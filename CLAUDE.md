# l10n-tools

모노레포 구조의 l10n(번역) 도구 모음.

## 스키마 생성

rc 설정의 SSOT 는 `packages/core/src/config.ts` 의 zod 스키마(`L10nConfSchema`)다. CLI 는 이 스키마로 rc 파일을 검증하고, TS 타입은 `z.infer` 로 도출한다.

`packages/core/l10nrc.schema.json`은 에디터 `$schema` 용 산출물이므로 직접 수정하지 않는다. zod 스키마를 수정한 뒤 아래 명령으로 생성해 함께 커밋한다. CI(test 워크플로)가 생성 결과와 커밋된 파일이 다르면 실패한다:

```bash
cd packages/core && npm run schema
```
