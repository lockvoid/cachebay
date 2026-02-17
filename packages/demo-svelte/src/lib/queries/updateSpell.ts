import { createMutation, getCachebay } from "cachebay/svelte";
import { getSettings } from "$lib/stores/settings.svelte";
import { SPELL_FIELDS } from "./spell";

export const UPDATE_SPELL_MUTATION = `
  ${SPELL_FIELDS}

  mutation UpdateSpell($input: UpdateSpellInput!) {
    updateSpell(input: $input) {
      spell {
        ...SpellFields
      }
    }
  }
`;

export const useUpdateSpell = () => {
  const settings = getSettings();
  const cachebay = getCachebay();
  const updateSpellMutation = createMutation({ query: UPDATE_SPELL_MUTATION });

  const execute = async (variables: { input: any }) => {
    if (settings.optimistic) {
      const tx = cachebay.modifyOptimistic((state: any) => {
        state.patch(`Spell:${variables.input.id}`, variables.input);
      });

      updateSpellMutation.execute({ input: variables.input }).then((result: any) => {
        if (result.error) {
          tx?.revert();
        } else {
          tx?.commit(result.data.updateSpell.spell);
        }
      });
    } else {
      return updateSpellMutation.execute({ input: variables.input });
    }
  };

  return {
    get data() { return updateSpellMutation.data; },
    get error() { return updateSpellMutation.error; },
    get isFetching() { return updateSpellMutation.isFetching; },
    execute,
  };
};
