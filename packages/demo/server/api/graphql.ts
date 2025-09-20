import { DatabaseSync } from 'node:sqlite'
import { createYoga } from 'graphql-yoga'
import SchemaBuilder from '@pothos/core'
import RelayPlugin from '@pothos/plugin-relay'
import { resolveOffsetConnection } from '@pothos/plugin-relay'

const db = new DatabaseSync('./vendor/harrypotter.db');

const builder = new SchemaBuilder({
  plugins: [
    RelayPlugin,
  ],
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

      args: {
        id: t.arg.id({ required: true })
      },

      resolve: async (_, { id }) => {
        return db.prepare('SELECT * FROM spells WHERE id = ?').get(id)
      },
    }),

    spells: t.connection({
      type: 'Spell',

      resolve: async (_, args: any) => {
        return resolveOffsetConnection({ args }, async ({ limit, offset }) => {
          return db.prepare('SELECT * FROM spells ORDER BY id LIMIT ? OFFSET ?').all(limit, offset)
        })
      },
    }),
  }),
})

builder.mutationType({
  fields: (t) => ({
    createSpell: t.field({
      type: 'Spell',

      args: {
        input: t.arg({ type: 'CreateSpellInput', required: true })
      },

      resolve: async (_, { input }) => {
        const { name, slug, category, creator, effect, image, light, wiki } = input;

        const result = db.prepare(
          'INSERT INTO spells (name, slug, category, creator, effect, image, light, wiki) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(name, slug, category, creator, effect, image, light, wiki);

        return db.prepare('SELECT * FROM spells WHERE id = ?').get(result.lastInsertRowid)
      },
    }),

    updateSpell: t.field({
      type: 'Spell',

      nullable: true,

      args: {
        input: t.arg({ type: 'UpdateSpellInput', required: true })
      },

      resolve: async (_, { input }: { input: any }) => {
        const { id, ...fields } = input

        const updates = Object.keys(fields).filter(key => fields[key] !== undefined)

        if (updates.length === 0) {
          return db.prepare('SELECT * FROM spells WHERE id = ?').get(id)
        }

        db.prepare(
          `UPDATE spells SET ${updates.map(key => `${key} = ?`).join(', ')} WHERE id = ?`
        ).run(...updates.map(key => fields[key]), id)

        return db.prepare('SELECT * FROM spells WHERE id = ?').get(id)
      },
    }),

    deleteSpell: t.field({
      type: 'Boolean',

      args: {
        id: t.arg.id({ required: true })
      },

      resolve: async (_, { id }) => {
        const result = db.prepare('DELETE FROM spells WHERE id = ?').run(id)

        return result.changes > 0;
      },
    }),
  }),
})

const schema = builder.toSchema()

const yoga = createYoga({
  schema,

  graphiql: {
    title: 'Harry Potter'
  },

  cors: {
    origin: '*',
    credentials: true,
  },
});

export default defineEventHandler((event) => {
  const { req, res } = event.node;

  return yoga(req, res)
})
