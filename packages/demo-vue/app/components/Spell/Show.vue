<script setup lang="ts">
  const props = defineProps({
    spellId: {
      type: String,
      required: true,
    },
  });

  const spellQuery = await useSpellQuery(props.spellId);

  const spell = computed(() => {
    return spellQuery.data.value.spell;
  });
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col space-y-6">
    <NuxtLink to="/" class="a text-sm">
      ← Back to spells
    </NuxtLink>

    <div class="overflow-hidden bg-white shadow sm:rounded-lg">
      <SpellDetail :spell="spell" />
    </div>
  </div>
</template>
