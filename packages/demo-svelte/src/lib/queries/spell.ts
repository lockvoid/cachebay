import { createQuery } from "cachebay/svelte";

export const SPELL_FIELDS = `
  fragment SpellFields on Spell {
    id
    name
    category
    creator
    effect
    light
    imageUrl
    wikiUrl
  }
`;

export const SPELL_QUERY = `
  ${SPELL_FIELDS}

  query Spell($id: ID!) {
    spell(id: $id) {
      ...SpellFields
    }
  }
`;

export const useSpellQuery = (getId: () => string) => {
  return createQuery({ query: SPELL_QUERY, variables: () => ({ id: getId() }) });
};
