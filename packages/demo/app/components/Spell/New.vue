<script setup lang="ts">
  const router = useRouter();

  const createSpell = useCreateSpell();

  const handleCreate = async (input) => {
    try {
      const result = await createSpell.execute({
        input,
      });

      if (result.error) {
        throw result.error;
      }

      console.log('scsdc', result )
      await router.push(`/spell/${result.data.createSpell.spell.id}`);
    } catch (error) {
      console.error(error);

      alert('An error occurred. Please try again.')
    }
  };
</script>

<template>
<div class="max-w-3xl space-y-6 mx-auto flex flex-col">
  <NuxtLink to="/spells" class="a text-sm">
    ← Back to spells
  </NuxtLink>

  <div class="bg-white shadow-sm sm:rounded-lg"   >
    <h3 class="p-6 text-lg font-semibold border-b border-gray-200">
      Edit spell
    </h3>

    <div class="p-6 sm:p-6">
      <SpellForm :spell="{ name: '', effect: '', category: '' }" @submit="handleCreate"/>
    </div>
  </div>
</div>
</template>
