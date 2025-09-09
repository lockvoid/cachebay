import { useMutation } from 'villus';
import { useCache } from 'villus-cachebay';

export const UPDATE_COLOR_MUTATION = `
  ${COLOR_FIELDS}

  mutation UpdateColor($id: Int!, $input: colorsSetInput) {
    updateColorsByPk(pkColumns: { id: $id }, _set: $input) {
      ...ColorFields
    }
  }
`;

export const useUpdateColor = () => {
  const settings = useSettings();

  const updateColor = useMutation(UPDATE_COLOR_MUTATION);

  const cache = useCache();

  const execute = async (variables) => {
    let tx;

    if (settings.optimistic) {
      tx = cache.modifyOptimistic((state) => {
        state.patch({ ...variables.input, __typename: 'colors', id: variables.id });
      });
    }

    try {
      const result = await updateColor.execute({ ...variables, id: getPk(variables.id) });

      if (result.error) {
        tx?.revert();
      }

      return result;
    } catch (error) {
      tx?.revert();

      throw error;
    }
  };

  return { ...updateColor, execute };
};
