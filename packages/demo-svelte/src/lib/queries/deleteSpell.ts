import { createMutation, getCachebay } from "cachebay/svelte";
import { getSettings } from "$lib/stores/settings.svelte";

export const DELETE_SPELL = `
  mutation DeleteSpell($input: DeleteSpellInput!) {
    deleteSpell(input: $input)
  }
`;

export const useDeleteSpell = () => {
  const settings = getSettings();
  const cachebay = getCachebay();
  const deleteSpellMutation = createMutation({ query: DELETE_SPELL });

  const execute = async (variables: { input: { id: string } }) => {
    if (settings.optimistic) {
      const tx = cachebay.modifyOptimistic((o: any) => {
        const keys = cachebay.inspect.getConnectionKeys({ parent: "Query", key: "spells" });

        keys.forEach((key: any) => {
          const c = o.connection(key);
          c.removeNode(`Spell:${variables.input.id}`);
        });
      });

      return deleteSpellMutation.execute({ input: variables.input }).then((result: any) => {
        if (result.error) {
          tx?.revert();
        } else {
          tx?.commit();
        }
      });
    } else {
      return deleteSpellMutation.execute({ input: variables.input });
    }
  };

  return {
    get data() { return deleteSpellMutation.data; },
    get error() { return deleteSpellMutation.error; },
    get isFetching() { return deleteSpellMutation.isFetching; },
    execute,
  };
};
