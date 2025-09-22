<script setup lang="ts">
  const props = defineProps({
    spellId: {
      type: String,
      required: true
    }
  })

  const router = useRouter();

  const spellQuery = await useSpellQuery(props.spellId);

  const updateSpell = useUpdateSpell();

  const deleteSpell = useDeleteSpell();

  const spell = computed(() => {
    return spellQuery.data.value.spell;
  });

  const handleSubmit = async (values) => {
    try {
      const result = await updateSpell.execute({
        input: { ...values, id: props.spellId },
      });

      if (result?.error) {
        throw result.error;
      }

      await router.push(`/spells/${props.spellId}`);
    } catch (error) {
      console.error(error);

      alert('An error occurred. Please try again.')
    }
  };

  const handleDelete = async () => {
    const confirmation = confirm('Are you sure you want to delete this spell?');

    if (!confirmation) {
      return;
    }

    try {
      const result = await deleteSpell.execute({
        input: { id: props.spellId },
      });

      if (result?.error) {
        throw result.error;
      }

      await router.push('/');
    } catch (error) {
      console.error(error);

      alert('An error occurred. Please try again.')
    }
  };
</script>

<template>
  <div class="max-w-3xl mx-auto flex flex-col">
    <NuxtLink :to="`/spells/${spell.id}`" class="a text-sm">
      ← Back to spell
    </NuxtLink>

    <div class="bg-white shadow-sm sm:rounded-lg"   >
      <h3 class="p-6 text-lg font-semibold border-b border-gray-200">
        Edit spell
      </h3>

      <div class="p-6 sm:p-6">
        <SpellForm :spell="spell" @submit="handleSubmit" @delete="handleDelete" />
      </div>
    </div>
  </div>
</template>
