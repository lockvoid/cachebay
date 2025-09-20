import { useMutation } from 'villus';
import { useCache } from 'villus-cachebay';

export const UPDATE_SPELL_MUTATION = `
  ${SPELL_FIELDS}

  mutation UpdateSpell($input: UpdateSpellInput!) {
    updateSpell(input: $input) {
      ...SpellFields
    }
  }
`;

export const useUpdateSpell = () => {
  const settings = useSettings();

  const updateSpell = useMutation(UPDATE_SPELL_MUTATION);

  const cache = useCache();

  const execute = async (variables: any) => {
    let tx;

    if (settings.optimistic) {
      tx = cache.modifyOptimistic((state: any) => {
        state.patch({ ...variables.input, __typename: 'Spell', id: variables.id });
      });
    }

    try {
      const result = await updateSpell.execute({ input: { ...variables.input, id: variables.id } });

      if (result.error) {
        tx?.revert();
      }

      return result;
    } catch (error) {
      tx?.revert();

      throw error;
    }
  };

  return { ...updateSpell, execute };
};
