import { createYoga } from 'graphql-yoga'
import SchemaBuilder from '@pothos/core'
import RelayPlugin from '@pothos/plugin-relay'
import { resolveOffsetConnection } from '@pothos/plugin-relay'
import sqlite3 from 'sqlite3'

const db = new sqlite3.Database('../../harrypotter.db')

const dbRun = (sql: string, params: any[] = []) =>
  new Promise<{ id: number; changes: number }>((resolve, reject) => {
    db.run(sql, params, function (err) {
      err ? reject(err) : resolve({ id: this.lastID, changes: this.changes })
    })
  })

const dbGet = (sql: string, params: any[] = []) =>
  new Promise<any>((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      err ? reject(err) : resolve(row)
    })
  })

const dbAll = (sql: string, params: any[] = []) =>
  new Promise<any[]>((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      err ? reject(err) : resolve(rows)
    })
  })

const builder = new SchemaBuilder({
  plugins: [RelayPlugin],
  relayOptions: {
    clientMutationId: 'omit',
    cursorType: 'String',
  },
})

builder.objectType('Spell', {
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    slug: t.exposeString('slug'),
    category: t.exposeString('category'),
    creator: t.exposeString('creator', { nullable: true }),
    effect: t.exposeString('effect'),
    image: t.exposeString('image', { nullable: true }),
    light: t.exposeString('light', { nullable: true }),
    wiki: t.exposeString('wiki', { nullable: true }),
  }),
})

builder.inputType('CreateSpellInput', {
  fields: (t) => ({
    name: t.string({ required: true }),
    slug: t.string({ required: true }),
    category: t.string({ required: true }),
    creator: t.string(),
    effect: t.string({ required: true }),
    image: t.string(),
    light: t.string(),
    wiki: t.string(),
  }),
})

builder.inputType('UpdateSpellInput', {
  fields: (t) => ({
    id: t.id({ required: true }),
    name: t.string(),
    slug: t.string(),
    category: t.string(),
    creator: t.string(),
    effect: t.string(),
    image: t.string(),
    light: t.string(),
    wiki: t.string(),
  }),
})

builder.queryType({
  fields: (t) => ({
    spell: t.field({
      type: 'Spell',
      nullable: true,
      args: { id: t.arg.id({ required: true }) },
      resolve: async (_, { id }) => {
        return await dbGet('SELECT * FROM spells WHERE id = ?', [id])
      },
    }),

    spells: t.connection({
      type: 'Spell',
      resolve: async (_, args: any) => {
        return resolveOffsetConnection({ args }, async ({ limit, offset }) => {
          return await dbAll('SELECT * FROM spells ORDER BY id LIMIT ? OFFSET ?', [limit, offset])
        })
      },
    }),
  }),
})

builder.mutationType({
  fields: (t) => ({
    createSpell: t.field({
      type: 'Spell',
      args: { input: t.arg({ type: 'CreateSpellInput', required: true }) },
      resolve: async (_, { input }: { input: any }) => {
        const { name, slug, category, creator, effect, image, light, wiki } = input
        const result = await dbRun(
          'INSERT INTO spells (name, slug, category, creator, effect, image, light, wiki) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [name, slug, category, creator, effect, image, light, wiki]
        )
        return dbGet('SELECT * FROM spells WHERE id = ?', [result.id])
      },
    }),

    updateSpell: t.field({
      type: 'Spell',
      nullable: true,
      args: { input: t.arg({ type: 'UpdateSpellInput', required: true }) },
      resolve: async (_, { input }: { input: any }) => {
        const { id, ...fields } = input
        const updates = Object.keys(fields).filter(key => fields[key] !== undefined)

        if (updates.length === 0) {
          return await dbGet('SELECT * FROM spells WHERE id = ?', [id])
        }

        await dbRun(
          `UPDATE spells SET ${updates.map(key => `${key} = ?`).join(', ')} WHERE id = ?`,
          [...updates.map(key => fields[key]), id]
        )

        return await dbGet('SELECT * FROM spells WHERE id = ?', [id])
      },
    }),

    deleteSpell: t.field({
      type: 'Boolean',
      args: { id: t.arg.id({ required: true }) },
      resolve: async (_, { id }) => {
        const result = await dbRun('DELETE FROM spells WHERE id = ?', [id])
        return result.changes > 0
      },
    }),
  }),
})

const schema = builder.toSchema()
const yoga = createYoga({
  schema,
  graphiql: { title: 'Harry Potter Spells GraphQL API' },
  cors: { origin: '*', credentials: true },
})

export default defineEventHandler(yoga)
