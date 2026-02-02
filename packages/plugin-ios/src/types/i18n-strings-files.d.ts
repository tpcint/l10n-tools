declare module 'i18n-strings-files' {
  export interface CommentedI18nStringsMsg {
    [key: string]: {
      text: string
      comment?: string
    }
  }

  export interface I18nStringsMsg {
    [key: string]: string
  }

  interface ReadFileSyncOptions {
    encoding?: string
    wantsComments?: boolean
  }

  interface ReadFileSyncOptionsWithComments {
    encoding?: string
    wantsComments: true
  }

  interface I18nStringsFiles {
    parse(input: string, wantsComments: true): CommentedI18nStringsMsg
    parse(input: string, wantsComments?: false): I18nStringsMsg
    compile(data: I18nStringsMsg | CommentedI18nStringsMsg, options?: { wantsComments?: boolean }): string
    readFile(
      file: string,
      options: ReadFileSyncOptions | string | ((err: Error | null, data: CommentedI18nStringsMsg | I18nStringsMsg | null) => void),
      callback?: (err: Error | null, data: CommentedI18nStringsMsg | I18nStringsMsg | null) => void
    ): void
    readFileSync(file: string, options: ReadFileSyncOptionsWithComments): CommentedI18nStringsMsg
    readFileSync(file: string, options?: ReadFileSyncOptions | string): I18nStringsMsg
    writeFile(file: string, data: I18nStringsMsg | CommentedI18nStringsMsg, options?: { encoding?: string; wantsComments?: boolean }, callback?: (err: Error | null) => void): void
    writeFileSync(file: string, data: I18nStringsMsg | CommentedI18nStringsMsg, options?: { encoding?: string; wantsComments?: boolean }): void
  }

  const i18nStringsFiles: I18nStringsFiles
  export default i18nStringsFiles
}
