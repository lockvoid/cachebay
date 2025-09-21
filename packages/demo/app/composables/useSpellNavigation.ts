export const useSpellNavigation = (currentSpellId: string) => {
  const currentId = parseInt(currentSpellId);
  
  const getPreviousSpellId = () => {
    return currentId > 1 ? (currentId - 1).toString() : null;
  };
  
  const getNextSpellId = () => {
    return (currentId + 1).toString();
  };
  
  return {
    previousSpellId: getPreviousSpellId(),
    nextSpellId: getNextSpellId()
  };
};
