import { writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { L10nConfSchema } from '../src/config.js'

const outPath = new URL('../l10nrc.schema.json', import.meta.url)

// draft-7 keeps the `definitions` layout that editors referencing the published $schema URL already read.
const schema = z.toJSONSchema(L10nConfSchema, { target: 'draft-7', io: 'input' })

await writeFile(outPath, JSON.stringify(schema, null, 2) + '\n')
