import { useMutation } from "villus";
import { useCache } from "cachebay";
import { useSettings } from "../stores/settings";
import { SPELL_FIELDS } from "./useSpellQuery";

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
  const settings = useSettings();

  const cache = useCache();

  const updateSpell = useMutation(UPDATE_SPELL_MUTATION);

  const execute = async (variables) => {
    if (settings.optimistic) {
      const tx = cache.modifyOptimistic((state) => {
        state.patch(`Spell:${variables.input.id}`, variables.input); // ...or state.patch({ __typename: "Spell", id: variables.input.id }, variables.input);
      });

      updateSpell.execute({ input: variables.input })
        .then((result, error) => {
          if (result.error || error) {
            tx?.revert();
          } else {
            tx?.commit();
          }
        });
    } else {
      return updateSpell.execute({ input: variables.input });
    }
  };

  return { ...updateSpell, execute };
};
