import { DatabaseSync } from 'node:sqlite'
import { createYoga } from 'graphql-yoga'
import SchemaBuilder from '@pothos/core'
import RelayPlugin from '@pothos/plugin-relay'
import { resolveCursorConnection } from '@pothos/plugin-relay'
import type { ResolveCursorConnectionArgs } from '@pothos/plugin-relay';

const delay = (ms = 1000) => {
  if (process.env.NODE_ENV !== 'development') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(() => { resolve(null) }, ms);
  });
}

const randomDelay = () => {
  return delay(Math.random() * 5000);
}

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

builder.inputType('SpellFilter', {
  fields: (t) => ({
    query: t.string(),
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
        await randomDelay();

        return db.prepare('SELECT * FROM spells WHERE id = ?').get(id)
      },
    }),

    spells: t.connection({
      type: 'Spell',

      args: {
        filter: t.arg({ type: 'SpellFilter' }),
      },

      resolve: async (_, args) => {
        await randomDelay();

        return resolveCursorConnection(
          {
            args,

            toCursor: (spell: any) => {
              return String(spell.id);
            },

            parseCursor: (cursor) => {
              return Number(cursor);
            },
          },

          ({ before, after, limit, inverted }: ResolveCursorConnectionArgs) => {
            const { filter } = args as { filter?: { query?: string } };

            const where = [];
            const params = [];

            if (filter?.query) {
              where.push('(name LIKE ? OR effect LIKE ? OR category LIKE ?)');
              params.push(`%${filter.query}%`, `%${filter.query}%`, `%${filter.query}%`);
            }

            if (after != null) {
              where.push('id > ?');
              params.push(after);
            }

            if (before != null) {
              where.push('id < ?');
              params.push(before);
            }

            const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
            const orderSQL = `ORDER BY id ${inverted ? 'DESC' : 'ASC'}`;
            const querySql = `SELECT * FROM spells ${whereSql} ${orderSQL} LIMIT ?`;

            params.push(limit);

            return db.prepare(querySql).all(...params);
          },
        );
      }
    }),
  })
});

builder.mutationType({
  fields: (t) => ({
    createSpell: t.field({
      type: 'Spell',

      args: {
        input: t.arg({ type: 'CreateSpellInput', required: true })
      },

      resolve: async (_, { input }) => {
        const { name, slug, category, creator, effect, image, light, wiki } = input;

        const sql = 'INSERT INTO spells (name, slug, category, creator, effect, image, light, wiki) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';

        const result = db.prepare(sql).run(name, slug, category, creator, effect, image, light, wiki);

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

        const sql = `UPDATE spells SET ${updates.map(key => `${key} = ?`).join(', ')} WHERE id = ?`

        const result = db.prepare(sql).run(...updates.map(key => fields[key]), id)

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
  },
});

export default defineEventHandler((event) => {
  const { req, res } = event.node;

  return yoga(req, res)
})
