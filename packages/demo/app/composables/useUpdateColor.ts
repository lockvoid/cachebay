import { useMutation } from 'villus';
import { useCache } from 'villus-cachebay';

export const UPDATE_COLOR_MUTATION = `
  ${COLOR_FIELDS}
  ${VALIDATION_ERROR_FIELDS}

  mutation UpdateColor($id: Int!, $input: colorsCetInput!) {
    updateColorsByPk(pkColumns: { id: $id }, _set: $input) {
      color {
        ...ColorFields
      }

      errors {
        ...ValidationErrorFields
      }
    }
  }
`;

export const useUpdateColor = () => {
  const updateColor = useMutation(UPDATE_COLOR_MUTATION);

  const cache = useCache();

  const execute = async (variables) => {
    const tx = cache.modifyOptimistic((state) => {
      state.patch(`Color:${variables.id}`, { ...variables.input });
    });

    try {
      const result = await updateColor.execute(variables);

      if (result.error) {
        tx.revert();
      }

      return result;
    } catch (error) {
      tx.revert();

      throw error;
    }
  };

  return { ...updateColor, execute };
};
