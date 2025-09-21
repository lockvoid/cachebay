<script setup lang="ts">
const route = useRoute();
const router = useRouter();
const id = computed(() => route.params.id as string);

const { data, isFetching, error } = useSpellQuery(id);
const spell = computed(() => data.value?.spell);

const spellsQuery = await useSpellsQuery();
const { getSpellNavigation } = await useSpellNavigation();

const navigation = computed(() => {
  if (!spell.value) return { previousSpell: null, nextSpell: null };
  return getSpellNavigation(spell.value.id);
});

const goToPrevious = () => {
  const currentId = parseInt(spell.value.id);
  const previousId = currentId - 1;
  if (previousId > 0) {
    router.push(`/spells/${previousId}`);
  }
};

const goToNext = () => {
  const currentId = parseInt(spell.value.id);
  const nextId = currentId + 1;
  router.push(`/spells/${nextId}`);
};
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <div class="max-w-5xl mx-auto p-6">
      <NuxtLink to="/" class="text-sm text-gray-600 hover:text-gray-800">← Back</NuxtLink>

      <div v-if="isFetching" class="mt-6">
        <SpellSkeleton />
      </div>

      <div v-else-if="error" class="mt-6">
        <SpellError />
      </div>

      <div v-else-if="spell" class="mt-6">
        <!-- Navigation -->
        <div class="flex justify-between items-center mb-6">
          <button
            @click="goToPrevious"
            :disabled="parseInt(spell.id) <= 1"
            class="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
            </svg>
            <span>Previous</span>
          </button>

          <button
            @click="goToNext"
            class="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
          >
            <span>Next</span>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
            </svg>
          </button>
        </div>

        <SpellDetail :spell="spell" />
      </div>

      <div v-else class="mt-6 text-gray-600">Spell not found.</div>
    </div>
  </div>
</template>
