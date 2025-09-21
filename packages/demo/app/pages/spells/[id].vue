<script setup lang="ts">
const route = useRoute();
const id = computed(() => route.params.id as string);

const { data, isFetching, error } = useSpellQuery(id);
const spell = computed(() => data.value?.spell);
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <div class="max-w-5xl mx-auto p-6">
      <NuxtLink to="/" class="text-sm text-gray-600 hover:text-gray-800">← Back</NuxtLink>

      <div v-if="isFetching" class="mt-6">
        <SpellSkeleton />
      </div>

      <div v-else-if="error" class="mt-6">
        <SpellError />
      </div>

      <div v-else-if="spell" class="mt-6">
        <SpellDetail :spell="spell" />
      </div>

      <div v-else class="mt-6 text-gray-600">Spell not found.</div>
    </div>
  </div>
</template>
