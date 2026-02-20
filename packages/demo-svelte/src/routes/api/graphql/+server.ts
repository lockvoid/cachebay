import SchemaBuilder from "@pothos/core";
import RelayPlugin from "@pothos/plugin-relay";
import { resolveCursorConnection } from "@pothos/plugin-relay";
import { createPubSub, createYoga } from "graphql-yoga";
import { DatabaseSync } from "node:sqlite";
import type { ResolveCursorConnectionArgs } from "@pothos/plugin-relay";
import type { RequestEvent } from "@sveltejs/kit";

const delay = (ms = 1000) => {
  if (process.env.NODE_ENV !== "development") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(() => { resolve(null); }, ms);
  });
};

const randomDelay = () => {
  return delay(Math.random() * 5000);
};

const db = new DatabaseSync(process.env.NODE_ENV === "production" ? "/app/data/harrypotter.db" : "./vendor/harrypotter.db");

const pubSub = createPubSub();

setInterval(() => {
  pubSub.publish("hogwartsTimeUpdated", { id: "1", time: new Date().toISOString() });
}, 1000);

const builder = new SchemaBuilder({
  plugins: [
    RelayPlugin,
  ],
});

builder.objectType("Spell", {
  fields: (t) => ({
    id: t.exposeID("id"),
    name: t.exposeString("name"),
    category: t.exposeString("category"),
    creator: t.exposeString("creator", { nullable: true }),
    effect: t.exposeString("effect"),
    light: t.exposeString("light", { nullable: true }),
    imageUrl: t.exposeString("imageUrl", { nullable: true }),
    wikiUrl: t.exposeString("wikiUrl", { nullable: true }),
  }),
});

builder.objectType("HogwartsTime", {
  fields: (t) => ({
    id: t.exposeID("id"),
    time: t.exposeString("time"),
  }),
});

builder.inputType("SpellFilter", {
  fields: (t) => ({
    query: t.string(),
    sort: t.string(),
  }),
});

builder.inputType("CreateSpellInput", {
  fields: (t) => ({
    name: t.string({ required: true }),
    category: t.string({ required: true }),
    creator: t.string(),
    effect: t.string({ required: true }),
    light: t.string(),
    imageUrl: t.string(),
    wikiUrl: t.string(),
  }),
});

builder.inputType("UpdateSpellInput", {
  fields: (t) => ({
    id: t.id({ required: true }),
    name: t.string(),
    category: t.string(),
    creator: t.string(),
    effect: t.string(),
    light: t.string(),
    imageUrl: t.string(),
    wikiUrl: t.string(),
  }),
});

builder.inputType("DeleteSpellInput", {
  fields: (t) => ({
    id: t.id({ required: true }),
  }),
});

builder.objectType("CreateSpellPayload", {
  fields: (t) => ({
    spell: t.expose("spell", { type: "Spell", nullable: true }),
  }),
});

builder.objectType("UpdateSpellPayload", {
  fields: (t) => ({
    spell: t.expose("spell", { type: "Spell", nullable: true }),
  }),
});

builder.queryType({
  fields: (t) => ({
    spell: t.field({
      type: "Spell",

      nullable: true,

      args: {
        id: t.arg.id({ required: true }),
      },

      resolve: async (_, { id }) => {
        await randomDelay();

        return db.prepare("SELECT * FROM spells WHERE id = ?").get(id);
      },
    }),

    spells: t.connection({
      type: "Spell",

      args: {
        filter: t.arg({ type: "SpellFilter" }),
      },

      resolve: async (_, args) => {
        await randomDelay();

        return resolveCursorConnection(
          {
            args,

            toCursor: (spell: any) => {
              return String(spell.id);
            },

            parseCursor: (cursor: string) => {
              return Number(cursor);
            },
          },

          ({ before, after, limit, inverted }: ResolveCursorConnectionArgs) => {
            const { filter } = args as { filter?: { query?: string; sort?: string } };

            const where: string[] = [];
            const params: any[] = [];

            if (filter?.query) {
              where.push("(name LIKE ? OR effect LIKE ? OR category LIKE ?)");
              params.push(`%${filter.query}%`, `%${filter.query}%`, `%${filter.query}%`);
            }

            let orderBy = "id";
            let orderDirection = inverted ? "DESC" : "ASC";

            if (filter?.sort) {
              switch (filter.sort) {
                case "NAME_ASC":
                  orderBy = "name";
                  orderDirection = "ASC";
                  break;

                case "CREATE_DATE_DESC":
                  orderBy = "id";
                  orderDirection = "DESC";
                  break;

                default:
                  orderBy = "id";
                  orderDirection = inverted ? "DESC" : "ASC";
              }
            }

            const isDescending = orderDirection === "DESC";

            if (after != null) {
              where.push(isDescending ? "id < ?" : "id > ?");
              params.push(after);
            }

            if (before != null) {
              where.push(isDescending ? "id > ?" : "id < ?");
              params.push(before);
            }

            const querySql = `SELECT * FROM spells ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${orderBy} ${orderDirection} LIMIT ?`;

            params.push(limit);

            return db.prepare(querySql).all(...params);
          },
        );
      },
    }),
  }),
});

builder.mutationType({
  fields: (t) => ({
    createSpell: t.field({
      type: "CreateSpellPayload",

      args: {
        input: t.arg({ type: "CreateSpellInput", required: true }),
      },

      resolve: async (_, { input }) => {
        const { name = "", effect = "", category = "", creator = "", light = "", imageUrl = "", wikiUrl = "" } = input as any;

        const sql = "INSERT INTO spells (name, category, creator, effect, light, imageUrl, wikiUrl) VALUES (?, ?, ?, ?, ?, ?, ?)";

        const result = db.prepare(sql).run(name, category, creator, effect, light, imageUrl, wikiUrl);

        return {
          spell: db.prepare("SELECT * FROM spells WHERE id = ?").get(result.lastInsertRowid),
        };
      },
    }),

    updateSpell: t.field({
      type: "UpdateSpellPayload",

      args: {
        input: t.arg({ type: "UpdateSpellInput", required: true }),
      },

      resolve: async (_, { input }: { input: any }) => {
        await randomDelay();

        const { id, ...fields } = input;

        const updates = Object.keys(fields).filter(key => fields[key] !== undefined);

        const sql = `UPDATE spells SET ${updates.map(key => `${key} = ?`).join(", ")} WHERE id = ?`;

        db.prepare(sql).run(...updates.map((key: string) => fields[key]), id);

        return {
          spell: db.prepare("SELECT * FROM spells WHERE id = ?").get(id),
        };
      },
    }),

    deleteSpell: t.field({
      type: "Boolean",

      args: {
        input: t.arg({ type: "DeleteSpellInput", required: true }),
      },

      resolve: async (_, { input }: { input: any }) => {
        const { id } = input;

        const result = db.prepare("DELETE FROM spells WHERE id = ?").run(id);

        return result.changes > 0;
      },
    }),
  }),
});

builder.subscriptionType({
  fields: (t) => ({
    hogwartsTimeUpdated: t.field({
      type: "HogwartsTime",

      subscribe: () => {
        return pubSub.subscribe("hogwartsTimeUpdated");
      },

      resolve: (payload: any) => {
        return payload;
      },
    }),
  }),
});

const schema = builder.toSchema();

const yoga = createYoga<RequestEvent>({
  schema,

  graphqlEndpoint: "/api/graphql",

  fetchAPI: {
    Response,
  },

  graphiql: {
    title: "Harry Potter",
  },

  cors: {
    origin: "*",
  },
});

export const GET = yoga;
export const POST = yoga;
