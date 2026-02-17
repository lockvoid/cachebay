import { createMutation, getCachebay } from "cachebay/svelte";
import { getSettings } from "$lib/stores/settings.svelte";
import { SPELL_FIELDS } from "./spell";

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
  const settings = getSettings();
  const cachebay = getCachebay();
  const createSpellMutation = createMutation({ query: CREATE_SPELL_MUTATION });

  const execute = async (variables: { input: any }) => {
    if (settings.optimistic) {
      const tx = cachebay.modifyOptimistic((o: any, { data }: any) => {
        const keys = cachebay.inspect.getConnectionKeys({ parent: "Query", key: "spells" });

        keys.forEach((key: any) => {
          const c = o.connection(key);

          if (data) {
            c.addNode(data, { position: "start" });
          } else {
            c.addNode({ ...variables.input, __typename: "Spell", id: `tmp:${Math.random()}` }, { position: "start" });
          }
        });
      });

      await createSpellMutation.execute({ input: variables.input }).then((result: any) => {
        if (result.error) {
          tx?.revert();
        } else {
          tx?.commit();
        }
      });
    } else {
      return createSpellMutation.execute({ input: variables.input });
    }
  };

  return {
    get data() { return createSpellMutation.data; },
    get error() { return createSpellMutation.error; },
    get isFetching() { return createSpellMutation.isFetching; },
    execute,
  };
};
