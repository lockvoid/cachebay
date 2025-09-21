<script setup lang="ts">
  const props = defineProps({
    spellId: {
      type: String,
      required: true
    }
  })

  const spellQuery = await useSpellQuery(props.spellId);

  const spell = computed(() => {
    return spellQuery.data.value.spell;
  });
</script>

<template>
  <div class="py-6">
    <div class="max-w-3xl mx-auto space-y-6">
      <NuxtLink to="/" class="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-500">
        ← Back to Spells
      </NuxtLink>

      <div class="bg-white shadow overflow-hidden sm:rounded-lg">
        <SpellDetail :spell="spell" />
      </div>
    </div>
  </div>
</template>
