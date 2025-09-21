import { useQuery } from 'villus';

export const SPELL_FIELDS = `
  fragment SpellFields on Spell {
    id
    name
    slug
    category
    creator
    effect
    image
    light
    wiki
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

export const useSpellQuery = (id: Ref<string> | ComputedRef<string>) => {
  return useQuery({  query: SPELL_QUERY,  variables: computed(() => ({ id: id.value })) });
};
