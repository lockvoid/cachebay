import { useMutation, useCachebay } from "cachebay/vue";
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

  const cachebay = useCachebay();

  const createSpell = useMutation({ query: CREATE_SPELL_MUTATION });

  const execute = async (variables) => {
    if (settings.optimistic) {
      const tx = cachebay.modifyOptimistic((o, { data }) => {
        const keys = cachebay.inspect.getConnectionKeys({ parent: `Query`, key: "spells" });

        keys.forEach((key) => {
          const c = o.connection(key);

          if (data) {
            c.addNode(data, { position: 'start' });
          } else {
            c.addNode({ ...variables.input, __typename: 'Spell', id: `tmp:${Math.random()}` }, { position: 'start' });
          }
        });
      });

      const result = await createSpell.execute({ input: variables.input }).then((result, error) => {
        if (result.error || error) {
          tx?.revert();
        } else {
          tx?.commit();
        }
      });
    } else {
      return createSpell.execute({ input: variables.input });
    }
  };

  return { ...createSpell, execute };
};
