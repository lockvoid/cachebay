import { useMutation } from 'villus';
import { useCache } from 'villus-cachebay';
import { SPELL_FIELDS } from './useSpellQuery';
import { useSettings } from './useSettings';

export const UPDATE_SPELL_MUTATION = `
  ${SPELL_FIELDS}

  mutation UpdateSpell($id: ID!, $input: UpdateSpellInput!) {
    updateSpell(id: $id, input: $input) {
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

    if (settings.value.optimistic) {
      tx = cache.modifyOptimistic((state: any) => {
        state.patch({ ...variables.input, __typename: 'Spell', id: variables.id });
      });
    }

    try {
      const result = await updateSpell.execute({ id: variables.id, input: variables.input });

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
