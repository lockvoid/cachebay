import { useMutation } from "villus";
import { SPELL_FIELDS } from "./useSpellQuery";

export const CREATE_SPELL_MUTATION = `
  ${SPELL_FIELDS}

  mutation CreateSpell($input: CreateSpellInput!) {
    createSpell(input: $input) {
      spell {
        ...SpellFields
      }
    }
  }
`;

export const useCreateSpell = () => {
  return useMutation(CREATE_SPELL_MUTATION);
};
