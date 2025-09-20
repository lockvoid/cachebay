import { useMutation } from "villus";
import { useCache } from "villus-cachebay";

export const DELETE_SPELL = `
  ${SPELL_FIELDS}

  mutation DeleteSpell($id: ID!) {
    deleteSpell(id: $id)
  }
`;

export const useDeleteSpell = () => {
  const settings = useSettings();

  const deleteSpell = useMutation(DELETE_SPELL);

  const cache = useCache();

  const execute = async (variables: any) => {
    let tx;

    if (settings.optimistic) {
      tx = cache.modifyOptimistic((state: any) => {
        state.connections({ parent: "Query", field: "spells" }).forEach((connection: any) => {
          connection.removeNode({ __typename: "Spell", id: variables.id });
        });
      });
    }

    try {
      const result = await deleteSpell.execute({ id: variables.id });

      if (result.error) {
        tx?.revert();
      }

      return result;
    } catch (error) {
      tx?.revert();

      throw error;
    }
  };

  return { ...deleteSpell, execute };
};
