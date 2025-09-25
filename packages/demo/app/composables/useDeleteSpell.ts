import { useMutation } from "villus";
import { useCache } from "villus-cachebay";
import { useSettings } from '../stores/settings';

export const DELETE_SPELL = `
  mutation DeleteSpell($input: DeleteSpellInput!) {
    deleteSpell(input: $input)
  }
`;

export const useDeleteSpell = () => {
  const settings = useSettings();

  const deleteSpell = useMutation(DELETE_SPELL);

  const cache = useCache();

  const execute = async (variables) => {
    if (settings.optimistic) {
      const tx = cache.modifyOptimistic((state) => {
        const connection = state.connection({ parent: "Query", key: "spells" });

        connection.removeNode(`Spell:${variables.input.id}`); // ...or connection.remove({ __typename: "Spell", id: variables.input.id });
      });

      return deleteSpell.execute({ input: variables.input })
        .then((result, error) => {
          if (result.error || error) {
            tx?.revert();
          } else {
            tx?.commit();
          }
        });
    } else {
      return deleteSpell.execute({ id: variables.id });
    }
  }

  return { ...deleteSpell, execute };
};
