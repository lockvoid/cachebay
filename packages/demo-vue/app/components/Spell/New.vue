<script setup lang="ts">
  const router = useRouter();

  const settings = useSettings();

  const createSpell = useCreateSpell();

  const handleCreate = async (input) => {
    if (settings.optimistic) {
      createSpell.execute({
        input,
      });

      await router.push("/");
    } else {
      try {
        const result = await createSpell.execute({
          input,
        });

        await router.push("/");
      } catch (error) {
        console.error(error);

        alert("An error occurred. Please try again.");
      }
    }
  };
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col space-y-6">
    <NuxtLink to="/spells" class="a text-sm">
      ← Back to spells
    </NuxtLink>

    <div class="bg-white shadow-sm sm:rounded-lg">
      <h3 class="border-b border-gray-200 p-6 text-lg font-semibold">
        Edit spell
      </h3>

      <div class="p-6 sm:p-6">
        <SpellForm :spell="{ name: '', effect: '', category: '' }" @submit="handleCreate" />
      </div>
    </div>
  </div>
</template>
