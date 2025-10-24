import { useMutation } from "cachebay/vue";
import { useCache } from "cachebay";
import { SPELL_FIELDS } from "./useSpellQuery";

export const CREATE_SPELL_MUTATION = `
  ${SPELL_FIELDS}

  mutation CreateSpell($input: CreateSpellInput!) {
    createSpell(input: $input) {
      spell {
        ...SpellFields
      }
    }
  }
`;

export const useCreateSpell = () => {
  const settings = useSettings();

  const cache = useCache();

  const createSpell = useMutation(CREATE_SPELL_MUTATION);

  const execute = async (variables) => {
    if (settings.optimistic) {
      const tx = cache.modifyOptimistic((o, { data }) => {
        const keys = cache.inspect.connectionKeys({ parent: `Query`, key: "spells" });

        keys.forEach((key) => {
          const c = o.connection(key);

          if (data) {
            c.addNode(data, { position: 'start' });
          } else {
            c.addNode({ ...variables.input, __typename: 'Spell', id: `tmp:${Math.random()}` }, { position: 'start' });
          }
        });
      });

      try {
        const result = await createSpell.execute({ input: variables.input })

        tx?.commit(result.data.createSpell.spell);

        return result;
      } catch (error) {
        tx?.revert();

        throw error;
      }
    } else {
      return createSpell.execute({ input: variables.input });
    }
  };

  return { ...createSpell, execute };

};
