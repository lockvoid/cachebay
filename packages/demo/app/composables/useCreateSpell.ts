import { useMutation } from 'villus';
import { useCache } from 'villus-cachebay';
import { SPELL_FIELDS } from './useSpellQuery';
import { useSettings } from './useSettings';

export const CREATE_SPELL_MUTATION = `
  ${SPELL_FIELDS}

  mutation CreateSpell($input: CreateSpellInput!) {
    createSpell(input: $input) {
      ...SpellFields
    }
  }
`;

export const useCreateSpell = () => {
  const settings = useSettings();

  const createSpell = useMutation(CREATE_SPELL_MUTATION);

  const cache = useCache();

  const execute = async (variables: any) => {
    let tx;

    if (settings.value.optimistic) {
      tx = cache.modifyOptimistic((state: any) => {
        // Add the new spell to connections optimistically
        state.connections({ parent: "Query", field: "spells" }).forEach((connection: any) => {
          connection.addNode({ ...variables.input, __typename: "Spell", id: "temp-" + Date.now() });
        });
      });
    }

    try {
      const result = await createSpell.execute({ input: variables.input });

      if (result.error) {
        tx?.revert();
      }

      return result;
    } catch (error) {
      tx?.revert();

      throw error;
    }
  };

  return { ...createSpell, execute };
};
