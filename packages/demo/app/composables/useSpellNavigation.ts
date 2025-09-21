export const useSpellNavigation = async () => {
  const spellsQuery = await useSpellsQuery();
  
  const getSpellNavigation = (currentSpellId: string) => {
    const spells = spellsQuery.data.value?.spells?.edges || [];
    const currentIndex = spells.findIndex((edge: any) => edge.node.id === currentSpellId);
    
    if (currentIndex === -1) {
      return { previousSpell: null, nextSpell: null };
    }
    
    const previousSpell = currentIndex > 0 ? spells[currentIndex - 1].node : null;
    const nextSpell = currentIndex < spells.length - 1 ? spells[currentIndex + 1].node : null;
    
    return { previousSpell, nextSpell };
  };
  
  return { getSpellNavigation };
};
