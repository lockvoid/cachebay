import { useMutation, useCachebay } from "cachebay/vue";
import { useSettings } from "../stores/settings";

export const DELETE_SPELL = `
  mutation DeleteSpell($input: DeleteSpellInput!) {
    deleteSpell(input: $input)
  }
`;

export const useDeleteSpell = () => {
  const settings = useSettings();

  const deleteSpell = useMutation({ query: DELETE_SPELL });

  const cachebay = useCachebay();

  const execute = async (variables) => {
    if (settings.optimistic) {
      const tx = cachebay.modifyOptimistic((o) => {
        const keys = cachebay.inspect.getConnectionKeys({ parent: "Query", key: "spells" });

        keys.forEach((key) => {
          const c = o.connection(key);

          c.removeNode(`Spell:${variables.input.id}`); // ...or connection.removeNode({ __typename: "Spell", id: variables.input.id });
        });
      });

      return deleteSpell.execute({ input: variables.input }).then((result, error) => {
        if (result.error || error) {
          tx?.revert();
        } else {
          tx?.commit();
        }
      });
    } else {
      return deleteSpell.execute({ id: variables.id });
    }
  };

  return { ...deleteSpell, execute };
};
