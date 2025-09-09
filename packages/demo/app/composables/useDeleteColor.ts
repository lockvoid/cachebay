import { useMutation } from "villus";
import { useCache } from "villus-cachebay";

export const DELETE_COLOR = `
  ${COLOR_FIELDS}

  mutation DeleteColor($id: Int!) {
    deleteColorsByPk(id: $id) {
      ...ColorFields
    }
  }
`;

export const useDeleteColor = () => {
  const settings = useSettings();

  const deleteColor = useMutation(DELETE_COLOR);

  const cache = useCache();

  const execute = async (variables) => {
    let tx;

    if (settings.optimistic) {
      tx = cache.modifyOptimistic((state) => {
        state.connections({ parent: "Query", field: "colors" }).forEach(connection => {
          connection.removeNode({ __typename: "colors", id: variables.id });
        });
      });
    }

    try {
      const result = await deleteColor.execute({ id: getPk(variables.id) });

      if (result.error) {
        tx?.revert();
      }

      return result;
    } catch (error) {
      tx?.revert();

      throw error;
    }
  };

  return { ...deleteColor, execute };
};
